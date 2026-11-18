import { mulberry32 } from '../lib/random'
import {
  AUTOMATION_UPGRADES,
  CONFIG,
  WAREHOUSE_UPGRADES,
  ZONE_TITLES,
  type ArrivalStage,
  type CargoType,
  type AutoZone,
  type AutomationUpgradeDef,
  type Section,
  type UpgradeDef,
} from './config'
import { DealManager, type Offer } from './DealManager'
import { WarehouseManager, type WarehouseEvent } from './WarehouseManager'
import { CustomerFactory } from './CustomerFactory'
import { CustomerManager } from './CustomerManager'
import { ConveyorSystem } from './ConveyorSystem'
import { CustomerScheduler } from './CustomerScheduler'
import { EconomyManager } from './EconomyManager'
import { KeyManager } from './KeyManager'
import { LockerManager } from './LockerManager'
import { UpgradeManager, type CatalogueItem } from './UpgradeManager'
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
  RegisterEntry,
  SimEvent,
  SimNotice,
} from './types'

const ok = (message: string | null = null): ActionResult => ({ ok: true, message })
const fail = (message: string): ActionResult => ({ ok: false, message })

const DEPOSIT_VISIT = new Set(['waiting', 'depositing'])
const RETURN_VISIT = new Set(['waitingForCollection', 'collecting'])
/** Customers physically inside (or walking in): the shop is "empty" when none of these exist. */
const IN_BUILDING = new Set(['arriving', 'waiting', 'depositing', 'returning', 'waitingForCollection', 'collecting'])

/** The counter arm's current customer: taking their bag onto the belt, or handing their bag back. */
export interface CounterJob {
  kind: 'take' | 'give'
  customerId: CustomerId
  /** Seconds into the job. */
  t: number
  /** The bag has left the customer's hand (take) or the tray (give). */
  moved: boolean
  /** Take: the locker reserved for the bag. */
  lockerId: LockerId | null
}

/** A load on the receiving dock, as you see it. */
export interface ReceivingLoad {
  id: number
  owner: string
  crates: number
  /** Crates still on the truck. */
  onTruck: number
  /** What it looks like: its real contents if you know them, otherwise what the driver says. */
  looksLike: CargoType
  /** You know what is really inside (you opened it, or the scanner did). */
  known: boolean
  declared: CargoType
  /** Someone is opening the crates right now. */
  opening: boolean
  spoiled: boolean
  vip: boolean
  /** Where its crates belong (the section a crate of it would go in), or null if there is no room. */
  goesTo: Section | null
}

/** One bag the conveyor terminal can fetch. */
export interface TerminalEntry {
  lockerId: LockerId
  lockerNumber: number
  itemLabel: string
  /** The part of the building the locker is in. */
  where: string
  /** The customer's name, only if the player asked for it at the deposit. */
  name: string | null
  /** The arm is already on this one. */
  fetching: boolean
}

/** A dialogue option as shown to the player. `recommended` marks the natural next step (pre-selected in the UI). */
export type DialogueChoice = DialogueOption & { disabled: string | null; recommended: boolean }

