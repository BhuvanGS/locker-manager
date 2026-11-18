import type RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { conduit, floorBundle } from './cables'
import type { PhysicsWorld } from '../engine/PhysicsWorld'
import { CONFIG, type CargoType, type Section } from '../sim/config'
import type { GameManager } from '../sim/GameManager'
import type { RobotJob, Truck } from '../sim/WarehouseManager'
import { markBlocker, tag } from './interactables'
import { FLOOR_HEIGHT, WAREHOUSE } from './layout'
import { makeSign, mat } from './models'
import { prop } from './props'
import { concreteFloor, lightPanel, metreUVs } from './textures'
import { Route, rounded, type Pose } from './paths'
import { LaneGraph, WarehouseRobot, type RobotTarget } from './WarehouseRobot'

const T = 0.2
/** Trucks come in from the main street. */
const START_Z = 16
const RISE_SECONDS = 1.4
const CRATE = { w: 0.8, h: 0.6, d: 0.8 }
/** A dock door opens when you are this close to it. */
const DOOR_REACH = 5
/** How far a parked truck's origin is from its back end (the models face −z; the back is at +z). */
const REAR: Record<Truck['kind'], number> = { kei: 2.1, box: 3.6 }

/** The look of each kind of crate (what it looks like: on a truck before you know, or what it really is once stored). */
const CARGO_COLOUR: Record<CargoType, number> = { general: 0xb08a5a, food: 0x84cc16, cold: 0x38bdf8, metals: 0x94a3b8, illegal: 0x111827 }
const SECTIONS: readonly Section[] = ['shelves', 'cold', 'vault', 'hidden']

type Slot = { pos: THREE.Vector3; approach: { x: number; z: number } }
type TruckView = { id: number; group: THREE.Group; crates: THREE.Mesh[]; shown: number; label: string; tag: THREE.Sprite | null; arrive: Route; leave: Route; park: Pose }
type CrateView = { group: THREE.Group; box: THREE.Mesh; band: THREE.Mesh }
type Rect = { minX: number; maxX: number; minZ: number; maxZ: number }
type Door = { roller: THREE.Mesh; body: RAPIER.RigidBody | null; open: number; z: number }

/**
 * The warehouse: a steel shed built against the south hall (its door opens straight in), pallet racks along a cross aisle, the cold room,
 * vault and hidden room along the south wall (each with its rack), three loading docks in the east wall, the private truck yard and the
 * service road, a receiving desk, the warehouse robots and their painted lanes, and now and then a police car. It draws `game.warehouse`
 * and decides nothing.
 *
 * `root` is the building (hidden when you are far away, like the halls); `yard` is the road, the yard and the vehicles (always drawn).
 */
export class Warehouse {
  readonly root = new THREE.Group()
  readonly yard = new THREE.Group()
  private readonly bodies: RAPIER.RigidBody[] = []
  private readonly physics: PhysicsWorld
  /** Crate slots per section (in the order they fill), and the crate views on them. */
  private readonly slots: Record<Section, Slot[]> = { shelves: [], cold: [], vault: [], hidden: [] }
  private readonly crates: Record<Section, CrateView[]> = { shelves: [], cold: [], vault: [], hidden: [] }
  private readonly doors: Door[] = []
  private readonly trucks = new Map<number, TruckView>()
  private readonly built = new Set<string>()
  private crateSignature = ''
  private police: { group: THREE.Group; lights: THREE.MeshBasicMaterial[] } | null = null
  private policeShown = false
  private readonly board = { canvas: document.createElement('canvas'), texture: null as THREE.CanvasTexture | null, signature: '' }
  private readonly desk = { canvas: document.createElement('canvas'), texture: null as THREE.CanvasTexture | null, signature: '' }
  private rise = 1
  private readonly lanes: LaneGraph
  private readonly robots: WarehouseRobot[] = []

