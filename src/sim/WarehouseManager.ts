import { CONFIG, SECTIONS, WAREHOUSE_UPGRADES, type CargoType, type Section } from './config'
import type { DealManager } from './DealManager'

/** Crates sitting in the warehouse for one owner. */
export interface Consignment {
  id: number
  owner: string
  kind: 'kei' | 'vip'
  /** What is really in the crates. */
  cargo: CargoType
  section: Section
  crates: number
  deliveredAt: number
  /** Game time at which the owner's truck comes to collect them. */
  collectAt: number
  dealId: number | null
  /** Food that went off, or cold-chain goods that were not kept cold: worth nothing, and the owner is not happy. */
  spoiled: boolean
}

/** A load that has been unloaded at the receiving dock and waits for a decision: store it, look inside it, or send it back. */
export interface PendingLoad {
  id: number
  owner: string
  kind: 'kei' | 'vip'
  cargo: CargoType
  /** What the driver says it is. For contraband this is a lie. */
  declared: CargoType
  crates: number
  dealId: number | null
  arrivedAt: number
  /** You opened the crates (or the scanner did): the real contents are known. */
  inspected: boolean
  /** While someone is opening the crates: when they are done. */
  inspectDone: number | null
  spoiled: boolean
}

/** The truck at the loading bay. There is one bay, so trucks queue in the road and take their turn. */
export interface Truck {
  id: number
  kind: 'kei' | 'box'
  job: 'deliver' | 'collect'
  owner: string
  crates: number
  /** What it says on the side (for a delivery). */
  declared: CargoType
  phase: 'arriving' | 'unloading' | 'leaving'
  /** Seconds in the current phase. */
  t: number
}

export interface PoliceVisit {
  phase: 'arriving' | 'inspecting' | 'leaving'
  t: number
}

type Queued = {
  kind: Truck['kind']
  job: Truck['job']
  owner: string
  crates: number
  dealId: number | null
  consignmentId: number | null
  cargo: CargoType
  declared: CargoType
}

/** Something that happened, for the game to turn into toasts, money and reputation. */
export type WarehouseEvent =
  | { type: 'arrived'; owner: string; crates: number; declared: CargoType }
  | { type: 'stored'; owner: string; crates: number; section: Section }
  | { type: 'refused'; owner: string; crates: number; vip: boolean }
  | { type: 'collected'; owner: string; crates: number; paid: number; vip: boolean; spoiled: boolean }
  | { type: 'spoiled'; owner: string; crates: number; cargo: CargoType }
  | { type: 'stolen'; owner: string; crates: number }
  | { type: 'policeArrived' }
  | { type: 'police'; fine: number; seizedCrates: number; illegalFound: boolean; metalsFined: boolean }

/** Why a load could not be stored. */
export type StoreResult = { ok: true; section: Section; load: PendingLoad } | { ok: false; reason: string }

const KEI_NAMES = ['Hiro', 'Daichi', 'Kenji', 'Sota', 'Ayumi', 'Ren', 'Yuki', 'Takumi', 'Mei', 'Haruto']

/**
 * The warehouse: pure simulation. Trucks bring loads of crates (kei truckers at random, your VIP deals in box trucks); each load is
 * unloaded at the receiving dock, where it waits until it is stored (by you at the receiving desk, or by the receiving robots), inspected or
 * sent back. Crates are kept in sections (shelves, cold room, vault, hidden compartments) with limited room. Food spoils, cold-chain goods
 * spoil unless they are in the cold room, special metals get stolen from the open shelves, and now and then the police check for contraband and
 * unlicensed metals. Owners come back for their crates after a while and pay by what is in them.
 */
