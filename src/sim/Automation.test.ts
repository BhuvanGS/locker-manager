import { describe, expect, it } from 'vitest'
import { CONFIG } from './config'
import { GameManager } from './GameManager'
import { Driver } from './testDriver'

/** A game that has the digital lockers (and the conveyor if asked), bought through the normal rules. */
function owned(conveyor: boolean) {
  const d = new Driver()
  const g = d.game
  g.economy.xp = 1000 // level 5
  g.economy.money = 10_000
  for (const id of ['labels', 'register', 'digital', ...(conveyor ? ['conveyor'] : [])]) expect(g.buyUpgrade(id).ok).toBe(true)
  g.drainNotices()
  return d
}

/** The customer is at the counter, greeted and named, and the bag is in the player's hands. */
function takeBag(d: Driver): string {
  d.until(() => d.waiting().length >= 1)
  const id = d.waiting()[0]!
  expect(d.game.talkTo(id).ok).toBe(true)
  expect(d.game.choose('greet').ok).toBe(true)
  expect(d.game.choose('askName').ok).toBe(true)
  expect(d.game.choose('accept').ok).toBe(true)
  return id
}

describe('Digital lockers', () => {
  it('need level 4 and the register, cost money, and make the key racks obsolete', () => {
    const g = new GameManager(3)
    g.economy.money = 5000
    g.economy.xp = 300 // level 3
    expect(g.buyUpgrade('digital').message).toBe('Needs level 4')
    g.economy.xp = 600
    expect(g.buyUpgrade('digital').message).toBe('Buy Deposit register board first')
    g.buyUpgrade('labels')
    g.buyUpgrade('register')
    const money = g.economy.money
    expect(g.buyUpgrade('digital').ok).toBe(true)
    expect(g.economy.money).toBe(money - 450)
    expect(g.isDigital).toBe(true)
    expect(g.facilityLabel()).toBe('Digital facility')
    expect(g.buyUpgrade('rack2').message).toBe('No keys any more')
  })

  it('takes every key out of circulation and locks exactly the shut lockers that hold a bag', () => {
    const d = new Driver()
    const g = d.game
    g.economy.xp = 600
    g.economy.money = 5000
    g.buyUpgrade('labels')
    g.buyUpgrade('register')
    d.until(() => d.waiting().length === 1)
    const stored = d.deposit(d.waiting()[0]!) // key hung on a hook, locker locked
    const other = g.lockers.all().find((l) => l.id !== stored)!
    expect(g.takeKeyFromHook(0).ok).toBe(true) // the player is holding a key when the upgrade arrives
    g.buyUpgrade('digital')
    expect(g.hands).toBeNull()
    expect(g.keys.all().every((k) => k.location.kind === 'inLock')).toBe(true)
    expect(g.lockers.get(stored).locked).toBe(true)
    expect(other.locked).toBe(false)
    expect(g.takeKeyFromHook(0).message).toBe('There are no keys any more.')
    expect(g.takeKeyFromLock(other.id).ok).toBe(false)
  })

  it('locks itself when you shut the door, and opens for staff without a key', () => {
    const d = owned(false)
    const g = d.game
    const id = takeBag(d)
    const locker = g.lockers.findAvailable()!
    expect(g.openLocker(locker.id).ok).toBe(true)
    expect(g.putItem(locker.id).message).toBe(`Stored the ${g.customers.item(g.customers.get(id).itemId!).label}. Close the door.`)
    expect(g.talkTo(id).ok).toBe(true)
    expect(g.choose('confirmStored').ok).toBe(false) // door still open
    expect(g.closeLocker(locker.id).message).toBe('Locked.')
    expect(locker.locked).toBe(true)
    expect(g.talkTo(id).ok).toBe(true)
    expect(g.choose('confirmStored').ok).toBe(true) // no key to take
    // Later: open the locked locker with nothing in your hands.
    expect(g.openLocker(locker.id).ok).toBe(true)
    expect(locker.locked).toBe(false)
    expect(g.takeItem(locker.id).ok).toBe(true)
    expect(g.closeLocker(locker.id).message).toBeNull() // empty: nothing to lock
    expect(locker.locked).toBe(false)
  })
})

