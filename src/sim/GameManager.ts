import { mulberry32 } from '../lib/random'
import { CONFIG } from './config'
import { CustomerFactory } from './CustomerFactory'
import { CustomerManager } from './CustomerManager'
import { CustomerScheduler } from './CustomerScheduler'
import { EconomyManager } from './EconomyManager'
import { KeyManager } from './KeyManager'
import { LockerManager } from './LockerManager'
import { SimulationClock } from './SimulationClock'
import type {
  ActionResult,
  Customer,
  CustomerId,
  Dialogue,
  DialogueOption,
  DialogueOptionId,
  Hands,
  Item,
  LockerId,
  SimEvent,
  SimNotice,
} from './types'

const ok = (message: string | null = null): ActionResult => ({ ok: true, message })
const fail = (message: string): ActionResult => ({ ok: false, message })

const DEPOSIT_VISIT = new Set(['waiting', 'depositing'])
const RETURN_VISIT = new Set(['waitingForCollection', 'collecting'])

export type DialogueChoice = DialogueOption & { disabled: string | null }

/**
 * The simulation root. Owns every manager and exposes the actions the player can take.
 * Every action validates first and returns an ActionResult instead of throwing, so the 3D layer can
 * call them freely; the managers themselves throw on impossible states (bugs).
 */
export class GameManager {
  readonly clock = new SimulationClock<SimEvent>()
  readonly customers = new CustomerManager()
  readonly lockers: LockerManager
  readonly keys: KeyManager
  readonly economy: EconomyManager
  readonly scheduler: CustomerScheduler
  private readonly factory: CustomerFactory
  private readonly rand: () => number

  hands: Hands = null
  dialogue: Dialogue | null = null
  /** Game time until which the player is busy (e.g. fumbling a wrong key). */
  busyUntil = 0
  firstCustomerId: CustomerId | null = null
  tutorialComplete = false
  private notices: SimNotice[] = []

  constructor(seed = 1) {
    this.rand = mulberry32(seed)
    this.factory = new CustomerFactory(this.rand)
    const { lockerRows, lockerCols, keyHooks } = CONFIG.facility
    this.lockers = new LockerManager(lockerRows, lockerCols)
    this.keys = new KeyManager(
      this.lockers.all().map((l) => ({ lockerId: l.id, keyId: l.keyId })),
      keyHooks,
    )
    this.economy = new EconomyManager(CONFIG.economy.startingMoney, CONFIG.economy.startingReputation)
    this.scheduler = new CustomerScheduler(CONFIG.stages, this.rand)
    this.scheduleNextArrival()
  }

  get now(): number {
    return this.clock.now
  }

  // ------------------------------------------------------------------ time

  update(dt: number): void {
    for (const event of this.clock.advance(dt)) {
      if (event.type === 'customerArrive') this.onArrive(event.customerId)
      else this.onReturn(event.customerId)
    }
  }

  drainNotices(): SimNotice[] {
    const out = this.notices
    this.notices = []
    return out
  }

  private notify(notice: SimNotice): void {
    this.notices.push(notice)
  }

  private scheduleNextArrival(): void {
    const delay = this.scheduler.nextArrivalDelay()
    if (delay === null) return
    const opts = { patience: CONFIG.customer.patience, fee: CONFIG.economy.depositFee }
    const first = this.firstCustomerId === null
    const { customer, item } = first ? this.factory.tutorialCustomer(opts) : this.factory.customer(opts)
    this.customers.add(customer, item)
    if (first) this.firstCustomerId = customer.id
    this.clock.scheduleIn(delay, { type: 'customerArrive', customerId: customer.id })
  }

  private onArrive(id: CustomerId): void {
    this.notify({ type: 'customerSpawned', customerId: id })
    this.scheduleNextArrival()
  }

  private onReturn(id: CustomerId): void {
    this.customers.transition(id, 'returning')
    this.notify({ type: 'customerSpawned', customerId: id })
  }

  // ------------------------------------------------------------------ called by the 3D customer agents

  customerReachedCounter(id: CustomerId): void {
    const c = this.customers.get(id)
    if (c.state === 'arriving') this.customers.transition(id, 'waiting')
    else if (c.state === 'returning') this.customers.transition(id, 'waitingForCollection')
  }

  /** The agent walked out of the door. Finished customers are dropped from the live set. */
  customerExited(id: CustomerId): void {
    const c = this.customers.get(id)
    if (c.state === 'completed' || c.state === 'leftWithoutService') {
      if (id === this.firstCustomerId && c.state === 'completed') this.tutorialComplete = true
      this.customers.forget(id)
    }
  }

