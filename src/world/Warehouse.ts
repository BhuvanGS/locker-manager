import type RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { kenney } from './kenney'
import { BOX_COLOURS, KEI_COLOURS, makeDeliveryTruck, makeKeiTruck, setBraking, type VehicleModel } from './vehicles'
import { conduit, floorBundle } from './cables'
import type { PhysicsWorld } from '../engine/PhysicsWorld'
import { CONFIG, type CargoType, type Section } from '../sim/config'
import type { GameManager } from '../sim/GameManager'
import type { RobotJob, Truck } from '../sim/WarehouseManager'
import { markBlocker, tag } from './interactables'
import { CONTACT_SPOT, FLOOR_HEIGHT, UNDERGROUND, WAREHOUSE } from './layout'
import { animatePerson, makePerson, makeSign, mat, type PersonRig } from './models'
import { prop } from './props'
import { aroundHole } from './Facility'
import { cardboardMat, carpetFloor, concreteFloor, diamondPlate, lightPanel, metreUVs, paintedSteel, roadAsphalt, shedCladding, shedRoof, wireMesh, woodMat, yardAsphalt } from './textures'
import { Route, rounded, type Leg, type Pose } from './paths'
import { driftArrival, TyreFx } from './drift'
import { LaneGraph, WarehouseRobot, type RobotTarget } from './WarehouseRobot'

