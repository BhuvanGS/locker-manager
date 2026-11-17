import { describe, expect, it } from 'vitest'
import { CONFIG, WAREHOUSE_UPGRADES, type CargoType } from './config'
import { DealManager } from './DealManager'
import { GameManager } from './GameManager'
import { WarehouseManager, type WarehouseEvent } from './WarehouseManager'

const w = CONFIG.warehouse
const always = (v: number) => () => v

/** A bare warehouse and deal book, and a clock to drive them with. */
function bare() {
  const wh = new WarehouseManager()
  const deals = new DealManager()
  let now = 0
  wh.start(now)
  const events: WarehouseEvent[] = []
  return {
    wh,
    deals,
    events,
    get now() {
      return now
    },
    run(seconds: number, rand: () => number = always(0.5), step = 0.5) {
      for (let t = 0; t < seconds - 1e-9; t += step) {
        now += step
        events.push(...wh.update(step, now, deals, rand))
      }
    },
  }
}

/** Keep every stored consignment where it is (the owners do not come to collect them). */
function hold(b: ReturnType<typeof bare>): void {
  for (const c of b.wh.consignments) c.collectAt = Number.POSITIVE_INFINITY
}

/** Put a load on the dock directly (as if its truck had just unloaded). */
function onDock(b: ReturnType<typeof bare>, cargo: CargoType, crates = 3, declared: CargoType = cargo === 'illegal' ? 'general' : cargo) {
  b.wh.receiving.push({
    id: 1000 + b.wh.receiving.length,
    owner: 'Test (kei truck)',
    kind: 'kei',
    cargo,
    declared,
    crates,
    dealId: null,
    arrivedAt: b.now,
    inspected: false,
    inspectDone: null,
    spoiled: false,
  })
  return b.wh.receiving.at(-1)!
}

describe('The warehouse (game rules)', () => {
  it('needs level 8 and the south expansion, and costs money', () => {
    const g = new GameManager(3)
    g.economy.money = 100_000
    g.economy.xp = 2000
    expect(g.buyUpgrade('warehouse').message).toBe('Needs level 8')
    g.economy.xp = 2800
    expect(g.buyUpgrade('warehouse').message).toBe('Buy South expansion first')
    expect(g.hasWarehouse).toBe(false)
  })

  it('loads wait on the dock until you process them; the objective sends you to the receiving desk', () => {
    const g = new GameManager(3)
    g.grantUpgrade('warehouse')
    g.tutorialComplete = true
    for (let t = 0; t < w.firstKeiDelay + w.arriveSeconds + w.unloadSeconds + 2; t += 0.5) g.update(0.5)
    expect(g.warehouse.receiving).toHaveLength(1)
    expect(g.warehouse.stored).toBe(0)
    expect(g.objective()).toMatch(/waiting at the warehouse dock/)
    const load = g.receivingLoads()[0]!
    expect(load.goesTo).not.toBeNull()
    expect(g.openReceiving().ok).toBe(true)
    expect(g.receive(load.id, 'store').ok).toBe(true)
    expect(g.warehouse.receiving).toHaveLength(0)
    expect(g.warehouse.stored).toBe(load.crates)
  })

  it('the owner comes back, collects, and pays by what was in the crates', () => {
    const b = bare()
    const load = onDock(b, 'metals', 2)
    b.wh.applyUpgrade('wh-vault')
    expect(b.wh.store(load.id, b.now, 0).ok).toBe(true)
    const c = b.wh.consignments[0]!
    expect(c.section).toBe('vault') // metals go in the vault
    b.run(w.keiStay[1] + w.arriveSeconds + w.unloadSeconds + 5)
    expect(b.wh.consignments).toHaveLength(0)
    const paid = b.events.find((e) => e.type === 'collected')
    expect(paid).toMatchObject({ type: 'collected', crates: 2, paid: Math.round(2 * w.cargo.metals.fee) })
  })
})

