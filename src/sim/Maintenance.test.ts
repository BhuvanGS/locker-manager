import { describe, expect, it } from 'vitest'
import { CONFIG } from './config'
import { GameManager } from './GameManager'

const m = CONFIG.automation.maintenance

/** A game with the conveyor and plenty of cash. */
function rich() {
  const g = new GameManager(3)
  g.economy.xp = 5000
  g.economy.money = 100_000
  for (const id of ['labels', 'register', 'digital', 'conveyor']) expect(g.buyUpgrade(id).ok).toBe(true)
  g.drainNotices()
  return g
}

/** Run the simulation in small steps (a single large step would skip whole arm jobs). */
function run(g: GameManager, seconds: number): void {
  for (let t = 0; t < seconds - 1e-9; t += 0.05) g.update(0.05)
}

/** A new customer's bag, loaded onto the belt. Returns the customer's id. */
function load(g: GameManager): string {
  const id = g.spawnExtraCustomer()
  g.customerReachedCounter(id)
  expect(g.talkTo(id).ok).toBe(true)
  expect(g.choose('greet').ok).toBe(true)
  expect(g.choose('accept').ok).toBe(true)
  g.closeDialogue()
  expect(g.loadConveyor().ok).toBe(true)
  return id
}

/** How long until the bag of `id` is in its locker (up to a minute). */
function timeToFile(g: GameManager, id: string): number {
  let t = 0
  while (g.customers.itemOf(g.customers.get(id))?.status !== 'inLocker' && t < 60) {
    g.update(0.05)
    t += 0.05
  }
  return t
}

describe('Routine maintenance: wear', () => {
  it('every job wears the arm, faster motors wear it faster', () => {
    const g = rich()
    const id = load(g)
    timeToFile(g, id)
    run(g, 4)
    expect(g.conveyor.armHealth('main', 0).condition).toBe(100 - m.wearPerJob)
    const fast = rich()
    fast.grantUpgrade('speed-main-3')
    const other = load(fast)
    timeToFile(fast, other)
    run(fast, 4)
    expect(fast.conveyor.armHealth('main', 0).condition).toBeCloseTo(100 - m.wearPerJob * (1 + m.speedWear * 3))
  })

  it('a worn arm is slower, and a failing one slower still', () => {
    const times: number[] = []
    for (const condition of [100, m.wornBelow - 1, m.failingBelow - 0.01]) {
      const g = rich()
      g.conveyor.armHealth('main', 0).condition = condition
      // (At 0.01 below the limit the chance of a jam is a hundredth of a percent: this test is about speed.)
      const id = load(g)
      times.push(timeToFile(g, id) - CONFIG.automation.beltSeconds) // the time with the arm
    }
    expect(times[1]!).toBeGreaterThan(times[0]! * 1.15)
    expect(times[2]!).toBeGreaterThan(times[1]! * 1.1)
  })
})

