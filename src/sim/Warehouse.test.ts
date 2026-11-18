import { describe, expect, it } from 'vitest'
import { CONFIG, WAREHOUSE_UPGRADES, type CargoType, type Section } from './config'
import { DealManager } from './DealManager'
import { GameManager } from './GameManager'
import { WarehouseManager, type Load, type WarehouseEvent } from './WarehouseManager'

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
type Bare = Pick<ReturnType<typeof bare>, 'wh' | 'deals' | 'now'>

/** Keep every stored consignment where it is (the owners do not come to collect them). */
function hold(b: Bare): void {
  for (const c of b.wh.consignments) c.collectAt = Number.POSITIVE_INFINITY
}

let nextId = 1000
/** Park a delivery truck beside the shed directly (as if it had just pulled in). */
function parked(b: Bare, cargo: CargoType, crates = 3, declared: CargoType = cargo === 'illegal' ? 'general' : cargo, kind: Load['kind'] = 'kei'): Load {
  const id = ++nextId
  const spot = [0, 1, 2, 3, 4, 5, 6, 7].find((s) => !b.wh.trucks.some((t) => t.spot === s))!
  b.wh.trucks.push({ id, kind: kind === 'vip' ? 'box' : 'kei', job: 'deliver', owner: 'Test (kei truck)', loadId: id, spot, onBoard: crates, declared, phase: 'parked', t: 0, paid: 0, spoiled: false })
  const load: Load = {
    id,
    owner: 'Test (kei truck)',
    kind,
    cargo,
    declared,
    crates,
    taken: 0,
    dealId: null,
    arrivedAt: b.now,
    collectAt: b.now + 100,
    inspected: false,
    inspectDone: null,
    spoiled: false,
    truckId: id,
  }
  b.wh.loads.push(load)
  return load
}

/** Run until the contact turns up with a drop, agree, and take his first crate: returns his record (you are left holding one crate). */
function contactDrop(b: ReturnType<typeof bare>, crates = 3) {
  for (let i = 0; i < 2000 && !(b.wh.contact?.job === 'drop' && b.wh.contact.phase === 'asking'); i++) b.run(1)
  const c = b.wh.contact!
  expect(c).toMatchObject({ job: 'drop', phase: 'asking' })
  c.crates = crates
  expect(b.wh.agreeContact().ok).toBe(true)
  expect(b.wh.takeFromContact(b.now).ok).toBe(true)
  return c
}

/** Carry every crate of a parked load in, to `section` (or where it looks like it belongs). */
function carryIn(b: Bare, load: Load, section?: Section): void {
  const target = section ?? b.wh.placeFor(b.wh.visibleCargo(load), load.crates)!
  while (load.taken < load.crates) {
    expect(b.wh.takeFromTruck(load.truckId, b.now).ok).toBe(true)
    expect(b.wh.storeCarried(target, b.deals).ok).toBe(true)
  }
}