describe('What a load looks like', () => {
  it('contraband is declared as general goods: you only know when you open it or have the scanner', () => {
    const b = bare()
    const load = onDock(b, 'illegal', 4)
    expect(b.wh.visibleCargo(load)).toBe('general')
    expect(b.wh.inspect(load.id, b.now)).toBe(true)
    expect(b.wh.visibleCargo(load)).toBe('general') // still opening
    expect(b.wh.store(load.id, b.now).ok).toBe(false) // cannot store a load that is being opened
    b.run(w.inspectSeconds + 1)
    expect(b.wh.visibleCargo(load)).toBe('illegal')

    const scanned = bare()
    scanned.wh.applyUpgrade('wh-scanner')
    const other = onDock(scanned, 'illegal', 2)
    scanned.run(1)
    expect(scanned.wh.visibleCargo(other)).toBe('illegal')
  })

  it('loads go where they look like they belong, and fall back to the shelves', () => {
    const b = bare()
    expect(b.wh.placeFor('cold', 3)).toBe('shelves') // no cold room yet
    b.wh.applyUpgrade('wh-cold')
    expect(b.wh.placeFor('cold', 3)).toBe('cold')
    expect(b.wh.placeFor('metals', 3)).toBe('shelves')
    b.wh.applyUpgrade('wh-vault')
    expect(b.wh.placeFor('metals', 3)).toBe('vault')
    expect(b.wh.placeFor('illegal', 3)).toBe('shelves')
    b.wh.applyUpgrade('wh-hidden-1')
    expect(b.wh.placeFor('illegal', 3)).toBe('hidden')
    expect(b.wh.placeFor('general', b.wh.capacity + 1)).toBeNull() // nothing has room for that
  })

  it('a load that looks like general goods but is contraband ends up on the open shelves, where the police will find it', () => {
    const b = bare()
    b.wh.applyUpgrade('wh-hidden-1')
    const load = onDock(b, 'illegal', 3) // looks general
    expect(b.wh.store(load.id, b.now).ok).toBe(true)
    expect(b.wh.consignments[0]!.section).toBe('shelves')
  })
})

describe('Going off, and being stolen', () => {
  it('cold-chain goods spoil on the dock or the shelves, but not in the cold room', () => {
    const b = bare()
    const cold = onDock(b, 'cold', 2)
    b.run(w.coldSpoilSeconds + 5)
    expect(cold.spoiled).toBe(true)
    expect(b.events.some((e) => e.type === 'spoiled')).toBe(true)

    const fresh = bare()
    fresh.wh.applyUpgrade('wh-cold')
    const load = onDock(fresh, 'cold', 2)
    expect(fresh.wh.store(load.id, fresh.now, 1).ok).toBe(true)
    hold(fresh)
    fresh.run(w.coldSpoilSeconds * 3, always(0.5), 1)
    expect(fresh.wh.consignments.find((c) => c.cargo === 'cold')?.spoiled).toBe(false)
  })

  it('food goes off after its shelf life, and spoiled goods earn nothing', () => {
    const b = bare()
    const load = onDock(b, 'food', 2)
    expect(b.wh.store(load.id, b.now, 0).ok).toBe(true)
    hold(b)
    b.run(w.foodShelfLife + 5, always(0.5), 1)
    expect(b.wh.consignments[0]?.spoiled).toBe(true)
    b.wh.consignments[0]!.collectAt = b.now // now the owner comes for it
    b.run(w.arriveSeconds + w.unloadSeconds + 30, always(0.5), 1)
    const collected = b.events.find((e) => e.type === 'collected')
    expect(collected).toMatchObject({ paid: 0, spoiled: true })
  })

  it('special metals are stolen from the open shelves, but not from the vault', () => {
    const open = bare()
    const a = onDock(open, 'metals', 3)
    open.wh.store(a.id, open.now)
    open.run(w.theft.every * 3, always(0)) // rand 0: always "unlucky"
    expect(open.events.some((e) => e.type === 'stolen')).toBe(true)

    const safe = bare()
    safe.wh.applyUpgrade('wh-vault')
    const v = onDock(safe, 'metals', 3)
    safe.wh.store(v.id, safe.now)
    safe.run(w.theft.every * 3, always(0))
    expect(safe.events.some((e) => e.type === 'stolen')).toBe(false)
  })
})