const T = 0.2
/** How far the roof's ridge rises above the eaves (the ridge runs north to south down the middle of the shed). */
const ROOF_RISE = 2.0
/** The height of the underside of the pitched roof at x (inside the shed). */
function roofUnderside(x: number): number {
  const half = (WAREHOUSE.maxX - WAREHOUSE.minX) / 2
  const cx = WAREHOUSE.minX + half
  return WAREHOUSE.height + ROOF_RISE * (1 - Math.abs(x - cx) / half)
}
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
type TruckView = {
  id: number
  group: THREE.Group
  crates: THREE.Mesh[]
  shown: number
  label: string
  tag: THREE.Sprite | null
  arrive: Route
  leave: Route
  park: Pose
  /** A kei truck's drive down the yard before it drifts in. */
  approach: Leg | null
  model: VehicleModel
  /** Last frame's position and heading (wheel spin, body roll, drift effects). */
  last: THREE.Vector3
  lastYaw: number
  roll: number
  smokeAt: number
}
type CrateView = { group: THREE.Group; box: THREE.Mesh; band: THREE.Mesh }
type Rect = { minX: number; maxX: number; minZ: number; maxZ: number }
type Door = { roller: THREE.Mesh; body: RAPIER.RigidBody | null; open: number; z: number }
/** The contact's walk in from the south hall's door to where he waits. */
const CONTACT_WALK: readonly (readonly [number, number])[] = [
  [5.0, WAREHOUSE.door.z],
  [6.9, WAREHOUSE.door.z],
  [CONTACT_SPOT.x, CONTACT_SPOT.z],
]

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
  /** The floor over the vault's shaft until the vault is built; then the sliding hatch door (and its collider while shut). */
  private floorCap: THREE.Mesh | null = null
  private grabBars: THREE.Group | null = null
  /** Halls built so far (warehouse levels 3 and 4), the doorway plugs between them, and the painted lanes (redrawn as halls are added). */
  private hallsBuilt = 0
  private readonly southStripes: THREE.Mesh[] = []
  private readonly hallPlugs: { mesh: THREE.Mesh; body: RAPIER.RigidBody }[] = []
  private lanePaint: THREE.Group | null = null
  private hatchDoor: { mesh: THREE.Group; body: RAPIER.RigidBody | null; open: number } | null = null
  /** The contact: a person by the door (shown while he is here), his name over his head, and an invisible target to aim at. */
  private contactView: { group: THREE.Group; rig: PersonRig; label: THREE.Mesh | null; name: string } | null = null
  private readonly trucks = new Map<number, TruckView>()
  /** Tyre smoke and skid marks (kei trucks drifting in). */
  private readonly tyres = new TyreFx()
  private readonly built = new Set<string>()
  /** Fans and ventilators that turn all the time. */
  private readonly spinners: { obj: THREE.Object3D; axis: 'y' | 'z'; speed: number }[] = []
  private fanHead: THREE.Object3D | null = null
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
    this.yard.add(this.tyres.root)
    this.root.userData.zone = 'warehouse'
    const { minX, maxX, minZ, maxZ, height: H } = WAREHOUSE
    const w = maxX - minX
    const d = maxZ - minZ
    const cx = (minX + maxX) / 2
    const cz = (minZ + maxZ) / 2

    this.buildYard()

    // Inside, the roof shades everything from the sun, so the shed's own surfaces glow a little (no extra lights: see AGENTS.md, zones).
    // Ribbed steel cladding for the shed's walls and roof (the rooms inside use plainer panels).
    const steel = shedCladding(0x86a7b8, 0.3)
    const roofMat = shedRoof(0x9c3a33, 0.25)
    const floor = concreteFloor(0x8f949a, 0.3)
    for (const r of aroundHole(minX, maxX, minZ, maxZ, UNDERGROUND.hatch)) this.deco(r.maxX - r.minX, 0.03, r.maxZ - r.minZ, floor, (r.minX + r.maxX) / 2, 0.016, (r.minZ + r.maxZ) / 2)
    const hatch = UNDERGROUND.hatch
    this.floorCap = this.deco(hatch.maxX - hatch.minX, 0.03, hatch.maxZ - hatch.minZ, floor, (hatch.minX + hatch.maxX) / 2, 0.016, (hatch.minZ + hatch.maxZ) / 2)
    const wall = (width: number, depth: number, x: number, z: number, y0 = 0, y1 = H) => {
      if (width < 0.01 || depth < 0.01) return
      this.solid(width, y1 - y0, depth, steel, x, (y0 + y1) / 2, z)
    }
    const south = minZ - T
    const north = maxZ + T
    wall(w + T * 2, T, cx, maxZ + T / 2)
    // The south wall, with a panel where the doorway into warehouse level 3 is cut.
    this.southWall(minZ - T / 2, steel, 0)
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
    this.buildRoof(roofMat, steel, minZ, maxZ, true)
    // The blue stripe round the top of the outside walls.
    const stripe = mat(0x1d4ed8, 0.7)
    this.deco(w + 0.42, 0.5, 0.01, stripe, cx, H - 0.6, maxZ + T + 0.01)
    this.southStripes[0] = this.deco(w + 0.42, 0.5, 0.01, stripe, cx, H - 0.6, minZ - T - 0.01)
    this.deco(0.01, 0.5, d + 0.42, stripe, maxX + T + 0.01, H - 0.6, cz)

    // The dock doors: rollers that go up into the lintel.
    docks.z.forEach((z, i) => {
      const roller = new THREE.Mesh(new THREE.BoxGeometry(0.08, docks.height, docks.halfWidth * 2), shutterMat())
      // Guide rails either side of the shutter (inside), and a steel frame with yellow buffers round the opening (outside).
      const rail = paintedSteel(0x374151)
      for (const dz of [-1, 1]) {
        this.deco(0.1, docks.height, 0.08, rail, maxX - 0.06, docks.height / 2, z + dz * (docks.halfWidth + 0.02))
        this.deco(0.06, docks.height + 0.12, 0.14, rail, maxX + T + 0.03, (docks.height + 0.12) / 2, z + dz * (docks.halfWidth + 0.07))
        this.deco(0.16, 0.9, 0.14, paintedSteel(0xfacc15), maxX + T + 0.08, 0.5, z + dz * (docks.halfWidth + 0.07))
      }
      this.deco(0.06, 0.12, docks.halfWidth * 2 + 0.28, rail, maxX + T + 0.03, docks.height + 0.06, z)
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
    const rodMat = mat(0x6b7280, 0.5, 0.5)
    for (let x = minX + 2.4; x < maxX - 1; x += 3.8) {
      for (let z = minZ + 2.6; z < maxZ - 1; z += 4.4) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.05, 0.5), panel)
        f.position.set(x, H - 0.4, z)
        this.root.add(f)
        // Hung from the sloping roof on two rods.
        for (const dx of [-0.7, 0.7]) {
          const len = roofUnderside(x + dx) - (H - 0.4)
          const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, len, 6), rodMat)
          rod.position.set(x + dx, H - 0.4 + len / 2, z)
          this.root.add(rod)
        }
      }
    }

    // Slots for every rack, bought or not; the racks themselves appear when bought (the first two now).
    const { rack, shelves, lanes } = WAREHOUSE
    for (const r of shelves) this.slots.shelves.push(...this.rowSlots(r.z, r.x0, rack.bays, rack.pitch, rack.levels, r.lane))
    for (const r of shelves.slice(0, WAREHOUSE.startRacks)) this.rackAlongX(r.z, r.x0, rack.bays, rack.pitch, rack.levels, 'shelves')
    const u = UNDERGROUND.rack
    this.slots.hidden.push(...this.rowSlots(u.z, u.x0, u.bays, u.pitch, u.levels, u.z, UNDERGROUND.floorY))
    for (const section of ['cold', 'vault'] as const) {
      const room = WAREHOUSE[section]
      const levels = section === 'vault' ? rack.levels.slice(0, 2) : rack.levels
      this.slots[section].push(...this.rowSlots(room.minZ + 0.75, roomX0(room), 4, room.pitch, levels, lanes.room))
    }
    const cardboard = cardboardMat(0xb08a5a)
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
      ...SECTIONS.filter((s) => s !== 'hidden').flatMap((s) => this.slots[s].map((slot) => slot.approach)),
      ...docks.z.map((z) => ({ x: lanes.dock + 1.2, z })),
      ...WAREHOUSE.robotHomes.map(([x, z]) => ({ x, z })),
    ])

    // Stocked racks between the north wall and the first racks (no robot lanes there), the supervisor's desk under the board, and
    // louvred vents high on the walls (inside and out on the dock wall).
    this.stockRack(-13.0, 9.0, WAREHOUSE.rack.bays, WAREHOUSE.rack.pitch, WAREHOUSE.rack.levels, 1)
    this.stockRack(-13.0, 14.4, WAREHOUSE.rack.bays, WAREHOUSE.rack.pitch, WAREHOUSE.rack.levels, 2)
    this.buildDeskCorner(12.5, -9.95)
    for (const vz of [-15.5, -20.9, -27.4]) {
      this.wallVent(maxX - 0.03, WAREHOUSE.height - 0.8, vz, -Math.PI / 2)
      this.wallVent(maxX + T + 0.03, WAREHOUSE.height - 0.8, vz, Math.PI / 2)
    }
    for (const vx of [8.6, 18.0, 22.6]) this.wallVent(vx, WAREHOUSE.height - 0.8, minZ + 0.03, 0)

    // A parts cart along the north wall (clear of the robots' north lane) and an extinguisher by the hall door.
    this.root.add(prop('industrial_storage_cart', { x: 17.6, z: -9.95, height: 0.9, glow: 0.35 }))
    this.bodies.push(this.physics.addStaticBox(new THREE.Vector3(17.6, 0.45, -9.95), new THREE.Vector3(0.6, 0.45, 0.35)))
    this.root.add(prop('korean_fire_extinguisher_01', { x: 6.55, z: -19.6, rotY: Math.PI / 2, height: 0.6, glow: 0.3 }))
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
    this.syncTrucks(game, dt)
    this.tyres.update(dt)
    this.syncRobots(dt, game)
    this.syncPolice(game)
    this.syncDoors(dt, game, player)
    this.syncHatch(dt, game)
    this.syncHalls(game)
    this.syncContact(game, player, dt)
    for (const sp of this.spinners) sp.obj.rotation[sp.axis] += sp.speed * dt
    if (this.fanHead) this.fanHead.rotation.y = Math.sin(performance.now() / 2600) * 0.7
    this.drawBoard(game)
    this.drawDesk(game)
  }

  // ------------------------------------------------------------------ upgrades: racks, rooms and robots appear when bought

  private syncUpgrades(game: GameManager): void {
    const wh = game.warehouse
    const { rack, shelves } = WAREHOUSE
    this.syncHalls(game)
    const n = WAREHOUSE.startRacks
    for (const [first, count, id] of [
      [n, 1, 'wh-cap-1'],
      [n + 1, 1, 'wh-cap-2'],
      [n + 2, 4, 'wh-expand-1'],
      [n + 6, 4, 'wh-expand-2'],
    ] as const) {
      if (!wh.has(id) || this.built.has(id)) continue
      this.built.add(id)
      for (const r of shelves.slice(first, first + count)) this.rackAlongX(r.z, r.x0, rack.bays, rack.pitch, rack.levels, 'shelves')
    }
    const rooms: [Section, number, string, string, number][] = [
      ['cold', 0xe0f2fe, 'COLD ROOM', '#38bdf8', 0xbae6fd],
      ['vault', 0x475569, 'VAULT', '#fbbf24', 0x1e293b],
    ]
    if (wh.sectionCapacity('hidden') > 0 && !this.built.has('hidden')) {
      this.built.add('hidden')
      this.buildUnderground()
    }
    for (const [section, wallColour, text, textColour, floorColour] of rooms) {
      if (wh.sectionCapacity(section) <= 0 || this.built.has(section)) continue
      this.built.add(section)
      const r = WAREHOUSE[section as 'cold' | 'vault']
      this.rackArea(r, wallColour, text, textColour, floorColour, section)
      this.rackAlongX(r.minZ + 0.75, roomX0(r), 4, r.pitch, section === 'vault' ? rack.levels.slice(0, 2) : rack.levels, section)
    }
    if (wh.robots.length > 0 && !this.built.has('lanes')) {
      this.built.add('lanes')
      this.paintLanes()
    }
    while (this.robots.length < wh.robots.length) {
      const [x, z] = WAREHOUSE.robotHomes[this.robots.length] ?? WAREHOUSE.robotHomes[0]!
      // Robots 3 and 4 charge in the level 3 hall: their pads are painted when they arrive.
      if (this.robots.length >= 2) {
        this.deco(1.3, 0.01, 1.5, diamondPlate(0x374151, 0.25), x, 0.035, z)
        this.deco(1.1, 0.012, 1.3, mat(0xfacc15, 0.6), x, 0.037, z)
        this.deco(1.0, 0.014, 1.2, diamondPlate(0x374151, 0.25), x, 0.039, z)
      }
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
        crate.box.material = cardboardMat(c.spoiled ? 0x57534e : CARGO_COLOUR[c.cargo])
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
    this.paintLaneLines()
    const paint = mat(0xfacc15, 0.6)
    for (const [x, z] of WAREHOUSE.robotHomes.slice(0, 2)) {
      this.deco(1.3, 0.01, 1.5, diamondPlate(0x374151, 0.25), x, 0.035, z)
      this.deco(1.1, 0.012, 1.3, paint, x, 0.037, z)
      this.deco(1.0, 0.014, 1.2, diamondPlate(0x374151, 0.25), x, 0.039, z)
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
  private syncTrucks(game: GameManager, dt: number): void {
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
      let slide = -1
      let pose: Pose
      if (t.phase === 'arriving' && view.approach) {
        const d = driftArrival(view.approach, view.park, t.t, w.arriveSeconds)
        slide = d.slide
        pose = d
      } else pose = t.phase === 'arriving' ? view.arrive.at(Math.min(1, t.t / w.arriveSeconds)) : t.phase === 'leaving' ? view.leave.at(Math.min(1, t.t / w.leaveSeconds)) : view.park
      view.group.position.set(pose.x, 0, pose.z)
      view.group.rotation.y = pose.yaw
      this.truckMotion(view, pose, slide, dt)
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

  /**
   * What a truck's movement looks like: wheels turning by the distance covered, the body rolling into turns (and a lot in a slide),
   * brake lights in the slide, and, while it drifts, smoke and skid marks from the rear tyres.
   */
  private truckMotion(view: TruckView, pose: Pose, slide: number, dt: number): void {
    const dx = pose.x - view.last.x
    const dz = pose.z - view.last.z
    const dist = Math.hypot(dx, dz)
    let dyaw = pose.yaw - view.lastYaw
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw))
    view.last.set(pose.x, 0, pose.z)
    view.lastYaw = pose.yaw
    if (dt <= 0 || dist > 5) return
    // Forward or backward along the nose (−z of the model).
    const fwd = -(dx * -Math.sin(pose.yaw) + dz * -Math.cos(pose.yaw)) < 0 ? 1 : -1
    for (const w of view.model.wheels) w.rotation.x -= (fwd * dist) / view.model.wheelRadius
    const drifting = slide >= 0 && slide < 0.9
    const rate = dyaw / dt
    const target = THREE.MathUtils.clamp(-rate * (drifting ? 0.06 : 0.025), -0.14, 0.14)
    view.roll += (target - view.roll) * Math.min(1, dt * 6)
    view.group.rotation.z = view.roll
    // A little nose dip as it brakes out of the slide, then it settles.
    view.group.rotation.x = drifting ? -0.03 * (1 - slide) : view.group.rotation.x * (1 - Math.min(1, dt * 5))
    setBraking(view.model, drifting || (slide >= 0.9 && slide < 1))
    if (!drifting) return
    const speed = dist / dt
    const vx = dx / dt
    const vz = dz / dt
    view.smokeAt -= dt
    const cos = Math.cos(pose.yaw)
    const sin = Math.sin(pose.yaw)
    for (const r of view.model.rearWheels) {
      const wx = pose.x + r.x * cos + r.z * sin
      const wz = pose.z - r.x * sin + r.z * cos
      this.tyres.skid(wx, wz, Math.atan2(vx, vz))
      if (view.smokeAt <= 0) this.tyres.smoke(wx, wz, vx, vz, 0.7 + Math.min(1, speed / 8))
    }
    if (view.smokeAt <= 0) view.smokeAt = 0.045
  }

  /** Trucks and the police car near the main street, for the traffic to keep clear of. */
  vehicles(): THREE.Vector3[] {
    const out: THREE.Vector3[] = []
    for (const t of this.trucks.values()) if (t.group.position.z > 4) out.push(t.group.position)
    if (this.police && this.policeShown && this.police.group.position.z > 4) out.push(this.police.group.position)
    return out
  }

  /** The way in and the way out for a truck at dock `spot`. */
  private routes(spot: number, kind: Truck['kind']): { arrive: Route; leave: Route; park: Pose; approach: Leg | null } {
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
    // Kei trucks drift in instead of backing in: down the aisle flat out to just short of their dock, then slide in (`driftArrival`).
    const approach =
      kind === 'kei'
        ? rounded(
            [
              [road.laneX, START_Z],
              [road.laneX, yard.inZ],
              [ax, yard.inZ],
              [ax, Math.min(yard.inZ - 2.5, dz + 7)],
            ],
            2.5,
          )
        : null
    return { arrive, leave, park: { x: parkX, z: dz, yaw: -Math.PI / 2 }, approach }
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
    // The blueprint trucks (world/vehicles.ts): a kei truck with crates on its bed, or a delivery truck.
    const crates: THREE.Mesh[] = []
    const plate = `LM-${String(1000 + ((t.id * 7919) % 9000)).slice(0, 4)}`
    const model = t.kind === 'kei' ? makeKeiTruck(KEI_COLOURS[t.id % KEI_COLOURS.length]!, { plate }) : makeDeliveryTruck(BOX_COLOURS[t.id % BOX_COLOURS.length]!, { plate: `DL-${plate.slice(3)}` })
    group.add(model.group)
    if (t.kind === 'kei') {
      const cardboard = cardboardMat(CARGO_COLOUR[t.declared])
      for (const [x, z] of [[-0.33, 0.1], [0.33, 0.1], [-0.33, 0.95], [0.33, 0.95], [-0.33, 1.7], [0.33, 1.7]] as const) {
        const crate = add(new THREE.BoxGeometry(0.58, 0.5, 0.7), cardboard, x, 1.0, z)
        crate.visible = false
        crates.push(crate)
      }
    }
    // What you aim at: the whole truck.
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(t.kind === 'kei' ? 1.8 : 2.6, 2.6, t.kind === 'kei' ? 4.0 : 6.6), new THREE.MeshBasicMaterial({ visible: false }))
    proxy.position.set(0, 1.3, 0.4)
    tag(proxy, { kind: 'truck', truckId: t.id })
    group.add(proxy)
    const { arrive, leave, park, approach } = this.routes(t.spot, t.kind)
    const start = t.phase === 'parked' ? park : approach ? approach.at(0) : arrive.at(0)
    group.position.set(start.x, 0, start.z)
    group.rotation.y = start.yaw
    group.rotation.order = 'YXZ'
    return { id: t.id, group, crates, shown: -1, label: '', tag: null, arrive, leave, park, approach, model, last: new THREE.Vector3(start.x, 0, start.z), lastYaw: start.yaw, roll: 0, smokeAt: 0 }
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
    // A Kenney police car (nose +z; it drives south, −z), with our own flashing bar on its roof.
    group.add(kenney('cars', 'police', { x: 0, z: 0, rotY: Math.PI, scale: 1.55 }))
    const red = new THREE.MeshBasicMaterial({ color: 0xef4444 })
    const blue = new THREE.MeshBasicMaterial({ color: 0x3b82f6 })
    add(new THREE.BoxGeometry(0.42, 0.12, 0.26), red, -0.3, 1.98, 0.05)
    add(new THREE.BoxGeometry(0.42, 0.12, 0.26), blue, 0.3, 1.98, 0.05)
    const label = makeNameSprite('POLICE · inspection')
    label.position.set(0, 2.3, 0)
    group.add(label)
    return { group, lights: [red, blue] }
  }

  // ------------------------------------------------------------------ the yard and the road

  private buildYard(): void {
    const { road, yard, maxX, docks } = WAREHOUSE
    const asphalt = roadAsphalt(0x3a3d43)
    const lineYellow = mat(0xf2d16b, 0.6)
    const paint = mat(0xf8fafc, 0.6)
    // The service road, and the main street carried on east to meet it.
    this.decoYard(road.maxX - road.minX, 0.03, road.maxZ - road.minZ, asphalt, (road.minX + road.maxX) / 2, 0.005, (road.minZ + road.maxZ) / 2)
    for (let z = road.maxZ - 1; z > road.minZ; z -= 3.6) this.decoYard(0.15, 0.012, 1.6, lineYellow, (road.minX + road.maxX) / 2, 0.025, z)
    this.decoYard(36, 0.03, 8, asphalt, 48, -0.005, 14.2)
    for (let x = 31; x < 66; x += 4) this.decoYard(2, 0.01, 0.15, lineYellow, x, 0.012, 14.2)
    this.decoYard(36, 0.04, 4, mat(0xbdb8b0, 0.95), 48, 0, 8.2)
    // The truck yard: concrete from the docks to the road, with bay lines, dock bumpers and the drive lane.
    // The truck yard (the parking lot for the docks) is asphalt, a shade lighter than the road.
    const concrete = yardAsphalt(0x6e7177)
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
  private rowSlots(z: number, x0: number, bays: number, pitch: number, levels: readonly number[], laneZ: number, y0 = 0): Slot[] {
    const out: Slot[] = []
    for (const level of levels) {
      for (let b = 0; b < bays; b++) {
        const x = x0 + pitch * (b + 0.5)
        out.push({ pos: new THREE.Vector3(x, y0 + level + 0.03 + CRATE.h / 2, z), approach: { x, z: laneZ } })
      }
    }
    return out
  }

  /**
   * A pallet rack running along x from `x0`: posts, beams, boards, a collider, and an invisible box tagged with its section (aim at the
   * rack to store a crate on it, or to take one for a collection).
   */
  private rackAlongX(z: number, x0: number, bays: number, pitch: number, levels: readonly number[], section: Section, y0 = 0, topRoom = 1.0): void {
    const post = paintedSteel(0x1d4ed8)
    const beam = paintedSteel(0xf59e0b)
    const board = diamondPlate(0xa3abb5)
    const len = bays * pitch
    const xMid = x0 + len / 2
    const top = levels[levels.length - 1]! + topRoom
    for (let i = 0; i <= bays; i++) for (const dz of [-0.52, 0.52]) this.deco(0.08, top, 0.08, post, x0 + i * pitch, y0 + top / 2, z + dz)
    for (const level of levels) {
      this.deco(len, 0.05, 1.12, board, xMid, y0 + level, z)
      for (const dz of [-0.52, 0.52]) this.deco(len, 0.1, 0.05, beam, xMid, y0 + level - 0.08, z + dz)
    }
    this.physicsBox(xMid, y0 + top / 2, z, len / 2, top / 2, 0.58)
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(len + 0.1, top, 1.3), new THREE.MeshBasicMaterial({ visible: false }))
    proxy.position.set(xMid, y0 + top / 2, z)
    tag(proxy, { kind: 'section', section })
    this.root.add(proxy)
  }

  /**
   * The underground vault: a concrete room under the floor (rack along the south wall, a work table with a lamp, a caged bulb), a small
   * storage room off its east side, the shaft up to the warehouse floor with a ladder, and the sliding hatch door on top, covered by a mat
   * the colour of the floor so it is easy to miss.
   */
  private buildUnderground(): void {
    const U = UNDERGROUND
    const { hatch, closet } = U
    const y0 = U.floorY
    const h = U.ceilingY - y0
    const yMid = y0 + h / 2
    if (this.floorCap) this.root.remove(this.floorCap)
    this.floorCap = null
    const wallMat = concreteFloor(0x8b8680, 0.35)
    const floorMat = concreteFloor(0x77736d, 0.3)
    const ceilMat = concreteFloor(0x6b6762, 0.25)
    const cx = (U.minX + U.maxX) / 2
    const cz = (U.minZ + U.maxZ) / 2
    const W = U.maxX - U.minX
    const D = U.maxZ - U.minZ
    // Floor, ceiling (with the shaft through it) and walls; the east wall has the storage room's doorway.
    this.solid(W + 2 * T, T, D + 2 * T, floorMat, cx, y0 - T / 2, cz)
    for (const r of aroundHole(U.minX - T, U.maxX + T, U.minZ - T, U.maxZ + T, hatch)) {
      const m = new THREE.Mesh(metreUVs(new THREE.BoxGeometry(r.maxX - r.minX, 0.2, r.maxZ - r.minZ)), ceilMat)
      m.position.set((r.minX + r.maxX) / 2, U.ceilingY + 0.1, (r.minZ + r.maxZ) / 2)
      m.castShadow = true
      this.root.add(m)
    }
    this.solid(W + 2 * T, h, T, wallMat, cx, yMid, U.minZ - T / 2)
    this.solid(W + 2 * T, h, T, wallMat, cx, yMid, U.maxZ + T / 2)
    this.solid(T, h, D, wallMat, U.minX - T / 2, yMid, cz)
    const [d0, d1] = closet.doorZ
    const doorH = 1.9
    this.solid(T, h, d0 - U.minZ, wallMat, U.maxX + T / 2, yMid, (U.minZ + d0) / 2)
    this.solid(T, h, U.maxZ - d1, wallMat, U.maxX + T / 2, yMid, (d1 + U.maxZ) / 2)
    this.solid(T, h - doorH, d1 - d0, wallMat, U.maxX + T / 2, y0 + doorH + (h - doorH) / 2, (d0 + d1) / 2)
    // The shaft: lined from the vault's ceiling up to the floor of the warehouse.
    const sh = 0.03 - U.ceilingY
    const sy = U.ceilingY + sh / 2
    const hx = (hatch.minX + hatch.maxX) / 2
    const hz = (hatch.minZ + hatch.maxZ) / 2
    this.deco(hatch.maxX - hatch.minX + 0.1, sh, 0.05, wallMat, hx, sy, hatch.minZ - 0.025).castShadow = true
    this.deco(hatch.maxX - hatch.minX + 0.1, sh, 0.05, wallMat, hx, sy, hatch.maxZ + 0.025).castShadow = true
    this.deco(0.05, sh, hatch.maxZ - hatch.minZ, wallMat, hatch.minX - 0.025, sy, hz).castShadow = true
    this.deco(0.05, sh, hatch.maxZ - hatch.minZ, wallMat, hatch.maxX + 0.025, sy, hz).castShadow = true
    // A steel frame round the opening.
    const frame = paintedSteel(0x4b5563)
    for (const [w, d, x, z] of [
      [hatch.maxX - hatch.minX + 0.16, 0.08, hx, hatch.minZ - 0.04],
      [hatch.maxX - hatch.minX + 0.16, 0.08, hx, hatch.maxZ + 0.04],
      [0.08, hatch.maxZ - hatch.minZ, hatch.minX - 0.04, hz],
      [0.08, hatch.maxZ - hatch.minZ, hatch.maxX + 0.04, hz],
    ] as const)
      this.deco(w, 0.02, d, frame, x, 0.042, z)

    // The ladder: two rails from the vault floor to a little above the warehouse floor, rungs every 30 cm.
    const steel = mat(0x9ca3af, 0.4, 0.6)
    const { x: lx, z: lz } = U.ladder
    // The rails stop just under the floor; the grab bars above it slide up only while the hatch is open.
    const top = -0.02
    for (const dx of [-0.22, 0.22]) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, top - y0, 8), steel)
      rail.position.set(lx + dx, (top + y0) / 2, lz)
      rail.castShadow = true
      this.root.add(rail)
    }
    const bars = new THREE.Group()
    for (const dx of [-0.22, 0.22]) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.2, 8), steel)
      bar.position.set(lx + dx, -0.3, lz)
      bar.castShadow = true
      bars.add(bar)
    }
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.44, 8), steel)
    grip.rotation.z = Math.PI / 2
    grip.position.set(lx, 0.28, lz)
    bars.add(grip)
    this.root.add(bars)
    this.grabBars = bars
    for (let y = y0 + 0.3; y < 0; y += 0.3) {
      const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.44, 6), steel)
      rung.rotation.z = Math.PI / 2
      rung.position.set(lx, y, lz)
      this.root.add(rung)
    }
    // Two targets: the top of the ladder (on the warehouse floor) and its foot (in the vault).
    for (const [to, y, dy, dz] of [
      ['down', 0.75, 1.5, 1.0],
      ['up', y0 + 1.0, 1.6, 0.4],
    ] as const) {
      const proxy = new THREE.Mesh(new THREE.BoxGeometry(1.0, dy, dz), new THREE.MeshBasicMaterial({ visible: false }))
      proxy.position.set(lx, y, lz - dz / 2 + 0.1)
      tag(proxy, { kind: 'ladder', to })
      this.root.add(proxy)
    }

    // The sliding hatch door: a steel plate with a mat on it the colour of the floor; it slides east, over the floor.
    const door = new THREE.Group()
    door.position.set(hx, 0.045, hz)
    const plate = new THREE.Mesh(new THREE.BoxGeometry(hatch.maxX - hatch.minX + 0.12, 0.03, hatch.maxZ - hatch.minZ + 0.12), paintedSteel(0x374151))
    plate.castShadow = true
    const mat0 = new THREE.Mesh(metreUVs(new THREE.BoxGeometry(hatch.maxX - hatch.minX + 0.04, 0.012, hatch.maxZ - hatch.minZ + 0.04)), carpetFloor(0x7f8894))
    mat0.position.y = 0.021
    door.add(plate, mat0)
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.3), mat(0x9ca3af, 0.4, 0.6))
    handle.position.set(-(hatch.maxX - hatch.minX) / 2 + 0.1, 0.075, 0)
    door.add(handle)
    const hatchProxy = new THREE.Mesh(new THREE.BoxGeometry(hatch.maxX - hatch.minX + 0.2, 0.3, hatch.maxZ - hatch.minZ + 0.2), new THREE.MeshBasicMaterial({ visible: false }))
    hatchProxy.position.y = 0.12
    tag(hatchProxy, { kind: 'hatch' })
    door.add(hatchProxy)
    this.root.add(door)
    // Its rails on the floor to the east.
    for (const z of [hatch.minZ - 0.02, hatch.maxZ + 0.02]) this.deco(1.5, 0.012, 0.03, frame, hatch.maxX + 0.7, 0.04, z)
    this.hatchDoor = { mesh: door, body: this.hatchBody(), open: 0 }

    // The rack for the vault's slots, along the south wall.
    const r = U.rack
    this.rackAlongX(r.z, r.x0, r.bays, r.pitch, r.levels, 'hidden', y0, 0.62)
    // A work table with a lamp in the north-west corner, and a stool.
    const wood = woodMat(0x6b4f35)
    this.deco(1.1, 0.05, 0.6, wood, U.minX + 0.65, y0 + 0.76, U.maxZ - 0.4)
    for (const [dx, dz] of [[-0.5, -0.25], [0.5, -0.25], [-0.5, 0.25], [0.5, 0.25]] as const) this.deco(0.05, 0.74, 0.05, mat(0x374151, 0.6), U.minX + 0.65 + dx, y0 + 0.37, U.maxZ - 0.4 + dz)
    this.root.add(prop('desk_lamp_arm_01', { x: U.minX + 0.35, y: y0 + 0.785, z: U.maxZ - 0.35, rotY: Math.PI * 0.8, height: 0.42, glow: 0.4 }))
    this.deco(0.26, 0.004, 0.2, mat(0xf8fafc, 0.9), U.minX + 0.8, y0 + 0.79, U.maxZ - 0.42)
    this.physicsBox(U.minX + 0.65, y0 + 0.4, U.maxZ - 0.4, 0.55, 0.4, 0.3)
    this.bulb(cx - 0.6, U.ceilingY, cz - 0.6)

    // The small storage room: a doorway in the vault's east wall, shelves of boxes along its east wall, its own bulb.
    const ccx = (closet.minX + closet.maxX) / 2
    const ccz = (closet.minZ + closet.maxZ) / 2
    const cw = closet.maxX - closet.minX
    const cd = closet.maxZ - closet.minZ
    this.solid(cw + T, T, cd + 2 * T, floorMat, ccx + T / 2, y0 - T / 2, ccz)
    const ceil = new THREE.Mesh(metreUVs(new THREE.BoxGeometry(cw + T, 0.2, cd + 2 * T)), ceilMat)
    ceil.position.set(ccx + T / 2, U.ceilingY + 0.1, ccz)
    ceil.castShadow = true
    this.root.add(ceil)
    this.solid(cw + T, h, T, wallMat, ccx + T / 2, yMid, closet.minZ - T / 2)
    this.solid(cw + T, h, T, wallMat, ccx + T / 2, yMid, closet.maxZ + T / 2)
    this.solid(T, h, cd, wallMat, closet.maxX + T / 2, yMid, ccz)
    const sx = closet.maxX - 0.3
    for (const level of [0.3, 0.9, 1.5]) this.deco(0.5, 0.04, cd - 0.3, wood, sx, y0 + level, ccz)
    for (const dz of [-1, 1]) this.deco(0.05, 1.8, 0.05, mat(0x374151, 0.6), sx, y0 + 0.9, ccz + dz * (cd / 2 - 0.2))
    const tints = [0xb08a5a, 0x9c7748, 0xc49a63]
    let k = 0
    for (const level of [0.3, 0.9, 1.5])
      for (let z = closet.minZ + 0.35; z < closet.maxZ - 0.4; z += 0.55) {
        const bh = 0.2 + ((k * 37) % 7) * 0.04
        this.deco(0.36, bh, 0.42, cardboardMat(tints[k++ % 3]!), sx, y0 + level + 0.02 + bh / 2, z)
      }
    this.physicsBox(sx, y0 + 0.9, ccz, 0.28, 0.9, cd / 2)
    this.bulb(ccx - 0.3, U.ceilingY, ccz)
  }

  /** A caged bulb hanging from a ceiling at `ceilingY` (it glows; no real light, see AGENTS.md). */
  private bulb(x: number, ceilingY: number, z: number): void {
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.4, 6), mat(0x111827, 0.6))
    cord.position.set(x, ceilingY - 0.2, z)
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 10), new THREE.MeshStandardMaterial({ color: 0xfff7d6, emissive: 0xffe9a8, emissiveIntensity: 2.2 }))
    glass.position.set(x, ceilingY - 0.47, z)
    const cage = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshStandardMaterial({ color: 0x1f2937, wireframe: true }))
    cage.position.copy(glass.position)
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.06, 10), mat(0x1f2937, 0.5, 0.4))
    cap.position.set(x, ceilingY - 0.4, z)
    this.root.add(cord, glass, cage, cap)
  }

  private hatchBody(): RAPIER.RigidBody {
    const { hatch } = UNDERGROUND
    return this.physics.addStaticBox(
      new THREE.Vector3((hatch.minX + hatch.maxX) / 2, 0.03, (hatch.minZ + hatch.maxZ) / 2),
      new THREE.Vector3((hatch.maxX - hatch.minX) / 2, 0.03, (hatch.maxZ - hatch.minZ) / 2),
    )
  }

  /** The hatch slides open and shut when you press E on it (`game.vaultHatchOpen`); the grab bars rise out of the shaft once it is open. */
  private syncHatch(dt: number, game: GameManager): void {
    const d = this.hatchDoor
    if (!d) return
    const { hatch } = UNDERGROUND
    const hx = (hatch.minX + hatch.maxX) / 2
    d.open += ((game.vaultHatchOpen ? 1 : 0) - d.open) * Math.min(1, dt * 4)
    d.mesh.position.x = hx + d.open * (hatch.maxX - hatch.minX + 0.12)
    if (this.grabBars) {
      this.grabBars.position.y = Math.max(0, d.open - 0.5) * 2 * 0.9 - 0.9
      this.grabBars.visible = d.open > 0.5
    }
    const shut = d.open < 0.5
    if (shut && !d.body) d.body = this.hatchBody()
    else if (!shut && d.body) {
      this.physics.removeBody(d.body)
      d.body = null
    }
  }

  /** The painted robot lanes, clipped to the halls built so far (repainted when a hall is added). */
  private paintLaneLines(): void {
    if (this.lanePaint) this.root.remove(this.lanePaint)
    const g = new THREE.Group()
    const paint = mat(0xfacc15, 0.6)
    const { halls } = WAREHOUSE
    const minZ = this.hallsBuilt > 0 ? halls[this.hallsBuilt - 1]!.minZ : WAREHOUSE.minZ
    for (const [x0, z0a, x1, z1a] of this.lanes.segments) {
      const z0 = Math.max(z0a, minZ + 0.5)
      const z1 = Math.max(z1a, minZ + 0.5)
      if (Math.min(z0a, z1a) < minZ && Math.abs(z0a - z1a) < 0.01) continue // a lane along a hall not built yet
      const len = Math.hypot(x1 - x0, z1 - z0)
      if (len < 0.05) continue
      const along = Math.abs(x1 - x0) > 0.01
      const m = new THREE.Mesh(new THREE.BoxGeometry(along ? len : 0.1, 0.008, along ? 0.1 : len), paint)
      m.position.set((x0 + x1) / 2, 0.036, (z0 + z1) / 2)
      m.receiveShadow = true
      g.add(m)
    }
    this.root.add(g)
    this.lanePaint = g
  }

  /** A south wall at `z` (the shed's, or a hall's) with a removable panel in its doorway, for the next hall. */
  private southWall(z: number, material: THREE.Material, index: number): void {
    const { minX, maxX, height: H, hallDoor: door } = WAREHOUSE
    this.solid(door.minX - (minX - T), H, T, material, (minX - T + door.minX) / 2, H / 2, z)
    this.solid(maxX + T - door.maxX, H, T, material, (door.maxX + maxX + T) / 2, H / 2, z)
    this.solid(door.maxX - door.minX, H - door.height, T, material, (door.minX + door.maxX) / 2, door.height + (H - door.height) / 2, z)
    if (index >= WAREHOUSE.halls.length) {
      this.solid(door.maxX - door.minX, door.height, T, material, (door.minX + door.maxX) / 2, door.height / 2, z)
      return
    }
    const plug = new THREE.Mesh(metreUVs(new THREE.BoxGeometry(door.maxX - door.minX, door.height, T)), material)
    plug.position.set((door.minX + door.maxX) / 2, door.height / 2, z)
    plug.castShadow = true
    markBlocker(plug)
    this.root.add(plug)
    const body = this.physics.addStaticBox(plug.position.clone(), new THREE.Vector3((door.maxX - door.minX) / 2, door.height / 2, T / 2))
    this.hallPlugs[index] = { mesh: plug, body }
  }

  /** Build the halls the upgrades have paid for (levels 3 and 4), in order. */
  private syncHalls(game: GameManager): void {
    const wanted = (game.warehouse.has('wh-expand-1') ? 1 : 0) + (game.warehouse.has('wh-expand-2') ? 1 : 0)
    while (this.hallsBuilt < wanted) this.buildHall(this.hallsBuilt)
  }

  /**
   * A new hall south of the shed (or of the last hall): walls, a pitched roof, floor, lights, its racks (built by the rack upgrades loop),
   * a doorway from the north that the west robot lane runs through, and the doorway plug to the next hall.
   */
  private buildHall(i: number): void {
    const { minX, maxX, height: H, halls, hallDoor: door } = WAREHOUSE
    const hall = halls[i]!
    const w = maxX - minX
    const cx = (minX + maxX) / 2
    const d = hall.maxZ - hall.minZ
    const cz = (hall.minZ + hall.maxZ) / 2
    const steel = shedCladding(0x86a7b8, 0.3)
    // Knock through the doorway from the north; the stripe outside that wall is now indoors, so it goes.
    const old = this.southStripes[i]
    if (old) this.root.remove(old)
    const plug = this.hallPlugs[i]
    if (plug) {
      this.root.remove(plug.mesh)
      this.physics.removeBody(plug.body)
    }
    this.deco(w, 0.03, d + T, concreteFloor(0x8f949a, 0.3), cx, 0.016, cz + T / 2)
    this.solid(T, H, d + T, steel, minX - T / 2, H / 2, cz + T / 2)
    this.solid(T, H, d + T, steel, maxX + T / 2, H / 2, cz + T / 2)
    this.southWall(hall.minZ - T / 2, steel, i + 1)
    this.buildRoof(shedRoof(0x9c3a33, 0.25), steel, hall.minZ, hall.maxZ, false)
    // The blue stripe outside, round the new walls.
    const stripe = mat(0x1d4ed8, 0.7)
    this.southStripes[i + 1] = this.deco(w + 0.42, 0.5, 0.01, stripe, cx, H - 0.6, hall.minZ - T - 0.01)
    this.deco(0.01, 0.5, d + T, stripe, maxX + T + 0.01, H - 0.6, cz + T / 2)
    // Lights hung from the roof.
    const panel = lightPanel(0xfff8e7, 1.3)
    const rodMat = mat(0x6b7280, 0.5, 0.5)
    for (let x = minX + 2.4; x < maxX - 1; x += 3.8) {
      for (const z of [hall.maxZ - 2.6, hall.minZ + 3.0]) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.05, 0.5), panel)
        f.position.set(x, H - 0.4, z)
        this.root.add(f)
        for (const dx of [-0.7, 0.7]) {
          const len = roofUnderside(x + dx) - (H - 0.4)
          const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, len, 6), rodMat)
          rod.position.set(x + dx, H - 0.4 + len / 2, z)
          this.root.add(rod)
        }
      }
    }
    // A level sign over the doorway, on both sides, and vents high on the east wall.
    for (const [z, ry] of [
      [hall.maxZ + T + 0.03, 0],
      [hall.maxZ - 0.03, Math.PI],
    ] as const) {
      const sign = makeSign(`WAREHOUSE LEVEL ${i + 3}`, 1.9, 0.26, '#0f172a', '#fbbf24')
      sign.position.set((door.minX + door.maxX) / 2 + 0.6, door.height + 0.4, z)
      sign.rotation.y = ry
      this.root.add(sign)
    }
    for (const vz of [hall.maxZ - 3, hall.minZ + 3]) this.wallVent(maxX - 0.03, WAREHOUSE.height - 0.8, vz, -Math.PI / 2)
    this.root.add(prop('korean_fire_extinguisher_01', { x: maxX - 0.4, z: hall.maxZ - 0.5, height: 0.6, glow: 0.3 }))
    this.hallsBuilt = i + 1
    if (this.built.has('lanes')) this.paintLaneLines()
  }

  /** The contact by the door: shown while he is here, walking in and out along `CONTACT_WALK`. */
  private syncContact(game: GameManager, player: THREE.Vector3, dt: number): void {
    const c = game.warehouse.contact
    if (!c) {
      if (this.contactView) this.contactView.group.visible = false
      return
    }
    if (!this.contactView || this.contactView.name !== c.name) {
      if (this.contactView) this.root.remove(this.contactView.group)
      const rig = makePerson({ skin: 0xc68e5e, hair: 0x111827, hairStyle: 'cap', shirt: 0x1f2937, trousers: 0x111111, height: 1.02 }, {})
      const group = new THREE.Group()
      group.add(rig.root)
      const proxy = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.9, 0.7), new THREE.MeshBasicMaterial({ visible: false }))
      proxy.position.y = 0.95
      tag(proxy, { kind: 'contact' })
      group.add(proxy)
      const label = makeSign(c.name, 0.7, 0.16, '#0f172a', '#a3e635')
      label.position.y = 2.15
      group.add(label)
      // Two plain crates at his feet while he has something to hand over.
      this.root.add(group)
      this.contactView = { group, rig, label, name: c.name }
    }
    const v = this.contactView
    v.group.visible = true
    const walk = (u: number) => {
      const k = Math.min(1, Math.max(0, u)) * (CONTACT_WALK.length - 1)
      const i = Math.min(CONTACT_WALK.length - 2, Math.floor(k))
      const f = k - i
      const [ax, az] = CONTACT_WALK[i]!
      const [bx, bz] = CONTACT_WALK[i + 1]!
      return { x: ax + (bx - ax) * f, z: az + (bz - az) * f, yaw: Math.atan2(bx - ax, bz - az) }
    }
    const secs = CONFIG.warehouse.contact.walkSeconds
    const moving = c.phase === 'arriving' || c.phase === 'leaving'
    const u = c.phase === 'arriving' ? c.t / secs : c.phase === 'leaving' ? 1 - c.t / secs : 1
    const p = walk(u)
    v.group.position.set(p.x, 0.035, p.z)
    // Walking: face the way he goes (back to the door when leaving); waiting: face you.
    v.group.rotation.y = moving ? (c.phase === 'leaving' ? p.yaw + Math.PI : p.yaw) : Math.atan2(player.x - p.x, player.z - p.z)
    const swing = moving ? Math.sin(performance.now() / 160) * 0.5 : 0
    v.rig.legL.rotation.x = swing
    v.rig.legR.rotation.x = -swing
    v.rig.armL.rotation.x = moving ? -swing * 0.6 : -0.3
    v.rig.armR.rotation.x = moving ? swing * 0.6 : -0.3
    animatePerson(v.rig, dt, moving ? 'walk' : 'idle')
    if (v.label) v.label.lookAt(v.label.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(1, 0, 0)))
  }

  /**
   * A rack area along the south wall (where the rooms used to be): a tinted floor with a painted border, a wall sign, and its fittings.
   * Cold: two cooling units on the wall above the rack. Vault: a wire-mesh cage round the rack, open at the front for the robots.
   * Hidden: an unmarked corner. The rack itself is built by the caller.
   */
  private rackArea(rect: Rect, _wallColour: number, text: string, textColour: string, floorColour: number, section: Section): void {
    const { minX, maxX, minZ, maxZ } = rect
    const cx = (minX + maxX) / 2
    const cz = (minZ + maxZ) / 2
    const vault = section === 'vault'
    this.deco(maxX - minX, 0.02, maxZ - minZ, vault ? diamondPlate(floorColour, 0.25) : concreteFloor(floorColour, 0.25), cx, 0.045, cz)
    if (section !== 'hidden') {
      const edge = mat(section === 'cold' ? 0x38bdf8 : 0xfacc15, 0.6)
      for (const [w, d, x, z] of [
        [maxX - minX, 0.08, cx, maxZ - 0.04],
        [0.08, maxZ - minZ, minX + 0.04, cz],
        [0.08, maxZ - minZ, maxX - 0.04, cz],
      ] as const)
        this.deco(w, 0.008, d, edge, x, 0.059, z)
      const sign = makeSign(text, 1.6, 0.26, '#0f172a', textColour)
      sign.position.set(cx, 3.05, minZ + 0.03)
      this.root.add(sign)
    }
    if (section === 'cold') for (const x of [minX + 1.2, maxX - 1.2]) this.coolingUnit(x, 3.75, minZ + 0.3)
    if (vault) this.cage(minX + 0.08, maxX - 0.08, minZ + 0.04, -29.3, 2.4)
  }

  /** A wire-mesh cage from (x0, z0) to (x1, z1), `h` tall, open on its north side (the robots reach in there); its gate stands open. */
  private cage(x0: number, x1: number, z0: number, z1: number, h: number): void {
    const frame = paintedSteel(0x374151)
    const mesh = wireMesh()
    const post = (x: number, z: number) => this.deco(0.06, h, 0.06, frame, x, h / 2, z)
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]] as const) post(x, z)
    const panel = (w: number, ph: number, d: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(metreUVs(new THREE.BoxGeometry(w, ph, d)), mesh)
      m.position.set(x, y, z)
      this.root.add(m)
    }
    const midX = (x0 + x1) / 2
    const midZ = (z0 + z1) / 2
    panel(0.01, h, z1 - z0, x0, h / 2, midZ)
    panel(0.01, h, z1 - z0, x1, h / 2, midZ)
    panel(x1 - x0, 0.01, z1 - z0, midX, h, midZ)
    this.deco(x1 - x0, 0.06, 0.06, frame, midX, h, z1)
    this.deco(x1 - x0, 0.06, 0.06, frame, midX, h, z0)
    // The gate, swung right open against the outside of the east side.
    panel(0.01, h - 0.2, 1.1, x1 + 0.05, (h - 0.2) / 2 + 0.05, z1 - 0.55)
    this.deco(0.04, h - 0.2, 0.04, frame, x1 + 0.05, (h - 0.2) / 2 + 0.05, z1 - 1.1)
  }

  /** A wall-mounted cooling unit facing north (+z) at (x, y), back against the wall at z: a casing with two spinning fans. */
  private coolingUnit(x: number, y: number, z: number): void {
    const casing = paintedSteel(0xe2e8f0)
    const dark = mat(0x1f2937, 0.6)
    this.deco(1.5, 0.62, 0.42, casing, x, y, z + 0.21)
    for (const dx of [-0.36, 0.36]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.025, 8, 24), dark)
      ring.position.set(x + dx, y, z + 0.43)
      this.root.add(ring)
      const hub = new THREE.Group()
      hub.position.set(x + dx, y, z + 0.41)
      for (let i = 0; i < 4; i++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.19, 0.01), dark)
        blade.position.y = 0.1
        const arm = new THREE.Group()
        arm.rotation.z = (i * Math.PI) / 2
        arm.add(blade)
        hub.add(arm)
      }
      this.root.add(hub)
      this.spinners.push({ obj: hub, axis: 'z', speed: 9 })
      for (let k = -2; k <= 2; k++) this.deco(0.44, 0.008, 0.008, dark, x + dx, y + k * 0.08, z + 0.455)
    }
    // Its pipes run up the wall to the roof.
    for (const dx of [-0.6, 0.6]) {
      const top = roofUnderside(x + dx)
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, top - y, 8), mat(0x9ca3af, 0.4, 0.6))
      pipe.position.set(x + dx, (top + y) / 2, z + 0.06)
      this.root.add(pipe)
    }
  }

  /** A louvred wall vent at (x, y) on a wall facing `facing` (the direction into the shed). */
  private wallVent(x: number, y: number, z: number, rotY: number): void {
    const g = new THREE.Group()
    g.position.set(x, y, z)
    g.rotation.y = rotY
    const frame = paintedSteel(0x4b5563)
    const slat = mat(0x111827, 0.6)
    const add = (w: number, h: number, d: number, m: THREE.Material, px: number, py: number, pz: number, rx = 0) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)
      mesh.position.set(px, py, pz)
      mesh.rotation.x = rx
      g.add(mesh)
    }
    add(1.0, 0.7, 0.04, frame, 0, 0, 0)
    add(0.9, 0.6, 0.02, slat, 0, 0, 0.012)
    for (let i = 0; i < 6; i++) add(0.88, 0.07, 0.012, frame, 0, -0.25 + i * 0.1, 0.035, -0.6)
    this.root.add(g)
  }

  /** The pitched roof: two sloping sheets meeting at a ridge along z, gable ends on the north and south walls, ridge vents. */
  private buildRoof(roofMat: THREE.Material, wallMat: THREE.Material, minZ: number, maxZ: number, north: boolean): void {
    const { minX, maxX, height: H } = WAREHOUSE
    const half = (maxX - minX) / 2
    const cx = minX + half
    const angle = Math.atan2(ROOF_RISE, half)
    const lining = shedCladding(0xdde4e8, 0.45)
    const len = maxZ - minZ + 0.8
    const cz = (minZ + maxZ) / 2
    // The west sheet stops at the west wall (past it are the halls); the east one overhangs the docks by 0.5 m.
    for (const [side, run] of [
      [-1, half],
      [1, half + 0.5],
    ] as const) {
      const slope = run / Math.cos(angle)
      const g = new THREE.Group()
      g.position.set(cx + (side * run) / 2, H + ROOF_RISE - (run / 2) * Math.tan(angle) + 0.06, cz)
      g.rotation.z = -side * angle
      // The sheet's ribs run down the slope: its texture's long axis lies along the box's z, so the box is turned a quarter.
      // Red sheet on top, a pale insulated lining underneath (faces: +x, −x, +y, −y, +z, −z).
      const sheet = new THREE.Mesh(metreUVs(new THREE.BoxGeometry(len, 0.12, slope)), [roofMat, roofMat, roofMat, lining, roofMat, roofMat])
      sheet.rotation.y = Math.PI / 2
      sheet.castShadow = true
      sheet.receiveShadow = true
      g.add(sheet)
      this.root.add(g)
    }
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, len), mat(0x7f1d1d, 0.6, 0.3))
    ridge.position.set(cx, H + ROOF_RISE + 0.1, cz)
    this.root.add(ridge)
    // Gable ends: triangles of cladding on the north and south walls, from the eaves up to the ridge.
    const shape = new THREE.Shape()
    shape.moveTo(minX, H)
    shape.lineTo(maxX + T, H)
    shape.lineTo(cx, H + ROOF_RISE)
    shape.closePath()
    const gable = new THREE.ExtrudeGeometry(shape, { depth: T, bevelEnabled: false })
    for (const z of north ? [maxZ, minZ - T] : [minZ - T]) {
      const m = new THREE.Mesh(gable, wallMat)
      m.position.z = z
      m.castShadow = true
      m.receiveShadow = true
      this.root.add(m)
    }
    // Turbine ventilators along the ridge, spinning in the wind.
    for (const z of [minZ + 4, cz, maxZ - 4]) {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.3, 16), mat(0x9ca3af, 0.4, 0.6))
      base.position.set(cx, H + ROOF_RISE + 0.3, z)
      this.root.add(base)
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xcbd5e1, 0.35, 0.7))
      head.position.set(cx, H + ROOF_RISE + 0.45, z)
      head.scale.y = 0.9
      for (let i = 0; i < 10; i++) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.3, 0.12), mat(0x94a3b8, 0.4, 0.6))
        const a = (i / 10) * Math.PI * 2
        fin.position.set(Math.cos(a) * 0.3, 0.08, Math.sin(a) * 0.3)
        fin.rotation.y = -a + 0.5
        head.add(fin)
      }
      this.root.add(head)
      this.spinners.push({ obj: head, axis: 'y', speed: 1.6 })
    }
  }

  /**
   * A stocked rack for show (not a section: the robots never use it): uprights, beams and decks like the others, loaded with cardboard
   * boxes of mixed sizes and a pallet here and there. It has a collider.
   */
  private stockRack(z: number, x0: number, bays: number, pitch: number, levels: readonly number[], seed: number): void {
    const post = paintedSteel(0x1d4ed8)
    const beam = paintedSteel(0xf59e0b)
    const board = diamondPlate(0xa3abb5)
    const len = bays * pitch
    const xMid = x0 + len / 2
    const top = levels[levels.length - 1]! + 1.0
    for (let i = 0; i <= bays; i++) for (const dz of [-0.52, 0.52]) this.deco(0.08, top, 0.08, post, x0 + i * pitch, top / 2, z + dz)
    const rnd = (k: number) => {
      const v = Math.sin(seed * 91.7 + k * 12.9898) * 43758.5453
      return v - Math.floor(v)
    }
    const tints = [0xb08a5a, 0xc49a63, 0x9c7748, 0xb8956b]
    let k = 0
    for (const level of levels) {
      this.deco(len, 0.05, 1.12, board, xMid, level, z)
      for (const dz of [-0.52, 0.52]) this.deco(len, 0.1, 0.05, beam, xMid, level - 0.08, z + dz)
      for (let b = 0; b < bays; b++) {
        const bx = x0 + pitch * (b + 0.5)
        if (rnd(k++) < 0.15) continue
        if (rnd(k++) < 0.3) {
          // A pallet with a stack of boxes on it.
          this.deco(pitch - 0.2, 0.12, 0.95, woodMat(0x9a7b55), bx, level + 0.085, z)
          for (let s = 0; s < 2; s++) this.deco(pitch - 0.35, 0.3, 0.8, cardboardMat(tints[(k + s) % 4]!), bx, level + 0.3 + s * 0.31, z)
          continue
        }
        let x = bx - pitch / 2 + 0.1
        while (x < bx + pitch / 2 - 0.25) {
          const w = 0.25 + rnd(k++) * 0.3
          const h = 0.2 + rnd(k++) * 0.45
          const d = 0.35 + rnd(k++) * 0.5
          if (x + w > bx + pitch / 2 - 0.05) break
          this.deco(w, h, d, cardboardMat(tints[k % 4]!), x + w / 2, level + 0.025 + h / 2, z + (rnd(k++) - 0.5) * 0.2)
          x += w + 0.04
        }
      }
    }
    this.physicsBox(xMid, top / 2, z, len / 2, top / 2, 0.58)
  }

  /** The shift supervisor's desk against the north wall: a metal desk, a chair, a desk lamp and a little fan, and a paper or two. */
  private buildDeskCorner(x: number, z: number): void {
    this.root.add(prop('metal_office_desk', { x, z, rotY: Math.PI, height: 0.76, glow: 0.3 }))
    this.physicsBox(x, 0.38, z, 0.7, 0.38, 0.4)
    this.root.add(prop('plastic_monobloc_chair_01', { x: x + 0.1, z: z - 0.75, rotY: 0.25, height: 0.8, glow: 0.3 }))
    this.root.add(prop('desk_lamp_arm_01', { x: x - 0.45, y: 0.76, z: z + 0.1, rotY: Math.PI + 0.6, height: 0.45, glow: 0.3 }))
    this.deco(0.3, 0.004, 0.22, mat(0xf8fafc, 0.9), x - 0.05, 0.765, z - 0.05)
    this.deco(0.24, 0.004, 0.3, mat(0xfef3c7, 0.9), x + 0.12, 0.768, z - 0.02)
    // A table fan, its head turning slowly from side to side.
    const fan = new THREE.Group()
    fan.position.set(x + 0.5, 0.76, z + 0.05)
    const white = mat(0xe5e7eb, 0.4)
    const grey = mat(0x9ca3af, 0.4, 0.5)
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.03, 20), white)
    base.position.y = 0.015
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.22, 8), grey)
    stem.position.y = 0.13
    fan.add(base, stem)
    const head = new THREE.Group()
    head.position.y = 0.26
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.09, 12), white)
    motor.rotation.x = Math.PI / 2
    motor.position.z = 0.02
    const cage = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.006, 6, 28), grey)
    cage.position.z = -0.05
    const cageBack = cage.clone()
    cageBack.position.z = -0.015
    const blades = new THREE.Group()
    blades.position.z = -0.035
    for (let i = 0; i < 3; i++) {
      const arm = new THREE.Group()
      arm.rotation.z = (i * Math.PI * 2) / 3
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.004), mat(0x7dd3fc, 0.4))
      blade.position.y = 0.055
      blade.rotation.y = 0.35
      arm.add(blade)
      blades.add(arm)
    }
    head.add(motor, cage, cageBack, blades)
    fan.add(head)
    fan.rotation.y = Math.PI
    this.root.add(fan)
    this.spinners.push({ obj: blades, axis: 'z', speed: 22 })
    this.fanHead = head
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
    [robotHomes[0]![0], robotHomes[0]![1], robotHomes[1]![0], robotHomes[0]![1]],
  ]
  for (const section of ['cold', 'vault'] as const) {
    const r = WAREHOUSE[section]
    const cx = (r.minX + r.maxX) / 2
    segs.push([cx, lanes.south, cx, lanes.room], [r.minX + 0.5, lanes.room, r.maxX - 0.5, lanes.room])
  }
  for (const z of docks.z) segs.push([lanes.dock, z, lanes.dock + 1.2, z])
  // Down through the doorways into the new halls, and along each one.
  let fromZ: number = lanes.south
  for (const hall of WAREHOUSE.halls) {
    // The level 3 hall's lane runs on past its racks to the chargers of robots 3 and 4.
    segs.push([lanes.west, fromZ, lanes.west, hall.lane], [lanes.west, hall.lane, hall === WAREHOUSE.halls[0] ? 23.4 : 20.0, hall.lane])
    fromZ = hall.lane
  }
  return segs
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

