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
  /** The part of the building the locker is in, and its row there: together they say which arm station serves it. */
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
}

/**
 * The conveyor belts and robot arms: pure simulation, no rendering. The 3D views read `parcels` and `armProgress()` every frame.
 *
 * The system grows in levels. Each zone (storage room, east annex, south hall, floors) is covered once its belt extension is bought,
 * and every zone has its own arm upgrades: speed levels and a second arm. Every row of lockers is an arm station; a station's arms
 * each take the oldest bag waiting for it. Lockers and items are changed here, together, so the records stay consistent.
 */
export class ConveyorSystem {
  parcels: Parcel[] = []
  private seq = 0
  private readonly covered = new Set<AutoZone>()
  private readonly speed = new Map<AutoZone, number>()
  private readonly arms = new Map<AutoZone, number>()
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

  /** Seconds one arm job takes in `zone` (faster with the speed upgrades). */
  armDuration(zone: AutoZone): number {
    return CONFIG.automation.armSeconds / (CONFIG.automation.speedMult[this.speedLevel(zone)] ?? 1)
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
    return job.phase === 'arm' ? Math.min(1, job.t / this.armDuration(job.zone)) : 0
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

  /** Whether a parcel (either kind) is bound for or taken from this locker. */
  isBusy(lockerId: LockerId): boolean {
    return this.parcels.some((p) => p.lockerId === lockerId)
  }

  /** The oldest bag waiting on the return tray, removed from the system. Null if none. */
  takeReady(): Parcel | null {
    const at = this.parcels.findIndex((p) => p.phase === 'ready')
    if (at < 0) return null
    return this.parcels.splice(at, 1)[0] ?? null
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
      const busy = new Set(this.parcels.filter((o) => o.phase === 'arm' && o.zone === p.zone && o.row === p.row).map((o) => o.arm))
      for (let arm = 0; arm < this.armCount(p.zone); arm++) {
        if (busy.has(arm)) continue
        p.arm = arm
        this.setPhase(p, 'arm')
        break
      }
    }

    for (const job of this.armJobs()) {
      job.t += dt
      const progress = job.t / this.armDuration(job.zone)
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
    this.lockers.put(job.lockerId, item.id)
    item.status = 'inLocker'
    item.lockerId = job.lockerId
    item.depositedAt ??= this.now()
    this.customers.get(item.customerId).lockerId = job.lockerId
  }

  private takeOut(job: Parcel): void {
    const item = this.customers.item(this.lockers.take(job.lockerId))
    item.status = 'onConveyor'
    item.lockerId = null
    this.customers.get(item.customerId).lockerId = null
  }
}