describe('The police', () => {
  function bigWarehouse() {
    const b = bare()
    b.wh.applyUpgrade('wh-cap-1')
    return b
  }
  /** Store a load of `cargo` and run until the police have come and gone. */
  function visit(b: ReturnType<typeof bare>, rand: () => number) {
    hold(b)
    b.run(w.police.gap[1] + w.police.arriveSeconds + w.police.inspectSeconds + w.police.leaveSeconds + 5, rand, 1)
    return b.events.find((e) => e.type === 'police')
  }

  it('they do not come to a small warehouse', () => {
    const b = bare()
    const load = onDock(b, 'general', 2)
    b.wh.store(load.id, b.now)
    b.run(1500, always(0.5), 1)
    expect(b.events.some((e) => e.type === 'policeArrived')).toBe(false)
  })

  it('they come rarely, once it is big, and a clean warehouse earns a good word', () => {
    const b = bigWarehouse()
    const load = onDock(b, 'general', w.police.minCrates)
    b.wh.store(load.id, b.now)
    const result = visit(b, always(0.5))
    expect(b.events.some((e) => e.type === 'policeArrived')).toBe(true)
    expect(result).toMatchObject({ type: 'police', fine: 0, illegalFound: false })
  })

  it('contraband on the open shelves is found, fined per crate and seized', () => {
    const b = bigWarehouse()
    const filler = onDock(b, 'general', w.police.minCrates)
    b.wh.store(filler.id, b.now)
    const bad = onDock(b, 'illegal', 3)
    b.wh.store(bad.id, b.now)
    const result = visit(b, always(0.5))
    expect(result).toMatchObject({ fine: 3 * w.police.illegalFinePerCrate, seizedCrates: 3, illegalFound: true })
    expect(b.wh.consignments.some((c) => c.cargo === 'illegal')).toBe(false)
  })

  it('hidden contraband is found only sometimes, less with deeper hiding', () => {
    const find = (level: 1 | 2, roll: number) => {
      const b = bigWarehouse()
      b.wh.applyUpgrade('wh-hidden-1')
      if (level === 2) b.wh.applyUpgrade('wh-hidden-2')
      b.wh.applyUpgrade('wh-scanner') // so we know to put it in the hidden section
      const filler = onDock(b, 'general', w.police.minCrates)
      b.wh.store(filler.id, b.now)
      const bad = onDock(b, 'illegal', 3)
      expect(b.wh.store(bad.id, b.now).ok).toBe(true)
      expect(b.wh.consignments.at(-1)?.section).toBe('hidden')
      const ev = visit(b, always(roll))
      return ev?.type === 'police' && ev.illegalFound
    }
    expect(find(1, 0.3)).toBe(true) // 40 % chance: a roll of 0.3 finds it
    expect(find(1, 0.5)).toBe(false)
    expect(find(2, 0.3)).toBe(false) // only 20 % at level 2
    expect(find(2, 0.1)).toBe(true)
  })

  it('special metals are fined unless you have the licence', () => {
    const run = (permit: boolean) => {
      const b = bigWarehouse()
      b.wh.applyUpgrade('wh-vault')
      if (permit) b.wh.applyUpgrade('wh-permit')
      const filler = onDock(b, 'general', w.police.minCrates)
      b.wh.store(filler.id, b.now)
      const metals = onDock(b, 'metals', 2)
      b.wh.store(metals.id, b.now)
      const ev = visit(b, always(0.99))
      return ev?.type === 'police' ? ev.fine : -1
    }
    expect(run(false)).toBe(w.police.metalsFine)
    expect(run(true)).toBe(0)
  })

  it('in the game a fine comes out of your money and a find costs reputation', () => {
    const g = new GameManager(3)
    g.grantUpgrade('wh-cap-1')
    g.warehouse.receiving.push({
      id: 1,
      owner: 'Shady (kei truck)',
      kind: 'kei',
      cargo: 'illegal',
      declared: 'general',
      crates: 4,
      dealId: null,
      arrivedAt: g.now,
      inspected: false,
      inspectDone: null,
      spoiled: false,
    })
    g.warehouse.receiving.push({ ...g.warehouse.receiving[0]!, id: 2, cargo: 'general', crates: w.police.minCrates })
    expect(g.receive(1, 'store').ok).toBe(true)
    expect(g.receive(2, 'store').ok).toBe(true)
    for (const c of g.warehouse.consignments) c.collectAt = Number.POSITIVE_INFINITY
    const money = g.economy.money
    const rep = g.economy.reputation
    for (let t = 0; t < w.police.gap[1] + 60; t += 0.5) g.update(0.5)
    expect(g.economy.money).toBeLessThan(money)
    expect(g.economy.reputation).toBeLessThan(rep)
  })
})

