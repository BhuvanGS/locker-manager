import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../lib/random'
import { AUTOMATION_UPGRADES } from './config'
import { GameManager } from './GameManager'

/**
 * A stress test: a player who does random things (valid or not) for a long time, across many seeds and every stage of the game
 * (keys, digital lockers, the belt and arms, the halls). After every step the records must agree with each other: where a bag is,
 * what its locker says, what the customer thinks, what is in the player's hands. Nothing may throw.
 */

const SETUPS: string[][] = [
  [],
  ['labels', 'register', 'bank2', 'bank3'],
  ['labels', 'register', 'digital'],
  ['conveyor', 'bank2', 'bank3'],
  ['annexEast', 'line-east', 'speed-main-1', 'arms-main'],
  ['southExpansion', 'line-south', 'line-east', 'arms-south'],
  ['counter-arm'],
  ['counter-arm', 'office', 'warehouse'],
  ['warehouse', 'wh-cap-1', 'wh-cold', 'wh-vault', 'wh-hidden-1', 'wh-scanner', 'office'],
  ['warehouse', 'wh-auto-2', 'wh-hidden-2', 'wh-permit', 'office'],
]

function check(g: GameManager): void {
  const wh = g.warehouse
  for (const section of ['shelves', 'cold', 'vault', 'hidden'] as const) {
    expect(wh.sectionStored(section), `${section} is over its capacity`).toBeLessThanOrEqual(wh.sectionCapacity(section))
  }
  expect(new Set(wh.loads.map((l) => l.id)).size).toBe(wh.loads.length)
  // A crate is in exactly one place: on a truck, in a section, or in your hands (and your hands agree with the warehouse).
  expect(g.hands?.kind === 'crate', 'crate in hands vs warehouse.carrying').toBe(wh.carrying !== null)
  for (const load of wh.loads) {
    expect(load.taken).toBeLessThanOrEqual(load.crates)
    const truck = wh.truck(load.truckId)
    expect(truck, `load ${load.id} has no truck`).toBeDefined()
    expect(truck!.onBoard).toBe(load.crates - load.taken)
  }
  expect(new Set(wh.trucks.map((t) => t.spot)).size, 'two trucks in one parking spot').toBe(wh.trucks.length)
  for (const d of g.deals.signed) {
    expect(d.delivered + d.inTransit, `${d.name}'s deal is over-delivered`).toBeLessThanOrEqual(d.crates)
    expect(d.inTransit).toBeGreaterThanOrEqual(0)
  }
  const hands = g.hands
  for (const c of g.customers.all()) {
    const item = g.customers.itemOf(c)
    if (!item) continue
    const where = `${c.id} ${c.state} / ${item.id} ${item.status}`
    if (item.status === 'inLocker') {
      expect(item.lockerId, where).not.toBeNull()
      const locker = g.lockers.get(item.lockerId!)
      expect(locker.itemId, where).toBe(item.id)
      expect(c.lockerId, where).toBe(item.lockerId)
      expect(locker.state, where).toBe(g.conveyor.isBusy(locker.id) ? 'reserved' : 'occupied')
    } else if (item.status === 'heldByPlayer') {
      expect(hands, where).toEqual({ kind: 'item', itemId: item.id })
      expect(item.lockerId, where).toBeNull()
    } else if (item.status === 'withArm') {
      expect(g.counterJob?.customerId, where).toBe(c.id)
      expect(g.counterJob?.moved, where).toBe(true)
    } else if (item.status === 'onConveyor') {
      expect(
        g.conveyor.parcels.some((p) => p.itemId === item.id),
        where,
      ).toBe(true)
    } else if (item.status === 'withCustomer') {
      expect(item.lockerId, where).toBeNull()
      expect(hands?.kind === 'item' && hands.itemId === item.id, where).toBe(false)
    }
    // A customer who has left the counter has their bag stored, on the belt, or (if you fetched it early) in your hands: never still "with the customer".
    if (c.state === 'stored') expect(['inLocker', 'onConveyor', 'heldByPlayer'], where).toContain(item.status)
  }
  for (const l of g.lockers.all()) {
    if (l.itemId) {
      const item = g.customers.item(l.itemId)
      expect(item.status, l.id).toBe('inLocker')
      expect(item.lockerId, l.id).toBe(l.id)
    }
    if (l.state === 'available') expect(g.conveyor.isBusy(l.id), `${l.id} is free but the arm is working on it`).toBe(false)
    if (l.locked) {
      expect(l.doorOpen, `${l.id} locked but open`).toBe(false)
      expect(l.itemId === null && !g.isDigital ? 'empty-locked-ok' : 'ok').toBeTruthy()
    }
    if (g.isDigital && l.itemId && !l.doorOpen && !g.conveyor.isBusy(l.id)) expect(l.locked, `${l.id} holds a bag behind a shut door but is unlocked`).toBe(true)
  }
  // A key is in exactly one place; with digital lockers they are all back in their locks.
  for (const k of g.keys.all()) {
    if (g.isDigital) expect(k.location.kind).toBe('inLock')
    if (k.location.kind === 'player') expect(hands).toEqual({ kind: 'key', keyId: k.id })
  }
}

