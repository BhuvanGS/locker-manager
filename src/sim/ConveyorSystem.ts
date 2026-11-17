import { AUTO_ZONES, CONFIG, type AutoZone } from './config'
import type { CustomerManager } from './CustomerManager'
import type { LockerManager } from './LockerManager'
import type { ItemId, LockerId } from './types'

/**
 * A bag moving through the conveyor system.
 *  - store: beltIn → (transitIn, for halls) → waitingForArm → arm (files it in `lockerId`) → gone
 *  - fetch: queued → arm (takes it out of `lockerId`) → (transitOut, for halls) → beltOut → ready (on the return tray until taken)
 * `transit*` is the bag travelling through the service duct between the hub and a hall.
 */
export type ParcelPhase = 'beltIn' | 'transitIn' | 'waitingForArm' | 'queued' | 'arm' | 'transitOut' | 'beltOut' | 'ready'

export interface Parcel {
  id: number
  kind: 'store' | 'fetch'
  itemId: ItemId
  lockerId: LockerId
  /** The part of the building the locker is in (its arms serve it), and the row there (rows further in take a little longer). */
  zone: AutoZone
  row: number
  phase: ParcelPhase
  /** Seconds spent in the current phase. */
  t: number
  /** Which arm of the station is working on it (only while `phase` is `arm`). */
  arm: number
  /** Arm steps already done (door opened, bag moved, door shut), so each happens exactly once. */
  step: number
}

/** The arm's job split into moments (fractions of its duration). The 3D arm animates to the same numbers. */
export const ARM_STEPS = {
  store: { open: 0.5, move: 0.64, close: 0.86 },
  fetch: { open: 0.3, move: 0.56, close: 0.82 },
} as const

/** What the system needs to know about lockers that the lockers themselves do not record. */
export interface ConveyorHost {
  zoneOf(lockerId: LockerId): AutoZone
  rowOf(lockerId: LockerId): number
  /** Seeded randomness (for jams). */
  random(): number
  /** An arm of `zone` has just jammed. */
  jammed(zone: AutoZone): void
}

/**
 * The conveyor belts and robot arms: pure simulation, no rendering. The 3D views read `parcels` and `armProgress()` every frame.
 *
 * The system grows in levels. Each zone (storage room, east annex, south hall, floors) is covered once its belt extension is bought,
 * and every zone has its own arm upgrades: speed levels and a second arm. A zone's arms ride an overhead rail network from the
 * bay to every row of lockers; each free arm takes the oldest bag waiting for its zone. Lockers and items are changed here, together, so the records stay consistent.
 */
export class ConveyorSystem {
  parcels: Parcel[] = []
  private seq = 0
  private readonly covered = new Set<AutoZone>()
  private readonly speed = new Map<AutoZone, number>()
  private readonly arms = new Map<AutoZone, number>()
  /** Wear and jams, per arm (`zone:index`). */
  private readonly health = new Map<string, { condition: number; jammed: boolean }>()
  private readonly lockers: LockerManager
  private readonly customers: CustomerManager
  private readonly host: ConveyorHost
  private readonly now: () => number

  constructor(lockers: LockerManager, customers: CustomerManager, host: ConveyorHost, now: () => number) {
    this.lockers = lockers
    this.customers = customers
    this.host = host
    this.now = now
  }

  // ------------------------------------------------------------------ levels

  /** Extend the system to `zone`. */
  cover(zone: AutoZone): void {
    this.covered.add(zone)
  }

  isCovered(zone: AutoZone): boolean {
    return this.covered.has(zone)
  }

  coveredZones(): AutoZone[] {
    return AUTO_ZONES.filter((z) => this.covered.has(z))
  }

  speedLevel(zone: AutoZone): number {
    return this.speed.get(zone) ?? 0
  }

  setSpeedLevel(zone: AutoZone, level: number): void {
    this.speed.set(zone, Math.max(0, Math.min(CONFIG.automation.speedMult.length - 1, level)))
  }

  /** Arms per row in `zone`. */
  armCount(zone: AutoZone): number {
    return this.arms.get(zone) ?? 1
  }

  setArmCount(zone: AutoZone, count: number): void {
    this.arms.set(zone, Math.max(1, Math.min(CONFIG.automation.maxArms, count)))
  }

  // ------------------------------------------------------------------ maintenance

  /** The state of arm `arm` of `zone`: condition 0–100 and whether it is jammed. */
  armHealth(zone: AutoZone, arm: number): { condition: number; jammed: boolean } {
    const key = `${zone}:${arm}`
    let h = this.health.get(key)
    if (!h) {
      h = { condition: 100, jammed: false }
      this.health.set(key, h)
    }
    return h
  }

  /** The arms of `zone` that exist, with their health. */
  zoneArms(zone: AutoZone): { condition: number; jammed: boolean }[] {
    return Array.from({ length: this.armCount(zone) }, (_, i) => this.armHealth(zone, i))
  }

  /** The worst condition among the arms of `zone`. */
  zoneCondition(zone: AutoZone): number {
    return Math.min(...this.zoneArms(zone).map((h) => h.condition))
  }

