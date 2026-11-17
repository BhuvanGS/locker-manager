import { CONFIG } from './config'
import type { DealManager } from './DealManager'

/** Crates sitting in the warehouse for one owner: a kei trucker's small load, or part of a VIP deal. */
export interface Consignment {
  id: number
  owner: string
  kind: 'kei' | 'vip'
  crates: number
  deliveredAt: number
  /** Game time at which the owner's truck comes to collect them. */
  collectAt: number
  dealId: number | null
}

/** The truck at the loading bay. There is one bay, so trucks queue in the road and take their turn. */
export interface Truck {
  id: number
  kind: 'kei' | 'box'
  job: 'deliver' | 'collect'
  owner: string
  crates: number
  /** For a delivery that is turned away (no room) the truck still goes through the motions, then leaves loaded. */
  rejected: boolean
  phase: 'arriving' | 'unloading' | 'leaving'
  /** Seconds in the current phase. */
  t: number
}

type Pending = { kind: Truck['kind']; job: Truck['job']; owner: string; crates: number; dealId: number | null; consignmentId: number | null }

/** Something that happened, for the game to turn into toasts, money and reputation. */
export type WarehouseEvent =
  | { type: 'delivered'; owner: string; crates: number }
  | { type: 'turnedAway'; owner: string; crates: number; vip: boolean }
  | { type: 'collected'; owner: string; crates: number; paid: number; vip: boolean }

/**
 * The warehouse: pure simulation. Kei truckers (small independent drivers) turn up now and then with a few crates; VIP deals you signed in
 * the office are delivered in box-truck loads. Crates take shelf room (`capacity`); a load that does not fit is turned away (and costs
 * reputation). Owners come back for their crates after a while and pay for the storage. One truck at the bay at a time.
 */
export class WarehouseManager {
  capacity: number = CONFIG.warehouse.capacity
  consignments: Consignment[] = []
  truck: Truck | null = null
  private queue: Pending[] = []
  /** What the truck at the bay is here for. */
  private pending: Pending | null = null
  private nextKeiAt: number | null = null
  private seq = 0
  private truckSeq = 0
  /** Money earned and loads handled so far (for the notice board). */
  earned = 0
  collected = 0

  /** The warehouse has just opened. */
  start(now: number): void {
    this.nextKeiAt = now + CONFIG.warehouse.firstKeiDelay
  }

  get stored(): number {
    return this.consignments.reduce((n, c) => n + c.crates, 0)
  }

  get free(): number {
    return Math.max(0, this.capacity - this.stored)
  }

  /** Loads waiting in the road for their turn at the bay. */
  get waiting(): number {
    return this.queue.length
  }

  update(dt: number, now: number, deals: DealManager, rand: () => number): WarehouseEvent[] {
    const events: WarehouseEvent[] = []
    const w = CONFIG.warehouse
    this.schedule(now, deals, rand)

    if (!this.truck) {
      const next = this.queue.shift()
      if (next) {
        this.truck = {
          id: ++this.truckSeq,
          kind: next.kind,
          job: next.job,
          owner: next.owner,
          crates: next.crates,
          rejected: false,
          phase: 'arriving',
          t: 0,
        }
        this.pending = next
      }
    }
    const truck = this.truck
    if (!truck) return events
    truck.t += dt
    if (truck.phase === 'arriving' && truck.t >= w.arriveSeconds) {
      truck.phase = 'unloading'
      truck.t = 0
    } else if (truck.phase === 'unloading' && truck.t >= w.unloadSeconds) {
      this.finishWork(truck, now, deals, rand, events)
      truck.phase = 'leaving'
      truck.t = 0
    } else if (truck.phase === 'leaving' && truck.t >= w.leaveSeconds) {
      this.truck = null
      this.pending = null
    }
    return events
  }

  /** Decide who turns up next: kei truckers at random, VIP deliveries as the deals' crates come due, and owners collecting. */
  private schedule(now: number, deals: DealManager, rand: () => number): void {
    const w = CONFIG.warehouse
    if (this.nextKeiAt !== null && now >= this.nextKeiAt) {
      const [lo, hi] = w.keiCrates
      const crates = lo + Math.floor(rand() * (hi - lo + 1))
      this.queue.push({ kind: 'kei', job: 'deliver', owner: `${KEI_NAMES[Math.floor(rand() * KEI_NAMES.length)]} (kei truck)`, crates, dealId: null, consignmentId: null })
      const [gLo, gHi] = w.keiGap
      this.nextKeiAt = now + gLo + (gHi - gLo) * rand()
    }
    for (const deal of deals.signed) {
      if (deal.delivered + deal.inTransit >= deal.crates || now < deal.nextDeliveryAt) continue
      const crates = Math.min(w.boxCrates, deal.crates - deal.delivered - deal.inTransit)
      deal.inTransit += crates
      deal.nextDeliveryAt = now + w.deliveryGap
      this.queue.push({ kind: 'box', job: 'deliver', owner: deal.name, crates, dealId: deal.id, consignmentId: null })
    }
    for (const c of this.consignments) {
      if (now < c.collectAt || this.queue.some((p) => p.consignmentId === c.id) || this.truck?.owner === c.owner) continue
      this.queue.push({ kind: c.kind === 'vip' ? 'box' : 'kei', job: 'collect', owner: c.owner, crates: c.crates, dealId: null, consignmentId: c.id })
    }
  }

  /** The truck has finished at the bay: put the crates in (or turn them away), or hand them back and get paid. */
  private finishWork(truck: Truck, now: number, deals: DealManager, rand: () => number, events: WarehouseEvent[]): void {
    const w = CONFIG.warehouse
    const job = this.pending
    if (!job) return
    if (truck.job === 'deliver') {
      const vip = job.dealId !== null
      const deal = vip ? deals.signed.find((d) => d.id === job.dealId) : undefined
      if (deal) deal.inTransit = Math.max(0, deal.inTransit - truck.crates)
      if (truck.crates > this.free) {
        truck.rejected = true
        events.push({ type: 'turnedAway', owner: truck.owner, crates: truck.crates, vip })
        return
      }
      if (deal) deal.delivered += truck.crates
      const [sLo, sHi] = w.keiStay
      this.consignments.push({
        id: ++this.seq,
        owner: truck.owner,
        kind: vip ? 'vip' : 'kei',
        crates: truck.crates,
        deliveredAt: now,
        collectAt: now + (vip ? w.vipStay : sLo + (sHi - sLo) * rand()),
        dealId: job.dealId,
      })
      events.push({ type: 'delivered', owner: truck.owner, crates: truck.crates })
      return
    }
    const at = this.consignments.findIndex((c) => c.id === job.consignmentId)
    const c = this.consignments[at]
    if (!c) return
    this.consignments.splice(at, 1)
    const vip = c.kind === 'vip'
    const paid = c.crates * (vip ? w.vipFeePerCrate : w.keiFeePerCrate)
    this.earned += paid
    this.collected += c.crates
    events.push({ type: 'collected', owner: c.owner, crates: c.crates, paid, vip })
  }
}

const KEI_NAMES = ['Hiro', 'Daichi', 'Kenji', 'Sota', 'Ayumi', 'Ren', 'Yuki', 'Takumi', 'Mei', 'Haruto']