describe('Routine maintenance: jams', () => {
  it('an arm at condition 0 jams as it starts a job, stops, and the game says so', () => {
    const g = rich()
    g.tutorialComplete = true // the general objectives take over after the tutorial
    g.conveyor.armHealth('main', 0).condition = 0
    const id = load(g)
    run(g, CONFIG.automation.beltSeconds + 0.2)
    expect(g.conveyor.armHealth('main', 0).jammed).toBe(true)
    const jam = g.drainNotices().find((n) => n.type === 'jam')
    expect(jam).toMatchObject({ type: 'jam', zone: 'main' })
    // Frozen: a minute later the bag is still with the arm and the locker has not been touched.
    run(g, 60)
    expect(g.conveyor.armJobs()).toHaveLength(1)
    expect(g.customers.itemOf(g.customers.get(id))?.status).toBe('onConveyor')
    expect(g.objective()).toBe('A robot arm in the Storage room has jammed. Repair it at that arm console.')
  })

  it('a failing arm only sometimes jams, a healthy one never does', () => {
    let jams = 0
    for (let seed = 1; seed <= 40; seed++) {
      const g = new GameManager(seed)
      g.economy.xp = 5000
      g.economy.money = 100_000
      for (const id of ['labels', 'register', 'digital', 'conveyor']) g.buyUpgrade(id)
      g.conveyor.armHealth('main', 0).condition = m.failingBelow / 2 // jam chance = jamChance / 2
      load(g)
      run(g, CONFIG.automation.beltSeconds + 0.2)
      if (g.conveyor.armHealth('main', 0).jammed) jams += 1
    }
    expect(jams).toBeGreaterThan(2)
    expect(jams).toBeLessThan(25)
    for (let seed = 1; seed <= 10; seed++) {
      const g = new GameManager(seed)
      g.economy.xp = 5000
      g.economy.money = 100_000
      for (const id of ['labels', 'register', 'digital', 'conveyor']) g.buyUpgrade(id)
      g.conveyor.armHealth('main', 0).condition = m.failingBelow // not failing yet
      load(g)
      run(g, CONFIG.automation.beltSeconds + 0.2)
      expect(g.conveyor.armHealth('main', 0).jammed).toBe(false)
    }
  })

  it('a repair at the arm console frees the arm, which finishes its job but is only half-fit', () => {
    const g = rich()
    g.conveyor.armHealth('main', 0).condition = 0
    const id = load(g)
    run(g, CONFIG.automation.beltSeconds + 0.2)
    expect(g.consoleItems('main')[0]!.note).toBe('Repair the jammed arm first') // no service while it is stuck
    const repair = g.consoleItems('main')[1]!
    expect(repair).toMatchObject({ id: 'repair-main', state: 'available', cost: m.repairCostPerArm })
    const money = g.economy.money
    expect(g.buyAutomation('repair-main').ok).toBe(true)
    expect(g.economy.money).toBe(money - m.repairCostPerArm)
    expect(g.conveyor.armHealth('main', 0)).toEqual({ condition: m.repairedCondition, jammed: false })
    expect(timeToFile(g, id)).toBeLessThan(60)
    expect(g.customers.itemOf(g.customers.get(id))?.status).toBe('inLocker')
    expect(g.objective()).not.toMatch(/jammed/)
  })

  it('cannot repair what is not broken, or without the money', () => {
    const g = rich()
    expect(g.buyAutomation('repair-main').message).toBe('Nothing is jammed')
    g.conveyor.armHealth('main', 0).jammed = true
    g.economy.money = 10
    expect(g.buyAutomation('repair-main').message).toMatch(/^Costs \$80/)
  })

  it('with two arms, one jam does not stop the other', () => {
    const g = rich()
    g.grantUpgrade('arms-main')
    g.conveyor.armHealth('main', 0).condition = 0 // the first arm to take a job will jam
    const first = load(g)
    run(g, CONFIG.automation.loadGap + 0.1)
    const second = load(g)
    run(g, CONFIG.automation.beltSeconds + 0.5)
    expect(g.conveyor.armHealth('main', 0).jammed).toBe(true)
    expect(g.conveyor.armHealth('main', 1).jammed).toBe(false)
    timeToFile(g, second)
    expect(g.customers.itemOf(g.customers.get(second))?.status).toBe('inLocker')
    expect(g.customers.itemOf(g.customers.get(first))?.status).toBe('onConveyor') // still stuck with the first arm
  })
})

describe('Routine maintenance: service', () => {
  it('costs by how worn the arms are, restores them to 100 %, and is refused when nothing is worn', () => {
    const g = rich()
    expect(g.consoleItems('main')[0]).toMatchObject({ id: 'service-main', state: 'locked', note: 'Already in perfect condition' })
    g.conveyor.armHealth('main', 0).condition = 40
    expect(g.serviceCost('main')).toBe(Math.ceil(0.6 * m.serviceCostPerArm))
    const money = g.economy.money
    expect(g.buyAutomation('service-main').ok).toBe(true)
    expect(g.economy.money).toBe(money - Math.ceil(0.6 * m.serviceCostPerArm))
    expect(g.conveyor.armHealth('main', 0).condition).toBe(100)
    expect(g.buyAutomation('service-main').message).toBe('Already in perfect condition')
  })

  it('a second arm doubles the work: both arms are serviced together', () => {
    const g = rich()
    g.grantUpgrade('arms-main')
    g.conveyor.armHealth('main', 0).condition = 50
    g.conveyor.armHealth('main', 1).condition = 50
    expect(g.serviceCost('main')).toBe(Math.ceil((100 / 100) * m.serviceCostPerArm))
    g.buyAutomation('service-main')
    expect(g.conveyor.zoneCondition('main')).toBe(100)
  })

  it('every zone has its own maintenance at its own console, and the hub has none', () => {
    const g = rich()
    g.grantUpgrade('line-east')
    expect(g.consoleItems('east').slice(0, 2).map((i) => i.id)).toEqual(['service-east', 'repair-east'])
    expect(g.consoleItems('hub').some((i) => i.id.startsWith('service-'))).toBe(false)
    g.conveyor.armHealth('east', 0).condition = 10
    expect(g.conveyor.zoneCondition('main')).toBe(100) // the storage room is untouched
    expect(g.buyAutomation('service-east').ok).toBe(true)
  })
})
