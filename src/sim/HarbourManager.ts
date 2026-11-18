import { CONFIG } from './config'

/**
 * The lake's harbour, after the meteor: what is built (`owned`, from `LAKE_UPGRADES`), the shipping line's contract (signed with a VIP at
 * the deal desk), and the traffic. Small boats and motorboats call at the jetty and the marina and pay a mooring fee when they leave; once
 * the cargo dock is built a container ship calls, the crane unloads it one container at a time (paid per container) and the containers go
 * to the port warehouse's yard, where they are collected over time.
 *
 * Pure state on game time. Every visit is a record with its times, so the 3D view draws boats, ships and the crane from it.
 */
export type BoatKind = 'row' | 'sail' | 'motor'

export interface BoatVisit {
  id: number
  kind: BoatKind
  /** Which berth: jetty slots for row and sail boats, marina slots for motorboats. */
  slot: number
  /** Leaves the sea at `spawnAt`, ties up at `mooredAt`, casts off at `leaveAt`, is gone at `goneAt`. */
  spawnAt: number
  mooredAt: number
  leaveAt: number
  goneAt: number
  fee: number
}

export interface ShipVisit {
  id: number
  /** 0 feeder, 1 bigger (deeper berth), 2 the biggest (the great harbour). */
  size: number
  name: string
  spawnAt: number
  mooredAt: number
  /** The crane is done (all unloaded) by `doneAt`; the ship casts off at `leaveAt` and is gone at `goneAt`. */
  doneAt: number
  leaveAt: number
  goneAt: number
  containers: number
  /** Containers already lifted onto the quay (and paid for). */
  unloaded: number
  /** How many cranes worked it (the view splits the containers between them). */
  cranes: number
}

export type HarbourEvent =
  | { type: 'boatPaid'; amount: number }
  | { type: 'container'; amount: number }
  | { type: 'shipArrived'; ship: ShipVisit }
  | { type: 'shipDone'; ship: ShipVisit; earned: number }
  | { type: 'wantsVip' }

export type LakeUpgradeId = 'lake-road' | 'lake-marina' | 'lake-dock' | 'lake-ships' | 'lake-harbour'

export class HarbourManager {
  readonly owned = new Set<string>()
  /** The shipping line's contract is signed (the VIP at the deal desk). */
  contract = false
  boats: BoatVisit[] = []
  ship: ShipVisit | null = null
  /** Containers in the port warehouse's yard (waiting to be collected). */
  stock = 0
  /** Every ship that has called (for its name and the HUD). */
  shipsServed = 0
  private seq = 0
  private nextBoatAt: number | null = null
  private nextShipAt: number | null = null
  private nextCollectAt = 0
  private vipAskAt: number | null = null
  private earnedThisShip = 0

  has(id: string): boolean {
    return this.owned.has(id)
  }

  /** The great harbour (a rectangular basin with long quays) has replaced the round lake. */
  get basin(): boolean {
    return this.owned.has('lake-harbour')
  }

  /** How many cranes work a ship. */
  get cranes(): number {
    return this.basin ? 2 : 1
  }

  /** Biggest ship that can call now. */
  get shipSize(): number {
    return this.basin ? 2 : this.owned.has('lake-ships') ? 1 : 0
  }

  /** The kinds of boat that come (row and sail boats once the jetty is there, motorboats with the marina). */
  boatKinds(): BoatKind[] {
    const kinds: BoatKind[] = []
    if (this.owned.has('lake-road')) kinds.push('row', 'sail')
    if (this.owned.has('lake-marina')) kinds.push('motor')
    return kinds
  }

  /** Berths for a kind of boat. */
  slots(kind: BoatKind): number {
    const h = CONFIG.harbour
    return kind === 'motor' ? h.marinaSlots : h.jettySlots
  }

  buy(id: string, now: number): void {
    this.owned.add(id)
    const h = CONFIG.harbour
    if (id === 'lake-road') this.nextBoatAt ??= now + h.firstBoatDelay
    if (id === 'lake-marina') this.vipAskAt = now + h.vipDelay
    if (id === 'lake-dock') this.nextShipAt ??= now + h.firstShipDelay
  }

