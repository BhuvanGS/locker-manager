import * as THREE from 'three'
import type { AutoZone } from '../sim/config'
import type { Parcel } from '../sim/ConveyorSystem'
import type { GameManager } from '../sim/GameManager'
import { ArmRig, HANG, type Dock } from './ArmRig'
import { makeBag } from './bags'
import { CONVEYOR, STATION } from './layout'
import { mat } from './models'

/** How far apart (z) two bags waiting at the same dock sit, one per arm. */
const SPACING = 0.5
/** The belts' pick-up point (a little before their end). */
export const PICKUP_Z = CONVEYOR.endZ + 0.15

export interface StationOptions {
  zone: AutoZone
  row: number
  /** Height of the floor and the z of the locker fronts in this row. */
  floorY: number
  frontZ: number
  /** The rail's x range. */
  minX: number
  maxX: number
  /** `belt`: the storage room's own belts. `tube`: ducts from the ceiling (the halls). */
  dock: 'belt' | 'tube'
  /** Tube stations: x of the pick-up duct and the drop-off duct. */
  tubeX?: readonly [number, number]
  /** World position of the opening of a locker (x, middle of the opening, z of the bag). */
  locate: (lockerId: string) => { x: number; y: number; z: number }
}

/**
 * One row of lockers' robot arms: the gantry rail, one arm (or two, with the second-arm upgrade), and the ducts that feed
 * the halls. It draws the arms and the bags they handle from `game.conveyor`; the belts and everything on them belong to
 * `ConveyorBay`. A storage-room station is part of the bay; a hall's station is built when its belt extension is bought.
 */
export class StationView {
  readonly root = new THREE.Group()
  readonly opts: StationOptions
  private readonly rigs: ArmRig[] = []
  private readonly bags = new Map<number, THREE.Group>()
  private readonly railZ: number
  private readonly railY: number

  constructor(opts: StationOptions) {
    this.opts = opts
    this.root.userData.zone = opts.zone
    this.railZ = opts.frontZ + STATION.railOffset
    this.railY = opts.floorY + STATION.railHeight
    this.addRail(0)
    if (opts.dock === 'tube' && opts.tubeX) this.addTubes(opts.tubeX)
  }

  update(dt: number, game: GameManager): void {
    const want = game.conveyor.armCount(this.opts.zone)
    while (this.rigs.length < want) this.addRig(this.rigs.length)

    // Work out what each arm is doing, and where the bags it handles are.
    const live = new Set<number>()
    const jobs = new Map<number, Parcel>()
    for (const parcel of game.conveyor.parcels) {
      if (parcel.zone !== this.opts.zone || parcel.row !== this.opts.row) continue
      if (parcel.phase === 'arm') jobs.set(parcel.arm, parcel)
      this.placeBag(game, parcel, live)
    }
    this.rigs.forEach((rig, i) => {
      const job = jobs.get(i)
      const target = job ? rig.target(job.kind, game.conveyor.armProgress(job), this.opts.locate(job.lockerId)) : null
      rig.update(dt, target)
    })
    for (const [id, bag] of this.bags) {
      if (live.has(id)) continue
      bag.removeFromParent()
      this.bags.delete(id)
    }
  }

  // ------------------------------------------------------------------ bags

  /** Show `parcel`'s bag if this station is the one drawing it right now. */
  private placeBag(game: GameManager, parcel: Parcel, live: Set<number>): void {
    const tube = this.opts.dock === 'tube'
    let carried = false
    let at: THREE.Vector3 | null = null
    if (parcel.phase === 'waitingForArm' && tube) {
      at = this.dockPoint(this.opts.tubeX?.[0] ?? 0, parcel.arm, 'pick')
    } else if (parcel.phase === 'arm') {
      const progress = game.conveyor.armProgress(parcel)
      if (parcel.kind === 'store') {
        if (parcel.step >= 2) return // it is in the locker now
        if (progress >= 0.18) carried = true
        else at = this.dockPoint(tube ? (this.opts.tubeX?.[0] ?? 0) : CONVEYOR.inX, parcel.arm, 'pick')
      } else {
        if (parcel.step < 2) return // still in its locker
        carried = true
      }
    } else {
      return
    }
    live.add(parcel.id)
    let bag = this.bags.get(parcel.id)
    if (!bag) {
      bag = makeBag(game, parcel)
      this.bags.set(parcel.id, bag)
    }
    if (carried) {
      this.rigs[parcel.arm]?.hold(bag)
    } else if (at) {
      if (bag.parent !== this.root) this.root.add(bag)
      bag.position.copy(at)
      bag.rotation.set(0, 0, 0)
    }
  }