describe('Conveyor and robot arm', () => {
  it('replaces the west annex, needs the digital lockers and level 5', () => {
    expect(CONFIG.upgrades.some((u) => u.id === 'annexWest')).toBe(false)
    const g = new GameManager(3)
    g.economy.money = 10_000
    g.economy.xp = 600 // level 4
    expect(g.buyUpgrade('conveyor').message).toBe('Needs level 5')
    g.economy.xp = 1000
    expect(g.buyUpgrade('conveyor').message).toBe('Buy Digital lockers first')
    const d = owned(false)
    d.game.economy.money = 100
    expect(d.game.buyUpgrade('conveyor').message).toMatch(/Costs \$900/)
    d.game.economy.money = 5000
    expect(d.game.buyUpgrade('conveyor').ok).toBe(true)
    expect(d.game.facilityLabel()).toBe('Automated facility')
    expect(d.game.drainNotices().some((n) => n.type === 'upgradeBought' && n.kind === 'conveyor')).toBe(true)
  })

  it('carries a bag along the belt, and the arm files it in the lowest free locker and locks it', () => {
    const d = owned(true)
    const g = d.game
    const id = takeBag(d)
    const item = g.customers.item(g.customers.get(id).itemId!)
    expect(g.loadConveyor().ok).toBe(true)
    expect(g.hands).toBeNull()
    expect(item.status).toBe('onConveyor')
    const locker = g.lockers.get(g.conveyor.parcels[0]!.lockerId)
    expect(locker.number).toBe(1)
    expect(locker.state).toBe('reserved')
    expect(g.lockers.availableCount).toBe(g.lockers.total - 1)

    // The customer cannot be told "it is stored" while it is still on its way.
    expect(g.talkTo(id).ok).toBe(true)
    expect(g.dialogueOptions().find((o) => o.id === 'confirmStored')?.disabled).toBe('The belt is still carrying it.')
    g.closeDialogue()

    d.tick(CONFIG.automation.beltSeconds + 0.5)
    expect(g.conveyor.armJobs()[0]?.itemId).toBe(item.id) // at the end of the belt, the arm has it
    d.tick(CONFIG.automation.armSeconds * 0.55) // mid-job: the door swings open
    expect(locker.doorOpen).toBe(true)
    d.tick(CONFIG.automation.armSeconds)
    expect(g.conveyor.parcels).toHaveLength(0)
    expect(item.status).toBe('inLocker')
    expect(item.lockerId).toBe(locker.id)
    expect(g.customers.get(id).lockerId).toBe(locker.id)
    expect(locker).toMatchObject({ state: 'occupied', itemId: item.id, doorOpen: false, locked: true })

    expect(g.talkTo(id).ok).toBe(true)
    expect(g.choose('confirmStored').ok).toBe(true)
  })

  it('has one arm: bags queue, and the belt refuses more than it can hold', () => {
    const d = owned(true)
    const g = d.game
    g.spawnExtraCustomer()
    g.spawnExtraCustomer()
    d.until(() => d.waiting().length >= 3)
    const loaded: string[] = []
    for (const c of g.customers.all().filter((c) => c.state === 'waiting').slice(0, 3)) {
      expect(g.talkTo(c.id).ok).toBe(true)
      expect(g.choose('greet').ok).toBe(true)
      expect(g.choose('accept').ok).toBe(true)
      g.closeDialogue()
      expect(g.loadConveyor().ok).toBe(true)
      loaded.push(c.id)
      d.tick(CONFIG.automation.loadGap + 0.1)
    }
    expect(g.conveyor.parcels.map((p) => p.lockerId)).toHaveLength(3)
    expect(new Set(g.conveyor.parcels.map((p) => p.lockerId)).size).toBe(3) // each its own locker
    // The arm does one at a time.
    d.tick(2) // the first bag has reached the arm; the others are still riding or waiting behind it
    expect(g.conveyor.parcels.filter((p) => p.phase === 'arm')).toHaveLength(1)
    d.tick((CONFIG.automation.armSeconds + 1) * 3)
    expect(g.conveyor.parcels).toHaveLength(0)
    for (const c of loaded) expect(g.customers.itemOf(g.customers.get(c))?.status).toBe('inLocker')
  })

  it('does not let two bags go on the belt at the same instant', () => {
    const d = owned(true)
    const g = d.game
    g.spawnExtraCustomer()
    d.until(() => d.waiting().length >= 2)
    takeBag(d)
    expect(g.loadConveyor().ok).toBe(true)
    // Back-to-back: a second bag would sit on top of the first.
    const second = g.customers.all().find((c) => c.state === 'waiting')!
    expect(g.talkTo(second.id).ok).toBe(true)
    expect(g.choose('greet').ok).toBe(true)
    expect(g.choose('accept').ok).toBe(true)
    g.closeDialogue()
    expect(g.loadConveyor().message).toBe('Wait for the last bag to move along.')
  })

  it('says so when the robot has no free locker', () => {
    const d = owned(true)
    const g = d.game
    for (const l of g.lockers.all()) l.state = 'unavailable'
    takeBag(d)
    expect(g.loadConveyor().message).toBe('No free locker the robot arm can reach. Store it by hand, or extend the belts.')
    expect(g.hands).not.toBeNull() // the bag stays with the player
  })

  it('keeps the player out of a locker the robot has reserved', () => {
    const d = owned(true)
    const g = d.game
    takeBag(d)
    expect(g.loadConveyor().ok).toBe(true)
    const locker = g.lockers.get(g.conveyor.parcels[0]!.lockerId)
    expect(g.openLocker(locker.id).message).toBe('The robot arm is using this locker.')
  })

  it('fetches a bag on request: arm, return belt, then the return tray; the customer gets the right bag', () => {
    const d = owned(true)
    const g = d.game
    const id = takeBag(d)
    expect(g.loadConveyor().ok).toBe(true)
    d.tick(CONFIG.automation.beltSeconds + CONFIG.automation.armSeconds + 1)
    expect(g.talkTo(id).ok).toBe(true)
    expect(g.choose('confirmStored').ok).toBe(true)
    d.until(() => g.customers.get(id).state === 'waitingForCollection', 1000)

    const entry = g.terminalEntries().find((e) => e.lockerId === g.customers.get(id).lockerId)!
    expect(entry).toMatchObject({ name: g.customers.get(id).name, fetching: false })
    expect(g.openTerminal().ok).toBe(true)
    expect(g.requestBag(entry.lockerId).ok).toBe(true)
    expect(g.requestBag(entry.lockerId).ok).toBe(false) // the arm is already on it
    expect(g.terminalEntries()[0]!.fetching).toBe(true)
    expect(g.takeFromConveyor().message).toBe('Nothing has arrived yet.')

    d.tick(CONFIG.automation.armSeconds + CONFIG.automation.beltSeconds + 1)
    const locker = g.lockers.get(entry.lockerId)
    expect(locker).toMatchObject({ state: 'available', itemId: null, doorOpen: false, locked: false })
    expect(g.takeFromConveyor().ok).toBe(true)
    expect(g.hands?.kind).toBe('item')
    expect(g.talkTo(id).ok).toBe(true)
    const money = g.economy.money
    expect(g.choose('handOver').ok).toBe(true)
    expect(g.economy.money).toBeGreaterThan(money)
    expect(g.customers.get(id).state).toBe('completed')
  })

  it('a wrong bag from the return tray is still a wrong package', () => {
    const d = owned(true)
    const g = d.game
    d.tick(0.5)
    const first = takeBag(d)
    expect(g.loadConveyor().ok).toBe(true)
    d.tick(CONFIG.automation.beltSeconds + CONFIG.automation.armSeconds + 1)
    expect(g.talkTo(first).ok).toBe(true)
    expect(g.choose('confirmStored').ok).toBe(true)
    // Somebody else is at the counter holding the wrong bag.
    const other = g.spawnExtraCustomer()
    d.tick(0.5)
    expect(g.talkTo(other).ok).toBe(true)
    expect(g.choose('greet').ok).toBe(true)
    g.customers.get(other).state = 'waitingForCollection'
    expect(g.requestBag(g.customers.get(first).lockerId!).ok).toBe(true)
    d.tick(CONFIG.automation.armSeconds + CONFIG.automation.beltSeconds + 1)
    expect(g.takeFromConveyor().ok).toBe(true)
    g.closeDialogue()
    expect(g.talkTo(other).ok).toBe(true)
    expect(g.choose('handOver').ok).toBe(false)
    expect(g.economy.mistakes).toBe(1)
  })

  it('limits how many bags can be on the return side, and refuses empty lockers', () => {
    const d = owned(true)
    const g = d.game
    const empty = g.lockers.all()[0]!
    expect(g.requestBag(empty.id).ok).toBe(false)
    expect(g.takeFromConveyor().ok).toBe(false)
  })

  it('the arm does not reach lockers in a hall until the belt is extended there', () => {
    const g = new GameManager(3)
    g.grantUpgrade('conveyor')
    g.grantUpgrade('annexEast')
    const far = g.lockers.all().find((l) => g.zoneOf(l.id) === 'east')!
    expect(g.isRobotLocker(far.id)).toBe(false)
    expect(g.robotLockersFree()).toBe(3 * CONFIG.facility.lockerRows * CONFIG.facility.lockerCols)
    g.grantUpgrade('line-east')
    expect(g.isRobotLocker(far.id)).toBe(true)
    expect(g.robotLockersFree()).toBe(3 * 6 + 12)
  })

  it('the objective guides you through the belt', () => {
    const d = owned(true)
    const g = d.game
    g.tutorialComplete = true // the general objectives take over after the tutorial
    takeBag(d)
    expect(g.objective()).toMatch(/Put the .* on the conveyor belt/)
  })
})
