import { CONFIG, SECTIONS, WAREHOUSE_UPGRADES, type CargoType, type Section } from './config'
import type { DealManager } from './DealManager'

/** What one crate is: whose load it belongs to and what is really in it. Crates of a load stay together as a load until collected. */
export interface CrateData {
  loadId: number
  owner: string
  kind: 'kei' | 'vip'
  cargo: CargoType
  dealId: number | null
  spoiled: boolean
  deliveredAt: number
  /** When the owner's truck comes back for the load. */
  collectAt: number
}

/** Crates of one load kept in one section of the warehouse. */
export interface Consignment extends CrateData {
  id: number
  section: Section
  crates: number
}

/** A delivery parked beside the warehouse: its crates are still on the truck until they are carried in (by you or the robots). */
export interface Load {
  id: number
  owner: string
  kind: 'kei' | 'vip'
  cargo: CargoType
  /** What the driver says it is. For contraband this is a lie. */
  declared: CargoType
  crates: number
  /** Crates already taken off the truck. */
  taken: number
  dealId: number | null
  arrivedAt: number
  collectAt: number
  /** You opened a crate (or the scanner did): the real contents are known. */
  inspected: boolean
  /** While someone is opening a crate: when they are done. */
  inspectDone: number | null
  spoiled: boolean
  truckId: number
}

/** A truck. It drives in, parks in one of the spots beside the shed, waits there while its crates are unloaded (or loaded), and drives off. */
export interface Truck {
  id: number
  kind: 'kei' | 'box'
  job: 'deliver' | 'collect'
  owner: string
  loadId: number
  /** Parking spot (0, 1, 2…). */
  spot: number
  /** Crates on board right now. */
  onBoard: number
  /** What it says on the side (for a delivery). */
  declared: CargoType
  phase: 'arriving' | 'parked' | 'leaving'
  /** Seconds in the current phase. */
  t: number
  /** Collections: money for the crates loaded so far, and whether any of them had gone off. */
  paid: number
  spoiled: boolean
}

/** One warehouse robot's job: carry ONE crate from a parked truck to a section (`in`) or from a section to a collection truck (`out`). */
export interface RobotJob {
  dir: 'in' | 'out'
  truckId: number
  loadId: number
  section: Section
  /** Seconds into the job, and how long it takes. */
  t: number
  duration: number
  /** The crate, once the robot has picked it up (at `grabAt` of the job); until then it is still on the truck or in the section. */
  crate: CrateData | null
}

export interface PoliceVisit {
  phase: 'arriving' | 'inspecting' | 'leaving'
  t: number
}

type Queued = { kind: Truck['kind']; job: Truck['job']; owner: string; crates: number; dealId: number | null; loadId: number; cargo: CargoType; declared: CargoType }

/** Something that happened, for the game to turn into toasts, money and reputation. */
export type WarehouseEvent =
  | { type: 'arrived'; owner: string; crates: number; declared: CargoType; job: Truck['job'] }
  | { type: 'stored'; owner: string; crates: number; section: Section }
  | { type: 'refused'; owner: string; crates: number; vip: boolean; gaveUp?: boolean }
  | { type: 'collected'; owner: string; crates: number; paid: number; vip: boolean; spoiled: boolean }
  | { type: 'spoiled'; owner: string; crates: number; cargo: CargoType }
  | { type: 'stolen'; owner: string; crates: number }
  | { type: 'policeArrived' }
  | { type: 'police'; fine: number; seizedCrates: number; illegalFound: boolean; metalsFined: boolean }

export type Result = { ok: true; message: string } | { ok: false; message: string }

const KEI_NAMES = ['Hiro', 'Daichi', 'Kenji', 'Sota', 'Ayumi', 'Ren', 'Yuki', 'Takumi', 'Mei', 'Haruto']
/** "Hiro (kei truck)" → "Hiro". */
const shortName = (owner: string): string => owner.split(' (')[0]!
const SECTION_WORDS: Record<Section, string> = { shelves: 'on the shelves', cold: 'in the cold room', vault: 'in the vault', hidden: 'in the hidden room' }