/** Run until `loadId`'s collection truck has parked, sending back any kei deliveries that turn up meanwhile (they would take the spots). */
function untilCollection(b: ReturnType<typeof bare>, loadId: number) {
  for (let i = 0; i < 300; i++) {
    for (const l of [...b.wh.loads]) if (l.taken === 0) b.wh.refuse(l.id, b.deals)
    const truck = b.wh.trucks.find((t) => t.job === 'collect' && t.loadId === loadId && t.phase === 'parked')
    if (truck) return truck
    b.run(1, always(0.5), 1)
  }
  throw new Error('no collection truck came')
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

  it('a truck parks beside the shed, and you carry its crates in one at a time', () => {
    const g = new GameManager(3)
    g.grantUpgrade('warehouse')
    g.tutorialComplete = true
    for (let t = 0; t < w.firstKeiDelay + w.arriveSeconds + 2; t += 0.5) g.update(0.5)
    const wh = g.warehouse
    const truck = wh.trucks[0]!
    expect(truck.phase).toBe('parked')
    expect(wh.stored).toBe(0)
    expect(g.objective()).toMatch(/carry its crates in/)
    const load = g.receivingLoads()[0]!
    expect(load.onTruck).toBe(load.crates)

    expect(g.takeCrateFromTruck(truck.id).ok).toBe(true)
    expect(g.hands).toEqual({ kind: 'crate' })
    expect(g.carryingLabel()).toBeTruthy()
    expect(g.takeCrateFromTruck(truck.id).ok).toBe(false) // one at a time
    expect(g.objective()).toMatch(/Store the crate/)
    expect(g.storeCrate('cold').ok).toBe(false) // no cold room yet
    expect(g.storeCrate('shelves').ok).toBe(true)
    expect(g.hands).toBeNull()
    expect(wh.stored).toBe(1)
    expect(truck.onBoard).toBe(load.crates - 1)

    while (truck.onBoard > 0) {
      g.takeCrateFromTruck(truck.id)
      g.storeCrate('shelves')
    }
    expect(wh.stored).toBe(load.crates)
    expect(wh.loads).toHaveLength(0)
    expect(truck.phase).toBe('leaving') // empty: it drives off
  })

  it('the owner parks again, you carry the crates out to their truck, and they pay by what was in the crates', () => {
    const b = bare()
    b.wh.applyUpgrade('wh-vault')
    const load = parked(b, 'metals', 2)
    carryIn(b, load)
    expect(b.wh.consignments[0]!.section).toBe('vault') // metals go in the vault
    b.wh.consignments[0]!.collectAt = b.now
    b.run(w.leaveSeconds + w.arriveSeconds + 2)
    const truck = b.wh.trucks.find((t) => t.job === 'collect')!
    expect(truck.phase).toBe('parked')
    expect(b.wh.collectionFrom('vault')).toBe(truck)
    expect(b.wh.collectionFrom('shelves')).toBeUndefined()
    expect(b.wh.loadCarried(truck.id).ok).toBe(false) // nothing in your hands
    expect(b.wh.takeForCollection('vault').ok).toBe(true)
    expect(b.wh.loadCarried(truck.id, b.events).ok).toBe(true)
    expect(truck.phase).toBe('parked') // one more to go
    expect(b.wh.takeForCollection('vault').ok).toBe(true)
    expect(b.wh.loadCarried(truck.id, b.events).ok).toBe(true)
    expect(truck.phase).toBe('leaving')
    expect(b.wh.consignments).toHaveLength(0)
    expect(b.events.find((e) => e.type === 'collected')).toMatchObject({ type: 'collected', crates: 2, paid: 2 * Math.round(w.cargo.metals.fee) })
  })

  it("you can only load a crate onto its owner's truck", () => {
    const b = bare()
    const mine = parked(b, 'general', 1)
    const theirs = parked(b, 'general', 1)
    carryIn(b, mine)
    carryIn(b, theirs)
    hold(b)
    b.wh.consignments.find((c) => c.loadId === mine.id)!.collectAt = b.now
    b.run(w.leaveSeconds + w.arriveSeconds + 2)
    const truck = b.wh.trucks.find((t) => t.job === 'collect')!
    expect(truck.loadId).toBe(mine.id)
    // takeForCollection picks the crate the waiting truck wants.
    expect(b.wh.takeForCollection('shelves').ok).toBe(true)
    expect(b.wh.carrying?.loadId).toBe(mine.id)
    expect(b.wh.loadCarried(truck.id).ok).toBe(true)
  })

  it('a delivery nobody unloads gives up and drives off with what is still on board', () => {
    const b = bare()
    const load = parked(b, 'general', 3)
    b.wh.takeFromTruck(load.truckId, b.now)
    b.wh.storeCarried('shelves', b.deals)
    b.run(w.parkedPatience + 1)
    expect(b.wh.loads.includes(load)).toBe(false)
    expect(b.wh.truck(load.truckId)?.phase).toBe('leaving')
    expect(b.events).toContainEqual(expect.objectContaining({ type: 'refused', crates: 2, gaveUp: true }))
    expect(b.wh.cratesOf(load.id)).toBe(1) // what you carried in stays, and is collected later
  })

  it('parking spots are limited: the next truck waits in the road until one is free', () => {
    const b = bare()
    for (let i = 0; i < w.parkingSpots; i++) parked(b, 'general', 1)
    b.run(w.firstKeiDelay + 5)
    expect(b.wh.trucks).toHaveLength(w.parkingSpots)
    expect(b.wh.waiting).toBeGreaterThanOrEqual(1)
    b.wh.refuse(b.wh.loads[0]!.id, b.deals)
    b.run(w.leaveSeconds + 1)
    expect(b.wh.trucks.some((t) => t.owner !== 'Test (kei truck)')).toBe(true)
  })
})

