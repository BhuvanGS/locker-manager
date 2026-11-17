import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../lib/random'
import { CONFIG, type ArrivalStage } from './config'
import { CustomerScheduler } from './CustomerScheduler'
import { GameManager } from './GameManager'
import { Driver } from './testDriver'
import type { CustomerId, Customer } from './types'

/** Bring a customer back to the counter on a collection visit, with their bag still in its locker. */
function stored(d: Driver): { id: CustomerId; lockerId: string } {
  d.until(() => d.waiting().length >= 1)
  const id = d.waiting()[0]!
  const lockerId = d.deposit(id)
  return { id, lockerId }
}

function waitUntilBack(d: Driver, id: CustomerId): Customer {
  d.until(() => d.game.customers.get(id).state === 'waitingForCollection', 1000)
  return d.game.customers.get(id)
}

describe('Customers come back in a different order from the one they left in', () => {
  it('each customer draws their own return time from a wide window', () => {
    for (const stage of CONFIG.stages.slice(1)) {
      const [min, max] = stage.returnAfter
      expect(max - min).toBeGreaterThanOrEqual(110)
    }
  })

  /** Simulate `count` customers depositing `gap` seconds apart and return their return times. */
  function returnTimes(seed: number, stageIndex: number, count: number, gap: number): number[] {
    const scheduler = new CustomerScheduler([CONFIG.stages[stageIndex]!], mulberry32(seed))
    const pending: number[] = []
    for (let i = 0; i < count; i++) {
      const now = i * gap
      pending.push(now + scheduler.returnDelay(now, pending))
    }
    return pending
  }

  it('five customers who deposit fifteen seconds apart almost never come back in deposit order', () => {
    let sameOrder = 0
    const trials = 400
    for (let seed = 1; seed <= trials; seed++) {
      const times = returnTimes(seed, 2, 5, 15)
      const order = times.map((t, i) => [t, i] as const).sort((a, b) => a[0] - b[0]).map(([, i]) => i)
      if (order.every((v, i) => v === i)) sameOrder++
    }
    expect(sameOrder / trials).toBeLessThan(0.03)
  })

  it('among customers stored together, the one who left first returns first only about half the time', () => {
    let inOrder = 0
    let pairs = 0
    for (let seed = 1; seed <= 300; seed++) {
      const times = returnTimes(seed, 3, 5, 15)
      for (let a = 0; a < 5; a++) {
        for (let b = a + 1; b < 5; b++) {
          // Pairs that really were stored at the same time: b left before a came back.
          if (b * 15 >= times[a]!) continue
          pairs++
          if (times[a]! < times[b]!) inOrder++
        }
      }
    }
    // Plain random waits give ~80 % first-in-first-out. We want close to a coin flip.
    expect(inOrder / pairs).toBeLessThan(0.68)
    expect(inOrder / pairs).toBeGreaterThan(0.4)
  })

  it('return times always stay inside the stage window, and the tutorial wait stays fixed', () => {
    for (const [index, stage] of CONFIG.stages.entries()) {
      const [min, max] = stage.returnAfter
      for (const seed of [1, 2, 3]) {
        const scheduler = new CustomerScheduler([stage], mulberry32(seed))
        const pending = [50, 70, 90, 120]
        for (let i = 0; i < 100; i++) {
          const delay = scheduler.returnDelay(0, pending)
          expect(delay).toBeGreaterThanOrEqual(min)
          expect(delay).toBeLessThanOrEqual(max)
          if (index === 0) expect(delay).toBe(25)
        }
      }
    }
  })

  it('in a real game the first to leave is not always the first to return', () => {
    let differs = 0
    for (let seed = 1; seed <= 12; seed++) {
      const d = new Driver(seed)
      d.finishTutorial()
      const ids: CustomerId[] = []
      for (let n = 0; n < 3; n++) {
        d.until(() => d.waiting().length >= 1)
        const id = d.waiting()[0]!
        ids.push(id)
        d.deposit(id)
      }
      const returnOrder = [...ids].sort(
        (a, b) => d.game.customers.get(a).expectedReturnAt! - d.game.customers.get(b).expectedReturnAt!,
      )
      if (returnOrder.some((id, i) => id !== ids[i])) differs++
    }
    expect(differs).toBeGreaterThanOrEqual(6)
  })
})

