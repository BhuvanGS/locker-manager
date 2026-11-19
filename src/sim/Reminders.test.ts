import { describe, expect, it } from 'vitest'
import { GameManager } from './GameManager'
import { applyMod } from './mods'

describe('Reminders', () => {
  it('are quiet during the tutorial', () => {
    const g = new GameManager(7)
    for (let t = 0; t < 30; t += 0.5) g.update(0.5)
    expect(g.reminders()).toEqual([])
  })

  it('warn about a customer running out of patience, at most three, never repeating the objective', () => {
    const g = new GameManager(7)
    g.tutorialComplete = true
    // Past the tutorial stage (whose one customer never runs out of patience).
    applyMod(g, { type: 'nextStage' })
    applyMod(g, { type: 'spawn', count: 1 })
    let warned = false
    for (let t = 0; t < 400 && !warned; t += 1) {
      g.update(1)
      // No 3D agents in a test: everyone walking in reaches the counter at once.
      for (const c of g.customers.all()) if (c.state === 'arriving') g.customerReachedCounter(c.id)
      warned = g.reminders().some((r) => r.includes('running out of patience'))
    }
    expect(warned).toBe(true)
    const r = g.reminders()
    expect(r.length).toBeLessThanOrEqual(3)
    expect(r).not.toContain(g.objective())
  })

  it('point at a locker door left standing open', () => {
    const g = new GameManager(7)
    g.tutorialComplete = true
    const empty = g.lockers.all().find((l) => !l.itemId)!
    expect(g.openLocker(empty.id).ok).toBe(true)
    expect(g.reminders()).toContain('A locker door is standing open.')
  })
})