/** Order of the "natural" conversation flow: the first enabled option in this list is recommended. */
const FLOW: DialogueOptionId[] = ['greet', 'askName', 'accept', 'confirmStored', 'handOver', 'goodbye']

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
  readonly upgrades = new UpgradeManager(CONFIG.upgrades)
  /** VIP offers and the deals you have signed (the deal office). */
  readonly deals = new DealManager()
  /** The warehouse, its trucks and crates (once built). */
  readonly warehouse = new WarehouseManager()
  /** The conveyor belt and robot arm (idle until the upgrade is bought). */
  readonly conveyor: ConveyorSystem
  /** Which part of the building each locker bank is in, and which row of that part (an arm station). */
  private readonly bankInfo = new Map<number, { zone: AutoZone; row: number }>([[0, { zone: 'main', row: 0 }]])
  private readonly factory: CustomerFactory
  private readonly rand: () => number

  /** Switches the mod menu can flip. */
  readonly mods = { noPatienceLoss: false }
  hands: Hands = null
  dialogue: Dialogue | null = null
  /** The supplier catalogue menu is open (player is browsing upgrades). */
  catalogueOpen = false
  /** The conveyor terminal menu is open (player is picking a bag to fetch). */
  terminalOpen = false
  /** The deal desk is open (the player is talking business with a VIP). */
  dealOpen = false
  /** What the counter arm is doing right now (it serves one customer at a time), if you have bought it. */
  counterJob: CounterJob | null = null
  private counterCheckAt = 0
  /** An automation console is open (`hub`, or the zone whose arms it controls). */
  consoleScope: 'hub' | 'warehouse' | AutoZone | null = null
  /** The receiving desk in the warehouse is open (the player is deciding what to do with the loads on the dock). */
  receivingOpen = false
  /** Game time until which the player is busy (e.g. fumbling a wrong key). */
  busyUntil = 0
  firstCustomerId: CustomerId | null = null
  tutorialComplete = false
  private notices: SimNotice[] = []
  /** Seconds the building has had nobody in it (for the idle guard). */
  private emptyFor = 0

  /** `stages` defaults to the real traffic plan; tests pass their own. */
  constructor(seed = 1, stages: readonly ArrivalStage[] = CONFIG.stages) {
    this.rand = mulberry32(seed)
    this.factory = new CustomerFactory(this.rand)
    const { lockerRows, lockerCols, hooksPerRack } = CONFIG.facility
    this.lockers = new LockerManager(lockerRows, lockerCols)
    this.keys = new KeyManager(
      this.lockers.all().map((l) => ({ lockerId: l.id, keyId: l.keyId })),
      hooksPerRack,
    )
    this.conveyor = new ConveyorSystem(
      this.lockers,
      this.customers,
      {
        zoneOf: (id) => this.zoneOf(id),
        rowOf: (id) => this.rowOf(id),
        random: () => this.rand(),
        jammed: (zone) =>
          this.notify({ type: 'jam', zone, text: `A robot arm in the ${ZONE_TITLES[zone]} has jammed! Repair it at that arm console.` }),
      },
      () => this.now,
    )
    this.economy = new EconomyManager(CONFIG.economy.startingMoney, CONFIG.economy.startingReputation)
    this.scheduler = new CustomerScheduler(stages, this.rand)
    this.scheduleNextArrival()
  }

  get now(): number {
    return this.clock.now
  }

  // ------------------------------------------------------------------ time

  update(dt: number): void {
    for (const event of this.clock.advance(dt)) {
      if (event.type === 'nextArrival') this.onNextArrival()
      else this.onReturn(event.customerId)
    }
    this.conveyor.update(dt)
    this.updateCounterArm(dt)
    if (this.hasWarehouse) this.handleWarehouseEvents(this.warehouse.update(dt, this.now, this.deals, this.rand))
    if (this.hasOffice) {
      const event = this.deals.update(this.now, this.economy.reputation, this.rand)
      const offer = this.deals.offer
      if (event === 'offered' && offer) this.notify({ type: 'message', text: `A VIP car is pulling up outside: ${offer.name} (${offer.title}).` })
      else if (event === 'expired') {
        this.dealOpen = false
        this.notify({ type: 'message', text: 'The VIP got tired of waiting and left the deal office.' })
      }
    }
    this.updatePatience(dt)
    this.updateIdleGuard(dt)
  }

  /**
   * Never leave the player bored: if the shop has been empty for the stage's `maxIdle` seconds, pull the
   * next scheduled arrival or return forward. Arrival times stay random (and tests can disable it).
   */
  private updateIdleGuard(dt: number): void {
    const maxIdle = this.scheduler.stage.maxIdle
    if (maxIdle === undefined || dt <= 0) return
    if (this.customers.all().some((c) => IN_BUILDING.has(c.state))) {
      this.emptyFor = 0
      return
    }
    this.emptyFor += dt
    if (this.emptyFor < maxIdle) return
    this.emptyFor = 0
    const [min, max] = CONFIG.idlePullIn
    const at = this.now + min + (max - min) * this.rand()
    const next = this.clock.peekEarliest()
    if (!next || next.at <= at + 1) return // something is about to happen anyway
    const event = this.clock.retimeEarliest(at)
    if (event?.type === 'customerReturn') this.customers.get(event.customerId).expectedReturnAt = at
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
    // Customers come a little faster with every level you have earned.
    this.scheduler.pace = 1 + CONFIG.progression.paceBonusPerLevel * (this.economy.level.level - 1)
    const delay = this.scheduler.nextArrivalDelay()
    if (delay === null) return
    this.clock.scheduleIn(delay, { type: 'nextArrival' })
  }

  /** Customers with business here: in the building, or with an item stored. */
  activeCustomers(): number {
    return this.customers.all().filter((c) => c.state !== 'completed' && c.state !== 'leftWithoutService').length
  }

  private onNextArrival(): void {
    const stage = this.scheduler.stage
    // More lockers means room for more customers with business here.
    const extraLockers = this.lockers.total - CONFIG.facility.lockerRows * CONFIG.facility.lockerCols
    if (stage.maxActive !== undefined && this.activeCustomers() >= stage.maxActive + extraLockers) {
      this.clock.scheduleIn(CONFIG.arrivalRetry, { type: 'nextArrival' })
      return
    }
    const opts = {
      patience: stage.patience,
      fee: CONFIG.economy.depositFee,
      satisfaction: CONFIG.customer.startingSatisfaction,
    }
    const first = this.firstCustomerId === null
    const { customer, item } = first ? this.factory.tutorialCustomer(opts) : this.factory.customer({ ...opts, avoid: this.labelsInUse() })
    this.customers.add(customer, item)
    this.scheduler.introduce(customer.id)
    if (first) this.firstCustomerId = customer.id
    this.notify({ type: 'customerSpawned', customerId: customer.id })
    this.scheduleNextArrival()
  }

  /** What the bags of everyone with business here look like ("blue suitcase"), so a new bag can look different. */
  private labelsInUse(): Set<string> {
    const labels = new Set<string>()
    for (const c of this.customers.all()) {
      const item = this.customers.itemOf(c)
      if (item) labels.add(item.label)
    }
    return labels
  }

  /**
   * The customer's bag is stored: they leave, their return is scheduled, and the deposit pays XP. This is the "it is stored" step: you do
   * it by telling them, the belt does it for you the moment you load their bag, and a customer whose patience ran out while waiting for it
   * does it themselves.
   */
  private finishDeposit(c: Customer): void {
    if (c.state === 'waiting') this.customers.transition(c.id, 'depositing')
    const stored = this.customers
      .all()
      .flatMap((other) => (other.state === 'stored' && other.expectedReturnAt !== null ? [other.expectedReturnAt] : []))
    const delay = this.scheduler.returnDelay(this.now, stored)
    c.depositedAt = this.now
    c.expectedReturnAt = this.now + delay
    this.customers.transition(c.id, 'stored')
    this.clock.schedule(c.expectedReturnAt, { type: 'customerReturn', customerId: c.id })
    this.gainXp(CONFIG.economy.xp.deposit)
    this.notify({ type: 'customerLeaving', customerId: c.id })
    if (this.dialogue?.customerId === c.id) this.dialogue = null
  }

  private updatePatience(dt: number): void {
    if (this.mods.noPatienceLoss) return // mod menu: customers never lose patience
    for (const c of this.customers.all()) {
      if (!c.patienceDrains || dt <= 0) continue
      const waiting = c.state === 'waiting' || c.state === 'waitingForCollection'
      const serving = c.state === 'depositing' || c.state === 'collecting'
      if (!waiting && !serving) continue
      if (this.dialogue?.customerId === c.id) continue
      c.patience = Math.max(0, c.patience - dt * (waiting ? 1 : CONFIG.customer.servingDrainFactor))
      if (c.patience > 0) continue
      // A customer whose bag is already in a locker and who has waited and waited for you to say so just goes: it is stored, after all.
      if (c.state === 'depositing' && this.customers.itemOf(c)?.status === 'inLocker' && this.dialogue?.customerId !== c.id) {
        c.satisfaction = Math.max(0, c.satisfaction - 30)
        this.economy.adjustReputation(-1)
        this.finishDeposit(c)
        this.notify({ type: 'message', text: `${c.name} got tired of waiting for you to say it was stored, and left.` })
        continue
      }
      // Out of patience. Someone still holding their bag walks out; someone whose bag you have stays,
      // but gets steadily less happy (smaller tip, worse reputation).
      if (this.customers.itemOf(c)?.status === 'withCustomer') this.walkout(c)
      else c.satisfaction = Math.max(0, c.satisfaction - dt * CONFIG.customer.impatientSatisfactionPerSecond)
    }
  }

  private walkout(c: Customer): void {
    if (this.dialogue?.customerId === c.id) this.dialogue = null
    this.customers.transition(c.id, 'leftWithoutService')
    c.satisfaction = 0
    this.economy.adjustReputation(CONFIG.economy.walkoutReputation)
    const who = c.visit.askedName ? c.name : 'A customer'
    this.notify({ type: 'walkout', customerId: c.id, message: `${who} got tired of waiting and left.` })
    this.notify({ type: 'customerLeaving', customerId: c.id })
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
    if (c.state !== 'completed' && c.state !== 'leftWithoutService') return
    if (id === this.firstCustomerId && c.state === 'completed') this.tutorialComplete = true
    this.customers.forget(id)
    if (this.scheduler.finish(id)) {
      const stage = this.scheduler.stage
      this.notify({ type: 'stageStarted', title: stage.title, text: stage.intro })
      this.scheduleNextArrival()
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
    const add = (id: DialogueOptionId, label: string, disabled: string | null = null) =>
      out.push({ id, label, disabled, recommended: false })

    // Slots stay put for the whole visit, so the same number key always means the same thing:
    // 1 greet · 2 ask name · 3 the main action · then step away (and, before taking the bag, turn away).
    // Finished steps stay in place, greyed out, instead of shifting the others up.
    const done = 'Done'
    if (DEPOSIT_VISIT.has(c.state)) {
      add('greet', 'Greet them', c.visit.greeted ? done : null)
      add('askName', 'Ask their name', c.visit.askedName ? done : null)
      if (item?.status === 'withCustomer') {
        add('accept', `Accept their ${item.label}`, this.hands ? 'Your hands are full.' : c.visit.greeted ? null : 'Greet them first.')
      } else {
        add('confirmStored', 'Tell them it is stored', this.storedBlocker(item))
      }
      add('goodbye', 'Step away')
      if (item && item.status !== 'withCustomer') {
        const mine = this.hands?.kind === 'item' && this.hands.itemId === item.id
        add('giveBack', 'Give their bag back (they will go)', mine ? null : 'You are not holding their bag.')
      }
      if (item?.status === 'withCustomer') {
        add('turnAway', this.lockers.availableCount === 0 ? "Sorry, we're full" : "Sorry, we can't take it right now")
      }
    } else {
      add('greet', 'Greet them', c.visit.greeted ? done : null)
      add('askName', 'Ask what name it is under', c.visit.askedName ? done : null)
      if (this.hands?.kind === 'item') {
        add('handOver', `Hand over the ${this.customers.item(this.hands.itemId).label}`)
      } else {
        add('handOver', 'Hand over their item', this.hasConveyor ? 'Fetch it at the terminal first.' : 'Fetch it from the lockers first.')
      }
      add('goodbye', 'Step away')
    }
    // Recommend the first enabled step of the usual flow. When the only thing left is blocked (e.g. the bag
    // is still in your hands), that is "Step away": go and do it, then come back.
    const next = FLOW.map((id) => out.find((o) => o.id === id)).find((o) => o && !o.disabled)
    if (next) next.recommended = true
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
        c.patience = Math.min(c.maxPatience, c.patience + CONFIG.customer.greetingPatience)
        c.satisfaction = Math.min(100, c.satisfaction + 3)
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
        // Only a name taken when the bag is dropped off makes it onto the deposit register.
        if (DEPOSIT_VISIT.has(c.state)) c.nameTaken = true
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
      case 'turnAway': {
        say('You', this.lockers.availableCount === 0 ? "Sorry, we're full at the moment." : "Sorry, we can't take it right now.")
        say(c.name, 'Oh. Alright, another time then.')
        this.customers.transition(c.id, 'leftWithoutService')
        this.economy.adjustReputation(CONFIG.economy.turnAwayReputation)
        this.notify({ type: 'customerLeaving', customerId: c.id })
        this.dialogue = null
        return ok('You turned the customer away.')
      }
      case 'confirmStored': {
        this.finishDeposit(c)
        this.dialogue = null
        const where = this.hasConveyor ? 'Use the terminal when they are back.' : this.hasLabels ? 'Check the register board.' : 'Remember where it is.'
        return ok(`${c.name} left. ${where}`)
      }
      case 'giveBack': {
        const item = this.mustItem(c)
        item.status = 'returned'
        this.hands = null
        say('You', `Actually, here's your ${item.label} back.`)
        say(c.name, 'Oh. Alright, thanks anyway.')
        this.customers.transition(c.id, 'leftWithoutService')
        this.economy.adjustReputation(CONFIG.economy.turnAwayReputation)
        this.notify({ type: 'customerLeaving', customerId: c.id })
        this.dialogue = null
        return ok('You gave their bag back.')
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
    if (held.customerId !== c.id) return this.wrongPackage(c, say)

    return this.finishReturn(c, held, say)
  }

  /**
   * The customer gets the right bag back: they pay (a tip by how happy they are, half price if you made them furious), the shop earns XP
   * and reputation, and they leave. You do this by handing it over; the counter arm does it for you.
   */
  private finishReturn(c: Customer, held: Item, say: ((who: string, text: string) => void) | null): ActionResult {
    const retried = c.visit.wrongAttempts > 0
    say?.(c.name, retried ? 'Finally! That one is mine.' : c.personality.thanks)
    held.status = 'returned'
    if (this.hands?.kind === 'item' && this.hands.itemId === held.id) this.hands = null
    // Someone you kept getting wrong does not warm up just because you finally got it right.
    if (!retried) c.satisfaction = Math.min(100, c.satisfaction + 15)
    const tip = Math.round((CONFIG.economy.maxTip * c.satisfaction) / 100)
    const w = CONFIG.wrongItem
    const furious = c.visit.wrongAttempts >= w.furiousAt
    const fee = furious ? Math.round(c.fee * w.furiousDiscount) : c.fee
    const paid = fee + tip
    this.economy.earn(paid)
    this.gainXp(CONFIG.economy.xp.correctReturn)
    this.economy.served += 1
    this.economy.adjustReputation(c.satisfaction >= 60 ? 2 : c.satisfaction >= 35 ? 0 : -2)
    this.customers.transition(c.id, 'completed')
    this.notify({ type: 'payment', amount: paid })
    this.notify({ type: 'customerLeaving', customerId: c.id })
    if (this.dialogue?.customerId === c.id) this.dialogue = null
    const extras = [furious ? 'half price after the mix-ups' : '', tip > 0 ? `$${tip} tip` : ''].filter(Boolean)
    return ok(`${c.name} paid $${paid}${extras.length ? ` (${extras.join(', ')})` : ''}.`)
  }

  /**
   * The player handed over someone else's package. The customer says so, and every further wrong try makes
   * them angrier: more lost satisfaction and reputation, less patience, and from `furiousAt` tries a discount.
   */
  private wrongPackage(c: Customer, say: (who: string, text: string) => void): ActionResult {
    const w = CONFIG.wrongItem
    c.visit.wrongAttempts += 1
    const tries = c.visit.wrongAttempts
    say(c.name, wrongPackageLine(tries, this.mustItem(c).label))
    c.satisfaction = Math.max(0, c.satisfaction + w.satisfaction)
    if (c.patienceDrains) c.patience = Math.max(0, c.patience - c.maxPatience * w.patienceFraction)
    this.economy.mistakes += 1
    this.economy.adjustReputation(w.reputation[Math.min(tries, w.reputation.length) - 1] ?? 0)
    const who = c.visit.askedName ? (c.name.split(' ')[0] ?? c.name) : 'The customer'
    const message =
      tries === 1
        ? `${who}: "That's not my package."`
        : tries < w.furiousAt
          ? `Wrong again (${tries}). ${who} is getting angry.`
          : `Wrong again (${tries}). ${who} is furious!`
    this.notify({ type: 'mistake', kind: 'wrongItem', message })
    return fail(message)
  }

  /** XP, with a cash bonus and a notice when it crosses into a new level. */
  private gainXp(amount: number): void {
    const before = this.economy.level.level
    this.economy.addXp(amount)
    this.notify({ type: 'xp', amount })
    const after = this.economy.level.level
    if (after === before) return
    let bonus = 0
    const unlocked: string[] = []
    for (let level = before + 1; level <= after; level++) {
      bonus += CONFIG.progression.levelUpBonus * level
      for (const def of this.upgrades.unlockedAt(level)) unlocked.push(def.title)
    }
    this.economy.earn(bonus)
    this.notify({ type: 'levelUp', level: after, bonus, unlocked })
  }

  // ------------------------------------------------------------------ catalogue (storage and key rack upgrades)

  openCatalogue(): ActionResult {
    if (this.dialogue) return fail('Finish talking first.')
    this.catalogueOpen = true
    return ok()
  }

  closeCatalogue(): void {
    this.catalogueOpen = false
  }

  /** Numbers on the lockers and a tag on every key. */
  get hasLabels(): boolean {
    return this.upgrades.has('labels')
  }

  /** Keys are gone: every locker has an electronic lock and the key racks are status screens. */
  get isDigital(): boolean {
    return this.upgrades.has('digital')
  }

  /** The conveyor belt, robot arm and terminal are installed. */
  get hasConveyor(): boolean {
    return this.upgrades.has('conveyor')
  }

  /** The deal office is built. */
  get hasOffice(): boolean {
    return this.upgrades.has('office')
  }

  /** The counter arm takes bags from customers and hands them back. */
  get hasCounterArm(): boolean {
    return this.upgrades.has('counter-arm')
  }

  /** The counter arm's job for the 3D view: what it is doing, for whom, and how far through (0…1). */
  counterJobView(): { kind: 'take' | 'give'; customerId: CustomerId; progress: number } | null {
    const j = this.counterJob
    return j ? { kind: j.kind, customerId: j.customerId, progress: Math.min(1, j.t / CONFIG.automation.counterSeconds) } : null
  }

  /**
   * The counter arm (late automation): it serves the customers at the counter one at a time, oldest first, unless you are talking to them.
   * A customer who has come to leave a bag gets it taken onto the belt (and leaves, as when you load it yourself); a customer back to
   * collect gets the arm fetching their bag and then handing it over. You are left with the upgrades, the maintenance and the VIPs.
   */
  private updateCounterArm(dt: number): void {
    if (!this.hasCounterArm || !this.hasConveyor) return
    // Returns: ask the belt for the bag of everyone back to collect (the arm hands it over when it arrives).
    this.counterCheckAt -= dt
    if (this.counterCheckAt <= 0) {
      this.counterCheckAt = 1
      for (const c of this.customers.all()) {
        if (c.state !== 'waitingForCollection' && c.state !== 'collecting') continue
        const item = this.customers.itemOf(c)
        if (item?.status === 'inLocker' && item.lockerId && this.isRobotLocker(item.lockerId) && !this.conveyor.isBusy(item.lockerId)) this.requestBag(item.lockerId)
      }
    }
    const job = this.counterJob
    if (job) {
      this.advanceCounterJob(job, dt)
      return
    }
    const cfg = CONFIG.automation
    for (const c of this.queue()) {
      if (this.dialogue?.customerId === c.id) continue
      const item = this.customers.itemOf(c)
      if (!item) continue
      if (c.state === 'waiting' && item.status === 'withCustomer') {
        const inbound = this.conveyor.inbound()
        if (inbound.length >= cfg.beltCapacity || inbound.some((p) => p.phase === 'beltIn' && p.t < cfg.loadGap)) continue
        const locker = this.lockers.all().find((l) => l.state === 'available' && this.isRobotLocker(l.id) && !l.itemId && !this.conveyor.isBusy(l.id))
        if (!locker) continue
        locker.state = 'reserved'
        this.counterJob = { kind: 'take', customerId: c.id, t: 0, moved: false, lockerId: locker.id }
        return
      }
      if (c.state === 'waitingForCollection' && item.status === 'onConveyor' && this.conveyor.isReady(item.id)) {
        this.counterJob = { kind: 'give', customerId: c.id, t: 0, moved: false, lockerId: null }
        return
      }
    }
  }

  private advanceCounterJob(job: CounterJob, dt: number): void {
    const c = this.customers.has(job.customerId) ? this.customers.get(job.customerId) : null
    const item = c ? this.customers.itemOf(c) : null
    const duration = CONFIG.automation.counterSeconds
    const abort = (): void => {
      // Only before the arm has the bag: you started talking to them, or they walked out.
      if (job.lockerId) {
        const locker = this.lockers.get(job.lockerId)
        if (locker.state === 'reserved' && !locker.itemId) locker.state = 'available'
      }
      this.counterJob = null
    }
    if (!c || !item) return abort()
    if (!job.moved) {
      const expected = job.kind === 'take' ? c.state === 'waiting' && item.status === 'withCustomer' : c.state === 'waitingForCollection' && this.conveyor.isReady(item.id)
      if (!expected || this.dialogue?.customerId === c.id) return abort()
    }
    job.t += dt
    const progress = job.t / duration
    if (job.kind === 'take') {
      if (!job.moved && progress >= 0.4) {
        item.status = 'withArm'
        job.moved = true
      }
      if (progress >= 1 && job.lockerId) {
        this.conveyor.load(item.id, job.lockerId)
        item.status = 'onConveyor'
        this.counterJob = null
        this.finishDeposit(c)
      }
      return
    }
    if (!job.moved && progress >= 0.35) {
      if (!this.conveyor.takeReadyFor(item.id)) return abort()
      item.status = 'withArm'
      job.moved = true
    }
    if (progress >= 1) {
      this.counterJob = null
      if (c.state === 'waitingForCollection') this.customers.transition(c.id, 'collecting')
      c.visit.greeted = true
      this.finishReturn(c, item, null)
    }
  }

  /** Turn what happened in the warehouse into money, reputation and messages. */
  private handleWarehouseEvents(events: WarehouseEvent[]): void {
    const w = CONFIG.warehouse
    const label = (c: CargoType) => w.cargo[c].label.toLowerCase()
    for (const e of events) {
      if (e.type === 'arrived') {
        const auto = this.warehouse.autoLevel > 0
        const text =
          e.job === 'deliver'
            ? `${e.owner} parked by the warehouse with ${e.crates} crates of ${label(e.declared)}${auto ? '.' : ': carry them in.'}`
            : `${e.owner} parked by the warehouse to collect ${e.crates} crates${auto ? '.' : ': carry them out to the truck.'}`
        this.notify({ type: 'message', text })
      } else if (e.type === 'stored') {
        if (this.warehouse.autoLevel === 0) continue
        this.notify({ type: 'message', text: `The robots have put away ${e.owner.split(' (')[0]}'s ${e.crates} crate${e.crates === 1 ? '' : 's'}.` })
      } else if (e.type === 'refused') {
        if (e.vip) this.economy.adjustReputation(w.vipTurnedAwayReputation)
        else if (e.gaveUp) this.economy.adjustReputation(w.turnedAwayReputation)
        this.notify(
          e.gaveUp
            ? { type: 'alert', text: `${e.owner} waited too long and drove off with ${e.crates} crate${e.crates === 1 ? '' : 's'}.` }
            : { type: 'message', text: `${e.owner}'s load was sent back.` },
        )
      } else if (e.type === 'collected') {
        this.economy.earn(e.paid)
        this.economy.adjustReputation(e.spoiled ? -1 : e.vip ? 1 : 0)
        if (e.paid > 0) this.notify({ type: 'payment', amount: e.paid })
        this.notify(
          e.spoiled
            ? { type: 'alert', text: `${e.owner} collected ${e.crates} crates of spoiled goods and paid nothing.` }
            : { type: 'message', text: `${e.owner} collected ${e.crates} crates and paid $${e.paid}.` },
        )
      } else if (e.type === 'spoiled') {
        this.notify({ type: 'alert', text: `${e.owner}'s ${e.crates} crates of ${label(e.cargo)} have gone off.` })
      } else if (e.type === 'stolen') {
        this.economy.adjustReputation(w.theft.reputation)
        this.notify({ type: 'alert', text: `Thieves took ${e.crates} crate${e.crates === 1 ? '' : 's'} of ${e.owner}'s special metals from the open shelves.` })
      } else if (e.type === 'contactArrived') {
        this.notify(
          e.job === 'drop'
            ? { type: 'alert', text: `A man called ${e.name} is waiting by the warehouse door with ${e.crates} unmarked crates. He wants them kept, no questions asked.` }
            : { type: 'alert', text: `${e.name} is back by the warehouse door for his ${e.crates} crate${e.crates === 1 ? '' : 's'}.` },
        )
      } else if (e.type === 'contactLeft') {
        if (e.reason === 'seized') this.economy.adjustReputation(-3)
        this.notify(
          e.reason === 'ignored'
            ? { type: 'message', text: `${e.name} got no answer and left with his crates.` }
            : e.reason === 'impatient'
              ? { type: 'message', text: `${e.name} gave up waiting and left with ${e.crates} crate${e.crates === 1 ? '' : 's'}.` }
              : { type: 'alert', text: `${e.name} came for his crates, but the police have them. He leaves without a word.` },
        )
      } else if (e.type === 'policeArrived') {
        this.notify({ type: 'alert', text: 'Police are at the gate: a routine inspection of the warehouse.' })
      } else {
        const p = w.police
        if (e.fine > 0) this.economy.spend(e.fine)
        this.economy.adjustReputation(e.illegalFound ? p.illegalReputation : e.metalsFined ? p.metalsReputation : p.cleanReputation)
        const found = [
          e.illegalFound ? `contraband found and seized (${e.seizedCrates} crates)` : '',
          e.metalsFined ? 'special metals without a licence' : '',
        ].filter(Boolean)
        this.notify(
          found.length > 0
            ? { type: 'alert', text: `The police fined you $${e.fine}: ${found.join('; ')}.` }
            : { type: 'message', text: 'The police found nothing and left. Your name is good.' },
        )
      }
    }
  }

  // ------------------------------------------------------------------ the receiving desk and warehouse upgrades

  openReceiving(): ActionResult {
    if (!this.hasWarehouse) return fail('There is no warehouse yet.')
    if (this.dialogue) return fail('Finish talking first.')
    this.receivingOpen = true
    return ok()
  }

  closeReceiving(): void {
    this.receivingOpen = false
  }

  /** The loads parked beside the warehouse as you see them: what each looks like (not necessarily what it is), and how much is still on the truck. */
  receivingLoads(): ReceivingLoad[] {
    const wh = this.warehouse
    return wh.loads.map((l) => {
      const visible = wh.visibleCargo(l)
      return {
        id: l.id,
        owner: l.owner,
        crates: l.crates,
        onTruck: l.crates - l.taken,
        looksLike: visible,
        known: l.inspected || wh.scanner,
        declared: l.declared,
        opening: l.inspectDone !== null,
        spoiled: l.spoiled,
        vip: l.kind === 'vip',
        goesTo: wh.placeFor(visible, 1),
      }
    })
  }

  /** At the receiving desk: open a crate of a parked load to see what is really inside, or send the load back before it is unloaded. */
  receive(loadId: number, action: 'inspect' | 'refuse'): ActionResult {
    if (!this.hasWarehouse) return fail('There is no warehouse yet.')
    const wh = this.warehouse
    const load = wh.loads.find((l) => l.id === loadId)
    if (!load) return fail('That load has gone.')
    if (action === 'inspect') {
      if (load.inspected || wh.scanner) return fail('You already know what is in it.')
      return wh.inspect(loadId, this.now) ? ok('Opening a crate…') : fail('They are already opening one.')
    }
    if (load.taken > 0) return fail('Some of it is already unloaded: you cannot send it back now.')
    const refused = wh.refuse(loadId, this.deals)
    if (!refused) return fail('That load has gone.')
    if (refused.kind === 'vip') this.economy.adjustReputation(CONFIG.warehouse.vipTurnedAwayReputation)
    return ok(`You sent ${refused.owner}'s load back.`)
  }

  // ------------------------------------------------------------------ carrying crates

  /** Take a crate off a parked delivery truck. */
  takeCrateFromTruck(truckId: number): ActionResult {
    if (this.hands) return fail('Your hands are full.')
    const r = this.warehouse.takeFromTruck(truckId, this.now)
    if (r.ok) this.hands = { kind: 'crate' }
    return r.ok ? ok(r.message) : fail(r.message)
  }

  /** Store the crate you are carrying on the shelves or in a room. */
  storeCrate(section: Section): ActionResult {
    if (this.hands?.kind !== 'crate') return fail('You are not carrying a crate.')
    const r = this.warehouse.storeCarried(section, this.deals)
    if (r.ok) this.hands = null
    return r.ok ? ok(r.message) : fail(r.message)
  }

  /** Take a crate out of a section for the collection truck that is waiting for it. */
  takeCrateFrom(section: Section): ActionResult {
    if (this.hands) return fail('Your hands are full.')
    const r = this.warehouse.takeForCollection(section)
    if (r.ok) this.hands = { kind: 'crate' }
    return r.ok ? ok(r.message) : fail(r.message)
  }

  /** Put the crate you are carrying onto its owner's collection truck. */
  loadCrate(truckId: number): ActionResult {
    if (this.hands?.kind !== 'crate') return fail('You are not carrying a crate.')
    const events: WarehouseEvent[] = []
    const r = this.warehouse.loadCarried(truckId, events)
    if (r.ok) this.hands = null
    this.handleWarehouseEvents(events)
    return r.ok ? ok(r.message) : fail(r.message)
  }

  /** The sliding hatch over the underground vault is open (you open and close it yourself). */
  vaultHatchOpen = false

  toggleVaultHatch(): ActionResult {
    if (!this.hasWarehouse || this.warehouse.sectionCapacity('hidden') <= 0) return fail('There is no hatch here.')
    this.vaultHatchOpen = !this.vaultHatchOpen
    return ok(this.vaultHatchOpen ? 'You slide the hatch open.' : 'You slide the hatch shut. The mat hides it.')
  }

  /** Say yes to the contact by the warehouse door. */
  agreeContact(): ActionResult {
    if (!this.hasWarehouse) return fail('There is no warehouse yet.')
    const r = this.warehouse.agreeContact()
    return r.ok ? ok(r.message) : fail(r.message)
  }

  /** Take one of the contact's crates from him. */
  takeCrateFromContact(): ActionResult {
    if (this.hands) return fail('Your hands are full.')
    const r = this.warehouse.takeFromContact(this.now)
    if (r.ok) this.hands = { kind: 'crate' }
    return r.ok ? ok(r.message) : fail(r.message)
  }

  /** Hand one of his crates back to the contact. */
  giveCrateToContact(): ActionResult {
    if (this.hands?.kind !== 'crate') return fail('You are not carrying a crate.')
    const events: WarehouseEvent[] = []
    const r = this.warehouse.giveToContact(events)
    if (r.ok) this.hands = null
    this.handleWarehouseEvents(events)
    return r.ok ? ok(r.message) : fail(r.message)
  }

  /** What the crate in your hands is, in words (for the HUD). */
  carryingLabel(): string | null {
    const c = this.warehouse.carrying
    if (!c) return null
    if (c.kind === 'contra') return `${c.owner}'s unmarked crate`
    const what = this.warehouse.scanner || this.warehouse.loads.find((l) => l.id === c.loadId)?.inspected ? CONFIG.warehouse.cargo[c.cargo].label : 'crate'
    return `${c.owner.split(' (')[0]}'s ${what.toLowerCase()}${c.spoiled ? ' (spoiled)' : ''}`
  }

  private warehouseItems(): CatalogueItem[] {
    return WAREHOUSE_UPGRADES.map((def) => ({ id: def.id, title: def.title, description: def.description, cost: def.cost, level: def.level, ...this.warehouseState(def.id) }))
  }

  private warehouseState(id: string): { state: CatalogueItem['state']; note: string | null } {
    const def = WAREHOUSE_UPGRADES.find((d) => d.id === id)
    if (!def) return { state: 'locked', note: 'Unknown' }
    if (this.warehouse.has(id)) return { state: 'owned', note: 'Owned' }
    const locked = (note: string) => ({ state: 'locked' as const, note })
    if (!this.hasWarehouse) return locked('Needs the warehouse')
    if (def.requires && !this.warehouse.has(def.requires)) return locked(`Buy ${WAREHOUSE_UPGRADES.find((d) => d.id === def.requires)?.title ?? def.requires} first`)
    if (this.economy.level.level < def.level) return locked(`Needs level ${def.level}`)
    if (this.economy.money < def.cost) return { state: 'tooExpensive', note: `Costs $${def.cost}, you have $${this.economy.money}` }
    return { state: 'available', note: null }
  }

  private buyWarehouseUpgrade(id: string): ActionResult {
    const def = WAREHOUSE_UPGRADES.find((d) => d.id === id)
    if (!def) return fail('Not sold here.')
    const status = this.warehouseState(id)
    if (status.state !== 'available') return fail(status.note ?? 'Not available.')
    this.economy.spend(def.cost)
    this.warehouse.applyUpgrade(id)
    this.notify({ type: 'upgradeBought', id, kind: 'warehouseUpgrade', index: 0, title: def.title })
    return ok(`${def.title}: ${def.description}.`)
  }

  /** Mod menu: a warehouse upgrade for free, after what it needs. */
  private grantWarehouseUpgrade(id: string): ActionResult {
    const def = WAREHOUSE_UPGRADES.find((d) => d.id === id)
    if (!def) return fail('Not sold here.')
    if (this.warehouse.has(id)) return fail(`${def.title} is already owned.`)
    if (!this.hasWarehouse) this.grantUpgrade('warehouse')
    if (def.requires && !this.warehouse.has(def.requires)) this.grantUpgrade(def.requires)
    this.warehouse.applyUpgrade(id)
    this.notify({ type: 'upgradeBought', id, kind: 'warehouseUpgrade', index: 0, title: def.title })
    return ok(`Unlocked ${def.title}.`)
  }

  /** The warehouse (door, road and trucks) is built. */
  get hasWarehouse(): boolean {
    return this.upgrades.has('warehouse')
  }

  /** Sit down with the VIP at the deal desk. */
  openDeal(): ActionResult {
    if (!this.hasOffice) return fail('There is no deal office yet.')
    if (this.dialogue) return fail('Finish talking first.')
    if (!this.deals.offer) {
      return fail(this.economy.reputation < CONFIG.deals.minReputation ? 'Nobody important comes to a shop with a name like yours yet. Build your reputation.' : 'No VIP is waiting. They will come.')
    }
    if (this.now < this.deals.offer.readyAt) return fail('Their car is still pulling up outside. Give them a moment.')
    this.dealOpen = true
    return ok()
  }

  closeDeal(): void {
    this.dealOpen = false
  }

  /** What you can say to the VIP at the desk. */
  dealOptions(): { id: 'accept' | 'haggle' | 'decline'; label: string; disabled: string | null }[] {
    const o = this.deals.offer
    return [
      { id: 'accept', label: o ? `Sign: $${o.retainer} retainer now` : 'Sign', disabled: o ? null : 'Nobody is waiting.' },
      { id: 'haggle', label: 'Push for more money (they may walk)', disabled: !o ? 'Nobody is waiting.' : o.haggled ? 'Already pushed once.' : null },
      { id: 'decline', label: 'Not interested', disabled: o ? null : 'Nobody is waiting.' },
    ]
  }

  chooseDeal(id: 'accept' | 'haggle' | 'decline'): ActionResult {
    const o = this.deals.offer
    if (!o) {
      this.dealOpen = false
      return fail('They have gone.')
    }
    if (id === 'accept') {
      const deal = this.deals.accept(this.now, this.rand)
      if (!deal) return fail('They have gone.')
      this.economy.earn(deal.retainer)
      this.gainXp(CONFIG.deals.signingXp)
      this.economy.adjustReputation(CONFIG.deals.signingReputation)
      this.dealOpen = false
      return ok(`Signed with ${deal.name}: $${deal.retainer} retainer, ${deal.crates} crates of ${deal.cargo} once the warehouse opens.`)
    }
    if (id === 'haggle') {
      const result = this.deals.haggle(this.now, this.rand)
      if (result === null) return fail('Already pushed once.')
      if (result === 'walked') {
        this.economy.adjustReputation(CONFIG.deals.haggleWalkReputation)
        this.dealOpen = false
        return fail(`${o.name} did not like being pushed, and walked out.`)
      }
      return ok(`${o.name} raises the retainer to $${this.deals.offer?.retainer}.`)
    }
    this.deals.decline(this.now, this.rand)
    this.dealOpen = false
    return ok(`You turned ${o.name} down politely.`)
  }

  /** The offer waiting at the desk, if any. */
  get offer(): Offer | null {
    return this.deals.offer
  }

  /** Whether the shop has grown into the unit next door (building expansion). */
  hasAnnex(side?: 'west' | 'east'): boolean {
    if (side) return this.upgrades.has(side === 'west' ? 'annexWest' : 'annexEast')
    return this.upgrades.has('annexWest') || this.upgrades.has('annexEast')
  }

  /** Whether the south expansion or a floor has been built. */
  hasHall(kind: 'south' | 'floor1' | 'floor2'): boolean {
    return this.upgrades.has(kind === 'south' ? 'southExpansion' : kind)
  }

  /** HUD label: basic → organised (labels or register) → expanded (an annex, the south hall or a floor). */
  facilityLabel(): string {
    if (this.hasConveyor) return 'Automated facility'
    if (this.isDigital) return 'Digital facility'
    if (this.hasAnnex() || this.hasHall('south')) return 'Expanded facility'
    return this.hasLabels || this.upgrades.has('register') ? 'Organised facility' : 'Basic facility'
  }

  /**
   * The deposit register board: every bag currently sitting in a locker, oldest first. Empty until the board
   * is bought. It updates itself as you store and collect, so you no longer have to remember who is where.
   */
  registerEntries(): RegisterEntry[] {
    if (!this.upgrades.has('register')) return []
    const rows: (RegisterEntry & { at: number })[] = []
    for (const c of this.customers.all()) {
      const item = this.customers.itemOf(c)
      if (!item || item.status !== 'inLocker' || !item.lockerId) continue
      rows.push({
        customerId: c.id,
        name: c.nameTaken ? c.name : null,
        lockerNumber: this.lockers.get(item.lockerId).number,
        itemLabel: item.label,
        at: item.depositedAt ?? 0,
      })
    }
    return rows.sort((a, b) => a.at - b.at).map(({ at: _at, ...entry }) => entry)
  }

  /**
   * Why you cannot tell the customer "it is stored" yet, or null if you can. The bag must be in a locker whose
   * door is shut and whose key is out of the lock: a locker left open with its key in it has nothing to remember.
   */
  private storedBlocker(item: Item | null): string | null {
    if (item?.status === 'onConveyor') return 'The belt is still carrying it.'
    if (item?.status !== 'inLocker' || !item.lockerId) return this.hasConveyor ? 'Put it on the conveyor first.' : 'Store it in a locker first.'
    const locker = this.lockers.get(item.lockerId)
    if (locker.doorOpen) return 'Close the locker door first.'
    // With digital lockers the door locks itself when it shuts, so there is no key to take.
    if (!locker.locked) return this.isDigital ? 'Close the locker door first.' : 'Take the key out of the lock to lock it.'
    return null
  }

  catalogueItems(): CatalogueItem[] {
    return this.upgrades.items(this.economy.level.level, this.economy.money)
  }

  /** Buy an upgrade: pay, then apply it (new lockers and keys, or more hooks). */
  buyUpgrade(id: string): ActionResult {
    const def = this.upgrades.def(id)
    if (!def) return fail('Not in the catalogue.')
    const status = this.upgrades.state(def, this.economy.level.level, this.economy.money)
    if (status.state !== 'available') return fail(status.note ?? 'Not available.')
    this.economy.spend(def.cost)
    this.applyUpgrade(def)
    return ok(`Bought ${def.title}: ${def.description}.`)
  }

  /**
   * Mod menu: get an upgrade for free, ignoring level and cost, after first granting anything it requires.
   * It goes through the same code as a purchase, so banks, racks and annexes appear exactly as if bought.
   */
  grantUpgrade(id: string): ActionResult {
    const auto = AUTOMATION_UPGRADES.find((d) => d.id === id)
    if (auto) return this.grantAutomation(auto)
    const wh = WAREHOUSE_UPGRADES.find((d) => d.id === id)
    if (wh) return this.grantWarehouseUpgrade(wh.id)
    const def = this.upgrades.def(id)
    if (!def) return fail('Not in the catalogue.')
    if (this.upgrades.has(id)) return fail(`${def.title} is already owned.`)
    if (def.requires && !this.upgrades.has(def.requires)) this.grantUpgrade(def.requires)
    this.applyUpgrade(def)
    return ok(`Unlocked ${def.title}.`)
  }

  /** Apply an upgrade's effect to the records and tell the 3D side what to build. */
  private applyUpgrade(def: UpgradeDef): void {
    this.upgrades.markOwned(def.id)
    if (def.kind === 'lockerBank') {
      const added = this.lockers.addBank(CONFIG.facility.lockerRows, CONFIG.facility.lockerCols)
      for (const locker of added) this.keys.addKey(locker.id, locker.keyId)
      this.bankInfo.set(this.lockers.bankCount - 1, { zone: 'main', row: 0 })
      this.notify({ type: 'upgradeBought', id: def.id, kind: def.kind, index: this.lockers.bankCount - 1, title: def.title })
    } else if (def.kind === 'keyRack') {
      this.keys.addHooks(CONFIG.facility.hooksPerRack)
      this.notify({ type: 'upgradeBought', id: def.id, kind: def.kind, index: this.keys.hookCount / CONFIG.facility.hooksPerRack - 1, title: def.title })
    } else if (def.kind === 'annex' || def.kind === 'hall') {
      // A new hall: its banks and racks are ordinary records, the 3D side builds the room around them.
      const banks: number[] = []
      for (let i = 0; i < (def.banks ?? 0); i++) {
        const added = this.lockers.addBank(CONFIG.facility.lockerRows, CONFIG.facility.lockerCols)
        for (const locker of added) this.keys.addKey(locker.id, locker.keyId)
        banks.push(this.lockers.bankCount - 1)
        // Halls have rows of three banks; the annex is a single row.
        const zone: AutoZone = def.kind === 'annex' ? 'east' : (def.hall ?? 'south')
        this.bankInfo.set(this.lockers.bankCount - 1, { zone, row: def.kind === 'annex' ? 0 : Math.floor(i / 3) })
      }
      const racks: number[] = []
      for (let i = 0; i < (def.racks ?? 0); i++) {
        this.keys.addHooks(CONFIG.facility.hooksPerRack)
        racks.push(this.keys.hookCount / CONFIG.facility.hooksPerRack - 1)
      }
      this.notify({ type: 'upgradeBought', id: def.id, kind: def.kind, index: 0, title: def.title, side: def.side, hall: def.hall, banks, racks })
    } else if (def.kind === 'warehouse') {
      this.warehouse.start(this.now)
      this.notify({ type: 'upgradeBought', id: def.id, kind: def.kind, index: 0, title: def.title })
    } else if (def.kind === 'office') {
      this.deals.start(this.now)
      this.notify({ type: 'upgradeBought', id: def.id, kind: def.kind, index: 0, title: def.title })
    } else if (def.kind === 'conveyor') {
      this.conveyor.cover('main')
      this.notify({ type: 'upgradeBought', id: def.id, kind: def.kind, index: 0, title: def.title, zone: 'main' })
    } else if (def.kind === 'digital') {
      this.goDigital()
      this.notify({ type: 'upgradeBought', id: def.id, kind: def.kind, index: 0, title: def.title })
    } else {
      // labels / register / conveyor: no new records; the 3D views react to `upgrades.has(...)`.
      this.notify({ type: 'upgradeBought', id: def.id, kind: def.kind, index: 0, title: def.title })
    }
  }

  /**
   * Scrap the keys. Every key goes back into its lock (and out of the player's hand), and every locker's lock matches what it
   * holds: a shut locker with a bag is locked, anything else is not.
   */
  private goDigital(): void {
    for (const key of this.keys.all()) this.keys.move(key.id, { kind: 'inLock' })
    if (this.hands?.kind === 'key') this.hands = null
    for (const locker of this.lockers.all()) locker.locked = locker.itemId !== null && !locker.doorOpen
  }

  // ------------------------------------------------------------------ mod menu hooks (see mods.ts)

  /** XP with all the usual level-up bonuses and banners. */
  grantXp(amount: number): void {
    this.gainXp(amount)
  }

  /** Add a customer right now, outside the traffic plan (they do not count towards finishing a stage). */
  spawnExtraCustomer(): CustomerId {
    const stage = this.scheduler.stage
    const { customer, item } = this.factory.customer({
      patience: stage.patience,
      fee: CONFIG.economy.depositFee,
      satisfaction: CONFIG.customer.startingSatisfaction,
      avoid: this.labelsInUse(),
    })
    this.customers.add(customer, item)
    this.notify({ type: 'customerSpawned', customerId: customer.id })
    return customer.id
  }

  /** Jump to the next traffic stage. Returns false when already on the last. */
  skipStage(): boolean {
    this.clock.removeWhere((e) => e.type === 'nextArrival') // the old stage's pending arrival
    const moved = this.scheduler.skipStage()
    if (moved) {
      this.tutorialComplete = true
      const stage = this.scheduler.stage
      this.notify({ type: 'stageStarted', title: stage.title, text: stage.intro })
    }
    this.scheduleNextArrival()
    return moved
  }

  /** Make every stored customer come back in a second. Returns how many. */
  callBackStoredCustomers(): number {
    const at = this.now + 1
    const moved = this.clock.retimeWhere((e) => e.type === 'customerReturn', at)
    for (const c of this.customers.all()) if (c.state === 'stored') c.expectedReturnAt = at
    return moved
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
    if (locker.state === 'reserved') return fail('The robot arm is using this locker.')
    if (locker.locked) {
      if (!this.isDigital) return fail('Locked. You need its key from the key board.')
      this.lockers.setLocked(id, false) // the electronic lock lets staff in
    }
    this.lockers.open(id)
    return ok()
  }

  closeLocker(id: LockerId): ActionResult {
    const locker = this.lockers.get(id)
    if (!locker.doorOpen) return fail('It is already shut.')
    if (locker.state === 'reserved') return fail('The robot arm is using this locker.')
    this.lockers.close(id)
    if (this.isDigital && locker.itemId) this.lockers.setLocked(id, true) // the electronic lock engages by itself
    return ok(this.isDigital && locker.itemId ? 'Locked.' : null)
  }

  putItem(id: LockerId): ActionResult {
    const locker = this.lockers.get(id)
    if (this.hands?.kind !== 'item') return fail('You are not carrying an item.')
    if (!locker.doorOpen) return fail('Open the door first.')
    if (locker.itemId) return fail('This locker is already in use.')
    if (locker.state === 'reserved') return fail('The robot arm has reserved this locker.')
    const item = this.customers.item(this.hands.itemId)
    this.lockers.put(id, item.id)
    item.status = 'inLocker'
    item.lockerId = id
    item.depositedAt ??= this.now
    this.customers.get(item.customerId).lockerId = id
    this.hands = null
    return ok(this.isDigital ? `Stored the ${item.label}. Close the door.` : `Stored the ${item.label}. Close the door and take the key.`)
  }

  takeItem(id: LockerId): ActionResult {
    const locker = this.lockers.get(id)
    if (this.hands) return fail('Your hands are full.')
    if (!locker.doorOpen) return fail('Open the door first.')
    if (!locker.itemId) return fail('It is empty.')
    if (locker.state === 'reserved') return fail('The robot arm is fetching this one.')
    const item = this.customers.item(this.lockers.take(id))
    item.status = 'heldByPlayer'
    item.lockerId = null
    this.customers.get(item.customerId).lockerId = null
    this.hands = { kind: 'item', itemId: item.id }
    // Pulling out a bag nobody here is waiting for, while people stand watching, is rummaging: they notice.
    const waiting = this.queue().filter((c) => RETURN_VISIT.has(c.state))
    if (waiting.length > 0 && !waiting.some((c) => c.id === item.customerId)) {
      for (const c of waiting) c.satisfaction = Math.max(0, c.satisfaction + CONFIG.wrongItem.rummageSatisfaction)
      this.economy.mistakes += 1
      const message = `The ${item.label} is nobody's here. The customers are watching you rummage…`
      this.notify({ type: 'mistake', kind: 'wrongItem', message })
      return { ok: true, message }
    }
    return ok(`You took the ${item.label}.`)
  }

  /** Pull the key out of a shut locker's lock. This locks it. */
  takeKeyFromLock(id: LockerId): ActionResult {
    if (this.isDigital) return fail('There are no keys any more.')
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
    if (this.isDigital) return fail('There are no keys any more.')
    if (this.hands?.kind !== 'key') return fail('You are not holding a key.')
    if (this.keys.onHook(hook)) return fail('That hook is taken.')
    this.keys.move(this.hands.keyId, { kind: 'hook', hook })
    this.hands = null
    return ok()
  }

  takeKeyFromHook(hook: number): ActionResult {
    if (this.isDigital) return fail('There are no keys any more.')
    const busy = this.busy()
    if (busy) return busy
    const key = this.keys.onHook(hook)
    if (!key) return fail('Nothing on this hook.')
    if (this.hands) return fail('Your hands are full.')
    this.keys.move(key.id, { kind: 'player' })
    this.hands = { kind: 'key', keyId: key.id }
    return ok()
  }

  // ------------------------------------------------------------------ automation consoles

  /** Open the console for `scope` (the hub control console, or a zone's arm console). */
  openConsole(scope: 'hub' | 'warehouse' | AutoZone): ActionResult {
    if (scope === 'warehouse' ? !this.hasWarehouse : !this.hasConveyor) return fail(scope === 'warehouse' ? 'There is no warehouse yet.' : 'There is no conveyor yet.')
    if (this.dialogue) return fail('Finish talking first.')
    this.consoleScope = scope
    return ok()
  }

  closeConsole(): void {
    this.consoleScope = null
  }

  /** What a console sells, in order, with whether each can be bought now and why not. */
  consoleItems(scope: 'hub' | 'warehouse' | AutoZone): CatalogueItem[] {
    if (scope === 'warehouse') return this.warehouseItems()
    const upgrades = AUTOMATION_UPGRADES.filter((d) => d.scope === scope).map((def) => ({
      id: def.id,
      title: def.title,
      description: def.description,
      cost: def.cost,
      level: def.level,
      ...this.automationState(def),
    }))
    return scope === 'hub' ? upgrades : [...this.maintenanceItems(scope), ...upgrades]
  }

  /** Cost of servicing every arm of `zone` (by how worn they are), and of repairing its jammed ones. */
  serviceCost(zone: AutoZone): number {
    const m = CONFIG.automation.maintenance
    const missing = this.conveyor.zoneArms(zone).reduce((n, h) => n + (h.jammed ? 0 : 100 - h.condition), 0)
    return Math.ceil((missing / 100) * m.serviceCostPerArm)
  }

  repairCost(zone: AutoZone): number {
    return this.conveyor.jammedCount(zone) * CONFIG.automation.maintenance.repairCostPerArm
  }

  /** Routine service and repair for a zone's arms, shown at the top of its console. */
  private maintenanceItems(zone: AutoZone): CatalogueItem[] {
    const level = this.economy.level.level
    const jammed = this.conveyor.jammedCount(zone)
    const condition = Math.round(this.conveyor.zoneCondition(zone))
    const service = this.serviceCost(zone)
    const repair = this.repairCost(zone)
    const pick = (cost: number, blocked: string | null): Pick<CatalogueItem, 'state' | 'note'> =>
      blocked
        ? { state: 'locked', note: blocked }
        : this.economy.money < cost
          ? { state: 'tooExpensive', note: `Costs $${cost}, you have $${this.economy.money}` }
          : { state: 'available', note: null }
    return [
      {
        id: `service-${zone}`,
        title: 'Routine service',
        description: `Check and oil every arm: back to 100 %. Worst arm now: ${condition} %. Worn arms are slower, failing ones can jam.`,
        cost: service,
        level,
        ...pick(service, jammed > 0 ? 'Repair the jammed arm first' : service === 0 ? 'Already in perfect condition' : null),
      },
      {
        id: `repair-${zone}`,
        title: 'Repair jammed arm',
        description: jammed > 0 ? `${jammed} arm${jammed > 1 ? 's are' : ' is'} stuck. A repair frees ${jammed > 1 ? 'them' : 'it'} but leaves ${jammed > 1 ? 'them' : 'it'} half-fit.` : 'Frees a jammed arm (it stays half-fit until serviced).',
        cost: repair,
        level,
        ...pick(repair, jammed === 0 ? 'Nothing is jammed' : null),
      },
    ]
  }

  private automationState(def: AutomationUpgradeDef): { state: CatalogueItem['state']; note: string | null } {
    if (this.upgrades.has(def.id)) return { state: 'owned', note: 'Owned' }
    const locked = (note: string) => ({ state: 'locked' as const, note })
    if (!this.hasConveyor) return locked('Needs the conveyor')
    if (def.kind !== 'line' && !this.conveyor.isCovered(def.zone)) return locked(`Extend the belt to the ${ZONE_TITLES[def.zone]} first`)
    if (def.needs && !this.upgrades.has(def.needs)) return locked(`Buy ${this.upgrades.def(def.needs)?.title ?? def.needs} first`)
    if (def.requires && !this.upgrades.has(def.requires)) {
      const first = AUTOMATION_UPGRADES.find((d) => d.id === def.requires)
      return locked(`Buy ${first?.title ?? def.requires} first`)
    }
    if (this.economy.level.level < def.level) return locked(`Needs level ${def.level}`)
    if (this.economy.money < def.cost) return { state: 'tooExpensive', note: `Costs $${def.cost}, you have $${this.economy.money}` }
    return { state: 'available', note: null }
  }

  /** Buy an automation upgrade at its console. */
  buyAutomation(id: string): ActionResult {
    if (id.startsWith('wh-')) return this.buyWarehouseUpgrade(id)
    const maintenance = /^(service|repair)-(main|east|south|floor1|floor2)$/.exec(id)
    if (maintenance) return this.maintain(maintenance[1] === 'service' ? 'service' : 'repair', maintenance[2] as AutoZone)
    const def = AUTOMATION_UPGRADES.find((d) => d.id === id)
    if (!def) return fail('Not sold here.')
    const status = this.automationState(def)
    if (status.state !== 'available') return fail(status.note ?? 'Not available.')
    this.economy.spend(def.cost)
    this.applyAutomation(def)
    return ok(`${def.title}: ${def.description}.`)
  }

  /** Service or repair the arms of `zone`, paying at its console. */
  private maintain(kind: 'service' | 'repair', zone: AutoZone): ActionResult {
    const item = this.maintenanceItems(zone).find((i) => i.id === `${kind}-${zone}`)
    if (!item || item.state !== 'available') return fail(item?.note ?? 'Not available.')
    this.economy.spend(item.cost)
    if (kind === 'service') this.conveyor.service(zone)
    else this.conveyor.repair(zone)
    return ok(kind === 'service' ? `Serviced the arms in the ${ZONE_TITLES[zone]}: as good as new.` : `Repaired the arm in the ${ZONE_TITLES[zone]}. It is only half-fit: service it soon.`)
  }

  /** Mod menu: an automation upgrade for free, after whatever it needs. */
  private grantAutomation(def: AutomationUpgradeDef): ActionResult {
    if (this.upgrades.has(def.id)) return fail(`${def.title} is already owned.`)
    if (!this.hasConveyor) this.grantUpgrade('conveyor')
    if (def.needs && !this.upgrades.has(def.needs)) this.grantUpgrade(def.needs)
    if (def.kind !== 'line' && !this.conveyor.isCovered(def.zone)) this.grantUpgrade(`line-${def.zone}`)
    if (def.requires && !this.upgrades.has(def.requires)) this.grantUpgrade(def.requires)
    this.applyAutomation(def)
    return ok(`Unlocked ${def.title}.`)
  }

  private applyAutomation(def: AutomationUpgradeDef): void {
    this.upgrades.markOwned(def.id)
    if (def.kind === 'line') this.conveyor.cover(def.zone)
    else if (def.kind === 'speed') this.conveyor.setSpeedLevel(def.zone, def.tier)
    else if (def.kind === 'arms') this.conveyor.setArmCount(def.zone, 2)
    // (the counter arm is just owning the upgrade: see `hasCounterArm`)
    this.notify({ type: 'upgradeBought', id: def.id, kind: 'automation', index: 0, title: def.title, zone: def.zone })
  }

  // ------------------------------------------------------------------ conveyor and robot arm

  /** Which part of the building a locker is in. */
  zoneOf(lockerId: LockerId): AutoZone {
    return this.bankInfo.get(this.lockers.get(lockerId).bank)?.zone ?? 'main'
  }

  /** Which row of lockers (arm station) it is in, within its zone. */
  rowOf(lockerId: LockerId): number {
    return this.bankInfo.get(this.lockers.get(lockerId).bank)?.row ?? 0
  }

  /** Lockers the robot arms can reach: those in a zone the belts have been extended to. */
  isRobotLocker(id: LockerId): boolean {
    return this.hasConveyor && this.conveyor.isCovered(this.zoneOf(id))
  }

  /** Free lockers the arms could file a bag in right now. */
  robotLockersFree(): number {
    return this.lockers.all().filter((l) => l.state === 'available' && this.isRobotLocker(l.id)).length
  }

  /** Put the bag in your hands on the loading belt. The robot arm picks the locker (the lowest free number). */
  loadConveyor(): ActionResult {
    if (!this.hasConveyor) return fail('There is no conveyor yet.')
    if (this.hands?.kind !== 'item') return fail('You are not carrying a bag.')
    const cfg = CONFIG.automation
    const inbound = this.conveyor.inbound()
    if (inbound.length >= cfg.beltCapacity) return fail('The belt is full. Give it a moment.')
    if (inbound.some((p) => p.phase === 'beltIn' && p.t < cfg.loadGap)) return fail('Wait for the last bag to move along.')
    const locker = this.lockers
      .all()
      .find((l) => l.state === 'available' && this.isRobotLocker(l.id) && !l.itemId && !this.conveyor.isBusy(l.id))
    if (!locker) return fail('No free locker the robot arm can reach. Store it by hand, or extend the belts.')
    const item = this.customers.item(this.hands.itemId)
    locker.state = 'reserved'
    item.status = 'onConveyor'
    this.hands = null
    this.conveyor.load(item.id, locker.id)
    // The belt takes it from here: the customer does not need to be told, and leaves.
    const owner = this.customers.get(item.customerId)
    if (owner.state === 'depositing' || owner.state === 'waiting') this.finishDeposit(owner)
    return ok(`On its way to locker ${locker.number}. ${owner.name.split(' ')[0] ?? 'They'} has gone, and will be back.`)
  }

  /** Bags the terminal can ask the arm to fetch: everything stored in a locker the arm can reach. */
  terminalEntries(): TerminalEntry[] {
    const out: TerminalEntry[] = []
    for (const locker of this.lockers.all()) {
      if (!this.isRobotLocker(locker.id) || !locker.itemId) continue
      const item = this.customers.item(locker.itemId)
      const customer = this.customers.get(item.customerId)
      out.push({
        lockerId: locker.id,
        lockerNumber: locker.number,
        itemLabel: item.label,
        where: ZONE_TITLES[this.zoneOf(locker.id)],
        name: customer.nameTaken ? customer.name : null,
        fetching: this.conveyor.isBusy(locker.id),
      })
    }
    return out
  }

  openTerminal(): ActionResult {
    if (!this.hasConveyor) return fail('There is no terminal yet.')
    if (this.dialogue) return fail('Finish talking first.')
    this.terminalOpen = true
    return ok()
  }

  closeTerminal(): void {
    this.terminalOpen = false
  }

  /** Ask the robot arm to bring the bag in `lockerId` to the return tray. */
  requestBag(lockerId: LockerId): ActionResult {
    if (!this.hasConveyor) return fail('There is no conveyor yet.')
    const locker = this.lockers.get(lockerId)
    if (!this.isRobotLocker(lockerId) || !locker.itemId) return fail('There is nothing to fetch there.')
    if (locker.state === 'reserved' || this.conveyor.isBusy(lockerId)) return fail('The robot is already on it.')
    if (this.conveyor.fetchesInProgress() >= CONFIG.automation.readyCapacity) return fail('The return belt is full. Collect a bag first.')
    const item = this.customers.item(locker.itemId)
    locker.state = 'reserved'
    this.conveyor.request(item.id, lockerId)
    return ok(`Fetching the ${item.label} from locker ${locker.number}.`)
  }

  /** Pick up the oldest bag waiting on the return tray. */
  takeFromConveyor(): ActionResult {
    if (this.hands) return fail('Your hands are full.')
    const parcel = this.conveyor.takeReady()
    if (!parcel) return fail('Nothing has arrived yet.')
    const item = this.customers.item(parcel.itemId)
    item.status = 'heldByPlayer'
    this.hands = { kind: 'item', itemId: item.id }
    return ok(`You took the ${item.label}.`)
  }

  // ------------------------------------------------------------------ HUD queries

  activeDeposits(): number {
    return this.customers.all().filter((c) => {
      const item = this.customers.itemOf(c)
      return item !== null && item.status !== 'withCustomer' && item.status !== 'returned'
    }).length
  }

  /** Current objective, derived from state so it can never get out of sync. */
  objective(): string {
    const id = this.firstCustomerId
    if (!id) return 'Open for business. Your first customer is on the way.'
    if (this.tutorialComplete || !this.customers.has(id)) return this.generalObjective()
    return this.tutorialObjective(this.customers.get(id))
  }

  /** After the tutorial: point at the most useful next thing without giving away what you must remember. */
  private generalObjective(): string {
    const hands = this.hands
    if (hands?.kind === 'item') {
      const item = this.customers.item(hands.itemId)
      const owner = this.customers.get(item.customerId)
      if (RETURN_VISIT.has(owner.state)) return `Hand the ${item.label} back to its owner.`
      return this.hasConveyor ? `Put the ${item.label} on the conveyor belt.` : `Store the ${item.label} in an empty locker.`
    }
    if (hands?.kind === 'key') return 'Hang the key on the key board — or try it on a locker.'
    if (this.hasWarehouse) {
      const wh = this.warehouse
      if (hands?.kind === 'crate' && wh.carrying) {
        const truck = wh.trucks.find((t) => t.job === 'collect' && t.phase === 'parked' && t.loadId === wh.carrying?.loadId)
        return truck ? `Load the crate onto ${truck.owner}'s truck, parked outside the shutter.` : 'Store the crate: on a rack, or in the right room.'
      }
      if (wh.autoLevel === 0) {
        const collecting = wh.trucks.find((t) => t.job === 'collect' && t.phase === 'parked')
        if (collecting) return `${collecting.owner} has come to collect: carry their crates out to the truck.`
        if (wh.loads.some((l) => l.taken < l.crates && wh.truck(l.truckId)?.phase === 'parked')) return 'A truck is parked by the warehouse: carry its crates in.'
      }
    }
    if (this.deals.offer) {
      return this.now < this.deals.offer.readyAt
        ? `A car is pulling up outside: ${this.deals.offer.name} has arrived.`
        : `${this.deals.offer.name} is waiting in the deal office, off the lobby.`
    }
    const jam = this.conveyor.jammedZones()[0]
    if (jam) return `A robot arm in the ${ZONE_TITLES[jam]} has jammed. Repair it at that arm console.`
    const lockers = this.lockers.all()
    if (lockers.some((l) => l.doorOpen && l.itemId)) return 'Close the open locker.'
    if (!this.isDigital && lockers.some((l) => l.itemId && !l.locked)) return 'An occupied locker is unlocked — take its key.'
    if (this.conveyor.readyCount > 0) return 'A bag has arrived on the return belt. Pick it up.'
    const queue = this.queue()
    const toConfirm = queue.find((c) => c.state === 'depositing' && this.customers.itemOf(c)?.status === 'inLocker')
    if (toConfirm) return 'Tell the waiting customer their item is stored.'
    const collecting = queue.filter((c) => RETURN_VISIT.has(c.state))
    if (collecting.length > 0 && this.hasConveyor) {
      return collecting.length === 1 ? 'A customer is back. Ask the terminal to fetch their bag.' : `${collecting.length} customers are back. Use the terminal to fetch their bags.`
    }
    if (collecting.length > 0) {
      return collecting.length === 1
        ? 'A customer is back to collect. Which locker was theirs?'
        : `${collecting.length} customers are back to collect.`
    }
    if (queue.length > 0) return queue.length === 1 ? 'A customer is waiting at the counter.' : `${queue.length} customers are waiting.`
    const upgrade = this.catalogueItems().find((i) => i.state === 'available')
    if (upgrade) return `Quiet moment. You can afford ${upgrade.title}: browse the catalogue on the desk at the back right.`
    if (this.activeDeposits() > 0) return 'Quiet moment. Customers will be back for their things.'
    return 'Quiet moment. More customers are on their way.'
  }

  private tutorialObjective(c: Customer): string {
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
          return this.dialogue ? 'Greet them, ask their name, then accept their item. (Press E to follow the highlighted step.)' : 'Talk to the customer at the counter.'
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

/** What a customer says each time you hand them someone else's package: politer first, then angrier. */
function wrongPackageLine(tries: number, theirs: string): string {
  const lines = [
    "Um… this isn't my package.",
    "No, that's still not mine. Could you check again?",
    `Seriously? That's the wrong one again. Mine is the ${theirs}!`,
    'This is ridiculous! I want MY bag, right now!',
    'Are you even trying?! Give me my bag!',
  ]
  return lines[Math.min(tries, lines.length) - 1] ?? lines[0] ?? ''
}
