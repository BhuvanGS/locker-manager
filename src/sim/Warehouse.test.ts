import { describe, expect, it } from 'vitest'
import { CONFIG } from './config'
import { GameManager } from './GameManager'

const w = CONFIG.warehouse

/** A game with the warehouse open (granted, so nothing is charged) and a good name. */
function withWarehouse(seed = 3) {
  const g = new GameManager(seed)
  g.grantUpgrade('warehouse')
  g.economy.reputation = 80
  g.drainNotices()
  return g
}

function run(g: GameManager, seconds: number, step = 0.5): void {
  for (let t = 0; t < seconds - 1e-9; t += step) g.update(step)
}

describe('The warehouse', () => {
  it('needs level 8 and the south expansion, and costs money', () => {
    const g = new GameManager(3)
    g.economy.money = 100_000
    g.economy.xp = 2000 // level 6
    expect(g.buyUpgrade('warehouse').message).toBe('Needs level 8')
    g.economy.xp = 2800
    expect(g.buyUpgrade('warehouse').message).toBe('Buy South expansion first')
    expect(g.hasWarehouse).toBe(false)
  })

  it('kei truckers turn up with a few crates, unload them, and come back for them and pay', () => {
    const g = withWarehouse()
    run(g, w.firstKeiDelay + w.arriveSeconds + w.unloadSeconds + 1)
    expect(g.warehouse.stored).toBeGreaterThanOrEqual(w.keiCrates[0])
    expect(g.warehouse.stored).toBeLessThanOrEqual(w.keiCrates[1])
    expect(g.drainNotices().some((n) => n.type === 'message' && n.text.includes('unloaded'))).toBe(true)
    const crates = g.warehouse.stored
    const money = g.economy.money
    // They come back for them within the stay window (more truckers may come too: only the first load is followed).
    const first = g.warehouse.consignments[0]!
    while (g.now < first.collectAt + w.arriveSeconds + w.unloadSeconds + 30 && g.warehouse.consignments.some((c) => c.id === first.id)) g.update(0.5)
    expect(g.warehouse.consignments.some((c) => c.id === first.id)).toBe(false)
    expect(g.economy.money).toBeGreaterThanOrEqual(money + first.crates * w.keiFeePerCrate)
    expect(crates).toBeGreaterThan(0)
  })

  it('a load that does not fit is turned away, and it costs reputation', () => {
    const g = withWarehouse()
    g.warehouse.capacity = 1
    const rep = g.economy.reputation
    run(g, w.firstKeiDelay + w.arriveSeconds + w.unloadSeconds + 1)
    expect(g.warehouse.stored).toBe(0)
    expect(g.economy.reputation).toBeLessThan(rep)
    expect(g.drainNotices().some((n) => n.type === 'alert' && n.text.includes('turned away'))).toBe(true)
  })

  it('has one bay: only one truck at a time, the rest queue in the road', () => {
    const g = withWarehouse()
    let busiest = 0
    for (let t = 0; t < 1200; t += 0.5) {
      g.update(0.5)
      busiest = Math.max(busiest, g.warehouse.truck ? 1 : 0)
      expect(g.warehouse.waiting).toBeLessThan(20)
    }
    expect(busiest).toBe(1)
  })

  it('signed VIP deals are delivered in box-truck loads until all the crates are in, then collected and paid', () => {
    const g = withWarehouse()
    g.warehouse.capacity = 100
    g.grantUpgrade('office')
    // Sign a deal by hand (the office flow is tested elsewhere).
    g.deals.offer = null
    g.deals.signed.push({
      id: 99,
      name: 'Beff Jezoz',
      title: 'Founder, Amazin',
      cargo: 'parcels',
      crates: 25,
      retainer: 400,
      signedAt: g.now,
      delivered: 0,
      inTransit: 0,
      nextDeliveryAt: g.now + w.firstDeliveryDelay,
    })
    const deal = g.deals.signed[0]!
    run(g, 400)
    expect(deal.delivered).toBe(25)
    expect(deal.inTransit).toBe(0)
    expect(g.warehouse.consignments.some((c) => c.kind === 'vip')).toBe(true)
    // ...and each load is collected after its stay, paying per crate.
    const money = g.economy.money
    run(g, w.vipStay + 400)
    expect(g.warehouse.consignments.filter((c) => c.kind === 'vip')).toHaveLength(0)
    expect(g.economy.money - money).toBeGreaterThanOrEqual(25 * w.vipFeePerCrate)
  })

  it('a VIP load that does not fit is retried later and costs more reputation than a trucker', () => {
    const g = withWarehouse()
    g.warehouse.capacity = 5
    g.grantUpgrade('office')
    g.deals.signed.push({
      id: 7,
      name: 'Elan Husk',
      title: 'CEO',
      cargo: 'batteries',
      crates: 10,
      retainer: 300,
      signedAt: g.now,
      delivered: 0,
      inTransit: 0,
      nextDeliveryAt: g.now,
    })
    const rep = g.economy.reputation
    run(g, 60)
    const deal = g.deals.signed[0]!
    expect(deal.delivered).toBe(0)
    expect(deal.inTransit).toBe(0) // the failed load is not stuck "in transit": it will be tried again
    expect(g.economy.reputation).toBeLessThanOrEqual(rep + w.vipTurnedAwayReputation)
  })
})