describe('The receiving desk', () => {
  it('contraband is declared as general goods: you only know when you open a crate or have the scanner', () => {
    const b = bare()
    const load = parked(b, 'illegal', 4)
    expect(b.wh.visibleCargo(load)).toBe('general')
    expect(b.wh.inspect(load.id, b.now)).toBe(true)
    expect(b.wh.visibleCargo(load)).toBe('general') // still opening
    expect(b.wh.takeFromTruck(load.truckId, b.now).ok).toBe(false) // not while they are opening one
    b.run(w.inspectSeconds + 1)
    expect(b.wh.visibleCargo(load)).toBe('illegal')

    const scanned = bare()
    scanned.wh.applyUpgrade('wh-scanner')
    const other = parked(scanned, 'illegal', 2)
    scanned.run(1)
    expect(scanned.wh.visibleCargo(other)).toBe('illegal')
  })

  it('you can send a load back, but only before any of it is unloaded', () => {
    const g = new GameManager(3)
    g.grantUpgrade('warehouse')
    g.tutorialComplete = true
    for (let t = 0; t < w.firstKeiDelay + w.arriveSeconds + 2; t += 0.5) g.update(0.5)
    const truck = g.warehouse.trucks[0]!
    const loadId = g.warehouse.loads[0]!.id
    g.takeCrateFromTruck(truck.id)
    expect(g.receive(loadId, 'refuse').ok).toBe(false)
    g.storeCrate('shelves')
    expect(g.receive(loadId, 'refuse').ok).toBe(false)

    const b = bare()
    const load = parked(b, 'illegal', 2)
    expect(b.wh.refuse(load.id, b.deals)).toBe(load)
    expect(b.wh.loads).toHaveLength(0)
    expect(b.wh.truck(load.truckId)?.phase).toBe('leaving')
  })

  it('where a load belongs, with the fallback to the shelves', () => {
    const b = bare()
    expect(b.wh.placeFor('cold', 3)).toBe('shelves') // no cold room yet
    b.wh.applyUpgrade('wh-cold')
    expect(b.wh.placeFor('cold', 3)).toBe('cold')
    expect(b.wh.placeFor('metals', 3)).toBe('shelves')
    b.wh.applyUpgrade('wh-vault')
    expect(b.wh.placeFor('metals', 3)).toBe('vault')
    b.wh.applyUpgrade('wh-hidden-1')
    expect(b.wh.placeFor('illegal', 3)).toBe('shelves') // never the underground vault: only you go down there
    expect(b.wh.placeFor('general', b.wh.capacity + 1)).toBeNull() // nothing has room for that
  })

  it('a full section takes no more crates', () => {
    const b = bare()
    b.wh.applyUpgrade('wh-vault')
    const load = parked(b, 'metals', w.startShelves)
    for (let i = 0; i < b.wh.vaultCapacity; i++) {
      b.wh.takeFromTruck(load.truckId, b.now)
      expect(b.wh.storeCarried('vault', b.deals).ok).toBe(true)
    }
    b.wh.takeFromTruck(load.truckId, b.now)
    expect(b.wh.storeCarried('vault', b.deals).ok).toBe(false)
    expect(b.wh.carrying).not.toBeNull()
    expect(b.wh.storeCarried('shelves', b.deals).ok).toBe(true)
  })
})

