import { CONFIG } from './config'

/**
 * The lake's harbour, after the meteor: what is built (`owned`, from `LAKE_UPGRADES`), the shipping line's contract (signed with a VIP at
 * the deal desk), and the traffic.
 *
 * - Small boats and motorboats call at the jetty and the marina and pay a mooring fee when they leave.
 * - Building the cargo dock digs the round lake out into a proper dock: a container terminal on its south quay. A container ship calls,
 *   the quay crane(s) unload its import containers (paid per container) into the yard, then load the export containers waiting in the
 *   yard (paid per container too); the ship sails and the next one comes after a gap.
 * - Container lorries (one to `lorry.atOnce` at a time, at random) come through the gate: a collecting lorry takes an import container
 *   from the yard, a delivering lorry brings an export container in. The yard gantry handles one lorry at a time; each pays a handling fee.
 *
 * Pure state on game time. Every visit is a record with its times, so the 3D view draws boats, ships, lorries and cranes from it.
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
  /** Alongside and made fast (the crane starts) at `mooredAt`. */
  mooredAt: number
  /** The crane is done (all unloaded and loaded) by `doneAt`; the ship casts off at `leaveAt` and is gone at `goneAt`. */
  doneAt: number
  leaveAt: number
  goneAt: number
  /** Import containers on board when it arrives, and how many are already lifted off (and paid for). */
  containers: number
  unloaded: number
  /** Export containers it takes from the yard (planned when it arrives), and how many are already on board. */
  exports: number
  loaded: number
  /** How many cranes worked it (the view splits the jobs between them). */
  cranes: number
}

export type LorryJob = 'collect' | 'deliver'

export interface LorryVisit {
  id: number
  job: LorryJob
  /** Which loading bay under the yard gantry (0 … bays − 1). */
  bay: number
  /** Comes through the gate from `spawnAt`, is parked in its bay at `atBayAt`. */
  spawnAt: number
  atBayAt: number
  /** The gantry handles its container from `handleAt` to `handledAt` (one lorry at a time). */
  handleAt: number
  handledAt: number
  /** Pulls out at `leaveAt`, out of the gate and gone at `goneAt`. */
  leaveAt: number
  goneAt: number
  /** The container's colour index (for the view). */
  colour: number
  /** Still to pay (paid when its container has been handled). */
  fee: number
}