  /** Customers at the counter, in arrival order (first is served first). */
  queue(): Customer[] {
    return this.customers
      .all()
      .filter((c) => DEPOSIT_VISIT.has(c.state) || RETURN_VISIT.has(c.state))
  }

  // ------------------------------------------------------------------ conversation

  talkTo(id: CustomerId): ActionResult {
    const c = this.customers.get(id)
    if (!DEPOSIT_VISIT.has(c.state) && !RETURN_VISIT.has(c.state)) {
      return fail(c.state === 'arriving' || c.state === 'returning' ? 'Let them reach the counter first.' : 'They are leaving.')
    }
    if (this.dialogue?.customerId !== id) this.dialogue = { customerId: id, lines: [] }
    return ok()
  }

  closeDialogue(): void {
    this.dialogue = null
  }

  dialogueOptions(): DialogueChoice[] {
    const d = this.dialogue
    if (!d) return []
    const c = this.customers.get(d.customerId)
    const item = this.customers.itemOf(c)
    const out: DialogueChoice[] = []
    const add = (id: DialogueOptionId, label: string, disabled: string | null = null) => out.push({ id, label, disabled })

    if (DEPOSIT_VISIT.has(c.state)) {
      if (!c.visit.greeted) add('greet', 'Greet them')
      if (!c.visit.askedName) add('askName', 'Ask their name')
      if (item?.status === 'withCustomer') {
        add('accept', `Accept their ${item.label}`, this.hands ? 'Your hands are full.' : c.visit.greeted ? null : 'Greet them first.')
      }
      if (item?.status === 'heldByPlayer') {
        add('confirmStored', 'Tell them it is stored', 'Store it in a locker first.')
      }
      if (item?.status === 'inLocker') add('confirmStored', 'Tell them it is stored')
    } else {
      if (!c.visit.greeted) add('greet', 'Greet them')
      if (!c.visit.askedName) add('askName', 'Ask what name it is under')
      if (this.hands?.kind === 'item') {
        const held = this.customers.item(this.hands.itemId)
        add('handOver', `Hand over the ${held.label}`)
      } else {
        add('handOver', 'Hand over their item', 'Fetch it from the lockers first.')
      }
    }
    add('goodbye', 'Step away')
    return out
  }

  choose(optionId: DialogueOptionId): ActionResult {
    const d = this.dialogue
    if (!d) return fail('You are not talking to anyone.')
    const choice = this.dialogueOptions().find((o) => o.id === optionId)
    if (!choice) return fail('You cannot say that now.')
    if (choice.disabled) return fail(choice.disabled)
    const c = this.customers.get(d.customerId)
    const say = (who: string, text: string) => {
      d.lines.push({ who, text })
      d.lines = d.lines.slice(-6)
    }

    switch (optionId) {
      case 'greet':
        c.visit.greeted = true
        if (c.state === 'waitingForCollection') {
          this.customers.transition(c.id, 'collecting')
          say('You', 'Welcome back!')
          say(c.name, c.personality.helloAgain)
        } else {
          say('You', 'Hi, welcome in!')
          say(c.name, c.personality.hello)
        }
        return ok()
      case 'askName':
        c.visit.askedName = true
        say('You', RETURN_VISIT.has(c.state) ? 'What name is it under?' : 'Can I take your name?')
        say(c.name, `It's ${c.name}.`)
        return ok()
      case 'accept': {
        const item = this.mustItem(c)
        if (c.state === 'waiting') this.customers.transition(c.id, 'depositing')
        item.status = 'heldByPlayer'
        this.hands = { kind: 'item', itemId: item.id }
        say('You', `Sure, I'll look after your ${item.label}.`)
        say(c.name, c.personality.handOver)
        return ok(`You took the ${item.label}. Store it in an empty locker.`)
      }
      case 'confirmStored': {
        if (c.state === 'waiting') this.customers.transition(c.id, 'depositing')
        const delay = this.scheduler.returnDelay()
        c.depositedAt = this.now
        c.expectedReturnAt = this.now + delay
        this.customers.transition(c.id, 'stored')
        this.clock.schedule(c.expectedReturnAt, { type: 'customerReturn', customerId: c.id })
        this.economy.addXp(CONFIG.economy.xp.deposit)
        this.notify({ type: 'xp', amount: CONFIG.economy.xp.deposit })
        this.notify({ type: 'customerLeaving', customerId: c.id })
        this.dialogue = null
        return ok(`${c.name} left. Remember where their ${this.mustItem(c).label} is.`)
      }
      case 'handOver':
        return this.handOver(c, say)
      case 'goodbye':
        this.dialogue = null
        return ok()
    }
  }