export class WarehouseManager {
  consignments: Consignment[] = []
  receiving: PendingLoad[] = []
  truck: Truck | null = null
  police: PoliceVisit | null = null
  /** Shelf slots, and the slots of the other sections (they start at 0 and come with upgrades). */
  capacity: number = CONFIG.warehouse.startShelves
  coldCapacity = 0
  vaultCapacity = 0
  hiddenCapacity = 0
  /** 0 = no hidden compartments, 1 or 2 = how well they hide things. */
  hiddenLevel = 0
  permit = false
  scanner = false
  /** 0 = you do the receiving, 1 and 2 = the robots do. */
  autoLevel = 0
  /** Money earned, crates handled and fines paid so far (for the notice board). */
  earned = 0
  collected = 0
  fines = 0
  private queue: Queued[] = []
  private pending: Queued | null = null
  private nextKeiAt: number | null = null
  private nextPoliceAt: number | null = null
  private nextTheftAt = 0
  private nextAutoAt = 0
  private seq = 0
  private truckSeq = 0
  private loadSeq = 0
  private readonly owned = new Set<string>()

  /** The warehouse has just opened. */
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

  sectionFree(section: Section): number {
    return Math.max(0, this.sectionCapacity(section) - this.sectionStored(section))
  }

  /** Free shelf room (the main section). */
  get free(): number {
    return this.sectionFree('shelves')
  }

  /** Loads waiting in the road for their turn at the bay. */
  get waiting(): number {
    return this.queue.length
  }

  /** Which sections exist (have any room). */
  sections(): Section[] {
    return SECTIONS.filter((s) => this.sectionCapacity(s) > 0)
  }

  /** What a load looks like to you: its real contents if you know them, otherwise what the driver says. */
  visibleCargo(load: PendingLoad): CargoType {
    return load.inspected || this.scanner ? load.cargo : load.declared
  }

  /** Where a load that looks like `visible` would go, with the fallback to the shelves. Null if there is no room anywhere for it. */
  placeFor(visible: CargoType, crates: number): Section | null {
    const preferred: Section = visible === 'cold' ? 'cold' : visible === 'metals' ? 'vault' : visible === 'illegal' ? 'hidden' : 'shelves'
    if (this.sectionFree(preferred) >= crates) return preferred
    return this.sectionFree('shelves') >= crates ? 'shelves' : null
  }

  // ------------------------------------------------------------------ upgrades

  has(id: string): boolean {
    return this.owned.has(id)
  }

