import { describe, expect, it } from 'vitest'
import { CONFIG } from './config'
import { GameManager } from './GameManager'

/** A game with the conveyor and the counter arm (granted, so nothing is charged). */
function withCounterArm(seed = 3) {
  const g = new GameManager(seed)
  g.grantUpgrade('counter-arm')
  g.tutorialComplete = true
  g.drainNotices()
  return g
}

/** Customers walk instantly: spawned ones are at the counter, leaving ones are gone. */
function run(g: GameManager, seconds: number, step = 0.25): void {
  for (let t = 0; t < seconds - 1e-9; t += step) {
    g.update(step)
    for (let batch = g.drainNotices(); batch.length > 0; batch = g.drainNotices()) {
      for (const n of batch) {
        if (n.type === 'customerSpawned') g.customerReachedCounter(n.customerId)
        if (n.type === 'customerLeaving') g.customerExited(n.customerId)
      }
    }
  }
}

describe('The counter arm', () => {
  it('is a late upgrade: it needs the second arm in the storage room, level 8 and the money', () => {
    const g = new GameManager(3)
    g.economy.money = 100_000
    g.economy.xp = 2000 // level 6
    for (const id of ['labels', 'register', 'digital', 'conveyor']) g.buyUpgrade(id)
    expect(g.buyAutomation('counter-arm').message).toBe('Buy Second arm first')
    expect(g.hasCounterArm).toBe(false)
    expect(withCounterArm().hasCounterArm).toBe(true)
  })

  it('takes a customer\'s bag onto the belt without you, and the customer leaves', () => {
    const g = withCounterArm()
    const id = g.spawnExtraCustomer()
    run(g, 0.5)
    expect(g.customers.get(id).state).toBe('waiting')
    run(g, 0.4 * CONFIG.automation.counterSeconds + 0.5)
    const item = g.customers.itemOf(g.customers.get(id))!
    expect(item.status).toBe('withArm') // the bag has left their hand and the arm has it
    expect(g.counterJobView()).toMatchObject({ kind: 'take', customerId: id })
    run(g, 0.6 * CONFIG.automation.counterSeconds + 0.5)
    expect(g.customers.get(id).state === 'stored' || !g.customers.has(id)).toBe(true)
    expect(item.status === 'onConveyor' || item.status === 'inLocker').toBe(true)
    expect(g.counterJobView()).toBeNull()
  })

  it('fetches the bag when the customer is back and hands it over: they pay, with no player action at all', () => {
    const g = withCounterArm()
    const id = g.spawnExtraCustomer()
    run(g, 60) // taken, stored on the belt, and the customer left
    g.callBackStoredCustomers()
    const money = g.economy.money
    run(g, 120)
    expect(g.customers.has(id) ? g.customers.get(id).state : 'gone').toMatch(/completed|gone/)
    expect(g.economy.money).toBeGreaterThan(money)
    expect(g.economy.served).toBeGreaterThanOrEqual(1)
  })

  it('serves customers one at a time, oldest first', () => {
    const g = withCounterArm()
    const a = g.spawnExtraCustomer()
    const b = g.spawnExtraCustomer()
    run(g, 0.5)
    expect(g.counterJobView()?.customerId).toBe(a)
    run(g, CONFIG.automation.counterSeconds + CONFIG.automation.loadGap + 2)
    expect(g.counterJobView()?.customerId === b || g.customers.get(b).state === 'stored').toBe(true)
  })

  it('does not touch a customer you are talking to, and drops the job if you start before it has their bag', () => {
    const g = withCounterArm()
    const id = g.spawnExtraCustomer()
    run(g, 0.5)
    expect(g.counterJobView()).not.toBeNull()
    expect(g.talkTo(id).ok).toBe(true)
    run(g, 1)
    expect(g.counterJobView()).toBeNull() // dropped
    const locker = g.lockers.all()[0]!
    expect(locker.state).toBe('available') // and the reserved locker is free again
    run(g, 30)
    expect(g.customers.itemOf(g.customers.get(id))?.status).toBe('withCustomer') // untouched while you talk
  })

  it('a customer who walks out of patience before the arm reaches them is not served, and nothing is left reserved', () => {
    const g = withCounterArm()
    const id = g.spawnExtraCustomer()
    const c = g.customers.get(id)
    c.patienceDrains = true // (tutorial-stage customers never run out)
    c.patience = 0.2
    run(g, 5)
    expect(g.customers.has(id) ? g.customers.get(id).state : 'gone').toMatch(/leftWithoutService|gone|stored/)
    run(g, 40)
    expect(g.counterJobView()?.customerId).not.toBe(id) // (other customers arrive and are served)
    for (const l of g.lockers.all()) expect(l.state === 'reserved' && !g.conveyor.isBusy(l.id) && !l.itemId && g.counterJob?.lockerId !== l.id).toBe(false)
  })
})
