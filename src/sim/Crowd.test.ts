import { describe, expect, it } from 'vitest'
import { CONFIG } from './config'
import { GameManager } from './GameManager'
import { applyMod } from './mods'

/** Run the open stage for a while with nobody served (the worst case), customers reaching the counter as soon as they arrive. */
function crowdOver(g: GameManager, seconds: number): number {
  let most = 0
  for (let t = 0; t < seconds; t++) {
    g.update(1)
    for (const c of g.customers.all()) if (c.state === 'arriving' || c.state === 'returning') g.customerReachedCounter(c.id)
    most = Math.max(most, g.customersInside())
  }
  return most
}

describe('A small crowd', () => {
  it('keeps the shop to a handful of people however many lockers you own', () => {
    const g = new GameManager(7)
    applyMod(g, { type: 'level', level: 15 })
    applyMod(g, { type: 'unlockAll' })
    for (let i = 0; i < 4; i++) applyMod(g, { type: 'nextStage' })
    expect(g.lockers.total).toBeGreaterThan(100)
    expect(g.crowdCap()).toBe(CONFIG.crowd.max)
    expect(crowdOver(g, 1200)).toBeLessThanOrEqual(CONFIG.crowd.max + CONFIG.crowd.returnHeadroom)
  })

  it('starts at the base size and grows one place every few levels', () => {
    const g = new GameManager(3)
    expect(g.crowdCap()).toBe(CONFIG.crowd.base)
    applyMod(g, { type: 'level', level: 1 + CONFIG.crowd.levelsPerExtra })
    expect(g.crowdCap()).toBe(CONFIG.crowd.base + 1)
  })
})

describe('Earning more as you level', () => {
  it('raises the deposit fee and the level-up bonus with every level', () => {
    const g = new GameManager(3)
    expect(g.depositFee()).toBe(CONFIG.economy.depositFee)
    const money = g.economy.money
    applyMod(g, { type: 'level', level: 5 })
    expect(g.depositFee()).toBe(Math.round(CONFIG.economy.depositFee * (1 + 4 * CONFIG.progression.feeBonusPerLevel)))
    expect(g.economy.money - money).toBe(CONFIG.progression.levelUpBonus * (2 + 3 + 4 + 5))
    const id = g.spawnExtraCustomer()
    expect(g.customers.get(id).fee).toBe(g.depositFee())
  })
})
