import { describe, expect, it } from 'vitest'
import { CONFIG } from './config'
import { GameManager } from './GameManager'
import { applyMod, modInfo, xpForLevel } from './mods'
import { Driver } from './testDriver'

describe('Mod menu actions', () => {
  it('adds cash and XP, with the normal level-up bonus and notice', () => {
    const g = new GameManager(3)
    const money = g.economy.money
    expect(applyMod(g, { type: 'money', amount: 1000 }).ok).toBe(true)
    expect(g.economy.money).toBe(money + 1000)

    const before = g.economy.money
    expect(applyMod(g, { type: 'xp', amount: 100 }).ok).toBe(true)
    expect(g.economy.level.level).toBe(2)
    expect(g.economy.money).toBe(before + CONFIG.progression.levelUpBonus * 2)
    expect(g.drainNotices().some((n) => n.type === 'levelUp' && n.level === 2)).toBe(true)
  })

  it('sets a level exactly, and refuses to go down', () => {
    const g = new GameManager(3)
    for (const level of [2, 5, 9]) {
      expect(xpForLevel(level)).toBe(Array.from({ length: level - 1 }, (_, i) => (i + 1) * 100).reduce((a, b) => a + b, 0))
    }
    expect(applyMod(g, { type: 'level', level: 5 }).ok).toBe(true)
    expect(g.economy.level.level).toBe(5)
    expect(g.economy.level.into).toBe(0)
    expect(applyMod(g, { type: 'level', level: 3 }).ok).toBe(false)
    expect(g.economy.level.level).toBe(5)
  })

  it('unlocks an upgrade for free, ignoring level, and pulls in what it requires', () => {
    const g = new GameManager(3)
    const money = g.economy.money
    expect(g.economy.level.level).toBe(1)
    expect(applyMod(g, { type: 'unlock', id: 'register' }).ok).toBe(true)
    expect(g.upgrades.has('labels')).toBe(true) // required first
    expect(g.upgrades.has('register')).toBe(true)
    expect(g.economy.money).toBe(money) // nothing charged
    expect(applyMod(g, { type: 'unlock', id: 'register' }).ok).toBe(false) // already owned
    const bought = g.drainNotices().filter((n) => n.type === 'upgradeBought').map((n) => (n.type === 'upgradeBought' ? n.id : ''))
    expect(bought).toEqual(['labels', 'register'])
  })

  it('unlocking an annex gives the banks, racks and notices exactly like buying it', () => {
    const g = new GameManager(3)
    expect(applyMod(g, { type: 'unlock', id: 'annexEast' }).ok).toBe(true)
    for (const id of ['bank2', 'bank3', 'annexWest', 'annexEast']) expect(g.upgrades.has(id)).toBe(true)
    expect(g.lockers.total).toBe(6 + 6 + 6 + 12 + 12)
    expect(g.keys.hookCount).toBe(8 + 16 + 16)
    const annex = g.drainNotices().filter((n) => n.type === 'upgradeBought' && n.kind === 'annex')
    expect(annex).toHaveLength(2)
    expect(annex[0]).toMatchObject({ side: 'west', banks: [3, 4] })
    expect(annex[1]).toMatchObject({ side: 'east', banks: [5, 6] })
  })

  it('unlock everything leaves nothing to buy, and says so the second time', () => {
    const g = new GameManager(3)
    expect(applyMod(g, { type: 'unlockAll' }).ok).toBe(true)
    expect(CONFIG.upgrades.every((def) => g.upgrades.has(def.id))).toBe(true)
    expect(g.lockers.total).toBe(42 + 3 * 36) // both annexes, the south expansion and two floors
    expect(g.catalogueItems().every((i) => i.state === 'owned')).toBe(true)
    expect(applyMod(g, { type: 'unlockAll' }).ok).toBe(false)
  })

  it('spawns extra customers who do not count towards finishing the stage', () => {
    const d = new Driver()
    d.finishTutorial()
    const g = d.game
    const stage = g.scheduler.stage.id
    expect(applyMod(g, { type: 'spawn', count: 3 }).ok).toBe(true)
    d.tick(0.5)
    const extras = g.customers.all().filter((c) => !g.scheduler.belongsToStage(c.id))
    expect(extras.length).toBeGreaterThanOrEqual(3)
    expect(extras.every((c) => c.state === 'waiting')).toBe(true)
    // Turn them all away: the stage must not have moved on because of them.
    for (const c of extras) {
      g.talkTo(c.id)
      g.choose('turnAway')
    }
    d.tick(0.5)
    expect(g.scheduler.stage.id).toBe(stage)
    expect(applyMod(g, { type: 'spawn', count: 500 }).message).toBe('20 customers on the way.') // capped
  })

  it('jumps to the next traffic stage without doubling the arrivals', () => {
    const g = new GameManager(3)
    expect(g.scheduler.stage.id).toBe('tutorial')
    expect(applyMod(g, { type: 'nextStage' }).ok).toBe(true)
    expect(g.scheduler.stage.id).toBe('warmup')
    expect(g.tutorialComplete).toBe(true)
    expect(g.drainNotices().some((n) => n.type === 'stageStarted' && n.title === CONFIG.stages[1].title)).toBe(true)
    // Exactly one arrival is pending (the old stage's was removed).
    expect(g.clock.pending).toBe(1)
    expect(g.clock.peekEarliest()!.at).toBeCloseTo(g.now + CONFIG.stages[1].firstArrivalDelay)
    // Skip to the end; the last stage cannot be skipped and keeps its arrivals going.
    while (applyMod(g, { type: 'nextStage' }).ok) {
      /* keep going */
    }
    expect(g.scheduler.stage.id).toBe('open')
    expect(g.clock.pending).toBe(1)
    expect(applyMod(g, { type: 'nextStage' }).ok).toBe(false)
    expect(g.clock.pending).toBe(1)
  })

  it('brings every stored customer back in a second', () => {
    const d = new Driver()
    d.finishTutorial()
    const g = d.game
    expect(applyMod(g, { type: 'returnAll' }).ok).toBe(false) // nobody stored yet
    const ids: string[] = []
    for (let n = 0; n < 2; n++) {
      d.until(() => d.waiting().length >= 1)
      const id = d.waiting()[0]!
      ids.push(id)
      d.deposit(id)
    }
    expect(applyMod(g, { type: 'returnAll' }).ok).toBe(true)
    for (const id of ids) expect(g.customers.get(id).expectedReturnAt).toBeCloseTo(g.now + 1)
    d.tick(2)
    expect(ids.every((id) => g.customers.get(id).state === 'waitingForCollection')).toBe(true)
  })

  it('skips time', () => {
    const g = new GameManager(3)
    const t = g.now
    expect(applyMod(g, { type: 'skip', seconds: 30 }).ok).toBe(true)
    expect(g.now).toBeCloseTo(t + 30)
    applyMod(g, { type: 'skip', seconds: 100000 })
    expect(g.now).toBeLessThanOrEqual(t + 30 + 600 + 1) // capped at ten minutes
  })

  it('customers who never lose patience never walk out, until you turn it off again', () => {
    const d = new Driver()
    d.finishTutorial()
    const g = d.game
    expect(applyMod(g, { type: 'patience', on: true }).ok).toBe(true)
    d.until(() => d.waiting().length >= 1)
    const id = d.waiting()[0]!
    d.tick(2000)
    expect(g.customers.get(id).state).toBe('waiting')
    applyMod(g, { type: 'patience', on: false })
    d.tick(400)
    expect(g.customers.has(id)).toBe(false) // they gave up and left
  })

  it('reports what the menu shows', () => {
    const g = new GameManager(3)
    applyMod(g, { type: 'unlock', id: 'labels' })
    const info = modInfo(g)
    expect(info.level).toBe(1)
    expect(info.money).toBe(CONFIG.economy.startingMoney)
    expect(info.stageTitle).toBe(CONFIG.stages[0].title)
    expect(info.upgrades).toHaveLength(CONFIG.upgrades.length)
    expect(info.upgrades.find((u) => u.id === 'labels')?.owned).toBe(true)
    expect(info.upgrades.find((u) => u.id === 'register')?.owned).toBe(false)
  })
})
