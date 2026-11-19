import { describe, expect, it } from 'vitest'
import { CONFIG } from './config'
import { GameManager } from './GameManager'
import { applyMod } from './mods'

/** A game with every upgrade, a finished lake, plenty of money and a high level. */
function lakeGame(): GameManager {
  const g = new GameManager(7)
  applyMod(g, { type: 'unlockAll' })
  applyMod(g, { type: 'money', amount: 500_000 })
  applyMod(g, { type: 'level', level: 20 })
  g.meteor.forceLake(g.now)
  return g
}

function run(g: GameManager, seconds: number, step = 0.5): void {
  for (let t = 0; t < seconds; t += step) g.update(step)
}

/** Wait for the shipping line's VIP, sit down and sign. */
function signShippingLine(g: GameManager): void {
  for (let t = 0; t < 600 && !g.deals.offer?.special; t += 1) g.update(1)
  expect(g.deals.offer?.special).toBe('harbour')
  run(g, CONFIG.deals.arrivalSeconds + 1)
  expect(g.openDeal().ok).toBe(true)
  expect(g.chooseDeal('accept').ok).toBe(true)
}

describe('The harbour', () => {
  it('sells the upgrades in order: road, marina, then the dock only after the shipping contract', () => {
    const g = lakeGame()
    const state = (id: string) => g.consoleItems('hub').find((i) => i.id === id)?.state
    expect(state('lake-road')).toBe('available')
    expect(state('lake-marina')).toBe('locked')
    expect(g.buyAutomation('lake-road').ok).toBe(true)
    expect(g.buyAutomation('lake-marina').ok).toBe(true)
    expect(state('lake-dock')).toBe('locked') // no contract yet
    expect(g.buyAutomation('lake-dock').ok).toBe(false)
    signShippingLine(g)
    expect(g.harbour.contract).toBe(true)
    expect(g.deals.signed.some((d) => d.crates === 0)).toBe(false) // it is not a storage deal
    expect(g.buyAutomation('lake-dock').ok).toBe(true)
    expect(g.buyAutomation('lake-harbour').ok).toBe(false) // the deeper berth first
    expect(g.buyAutomation('lake-ships').ok).toBe(true)
    expect(g.buyAutomation('lake-harbour').ok).toBe(true)
    expect(g.harbour.basin).toBe(true)
    expect(g.harbour.cranes).toBe(2)
  })

  it('brings small boats that pay to moor, and motorboats once the marina is built', () => {
    const g = lakeGame()
    g.buyAutomation('lake-road')
    const before = g.economy.money
    run(g, 400)
    expect(g.harbour.boats.length).toBeGreaterThan(0)
    expect(g.harbour.boats.every((b) => b.kind !== 'motor')).toBe(true)
    expect(g.economy.money).toBeGreaterThan(before)
    g.buyAutomation('lake-marina')
    let motor = false
    for (let t = 0; t < 600 && !motor; t += 1) {
      g.update(1)
      motor = g.harbour.boats.some((b) => b.kind === 'motor')
    }
    expect(motor).toBe(true)
    // Never two boats in one berth.
    for (const kind of ['row', 'motor'] as const) {
      const slots = g.harbour.boats.filter((b) => (b.kind === 'motor') === (kind === 'motor')).map((b) => b.slot)
      expect(new Set(slots).size).toBe(slots.length)
    }
  })

  it('asks again later when you turn the shipping line down', () => {
    const g = lakeGame()
    g.buyAutomation('lake-road')
    g.buyAutomation('lake-marina')
    for (let t = 0; t < 600 && !g.deals.offer?.special; t += 1) g.update(1)
    run(g, CONFIG.deals.arrivalSeconds + 1)
    g.openDeal()
    g.chooseDeal('decline')
    expect(g.harbour.contract).toBe(false)
    let back = false
    for (let t = 0; t < CONFIG.harbour.vipRetry + 400 && !back; t += 1) {
      g.update(1)
      back = !!g.deals.offer?.special
    }
    expect(back).toBe(true)
  })

  it('unloads the ship\'s imports into the yard, then loads the exports waiting there, paying for both', () => {
    const g = lakeGame()
    g.grantUpgrade('lake-dock')
    expect(g.harbour.contract).toBe(true)
    expect(g.harbour.basin).toBe(true) // the cargo dock digs the dock basin
    let ship = g.harbour.ship
    for (let t = 0; t < 120 && !ship; t += 1) {
      g.update(1)
      ship = g.harbour.ship
    }
    expect(ship?.size).toBe(0)
    if (!ship) return
    expect(ship.exports).toBeGreaterThan(0) // the yard opens with exports waiting
    const money = g.economy.money
    for (let t = 0; t < 900 && ship.unloaded + ship.loaded < ship.containers + ship.exports; t += 1) g.update(1)
    expect(ship.unloaded).toBe(ship.containers)
    expect(ship.loaded).toBe(ship.exports)
    expect(g.economy.money - money).toBeGreaterThanOrEqual(ship.containers * CONFIG.harbour.ships[0]!.perContainer + ship.exports * CONFIG.harbour.exportFee)
    run(g, CONFIG.harbour.shipLinger + CONFIG.harbour.shipTravel + 2, 1)
    expect(g.harbour.ship?.id ?? -1).not.toBe(ship.id) // it has sailed
  })

  it('sends container lorries to collect imports and deliver exports: at most three at once, one per bay, one at a time under the gantry', () => {
    const g = lakeGame()
    g.grantUpgrade('lake-dock')
    const L = CONFIG.harbour.lorry
    let maxAbout = 0
    let collected = 0
    let delivered = 0
    const seen = new Map<number, { job: string; handleAt: number; handledAt: number }>()
    for (let t = 0; t < 1500; t += 0.5) {
      g.update(0.5)
      const h = g.harbour
      const about = h.lorries.filter((l) => g.now < l.leaveAt)
      maxAbout = Math.max(maxAbout, about.length)
      // Never two lorries in one bay.
      const bays = about.map((l) => l.bay)
      expect(new Set(bays).size).toBe(bays.length)
      for (const l of h.lorries) seen.set(l.id, { job: l.job, handleAt: l.handleAt, handledAt: l.handledAt })
      expect(h.stock).toBeGreaterThanOrEqual(0)
      expect(h.stock).toBeLessThanOrEqual(CONFIG.harbour.yardCapacity)
      expect(h.exports).toBeLessThanOrEqual(CONFIG.harbour.exportCapacity)
    }
    for (const l of seen.values()) {
      if (l.job === 'collect') collected++
      else delivered++
    }
    expect(maxAbout).toBeGreaterThan(1)
    expect(maxAbout).toBeLessThanOrEqual(L.atOnce)
    expect(collected).toBeGreaterThan(0)
    expect(delivered).toBeGreaterThan(0)
    // The gantry's jobs never overlap.
    const windows = [...seen.values()].sort((a, b) => a.handleAt - b.handleAt)
    for (let i = 1; i < windows.length; i++) expect(windows[i]!.handleAt).toBeGreaterThanOrEqual(windows[i - 1]!.handledAt - 1e-6)
  })

  it('sends bigger ships with the deeper berth, and the biggest (two cranes) with the great harbour', () => {
    const g = lakeGame()
    g.grantUpgrade('lake-ships')
    expect(g.harbour.shipSize).toBe(1)
    g.grantUpgrade('lake-harbour')
    expect(g.harbour.shipSize).toBe(2)
    expect(g.harbour.cranes).toBe(2)
    let ship = g.harbour.ship
    for (let t = 0; t < 120 && !ship; t += 1) {
      g.update(1)
      ship = g.harbour.ship
    }
    expect(ship?.size).toBe(2)
    expect(ship?.cranes).toBe(2)
    // Two cranes: half the time per ship (imports and exports).
    if (ship) expect(ship.doneAt - ship.mooredAt).toBe(Math.ceil((ship.containers + ship.exports) / 2) * CONFIG.harbour.unloadSeconds)
  })
})