/**
 * The warehouse: pure simulation. Trucks bring loads of crates (kei truckers at random, your VIP deals in box trucks) and park in the
 * spots beside the shed. Their crates have to be carried in, one at a time: you take a crate off the truck and store it on a rack or in a
 * room (the receiving robots do whole loads once you buy them). Later the owner's truck parks again and you carry their crates out to it, and
 * they pay. Sections (shelves, cold room, vault, hidden room) have limited room. Food spoils, cold-chain goods spoil outside the cold room,
 * special metals get stolen from the open shelves, and now and then the police check for contraband and unlicensed metals.
 *
 * The crate you are carrying lives here too (`carrying`), so the crates are always in exactly one place: on a truck, in a section, or in your hands.
 */
export class WarehouseManager {
  consignments: Consignment[] = []
  loads: Load[] = []
  trucks: Truck[] = []
  carrying: CrateData | null = null
  /** One entry per robot: its job, or null while it is idle. */
  robots: (RobotJob | null)[] = []
  police: PoliceVisit | null = null
  capacity: number = CONFIG.warehouse.startShelves
  coldCapacity = 0
  vaultCapacity = 0
  hiddenCapacity = 0
  hiddenLevel = 0
  permit = false
  scanner = false
  autoLevel = 0
  earned = 0
  collected = 0
  fines = 0
  private queue: Queued[] = []
  private nextKeiAt: number | null = null
  private nextPoliceAt: number | null = null
  private nextTheftAt = 0
  private seq = 0
  private truckSeq = 0
  private loadSeq = 0
  private readonly owned = new Set<string>()
  /** Robots start jobs a little apart, so two robots never drive the same route side by side. */
  private nextRobotStart = 0

  start(now: number): void {
    this.nextKeiAt = now + CONFIG.warehouse.firstKeiDelay
    this.nextTheftAt = now + CONFIG.warehouse.theft.every
  }

  // ------------------------------------------------------------------ room

  get stored(): number {
    return this.consignments.reduce((n, c) => n + c.crates, 0)
  }

  sectionCapacity(section: Section): number {
    return section === 'shelves' ? this.capacity : section === 'cold' ? this.coldCapacity : section === 'vault' ? this.vaultCapacity : this.hiddenCapacity
  }

  sectionStored(section: Section): number {
    return this.consignments.filter((c) => c.section === section).reduce((n, c) => n + c.crates, 0)
  }

  /** Room left in a section, keeping a place for every crate a robot is bringing there. */
  sectionFree(section: Section): number {
    const coming = this.robots.filter((j) => j?.dir === 'in' && j.section === section).length
    return Math.max(0, this.sectionCapacity(section) - this.sectionStored(section) - coming)
  }

  /** Robots whose job is about `loadId` and who have not picked their crate up yet. */
  private pending(loadId: number, dir: RobotJob['dir'], section?: Section): number {
    return this.robots.filter((j) => j && !j.crate && j.dir === dir && j.loadId === loadId && (section === undefined || j.section === section)).length
  }

  /** A robot is holding a crate of `loadId`. */
  private robotHolds(loadId: number): boolean {
    return this.robots.some((j) => j?.crate?.loadId === loadId)
  }

  get free(): number {
    return this.sectionFree('shelves')
  }

  /** Loads waiting in the road for a free parking spot. */
  get waiting(): number {
    return this.queue.length
  }

  sections(): Section[] {
    return SECTIONS.filter((s) => this.sectionCapacity(s) > 0)
  }

  visibleCargo(load: Load): CargoType {
    return load.inspected || this.scanner ? load.cargo : load.declared
  }