describe('Wrong package: "this is not my package", and anger when you keep trying', () => {
  /** Two customers stored; returns a customer at the counter with the OTHER customer's bag in hand. */
  function setup() {
    const d = new Driver()
    d.finishTutorial()
    const a = stored(d)
    const b = stored(d)
    const back = waitUntilBack(d, a.id)
    const g = d.game
    // Take the wrong bag: customer b's, whoever is back first is `back`.
    const wrong = back.id === a.id ? b : a
    const key = g.keys.get(g.lockers.get(wrong.lockerId).keyId)
    if (key.location.kind !== 'hook') throw new Error('key not on a hook')
    g.takeKeyFromHook(key.location.hook)
    g.useKeyOn(wrong.lockerId)
    g.takeItem(wrong.lockerId)
    g.talkTo(back.id)
    return { d, g, back }
  }

  it('the customer says it is not their package, and you can retry', () => {
    const { g, back } = setup()
    const result = g.choose('handOver')
    expect(result.ok).toBe(false)
    expect(g.dialogue?.lines.some((l) => l.text.includes("isn't my package"))).toBe(true)
    expect(g.customers.get(back.id).state).toBe('collecting')
    expect(g.dialogue).not.toBeNull() // still talking: you can try again
    expect(g.hands?.kind).toBe('item')
    expect(g.dialogueOptions().find((o) => o.id === 'handOver')?.disabled).toBeNull()
  })

  it('every wrong try makes them angrier: more lost satisfaction and reputation, escalating lines', () => {
    const { g, back } = setup()
    const rep0 = g.economy.reputation
    const sat0 = back.satisfaction
    const said: string[] = []
    const satisfaction: number[] = []
    for (let n = 1; n <= 5; n++) {
      const r = g.choose('handOver')
      expect(r.ok).toBe(false)
      said.push(g.dialogue!.lines.filter((l) => l.who !== 'You').at(-1)!.text)
      satisfaction.push(back.satisfaction)
      expect(back.visit.wrongAttempts).toBe(n)
    }
    expect(new Set(said).size).toBe(5) // a different, angrier line each time
    expect(said[0]).toMatch(/isn't my package/i)
    expect(said[4]).toMatch(/even trying/i)
    expect(satisfaction.every((s, i) => i === 0 || s <= satisfaction[i - 1]!)).toBe(true)
    expect(back.satisfaction).toBeLessThan(sat0)
    expect(g.economy.reputation).toBeLessThan(rep0)
    expect(g.economy.mistakes).toBe(5)
  })

  it('the first try costs more reputation than later ones, and each try uses up patience', () => {
    const { g, back } = setup()
    const patience0 = back.patience
    const rep0 = g.economy.reputation
    g.choose('handOver')
    const first = rep0 - g.economy.reputation
    const rep1 = g.economy.reputation
    g.choose('handOver')
    const second = rep1 - g.economy.reputation
    expect(first).toBe(Math.abs(CONFIG.wrongItem.reputation[0]!))
    expect(second).toBe(Math.abs(CONFIG.wrongItem.reputation[1]!))
    expect(back.patience).toBeLessThan(patience0)
  })

  it('a furious customer pays only half the fee and gives no tip, but you can still serve them', () => {
    const { d, g, back } = setup()
    for (let n = 0; n < CONFIG.wrongItem.furiousAt; n++) g.choose('handOver')
    // Put the wrong bag back, fetch the right one, and finish.
    g.closeDialogue()
    const wrongItem = g.customers.item((g.hands as { itemId: string }).itemId)
    const wrongLocker = [...g.lockers.all()].find((l) => !l.itemId && !l.locked && l.doorOpen === false)!
    g.openLocker(wrongLocker.id)
    g.putItem(wrongLocker.id)
    expect(wrongItem.status).toBe('inLocker')
    g.closeLocker(wrongLocker.id)

    const rightLocker = back.lockerId!
    const key = g.keys.all().find((k) => k.lockerId === rightLocker)!
    expect(key.location.kind).toBe('hook')
    if (key.location.kind !== 'hook') return
    g.takeKeyFromHook(key.location.hook)
    g.useKeyOn(rightLocker)
    g.takeItem(rightLocker)
    g.talkTo(back.id)
    g.drainNotices()
    expect(g.choose('handOver').ok).toBe(true)
    expect(g.customers.get(back.id).state).toBe('completed')
    const payment = g.drainNotices().find((n) => n.type === 'payment')
    expect(payment).toBeDefined()
    if (payment?.type !== 'payment') return
    // Half the fee plus whatever tip a very unhappy customer still leaves (none at 0 satisfaction).
    expect(payment.amount).toBe(
      Math.round(back.fee * CONFIG.wrongItem.furiousDiscount) + Math.round((CONFIG.economy.maxTip * back.satisfaction) / 100),
    )
    expect(payment.amount).toBeLessThan(back.fee)
    d.tick(0.5)
  })

  it('getting it right first time pays the full fee', () => {
    const d = new Driver()
    d.finishTutorial()
    const a = stored(d)
    const back = waitUntilBack(d, a.id)
    d.collect(back.id)
    expect(back.satisfaction).toBeGreaterThan(70)
    expect(back.visit.wrongAttempts).toBe(0)
  })
})

describe('Levels and upgrades', () => {
  /** A fresh game where the player has earned `xp` and `money` (skipping the customers). */
  function rich(xp: number, money: number): GameManager {
    const g = new GameManager(7)
    g.economy.xp = xp
    g.economy.money = money
    return g
  }

  it('levelling up pays a cash bonus and announces what it unlocks', () => {
    const g = new GameManager(7)
    g.economy.xp = 90
    const money = g.economy.money
    ;(g as unknown as { gainXp(n: number): void }).gainXp(20)
    const notice = g.drainNotices().find((n) => n.type === 'levelUp')
    expect(notice).toBeDefined()
    if (notice?.type !== 'levelUp') return
    expect(notice.level).toBe(2)
    expect(notice.bonus).toBe(CONFIG.progression.levelUpBonus * 2)
    expect(g.economy.money).toBe(money + notice.bonus)
    expect(notice.unlocked).toEqual(['Locker & key labels', 'Deposit register board', 'Key rack #2', 'Locker bank B'])
  })

  it('upgrades need the level, the previous upgrade and the cash, and say why not', () => {
    const g = rich(0, 1000)
    expect(g.buyUpgrade('bank2').ok).toBe(false)
    expect(g.catalogueItems().find((i) => i.id === 'bank2')?.note).toBe('Needs level 2')
    g.economy.xp = 100
    expect(g.economy.level.level).toBe(2)
    expect(g.buyUpgrade('bank3').message).toBe('Needs level 3')
    g.economy.xp = 300
    expect(g.buyUpgrade('bank3').message).toBe('Buy Locker bank B first')
    g.economy.money = 5
    expect(g.buyUpgrade('bank2').message).toMatch(/Costs \$90/)
    expect(g.economy.money).toBe(5) // nothing was charged
    expect(g.upgrades.has('bank2')).toBe(false)
    expect(g.buyUpgrade('nope').ok).toBe(false)
  })

  it('a locker bank adds six lockers and six keys, usable straight away', () => {
    const g = rich(100, 200)
    const before = g.lockers.total
    const money = g.economy.money
    expect(g.buyUpgrade('bank2').ok).toBe(true)
    expect(g.economy.money).toBe(money - 90)
    expect(g.lockers.total).toBe(before + 6)
    expect(g.lockers.bankCount).toBe(2)
    expect(g.lockers.availableCount).toBe(12)
    const newest = g.lockers.all().at(-1)!
    expect(newest.bank).toBe(1)
    expect(g.keys.get(newest.keyId).lockerId).toBe(newest.id)
    expect(g.buyUpgrade('bank2').ok).toBe(false) // can't buy it twice
    const notice = g.drainNotices().find((n) => n.type === 'upgradeBought')
    expect(notice).toMatchObject({ id: 'bank2', kind: 'lockerBank', index: 1 })

    // The new locker works for a real deposit, with its key on a hook of the new rack.
    expect(g.openLocker(newest.id).ok).toBe(true)
  })

  it('a key rack adds eight hooks that can be used', () => {
    const g = rich(100, 200)
    expect(g.keys.hookCount).toBe(8)
    expect(g.buyUpgrade('rack2').ok).toBe(true)
    expect(g.keys.hookCount).toBe(16)
    const notice = g.drainNotices().find((n) => n.type === 'upgradeBought')
    expect(notice).toMatchObject({ id: 'rack2', kind: 'keyRack', index: 1 })
    g.keys.move('key-1', { kind: 'hook', hook: 15 })
    expect(g.keys.onHook(15)?.id).toBe('key-1')
    expect(() => g.keys.move('key-2', { kind: 'hook', hook: 16 })).toThrow()
  })

  it('more storage lets more customers be active at once, and levels speed customers up', () => {
    const open = CONFIG.stages.find((s) => s.maxActive !== undefined)!
    const g = rich(300, 1000)
    const baseline = g.scheduler.pace
    expect(baseline).toBe(1)
    g.buyUpgrade('bank2')
    g.buyUpgrade('bank3')
    expect(g.lockers.total).toBe(18)
    // Level 3 (300 xp): pace is 20 % faster once the next arrival is scheduled.
    ;(g as unknown as { scheduleNextArrival(): void }).scheduleNextArrival()
    expect(g.scheduler.pace).toBeCloseTo(1 + CONFIG.progression.paceBonusPerLevel * 2)
    expect(open.maxActive! + (g.lockers.total - 6)).toBeGreaterThan(open.maxActive!)
  })

  it('the objective points at the catalogue when you can afford something and nothing else is going on', () => {
    const d = new Driver()
    d.finishTutorial()
    d.game.economy.xp = 100
    d.game.economy.money = 500
    expect(d.game.objective()).toMatch(/catalogue/i)
  })

  it('the catalogue cannot be opened mid-conversation', () => {
    const d = new Driver()
    d.until(() => d.waiting().length === 1)
    d.game.talkTo(d.waiting()[0]!)
    expect(d.game.openCatalogue().ok).toBe(false)
    d.game.closeDialogue()
    expect(d.game.openCatalogue().ok).toBe(true)
    expect(d.game.catalogueOpen).toBe(true)
  })
})

describe('stage config sanity', () => {
  it('every stage keeps its return window inside sane bounds', () => {
    const check = (s: ArrivalStage) => expect(s.returnAfter[0]).toBeLessThanOrEqual(s.returnAfter[1])
    CONFIG.stages.forEach(check)
  })
})

describe('Bug fix: you cannot skip locking up', () => {
  /** A customer at the counter whose bag you have stored in locker-3, door still open, key still in the lock. */
  function storedButNotLocked() {
    const d = new Driver()
    d.until(() => d.waiting().length === 1)
    const id = d.waiting()[0]!
    const g = d.game
    g.talkTo(id)
    g.choose('greet')
    g.choose('accept')
    g.openLocker('locker-3')
    g.putItem('locker-3')
    return { d, g, id }
  }

  it('will not let you say "it is stored" while the locker door is open', () => {
    const { g, id } = storedButNotLocked()
    g.talkTo(id)
    const option = g.dialogueOptions().find((o) => o.id === 'confirmStored')
    expect(option?.disabled).toBe('Close the locker door first.')
    const result = g.choose('confirmStored')
    expect(result.ok).toBe(false)
    expect(g.customers.get(id).state).toBe('depositing')
    expect(g.clock.peekEarliest()?.event.type).not.toBe('customerReturn')
  })

  it('also needs the key out of the lock, which is what locks it', () => {
    const { g, id } = storedButNotLocked()
    g.closeLocker('locker-3')
    g.talkTo(id)
    expect(g.dialogueOptions().find((o) => o.id === 'confirmStored')?.disabled).toBe('Take the key out of the lock to lock it.')
    expect(g.choose('confirmStored').ok).toBe(false)
    expect(g.customers.get(id).state).toBe('depositing')
  })

  it('works once the door is shut and the key is out, even if you are still holding the key', () => {
    const { g, id } = storedButNotLocked()
    g.closeLocker('locker-3')
    g.takeKeyFromLock('locker-3')
    expect(g.hands?.kind).toBe('key')
    g.talkTo(id)
    expect(g.dialogueOptions().find((o) => o.id === 'confirmStored')?.disabled).toBeNull()
    expect(g.choose('confirmStored').ok).toBe(true)
    expect(g.customers.get(id).state).toBe('stored')
    expect(g.lockers.get('locker-3').locked).toBe(true)
  })

  it('the objective tells you what is left to do', () => {
    const { g } = storedButNotLocked()
    expect(g.objective()).toBe('Close the locker door.')
    g.closeLocker('locker-3')
    expect(g.objective()).toBe('Take the key out of the locker to lock it.')
  })
})

describe('Labels and the deposit register board', () => {
  function afterTutorial(xp = 100, money = 500) {
    const d = new Driver()
    d.finishTutorial()
    d.game.economy.xp = xp
    d.game.economy.money = money
    return d
  }

  it('labels cost money, need level 2, and switch on numbering', () => {
    const g = new GameManager(3)
    expect(g.hasLabels).toBe(false)
    expect(g.facilityLabel()).toBe('Basic facility')
    g.economy.money = 1000
    expect(g.buyUpgrade('labels').message).toBe('Needs level 2')
    g.economy.xp = 100
    g.economy.money = 20
    expect(g.buyUpgrade('labels').message).toMatch(/Costs \$60/)
    g.economy.money = 100
    expect(g.buyUpgrade('labels').ok).toBe(true)
    expect(g.economy.money).toBe(40)
    expect(g.hasLabels).toBe(true)
    expect(g.facilityLabel()).toBe('Organised facility')
    expect(g.drainNotices().find((n) => n.type === 'upgradeBought')).toMatchObject({ id: 'labels', kind: 'labels' })
  })

  it('every key belongs to exactly the locker with the matching number', () => {
    const g = new GameManager(3)
    for (const locker of g.lockers.all()) {
      expect(g.keys.get(locker.keyId).lockerId).toBe(locker.id)
      expect(locker.keyId).toBe(`key-${locker.number}`)
    }
  })

  it('the register board needs the labels first, and starts empty', () => {
    const d = afterTutorial()
    const g = d.game
    expect(g.buyUpgrade('register').message).toBe('Buy Locker & key labels first')
    expect(g.registerEntries()).toEqual([])
    g.buyUpgrade('labels')
    expect(g.buyUpgrade('register').ok).toBe(true)
    expect(g.registerEntries()).toEqual([])
  })

  it('without the board nothing is recorded, with it every stored bag is listed and updates itself', () => {
    const d = afterTutorial(100, 1000)
    const g = d.game
    d.until(() => d.waiting().length >= 1)
    const first = d.waiting()[0]!
    const lockerA = d.deposit(first)
    expect(g.registerEntries()).toEqual([]) // not bought yet

    g.buyUpgrade('labels')
    g.buyUpgrade('register')
    d.until(() => d.waiting().length >= 1)
    const second = d.waiting()[0]!
    const lockerB = d.deposit(second)

    const entries = g.registerEntries()
    expect(entries.map((e) => e.customerId)).toEqual([first, second]) // oldest first
    expect(entries[0]).toMatchObject({
      name: g.customers.get(first).name,
      lockerNumber: g.lockers.get(lockerA).number,
      itemLabel: g.customers.itemOf(g.customers.get(first))!.label,
    })
    expect(entries[1]!.lockerNumber).toBe(g.lockers.get(lockerB).number)

    // When a customer collects their bag, their line disappears.
    const back = waitUntilBack(d, first)
    d.collect(back.id)
    expect(g.registerEntries().map((e) => e.customerId)).toEqual([second])
  })

  it('the board lists a bag only while it is in a locker (not while you carry it)', () => {
    const d = afterTutorial(100, 1000)
    const g = d.game
    g.buyUpgrade('labels')
    g.buyUpgrade('register')
    const { id, lockerId } = stored(d)
    expect(g.registerEntries()).toHaveLength(1)
    const back = waitUntilBack(d, id)
    const key = g.keys.get(g.lockers.get(lockerId).keyId)
    if (key.location.kind !== 'hook') throw new Error('key not on a hook')
    g.takeKeyFromHook(key.location.hook)
    g.useKeyOn(lockerId)
    g.takeItem(lockerId)
    expect(g.registerEntries()).toHaveLength(0)
    expect(back.state).toBe('waitingForCollection')
  })
})

describe('The register only shows names you asked for', () => {
  function withBoard() {
    const d = new Driver()
    d.finishTutorial()
    d.game.economy.xp = 100
    d.game.economy.money = 1000
    d.game.buyUpgrade('labels')
    d.game.buyUpgrade('register')
    return d
  }

  it('a bag taken without asking the name is listed without a name (but with locker and item)', () => {
    const d = withBoard()
    const g = d.game
    d.until(() => d.waiting().length >= 1)
    const id = d.waiting()[0]!
    const lockerId = d.deposit(id, { askName: false })
    const [entry] = g.registerEntries()
    expect(entry).toBeDefined()
    expect(entry!.name).toBeNull()
    expect(entry!.lockerNumber).toBe(g.lockers.get(lockerId).number)
    expect(entry!.itemLabel).toBe(g.customers.itemOf(g.customers.get(id))!.label)
  })

  it('asking the name when they drop the bag off puts it on the board', () => {
    const d = withBoard()
    d.until(() => d.waiting().length >= 1)
    const id = d.waiting()[0]!
    d.deposit(id, { askName: true })
    expect(d.game.registerEntries()[0]!.name).toBe(d.game.customers.get(id).name)
  })

  it('asking on the way back does not retroactively fill in the board', () => {
    const d = withBoard()
    const g = d.game
    d.until(() => d.waiting().length >= 1)
    const id = d.waiting()[0]!
    d.deposit(id, { askName: false })
    waitUntilBack(d, id)
    g.talkTo(id)
    g.choose('askName')
    expect(g.customers.get(id).visit.askedName).toBe(true)
    expect(g.customers.get(id).nameTaken).toBe(false)
    expect(g.registerEntries()[0]!.name).toBeNull()
  })

  it('mixed: one named and one nameless entry on the same board', () => {
    const d = withBoard()
    d.until(() => d.waiting().length >= 1)
    const a = d.waiting()[0]!
    d.deposit(a, { askName: true })
    d.until(() => d.waiting().length >= 1)
    const b = d.waiting()[0]!
    d.deposit(b, { askName: false })
    expect(d.game.registerEntries().map((e) => e.name !== null)).toEqual([true, false])
  })
})

describe('Building expansion: annexes', () => {
  /** A game at `level` with plenty of cash and the storage banks already bought (annex prerequisite). */
  function expandable(xp = 600) {
    const g = new GameManager(3)
    g.economy.xp = xp
    g.economy.money = 5000
    g.buyUpgrade('bank2')
    g.buyUpgrade('bank3')
    g.drainNotices()
    return g
  }

  it('needs level 4, all the locker banks and the money, and says which is missing', () => {
    const g = new GameManager(3)
    g.economy.money = 5000
    g.economy.xp = 300 // level 3
    expect(g.buyUpgrade('annexWest').message).toBe('Needs level 4')
    g.economy.xp = 600
    expect(g.economy.level.level).toBe(4)
    expect(g.buyUpgrade('annexWest').message).toBe('Buy Locker bank C first')
    g.buyUpgrade('bank2')
    g.buyUpgrade('bank3')
    g.economy.money = 100
    expect(g.buyUpgrade('annexWest').message).toMatch(/Costs \$450/)
    expect(g.upgrades.has('annexWest')).toBe(false)
  })

  it('the west annex adds a hall: two banks (12 lockers with keys) and two racks (16 hooks)', () => {
    const g = expandable()
    const lockers = g.lockers.total
    const hooks = g.keys.hookCount
    const money = g.economy.money
    expect(g.hasAnnex()).toBe(false)
    expect(g.buyUpgrade('annexWest').ok).toBe(true)
    expect(g.economy.money).toBe(money - 450)
    expect(g.lockers.total).toBe(lockers + 12)
    expect(g.keys.hookCount).toBe(hooks + 16)
    expect(g.lockers.bankCount).toBe(5)
    expect(g.hasAnnex('west')).toBe(true)
    expect(g.hasAnnex('east')).toBe(false)
    expect(g.facilityLabel()).toBe('Expanded facility')
    const notice = g.drainNotices().find((n) => n.type === 'upgradeBought')
    expect(notice).toMatchObject({ id: 'annexWest', kind: 'annex', side: 'west', banks: [3, 4] })
    if (notice?.type !== 'upgradeBought') return
    expect(notice.racks).toHaveLength(2)
    // The new hooks belong to those racks: rack n owns hooks 8n … 8n+7.
    expect(Math.max(...notice.racks!) * 8 + 7).toBe(g.keys.hookCount - 1)
    // Every new locker has its own key, and is usable straight away.
    for (const locker of g.lockers.all().filter((l) => l.bank >= 3)) {
      expect(g.keys.get(locker.keyId).lockerId).toBe(locker.id)
      expect(locker.state).toBe('available')
    }
    expect(g.openLocker(g.lockers.all().at(-1)!.id).ok).toBe(true)
  })

  it('the east annex needs the west one, and the two together make 42 lockers', () => {
    const g = expandable(1000)
    expect(g.buyUpgrade('annexEast').message).toBe('Buy Storage annex (west) first')
    expect(g.buyUpgrade('annexWest').ok).toBe(true)
    expect(g.buyUpgrade('annexEast').ok).toBe(true)
    expect(g.lockers.total).toBe(42)
    expect(g.lockers.availableCount).toBe(42)
    const east = g.drainNotices().filter((n) => n.type === 'upgradeBought').at(-1)
    expect(east).toMatchObject({ id: 'annexEast', side: 'east', banks: [5, 6] })
    expect(g.buyUpgrade('annexEast').ok).toBe(false) // only once
  })

  it('a bigger building allows more customers at once in open trading', () => {
    const g = expandable(1000)
    const open = CONFIG.stages.find((s) => s.maxActive !== undefined)!
    const extra = (x: GameManager) => x.lockers.total - CONFIG.facility.lockerRows * CONFIG.facility.lockerCols
    const before = open.maxActive! + extra(g)
    g.buyUpgrade('annexWest')
    expect(open.maxActive! + extra(g)).toBe(before + 12)
  })
})
