import type RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { cable, cableTray } from './cables'
import type { PhysicsWorld } from '../engine/PhysicsWorld'
import { CONFIG, ZONE_TITLES, type AutoZone } from '../sim/config'
import type { Parcel } from '../sim/ConveyorSystem'
import type { GameManager } from '../sim/GameManager'
import { ArmRig, HANG, type Dock } from './ArmRig'
import { makeBag } from './bags'
import { beltTexture, TEXTURE_TILE } from './belts'
import { BAY, CONVEYOR, STATION } from './layout'
import { makeSign, mat } from './models'
import { armYellow } from './textures'

/** How far apart (z) two bags waiting at the same dock sit, one per arm. */
const SPACING = 0.5
/** The belts' pick-up point (a little before their end). */
export const PICKUP_Z = CONVEYOR.endZ + 0.15

export interface StationRow {
  row: number
  /** The z of the locker fronts in this row. */
  frontZ: number
}

export interface StationOptions {
  zone: AutoZone
  /** Height of the floor this zone is on. */
  floorY: number
  /** The rows of lockers the arms serve. */
  rows: StationRow[]
  /** The x range of the rails along the rows. */
  minX: number
  maxX: number
  /**
   * `belt`: the storage room's own belts. `tube`: two ducts in the gap between the annex's banks. `bay`: the shared bay at the back
   * of the tall halls, with its own belts and ducts and an overhead runway to every row.
   */
  dock: 'belt' | 'tube' | 'bay'
  /** Tube stations: x of the pick-up duct and the drop-off duct. */
  tubeX?: readonly [number, number]
  /** World position of the opening of a locker (x, middle of the opening, z of the bag). */
  locate: (lockerId: string) => { x: number; y: number; z: number }
  /** Needed by the bay, whose belts you cannot walk through. */
  physics?: PhysicsWorld
}

type BagView = { group: THREE.Group; pos: THREE.Vector3; placed: boolean }

/**
 * The robot arms of one part of the building: their overhead rails, the arms themselves (one, or two with the second-arm upgrade),
 * and where bags enter and leave. The storage room's station is part of `ConveyorBay` (its belts feed it); the East annex is fed by two
 * ducts; the tall halls share a **bay** at the back where ducts drop bags on belts, and each arm rides a runway from there to the rail
 * of any row. It draws the arms and the bags they handle from `game.conveyor`; it makes no decisions of its own.
 */
export class StationView {
  readonly root = new THREE.Group()
  readonly opts: StationOptions
  private readonly rigs: ArmRig[] = []
  private readonly bags = new Map<number, BagView>()
  private readonly bodies: RAPIER.RigidBody[] = []
  private readonly belts: { texture: THREE.CanvasTexture; direction: number }[] = []
  private readonly physics: PhysicsWorld | undefined
  private readonly fronts = new Map<number, number>()

  constructor(opts: StationOptions) {
    this.opts = opts
    this.physics = opts.physics
    this.root.userData.zone = opts.zone
    for (const r of opts.rows) this.fronts.set(r.row, r.frontZ)
    if (opts.dock === 'tube' && opts.tubeX) this.addTubes(opts.tubeX)
    if (opts.dock === 'bay') this.buildBay()
  }

  dispose(): void {
    for (const body of this.bodies) this.physics?.removeBody(body)
    this.bodies.length = 0
    for (const { texture } of this.belts) texture.dispose()
  }

  update(dt: number, game: GameManager): void {
    const want = game.conveyor.armCount(this.opts.zone)
    while (this.rigs.length < want) this.addRig(this.rigs.length)

    const speed = (BAY.maxX - BAY.minX) / CONFIG.automation.beltSeconds
    for (const { texture, direction } of this.belts) texture.offset.x += (direction * speed * dt) / TEXTURE_TILE

    // What each arm is doing, and where the bags it handles are.
    const mine = game.conveyor.parcels.filter((p) => p.zone === this.opts.zone)
    const waiting = mine.filter((p) => p.phase === 'waitingForArm')
    const live = new Set<number>()
    const jobs = new Map<number, Parcel>()
    const smooth = 1 - Math.exp(-9 * dt)
    for (const parcel of mine) {
      if (parcel.phase === 'arm') jobs.set(parcel.arm, parcel)
      this.placeBag(game, parcel, waiting.indexOf(parcel), waiting.length, smooth, live)
    }
    this.rigs.forEach((rig, i) => {
      const job = jobs.get(i)
      const target = job ? rig.target(job.kind, game.conveyor.armProgress(job), this.opts.locate(job.lockerId), job.row) : null
      rig.update(dt, target, game.conveyor.armHealth(this.opts.zone, i).jammed)
    })
    for (const [id, bag] of this.bags) {
      if (live.has(id)) continue
      bag.group.removeFromParent()
      this.bags.delete(id)
    }
  }

