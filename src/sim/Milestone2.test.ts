import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../lib/random'
import { CONFIG, type ArrivalStage } from './config'
import { CustomerScheduler } from './CustomerScheduler'
import { GameManager } from './GameManager'
import { Driver } from './testDriver'

describe('Milestone 2: customer scaling', () => {
  it('starts stage 2 with a banner once the tutorial customer is served', () => {
    const d = new Driver()
    d.finishTutorial()
    expect(d.game.tutorialComplete).toBe(true)
    expect(d.game.scheduler.stage.id).toBe('warmup')
    expect(d.notices.some((n) => n.type === 'stageStarted' && n.title === CONFIG.stages[1].title)).toBe(true)
  })

  it('stage 2 brings three customers whose deposits overlap and who return independently', () => {
    const d = new Driver()
    d.finishTutorial()
    expect(CONFIG.stages[1].customers).toBe(3)
    const ids: string[] = []
    for (let n = 0; n < 3; n++) {
      d.until(() => d.waiting().length >= 1)
      const id = d.waiting()[0]!
      ids.push(id)
      d.deposit(id)
    }
    expect(new Set(ids).size).toBe(3)
    expect(d.game.activeDeposits()).toBe(3)

    const customers = ids.map((id) => d.game.customers.get(id))
    expect(new Set(customers.map((c) => c.lockerId)).size).toBe(3)
    expect(new Set(customers.map((c) => c.depositedAt)).size).toBe(3)
    const [min, max] = CONFIG.stages[1].returnAfter
    for (const c of customers) {
      const wait = c.expectedReturnAt! - c.depositedAt!
      expect(wait).toBeGreaterThanOrEqual(min)
      expect(wait).toBeLessThanOrEqual(max)
    }
    expect(new Set(customers.map((c) => Math.round((c.expectedReturnAt! - c.depositedAt!) * 100))).size).toBeGreaterThan(1)

    // Serve whoever comes back, in whatever order they come back.
    for (let served = 0; served < 3; served++) {
      d.until(() => d.game.customers.all().some((c) => c.state === 'waitingForCollection'))
      const back = d.game.customers.all().find((c) => c.state === 'waitingForCollection')!
      d.collect(back.id)
      d.tick(0.5)
    }
    expect(d.game.economy.served).toBe(4)
    expect(d.game.scheduler.stage.id).toBe('busy')
  })

  it('a customer still holding their bag walks out when patience runs out', () => {
    const d = new Driver()
    d.finishTutorial()
    d.until(() => d.waiting().length >= 1)
    const id = d.waiting()[0]!
    const repBefore = d.game.economy.reputation
    d.until(() => !d.game.customers.has(id), (CONFIG.stages[1].patience ?? 0) + 30)
    expect(d.notices.some((n) => n.type === 'walkout' && n.customerId === id)).toBe(true)
    expect(d.game.economy.reputation).toBe(repBefore + CONFIG.economy.walkoutReputation)
  })

  it('talking pauses patience, and a greeting buys a little more', () => {
    const d = new Driver()
    d.finishTutorial()
    d.until(() => d.waiting().length >= 1)
    const id = d.waiting()[0]!
    const c = d.game.customers.get(id)
    d.game.talkTo(id)
    const before = c.patience
    d.game.update(20)
    expect(c.patience).toBe(before)
    d.game.choose('greet')
    expect(c.patience).toBe(Math.min(c.maxPatience, before + CONFIG.customer.greetingPatience))
  })

  it('a customer whose bag you hold never walks out, but gets unhappier', () => {
    const d = new Driver()
    d.finishTutorial()
    d.until(() => d.waiting().length >= 1)
    const id = d.waiting()[0]!
    d.game.talkTo(id)
    d.game.choose('greet')
    d.game.choose('accept')
    d.game.closeDialogue()
    const c = d.game.customers.get(id)
    const before = c.satisfaction
    d.game.update(1000) // far past their patience
    expect(c.state).toBe('depositing')
    expect(c.satisfaction).toBeLessThan(before)
  })

  it('turning a customer away sends them off with a small reputation cost', () => {
    const d = new Driver()
    d.finishTutorial()
    d.until(() => d.waiting().length >= 1)
    const id = d.waiting()[0]!
    const rep = d.game.economy.reputation
    d.game.talkTo(id)
    expect(d.game.choose('turnAway').ok).toBe(true)
    expect(d.game.customers.get(id).state).toBe('leftWithoutService')
    expect(d.game.economy.reputation).toBe(rep + CONFIG.economy.turnAwayReputation)
  })

  it('the tutorial customer never runs out of patience', () => {
    const d = new Driver()
    d.until(() => d.waiting().length === 1)
    const id = d.waiting()[0]!
    d.game.update(10_000)
    expect(d.game.customers.get(id).state).toBe('waiting')
  })

  it('open trading never exceeds the active-customer cap', () => {
    const d = new Driver()
    d.finishTutorial()
    // Fast-forward through the scripted stages by serving everyone, then just let customers pile up.
    d.until(() => d.game.scheduler.stage.id === 'open', 5000)
    // Take every bag while lockers last and never hand anything back, so customers pile up.
    const cap = CONFIG.stages[4].maxActive!
    let peak = 0
    for (let t = 0; t < 900; t += 1) {
      d.tick(1)
      const id = d.waiting()[0]
      if (id && d.game.lockers.availableCount > 0) d.deposit(id)
      // Returning customers just wait (their bags are stored), keeping them active.
      peak = Math.max(peak, d.game.activeCustomers())
      expect(d.game.activeCustomers()).toBeLessThanOrEqual(cap)
    }
    expect(peak).toBe(cap)
  }, 20_000)
})