describe('The receiving dock', () => {
  it('a full dock holds the trucks back in the road', () => {
    const b = bare()
    for (let i = 0; i < w.dockSlots; i++) onDock(b, 'general', 1)
    b.run(w.firstKeiDelay + 5)
    expect(b.wh.truck).toBeNull() // the kei trucker is waiting in the road
    expect(b.wh.waiting).toBeGreaterThanOrEqual(1)
    b.wh.refuse(b.wh.receiving[0]!.id, b.deals)
    b.run(2)
    expect(b.wh.truck).not.toBeNull()
  })

  it('refusing a VIP load sends it back to be delivered again later', () => {
    const b = bare()
    b.deals.signed.push({
      id: 5, name: 'Elan Husk', title: 'CEO', cargo: 'batteries', cargoType: 'metals', crates: 10, retainer: 300, signedAt: 0, delivered: 0, inTransit: 10, nextDeliveryAt: 99999,
    })
    b.wh.receiving.push({
      id: 1, owner: 'Elan Husk', kind: 'vip', cargo: 'metals', declared: 'metals', crates: 10, dealId: 5, arrivedAt: 0, inspected: false, inspectDone: null, spoiled: false,
    })
    b.wh.refuse(1, b.deals)
    expect(b.deals.signed[0]!.inTransit).toBe(0)
    expect(b.deals.signed[0]!.delivered).toBe(0)
  })
})