let shutter: THREE.MeshStandardMaterial | null = null
/** A roller shutter: horizontal steel slats with dark seams and a little wear, drawn once and shared by every dock door. */
function shutterMat(): THREE.MeshStandardMaterial {
  if (shutter) return shutter
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (ctx) {
    for (let y = 0; y < 256; y += 16) {
      const g = ctx.createLinearGradient(0, y, 0, y + 16)
      g.addColorStop(0, '#a8b3bf')
      g.addColorStop(0.45, '#cbd3dc')
      g.addColorStop(0.85, '#8a96a3')
      g.addColorStop(1, '#3f4954')
      ctx.fillStyle = g
      ctx.fillRect(0, y, 64, 16)
    }
    ctx.fillStyle = 'rgba(60, 50, 40, 0.12)'
    for (let i = 0; i < 40; i++) ctx.fillRect((i * 37) % 64, (i * 53) % 256, 2 + (i % 3), 1)
  }
  const map = new THREE.CanvasTexture(canvas)
  map.colorSpace = THREE.SRGBColorSpace
  map.wrapS = THREE.RepeatWrapping
  map.wrapT = THREE.RepeatWrapping
  map.repeat.set(1, 1.6)
  shutter = new THREE.MeshStandardMaterial({ map, roughness: 0.45, metalness: 0.35, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.12 })
  return shutter
}