  /** Where a load that looks like `visible` belongs, with the fallback to the shelves; null if there is no room for `crates` of it. */
  placeFor(visible: CargoType, crates: number): Section | null {
    const preferred: Section = visible === 'cold' ? 'cold' : visible === 'metals' ? 'vault' : visible === 'illegal' ? 'hidden' : 'shelves'
    if (this.sectionFree(preferred) >= crates) return preferred
    return this.sectionFree('shelves') >= crates ? 'shelves' : null
  }

  truck(id: number): Truck | undefined {
    return this.trucks.find((t) => t.id === id)
  }

  loadOf(truck: Truck): Load | undefined {
    return this.loads.find((l) => l.truckId === truck.id)
  }

  /** Crates of load `loadId` still in the warehouse (not on a truck, not in your hands). */
  cratesOf(loadId: number): number {
    return this.consignments.filter((c) => c.loadId === loadId).reduce((n, c) => n + c.crates, 0)
  }

  /** A collection truck that is parked and waiting for crates of a load kept in `section`, if any. */
  collectionFrom(section: Section): Truck | undefined {
    return this.trucks.find((t) => t.job === 'collect' && t.phase === 'parked' && this.consignments.some((c) => c.section === section && c.loadId === t.loadId))
  }

  // ------------------------------------------------------------------ upgrades

  has(id: string): boolean {
    return this.owned.has(id)
  }

  applyUpgrade(id: string): void {
    if (!WAREHOUSE_UPGRADES.some((u) => u.id === id)) return
    this.owned.add(id)
    if (id === 'wh-cap-1' || id === 'wh-cap-2') this.capacity += 12
    else if (id === 'wh-cold') this.coldCapacity = 12
    else if (id === 'wh-vault') this.vaultCapacity = 8
    else if (id === 'wh-permit') this.permit = true
    else if (id === 'wh-scanner') this.scanner = true
    else if (id === 'wh-hidden-1') {
      this.hiddenLevel = 1
      this.hiddenCapacity = 8
    } else if (id === 'wh-hidden-2') {
      this.hiddenLevel = 2
      this.hiddenCapacity = 12
    } else if (id === 'wh-auto-1' || id === 'wh-auto-2') {
      this.autoLevel = id === 'wh-auto-1' ? Math.max(this.autoLevel, 1) : 2
      const count = CONFIG.warehouse.robots.count[this.autoLevel] ?? 0
      while (this.robots.length < count) this.robots.push(null)
    }
  }

  // ------------------------------------------------------------------ carrying crates by hand

  /** Take one crate off a parked delivery truck. */
  takeFromTruck(truckId: number, now: number): Result {
    if (this.carrying) return { ok: false, message: 'You are already carrying a crate.' }
    const truck = this.truck(truckId)
    if (!truck || truck.phase !== 'parked') return { ok: false, message: 'That truck is not parked.' }
    if (truck.job === 'collect') return { ok: false, message: `This truck is here to collect ${shortName(truck.owner)}'s crates.` }
    const load = this.loadOf(truck)
    if (!load || load.taken >= load.crates) return { ok: false, message: 'It is empty.' }
    if (load.inspectDone !== null) return { ok: false, message: 'Someone is still opening a crate.' }
    load.taken += 1
    truck.onBoard = load.crates - load.taken
    this.carrying = { loadId: load.id, owner: load.owner, kind: load.kind, cargo: load.cargo, dealId: load.dealId, spoiled: load.spoiled, deliveredAt: now, collectAt: load.collectAt }
    this.afterTaking(load, truck)
    return { ok: true, message: `You took a crate (${load.taken} of ${load.crates}).` }
  }

  /** Put the crate you are carrying into `section`. */
  storeCarried(section: Section, deals: DealManager): Result {
    const crate = this.carrying
    if (!crate) return { ok: false, message: 'You are not carrying a crate.' }
    if (this.sectionCapacity(section) <= 0) return { ok: false, message: 'There is no such place yet.' }
    if (this.sectionFree(section) < 1) return { ok: false, message: 'No room left here.' }
    this.addCrates(crate, section, 1)
    this.carrying = null
    this.bookDelivered(crate, 1, deals)
    return { ok: true, message: `Stored ${SECTION_WORDS[section]}.` }
  }