describe('Automation: the receiving robots', () => {
  it('robots store loads for you, one every few seconds, by what they look like', () => {
    const b = bare()
    b.wh.applyUpgrade('wh-auto-1')
    onDock(b, 'general', 2)
    onDock(b, 'food', 2)
    b.run(w.autoSeconds[1]! * 3, always(0.5), 0.5)
    expect(b.wh.receiving).toHaveLength(0)
    expect(b.wh.consignments.length).toBeGreaterThanOrEqual(2) // (a trucker who turned up meanwhile is stored too)
    b.wh.applyUpgrade('wh-auto-2')
    expect(w.autoSeconds[2]).toBeLessThan(w.autoSeconds[1]!)
  })

  it('without the scanner the robots happily put contraband on the shelves; with it they refuse it, or hide it if there is room', () => {
    const blind = bare()
    blind.wh.applyUpgrade('wh-auto-1')
    onDock(blind, 'illegal', 2)
    blind.run(w.autoSeconds[1]! * 2)
    expect(blind.wh.consignments[0]?.section).toBe('shelves')

    const refuses = bare()
    refuses.wh.applyUpgrade('wh-auto-1')
    refuses.wh.applyUpgrade('wh-scanner')
    onDock(refuses, 'illegal', 2)
    refuses.run(w.autoSeconds[1]! * 2)
    expect(refuses.wh.consignments).toHaveLength(0)
    expect(refuses.events.some((e) => e.type === 'refused')).toBe(true)

    const hides = bare()
    hides.wh.applyUpgrade('wh-auto-1')
    hides.wh.applyUpgrade('wh-scanner')
    hides.wh.applyUpgrade('wh-hidden-1')
    onDock(hides, 'illegal', 2)
    hides.run(w.autoSeconds[1]! * 2)
    expect(hides.wh.consignments[0]?.section).toBe('hidden')
  })

  it('signed VIP deals are delivered in box-truck loads and collected, with the robots doing the receiving', () => {
    const b = bare()
    b.wh.applyUpgrade('wh-cap-1')
    b.wh.applyUpgrade('wh-cap-2')
    b.wh.applyUpgrade('wh-auto-1')
    b.deals.signed.push({
      id: 99, name: 'Beff Jezoz', title: 'Founder, Amazin', cargo: 'parcels', cargoType: 'general', crates: 25, retainer: 400, signedAt: 0, delivered: 0, inTransit: 0, nextDeliveryAt: w.firstDeliveryDelay,
    })
    b.run(600, always(0.5), 0.5)
    expect(b.deals.signed[0]!.delivered).toBe(25)
    expect(b.deals.signed[0]!.inTransit).toBe(0)
    b.run(w.vipStay + 600, always(0.5), 1)
    expect(b.wh.consignments.filter((c) => c.kind === 'vip')).toHaveLength(0)
    expect(b.events.filter((e) => e.type === 'collected' && e.vip).length).toBeGreaterThanOrEqual(3)
  })
})

describe('Warehouse upgrades (the warehouse console)', () => {
  it('each has a price, a level and what it needs, and is bought at the warehouse console', () => {
    const g = new GameManager(3)
    expect(g.openConsole('warehouse').ok).toBe(false)
    g.grantUpgrade('warehouse')
    expect(g.openConsole('warehouse').ok).toBe(true)
    expect(g.consoleItems('warehouse').map((i) => i.id)).toEqual(WAREHOUSE_UPGRADES.map((u) => u.id))
    g.economy.money = 100_000
    g.economy.xp = 2800 // level 8
    expect(g.buyAutomation('wh-cap-2').message).toBe('Buy Rack row (north) first')
    expect(g.buyAutomation('wh-vault').message).toBe('Needs level 9')
    g.economy.xp = 6000
    const money = g.economy.money
    expect(g.buyAutomation('wh-cap-1').ok).toBe(true)
    expect(g.economy.money).toBe(money - WAREHOUSE_UPGRADES.find((u) => u.id === 'wh-cap-1')!.cost)
    expect(g.warehouse.capacity).toBe(w.startShelves + 12)
    expect(g.buyAutomation('wh-cap-1').ok).toBe(false) // only once
    for (const id of ['wh-cold', 'wh-vault', 'wh-permit', 'wh-scanner', 'wh-hidden-1', 'wh-hidden-2', 'wh-auto-1', 'wh-auto-2']) expect(g.buyAutomation(id).ok).toBe(true)
    expect(g.warehouse).toMatchObject({ coldCapacity: 12, vaultCapacity: 8, permit: true, scanner: true, hiddenLevel: 2, hiddenCapacity: 16, autoLevel: 2 })
  })

  it('the mod menu can unlock any of them with everything it needs', () => {
    const g = new GameManager(3)
    expect(g.grantUpgrade('wh-auto-2').ok).toBe(true)
    for (const id of ['warehouse', 'wh-cap-1', 'wh-auto-1', 'wh-auto-2']) expect(g.upgrades.has(id) || g.warehouse.has(id)).toBe(true)
  })
})