  jammedCount(zone: AutoZone): number {
    return this.zoneArms(zone).filter((h) => h.jammed).length
  }

  /** Every zone with a jammed arm. */
  jammedZones(): AutoZone[] {
    return this.coveredZones().filter((z) => this.jammedCount(z) > 0)
  }

  /** Routine service: every arm that is not jammed goes back to 100 %. */
  service(zone: AutoZone): void {
    for (const h of this.zoneArms(zone)) if (!h.jammed) h.condition = 100
  }

  /** Repair: jammed arms run again, but only half-fit. */
  repair(zone: AutoZone): void {
    for (const h of this.zoneArms(zone)) {
      if (!h.jammed) continue
      h.jammed = false
      h.condition = Math.max(h.condition, CONFIG.automation.maintenance.repairedCondition)
    }
  }

  /** Worn arms are slower, failing ones slower still. */
  private slowdown(condition: number): number {
    const m = CONFIG.automation.maintenance
    return condition < m.failingBelow ? m.failingSlowdown : condition < m.wornBelow ? m.wornSlowdown : 1
  }

  /** How long `job` takes, with its arm's wear. */
  private jobDuration(job: Parcel): number {
    return this.armDuration(job.zone, job.row) * this.slowdown(this.armHealth(job.zone, job.arm).condition)
  }

  /** A failing arm may jam as it starts a job. */
  private rollJam(job: Parcel): void {
    const m = CONFIG.automation.maintenance
    const h = this.armHealth(job.zone, job.arm)
    if (h.condition >= m.failingBelow) return
    const chance = h.condition <= 0 ? 1 : ((m.failingBelow - h.condition) / m.failingBelow) * m.jamChance
    if (this.host.random() >= chance) return
    h.jammed = true
    this.host.jammed(job.zone)
  }

  private wear(job: Parcel): void {
    const m = CONFIG.automation.maintenance
    const h = this.armHealth(job.zone, job.arm)
    h.condition = Math.max(0, h.condition - m.wearPerJob * (1 + m.speedWear * this.speedLevel(job.zone)))
  }

  /** Seconds one arm job takes in `zone`, for a locker in `row` (longer in the halls, and further in; faster with the speed upgrades). */
  armDuration(zone: AutoZone, row = 0): number {
    const cfg = CONFIG.automation
    const travel = cfg.travelFactor[zone] + cfg.rowTravel * row
    return (cfg.armSeconds * travel) / (cfg.speedMult[this.speedLevel(zone)] ?? 1)
  }

  // ------------------------------------------------------------------ parcels

  /** Put a bag on the way in, bound for `lockerId` (which the caller has already reserved). */
  load(itemId: ItemId, lockerId: LockerId): Parcel {
    return this.add('store', itemId, lockerId, 'beltIn')
  }

  /** Ask an arm to fetch the bag in `lockerId` and bring it to the return tray. */
  request(itemId: ItemId, lockerId: LockerId): Parcel {
    return this.add('fetch', itemId, lockerId, 'queued')
  }

  private add(kind: Parcel['kind'], itemId: ItemId, lockerId: LockerId, phase: ParcelPhase): Parcel {
    const parcel: Parcel = {
      id: ++this.seq,
      kind,
      itemId,
      lockerId,
      zone: this.host.zoneOf(lockerId),
      row: this.host.rowOf(lockerId),
      phase,
      t: 0,
      arm: 0,
      step: 0,
    }
    this.parcels.push(parcel)
    return parcel
  }

  /** Every bag an arm is working on right now. */
  armJobs(): Parcel[] {
    return this.parcels.filter((p) => p.phase === 'arm')
  }

  /** 0…1 through `job`, or 0 if it is not with an arm. */
  armProgress(job: Parcel): number {
    return job.phase === 'arm' ? Math.min(1, job.t / this.jobDuration(job)) : 0
  }

  /** Bags riding in (or waiting at the end of) the loading belt, oldest first. Halls' bags leave the belt into the duct at its end. */
  inbound(): Parcel[] {
    return this.parcels.filter((p) => p.kind === 'store' && (p.phase === 'beltIn' || (p.phase === 'waitingForArm' && p.zone === 'main')))
  }

  /** Bags on the return belt or waiting on the tray, oldest first. */
  returning(): Parcel[] {
    return this.parcels.filter((p) => p.kind === 'fetch' && (p.phase === 'beltOut' || p.phase === 'ready'))
  }

  /** Fetches in progress at any stage: each occupies a place on the return side. */
  fetchesInProgress(): number {
    return this.parcels.filter((p) => p.kind === 'fetch').length
  }

  /**
   * Whether the system still has business with this locker: a bag bound for it that the arm has not filed yet, or a fetch the arm has not
   * finished. (Once the arm has taken a bag out and shut the door, the bag riding the belt back no longer ties the locker up.)
   */
  isBusy(lockerId: LockerId): boolean {
    return this.parcels.some((p) => p.lockerId === lockerId && (p.kind === 'store' || p.phase === 'queued' || p.phase === 'arm'))
  }