  // ------------------------------------------------------------------ bags

  /** Show `parcel`'s bag if this station is the one drawing it right now. */
  private placeBag(game: GameManager, parcel: Parcel, rank: number, queued: number, smooth: number, live: Set<number>): void {
    const { dock, floorY } = this.opts
    const slide = BAY.slideSeconds
    const transit = CONFIG.automation.transit[parcel.zone]
    let carried = false
    let at: THREE.Vector3 | null = null
    const beltY = floorY + CONVEYOR.topY + 0.02
    const bayX = (r: number) => (r < 2 ? BAY.spotX[r]! : BAY.spotX[0] - (r - 1) * BAY.queueStep)

    if (parcel.phase === 'waitingForArm' && dock !== 'belt') {
      at = dock === 'bay' ? new THREE.Vector3(bayX(rank), beltY, BAY.inZ) : this.cradle(Math.min(rank, 1))
    } else if (parcel.phase === 'transitIn' && dock === 'bay' && transit - parcel.t <= slide) {
      // The last stretch: it comes out of the duct and rides the belt to the end.
      const s = 1 - (transit - parcel.t) / slide
      at = new THREE.Vector3(BAY.ductX + (bayX(queued) - BAY.ductX) * s, beltY, BAY.inZ)
    } else if (parcel.phase === 'transitOut' && dock === 'bay' && parcel.t < slide) {
      // The first stretch: dropped on the return belt, it rides to the duct and goes up.
      const s = parcel.t / slide
      const x0 = BAY.spotX[parcel.arm] ?? BAY.spotX[0]
      at = new THREE.Vector3(x0 + (BAY.ductX - x0) * s, beltY, BAY.outZ)
    } else if (parcel.phase === 'arm') {
      const progress = game.conveyor.armProgress(parcel)
      if (parcel.kind === 'store') {
        if (parcel.step >= 2) return // it is in the locker now
        if (progress >= 0.18) carried = true
        else at = this.pickSpot(parcel.arm, beltY)
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
      bag = { group: makeBag(game, parcel), pos: new THREE.Vector3(), placed: false }
      this.bags.set(parcel.id, bag)
    }
    if (carried) {
      this.rigs[parcel.arm]?.hold(bag.group)
      bag.placed = false // when it is let go it appears where the gripper left it
    } else if (at) {
      if (bag.group.parent !== this.root) this.root.add(bag.group)
      if (bag.placed) bag.pos.lerp(at, smooth)
      else bag.pos.copy(at)
      bag.placed = true
      bag.group.position.copy(bag.pos)
      bag.group.rotation.set(0, 0, 0)
    }
  }

  /** Where arm `arm` picks up in this station (the bag waits here until it grabs it). */
  private pickSpot(arm: number, beltY: number): THREE.Vector3 {
    const { dock, floorY } = this.opts
    if (dock === 'bay') return new THREE.Vector3(BAY.spotX[arm] ?? BAY.spotX[0], beltY, BAY.inZ)
    if (dock === 'belt') return new THREE.Vector3(CONVEYOR.inX, CONVEYOR.topY + 0.02, PICKUP_Z + arm * SPACING)
    return this.cradle(arm, floorY)
  }

  /** The annex's cradle under its pick-up duct: bags wait on it, one per arm. */
  private cradle(slot: number, floorY = this.opts.floorY): THREE.Vector3 {
    return new THREE.Vector3(this.opts.tubeX?.[0] ?? 0, floorY + STATION.cradleY, this.railZ(0, this.firstRow()) + slot * 0.45)
  }

  // ------------------------------------------------------------------ arms and rails

  private firstRow(): number {
    return this.opts.rows[0]?.row ?? 0
  }

  /** The carriage z on the rail serving `row` for arm `arm` (a second arm rides a parallel rail further out). */
  private railZ(arm: number, row: number): number {
    return (this.fronts.get(row) ?? this.opts.rows[0]?.frontZ ?? 0) + STATION.railOffset + arm * STATION.secondRail
  }

  private railY(arm: number): number {
    return this.opts.floorY + STATION.railHeight - arm * 0.14
  }

  private addRig(arm: number): void {
    const { dock, floorY } = this.opts
    const row0 = this.firstRow()
    const z0 = this.railZ(arm, row0)
    let spec: { runX: number | null; pick: Dock; drop: Dock }
    if (dock === 'bay') {
      const wrist = floorY + CONVEYOR.topY + HANG
      const x = BAY.spotX[arm] ?? BAY.spotX[0]
      spec = {
        runX: BAY.laneX[arm] ?? BAY.laneX[0],
        pick: { x, z: BAY.carZ, reach: BAY.inZ - BAY.carZ, wrist },
        drop: { x, z: BAY.carZ, reach: BAY.outZ - BAY.carZ, wrist },
      }
    } else if (dock === 'belt') {
      const wrist = CONVEYOR.topY + HANG
      const reach = PICKUP_Z + arm * SPACING - z0
      spec = {
        runX: null,
        pick: { x: CONVEYOR.inX, z: z0, reach, wrist },
        drop: { x: CONVEYOR.outX, z: z0, reach, wrist },
      }
    } else {
      const wrist = floorY + STATION.cradleY + HANG
      const reach = this.cradle(arm).z - z0
      const [x0, x1] = this.opts.tubeX ?? [0, 0]
      spec = {
        runX: null,
        pick: { x: x0, z: z0, reach, wrist },
        drop: { x: x1, z: z0, reach, wrist: wrist + 0.05 },
      }
    }
    const rig = new ArmRig({ railY: this.railY(arm), rowZ: (row) => this.railZ(arm, row), ...spec })
    this.rigs.push(rig)
    this.root.add(rig.root)
    this.addRails(arm, spec.runX)
  }

  /** The overhead rails of arm `arm`: one along every row, and in the halls the runway to the bay. */
  private addRails(arm: number, runX: number | null): void {
    const { floorY, minX, maxX, rows } = this.opts
    const y = this.railY(arm) + 0.12
    const ceiling = floorY + 3.2
    const yellow = armYellow()
    const dark = mat(0x1f2937, 0.5, 0.4)
    const hang = (x: number, z: number) => {
      const hanger = new THREE.Mesh(new THREE.BoxGeometry(0.06, ceiling - y - 0.05, 0.06), dark)
      hanger.position.set(x, (ceiling + y + 0.05) / 2, z)
      this.root.add(hanger)
    }
    const end = runX === null ? maxX : runX + 0.15
    const span = end - minX
    for (const r of rows) {
      const z = this.railZ(arm, r.row)
      const beam = new THREE.Mesh(new THREE.BoxGeometry(span, 0.14, 0.16), yellow)
      beam.position.set((minX + end) / 2, y, z)
      this.root.add(beam)
      // Its power (first arm's first rail only, so a station has one): a cable looping along the rail, and up into the ceiling.
      if (arm === 0 && r === rows[0]) {
        // A cable tray along the side of the beam, above the carriage, its cables rising into the ceiling at the end.
        this.root.add(cableTray(minX + 0.05, end - 0.05, y - 0.03, z + 0.15, y - 0.03))
        this.root.add(cable([new THREE.Vector3(minX + 0.1, y - 0.01, z + 0.15), new THREE.Vector3(minX - 0.02, y + 0.2, z + 0.15), new THREE.Vector3(minX - 0.05, ceiling - 0.02, z + 0.15)], 0.02))
      }
      for (let x = minX + 1.4; x < end - 0.4; x += Math.max(3, span / Math.ceil(span / 3))) hang(x, z)
    }
    if (runX !== null) {
      const zs = rows.map((r) => this.railZ(arm, r.row))
      const north = Math.max(...zs)
      const len = north - BAY.carZ + 0.15
      const runway = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, len), yellow)
      runway.position.set(runX, y, BAY.carZ + len / 2 - 0.075)
      this.root.add(runway)
      for (let z = BAY.carZ + 1; z < north - 0.5; z += 3) hang(runX, z)
    }
  }

  // ------------------------------------------------------------------ building

  /** The annex's two ducts from the ceiling, in the gap between its banks: bags come down the first and leave up the second. */
  private addTubes(xs: readonly [number, number]): void {
    const { floorY } = this.opts
    const dark = mat(0x1f2937, 0.5, 0.4)
    const z = this.railZ(0, this.firstRow()) + 0.22
    const ceiling = floorY + 3.2
    const mouth = floorY + STATION.cradleY + 0.4
    for (const [i, x] of xs.entries()) {
      this.duct(x, z, ceiling, mouth, i === 0 ? 0x22c55e : 0xf59e0b)
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.95), dark)
      plate.position.set(x, floorY + STATION.cradleY - 0.03, z + 0.22)
      this.root.add(plate)
    }
  }

  /**
   * A vertical duct from the ceiling down to `mouth`, blocky like the rest of the world: a square galvanised duct in sections with
   * flanges between them, a square hopper at the end, and a coloured band (green in, amber out).
   */
  private duct(x: number, z: number, ceiling: number, mouth: number, band: number): void {
    const steel = mat(0xaab3bd, 0.45, 0.35)
    const flange = mat(0x8a939e, 0.5, 0.35)
    const len = ceiling - mouth
    const pipe = new THREE.Mesh(new THREE.BoxGeometry(0.3, len, 0.3), steel)
    pipe.position.set(x, (ceiling + mouth) / 2, z)
    pipe.castShadow = true
    this.root.add(pipe)
    for (let y = mouth + 0.3; y < ceiling - 0.1; y += 0.6) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.05, 0.36), flange)
      f.position.set(x, y, z)
      this.root.add(f)
    }
    const hopper = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.34, 0.16, 4, 1), steel)
    hopper.rotation.y = Math.PI / 4
    hopper.position.set(x, mouth - 0.08, z)
    this.root.add(hopper)
    const ring = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.1, 0.33), mat(band, 0.5))
    ring.position.set(x, mouth + 0.2, z)
    this.root.add(ring)
  }

  /** The bay: two belts along the back wall, a duct down onto each, a sign, and a collider. */
  private buildBay(): void {
    const { floorY, zone } = this.opts
    const len = BAY.maxX - BAY.minX
    const midX = (BAY.minX + BAY.maxX) / 2
    const top = floorY + CONVEYOR.topY
    const frame = mat(0x4b5563, 0.55, 0.3)
    const legs = mat(0x1f2937, 0.6, 0.3)
    const lip = mat(0xe5a50a, 0.55, 0.2)
    for (const [z, direction, ductColor] of [
      [BAY.inZ, -1, 0x22c55e],
      [BAY.outZ, 1, 0xf59e0b],
    ] as const) {
      const base = new THREE.Mesh(new THREE.BoxGeometry(len, 0.14, CONVEYOR.width + 0.1), frame)
      base.position.set(midX, top - 0.08, z)
      this.root.add(base)
      for (const side of [-1, 1]) {
        // 1 cm proud of the frame's side, so the two faces never share a plane (they flickered).
        const edge = new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, 0.05), lip)
        edge.position.set(midX, top + 0.01, z + side * (CONVEYOR.width / 2 + 0.035))
        this.root.add(edge)
      }
      for (let x = BAY.minX + 0.4; x < BAY.maxX; x += 1.4) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, CONVEYOR.topY - 0.15, 0.06), legs)
        leg.position.set(x, floorY + (CONVEYOR.topY - 0.15) / 2, z)
        this.root.add(leg)
      }
      const texture = beltTexture(true)
      texture.repeat.set(len / TEXTURE_TILE, 1)
      const surface = new THREE.Mesh(new THREE.PlaneGeometry(len, CONVEYOR.width), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9 }))
      surface.rotation.x = -Math.PI / 2
      surface.position.set(midX, top + 0.003, z)
      surface.receiveShadow = true
      this.root.add(surface)
      this.belts.push({ texture, direction })
      this.duct(BAY.ductX, z, floorY + 3.2, floorY + BAY.mouthY, ductColor)
    }
    // You cannot walk through the belts (but there is nothing to reach behind them).
    if (this.physics) {
      const depth = BAY.inZ - BAY.outZ + CONVEYOR.width + 0.1
      const cz = (BAY.inZ + BAY.outZ) / 2
      this.bodies.push(this.physics.addStaticBox(new THREE.Vector3(midX, floorY + CONVEYOR.topY / 2, cz), new THREE.Vector3(len / 2, CONVEYOR.topY / 2, depth / 2)))
    }
    const sign = makeSign(`BAY · ${ZONE_TITLES[zone].toUpperCase()}`, 2.2, 0.3, '#0f172a', '#fbbf24')
    sign.position.set(0.4, floorY + 1.9, BAY.outZ - 0.4)
    this.root.add(sign)
  }
}
