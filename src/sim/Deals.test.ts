import { describe, expect, it } from 'vitest'
import { CONFIG } from './config'
import { GameManager } from './GameManager'

/** A game with the deal office built (through the normal rules) and a good name. */
function withOffice(seed = 3, reputation = 80) {
  const g = new GameManager(seed)
  g.economy.xp = 5000
  g.economy.money = 100_000
  for (const id of ['labels', 'register', 'digital', 'conveyor', 'office']) expect(g.buyUpgrade(id).ok).toBe(true)
  g.economy.reputation = reputation
  g.drainNotices()
  return g
}

function waitForOffer(g: GameManager): void {
  for (let t = 0; t < 400 && !g.deals.offer; t += 1) g.update(1)
  // ...and for the car to pull up and the VIP to reach the desk.
  for (let t = 0; t < CONFIG.deals.arrivalSeconds + 1; t += 1) g.update(1)
}

describe('The deal office', () => {
  it('needs level 6 and the conveyor, and costs money', () => {
    const g = new GameManager(3)
    g.economy.money = 5000
    g.economy.xp = 1000 // level 5
    expect(g.buyUpgrade('office').message).toBe('Needs level 6')
    g.economy.xp = 1500
    expect(g.buyUpgrade('office').message).toBe('Buy Conveyor & robot arm first')
    expect(g.hasOffice).toBe(false)
    expect(g.openDeal().ok).toBe(false)
    const rich = withOffice()
    expect(rich.hasOffice).toBe(true)
    expect(rich.drainNotices()).toEqual([])
  })

  it('a VIP turns up once the reputation is there, and not before', () => {
    const poor = withOffice(3, CONFIG.deals.minReputation - 10)
    for (let t = 0; t < 120; t++) poor.update(1)
    expect(poor.deals.offer).toBeNull()
    expect(poor.openDeal().message).toMatch(/reputation/i)
    poor.economy.reputation = 80
    waitForOffer(poor)
    expect(poor.deals.offer).not.toBeNull()
    expect(poor.drainNotices().some((n) => n.type === 'message' && n.text.includes('car is pulling up'))).toBe(true)
  })

  it('offers have a VIP, crates and a retainer, bigger deals come with a better reputation', () => {
    const sizes: number[] = []
    for (const rep of [56, 100]) {
      let total = 0
      for (let seed = 1; seed <= 20; seed++) {
        const g = withOffice(seed, rep)
        waitForOffer(g)
        const o = g.deals.offer!
        expect(CONFIG.deals.vips.map((v) => v.name)).toContain(o.name)
        expect(o.crates).toBeGreaterThanOrEqual(CONFIG.deals.crates[0])
        expect(o.crates).toBeLessThanOrEqual(CONFIG.deals.crates[1])
        expect(o.retainer).toBeGreaterThan(0)
        total += o.crates
      }
      sizes.push(total)
    }
    expect(sizes[1]!).toBeGreaterThan(sizes[0]!)
  })

  it('signing pays the retainer, XP and reputation, and the deal is recorded', () => {
    const g = withOffice()
    waitForOffer(g)
    const o = g.deals.offer!
    expect(g.openDeal().ok).toBe(true)
    const money = g.economy.money
    const rep = g.economy.reputation
    expect(g.chooseDeal('accept').ok).toBe(true)
    expect(g.economy.money).toBe(money + o.retainer)
    expect(g.economy.reputation).toBe(rep + CONFIG.deals.signingReputation)
    expect(g.deals.signed).toHaveLength(1)
    expect(g.deals.crates).toBe(o.crates)
    expect(g.dealOpen).toBe(false)
    expect(g.deals.offer).toBeNull()
  })

  it('haggling either raises the retainer or sends the VIP away, and only works once', () => {
    let raised = 0
    let walked = 0
    for (let seed = 1; seed <= 40; seed++) {
      const g = withOffice(seed)
      waitForOffer(g)
      const before = g.deals.offer!.retainer
      g.openDeal()
      const rep = g.economy.reputation
      const r = g.chooseDeal('haggle')
      if (g.deals.offer) {
        raised += 1
        expect(g.deals.offer.retainer).toBeGreaterThan(before)
        expect(r.ok).toBe(true)
        expect(g.chooseDeal('haggle').ok).toBe(false) // once
      } else {
        walked += 1
        expect(r.ok).toBe(false)
        expect(g.economy.reputation).toBe(rep + CONFIG.deals.haggleWalkReputation)
        expect(g.dealOpen).toBe(false)
      }
    }
    expect(raised).toBeGreaterThan(5)
    expect(walked).toBeGreaterThan(5)
  })

  it('declining politely costs nothing, and an offer nobody answers expires', () => {
    const g = withOffice()
    waitForOffer(g)
    g.openDeal()
    const rep = g.economy.reputation
    expect(g.chooseDeal('decline').ok).toBe(true)
    expect(g.economy.reputation).toBe(rep)
    expect(g.deals.offer).toBeNull()
    waitForOffer(g)
    expect(g.deals.offer).not.toBeNull()
    g.drainNotices()
    for (let t = 0; t < CONFIG.deals.expiresAfter + 2; t++) g.update(1)
    expect(g.deals.offer).toBeNull()
    expect(g.drainNotices().some((n) => n.type === 'message' && n.text.includes('tired of waiting'))).toBe(true)
  })

  it('the objective points at a waiting VIP', () => {
    const g = withOffice()
    g.tutorialComplete = true
    waitForOffer(g)
    expect(g.objective()).toMatch(/is waiting in the deal office/)
  })

  it('the VIP arrives by car first: you cannot sit down until they have parked', () => {
    const g = withOffice()
    g.tutorialComplete = true
    for (let t = 0; t < 400 && !g.deals.offer; t += 1) g.update(1)
    const offer = g.deals.offer!
    expect(offer.readyAt).toBeGreaterThan(g.now)
    expect(g.openDeal().message).toMatch(/pulling up/)
    expect(g.objective()).toMatch(/car is pulling up/)
    while (g.now < offer.readyAt) g.update(0.5)
    expect(g.openDeal().ok).toBe(true)
  })

  it('the mod menu can unlock the office with everything it needs', () => {
    const g = new GameManager(3)
    expect(g.grantUpgrade('office').ok).toBe(true)
    for (const id of ['labels', 'register', 'digital', 'conveyor', 'office']) expect(g.upgrades.has(id)).toBe(true)
  })
})