  /** The oldest bag waiting on the return tray, removed from the system. Null if none. */
  takeReady(): Parcel | null {
    const at = this.parcels.findIndex((p) => p.phase === 'ready')
    if (at < 0) return null
    return this.parcels.splice(at, 1)[0] ?? null
  }

  /** The bag of `itemId` waiting on the return tray, removed from the system (the counter arm collects bags for customers). */
  takeReadyFor(itemId: ItemId): Parcel | null {
    const at = this.parcels.findIndex((p) => p.phase === 'ready' && p.itemId === itemId)
    if (at < 0) return null
    return this.parcels.splice(at, 1)[0] ?? null
  }

  /** Whether the bag of `itemId` is on the return tray, ready to be collected. */
  isReady(itemId: ItemId): boolean {
    return this.parcels.some((p) => p.phase === 'ready' && p.itemId === itemId)
  }

  get readyCount(): number {
    return this.parcels.filter((p) => p.phase === 'ready').length
  }

  update(dt: number): void {
    if (dt <= 0) return
    const cfg = CONFIG.automation
    for (const p of this.parcels) {
      if (p.phase === 'beltIn') {
        p.t += dt
        if (p.t >= cfg.beltSeconds) this.setPhase(p, p.zone === 'main' ? 'waitingForArm' : 'transitIn')
      } else if (p.phase === 'transitIn') {
        p.t += dt
        if (p.t >= cfg.transit[p.zone]) this.setPhase(p, 'waitingForArm')
      } else if (p.phase === 'transitOut') {
        p.t += dt
        if (p.t >= cfg.transit[p.zone]) this.setPhase(p, 'beltOut')
      } else if (p.phase === 'beltOut') {
        p.t += dt
        if (p.t >= cfg.beltSeconds) this.setPhase(p, 'ready')
      }
    }

    // A free arm takes the oldest bag waiting for its station.
    for (const p of this.parcels) {
      if (p.phase !== 'waitingForArm' && p.phase !== 'queued') continue
      const busy = new Set(this.parcels.filter((o) => o.phase === 'arm' && o.zone === p.zone).map((o) => o.arm))
      for (let arm = 0; arm < this.armCount(p.zone); arm++) {
        if (busy.has(arm)) continue
        p.arm = arm
        this.setPhase(p, 'arm')
        this.rollJam(p)
        break
      }
    }

    for (const job of this.armJobs()) {
      if (this.armHealth(job.zone, job.arm).jammed) continue // stuck until it is repaired
      job.t += dt
      const progress = job.t / this.jobDuration(job)
      const at = ARM_STEPS[job.kind]
      if (job.step < 1 && progress >= at.open) {
        job.step = 1
        this.openDoor(job)
      }
      if (job.step < 2 && progress >= at.move) {
        job.step = 2
        if (job.kind === 'store') this.fileAway(job)
        else this.takeOut(job)
      }
      if (job.step < 3 && progress >= at.close) {
        job.step = 3
        this.lockers.close(job.lockerId)
        // A filed bag is locked in by the electronic lock; after a fetch the empty locker is simply free.
        if (job.kind === 'store') this.lockers.setLocked(job.lockerId, true)
      }
      if (progress >= 1) {
        this.wear(job)
        // The arm is done: the locker is back in play (holding the bag, or empty).
        this.lockers.get(job.lockerId).state = job.kind === 'store' ? 'occupied' : 'available'
        if (job.kind === 'store') this.parcels = this.parcels.filter((p) => p !== job)
        else this.setPhase(job, job.zone === 'main' ? 'beltOut' : 'transitOut')
      }
    }
  }

  private setPhase(p: Parcel, phase: ParcelPhase): void {
    p.phase = phase
    p.t = 0
  }

  private openDoor(job: Parcel): void {
    // A fetched bag sits behind an electronic lock: the arm releases it first.
    if (job.kind === 'fetch') this.lockers.setLocked(job.lockerId, false)
    this.lockers.open(job.lockerId)
  }

  private fileAway(job: Parcel): void {
    const item = this.customers.item(job.itemId)
    if (!this.lockers.get(job.lockerId).doorOpen) this.lockers.open(job.lockerId) // (the player cannot shut it, but never trust that)
    this.lockers.put(job.lockerId, item.id)
    this.lockers.get(job.lockerId).state = 'reserved' // the arm is still closing the door: nobody else may touch it yet
    item.status = 'inLocker'
    item.lockerId = job.lockerId
    item.depositedAt ??= this.now()
    this.customers.get(item.customerId).lockerId = job.lockerId
  }

  private takeOut(job: Parcel): void {
    if (!this.lockers.get(job.lockerId).doorOpen) this.lockers.open(job.lockerId)
    const item = this.customers.item(this.lockers.take(job.lockerId))
    this.lockers.get(job.lockerId).state = 'reserved' // still the arm's until it has shut the door
    item.status = 'onConveyor'
    item.lockerId = null
    this.customers.get(item.customerId).lockerId = null
  }
}