  private handOver(c: Customer, say: (who: string, text: string) => void): ActionResult {
    if (this.hands?.kind !== 'item') return fail('You are not holding anything to hand over.')
    const held = this.customers.item(this.hands.itemId)
    if (c.state === 'waitingForCollection') {
      c.visit.greeted = true
      this.customers.transition(c.id, 'collecting')
    }
    say('You', `Here's your ${held.label}.`)
    if (held.customerId !== c.id) {
      const theirs = this.mustItem(c)
      say(c.name, `That's not mine! Mine is a ${theirs.label}.`)
      c.satisfaction = Math.max(0, c.satisfaction + CONFIG.economy.wrongItemSatisfaction)
      this.economy.mistakes += 1
      this.economy.adjustReputation(CONFIG.economy.wrongItemReputation)
      const message = `Wrong item — that ${held.label} belongs to someone else.`
      this.notify({ type: 'mistake', kind: 'wrongItem', message })
      return fail(message)
    }
    say(c.name, c.personality.thanks)
    held.status = 'returned'
    this.hands = null
    c.satisfaction = Math.min(100, c.satisfaction + 15)
    const tip = Math.round((CONFIG.economy.maxTip * c.satisfaction) / 100)
    const paid = c.fee + tip
    this.economy.earn(paid)
    this.economy.addXp(CONFIG.economy.xp.correctReturn)
    this.economy.served += 1
    this.economy.adjustReputation(2)
    this.customers.transition(c.id, 'completed')
    this.notify({ type: 'payment', amount: paid })
    this.notify({ type: 'xp', amount: CONFIG.economy.xp.correctReturn })
    this.notify({ type: 'customerLeaving', customerId: c.id })
    this.dialogue = null
    return ok(`${c.name} paid $${paid}${tip > 0 ? ` (incl. $${tip} tip)` : ''}.`)
  }

  private mustItem(c: Customer): Item {
    const item = this.customers.itemOf(c)
    if (!item) throw new Error(`Customer ${c.id} has no item`)
    return item
  }

  // ------------------------------------------------------------------ lockers & keys

  private busy(): ActionResult | null {
    return this.now < this.busyUntil ? fail('Still fumbling with the keys…') : null
  }

  openLocker(id: LockerId): ActionResult {
    const locker = this.lockers.get(id)
    if (locker.doorOpen) return fail('It is already open.')
    if (locker.locked) return fail('Locked. You need its key from the key board.')
    this.lockers.open(id)
    return ok()
  }

  closeLocker(id: LockerId): ActionResult {
    if (!this.lockers.get(id).doorOpen) return fail('It is already shut.')
    this.lockers.close(id)
    return ok()
  }

  putItem(id: LockerId): ActionResult {
    const locker = this.lockers.get(id)
    if (this.hands?.kind !== 'item') return fail('You are not carrying an item.')
    if (!locker.doorOpen) return fail('Open the door first.')
    if (locker.itemId) return fail('This locker is already in use.')
    const item = this.customers.item(this.hands.itemId)
    this.lockers.put(id, item.id)
    item.status = 'inLocker'
    item.lockerId = id
    item.depositedAt ??= this.now
    this.customers.get(item.customerId).lockerId = id
    this.hands = null
    return ok(`Stored the ${item.label}. Close the door and take the key.`)
  }

  takeItem(id: LockerId): ActionResult {
    const locker = this.lockers.get(id)
    if (this.hands) return fail('Your hands are full.')
    if (!locker.doorOpen) return fail('Open the door first.')
    if (!locker.itemId) return fail('It is empty.')
    const item = this.customers.item(this.lockers.take(id))
    item.status = 'heldByPlayer'
    item.lockerId = null
    this.customers.get(item.customerId).lockerId = null
    this.hands = { kind: 'item', itemId: item.id }
    return ok(`You took the ${item.label}.`)
  }

  /** Pull the key out of a shut locker's lock. This locks it. */
  takeKeyFromLock(id: LockerId): ActionResult {
    const locker = this.lockers.get(id)
    const key = this.keys.get(locker.keyId)
    if (key.location.kind !== 'inLock') return fail('Its key is not here.')
    if (locker.doorOpen) return fail('Close the door before taking the key.')
    if (this.hands) return fail('Your hands are full.')
    this.lockers.setLocked(id, true)
    this.keys.move(key.id, { kind: 'player' })
    this.hands = { kind: 'key', keyId: key.id }
    return ok('Locked. Hang the key on the key board — and remember which hook.')
  }