describe('Customer traffic feels random and never leaves the player idle', () => {
  const quiet: ArrivalStage = {
    id: 'quiet',
    title: 'Quiet',
    intro: '',
    customers: 4,
    firstArrivalDelay: 1,
    arrivalGap: [200, 200],
    returnAfter: [300, 300],
    patience: null,
    maxIdle: 10,
  }

  it('pulls a far-away arrival forward once the shop has been empty for maxIdle seconds', () => {
    const game = new GameManager(5, [quiet])
    const spawned: number[] = []
    const run = (seconds: number) => {
      for (let t = 0; t < seconds; t += 0.5) {
        game.update(0.5)
        for (const n of game.drainNotices()) {
          if (n.type === 'customerSpawned') {
            spawned.push(game.now)
            game.customerReachedCounter(n.customerId)
          }
          if (n.type === 'customerLeaving') game.customerExited(n.customerId)
        }
      }
    }
    run(3)
    expect(spawned).toHaveLength(1)
    // Deposit the first customer so the shop is empty again.
    const first = game.customers.all()[0]!
    game.talkTo(first.id)
    game.choose('greet')
    game.choose('accept')
    game.openLocker('locker-1')
    game.putItem('locker-1')
    game.closeLocker('locker-1')
    game.takeKeyFromLock('locker-1')
    game.hangKey(0)
    game.talkTo(first.id)
    game.choose('confirmStored')
    const emptySince = game.now
    run(40)
    // Without the guard the next customer would be ~200 s away; with it they come within about maxIdle + 5 s.
    expect(spawned).toHaveLength(2)
    expect(spawned[1]! - emptySince).toBeLessThan(quiet.maxIdle! + 6)
    expect(spawned[1]! - emptySince).toBeGreaterThanOrEqual(quiet.maxIdle! - 0.5)
  })

  it('also pulls a return forward when only stored customers remain', () => {
    const stage: ArrivalStage = { ...quiet, customers: 1, returnAfter: [300, 300] }
    const game = new GameManager(5, [stage])
    game.update(2)
    const id = game.drainNotices().find((n) => n.type === 'customerSpawned')!
    if (id.type !== 'customerSpawned') throw new Error('no spawn')
    game.customerReachedCounter(id.customerId)
    game.talkTo(id.customerId)
    game.choose('greet')
    game.choose('accept')
    game.openLocker('locker-1')
    game.putItem('locker-1')
    game.closeLocker('locker-1')
    game.takeKeyFromLock('locker-1')
    game.hangKey(0)
    game.talkTo(id.customerId)
    game.choose('confirmStored')
    const c = game.customers.get(id.customerId)
    expect(c.expectedReturnAt! - game.now).toBe(300)
    for (let t = 0; t < 30; t += 0.5) game.update(0.5)
    expect(game.customers.get(id.customerId).state).toBe('returning')
    expect(c.expectedReturnAt! - c.depositedAt!).toBeLessThan(60)
  })

  it('arrival gaps are random: within bounds, different each time, and sometimes a quick burst', () => {
    const stage = CONFIG.stages[2]
    const scheduler = new CustomerScheduler([{ ...stage, customers: null }], mulberry32(99))
    scheduler.introduce('first')
    const gaps = Array.from({ length: 300 }, () => scheduler.nextArrivalDelay()!)
    const bursts = gaps.filter((g) => g < stage.arrivalGap[0])
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(Math.min(...stage.burstGap!))
    expect(Math.max(...gaps)).toBeLessThanOrEqual(stage.arrivalGap[1])
    expect(new Set(gaps.map((g) => g.toFixed(2))).size).toBeGreaterThan(250)
    expect(bursts.length / gaps.length).toBeGreaterThan(0.15)
    expect(bursts.length / gaps.length).toBeLessThan(0.45)
  })

  it('every stage after the tutorial brings more than two customers (or goes on forever)', () => {
    for (const stage of CONFIG.stages.slice(1)) {
      if (stage.customers !== null) expect(stage.customers).toBeGreaterThan(2)
      expect(stage.maxIdle).toBeDefined()
    }
  })
})

