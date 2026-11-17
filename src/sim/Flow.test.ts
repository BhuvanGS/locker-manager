import { describe, expect, it } from 'vitest'
import { CONFIG } from './config'
import { GameManager } from './GameManager'
import { Driver } from './testDriver'

/** A game with the conveyor (and what it needs) and plenty of cash. */
function automated() {
  const d = new Driver()
  const g = d.game
  g.economy.xp = 1000
  g.economy.money = 10_000
  for (const id of ['labels', 'register', 'digital', 'conveyor']) expect(g.buyUpgrade(id).ok).toBe(true)
  g.drainNotices()
  return d
}

/** The next customer at the counter, greeted, named and their bag taken (the bag is in your hands). */
function takeBag(d: Driver, opts: { askName?: boolean } = {}): string {
  const g = d.game
  d.until(() => d.waiting().length >= 1)
  const id = d.waiting()[0]!
  expect(g.talkTo(id).ok).toBe(true)
  expect(g.choose('greet').ok).toBe(true)
  if (opts.askName !== false) expect(g.choose('askName').ok).toBe(true)
  expect(g.choose('accept').ok).toBe(true)
  return id
}

describe('Loading the belt finishes the deposit', () => {
  it('the customer leaves at once and their return is scheduled, with the XP, without being told', () => {
    const d = automated()
    const g = d.game
    const id = takeBag(d)
    g.closeDialogue()
    const xp = g.economy.xp
    expect(g.loadConveyor().ok).toBe(true)
    const c = g.customers.get(id)
    expect(c.state).toBe('stored')
    expect(c.expectedReturnAt).not.toBeNull()
    expect(g.economy.xp).toBeGreaterThan(xp)
    expect(g.drainNotices().some((n) => n.type === 'customerLeaving' && n.customerId === id)).toBe(true)
  })

  it('works while still in the conversation: the dialogue closes by itself', () => {
    const d = automated()
    const g = d.game
    const id = takeBag(d)
    // (In the game you cannot walk away mid-conversation, but the state must stay consistent if this ever happens.)
    expect(g.loadConveyor().ok).toBe(true)
    expect(g.dialogue).toBeNull()
    expect(g.customers.get(id).state).toBe('stored')
  })

  it('a bag filed by the arm can be fetched and handed over, by terminal or by hand', () => {
    for (const how of ['terminal', 'hand'] as const) {
      const d = automated()
      const g = d.game
      const id = takeBag(d)
      g.closeDialogue()
      expect(g.loadConveyor().ok).toBe(true)
      d.until(() => g.customers.get(id).state === 'waitingForCollection', 1000)
      const lockerId = g.customers.get(id).lockerId!
      if (how === 'terminal') {
        expect(g.requestBag(lockerId).ok).toBe(true)
        d.tick(40)
        expect(g.takeFromConveyor().ok).toBe(true)
      } else {
        expect(g.openLocker(lockerId).ok).toBe(true)
        expect(g.takeItem(lockerId).ok).toBe(true)
        expect(g.closeLocker(lockerId).ok).toBe(true)
      }
      expect(g.talkTo(id).ok).toBe(true)
      expect(g.choose('handOver').ok).toBe(true)
      expect(g.customers.get(id).state).toBe('completed')
    }
  })
})

describe('A deposit that goes wrong', () => {
  it('you can give their bag back during the deposit visit (and only if you are holding it)', () => {
    const d = automated()
    const g = d.game
    const id = takeBag(d)
    const give = () => g.dialogueOptions().find((o) => o.id === 'giveBack')!
    expect(give().disabled).toBeNull()
    const rep = g.economy.reputation
    expect(g.choose('giveBack').ok).toBe(true)
    expect(g.hands).toBeNull()
    expect(g.customers.get(id).state).toBe('leftWithoutService')
    expect(g.customers.itemOf(g.customers.get(id))?.status).toBe('returned')
    expect(g.economy.reputation).toBeLessThan(rep)
    expect(g.dialogue).toBeNull()
  })

  it('cannot give back a bag you are not holding (it is already in a locker)', () => {
    const d = new Driver()
    const g = d.game
    d.until(() => d.waiting().length >= 1)
    const id = d.waiting()[0]!
    g.talkTo(id)
    g.choose('greet')
    g.choose('accept')
    const locker = g.lockers.findAvailable()!
    g.openLocker(locker.id)
    g.putItem(locker.id)
    const give = g.dialogueOptions().find((o) => o.id === 'giveBack')!
    expect(give.disabled).toBe('You are not holding their bag.')
    expect(g.choose('giveBack').ok).toBe(false)
  })

  it('a customer whose bag is stored but never confirmed eventually leaves by themselves', () => {
    const d = new Driver()
    const g = d.game
    d.finishTutorial()
    d.until(() => d.waiting().length >= 1)
    const id = d.waiting()[0]!
    g.talkTo(id)
    g.choose('greet')
    g.choose('accept')
    const locker = g.lockers.findAvailable()!
    g.openLocker(locker.id)
    g.putItem(locker.id)
    g.closeLocker(locker.id)
    g.closeDialogue() // and walk off without telling them
    expect(g.customers.get(id).state).toBe('depositing')
    d.until(() => g.customers.get(id).state === 'stored', 600)
    expect(g.customers.get(id).satisfaction).toBeLessThan(CONFIG.customer.startingSatisfaction)
  })
})