export type HarbourEvent =
  | { type: 'boatPaid'; amount: number }
  | { type: 'container'; amount: number }
  | { type: 'exportLoaded'; amount: number }
  | { type: 'lorryPaid'; amount: number; job: LorryJob }
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
  lorries: LorryVisit[] = []
  /** Import containers in the yard (waiting for a lorry). */
  stock = 0
  /** Export containers in the yard (waiting for a ship). */
  exports = 0
  /** Every ship that has called (for its name and the HUD). */
  shipsServed = 0
  private seq = 0
  private nextBoatAt: number | null = null
  private nextShipAt: number | null = null
  private nextLorryAt: number | null = null
  private gantryFreeAt = 0
  private vipAskAt: number | null = null
  private earnedThisShip = 0

  has(id: string): boolean {
    return this.owned.has(id)
  }

  /** The cargo dock has been dug: the round lake is now the rectangular dock basin with the container terminal on its south quay. */
  get basin(): boolean {
    return this.owned.has('lake-dock')
  }

  /** How many quay cranes work a ship (the great harbour adds a second). */
  get cranes(): number {
    return this.owned.has('lake-harbour') ? 2 : 1
  }

  /** Biggest ship that can call now. */
  get shipSize(): number {
    return this.owned.has('lake-harbour') ? 2 : this.owned.has('lake-ships') ? 1 : 0
  }

  /** Import containers already promised to a lorry on its way, and export containers on lorries on their way in. */
  private get importsSpoken(): number {
    return this.lorries.filter((l) => l.job === 'collect' && l.fee > 0).length
  }
  private get exportsComing(): number {
    return this.lorries.filter((l) => l.job === 'deliver' && l.fee > 0).length
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
    if (id === 'lake-dock') {
      this.nextShipAt ??= now + h.firstShipDelay
      this.nextLorryAt ??= now + h.lorry.firstDelay
      // The terminal opens with a few export containers already waiting for the first ship.
      this.exports = Math.max(this.exports, h.startExports)
    }
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

    // The shipping magnate wants a word, once the marina is open.
    if (!this.contract && this.vipAskAt !== null && now >= this.vipAskAt) {
      this.vipAskAt = null
      events.push({ type: 'wantsVip' })
    }

    this.updateBoats(now, rand, events)
    this.updateShip(now, events)
    this.updateLorries(now, rand, events)
    return events
  }

  // ------------------------------------------------------------------ boats

  private updateBoats(now: number, rand: () => number, events: HarbourEvent[]): void {
    const h = CONFIG.harbour
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
  }

  // ------------------------------------------------------------------ the ship

  /**
   * The container ship: sails in and berths, then the crane jobs run one after another (per crane): first every import off into the yard,
   * then the planned exports from the yard on board. It waits a moment and sails; the next comes after a gap.
   */
  private updateShip(now: number, events: HarbourEvent[]): void {
    const h = CONFIG.harbour
    const s = this.ship
    if (s) {
      const jobs = s.containers + s.exports
      if (now >= s.mooredAt && s.unloaded + s.loaded < jobs) {
        const done = Math.min(jobs, Math.floor((now - s.mooredAt) / h.unloadSeconds) * s.cranes)
        while (s.unloaded + s.loaded < done) {
          if (s.unloaded < s.containers) {
            s.unloaded++
            const amount = h.ships[s.size]!.perContainer
            this.earnedThisShip += amount
            this.stock = Math.min(h.yardCapacity, this.stock + 1)
            events.push({ type: 'container', amount })
          } else {
            s.loaded++
            this.exports = Math.max(0, this.exports - 1)
            this.earnedThisShip += h.exportFee
            events.push({ type: 'exportLoaded', amount: h.exportFee })
          }
        }
        if (s.unloaded + s.loaded === jobs) events.push({ type: 'shipDone', ship: s, earned: this.earnedThisShip })
      }
      if (now >= s.goneAt) {
        this.ship = null
        this.nextShipAt = now + h.shipGap
      }
    } else if (this.nextShipAt !== null && now >= this.nextShipAt) {
      const size = this.shipSize
      const def = h.ships[size]!
      const mooredAt = now + h.shipTravel
      const cranes = this.cranes
      // It takes as many exports as are waiting (up to its own size); lorries keep delivering more for the next ship.
      const exports = Math.min(this.exports, def.containers)
      const doneAt = mooredAt + Math.ceil((def.containers + exports) / cranes) * h.unloadSeconds
      const leaveAt = doneAt + h.shipLinger
      this.ship = {
        id: ++this.seq,
        size,
        name: h.shipNames[this.shipsServed % h.shipNames.length]!,
        spawnAt: now,
        mooredAt,
        doneAt,
        leaveAt,
        goneAt: leaveAt + h.shipTravel,
        containers: def.containers,
        unloaded: 0,
        exports,
        loaded: 0,
        cranes,
      }
      this.shipsServed++
      this.earnedThisShip = 0
      this.nextShipAt = null
      events.push({ type: 'shipArrived', ship: this.ship })
    }
  }

  // ------------------------------------------------------------------ lorries

  /** Container lorries: come and go at random (often a few close together), each to a free bay, handled by the gantry in turn. */
  private updateLorries(now: number, rand: () => number, events: HarbourEvent[]): void {
    const L = CONFIG.harbour.lorry
    for (const l of this.lorries) {
      if (l.fee > 0 && now >= l.handledAt) {
        if (l.job === 'collect') this.stock = Math.max(0, this.stock - 1)
        else this.exports = Math.min(CONFIG.harbour.exportCapacity, this.exports + 1)
        events.push({ type: 'lorryPaid', amount: l.fee, job: l.job })
        l.fee = 0
      }
    }
    this.lorries = this.lorries.filter((l) => now < l.goneAt)
    if (this.nextLorryAt === null || now < this.nextLorryAt) return
    // A bay is free once its last lorry has pulled out of it.
    const busy = new Set(this.lorries.filter((l) => now < l.leaveAt + L.pullOut).map((l) => l.bay))
    const free: number[] = []
    for (let b = 0; b < L.bays; b++) if (!busy.has(b)) free.push(b)
    const canCollect = this.stock - this.importsSpoken > 0
    const canDeliver = this.exports + this.exportsComing < CONFIG.harbour.exportCapacity
    const about = this.lorries.filter((l) => now < l.leaveAt).length
    if (free.length > 0 && about < L.atOnce && (canCollect || canDeliver)) {
      const job: LorryJob = canCollect && (!canDeliver || rand() < 0.55) ? 'collect' : 'deliver'
      const bay = free[Math.floor(rand() * free.length)]!
      const atBayAt = now + L.travel
      const handleAt = Math.max(atBayAt + 1, this.gantryFreeAt)
      const handledAt = handleAt + L.handleSeconds
      this.gantryFreeAt = handledAt
      const leaveAt = handledAt + 1.5
      this.lorries.push({ id: ++this.seq, job, bay, spawnAt: now, atBayAt, handleAt, handledAt, leaveAt, goneAt: leaveAt + L.travel, colour: Math.floor(rand() * 10), fee: L.fee })
    }
    // Often another follows close behind (two or three together), otherwise a longer gap.
    const [lo, hi] = this.lorries.filter((l) => now < l.leaveAt).length < L.atOnce && rand() < L.burst ? L.burstGap : L.gap
    this.nextLorryAt = now + lo + (hi - lo) * rand()
  }
}
