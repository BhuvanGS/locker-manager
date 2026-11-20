import { describe, expect, it } from 'vitest'
import { CONFIG } from './config'
import { GameManager } from './GameManager'
import { applyMod } from './mods'

/** Customers walk instantly: spawned ones reach the counter, leaving ones are gone. */
function run(g: GameManager, seconds: number, step = 0.5, service = false): void {
  for (let t = 0; t < seconds; t += step) {
    g.update(step)
    if (service) for (const z of g.conveyor.coveredZones()) {
      g.conveyor.repair(z)
      g.conveyor.service(z)
    }
    for (let batch = g.drainNotices(); batch.length > 0; batch = g.drainNotices()) {
      for (const n of batch) {
        if (n.type === 'customerSpawned') g.customerReachedCounter(n.customerId)
        if (n.type === 'customerLeaving') g.customerExited(n.customerId)
      }
    }
  }
}

describe('A big building is actually used', () => {
  it('stays are longer while the lockers are empty, and the building settles most of the way full', () => {
    const g = new GameManager(4)
    applyMod(g, { type: 'level', level: 14 })
    applyMod(g, { type: 'unlockAll' })
    for (let i = 0; i < 4; i++) applyMod(g, { type: 'nextStage' })
    expect(g.stayFactor()).toBeGreaterThan(20) // 156 empty lockers
    run(g, 3 * 3600, 0.5, true)
    const used = g.lockers.all().filter((l) => l.itemId !== null).length / g.lockers.total
    expect(used).toBeGreaterThan(0.5)
    expect(used).toBeLessThan(0.95)
    expect(g.stayFactor()).toBeLessThan(10)
  })

  it('leaves the small shop and the early stages exactly as they were', () => {
    const g = new GameManager(4)
    expect(g.stayFactor()).toBe(1) // tutorial stage
    for (let i = 0; i < 4; i++) applyMod(g, { type: 'nextStage' })
    expect(g.stayFactor()).toBe(1) // six lockers
  })
})

describe('The objective under automation', () => {
  it('points at the next upgrade instead of the counter the arm is serving', () => {
    const g = new GameManager(5)
    g.grantUpgrade('counter-arm')
    g.tutorialComplete = true
    for (let i = 0; i < 4; i++) applyMod(g, { type: 'nextStage' })
    // Through a busy few minutes (customers coming and going, bags on the belts), never "a customer is waiting".
    let busy = 0
    for (let k = 0; k < 120; k++) {
      g.economy.money = 0
      run(g, 2)
      if (g.queue().length > 0 || g.conveyor.parcels.length > 0) busy++
      expect(g.objective()).not.toMatch(/waiting at the counter|return belt|Use the terminal|Ask the terminal/)
    }
    expect(busy).toBeGreaterThan(10)
    expect(g.objective()).toMatch(/^Next up: |^You can afford /)
    g.economy.money = 1_000_000
    expect(g.objective()).toMatch(/^You can afford .+: buy it at /)
  })

  it('without the counter arm it still says who is waiting', () => {
    const g = new GameManager(5)
    g.tutorialComplete = true
    for (let i = 0; i < 4; i++) applyMod(g, { type: 'nextStage' })
    run(g, 60)
    expect(g.objective()).toMatch(/waiting|back/)
  })
})

describe('Quality assurance and forklifts', () => {
  it('quality assurance is costly, needs the cold racks, and stops anything spoiling', () => {
    const g = new GameManager(3)
    g.economy.xp = 100_000
    g.grantUpgrade('warehouse')
    g.drainNotices()
    g.economy.money = 1_000_000
    expect(g.buyAutomation('wh-qa').ok).toBe(false) // the cold racks first
    expect(g.buyAutomation('wh-cold').ok).toBe(true)
    const before = g.economy.money
    expect(g.buyAutomation('wh-qa').ok).toBe(true)
    expect(before - g.economy.money).toBeGreaterThanOrEqual(10_000)
    const wh = g.warehouse
    // Food and cold-chain crates left on the open shelves for far longer than they keep.
    for (const cargo of ['food', 'cold'] as const) {
      wh.consignments.push({ id: 900 + wh.consignments.length, loadId: 900, owner: 'Test', kind: 'kei', cargo, dealId: null, spoiled: false, deliveredAt: g.now, collectAt: Number.POSITIVE_INFINITY, section: 'shelves', crates: 2 })
    }
    for (let t = 0; t < CONFIG.warehouse.foodShelfLife + CONFIG.warehouse.coldSpoilSeconds + 60; t += 1) g.update(1)
    expect(wh.consignments.filter((c) => c.loadId === 900).every((c) => !c.spoiled)).toBe(true)
  })

  it('forklifts move several crates of a load in one job, keeping every crate in one place', () => {
    const g = new GameManager(3)
    g.economy.xp = 100_000
    for (const id of ['warehouse', 'wh-forklift-2']) g.grantUpgrade(id)
    g.tutorialComplete = true
    const wh = g.warehouse
    expect(wh.forklifts).toHaveLength(2)
    expect(wh.forkCrates).toBe(3)
    let most = 0
    for (let t = 0; t < 1200; t += 0.5) {
      g.update(0.5)
      g.drainNotices()
      for (const j of wh.forklifts) if (j?.crate) most = Math.max(most, j.count)
      for (const load of wh.loads) expect(wh.truck(load.truckId)!.onBoard).toBe(load.crates - load.taken)
    }
    expect(most).toBe(3)
    expect(wh.stored).toBeGreaterThan(0)
  })
})