describe('Bags look different', () => {
  it('no two bags in the shop at once share a description', () => {
    const g = new GameManager(11)
    for (let i = 0; i < 24; i++) g.spawnExtraCustomer()
    const labels = g.customers.all().map((c) => g.customers.itemOf(c)!.label)
    expect(new Set(labels).size).toBe(labels.length)
  })
})

describe('Rummaging', () => {
  it('pulling out a bag nobody is waiting for, while someone is waiting for theirs, costs everyone waiting', () => {
    const d = new Driver()
    const g = d.game
    d.finishTutorial()
    // One customer stores a bag and comes back; then another stores theirs (and is still away).
    g.spawnExtraCustomer()
    d.until(() => d.waiting().length >= 1)
    const first = d.waiting()[0]!
    d.deposit(first)
    g.callBackStoredCustomers()
    d.until(() => g.customers.get(first).state === 'waitingForCollection')
    g.spawnExtraCustomer()
    d.until(() => d.waiting().length >= 1)
    const second = d.waiting()[0]!
    d.deposit(second)
    // The first customer is waiting for their bag; the player pulls out the SECOND customer's.
    const other = g.customers.get(second)
    const waiting = g.customers.get(first)
    const before = waiting.satisfaction
    const mistakes = g.economy.mistakes
    const key = g.keys.get(g.lockers.get(other.lockerId!).keyId)
    if (key.location.kind !== 'hook') throw new Error('key not on a hook')
    g.takeKeyFromHook(key.location.hook)
    g.useKeyOn(other.lockerId!)
    const result = g.takeItem(other.lockerId!)
    expect(result.message).toMatch(/rummage/)
    expect(waiting.satisfaction).toBe(before + CONFIG.wrongItem.rummageSatisfaction)
    expect(g.economy.mistakes).toBe(mistakes + 1)
  })

  it('taking out the bag that IS wanted is free', () => {
    const d = new Driver()
    const g = d.game
    d.finishTutorial()
    g.spawnExtraCustomer()
    d.until(() => d.waiting().length >= 1)
    const id = d.waiting()[0]!
    d.deposit(id)
    g.callBackStoredCustomers()
    d.until(() => g.customers.get(id).state === 'waitingForCollection')
    const c = g.customers.get(id)
    const before = c.satisfaction
    d.collect(id)
    expect(g.economy.mistakes).toBe(0)
    expect(c.satisfaction).toBeGreaterThanOrEqual(before)
  })
})

describe('The arm owns a locker while it works on it', () => {
  it('you cannot shut (or open, fill or empty) a locker whose door the arm has opened', () => {
    const d = automated()
    const g = d.game
    takeBag(d)
    g.closeDialogue()
    expect(g.loadConveyor().ok).toBe(true)
    const lockerId = g.conveyor.parcels[0]!.lockerId
    // Step the sim until the arm has the door open but has not finished.
    for (let t = 0; t < 60 && !g.lockers.get(lockerId).doorOpen; t += 0.05) g.update(0.05)
    expect(g.lockers.get(lockerId).doorOpen).toBe(true)
    expect(g.closeLocker(lockerId).message).toBe('The robot arm is using this locker.')
    expect(g.openLocker(lockerId).ok).toBe(false)
    // The arm finishes cleanly.
    for (let t = 0; t < 30; t += 0.05) g.update(0.05)
    expect(g.lockers.get(lockerId)).toMatchObject({ state: 'occupied', doorOpen: false, locked: true })
    expect(g.conveyor.parcels).toHaveLength(0)
  })
})