  constructor(physics: PhysicsWorld) {
    this.physics = physics
    this.root.userData.zone = 'warehouse'
    const { minX, maxX, minZ, maxZ, height: H } = WAREHOUSE
    const w = maxX - minX
    const d = maxZ - minZ
    const cx = (minX + maxX) / 2
    const cz = (minZ + maxZ) / 2

    this.buildYard()

    // Inside, the roof shades everything from the sun, so the shed's own surfaces glow a little (no extra lights: see AGENTS.md, zones).
    const steel = lit(0xb9c3cd, 0.6, 0.25)
    this.deco(w, 0.03, d, concreteFloor(0x8f949a, 0.3), cx, 0.016, cz)
    this.deco(w, 0.02, d, lit(0xe5e7eb, 0.9, 0, 0.45), cx, H - 0.02, cz).receiveShadow = false
    const wall = (width: number, depth: number, x: number, z: number, y0 = 0, y1 = H) => {
      if (width < 0.01 || depth < 0.01) return
      this.solid(width, y1 - y0, depth, steel, x, (y0 + y1) / 2, z)
    }
    const south = minZ - T
    const north = maxZ + T
    wall(w + T * 2, T, cx, maxZ + T / 2)
    wall(w + T * 2, T, cx, minZ - T / 2)
    // West: the south hall's east wall closes the shed beside the hall; only the part south of the hall is the shed's own.
    const hallSouth = -21.2
    wall(T, hallSouth - south, minX - T / 2, (south + hallSouth) / 2)
    // Above the hall's ground floor (its roof is at FLOOR_HEIGHT) the shed needs its own wall up to the roof, just inside the hall's.
    wall(T, north - hallSouth, minX + T / 2, (hallSouth + north) / 2, FLOOR_HEIGHT, H)
    // East: the three dock openings, with a lintel over each.
    const { docks } = WAREHOUSE
    const edges = [north, ...docks.z.flatMap((z) => [z + docks.halfWidth, z - docks.halfWidth]), south]
    for (let i = 0; i < edges.length; i += 2) wall(T, edges[i]! - edges[i + 1]!, maxX + T / 2, (edges[i]! + edges[i + 1]!) / 2)
    for (const z of docks.z) wall(T, docks.halfWidth * 2, maxX + T / 2, z, docks.height, H)
    // The roof casts a shadow, so the sun does not shine in through it (the shadow box follows the player in here too).
    this.deco(w + 0.8, 0.12, d + 0.8, mat(0x4b5563, 0.8), cx, H + 0.06, cz).castShadow = true
    // The blue stripe round the top of the outside walls.
    const stripe = mat(0x1d4ed8, 0.7)
    this.deco(w + 0.42, 0.5, 0.01, stripe, cx, H - 0.6, maxZ + T + 0.01)
    this.deco(w + 0.42, 0.5, 0.01, stripe, cx, H - 0.6, minZ - T - 0.01)
    this.deco(0.01, 0.5, d + 0.42, stripe, maxX + T + 0.01, H - 0.6, cz)

    // The dock doors: rollers that go up into the lintel.
    docks.z.forEach((z, i) => {
      const roller = new THREE.Mesh(new THREE.BoxGeometry(0.08, docks.height, docks.halfWidth * 2), mat(0x94a3b8, 0.5, 0.5))
      roller.position.set(maxX - 0.02, docks.height / 2, z)
      this.root.add(roller)
      this.doors.push({ roller, body: this.doorBody(z), open: 0, z })
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, docks.halfWidth * 2 + 0.1, 16), mat(0x64748b, 0.5, 0.5))
      drum.rotation.x = Math.PI / 2
      drum.position.set(maxX - 0.25, docks.height + 0.05, z)
      this.root.add(drum)
      for (const [x, ry] of [
        [maxX + T + 0.03, Math.PI / 2],
        [maxX - 0.05, -Math.PI / 2],
      ] as const) {
        const sign = makeSign(`DOCK ${i + 1}`, 1.1, 0.26, '#0f172a', '#fbbf24')
        sign.position.set(x, docks.height + 0.35, z)
        sign.rotation.y = ry
        this.root.add(sign)
      }
      // A yellow mark on the floor in front of each dock.
      this.deco(1.2, 0.012, docks.halfWidth * 2, mat(0xfacc15, 0.6), maxX - 0.7, 0.035, z)
    })

    // Lights: rows of panels.
    const panel = lightPanel(0xfff8e7, 1.3)
    for (let x = minX + 2.4; x < maxX - 1; x += 3.8) {
      for (let z = minZ + 2.6; z < maxZ - 1; z += 4.4) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.05, 0.5), panel)
        f.position.set(x, H - 0.05, z)
        this.root.add(f)
      }
    }

    // Slots for every rack, bought or not; the racks themselves appear when bought (the first two now).
    const { rack, shelves, lanes } = WAREHOUSE
    for (const r of shelves) this.slots.shelves.push(...this.rowSlots(r.z, r.x0, rack.bays, rack.pitch, rack.levels, lanes.cross))
    for (const r of shelves.slice(0, 2)) this.rackAlongX(r.z, r.x0, rack.bays, rack.pitch, rack.levels, 'shelves')
    for (const section of ['cold', 'vault', 'hidden'] as const) {
      const room = WAREHOUSE[section]
      const levels = section === 'vault' ? rack.levels.slice(0, 2) : rack.levels
      this.slots[section].push(...this.rowSlots(room.minZ + 0.75, roomX0(room), 4, room.pitch, levels, lanes.room))
    }
    const cardboard = mat(0xb08a5a, 0.85)
    const gold = mat(0xfbbf24, 0.5, 0.5)
    for (const section of SECTIONS) {
      for (const slot of this.slots[section]) {
        const group = new THREE.Group()
        const box = new THREE.Mesh(new THREE.BoxGeometry(CRATE.w, CRATE.h, CRATE.d), cardboard)
        box.castShadow = true
        const band = new THREE.Mesh(new THREE.BoxGeometry(CRATE.w + 0.02, 0.08, CRATE.d + 0.02), gold)
        band.position.y = 0.1
        band.visible = false
        group.add(box, band)
        group.position.copy(slot.pos)
        group.visible = false
        this.root.add(group)
        this.crates[section].push({ group, box, band })
      }
    }

    // The robots' lanes (painted once the robots are bought).
    this.lanes = new LaneGraph(laneSegments(), [
      ...SECTIONS.flatMap((s) => this.slots[s].map((slot) => slot.approach)),
      ...docks.z.map((z) => ({ x: lanes.dock + 1.2, z })),
      ...WAREHOUSE.robotHomes.map(([x, z]) => ({ x, z })),
    ])

    // A parts cart along the north wall (clear of the robots' north lane) and an extinguisher by the hall door.
    this.root.add(prop('industrial_storage_cart', { x: 17.6, z: -9.95, height: 0.9, glow: 0.35 }))
    this.bodies.push(this.physics.addStaticBox(new THREE.Vector3(17.6, 0.45, -9.95), new THREE.Vector3(0.6, 0.45, 0.35)))
    this.root.add(prop('korean_fire_extinguisher_01', { x: 6.55, z: -16.9, rotY: Math.PI / 2, height: 0.6, glow: 0.3 }))
    this.root.add(prop('power_box_01', { x: 9.4, y: 1.0, z: maxZ - 0.2, rotY: Math.PI, height: 0.7, glow: 0.3 }))
    this.root.add(conduit([new THREE.Vector3(9.28, 1.66, maxZ - 0.2), new THREE.Vector3(9.28, H - 0.05, maxZ - 0.2)]))

    // Signs, the notice board and the receiving desk.
    const outside = makeSign('WAREHOUSE', 3.4, 0.56, '#0f172a', '#fbbf24')
    outside.position.set(maxX + T + 0.03, H - 1.25, docks.z[1]! + 3.0)
    outside.rotation.y = Math.PI / 2
    this.root.add(outside)
    const canvas = this.board.canvas
    canvas.width = 768
    canvas.height = 384
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    this.board.texture = texture
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.5, 0.05), mat(0x374151, 0.6, 0.3))
    frame.position.set(12.5, 3.4, maxZ - 0.04)
    this.root.add(frame)
    const face = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 1.35), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }))
    face.position.set(12.5, 3.4, maxZ - 0.07)
    face.rotation.y = Math.PI
    this.root.add(face)
    this.buildDesk()
  }

  appear(): void {
    this.rise = 0
    this.root.scale.y = 0.001
  }

  dispose(): void {
    for (const body of this.bodies) this.physics.removeBody(body)
    this.bodies.length = 0
    for (const door of this.doors) if (door.body) this.physics.removeBody(door.body)
    this.board.texture?.dispose()
    this.desk.texture?.dispose()
  }

  update(dt: number, game: GameManager, player: THREE.Vector3): void {
    if (this.rise < 1) {
      this.rise = Math.min(1, this.rise + dt / RISE_SECONDS)
      this.root.scale.y = Math.max(0.001, 1 - (1 - this.rise) ** 3)
    }
    this.syncUpgrades(game)
    this.syncCrates(game)
    this.syncTrucks(game)
    this.syncRobots(dt, game)
    this.syncPolice(game)
    this.syncDoors(dt, game, player)
    this.drawBoard(game)
    this.drawDesk(game)
  }

  // ------------------------------------------------------------------ upgrades: racks, rooms and robots appear when bought

  private syncUpgrades(game: GameManager): void {
    const wh = game.warehouse
    const { rack, shelves } = WAREHOUSE
    for (const [i, id] of [
      [2, 'wh-cap-1'],
      [3, 'wh-cap-2'],
    ] as const) {
      if (!wh.has(id) || this.built.has(id)) continue
      this.built.add(id)
      this.rackAlongX(shelves[i]!.z, shelves[i]!.x0, rack.bays, rack.pitch, rack.levels, 'shelves')
    }
    const rooms: [Section, number, string, string, number][] = [
      ['cold', 0xe0f2fe, 'COLD ROOM', '#38bdf8', 0xbae6fd],
      ['vault', 0x475569, 'VAULT', '#fbbf24', 0x1e293b],
      ['hidden', 0xa8a29e, 'STAFF ONLY', '#e2e8f0', 0x78716c],
    ]
    for (const [section, wallColour, text, textColour, floorColour] of rooms) {
      if (wh.sectionCapacity(section) <= 0 || this.built.has(section)) continue
      this.built.add(section)
      const r = WAREHOUSE[section as 'cold' | 'vault' | 'hidden']
      this.room(r, wallColour, text, textColour, floorColour, section)
      this.rackAlongX(r.minZ + 0.75, roomX0(r), 4, r.pitch, section === 'vault' ? rack.levels.slice(0, 2) : rack.levels, section)
    }
    if (wh.robots.length > 0 && !this.built.has('lanes')) {
      this.built.add('lanes')
      this.paintLanes()
    }
    while (this.robots.length < wh.robots.length) {
      const [x, z] = WAREHOUSE.robotHomes[this.robots.length] ?? WAREHOUSE.robotHomes[0]!
      this.robots.push(new WarehouseRobot(this.root, this.lanes, { x, z }))
    }
  }

  /** The crates in each section: one per stored crate, coloured by what is really in them (grey if spoiled, a gold band on a VIP's). */
  private syncCrates(game: GameManager): void {
    const wh = game.warehouse
    const signature = JSON.stringify(wh.consignments.map((c) => [c.section, c.cargo, c.crates, c.kind, c.spoiled]))
    if (signature === this.crateSignature) return
    this.crateSignature = signature
    for (const section of SECTIONS) {
      const flat = wh.consignments.filter((c) => c.section === section).flatMap((c) => Array.from({ length: c.crates }, () => c))
      this.crates[section].forEach((crate, i) => {
        const c = flat[i]
        crate.group.visible = c !== undefined
        if (!c) return
        crate.band.visible = c.kind === 'vip'
        crate.box.material = mat(c.spoiled ? 0x57534e : CARGO_COLOUR[c.cargo], 0.8)
      })
    }
  }

  // ------------------------------------------------------------------ robots

  private syncRobots(dt: number, game: GameManager): void {
    const wh = game.warehouse
    const targets = (job: RobotJob): { a: RobotTarget; b: RobotTarget } => {
      const dock = this.dockTarget(wh.truck(job.truckId)?.spot ?? 0)
      // The slot it will fill (the next free one) or empty (the last full one).
      const stored = wh.sectionStored(job.section)
      const list = this.slots[job.section]
      const slot = list[Math.max(0, Math.min(list.length - 1, job.dir === 'in' ? stored : stored - 1))]
      const shelf: RobotTarget = slot ? { approach: slot.approach, reach: slot.pos } : dock
      return job.dir === 'in' ? { a: dock, b: shelf } : { a: shelf, b: dock }
    }
    this.robots.forEach((robot, i) => {
      const job = wh.robots[i] ?? null
      const colour = job?.crate ? CARGO_COLOUR[job.crate.cargo] : CARGO_COLOUR.general
      robot.update(dt, job, targets, CONFIG.warehouse.robots.grabAt, colour)
    })
  }

  private dockTarget(spot: number): RobotTarget {
    const z = WAREHOUSE.docks.z[spot] ?? WAREHOUSE.docks.z[0]!
    return { approach: { x: WAREHOUSE.lanes.dock + 1.2, z }, reach: new THREE.Vector3(WAREHOUSE.maxX + 1.1, 1.05, z) }
  }

  private paintLanes(): void {
    const paint = mat(0xfacc15, 0.6)
    for (const [x0, z0, x1, z1] of this.lanes.segments) {
      const len = Math.hypot(x1 - x0, z1 - z0)
      if (len < 0.05) continue
      const along = Math.abs(x1 - x0) > 0.01
      this.deco(along ? len : 0.1, 0.008, along ? 0.1 : len, paint, (x0 + x1) / 2, 0.036, (z0 + z1) / 2)
    }
    for (const [x, z] of WAREHOUSE.robotHomes) {
      this.deco(1.3, 0.01, 1.5, mat(0x1f2937, 0.7), x, 0.035, z)
      this.deco(1.1, 0.012, 1.3, paint, x, 0.037, z)
      this.deco(1.0, 0.014, 1.2, mat(0x1f2937, 0.7), x, 0.039, z)
    }
    // The chargers' own electrical box on the east wall, with a bundle from each pad running to it.
    const box = { x: WAREHOUSE.maxX - 0.22, z: -28.6 }
    this.root.add(prop('power_box_01', { x: box.x, y: 1.0, z: box.z - 0.12, rotY: -Math.PI / 2, height: 0.7, glow: 0.3 }))
    this.root.add(conduit([new THREE.Vector3(box.x, 1.66, box.z), new THREE.Vector3(box.x, WAREHOUSE.height - 0.05, box.z)]))
    this.root.add(floorBundle([[21.2, -29.0], [21.2, -28.7], [23.6, -28.7]], { ...box, top: 1.0 }, 4))
    this.root.add(floorBundle([[23.0, -29.0], [23.0, -28.9], [23.55, -28.9]], { x: box.x, z: box.z - 0.08, top: 1.0 }, 3))
    const sign = makeSign('ROBOT CHARGING', 1.4, 0.22, '#0f172a', '#facc15')
    sign.position.set(22.1, 2.2, WAREHOUSE.minZ + 0.03)
    this.root.add(sign)
  }

  // ------------------------------------------------------------------ vehicles

  /** One view per truck: down the road, into the yard, back into its dock; later out of the dock, down the yard and away. */
  private syncTrucks(game: GameManager): void {
    const wh = game.warehouse
    const w = CONFIG.warehouse
    const live = new Set<number>()
    for (const t of wh.trucks) {
      live.add(t.id)
      let view = this.trucks.get(t.id)
      if (!view) {
        view = this.buildTruck(t)
        this.trucks.set(t.id, view)
        this.yard.add(view.group)
      }
      const pose = t.phase === 'arriving' ? view.arrive.at(Math.min(1, t.t / w.arriveSeconds)) : t.phase === 'leaving' ? view.leave.at(Math.min(1, t.t / w.leaveSeconds)) : view.park
      view.group.position.set(pose.x, 0, pose.z)
      view.group.rotation.y = pose.yaw
      // The crates on board: a kei truck's are visible on its bed; a box truck's are counted on its sign.
      if (t.onBoard !== view.shown) {
        view.shown = t.onBoard
        view.crates.forEach((c, i) => (c.visible = i < t.onBoard))
      }
      const label = this.truckLabel(game, t)
      if (label !== view.label) {
        view.label = label
        if (view.tag) view.group.remove(view.tag)
        view.tag = makeNameSprite(label)
        view.tag.position.set(0, t.kind === 'kei' ? 2.5 : 3.6, 0)
        view.group.add(view.tag)
      }
    }
    for (const [id, view] of this.trucks) {
      if (live.has(id)) continue
      this.yard.remove(view.group)
      this.trucks.delete(id)
    }
  }

  /** The way in and the way out for a truck at dock `spot`. */
  private routes(spot: number, kind: Truck['kind']): { arrive: Route; leave: Route; park: Pose } {
    const { yard, road } = WAREHOUSE
    const dz = WAREHOUSE.docks.z[spot] ?? WAREHOUSE.docks.z[0]!
    const parkX = WAREHOUSE.maxX + T + 0.35 + REAR[kind]
    const ax = yard.aisleX
    const r = yard.turn
    const arrive = new Route([
      rounded(
        [
          [road.laneX, START_Z],
          [road.laneX, yard.inZ],
          [ax, yard.inZ],
          [ax, dz - r],
        ],
        4,
      ),
      // Backing in: from below the dock, swing round into it.
      rounded(
        [
          [ax, dz - r],
          [ax, dz],
          [parkX, dz],
        ],
        r,
        true,
      ),
    ])
    const leave = new Route([
      rounded(
        [
          [parkX, dz],
          [ax, dz],
          [ax, yard.outZ],
          [road.laneX, yard.outZ],
          [road.laneX, road.minZ],
        ],
        4,
      ),
    ])
    return { arrive, leave, park: { x: parkX, z: dz, yaw: -Math.PI / 2 } }
  }

  private truckLabel(game: GameManager, t: Truck): string {
    const name = t.owner.split(' (')[0]
    if (t.job === 'collect') return `${name} · collecting · ${t.onBoard} loaded`
    const load = game.warehouse.loadOf(t)
    const looks = load ? game.warehouse.visibleCargo(load) : t.declared
    return `${name} · ${CONFIG.warehouse.cargo[looks].label.toLowerCase()} · ${t.onBoard} on board`
  }

  /** The dock doors: up for a truck at the dock, or when you are close. */
  private syncDoors(dt: number, game: GameManager, player: THREE.Vector3): void {
    const wh = game.warehouse
    const { docks, maxX } = WAREHOUSE
    this.doors.forEach((door, i) => {
      const truck = wh.trucks.some((t) => t.spot === i && (t.phase === 'parked' || (t.phase === 'arriving' && t.t > CONFIG.warehouse.arriveSeconds * 0.5)))
      const near = Math.hypot(player.x - maxX, player.z - door.z) < DOOR_REACH && player.y < 2.5
      door.open += ((truck || near ? 1 : 0) - door.open) * Math.min(1, dt * 3)
      // It rolls up onto the drum under the lintel.
      const left = 1 - door.open * 0.96
      door.roller.scale.y = left
      door.roller.position.y = docks.height - (docks.height * left) / 2
      // You can walk through once it is mostly up.
      const solid = door.open < 0.6
      if (solid && !door.body) door.body = this.doorBody(door.z)
      else if (!solid && door.body) {
        this.physics.removeBody(door.body)
        door.body = null
      }
    })
  }

  private doorBody(z: number): RAPIER.RigidBody {
    const { docks, maxX } = WAREHOUSE
    return this.physics.addStaticBox(new THREE.Vector3(maxX + T / 2, docks.height / 2, z), new THREE.Vector3(T / 2, docks.height / 2, docks.halfWidth))
  }

  /** A kei truck (small white flatbed) or a box truck (a VIP's, navy with a gold stripe), facing −z, tagged so you can aim at it. */
  private buildTruck(t: Truck): TruckView {
    const group = new THREE.Group()
    const add = (geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(geo, material)
      mesh.position.set(x, y, z)
      mesh.castShadow = true
      group.add(mesh)
      return mesh
    }
    const glass = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.1, metalness: 0.5 })
    const tyre = mat(0x111827, 0.9)
    const wheel = (x: number, z: number, r: number) => {
      const m = add(new THREE.CylinderGeometry(r, r, 0.24, 14), tyre, x, r, z)
      m.rotation.z = Math.PI / 2
    }
    const crates: THREE.Mesh[] = []
    if (t.kind === 'kei') {
      const body = mat(0xe5e7eb, 0.5, 0.2)
      add(new THREE.BoxGeometry(1.4, 0.18, 3.5), mat(0x374151, 0.6), 0, 0.6, 0.35)
      add(new THREE.BoxGeometry(1.4, 1.15, 1.3), body, 0, 1.25, -1.15)
      add(new THREE.BoxGeometry(1.3, 0.5, 0.05), glass, 0, 1.5, -1.8)
      add(new THREE.BoxGeometry(1.42, 0.05, 1.1), mat(0xdc2626, 0.5), 0, 1.5, -1.15)
      for (const x of [-0.7, 0.7]) add(new THREE.BoxGeometry(0.05, 0.3, 2.1), body, x, 0.8, 0.9)
      add(new THREE.BoxGeometry(1.4, 0.3, 0.05), body, 0, 0.8, 1.95)
      for (const x of [-0.7, 0.7]) for (const z of [-1.2, 1.3]) wheel(x, z, 0.3)
      const cardboard = mat(CARGO_COLOUR[t.declared], 0.85)
      for (const [x, z] of [[-0.33, 0.1], [0.33, 0.1], [-0.33, 0.95], [0.33, 0.95], [-0.33, 1.7], [0.33, 1.7]] as const) {
        const crate = add(new THREE.BoxGeometry(0.58, 0.5, 0.7), cardboard, x, 1.0, z)
        crate.visible = false
        crates.push(crate)
      }
    } else {
      const navy = mat(0x1e3a8a, 0.5, 0.3)
      add(new THREE.BoxGeometry(2.0, 0.22, 6.2), mat(0x374151, 0.6), 0, 0.62, 0.5)
      add(new THREE.BoxGeometry(2.0, 1.5, 1.7), mat(0xf1f5f9, 0.5), 0, 1.45, -2.2)
      add(new THREE.BoxGeometry(1.9, 0.6, 0.05), glass, 0, 1.75, -3.07)
      add(new THREE.BoxGeometry(2.2, 2.4, 4.2), navy, 0, 1.95, 1.0)
      add(new THREE.BoxGeometry(2.22, 0.18, 4.22), mat(0xfbbf24, 0.5, 0.4), 0, 2.2, 1.0)
      for (const x of [-1.0, 1.0]) for (const z of [-2.3, 0.9, 2.3]) wheel(x, z, 0.4)
    }
    // What you aim at: the whole truck.
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(t.kind === 'kei' ? 1.8 : 2.6, 2.6, t.kind === 'kei' ? 4.0 : 6.6), new THREE.MeshBasicMaterial({ visible: false }))
    proxy.position.set(0, 1.3, 0.4)
    tag(proxy, { kind: 'truck', truckId: t.id })
    group.add(proxy)
    const { arrive, leave, park } = this.routes(t.spot, t.kind)
    const start = t.phase === 'parked' ? park : arrive.at(0)
    group.position.set(start.x, 0, start.z)
    group.rotation.y = start.yaw
    return { id: t.id, group, crates, shown: -1, label: '', tag: null, arrive, leave, park }
  }

  private syncPolice(game: GameManager): void {
    const visit = game.warehouse.police
    const p = CONFIG.warehouse.police
    if (!visit) {
      if (this.police && this.policeShown) {
        this.yard.remove(this.police.group)
        this.policeShown = false
      }
      return
    }
    if (!this.police) this.police = this.buildPoliceCar()
    if (!this.policeShown) {
      this.yard.add(this.police.group)
      this.policeShown = true
    }
    // It comes down the road's other lane and stops by the yard's way in; afterwards it drives on south.
    const { road, yard } = WAREHOUSE
    const stopZ = yard.inZ - 1
    let z = stopZ
    if (visit.phase === 'arriving') z = START_Z + (stopZ - START_Z) * easeOut(visit.t / p.arriveSeconds)
    else if (visit.phase === 'leaving') z = stopZ + (road.minZ - stopZ) * easeIn(visit.t / p.leaveSeconds)
    this.police.group.position.set(road.upLaneX, 0, z)
    const flash = Math.floor(performance.now() / 180) % 2 === 0
    const on = visit.phase !== 'leaving' || visit.t < 2
    this.police.lights[0]!.color.setHex(on && flash ? 0xef4444 : 0x450a0a)
    this.police.lights[1]!.color.setHex(on && !flash ? 0x3b82f6 : 0x0c1a3d)
  }

  private buildPoliceCar(): { group: THREE.Group; lights: THREE.MeshBasicMaterial[] } {
    const group = new THREE.Group()
    const add = (geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(geo, material)
      mesh.position.set(x, y, z)
      mesh.castShadow = true
      group.add(mesh)
      return mesh
    }
    add(new THREE.BoxGeometry(1.9, 0.6, 4.6), mat(0xf1f5f9, 0.45, 0.3), 0, 0.6, 0)
    add(new THREE.BoxGeometry(1.7, 0.55, 2.4), new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.1, metalness: 0.6 }), 0, 1.15, 0.1)
    add(new THREE.BoxGeometry(1.92, 0.3, 4.62), mat(0x111827, 0.5, 0.3), 0, 0.5, 0)
    const red = new THREE.MeshBasicMaterial({ color: 0xef4444 })
    const blue = new THREE.MeshBasicMaterial({ color: 0x3b82f6 })
    add(new THREE.BoxGeometry(0.5, 0.14, 0.3), red, -0.4, 1.5, 0.1)
    add(new THREE.BoxGeometry(0.5, 0.14, 0.3), blue, 0.4, 1.5, 0.1)
    const tyre = mat(0x111827, 0.9)
    for (const x of [-0.95, 0.95]) {
      for (const z of [-1.4, 1.4]) {
        const wh = add(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 14), tyre, x, 0.34, z)
        wh.rotation.z = Math.PI / 2
      }
    }
    const label = makeNameSprite('POLICE · inspection')
    label.position.set(0, 2.3, 0)
    group.add(label)
    return { group, lights: [red, blue] }
  }

  // ------------------------------------------------------------------ the yard and the road

  private buildYard(): void {
    const { road, yard, maxX, docks } = WAREHOUSE
    const asphalt = mat(0x3a3d43, 0.9)
    const lineYellow = mat(0xf2d16b, 0.6)
    const paint = mat(0xf8fafc, 0.6)
    // The service road, and the main street carried on east to meet it.
    this.decoYard(road.maxX - road.minX, 0.03, road.maxZ - road.minZ, asphalt, (road.minX + road.maxX) / 2, 0.005, (road.minZ + road.maxZ) / 2)
    for (let z = road.maxZ - 1; z > road.minZ; z -= 3.6) this.decoYard(0.15, 0.012, 1.6, lineYellow, (road.minX + road.maxX) / 2, 0.025, z)
    this.decoYard(36, 0.03, 8, asphalt, 48, -0.005, 14.2)
    for (let x = 31; x < 66; x += 4) this.decoYard(2, 0.01, 0.15, lineYellow, x, 0.012, 14.2)
    this.decoYard(36, 0.04, 4, mat(0xbdb8b0, 0.95), 48, 0, 8.2)
    // The truck yard: concrete from the docks to the road, with bay lines, dock bumpers and the drive lane.
    const concrete = concreteFloor(0xb8b4ac)
    this.decoYard(yard.maxX - yard.minX, 0.03, yard.maxZ - yard.minZ, concrete, (yard.minX + yard.maxX) / 2, 0.012, (yard.minZ + yard.maxZ) / 2)
    const edges = docks.z.flatMap((z) => [z - (docks.halfWidth + 1.0), z + docks.halfWidth + 1.0])
    for (const z of edges) this.decoYard(9, 0.012, 0.12, paint, maxX + T + 4.5, 0.03, z)
    for (const z of docks.z) this.decoYard(0.3, 0.05, docks.halfWidth * 2, mat(0x111827, 0.7), maxX + T + 0.15, 0.04, z)
    this.decoYard(0.12, 0.012, yard.maxZ - yard.minZ - 6, mat(0xfacc15, 0.6), yard.aisleX + 2.4, 0.03, (yard.minZ + yard.maxZ) / 2)
    const inSign = makeSign('WAREHOUSE TRUCKS · IN', 2.4, 0.34, '#0f172a', '#fbbf24')
    inSign.position.set(road.minX - 0.4, 2.0, yard.inZ + 3)
    inSign.rotation.y = Math.PI / 2
    this.yard.add(inSign)
    const outSign = makeSign('EXIT', 1.0, 0.3, '#0f172a', '#e2e8f0')
    outSign.position.set(road.minX - 0.4, 2.0, yard.outZ - 3)
    outSign.rotation.y = Math.PI / 2
    this.yard.add(outSign)
    for (const z of [yard.inZ + 3, yard.outZ - 3]) this.decoYard(0.1, 2.0, 0.1, mat(0x6b7280, 0.5, 0.5), road.minX - 0.4, 1.0, z)
  }

  // ------------------------------------------------------------------ the notice board and the receiving desk

  private drawBoard(game: GameManager): void {
    const wh = game.warehouse
    const parked = wh.trucks.filter((t) => t.phase === 'parked').length
    const busy = wh.robots.filter(Boolean).length
    const signature = [wh.stored, wh.capacity, wh.coldCapacity, wh.vaultCapacity, wh.hiddenCapacity, parked, wh.waiting, wh.earned, wh.collected, wh.fines, wh.police?.phase ?? '', busy, wh.robots.length].join('|')
    if (signature === this.board.signature) return
    this.board.signature = signature
    const ctx = this.board.canvas.getContext('2d')
    if (!ctx || !this.board.texture) return
    this.board.texture.needsUpdate = true
    ctx.fillStyle = '#0b1220'
    ctx.fillRect(0, 0, 768, 384)
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.fillStyle = '#fbbf24'
    ctx.font = '800 44px system-ui, sans-serif'
    ctx.fillText('WAREHOUSE', 32, 44)
    const total = wh.capacity + wh.coldCapacity + wh.vaultCapacity + wh.hiddenCapacity
    ctx.fillStyle = wh.stored >= total ? '#ef4444' : '#22c55e'
    ctx.font = '800 60px system-ui, sans-serif'
    ctx.fillText(`${wh.stored} / ${total} crates`, 32, 112)
    ctx.fillStyle = '#e2e8f0'
    ctx.font = '600 30px system-ui, sans-serif'
    ctx.fillText(`Trucks at the docks: ${parked} · waiting on the road: ${wh.waiting}`, 32, 176)
    ctx.fillText(wh.police ? 'POLICE HERE' : wh.robots.length > 0 ? `Robots: ${busy} of ${wh.robots.length} working` : 'You carry the crates (E on a truck)', 32, 220)
    ctx.fillStyle = '#94a3b8'
    ctx.fillText(`Collected: ${wh.collected} crates · $${wh.earned}   Fines: $${wh.fines}`, 32, 272)
    ctx.font = '600 24px system-ui, sans-serif'
    ctx.fillText('Open a crate at the receiving desk. Not everything is what it says.', 32, 340)
  }

  private buildDesk(): void {
    const { x, z } = WAREHOUSE.desk
    const body = mat(0x1f2937, 0.5, 0.4)
    const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.95, 0.36), body)
    pedestal.position.set(x, 0.475, z)
    markBlocker(pedestal)
    this.root.add(pedestal)
    this.physicsBox(x, 0.475, z, 0.25, 0.475, 0.18)
    const canvas = this.desk.canvas
    canvas.width = 512
    canvas.height = 340
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    this.desk.texture = texture
    // The screen faces south (towards the cross aisle).
    const tilt = new THREE.Group()
    tilt.position.set(x, 1.12, z - 0.04)
    tilt.rotation.set(-0.45, Math.PI, 0, 'YXZ')
    tilt.add(new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.46, 0.05), body))
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62 * (340 / 512)), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }))
    face.position.z = 0.027
    tilt.add(face)
    this.root.add(tilt)
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 0.6), new THREE.MeshBasicMaterial({ visible: false }))
    proxy.position.set(x, 0.7, z)
    tag(proxy, { kind: 'receivingDesk' })
    this.root.add(proxy)
    const sign = makeSign('RECEIVING', 0.7, 0.16, '#0f172a', '#fbbf24')
    sign.position.set(x, 1.6, z - 0.1)
    sign.rotation.y = Math.PI
    this.root.add(sign)
  }

  private drawDesk(game: GameManager): void {
    const wh = game.warehouse
    const loads = wh.loads.length
    const signature = [loads, wh.robots.length, wh.scanner].join('|')
    if (signature === this.desk.signature) return
    this.desk.signature = signature
    const ctx = this.desk.canvas.getContext('2d')
    if (!ctx || !this.desk.texture) return
    this.desk.texture.needsUpdate = true
    ctx.fillStyle = '#0b1220'
    ctx.fillRect(0, 0, 512, 340)
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.fillStyle = '#fbbf24'
    ctx.font = '800 38px system-ui, sans-serif'
    ctx.fillText('RECEIVING', 28, 44)
    ctx.fillStyle = loads > 0 ? '#f59e0b' : '#22c55e'
    ctx.font = '800 50px system-ui, sans-serif'
    ctx.fillText(`${loads} load${loads === 1 ? '' : 's'} at the docks`, 28, 116)
    ctx.fillStyle = '#e2e8f0'
    ctx.font = '600 30px system-ui, sans-serif'
    ctx.fillText(wh.scanner ? 'Scanner: contents shown' : 'Open a crate to be sure', 28, 184)
    ctx.fillText(wh.robots.length > 0 ? `${wh.robots.length} robot${wh.robots.length === 1 ? '' : 's'} on duty` : 'Refuse a load you do not want', 28, 230)
    ctx.fillStyle = '#94a3b8'
    ctx.font = '600 26px system-ui, sans-serif'
    ctx.fillText('Press E for the loads', 28, 306)
  }

  // ------------------------------------------------------------------ building blocks

  /** Slots of a rack along x (crates in the middle of each bay), each with the spot on lane `laneZ` in front of it. */
  private rowSlots(z: number, x0: number, bays: number, pitch: number, levels: readonly number[], laneZ: number): Slot[] {
    const out: Slot[] = []
    for (const level of levels) {
      for (let b = 0; b < bays; b++) {
        const x = x0 + pitch * (b + 0.5)
        out.push({ pos: new THREE.Vector3(x, level + 0.03 + CRATE.h / 2, z), approach: { x, z: laneZ } })
      }
    }
    return out
  }

  /**
   * A pallet rack running along x from `x0`: posts, beams, boards, a collider, and an invisible box tagged with its section (aim at the
   * rack to store a crate on it, or to take one for a collection).
   */
  private rackAlongX(z: number, x0: number, bays: number, pitch: number, levels: readonly number[], section: Section): void {
    const post = mat(0x1d4ed8, 0.5, 0.3)
    const beam = mat(0xf59e0b, 0.5, 0.3)
    const board = mat(0x9ca3af, 0.7, 0.2)
    const len = bays * pitch
    const xMid = x0 + len / 2
    const top = levels[levels.length - 1]! + 1.0
    for (let i = 0; i <= bays; i++) for (const dz of [-0.52, 0.52]) this.deco(0.08, top, 0.08, post, x0 + i * pitch, top / 2, z + dz)
    for (const level of levels) {
      this.deco(len, 0.05, 1.12, board, xMid, level, z)
      for (const dz of [-0.52, 0.52]) this.deco(len, 0.1, 0.05, beam, xMid, level - 0.08, z + dz)
    }
    this.physicsBox(xMid, top / 2, z, len / 2, top / 2, 0.58)
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(len + 0.1, top, 1.3), new THREE.MeshBasicMaterial({ visible: false }))
    proxy.position.set(xMid, top / 2, z)
    tag(proxy, { kind: 'section', section })
    this.root.add(proxy)
  }

  /** A walled room along the south wall: walls with a wide door in the north wall, a floor, a ceiling, a sign and a light. */
  private room(rect: Rect, wallColour: number, text: string, textColour: string, floorColour: number, section: Section): void {
    const { minX, maxX, minZ, maxZ } = rect
    const h = 3.4
    const wallMat = lit(wallColour, 0.7, 0.2)
    const cx = (minX + maxX) / 2
    const cz = (minZ + maxZ) / 2
    this.deco(maxX - minX, 0.02, maxZ - minZ, concreteFloor(floorColour, 0.25), cx, 0.045, cz)
    const doorW = 1.8
    const doorH = 2.4
    const lo = cx - doorW / 2
    const hi = cx + doorW / 2
    const z = maxZ + T / 2
    this.solid(lo - (minX - T), h, T, wallMat, (minX - T + lo) / 2, h / 2, z)
    this.solid(maxX + T - hi, h, T, wallMat, (hi + maxX + T) / 2, h / 2, z)
    this.solid(doorW, h - doorH, T, wallMat, cx, doorH + (h - doorH) / 2, z)
    // Side walls (the shed's own west wall is the hidden room's west side).
    if (minX > WAREHOUSE.minX + 0.3) this.solid(T, h, maxZ - minZ, wallMat, minX - T / 2, h / 2, cz)
    this.solid(T, h, maxZ - minZ, wallMat, maxX + T / 2, h / 2, cz)
    this.deco(maxX - minX + T * 2, 0.1, maxZ - minZ + T, wallMat, cx, h + 0.05, cz).castShadow = true // ceiling
    const light = section === 'cold' ? lightPanel(0x7dd3fc, 1.5) : lightPanel(0xfff8e7, 1.1)
    const fixture = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.05, 0.4), light)
    fixture.position.set(cx, h - 0.04, cz)
    this.root.add(fixture)
    const sign = makeSign(text, 1.4, 0.24, '#0f172a', textColour)
    sign.position.set(cx, doorH + 0.35, maxZ + T + 0.03)
    this.root.add(sign)
  }

  private solid(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number): void {
    if (w < 0.01 || d < 0.01) return
    const mesh = new THREE.Mesh(metreUVs(new THREE.BoxGeometry(w, h, d)), material)
    mesh.position.set(x, y, z)
    mesh.receiveShadow = true
    mesh.castShadow = true
    markBlocker(mesh)
    this.root.add(mesh)
    this.physicsBox(x, y, z, w / 2, h / 2, d / 2)
  }

  private physicsBox(x: number, y: number, z: number, hx: number, hy: number, hz: number): void {
    this.bodies.push(this.physics.addStaticBox(new THREE.Vector3(x, y, z), new THREE.Vector3(hx, hy, hz)))
  }

  private deco(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const mesh = new THREE.Mesh(metreUVs(new THREE.BoxGeometry(w, h, d)), material)
    mesh.position.set(x, y, z)
    mesh.receiveShadow = true
    this.root.add(mesh)
    return mesh
  }

  private decoYard(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number): void {
    const mesh = new THREE.Mesh(metreUVs(new THREE.BoxGeometry(w, h, d)), material)
    mesh.position.set(x, y, z)
    mesh.receiveShadow = true
    this.yard.add(mesh)
  }
}

