import { CONFIG } from './config'
import type { CustomerManager } from './CustomerManager'
import type { LockerManager } from './LockerManager'
import type { ItemId, LockerId } from './types'

/**
 * A bag moving through the conveyor system.
 *  - store: beltIn → waitingForArm → arm (the arm files it in `lockerId`) → gone
 *  - fetch: queued → arm (the arm takes it out of `lockerId`) → beltOut → ready (on the return tray until the player takes it)
 */
export type ParcelPhase = 'beltIn' | 'waitingForArm' | 'queued' | 'arm' | 'beltOut' | 'ready'

export interface Parcel {
  id: number
  kind: 'store' | 'fetch'
  itemId: ItemId
  lockerId: LockerId
  phase: ParcelPhase
  /** Seconds spent in the current phase. */
  t: number
  /** Arm steps already done (door opened, bag moved, door shut), so each happens exactly once. */
  step: number
}

/** The arm's job split into moments (fractions of `armSeconds`). The 3D arm animates to the same numbers. */
export const ARM_STEPS = {
  store: { open: 0.5, move: 0.64, close: 0.86 },
  fetch: { open: 0.3, move: 0.56, close: 0.82 },
} as const

/**
 * The conveyor belt and its single robot arm: pure simulation, no rendering. The 3D views read `parcels` and
 * `armProgress()` every frame. The arm does one job at a time, oldest first, so a busy shop makes bags queue on the belt.
 * Lockers and items are changed here, together, so the records stay consistent (door, lock, item and customer all agree).
 */
export class ConveyorSystem {
  parcels: Parcel[] = []
  private seq = 0
  private readonly lockers: LockerManager
  private readonly customers: CustomerManager
  private readonly now: () => number

  constructor(lockers: LockerManager, customers: CustomerManager, now: () => number) {
    this.lockers = lockers
    this.customers = customers
    this.now = now
  }

  /** Put a bag on the way in, bound for `lockerId` (which the caller has already reserved). */
  load(itemId: ItemId, lockerId: LockerId): Parcel {
    return this.add('store', itemId, lockerId, 'beltIn')
  }

  /** Ask the arm to fetch the bag in `lockerId` and bring it to the return tray. */
  request(itemId: ItemId, lockerId: LockerId): Parcel {
    return this.add('fetch', itemId, lockerId, 'queued')
  }

  private add(kind: Parcel['kind'], itemId: ItemId, lockerId: LockerId, phase: ParcelPhase): Parcel {
    const parcel: Parcel = { id: ++this.seq, kind, itemId, lockerId, phase, t: 0, step: 0 }
    this.parcels.push(parcel)
    return parcel
  }

  /** The bag the arm is working on, if any. */
  armJob(): Parcel | null {
    return this.parcels.find((p) => p.phase === 'arm') ?? null
  }

  /** 0…1 through the arm's current job, or null when it is idle. */
  armProgress(): number | null {
    const job = this.armJob()
    return job ? Math.min(1, job.t / CONFIG.automation.armSeconds) : null
  }

  /** Bags riding in (or waiting at the end of) the loading belt, oldest first. */
  inbound(): Parcel[] {
    return this.parcels.filter((p) => p.kind === 'store' && (p.phase === 'beltIn' || p.phase === 'waitingForArm'))
  }

  /** Bags on the return belt or waiting on the tray, oldest first. */
  returning(): Parcel[] {
    return this.parcels.filter((p) => p.kind === 'fetch' && (p.phase === 'beltOut' || p.phase === 'ready'))
  }

  /** Fetches that are queued, with the arm, or on the belt or tray: each occupies a place on the return side. */
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
        if (p.t >= cfg.beltSeconds) this.setPhase(p, 'waitingForArm')
      } else if (p.phase === 'beltOut') {
        p.t += dt
        if (p.t >= cfg.beltSeconds) this.setPhase(p, 'ready')
      }
    }
    // The arm takes the oldest bag that is ready for it.
    if (!this.armJob()) {
      const next = this.parcels.find((p) => p.phase === 'waitingForArm' || p.phase === 'queued')
      if (next) this.setPhase(next, 'arm')
    }
    const job = this.armJob()
    if (!job) return
    job.t += dt
    const progress = job.t / cfg.armSeconds
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
      else this.setPhase(job, 'beltOut')
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
