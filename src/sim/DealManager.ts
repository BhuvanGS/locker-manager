import { CONFIG, type CargoType } from './config'

/** A VIP's offer, waiting at the deal desk. */
export interface Offer {
  id: number
  /** Which entry of `CONFIG.deals.vips`. */
  vip: number
  name: string
  title: string
  /** What they want stored, in words ("online-shop parcels"). */
  cargo: string
  /** What kind of goods that is (it decides where in the warehouse they must go). */
  cargoType: CargoType
  crates: number
  /** Paid the moment you sign. */
  retainer: number
  /** Game time at which they are at the desk (before that their car is still pulling up in the street). */
  readyAt: number
  /** Game time at which they give up waiting. */
  expiresAt: number
  haggled: boolean
}

/** A deal you signed. The crates arrive once there is a warehouse to put them in. */
export interface SignedDeal {
  id: number
  name: string
  title: string
  cargo: string
  cargoType: CargoType
  crates: number
  retainer: number
  signedAt: number
  /** Crates already in the warehouse, on a truck now, and when the next load is due. */
  delivered: number
  inTransit: number
  nextDeliveryAt: number
}

export type OfferEvent = 'offered' | 'expired' | null

/**
 * VIP deals: the big names who want to store their stock with you. Pure simulation. Once the deal office exists and your reputation is
 * high enough, one VIP at a time turns up with an offer and waits at the desk for a while. You can sign, haggle (more money, but they
 * may walk out) or decline. Signed deals pay a retainer now; their crates arrive when the warehouse opens (not built yet).
 */
export class DealManager {
  offer: Offer | null = null
  signed: SignedDeal[] = []
  private nextAt: number | null = null
  private seq = 0
  private lastVip = -1

  /** The office has just opened: the first VIP comes soon. */
  start(now: number): void {
    this.nextAt = now + CONFIG.deals.firstOfferDelay
  }

  get started(): boolean {
    return this.nextAt !== null || this.offer !== null
  }

  update(now: number, reputation: number, rand: () => number): OfferEvent {
    if (this.offer && now >= this.offer.expiresAt) {
      this.offer = null
      this.scheduleNext(now, rand)
      return 'expired'
    }
    if (this.offer || this.nextAt === null || now < this.nextAt) return null
    // Nobody important comes to a shop with a poor name: wait until the reputation is there.
    if (reputation < CONFIG.deals.minReputation) {
      this.nextAt = now + 10
      return null
    }
    this.offer = this.makeOffer(now, reputation, rand)
    this.nextAt = null
    return 'offered'
  }

  private scheduleNext(now: number, rand: () => number): void {
    const [min, max] = CONFIG.deals.gap
    this.nextAt = now + min + (max - min) * rand()
  }

  private makeOffer(now: number, reputation: number, rand: () => number): Offer {
    const d = CONFIG.deals
    let vip = Math.floor(rand() * d.vips.length)
    if (vip === this.lastVip) vip = (vip + 1) % d.vips.length
    this.lastVip = vip
    const def = d.vips[vip]!
    // A better reputation brings bigger deals (up to the top of the range at reputation 100).
    const reach = Math.max(0, Math.min(1, (reputation - d.minReputation) / (100 - d.minReputation)))
    const [lo, hi] = d.crates
    const crates = Math.round(lo + (hi - lo) * Math.min(1, reach * 0.7 + rand() * 0.3))
    const [rLo, rHi] = d.retainerPerCrate
    const retainer = Math.round((crates * (rLo + (rHi - rLo) * rand())) / 10) * 10
    return { id: ++this.seq, vip, name: def.name, title: def.title, cargo: def.cargo, cargoType: def.type, crates, retainer, readyAt: now + d.arrivalSeconds, expiresAt: now + d.arrivalSeconds + d.expiresAfter, haggled: false }
  }

  /** Sign the offer. Returns the signed deal, or null if nobody is waiting. */
  accept(now: number, rand: () => number): SignedDeal | null {
    const o = this.offer
    if (!o) return null
    const deal: SignedDeal = { id: o.id, name: o.name, title: o.title, cargo: o.cargo, cargoType: o.cargoType, crates: o.crates, retainer: o.retainer, signedAt: now, delivered: 0, inTransit: 0, nextDeliveryAt: now + CONFIG.warehouse.firstDeliveryDelay }
    this.signed.push(deal)
    this.offer = null
    this.scheduleNext(now, rand)
    return deal
  }

  /** Push for more money (once per offer): they raise the retainer, or lose patience and leave. */
  haggle(now: number, rand: () => number): 'raised' | 'walked' | null {
    const o = this.offer
    if (!o || o.haggled) return null
    o.haggled = true
    if (rand() < CONFIG.deals.haggleWalkChance) {
      this.offer = null
      this.scheduleNext(now, rand)
      return 'walked'
    }
    o.retainer = Math.round((o.retainer * (1 + CONFIG.deals.haggleBonus)) / 10) * 10
    return 'raised'
  }

  /** Turn the offer down. */
  decline(now: number, rand: () => number): boolean {
    if (!this.offer) return false
    this.offer = null
    this.scheduleNext(now, rand)
    return true
  }

  get crates(): number {
    return this.signed.reduce((n, d) => n + d.crates, 0)
  }
}
