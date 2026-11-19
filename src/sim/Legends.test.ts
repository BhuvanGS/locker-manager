import { describe, expect, it } from 'vitest'
import { CustomerFactory, LEGENDS } from './CustomerFactory'
import { mulberry32 } from '../lib/random'

describe('Rare visitors', () => {
  it('turn up now and then with their own name and look, each at most once a game', () => {
    const f = new CustomerFactory(mulberry32(5))
    const people = Array.from({ length: 300 }, () => f.customer({ patience: 100, fee: 15, satisfaction: 70 }).customer)
    const legends = people.filter((c) => c.appearance.special)
    expect(legends.length).toBeGreaterThan(0)
    expect(legends.length).toBeLessThanOrEqual(LEGENDS.length)
    expect(legends.length / people.length).toBeLessThan(0.05)
    for (const c of legends) expect(LEGENDS.find((l) => l.special === c.appearance.special)?.name).toBe(c.name)
    expect(new Set(legends.map((c) => c.name)).size).toBe(legends.length)
    // Never among the first few customers (the tutorial and the first stage).
    expect(people.slice(0, 3).some((c) => c.appearance.special)).toBe(false)
  })
})