  /** World position of arm `arm`'s pick-up (or drop-off) spot. Bags wait there, base down. */
  private dockPoint(x: number, arm: number, _which: 'pick' | 'drop'): THREE.Vector3 {
    if (this.opts.dock === 'belt') return new THREE.Vector3(x, CONVEYOR.topY + 0.02, PICKUP_Z + arm * SPACING)
    return new THREE.Vector3(x, this.opts.floorY + STATION.cradleY, this.railZ + arm * 0.45)
  }

  // ------------------------------------------------------------------ building

  private addRig(arm: number): void {
    const o = this.opts
    const railZ = this.railZ + arm * STATION.secondRail
    if (arm > 0) this.addRail(arm)
    const belt = o.dock === 'belt'
    const x0 = belt ? CONVEYOR.inX : (o.tubeX?.[0] ?? 0)
    const x1 = belt ? CONVEYOR.outX : (o.tubeX?.[1] ?? 0)
    const wrist = belt ? CONVEYOR.topY + HANG : o.floorY + STATION.cradleY + HANG
    const reachOf = (x: number) => this.dockPoint(x, arm, 'pick').z - railZ
    const pick: Dock = { x: x0, reach: reachOf(x0), wrist }
    const drop: Dock = { x: x1, reach: this.dockPoint(x1, arm, 'drop').z - railZ, wrist: belt ? wrist : wrist + 0.05 }
    const rig = new ArmRig({ railY: this.railY, railZ, pick, drop })
    this.rigs.push(rig)
    this.root.add(rig.root)
  }

  /** The gantry rail for arm `arm`, hung from the ceiling. */
  private addRail(arm: number): void {
    const { floorY, minX, maxX } = this.opts
    const z = this.railZ + arm * STATION.secondRail
    const beam = new THREE.Mesh(new THREE.BoxGeometry(maxX - minX, 0.14, 0.16), mat(0xe5a50a, 0.55, 0.2))
    beam.position.set((minX + maxX) / 2, this.railY + 0.12, z)
    this.root.add(beam)
    const ceiling = floorY + 3.2
    const dark = mat(0x1f2937, 0.5, 0.4)
    const span = maxX - minX
    for (let x = minX + 1.4; x < maxX - 0.5; x += Math.max(3, span / Math.ceil(span / 3))) {
      const hanger = new THREE.Mesh(new THREE.BoxGeometry(0.06, ceiling - this.railY - 0.05, 0.06), dark)
      hanger.position.set(x, (ceiling + this.railY + 0.05) / 2, z)
      this.root.add(hanger)
    }
  }

  /** The two ducts from the ceiling: bags come down the first and leave up the second. */
  private addTubes(xs: readonly [number, number]): void {
    const { floorY } = this.opts
    const steel = mat(0x9ca3af, 0.45, 0.5)
    const dark = mat(0x1f2937, 0.5, 0.4)
    const z = this.railZ + 0.22
    const ceiling = floorY + 3.2
    const mouth = floorY + STATION.cradleY + 0.4 // the bottom of the duct
    for (const [i, x] of xs.entries()) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, ceiling - mouth, 14), steel)
      pipe.position.set(x, (ceiling + mouth) / 2, z)
      this.root.add(pipe)
      const flare = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.24, 0.12, 14), steel)
      flare.position.set(x, mouth - 0.06, z)
      this.root.add(flare)
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 14), mat(i === 0 ? 0x22c55e : 0xf59e0b, 0.5))
      band.position.set(x, mouth + 0.2, z)
      this.root.add(band)
      // The cradle a waiting bag sits on.
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.95), dark)
      plate.position.set(x, floorY + STATION.cradleY - 0.03, z + 0.22)
      this.root.add(plate)
    }
  }
}