  /** Take a crate out of `section` for a collection truck that is waiting for it. */
  takeForCollection(section: Section): Result {
    if (this.carrying) return { ok: false, message: 'You are already carrying a crate.' }
    const truck = this.collectionFrom(section)
    if (!truck) return { ok: false, message: 'Nobody is waiting for anything kept here.' }
    const c = this.consignments.find((o) => o.section === section && o.loadId === truck.loadId)
    if (!c) return { ok: false, message: 'Nothing for them here.' }
    this.removeCrates(c, 1)
    const { id: _id, section: _s, crates: _c, ...data } = c
    this.carrying = data
    return { ok: true, message: `You took one of ${shortName(truck.owner)}'s crates.` }
  }

  /** Put the crate you are carrying onto a parked collection truck (it must be the owner's). */
  loadCarried(truckId: number, events: WarehouseEvent[] = []): Result {
    const crate = this.carrying
    if (!crate) return { ok: false, message: 'You are not carrying a crate.' }
    const truck = this.truck(truckId)
    if (!truck || truck.phase !== 'parked') return { ok: false, message: 'That truck is not parked.' }
    if (truck.job !== 'collect') return { ok: false, message: 'This truck is delivering, not collecting.' }
    if (crate.loadId !== truck.loadId) return { ok: false, message: `That crate is not ${shortName(truck.owner)}'s.` }
    this.carrying = null
    this.loadOne(truck, crate)
    this.finishCollection(truck, events)
    return { ok: true, message: (truck.phase as Truck['phase']) === 'leaving' ? `${shortName(truck.owner)} has everything and pays $${truck.paid}.` : 'Loaded.' }
  }

  /** Open a crate of a parked load to see what is really in it (it takes a few seconds). */
  inspect(loadId: number, now: number): boolean {
    const load = this.loads.find((l) => l.id === loadId)
    if (!load || load.inspected || load.inspectDone !== null) return false
    load.inspectDone = now + CONFIG.warehouse.inspectSeconds
    return true
  }

  /** Send a parked load back before any of it is unloaded. */
  refuse(loadId: number, deals: DealManager): Load | null {
    const load = this.loads.find((l) => l.id === loadId)
    if (!load || load.taken > 0) return null
    this.loads = this.loads.filter((l) => l !== load)
    const truck = this.truck(load.truckId)
    if (truck) this.leave(truck)
    const deal = load.dealId !== null ? deals.signed.find((d) => d.id === load.dealId) : undefined
    if (deal) deal.inTransit = Math.max(0, deal.inTransit - load.crates)
    return load
  }

  private addCrates(crate: CrateData, section: Section, n: number): void {
    const existing = this.consignments.find((c) => c.loadId === crate.loadId && c.section === section)
    if (existing) {
      existing.crates += n
      existing.spoiled = existing.spoiled || crate.spoiled
    } else {
      this.consignments.push({ ...crate, id: ++this.seq, section, crates: n })
    }
  }

  private removeCrates(c: Consignment, n: number): void {
    c.crates -= n
    if (c.crates <= 0) this.consignments = this.consignments.filter((o) => o !== c)
  }

  private bookDelivered(crate: CrateData, n: number, deals: DealManager): void {
    const deal = crate.dealId !== null ? deals.signed.find((d) => d.id === crate.dealId) : undefined
    if (!deal) return
    deal.inTransit = Math.max(0, deal.inTransit - n)
    deal.delivered += n
  }

  /** The delivery truck is empty: it leaves (the load is done when nothing of it is still on the truck). */
  private afterTaking(load: Load, truck: Truck): void {
    if (load.taken < load.crates) return
    this.loads = this.loads.filter((l) => l !== load)
    this.leave(truck)
  }