  /** Try the key in your hand on a locker. */
  useKeyOn(id: LockerId): ActionResult {
    const busy = this.busy()
    if (busy) return busy
    if (this.hands?.kind !== 'key') return fail('You need a key.')
    const locker = this.lockers.get(id)
    if (!locker.locked) return fail('This one is not locked.')
    if (!this.keys.fits(this.hands.keyId, id)) {
      this.busyUntil = this.now + CONFIG.wrongKeyDelay
      this.economy.mistakes += 1
      const message = "That key doesn't fit this locker."
      this.notify({ type: 'mistake', kind: 'wrongKey', message })
      return fail(message)
    }
    this.keys.move(this.hands.keyId, { kind: 'inLock' })
    this.hands = null
    this.lockers.setLocked(id, false)
    this.lockers.open(id)
    return ok('Unlocked.')
  }

  hangKey(hook: number): ActionResult {
    if (this.hands?.kind !== 'key') return fail('You are not holding a key.')
    if (this.keys.onHook(hook)) return fail('That hook is taken.')
    this.keys.move(this.hands.keyId, { kind: 'hook', hook })
    this.hands = null
    return ok()
  }

  takeKeyFromHook(hook: number): ActionResult {
    const busy = this.busy()
    if (busy) return busy
    const key = this.keys.onHook(hook)
    if (!key) return fail('Nothing on this hook.')
    if (this.hands) return fail('Your hands are full.')
    this.keys.move(key.id, { kind: 'player' })
    this.hands = { kind: 'key', keyId: key.id }
    return ok()
  }

  // ------------------------------------------------------------------ HUD queries

  activeDeposits(): number {
    return this.customers.all().filter((c) => {
      const item = this.customers.itemOf(c)
      return item !== null && item.status !== 'withCustomer' && item.status !== 'returned'
    }).length
  }

  /** Tutorial / current objective, derived from state so it can never get out of sync. */
  objective(): string {
    if (this.tutorialComplete) return 'Milestone 1 complete — you served your first customer!'
    const id = this.firstCustomerId
    if (!id) return 'Open for business.'
    let c: Customer
    try {
      c = this.customers.get(id)
    } catch {
      return 'Open for business.'
    }
    const item = this.customers.itemOf(c)
    const label = item?.label ?? 'item'
    const first = c.name.split(' ')[0] ?? c.name
    const hands = this.hands
    const lockerOpen = c.lockerId ? this.lockers.get(c.lockerId).doorOpen : false

    switch (c.state) {
      case 'arriving':
        return 'Your first customer is coming in. Stand behind the counter.'
      case 'waiting':
      case 'depositing':
        if (item?.status === 'withCustomer') {
          return this.dialogue ? 'Greet them, ask their name, then accept their item.' : 'Talk to the customer at the counter.'
        }
        if (item?.status === 'heldByPlayer') return `Store the ${label} in an empty locker in the back room.`
        if (item?.status === 'inLocker' && lockerOpen) return 'Close the locker door.'
        if (item?.status === 'inLocker' && c.lockerId) {
          const key = this.keys.get(this.lockers.get(c.lockerId).keyId)
          if (key.location.kind === 'inLock') return 'Take the key out of the locker to lock it.'
          if (key.location.kind === 'player') return 'Hang the key on the key board. Remember which hook!'
          return `Go back to the counter and tell ${first} it is stored.`
        }
        return 'Serve the customer.'
      case 'stored': {
        const left = Math.max(0, Math.ceil((c.expectedReturnAt ?? this.now) - this.now))
        return `${first} returns in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}. Remember: which locker, which hook?`
      }
      case 'returning':
        return `${first} is back. Meet them at the counter.`
      case 'waitingForCollection':
      case 'collecting':
        if (hands?.kind === 'item') return `Hand the item to ${first}.`
        if (item?.status === 'inLocker' && lockerOpen) return `Take the ${label} out of the locker.`
        if (hands?.kind === 'key') return `Unlock ${first}'s locker with the key.`
        return `Fetch ${first}'s ${label}: take the right key from the key board.`
      case 'completed':
        return `${first} is happy. Nicely done!`
      case 'leftWithoutService':
        return `${first} gave up and left.`
    }
  }
}