describe('Dialogue: recommended next step', () => {
  it('walks greet → ask name → accept → step away (while storing) → tell them stored', () => {
    const d = new Driver()
    d.until(() => d.waiting().length === 1)
    const id = d.waiting()[0]!
    const g = d.game
    const next = () => g.dialogueOptions().find((o) => o.recommended)?.id
    g.talkTo(id)
    expect(next()).toBe('greet')
    g.choose('greet')
    expect(next()).toBe('askName')
    g.choose('askName')
    expect(next()).toBe('accept')
    g.choose('accept')
    expect(next()).toBe('goodbye') // bag in hand: go and store it
    expect(g.dialogueOptions().filter((o) => o.recommended)).toHaveLength(1)
    g.closeDialogue()
    g.openLocker('locker-1')
    g.putItem('locker-1')
    g.talkTo(id)
    // Bag stored but the door is still open: you must lock up first.
    expect(next()).toBe('goodbye')
    g.closeDialogue()
    g.closeLocker('locker-1')
    g.takeKeyFromLock('locker-1')
    g.hangKey(0)
    g.talkTo(id)
    expect(next()).toBe('confirmStored')
  })

  it('keeps every option in the same numbered slot for the whole visit', () => {
    const d = new Driver()
    d.until(() => d.waiting().length === 1)
    const id = d.waiting()[0]!
    const g = d.game
    const slot = (optionId: string) => g.dialogueOptions().findIndex((o) => o.id === optionId)
    g.talkTo(id)
    const before = { greet: slot('greet'), askName: slot('askName'), accept: slot('accept'), goodbye: slot('goodbye') }
    expect(before).toEqual({ greet: 0, askName: 1, accept: 2, goodbye: 3 })
    g.choose('greet')
    g.choose('askName')
    expect(g.dialogueOptions().find((o) => o.id === 'greet')?.disabled).toBe('Done')
    expect({ greet: slot('greet'), askName: slot('askName'), accept: slot('accept'), goodbye: slot('goodbye') }).toEqual(before)
    g.choose('accept')
    // The bag is taken: the main action (slot 3) becomes "tell them it is stored", nothing else moves.
    expect(slot('confirmStored')).toBe(before.accept)
    expect(slot('goodbye')).toBe(before.goodbye)
    expect(slot('turnAway')).toBe(-1)
  })

  it('never recommends turning a customer away', () => {
    const d = new Driver()
    d.until(() => d.waiting().length === 1)
    d.game.talkTo(d.waiting()[0]!)
    expect(d.game.dialogueOptions().find((o) => o.recommended)?.id).not.toBe('turnAway')
  })
})