  private loadOne(truck: Truck, crate: CrateData): void {
    const rate = CONFIG.warehouse.cargo[crate.cargo].fee * (crate.kind === 'vip' ? CONFIG.warehouse.vipFeeFactor : 1)
    truck.onBoard += 1
    truck.paid += crate.spoiled ? 0 : Math.round(rate)
    truck.spoiled = truck.spoiled || crate.spoiled
  }

  /** A collection is done when none of the load is left in the warehouse or in your hands. */
  private finishCollection(truck: Truck, events: WarehouseEvent[]): void {
    if (truck.phase !== 'parked' || this.cratesOf(truck.loadId) > 0 || this.carrying?.loadId === truck.loadId || this.robotHolds(truck.loadId)) return
    this.earned += truck.paid
    this.collected += truck.onBoard
    events.push({ type: 'collected', owner: truck.owner, crates: truck.onBoard, paid: truck.paid, vip: truck.kind === 'box', spoiled: truck.spoiled })
    this.leave(truck)
  }

  private leave(truck: Truck): void {
    truck.phase = 'leaving'
    truck.t = 0
  }

  // ------------------------------------------------------------------ time

  update(dt: number, now: number, deals: DealManager, rand: () => number): WarehouseEvent[] {
    const events: WarehouseEvent[] = []
    this.schedule(now, deals, rand)
    this.updateTrucks(dt, now, deals, rand, events)
    this.updateLoads(now, events)
    this.updateRobots(dt, now, deals, events)
    this.updateSpoilage(now, events)
    this.updateTheft(now, rand, events)
    this.updatePolice(dt, now, rand, events)
    return events
  }

  private freeSpot(): number | null {
    for (let spot = 0; spot < CONFIG.warehouse.parkingSpots; spot++) if (!this.trucks.some((t) => t.spot === spot)) return spot
    return null
  }

  private updateTrucks(dt: number, now: number, deals: DealManager, rand: () => number, events: WarehouseEvent[]): void {
    const w = CONFIG.warehouse
    // The next truck in the road takes a free parking spot.
    for (let spot = this.freeSpot(); spot !== null && this.queue.length > 0; spot = this.freeSpot()) {
      const next = this.queue.shift()!
      this.trucks.push({ id: ++this.truckSeq, kind: next.kind, job: next.job, owner: next.owner, loadId: next.loadId, spot, onBoard: next.job === 'deliver' ? next.crates : 0, declared: next.declared, phase: 'arriving', t: 0, paid: 0, spoiled: false })
      const truck = this.trucks.at(-1)!
      if (next.job === 'deliver') {
        const [sLo, sHi] = w.keiStay
        const stay = next.kind === 'box' ? w.vipStay : sLo + (sHi - sLo) * rand()
        this.loads.push({
          id: next.loadId,
          owner: next.owner,
          kind: next.kind === 'box' ? 'vip' : 'kei',
          cargo: next.cargo,
          declared: next.declared,
          crates: next.crates,
          taken: 0,
          dealId: next.dealId,
          arrivedAt: now + w.arriveSeconds,
          collectAt: now + w.arriveSeconds + stay,
          inspected: false,
          inspectDone: null,
          spoiled: false,
          truckId: truck.id,
        })
      }
    }
    for (const truck of [...this.trucks]) {
      truck.t += dt
      if (truck.phase === 'arriving' && truck.t >= w.arriveSeconds) {
        truck.phase = 'parked'
        truck.t = 0
        events.push({ type: 'arrived', owner: truck.owner, crates: truck.job === 'deliver' ? truck.onBoard : this.cratesOf(truck.loadId), declared: truck.declared, job: truck.job })
        // A collection for crates that are all gone already (stolen, seized) is over at once.
        if (truck.job === 'collect') this.finishCollection(truck, events)
      } else if (truck.phase === 'parked' && truck.job === 'deliver' && truck.t >= w.parkedPatience) {
        this.giveUp(truck, deals, events)
      } else if (truck.phase === 'leaving' && truck.t >= w.leaveSeconds) {
        this.trucks = this.trucks.filter((t) => t !== truck)
      }
    }
  }