describe('Going off, and being stolen', () => {
  it('cold-chain goods spoil on a parked truck or the shelves, but not in the cold room', () => {
    const b = bare()
    const cold = parked(b, 'cold', 2)
    b.run(w.coldSpoilSeconds + 5)
    expect(cold.spoiled).toBe(true)
    expect(b.events.some((e) => e.type === 'spoiled')).toBe(true)

    const fresh = bare()
    fresh.wh.applyUpgrade('wh-cold')
    const load = parked(fresh, 'cold', 2)
    carryIn(fresh, load, 'cold')
    hold(fresh)
    fresh.run(w.coldSpoilSeconds * 3, always(0.5), 1)
    expect(fresh.wh.consignments.find((c) => c.cargo === 'cold')?.spoiled).toBe(false)
  })

  it('food goes off after its shelf life, and spoiled goods earn nothing', () => {
    const b = bare()
    const load = parked(b, 'food', 2)
    carryIn(b, load)
    hold(b)
    b.run(w.foodShelfLife + 5, always(0.5), 1)
    const c = b.wh.consignments.find((o) => o.loadId === load.id)!
    expect(c.spoiled).toBe(true)
    c.collectAt = b.now
    const truck = untilCollection(b, load.id)
    while (b.wh.cratesOf(load.id) > 0) {
      b.wh.takeForCollection('shelves')
      b.wh.loadCarried(truck.id, b.events)
    }
    expect(b.events.find((e) => e.type === 'collected')).toMatchObject({ paid: 0, spoiled: true })
  })

  it('special metals are stolen from the open shelves, but not from the vault', () => {
    const open = bare()
    carryIn(open, parked(open, 'metals', 3))
    hold(open)
    open.run(w.theft.every * 3, always(0)) // rand 0: always "unlucky"
    expect(open.events.some((e) => e.type === 'stolen')).toBe(true)

    const safe = bare()
    safe.wh.applyUpgrade('wh-vault')
    carryIn(safe, parked(safe, 'metals', 3))
    hold(safe)
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
  /** Run until the police have come and gone. */
  function visit(b: ReturnType<typeof bare>, rand: () => number) {
    hold(b)
    b.run(w.police.gap[1] + w.police.arriveSeconds + w.police.inspectSeconds + w.police.leaveSeconds + 5, rand, 1)
    return b.events.find((e) => e.type === 'police')
  }

  it('they do not come to a small warehouse', () => {
    const b = bare()
    carryIn(b, parked(b, 'general', 2))
    hold(b)
    b.run(1500, always(0.5), 1)
    expect(b.events.some((e) => e.type === 'policeArrived')).toBe(false)
  })

  it('they come rarely, once it is big, and a clean warehouse earns a good word', () => {
    const b = bigWarehouse()
    carryIn(b, parked(b, 'general', w.police.minCrates))
    const result = visit(b, always(0.5))
    expect(b.events.some((e) => e.type === 'policeArrived')).toBe(true)
    expect(result).toMatchObject({ type: 'police', fine: 0, illegalFound: false })
  })

  it('contraband on the open shelves is found, fined per crate and seized', () => {
    const b = bigWarehouse()
    carryIn(b, parked(b, 'general', w.police.minCrates))
    carryIn(b, parked(b, 'illegal', 3))
    const result = visit(b, always(0.5))
    expect(result).toMatchObject({ fine: 3 * w.police.illegalFinePerCrate, seizedCrates: 3, illegalFound: true })
    expect(b.wh.consignments.some((c) => c.cargo === 'illegal')).toBe(false)
  })

  it('hidden contraband is found only sometimes, less with deeper hiding', () => {
    const find = (level: 1 | 2, roll: number) => {
      const b = bigWarehouse()
      b.wh.applyUpgrade('wh-hidden-1')
      if (level === 2) b.wh.applyUpgrade('wh-hidden-2')
      carryIn(b, parked(b, 'general', w.police.minCrates))
      carryIn(b, parked(b, 'illegal', 3), 'hidden')
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
      carryIn(b, parked(b, 'general', w.police.minCrates))
      carryIn(b, parked(b, 'metals', 2))
      const ev = visit(b, always(0.99))
      return ev?.type === 'police' ? ev.fine : -1
    }
    expect(run(false)).toBe(w.police.metalsFine)
    expect(run(true)).toBe(0)
  })

  it('in the game a fine comes out of your money and a find costs reputation', () => {
    const g = new GameManager(3)
    g.grantUpgrade('wh-cap-1')
    const b: Bare = { wh: g.warehouse, deals: g.deals, now: g.now }
    for (const load of [parked(b, 'illegal', 4), parked(b, 'general', w.police.minCrates)]) {
      while (load.taken < load.crates) {
        expect(g.takeCrateFromTruck(load.truckId).ok).toBe(true)
        expect(g.storeCrate('shelves').ok).toBe(true)
      }
    }
    hold(b)
    const money = g.economy.money
    const rep = g.economy.reputation
    for (let t = 0; t < w.police.gap[1] + 60; t += 0.5) g.update(0.5)
    expect(g.economy.money).toBeLessThan(money)
    expect(g.economy.reputation).toBeLessThan(rep)
  })
})

describe('VIP loads', () => {
  it('refusing a VIP load sends it back to be delivered again later', () => {
    const b = bare()
    b.deals.signed.push({
      id: 5, name: 'Elan Husk', title: 'CEO', cargo: 'batteries', cargoType: 'metals', crates: 10, retainer: 300, signedAt: 0, delivered: 0, inTransit: 10, nextDeliveryAt: 99999,
    })
    const load = parked(b, 'metals', 10, 'metals', 'vip')
    load.dealId = 5
    b.wh.refuse(load.id, b.deals)
    expect(b.deals.signed[0]!.inTransit).toBe(0)
    expect(b.deals.signed[0]!.delivered).toBe(0)
  })

  it('every crate you carry in counts as delivered for the deal', () => {
    const b = bare()
    b.deals.signed.push({
      id: 6, name: 'Bill Gaits', title: 'Founder', cargo: 'vaccines', cargoType: 'general', crates: 10, retainer: 300, signedAt: 0, delivered: 0, inTransit: 3, nextDeliveryAt: 99999,
    })
    const load = parked(b, 'general', 3, 'general', 'vip')
    load.dealId = 6
    b.wh.takeFromTruck(load.truckId, b.now)
    b.wh.storeCarried('shelves', b.deals)
    expect(b.deals.signed[0]).toMatchObject({ delivered: 1, inTransit: 2 })
  })
})

describe('Automation: the warehouse robots', () => {
  const crateSeconds = (level: number) => w.robots.seconds[level]!

  it('a robot carries one crate at a time off a parked truck, picking it up partway through the job', () => {
    const b = bare()
    b.wh.applyUpgrade('wh-auto-1')
    expect(b.wh.robots).toHaveLength(1)
    const load = parked(b, 'general', 2)
    b.run(0.5)
    const job = b.wh.robots[0]!
    expect(job).toMatchObject({ dir: 'in', loadId: load.id, section: 'shelves', crate: null })
    expect(b.wh.sectionFree('shelves')).toBe(b.wh.capacity - 1) // a place is kept for it
    b.run(crateSeconds(1) * w.robots.grabAt)
    expect(job.crate).not.toBeNull()
    expect(load.taken).toBe(1) // off the truck, in the robot's clamp
    expect(b.wh.stored).toBe(0)
    b.run(crateSeconds(1))
    expect(b.wh.stored).toBeGreaterThanOrEqual(1)
    b.run(crateSeconds(1) * 2)
    expect(b.wh.cratesOf(load.id)).toBe(2)
    expect(b.wh.loads.includes(load)).toBe(false)
    expect(b.events).toContainEqual(expect.objectContaining({ type: 'stored', crates: 2 }))
  })

  it('the second robot works alongside, faster', () => {
    const b = bare()
    b.wh.applyUpgrade('wh-auto-1')
    b.wh.applyUpgrade('wh-auto-2')
    expect(b.wh.robots).toHaveLength(2)
    expect(crateSeconds(2)).toBeLessThan(crateSeconds(1))
    const load = parked(b, 'general', 4)
    // Two at a time (the second starts a little later, so they are not side by side): 4 crates in about 2.5 jobs' time.
    b.run(crateSeconds(2) * 2.5 + 1)
    expect(b.wh.cratesOf(load.id)).toBe(4)
  })

  it('robots finish a load you started, and drop a job whose crate you took first', () => {
    const b = bare()
    const load = parked(b, 'general', 2)
    b.wh.takeFromTruck(load.truckId, b.now)
    b.wh.storeCarried('shelves', b.deals)
    b.wh.applyUpgrade('wh-auto-1')
    b.run(0.5)
    expect(b.wh.robots[0]?.loadId).toBe(load.id)
    // You take the last crate before the robot gets to it: its job is dropped at the pick-up, and nothing is lost.
    b.wh.takeFromTruck(load.truckId, b.now)
    b.run(crateSeconds(1))
    expect(b.wh.storeCarried('shelves', b.deals).ok).toBe(true)
    expect(b.wh.cratesOf(load.id)).toBe(2)
  })

  it('robots carry collections out to the waiting truck, and the owner pays when the last crate is on', () => {
    const b = bare()
    b.wh.applyUpgrade('wh-vault')
    const load = parked(b, 'metals', 2)
    carryIn(b, load)
    b.wh.applyUpgrade('wh-auto-1')
    b.wh.consignments[0]!.collectAt = b.now
    const truck = untilCollection(b, load.id)
    b.run(crateSeconds(1) * 2 + 1)
    expect(b.wh.cratesOf(load.id)).toBe(0)
    expect(truck.phase).toBe('leaving')
    expect(b.events.find((e) => e.type === 'collected')).toMatchObject({ crates: 2 })
  })

  it('the robots never take anything down to the underground vault, and never touch the contact\'s crates', () => {
    const b = bare()
    b.wh.applyUpgrade('wh-auto-1')
    b.wh.applyUpgrade('wh-hidden-1')
    parked(b, 'general', 2)
    b.run(crateSeconds(1) * 3)
    expect(b.wh.sectionStored('hidden')).toBe(0)
    // His crate on the shelves, due for pickup: no truck comes, so the robots have nothing to carry out.
    const c = contactDrop(b, 1)
    expect(b.wh.storeCarried('shelves', b.deals).ok).toBe(true)
    c.collectAt = b.now
    b.run(crateSeconds(1) * 2)
    expect(b.wh.trucks.some((t) => t.loadId === c.loadId)).toBe(false)
    expect(b.wh.cratesOf(c.loadId)).toBe(1)
    expect(b.wh.robots.every((j) => j === null || j.loadId !== c.loadId)).toBe(true)
  })

  it('signed VIP deals are delivered in box trucks and collected, with the robots doing the carrying', () => {
    const b = bare()
    b.wh.applyUpgrade('wh-cap-1')
    b.wh.applyUpgrade('wh-cap-2')
    b.wh.applyUpgrade('wh-auto-1')
    b.wh.applyUpgrade('wh-auto-2')
    b.deals.signed.push({
      id: 99, name: 'Beff Jezoz', title: 'Founder, Amazin', cargo: 'parcels', cargoType: 'general', crates: 25, retainer: 400, signedAt: 0, delivered: 0, inTransit: 0, nextDeliveryAt: w.firstDeliveryDelay,
    })
    b.run(900, always(0.5), 0.5)
    expect(b.deals.signed[0]!.delivered).toBe(25)
    expect(b.deals.signed[0]!.inTransit).toBe(0)
    b.run(w.vipStay + 900, always(0.5), 1)
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
    expect(g.buyAutomation('wh-cap-2').message).toBe('Buy Extra rack first')
    expect(g.buyAutomation('wh-vault').message).toBe('Needs level 9')
    g.economy.xp = 6000
    const money = g.economy.money
    expect(g.buyAutomation('wh-cap-1').ok).toBe(true)
    expect(g.economy.money).toBe(money - WAREHOUSE_UPGRADES.find((u) => u.id === 'wh-cap-1')!.cost)
    expect(g.warehouse.capacity).toBe(w.startShelves + 12)
    expect(g.buyAutomation('wh-cap-1').ok).toBe(false) // only once
    for (const id of ['wh-cold', 'wh-vault', 'wh-permit', 'wh-scanner', 'wh-hidden-1', 'wh-hidden-2', 'wh-auto-1', 'wh-auto-2']) expect(g.buyAutomation(id).ok).toBe(true)
    expect(g.warehouse).toMatchObject({ coldCapacity: 12, vaultCapacity: 8, permit: true, scanner: true, hiddenLevel: 2, hiddenCapacity: 12, autoLevel: 2 })
  })

  it('the mod menu can unlock any of them with everything it needs', () => {
    const g = new GameManager(3)
    expect(g.grantUpgrade('wh-auto-2').ok).toBe(true)
    for (const id of ['warehouse', 'wh-cap-1', 'wh-auto-1', 'wh-auto-2']) expect(g.upgrades.has(id) || g.warehouse.has(id)).toBe(true)
  })
})

describe('The contact (contraband by hand)', () => {
  function bigWarehouse() {
    const b = bare()
    b.wh.applyUpgrade('wh-cap-1')
    return b
  }
  function visit(b: ReturnType<typeof bare>, rand: () => number) {
    hold(b)
    b.run(w.police.gap[1] + w.police.arriveSeconds + w.police.inspectSeconds + w.police.leaveSeconds + 5, rand, 1)
    return b.events.find((e) => e.type === 'police')
  }
  it('no kei truck brings contraband any more', () => {
    expect(Object.keys(w.keiMix)).not.toContain('illegal')
  })

  it('he waits by the door for an answer, and leaves if you ignore him', () => {
    const b = bare()
    b.run(w.contact.firstDelay + w.contact.walkSeconds + 1)
    expect(b.wh.contact).toMatchObject({ job: 'drop', phase: 'asking' })
    expect(b.wh.takeFromContact(b.now).ok).toBe(false) // not before you agree
    b.run(w.contact.askPatience + 1)
    expect(b.events.some((e) => e.type === 'contactLeft' && e.reason === 'ignored')).toBe(true)
    b.run(w.contact.walkSeconds + 1)
    expect(b.wh.contact).toBeNull()
  })

  it('you take his crates one at a time and can put them anywhere, but the underground vault takes nothing else', () => {
    const b = bigWarehouse()
    b.wh.applyUpgrade('wh-hidden-1')
    b.wh.applyUpgrade('wh-cold')
    const c = contactDrop(b, 3)
    expect(b.wh.carrying).toMatchObject({ kind: 'contra', cargo: 'illegal', loadId: c.loadId })
    expect(b.wh.storeCarried('cold', b.deals).ok).toBe(true)
    expect(b.wh.takeFromContact(b.now).ok).toBe(true)
    expect(b.wh.storeCarried('hidden', b.deals).ok).toBe(true)
    expect(b.wh.takeFromContact(b.now).ok).toBe(true)
    expect(b.wh.contact?.phase).toBe('leaving') // that was his last
    expect(b.wh.storeCarried('shelves', b.deals).ok).toBe(true)
    // Ordinary crates cannot go down there.
    const load = parked(b, 'general', 1)
    expect(b.wh.takeFromTruck(load.truckId, b.now).ok).toBe(true)
    expect(b.wh.storeCarried('hidden', b.deals).ok).toBe(false)
    expect(b.wh.cratesOf(c.loadId)).toBe(3)
  })

  it('he comes back for them, you hand them over, and he pays the contraband fee for each', () => {
    const b = bigWarehouse()
    b.wh.applyUpgrade('wh-hidden-1')
    const c = contactDrop(b, 2)
    expect(b.wh.storeCarried('hidden', b.deals).ok).toBe(true)
    expect(b.wh.takeFromContact(b.now).ok).toBe(true)
    expect(b.wh.storeCarried('shelves', b.deals).ok).toBe(true)
    for (const o of b.wh.consignments) if (o.loadId === c.loadId) o.collectAt = b.now
    b.run(w.contact.walkSeconds * 2 + 2)
    expect(b.wh.contact).toMatchObject({ job: 'pickup', phase: 'waiting', loadId: c.loadId })
    for (const section of ['hidden', 'shelves'] as const) {
      expect(b.wh.takeForCollection(section).ok).toBe(true)
      expect(b.wh.giveToContact(b.events).ok).toBe(true)
    }
    expect(b.events.find((e) => e.type === 'collected')).toMatchObject({ crates: 2, paid: 2 * w.cargo.illegal.fee })
    expect(b.wh.contact?.phase).toBe('leaving')
  })

  it('the police always find his crates in the open, but only sometimes in the underground vault', () => {
    const b = bigWarehouse()
    b.wh.applyUpgrade('wh-hidden-1')
    const c = contactDrop(b, 2)
    expect(b.wh.storeCarried('hidden', b.deals).ok).toBe(true)
    expect(b.wh.takeFromContact(b.now).ok).toBe(true)
    expect(b.wh.storeCarried('shelves', b.deals).ok).toBe(true)
    carryIn(b, parked(b, 'general', w.police.minCrates))
    hold(b)
    const ev = visit(b, always(0.5)) // 0.5 is above the 40 % chance: the vault stays secret
    expect(ev).toMatchObject({ illegalFound: true, seizedCrates: 1 })
    expect(b.wh.consignments.find((o) => o.loadId === c.loadId)?.section).toBe('hidden')
  })
})

describe('Warehouse levels 3 and 4', () => {
  it('each new hall adds four racks of shelf slots, after the two extra racks', () => {
    const g = new GameManager(7)
    g.grantUpgrade('warehouse')
    expect(g.warehouse.capacity).toBe(w.startShelves)
    expect(g.buyAutomation('wh-expand-1').ok).toBe(false) // needs the racks (and the level and the money) first
    g.grantUpgrade('wh-expand-2')
    expect(g.warehouse.has('wh-cap-2') && g.warehouse.has('wh-expand-1')).toBe(true)
    expect(g.warehouse.capacity).toBe(w.startShelves + 12 + 12 + 48 + 48)
  })
})

describe('More robots', () => {
  it('robots 3 and 4 need the level 3 hall, and each makes all of them faster', () => {
    const g = new GameManager(7)
    g.grantUpgrade('warehouse')
    g.grantUpgrade('wh-auto-2')
    g.economy.money = 1_000_000
    g.economy.xp = 1_000_000
    expect(g.buyAutomation('wh-auto-3').message).toBe('Buy Warehouse level 3 first')
    g.grantUpgrade('wh-expand-1')
    expect(g.buyAutomation('wh-auto-3').ok).toBe(true)
    expect(g.buyAutomation('wh-auto-4').ok).toBe(true)
    expect(g.warehouse.robots.length).toBe(4)
    expect(w.robots.seconds[4]).toBeLessThan(w.robots.seconds[2]!)
  })
})

