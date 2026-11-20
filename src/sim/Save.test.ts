import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../lib/random'
import { SETUPS, check, fuzzGame, randomStep } from './Fuzz.test'
import { GameManager } from './GameManager'

/** Drain a loaded game's notices the way the test driver does (customers walk instantly). */
function settle(g: GameManager): void {
  for (let batch = g.drainNotices(); batch.length > 0; batch = g.drainNotices()) {
    for (const n of batch) if (n.type === 'customerSpawned') g.customerReachedCounter(n.customerId)
  }
}

/** Everything a game holds as a plain tree (shared objects written out each time, cycles cut), so two games compare by content. */
function plain(v: unknown, above = new Set<object>()): unknown {
  if (v === null || typeof v !== 'object') return typeof v === 'function' ? undefined : v
  if (above.has(v)) return '<cycle>'
  above.add(v)
  let out: unknown
  if (Array.isArray(v)) out = v.map((x) => plain(x, above))
  else if (v instanceof Map) out = [...v].map(([k, x]) => [plain(k, above), plain(x, above)])
  else if (v instanceof Set) out = [...v].map((x) => plain(x, above))
  else out = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x, above)]))
  above.delete(v)
  return out
}

/** The two games hold the same data (the first difference is named, with its path). */
function same(a: GameManager, b: GameManager): void {
  const x = JSON.parse(JSON.stringify(plain(a))) as unknown
  const y = JSON.parse(JSON.stringify(plain(b))) as unknown
  const diff = (p: unknown, q: unknown, path: string): string | null => {
    if (JSON.stringify(p) === JSON.stringify(q)) return null
    if (p && q && typeof p === 'object' && typeof q === 'object') {
      for (const k of new Set([...Object.keys(p), ...Object.keys(q)])) {
        const d = diff((p as Record<string, unknown>)[k], (q as Record<string, unknown>)[k], `${path}.${k}`)
        if (d) return d
      }
    }
    return `${path}: ${JSON.stringify(p)?.slice(0, 200)} vs ${JSON.stringify(q)?.slice(0, 200)}`
  }
  expect(diff(x, y, 'game')).toBeNull()
}

describe('Saving and loading', () => {
  const LATE = [['floor2', 'digital', 'line-floor2', 'counter-arm-2', 'office'], ['lake-harbour', 'warehouse', 'office', 'counter-arm']]
  for (const [i, setup] of [...SETUPS, ...LATE].entries()) {
    it(`a loaded game carries on exactly like the original (setup ${i})`, () => {
      for (const seed of [3, 11]) {
        const g = fuzzGame(seed * 17 + i, setup)
        const rand = mulberry32(seed * 101 + i)
        for (let s = 0; s < 160; s++) randomStep(g, rand)
        // Long stretches of time too, so ships, boats, lorries and the meteor countdown are mid-way when saved.
        for (let t = 0; t < 400; t += 0.5) g.update(0.5)
        settle(g)
        g.closeDialogue()
        g.catalogueOpen = g.terminalOpen = g.dealOpen = g.receivingOpen = false
        g.consoleScope = null
        // A loaded game sees out customers who had already finished (in the real game they would be walking out of the door).
        for (const c of g.customers.all()) if (c.state === 'completed' || c.state === 'leftWithoutService') g.customerExited(c.id)
        g.drainNotices()
        const loaded = GameManager.fromSave(JSON.parse(JSON.stringify(g.toSave())))
        settle(loaded)
        check(loaded)
        same(loaded, g)
        // The same moves from here on give the same game, so nothing (random numbers, timers, closures) was lost.
        const a = mulberry32(seed)
        const b = mulberry32(seed)
        for (let s = 0; s < 160; s++) {
          randomStep(g, a)
          randomStep(loaded, b)
        }
        for (let t = 0; t < 400; t += 0.5) {
          g.update(0.5)
          loaded.update(0.5)
        }
        check(loaded)
        same(loaded, g)
      }
    })
  }

  it('replays the rooms that were bought, in order, and walks customers in the building back in', () => {
    const g = fuzzGame(5, ['labels', 'register', 'bank2', 'annexEast'])
    for (let t = 0; t < 120; t += 0.5) g.update(0.5)
    const inside = g.customers.all().filter((c) => c.state !== 'stored' && c.state !== 'completed' && c.state !== 'leftWithoutService').map((c) => c.id)
    const loaded = GameManager.fromSave(JSON.parse(JSON.stringify(g.toSave())))
    const notices = loaded.drainNotices()
    expect(notices.filter((n) => n.type === 'upgradeBought').map((n) => n.type === 'upgradeBought' && n.id)).toEqual(['labels', 'register', 'bank2', 'bank3', 'annexEast'])
    expect(notices.flatMap((n) => (n.type === 'customerSpawned' ? [n.customerId] : []))).toEqual(inside)
    expect(loaded.economy.money).toBe(g.economy.money)
  })
})