  /** Apply a warehouse upgrade (the game has already checked it can be bought and taken the money). */
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
      this.hiddenCapacity = 16
    } else if (id === 'wh-auto-1') this.autoLevel = 1
    else if (id === 'wh-auto-2') this.autoLevel = 2
  }

  // ------------------------------------------------------------------ the receiving desk

  /** Store a waiting load where it looks like it belongs. `stay` (0…1) decides how long a trucker leaves their crates. */
  store(loadId: number, now: number, stay = 0.5): StoreResult {
    const load = this.receiving.find((l) => l.id === loadId)
    if (!load) return { ok: false, reason: 'That load has gone.' }
    if (load.inspectDone !== null) return { ok: false, reason: 'They are still opening the crates.' }
    const section = this.placeFor(this.visibleCargo(load), load.crates)
    if (!section) return { ok: false, reason: 'No room for it. Refuse it, or make some room.' }
    this.receiving = this.receiving.filter((l) => l !== load)
    const w = CONFIG.warehouse
    const [sLo, sHi] = w.keiStay
    this.consignments.push({
      id: ++this.seq,
      owner: load.owner,
      kind: load.kind,
      cargo: load.cargo,
      section,
      crates: load.crates,
      deliveredAt: now,
      collectAt: now + (load.kind === 'vip' ? w.vipStay : sLo + (sHi - sLo) * stay),
      dealId: load.dealId,
      spoiled: load.spoiled,
    })
    return { ok: true, section, load }
  }

  /** Start opening a load's crates: after a few seconds you know what is really in them. */
  inspect(loadId: number, now: number): boolean {
    const load = this.receiving.find((l) => l.id === loadId)
    if (!load || load.inspected || load.inspectDone !== null) return false
    load.inspectDone = now + CONFIG.warehouse.inspectSeconds
    return true
  }

  /** Send a load back with its driver (a VIP load will be tried again later). */
  refuse(loadId: number, deals: DealManager): PendingLoad | null {
    const load = this.receiving.find((l) => l.id === loadId)
    if (!load) return null
    this.receiving = this.receiving.filter((l) => l !== load)
    const deal = load.dealId !== null ? deals.signed.find((d) => d.id === load.dealId) : undefined
    if (deal) deal.inTransit = Math.max(0, deal.inTransit - load.crates)
    return load
  }

  /** Book a stored VIP load against its deal. */
  afterStored(load: PendingLoad, deals: DealManager): void {
    const deal = load.dealId !== null ? deals.signed.find((d) => d.id === load.dealId) : undefined
    if (deal) {
      deal.inTransit = Math.max(0, deal.inTransit - load.crates)
      deal.delivered += load.crates
    }
  }

  // ------------------------------------------------------------------ time

  update(dt: number, now: number, deals: DealManager, rand: () => number): WarehouseEvent[] {
    const events: WarehouseEvent[] = []
    this.schedule(now, deals, rand)
    this.updateTruck(dt, now, events)
    this.updateLoads(now, events)
    this.updateAuto(now, deals, rand, events)
    this.updateSpoilage(now, events)
    this.updateTheft(now, rand, events)
    this.updatePolice(dt, now, rand, events)
    return events
  }

  private updateTruck(dt: number, now: number, events: WarehouseEvent[]): void {
    const w = CONFIG.warehouse
    if (!this.truck) {
      // The next truck in the road that can use the bay: a collection always can, a delivery needs room on the dock.
      const at = this.queue.findIndex((q) => q.job === 'collect' || this.receiving.length < w.dockSlots)
      if (at >= 0) {
        const next = this.queue.splice(at, 1)[0]!
        this.pending = next
        this.truck = { id: ++this.truckSeq, kind: next.kind, job: next.job, owner: next.owner, crates: next.crates, declared: next.declared, phase: 'arriving', t: 0 }
      }
    }
    const truck = this.truck
    if (!truck) return
    truck.t += dt
    if (truck.phase === 'arriving' && truck.t >= w.arriveSeconds) {
      truck.phase = 'unloading'
      truck.t = 0
    } else if (truck.phase === 'unloading' && truck.t >= w.unloadSeconds) {
      this.finishWork(truck, now, events)
      truck.phase = 'leaving'
      truck.t = 0
    } else if (truck.phase === 'leaving' && truck.t >= w.leaveSeconds) {
      this.truck = null
      this.pending = null
    }
  }

  /** Decide who turns up next: kei truckers at random, VIP deliveries as the deals' crates come due, and owners collecting. */
  private schedule(now: number, deals: DealManager, rand: () => number): void {
    const w = CONFIG.warehouse
    if (this.nextKeiAt !== null && now >= this.nextKeiAt) {
      const [lo, hi] = w.keiCrates
      const crates = lo + Math.floor(rand() * (hi - lo + 1))
      const cargo = this.rollKeiCargo(rand())
      this.queue.push({
        kind: 'kei',
        job: 'deliver',
        owner: `${KEI_NAMES[Math.floor(rand() * KEI_NAMES.length)]} (kei truck)`,
        crates,
        dealId: null,
        consignmentId: null,
        cargo,
        declared: cargo === 'illegal' ? 'general' : cargo,
      })
      const [gLo, gHi] = w.keiGap
      this.nextKeiAt = now + gLo + (gHi - gLo) * rand()
    }
    for (const deal of deals.signed) {
      if (deal.delivered + deal.inTransit >= deal.crates || now < deal.nextDeliveryAt) continue
      const crates = Math.min(w.boxCrates, deal.crates - deal.delivered - deal.inTransit)
      deal.inTransit += crates
      deal.nextDeliveryAt = now + w.deliveryGap
      this.queue.push({ kind: 'box', job: 'deliver', owner: deal.name, crates, dealId: deal.id, consignmentId: null, cargo: deal.cargoType, declared: deal.cargoType })
    }
    for (const c of this.consignments) {
      if (now < c.collectAt || this.queue.some((q) => q.consignmentId === c.id) || this.pending?.consignmentId === c.id) continue
      this.queue.push({ kind: c.kind === 'vip' ? 'box' : 'kei', job: 'collect', owner: c.owner, crates: c.crates, dealId: null, consignmentId: c.id, cargo: c.cargo, declared: c.cargo })
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

  /** The truck has finished at the bay: its crates join the dock to wait for a decision, or the owner's crates go back with it and pay. */
  private finishWork(truck: Truck, now: number, events: WarehouseEvent[]): void {
    const job = this.pending
    if (!job) return
    if (truck.job === 'deliver') {
      this.receiving.push({
        id: ++this.loadSeq,
        owner: truck.owner,
        kind: job.kind === 'box' ? 'vip' : 'kei',
        cargo: job.cargo,
        declared: job.declared,
        crates: truck.crates,
        dealId: job.dealId,
        arrivedAt: now,
        inspected: false,
        inspectDone: null,
        spoiled: false,
      })
      events.push({ type: 'arrived', owner: truck.owner, crates: truck.crates, declared: job.declared })
      return
    }
    const at = this.consignments.findIndex((c) => c.id === job.consignmentId)
    const c = this.consignments[at]
    if (!c) return
    this.consignments.splice(at, 1)
    const vip = c.kind === 'vip'
    const rate = CONFIG.warehouse.cargo[c.cargo].fee * (vip ? CONFIG.warehouse.vipFeeFactor : 1)
    const paid = c.spoiled ? 0 : Math.round(c.crates * rate)
    this.earned += paid
    this.collected += c.crates
    events.push({ type: 'collected', owner: c.owner, crates: c.crates, paid, vip, spoiled: c.spoiled })
  }

  /** Crates being opened finish being opened; cold-chain goods left on the dock go off; a scanner reveals everything on arrival. */
  private updateLoads(now: number, events: WarehouseEvent[]): void {
    for (const load of this.receiving) {
      if (load.inspectDone !== null && now >= load.inspectDone) {
        load.inspected = true
        load.inspectDone = null
      }
      if (this.scanner) load.inspected = true
      if (load.cargo === 'cold' && !load.spoiled && now - load.arrivedAt > CONFIG.warehouse.coldSpoilSeconds) {
        load.spoiled = true
        events.push({ type: 'spoiled', owner: load.owner, crates: load.crates, cargo: 'cold' })
      }
    }
  }

  /** The receiving robots take the oldest load every few seconds. */
  private updateAuto(now: number, deals: DealManager, rand: () => number, events: WarehouseEvent[]): void {
    const secs = CONFIG.warehouse.autoSeconds[this.autoLevel] ?? 0
    if (secs <= 0 || now < this.nextAutoAt) return
    const load = this.receiving.find((l) => l.inspectDone === null)
    if (!load) return
    this.nextAutoAt = now + secs
    // With the scanner the robots know contraband for what it is: they hide it if they can and otherwise send it back.
    if (this.scanner && load.cargo === 'illegal' && this.sectionFree('hidden') < load.crates) {
      const refused = this.refuse(load.id, deals)
      if (refused) events.push({ type: 'refused', owner: refused.owner, crates: refused.crates, vip: refused.kind === 'vip' })
      return
    }
    const result = this.store(load.id, now, rand())
    if (result.ok) {
      this.afterStored(result.load, deals)
      events.push({ type: 'stored', owner: result.load.owner, crates: result.load.crates, section: result.section })
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
      c.crates -= lost
      if (c.crates <= 0) this.consignments = this.consignments.filter((o) => o !== c)
      events.push({ type: 'stolen', owner: c.owner, crates: lost })
    }
  }

  /** Once the warehouse is big enough the police start to check, rarely: they park outside, look round, and leave. */
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

  /** What the police find: contraband in the open always, hidden contraband sometimes, special metals without the licence. */
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