  /** A delivery that waited too long: the driver drives off with what is still on board (what you carried in stays). */
  private giveUp(truck: Truck, deals: DealManager, events: WarehouseEvent[]): void {
    const load = this.loadOf(truck)
    this.leave(truck)
    if (!load) return
    const left = load.crates - load.taken
    this.loads = this.loads.filter((l) => l !== load)
    truck.onBoard = left
    // A VIP's crates that went back are delivered again later.
    const deal = load.dealId !== null ? deals.signed.find((d) => d.id === load.dealId) : undefined
    if (deal) deal.inTransit = Math.max(0, deal.inTransit - left)
    events.push({ type: 'refused', owner: load.owner, crates: left, vip: load.kind === 'vip', gaveUp: true })
  }

  private schedule(now: number, deals: DealManager, rand: () => number): void {
    const w = CONFIG.warehouse
    if (this.nextKeiAt !== null && now >= this.nextKeiAt) {
      const [lo, hi] = w.keiCrates
      const crates = lo + Math.floor(rand() * (hi - lo + 1))
      const cargo = this.rollKeiCargo(rand())
      const owner = `${KEI_NAMES[Math.floor(rand() * KEI_NAMES.length)]} (kei truck)`
      this.queue.push({ kind: 'kei', job: 'deliver', owner, crates, dealId: null, loadId: ++this.loadSeq, cargo, declared: cargo === 'illegal' ? 'general' : cargo })
      const [gLo, gHi] = w.keiGap
      this.nextKeiAt = now + gLo + (gHi - gLo) * rand()
    }
    for (const deal of deals.signed) {
      if (deal.delivered + deal.inTransit >= deal.crates || now < deal.nextDeliveryAt) continue
      const crates = Math.min(w.boxCrates, deal.crates - deal.delivered - deal.inTransit)
      deal.inTransit += crates
      deal.nextDeliveryAt = now + w.deliveryGap
      this.queue.push({ kind: 'box', job: 'deliver', owner: deal.name, crates, dealId: deal.id, loadId: ++this.loadSeq, cargo: deal.cargoType, declared: deal.cargoType })
    }
    // Owners come back for a load once its time is up and it is all in the warehouse (none on a truck or in your hands).
    const due = new Set<number>()
    for (const c of this.consignments) if (now >= c.collectAt) due.add(c.loadId)
    for (const loadId of due) {
      if (this.queue.some((q) => q.loadId === loadId && q.job === 'collect') || this.trucks.some((t) => t.loadId === loadId)) continue
      if (this.loads.some((l) => l.id === loadId) || this.carrying?.loadId === loadId || this.robotHolds(loadId)) continue
      const c = this.consignments.find((o) => o.loadId === loadId)!
      this.queue.push({ kind: c.kind === 'vip' ? 'box' : 'kei', job: 'collect', owner: c.owner, crates: this.cratesOf(loadId), dealId: null, loadId, cargo: c.cargo, declared: c.cargo })
    }
  }

  private rollKeiCargo(roll: number): CargoType {
    let acc = 0
    for (const [cargo, weight] of Object.entries(CONFIG.warehouse.keiMix) as [CargoType, number][]) {
      acc += weight
      if (roll < acc) return cargo
    }
    return 'general'
  }

  private updateLoads(now: number, events: WarehouseEvent[]): void {
    for (const load of this.loads) {
      if (load.inspectDone !== null && now >= load.inspectDone) {
        load.inspected = true
        load.inspectDone = null
      }
      if (this.scanner) load.inspected = true
      if (load.cargo === 'cold' && !load.spoiled && now - load.arrivedAt > CONFIG.warehouse.coldSpoilSeconds) {
        load.spoiled = true
        events.push({ type: 'spoiled', owner: load.owner, crates: load.crates - load.taken, cargo: 'cold' })
      }
    }
  }