function play(seed: number, setup: string[]): void {
  const g = new GameManager(seed)
  g.economy.xp = 100_000
  g.economy.money = 1_000_000
  for (const id of setup) g.grantUpgrade(id)
  g.drainNotices()
  const rand = mulberry32(seed * 7919 + 13)
  const pick = <T>(list: T[]): T | undefined => list[Math.floor(rand() * list.length)]
  const options = ['greet', 'askName', 'accept', 'turnAway', 'confirmStored', 'giveBack', 'handOver', 'goodbye'] as const

  for (let step = 0; step < 350; step++) {
    const customers = g.customers.all()
    const lockers = g.lockers.all()
    const roll = rand()
    if (roll < 0.22) {
      const c = pick(customers)
      if (c) g.talkTo(c.id)
    } else if (roll < 0.4) {
      const o = pick([...options])
      if (o) g.choose(o)
    } else if (roll < 0.46) {
      g.closeDialogue()
    } else if (roll < 0.62) {
      const l = pick(lockers)
      if (l) {
        const a = Math.floor(rand() * 4)
        if (a === 0) g.openLocker(l.id)
        else if (a === 1) g.closeLocker(l.id)
        else if (a === 2) g.putItem(l.id)
        else g.takeItem(l.id)
      }
    } else if (roll < 0.7) {
      const l = pick(lockers)
      const hook = Math.floor(rand() * g.keys.hookCount)
      const a = Math.floor(rand() * 4)
      if (l && a === 0) g.takeKeyFromLock(l.id)
      else if (l && a === 1) g.useKeyOn(l.id)
      else if (a === 2) g.hangKey(hook)
      else g.takeKeyFromHook(hook)
    } else if (roll < 0.8) {
      const a = Math.floor(rand() * 3)
      if (a === 0) g.loadConveyor()
      else if (a === 1) g.takeFromConveyor()
      else {
        const e = pick(g.terminalEntries())
        if (e) g.requestBag(e.lockerId)
      }
    } else if (roll < 0.84) {
      const a = rand()
      if (a < 0.4) g.spawnExtraCustomer()
      else if (a < 0.7) g.callBackStoredCustomers()
      else if (a < 0.85) g.openDeal()
      else if (a < 0.93) g.chooseDeal(pick(['accept', 'haggle', 'decline'] as const)!)
      else {
        const load = pick(g.warehouse.loads)
        if (load) g.receive(load.id, pick(['inspect', 'refuse'] as const)!)
      }
    } else if (roll < 0.86) {
      // Carrying crates: off a truck, into a section, out of a section, onto a truck.
      const wh = g.warehouse
      const truck = pick(wh.trucks)
      const section = pick(['shelves', 'shelves', 'cold', 'vault', 'hidden'] as const)!
      const a = Math.floor(rand() * 4)
      if (a === 0 && truck) g.takeCrateFromTruck(truck.id)
      else if (a === 1) g.storeCrate(section)
      else if (a === 2) g.takeCrateFrom(section)
      else if (truck) g.loadCrate(truck.id)
    } else if (roll < 0.9) {
      const d = pick(AUTOMATION_UPGRADES.filter((u) => u.kind !== 'line'))
      if (d) g.buyAutomation(d.id)
      const z = pick(['main', 'east', 'south'] as const)
      if (z) g.buyAutomation(rand() < 0.5 ? `service-${z}` : `repair-${z}`)
    } else {
      for (let t = 0; t < 1 + rand() * 6; t += 0.25) g.update(0.25)
    }
    // Customers walk instantly, as in the test driver.
    for (let batch = g.drainNotices(); batch.length > 0; batch = g.drainNotices()) {
      for (const n of batch) {
        if (n.type === 'customerSpawned') g.customerReachedCounter(n.customerId)
        if (n.type === 'customerLeaving') g.customerExited(n.customerId)
      }
    }
    check(g)
  }
}

describe('Random play keeps every record consistent', () => {
  for (const [i, setup] of SETUPS.entries()) {
    it(`setup ${i}: ${setup.join(', ') || 'a bare shop'}`, () => {
      const seeds = Number(process.env.FUZZ_SEEDS ?? 12) // FUZZ_SEEDS=200 npx vitest run src/sim/Fuzz.test.ts for a long hunt
      for (let seed = 1; seed <= seeds; seed++) play(seed * 31 + i, setup)
    }, 600_000)
  }
})