  /** The VIP turned up (an offer is on the desk), or turned away: ask again after a while if the contract is still not signed. */
  vipAsked(now: number): void {
    this.vipAskAt = this.contract ? null : now + CONFIG.harbour.vipRetry
  }

  sign(): void {
    this.contract = true
    this.vipAskAt = null
  }

  update(now: number, rand: () => number): HarbourEvent[] {
    const events: HarbourEvent[] = []
    const h = CONFIG.harbour

    // The shipping magnate wants a word, once the marina is open.
    if (!this.contract && this.vipAskAt !== null && now >= this.vipAskAt) {
      this.vipAskAt = null
      events.push({ type: 'wantsVip' })
    }

    // Small craft: leave once their stay is over (paying the fee), and a new one turns up now and then if a berth is free.
    for (const b of this.boats) {
      if (b.fee > 0 && now >= b.leaveAt) {
        events.push({ type: 'boatPaid', amount: b.fee })
        b.fee = 0
      }
    }
    this.boats = this.boats.filter((b) => now < b.goneAt)
    if (this.nextBoatAt !== null && now >= this.nextBoatAt) {
      const kinds = this.boatKinds()
      const kind = kinds[Math.floor(rand() * kinds.length)]
      if (kind) {
        const taken = new Set(this.boats.filter((b) => (b.kind === 'motor') === (kind === 'motor')).map((b) => b.slot))
        const free: number[] = []
        for (let s = 0; s < this.slots(kind); s++) if (!taken.has(s)) free.push(s)
        if (free.length > 0) {
          const def = h.boats[kind]
          const slot = free[Math.floor(rand() * free.length)]!
          const stay = def.stay[0] + (def.stay[1] - def.stay[0]) * rand()
          const mooredAt = now + h.boatTravel
          const leaveAt = mooredAt + stay
          this.boats.push({ id: ++this.seq, kind, slot, spawnAt: now, mooredAt, leaveAt, goneAt: leaveAt + h.boatTravel, fee: def.fee })
        }
      }
      const [lo, hi] = this.owned.has('lake-marina') ? h.boatGapMarina : h.boatGap
      this.nextBoatAt = now + lo + (hi - lo) * rand()
    }

    // The container ship: sails in, is unloaded container by container, waits a moment, sails out; the next one comes after a gap.
    const s = this.ship
    if (s) {
      if (now >= s.mooredAt && s.unloaded < s.containers) {
        const per = (s.doneAt - s.mooredAt) / Math.ceil(s.containers / s.cranes)
        const lifted = Math.min(s.containers, Math.floor((now - s.mooredAt) / per) * s.cranes)
        while (s.unloaded < lifted) {
          s.unloaded++
          const amount = h.ships[s.size]!.perContainer
          this.earnedThisShip += amount
          this.stock = Math.min(h.yardCapacity, this.stock + 1)
          events.push({ type: 'container', amount })
        }
        if (s.unloaded === s.containers) events.push({ type: 'shipDone', ship: s, earned: this.earnedThisShip })
      }
      if (now >= s.goneAt) {
        this.ship = null
        this.nextShipAt = now + h.shipGap
      }
    } else if (this.nextShipAt !== null && now >= this.nextShipAt) {
      const size = this.shipSize
      const def = h.ships[size]!
      const names = h.shipNames
      const mooredAt = now + h.shipTravel
      const cranes = this.cranes
      const doneAt = mooredAt + Math.ceil(def.containers / cranes) * h.unloadSeconds
      const leaveAt = doneAt + h.shipLinger
      this.ship = {
        id: ++this.seq,
        size,
        name: names[this.shipsServed % names.length]!,
        spawnAt: now,
        mooredAt,
        doneAt,
        leaveAt,
        goneAt: leaveAt + h.shipTravel,
        containers: def.containers,
        unloaded: 0,
        cranes,
      }
      this.shipsServed++
      this.earnedThisShip = 0
      this.nextShipAt = null
      events.push({ type: 'shipArrived', ship: this.ship })
    }

    // Lorries collect from the yard.
    if (this.stock > 0 && now >= this.nextCollectAt) {
      this.stock--
      this.nextCollectAt = now + h.collectSeconds
    } else if (this.stock === 0) this.nextCollectAt = now + h.collectSeconds
    return events
  }
}