  /** The warehouse robots: each idle robot takes the next job (collections first: they free room), works it, and picks the crate up and puts it down on time. */
  private updateRobots(dt: number, now: number, deals: DealManager, events: WarehouseEvent[]): void {
    const cfg = CONFIG.warehouse.robots
    for (let i = 0; i < this.robots.length; i++) {
      const job = this.robots[i]
      if (!job) {
        if (now < this.nextRobotStart) continue
        const seconds = cfg.seconds[this.autoLevel] ?? 10
        this.robots[i] = this.nextRobotJob(seconds, deals, events)
        if (this.robots[i]) this.nextRobotStart = now + seconds * cfg.stagger
        continue
      }
      job.t += dt
      if (!job.crate && job.t >= job.duration * cfg.grabAt && !this.robotGrab(job, now)) {
        this.robots[i] = null // the crate or the truck has gone: drop the job
        continue
      }
      if (job.crate && job.t >= job.duration) {
        this.robotDrop(job, deals, events)
        this.robots[i] = null
      }
    }
  }

  private nextRobotJob(seconds: number, deals: DealManager, events: WarehouseEvent[]): RobotJob | null {
    const parked = this.trucks.filter((t) => t.phase === 'parked')
    for (const t of parked) {
      if (t.job !== 'collect') continue
      for (const section of SECTIONS) {
        const here = this.consignments.filter((c) => c.loadId === t.loadId && c.section === section).reduce((n, c) => n + c.crates, 0)
        if (here - this.pending(t.loadId, 'out', section) > 0) return { dir: 'out', truckId: t.id, loadId: t.loadId, section, t: 0, duration: seconds, crate: null }
      }
    }
    for (const t of parked) {
      if (t.job !== 'deliver') continue
      const load = this.loadOf(t)
      if (!load || load.inspectDone !== null) continue
      if (load.crates - load.taken - this.pending(load.id, 'in') <= 0) continue
      // With the scanner, contraband that cannot all be hidden is sent back before anything is unloaded.
      if (this.scanner && load.cargo === 'illegal' && load.taken === 0 && this.pending(load.id, 'in') === 0 && this.sectionFree('hidden') < load.crates) {
        const refused = this.refuse(load.id, deals)
        if (refused) events.push({ type: 'refused', owner: refused.owner, crates: refused.crates, vip: refused.kind === 'vip' })
        continue
      }
      const section = this.placeFor(this.visibleCargo(load), 1)
      if (section) return { dir: 'in', truckId: t.id, loadId: load.id, section, t: 0, duration: seconds, crate: null }
    }
    return null
  }

  /** The robot picks its crate up: off the truck, or out of the section. False if it is no longer there. */
  private robotGrab(job: RobotJob, now: number): boolean {
    const truck = this.truck(job.truckId)
    if (!truck || truck.phase !== 'parked') return false
    if (job.dir === 'in') {
      const load = this.loads.find((l) => l.id === job.loadId)
      if (!load || load.taken >= load.crates || load.inspectDone !== null) return false
      load.taken += 1
      truck.onBoard = load.crates - load.taken
      job.crate = { loadId: load.id, owner: load.owner, kind: load.kind, cargo: load.cargo, dealId: load.dealId, spoiled: load.spoiled, deliveredAt: now, collectAt: load.collectAt }
      this.afterTaking(load, truck)
      return true
    }
    const c = this.consignments.find((o) => o.loadId === job.loadId && o.section === job.section)
    if (!c) return false
    const { id: _id, section: _s, crates: _n, ...data } = c
    job.crate = data
    this.removeCrates(c, 1)
    return true
  }