/** Where a room's rack starts (centred in the room). */
function roomX0(room: { minX: number; maxX: number; pitch: number }): number {
  return (room.minX + room.maxX) / 2 - room.pitch * 2
}

/** The robot lanes: the cross aisle, the south aisle, the dock lane, a west link, a spur into each room and its lane, the docks and the charging spots. */
function laneSegments(): [number, number, number, number][] {
  const { lanes, docks, robotHomes } = WAREHOUSE
  const segs: [number, number, number, number][] = [
    [lanes.west, lanes.cross, lanes.dock, lanes.cross],
    [lanes.west, lanes.south, lanes.dock, lanes.south],
    [lanes.dock, lanes.north, lanes.dock, robotHomes[0]![1]],
    [lanes.west, lanes.cross, lanes.west, lanes.south],
    [robotHomes[0]![0], robotHomes[0]![1], robotHomes[robotHomes.length - 1]![0], robotHomes[0]![1]],
  ]
  for (const section of ['hidden', 'cold', 'vault'] as const) {
    const r = WAREHOUSE[section]
    const cx = (r.minX + r.maxX) / 2
    segs.push([cx, lanes.south, cx, lanes.room], [r.minX + 0.5, lanes.room, r.maxX - 0.5, lanes.room])
  }
  for (const z of docks.z) segs.push([lanes.dock, z, lanes.dock + 1.2, z])
  return segs
}

/** A material that glows faintly in its own colour, for surfaces under the roof (a fresh one: `mat()` materials are shared). */
function lit(color: number, roughness: number, metalness = 0, glow = 0.3): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive: color, emissiveIntensity: glow })
}

const easeOut = (x: number): number => 1 - (1 - Math.min(1, Math.max(0, x))) ** 2
const easeIn = (x: number): number => Math.min(1, Math.max(0, x)) ** 2

const nameTextures = new Map<string, THREE.CanvasTexture>()

/** A label on a dark pill that always faces the camera. */
function makeNameSprite(text: string): THREE.Sprite {
  let texture = nameTextures.get(text)
  if (!texture) {
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 80
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.8)'
      ctx.beginPath()
      ctx.roundRect(4, 6, 632, 68, 26)
      ctx.fill()
      ctx.fillStyle = '#fbbf24'
      ctx.font = '700 34px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, 320, 42, 600)
    }
    texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    nameTextures.set(text, texture)
  }
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }))
  sprite.scale.set(3.2, 0.4, 1)
  return sprite
}