  /** The robot puts its crate down: in its section, or on the collection truck. */
  private robotDrop(job: RobotJob, deals: DealManager, events: WarehouseEvent[]): void {
    const crate = job.crate!
    if (job.dir === 'in') {
      this.addCrates(crate, job.section, 1)
      this.bookDelivered(crate, 1, deals)
      // Tell the player once the whole load is in.
      if (!this.loads.some((l) => l.id === crate.loadId) && !this.robots.some((j) => j !== job && j?.crate?.loadId === crate.loadId)) {
        events.push({ type: 'stored', owner: crate.owner, crates: this.cratesOf(crate.loadId), section: job.section })
      }
      return
    }
    const truck = this.truck(job.truckId)
    if (truck && truck.phase === 'parked') {
      job.crate = null
      this.loadOne(truck, crate)
      this.finishCollection(truck, events)
    } else {
      this.addCrates(crate, job.section, 1) // cannot happen (a collection waits for its crates), but never lose a crate
    }
  }

  private updateSpoilage(now: number, events: WarehouseEvent[]): void {
    const w = CONFIG.warehouse
    for (const c of this.consignments) {
      if (c.spoiled) continue
      const age = now - c.deliveredAt
      const off = c.cargo === 'food' ? age > w.foodShelfLife : c.cargo === 'cold' && c.section !== 'cold' ? age > w.coldSpoilSeconds : false
      if (!off) continue
      c.spoiled = true
      events.push({ type: 'spoiled', owner: c.owner, crates: c.crates, cargo: c.cargo })
    }
  }

  private updateTheft(now: number, rand: () => number, events: WarehouseEvent[]): void {
    const t = CONFIG.warehouse.theft
    if (now < this.nextTheftAt) return
    this.nextTheftAt = now + t.every
    for (const c of [...this.consignments]) {
      if (c.cargo !== 'metals' || c.section === 'vault' || rand() >= t.chance) continue
      const lost = Math.min(c.crates, t.crates[0] + Math.floor(rand() * (t.crates[1] - t.crates[0] + 1)))
      this.removeCrates(c, lost)
      events.push({ type: 'stolen', owner: c.owner, crates: lost })
    }
  }

  private updatePolice(dt: number, now: number, rand: () => number, events: WarehouseEvent[]): void {
    const p = CONFIG.warehouse.police
    const visit = this.police
    if (!visit) {
      if (this.nextPoliceAt === null) {
        if (this.stored >= p.minCrates) this.nextPoliceAt = now + p.gap[0] + (p.gap[1] - p.gap[0]) * rand()
        return
      }
      if (now < this.nextPoliceAt) return
      this.police = { phase: 'arriving', t: 0 }
      events.push({ type: 'policeArrived' })
      return
    }
    visit.t += dt
    if (visit.phase === 'arriving' && visit.t >= p.arriveSeconds) {
      visit.phase = 'inspecting'
      visit.t = 0
    } else if (visit.phase === 'inspecting' && visit.t >= p.inspectSeconds) {
      events.push(this.inspectBuilding(rand))
      visit.phase = 'leaving'
      visit.t = 0
    } else if (visit.phase === 'leaving' && visit.t >= p.leaveSeconds) {
      this.police = null
      this.nextPoliceAt = now + p.gap[0] + (p.gap[1] - p.gap[0]) * rand()
    }
  }

  private inspectBuilding(rand: () => number): WarehouseEvent {
    const p = CONFIG.warehouse.police
    let fine = 0
    let seized = 0
    let illegalFound = false
    for (const c of [...this.consignments]) {
      if (c.cargo !== 'illegal') continue
      const found = c.section === 'hidden' ? rand() < (p.hiddenFind[this.hiddenLevel] ?? 1) : true
      if (!found) continue
      illegalFound = true
      fine += c.crates * p.illegalFinePerCrate
      seized += c.crates
      this.consignments = this.consignments.filter((o) => o !== c)
    }
    const metalsFined = !this.permit && this.consignments.some((c) => c.cargo === 'metals')
    if (metalsFined) fine += p.metalsFine
    this.fines += fine
    return { type: 'police', fine, seizedCrates: seized, illegalFound, metalsFined }
  }
}
