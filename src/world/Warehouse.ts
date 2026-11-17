import type RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import type { PhysicsWorld } from '../engine/PhysicsWorld'
import { CONFIG, type CargoType, type Section } from '../sim/config'
import type { GameManager } from '../sim/GameManager'
import type { Truck } from '../sim/WarehouseManager'
import { markBlocker, tag } from './interactables'
import { SOUTH, WAREHOUSE } from './layout'
import { makeSign, mat } from './models'

const T = 0.2
/** Trucks come in from the main street and leave out of the far end of the road. */
const START_Z = 16
const END_Z = -56
const RISE_SECONDS = 1.4
const CRATE = { w: 0.8, h: 0.6, d: 0.9 }
const POLICE_X = 25.6
const POLICE_PARK_Z = -11.5

/** The look of each kind of crate (what it looks like on the dock or on a shelf). */
const CARGO_COLOUR: Record<CargoType, number> = { general: 0xb08a5a, food: 0x84cc16, cold: 0x38bdf8, metals: 0x94a3b8, illegal: 0x111827 }

type TruckView = { id: number; group: THREE.Group; crates: THREE.Mesh[]; shown: number; kind: Truck['kind'] }
type CrateView = { group: THREE.Group; box: THREE.Mesh; band: THREE.Mesh }
type Rect = { minX: number; maxX: number; minZ: number; maxZ: number }

/**
 * The warehouse extension: a walkway from the door in the south hall, a steel-clad shed with pallet racks, a roller shutter, a receiving dock
 * and desk, and the service road with the trucks that drive in from the street, stop at the bay and drive out the far end (and, now and then,
 * a police car). Upgrades add what you buy: more rack rows, a cold room, a vault and a hidden room. It draws `game.warehouse` and decides nothing.
 *
 * `root` is the building (hidden when you are far away, like the halls); `yard` is the road and the vehicles (always drawn, you can see
 * the trucks from the street).
 */
export class Warehouse {
  readonly root = new THREE.Group()
  readonly yard = new THREE.Group()
  private readonly bodies: RAPIER.RigidBody[] = []
  private readonly physics: PhysicsWorld
  /** Crate slots per section, and one crate view for each. */
  private readonly slots: Record<Section, THREE.Vector3[]> = { shelves: [], cold: [], vault: [], hidden: [] }
  private readonly crates: Record<Section, CrateView[]> = { shelves: [], cold: [], vault: [], hidden: [] }
  private readonly shutter: THREE.Mesh
  private shutterOpen = 0
  private truck: TruckView | null = null
  private readonly built = new Set<string>()
  private crateSignature = ''
  private dockSignature = ''
  private readonly dock = new THREE.Group()
  private police: { group: THREE.Group; lights: THREE.MeshBasicMaterial[] } | null = null
  private policeShown = false
  private readonly board = { canvas: document.createElement('canvas'), texture: null as THREE.CanvasTexture | null, signature: '' }
  private readonly desk = { canvas: document.createElement('canvas'), texture: null as THREE.CanvasTexture | null, signature: '' }
  private rise = 1

  constructor(physics: PhysicsWorld) {
    this.physics = physics
    this.root.userData.zone = 'warehouse'
    const { minX, maxX, minZ, maxZ, height: H, door, shutter, road } = WAREHOUSE
    const w = maxX - minX
    const d = maxZ - minZ
    const cx = (minX + maxX) / 2
    const cz = (minZ + maxZ) / 2
    const steel = mat(0xb9c3cd, 0.6, 0.25)
    const dark = mat(0x374151, 0.6, 0.3)

    // Ground: the road with its dashed centre line, the concrete apron and the walkway from the hall's door.
    const asphalt = mat(0x3a3d43, 0.9)
    const roadW = road.maxX - road.minX
    const roadLen = road.maxZ - road.minZ
    this.decoYard(roadW, 0.03, roadLen, asphalt, (road.minX + road.maxX) / 2, 0.005, (road.minZ + road.maxZ) / 2)
    for (let z = road.maxZ - 1; z > road.minZ; z -= 3.6) this.decoYard(0.15, 0.012, 1.6, mat(0xf2d16b, 0.6), (road.minX + road.maxX) / 2, 0.025, z)
    const concrete = mat(0xb8b4ac, 0.95)
    this.decoYard(road.minX - maxX, 0.03, d + 1, concrete, (maxX + road.minX) / 2, 0.012, cz)
    this.decoYard(minX - SOUTH.maxX - 0.2, 0.03, 2, concrete, (SOUTH.maxX + 0.2 + minX) / 2, 0.012, door.z)

    // The building: floor, walls (west door, east shutter opening), roof.
    this.deco(w, 0.03, d, mat(0x8f949a, 0.85), cx, 0.016, cz)
    const wall = (width: number, depth: number, x: number, z: number, y0 = 0, y1 = H) => {
      if (width < 0.01 || depth < 0.01) return
      const h = y1 - y0
      this.solid(width, h, depth, steel, x, y0 + h / 2, z)
    }
    const south = minZ - T
    const north = maxZ + T
    wall(w + T * 2, T, cx, maxZ + T / 2)
    wall(w + T * 2, T, cx, minZ - T / 2)
    const dw = door.halfWidth + 0.1
    const dh = door.height + 0.2
    wall(T, door.z - dw - south, minX - T / 2, (south + door.z - dw) / 2)
    wall(T, north - (door.z + dw), minX - T / 2, (door.z + dw + north) / 2)
    wall(T, dw * 2, minX - T / 2, door.z, dh, H)
    wall(T, shutter.z - shutter.halfWidth - south, maxX + T / 2, (south + shutter.z - shutter.halfWidth) / 2)
    wall(T, north - (shutter.z + shutter.halfWidth), maxX + T / 2, (shutter.z + shutter.halfWidth + north) / 2)
    wall(T, shutter.halfWidth * 2, maxX + T / 2, shutter.z, shutter.height, H)
    this.deco(w + 0.8, 0.12, d + 0.8, mat(0x4b5563, 0.8), cx, H + 0.06, cz)
    this.deco(w + 0.42, 0.5, d + 0.42, mat(0x1d4ed8, 0.7), cx, H - 0.6, cz)
    this.deco(w + 0.38, 0.52, d + 0.38, steel, cx, H - 0.6, cz)

    this.shutter = new THREE.Mesh(new THREE.BoxGeometry(0.08, shutter.height, shutter.halfWidth * 2), mat(0x94a3b8, 0.5, 0.5))
    this.shutter.position.set(maxX - 0.02, shutter.height / 2, shutter.z)
    this.root.add(this.shutter)

    const panel = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff8e7, emissiveIntensity: 1.3 })
    for (const x of [cx - 2.4, cx + 2.4]) {
      for (const z of [cz - 3.6, cz + 3.6]) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.05, 0.5), panel)
        f.position.set(x, H - 0.05, z)
        this.root.add(f)
      }
    }

    // The two base pallet racks (24 slots).
    const { racks } = WAREHOUSE
    const length = racks.bays * racks.pitch
    for (const rx of racks.x) this.rackAlongZ(rx, racks.firstZ + racks.pitch / 2, length, racks.bays, racks.pitch)
    for (const level of racks.levels) {
      for (const rx of racks.x) for (let b = 0; b < racks.bays; b++) this.slots.shelves.push(this.slot(rx, level, racks.firstZ - b * racks.pitch))
    }
    // Rack rows that come with the upgrades: their slots exist from the start (hidden until the rows are built).
    for (const z of [ROW_NORTH_Z, ROW_SOUTH_Z]) {
      for (const level of racks.levels) for (const x of ROW_X) this.slots.shelves.push(this.slot(x, level, z))
    }
    // The other sections' slots (a grid of crates on the floor and on one shelf above it).
    this.gridSlots('cold', COLD, [16.9, 17.8, 18.7], [-14.1, -15.2])
    this.gridSlots('vault', VAULT, [17.3, 18.5], [-23.8, -25.0])
    this.gridSlots('hidden', HIDDEN, [10.35, 11.15], [-22.7, -23.4, -24.1, -24.8])

    const cardboard = mat(0xb08a5a, 0.85)
    const gold = mat(0xfbbf24, 0.5, 0.5)
    for (const section of ['shelves', 'cold', 'vault', 'hidden'] as const) {
      for (const slot of this.slots[section]) {
        const group = new THREE.Group()
        const box = new THREE.Mesh(new THREE.BoxGeometry(CRATE.w, CRATE.h, CRATE.d), cardboard)
        box.castShadow = true
        const band = new THREE.Mesh(new THREE.BoxGeometry(CRATE.w + 0.02, 0.08, CRATE.d + 0.02), gold)
        band.position.y = 0.1
        band.visible = false
        group.add(box, band)
        group.position.copy(slot)
        group.visible = false
        this.root.add(group)
        this.crates[section].push({ group, box, band })
      }
    }

    // Signs, the notice board, the receiving dock and desk.
    const outside = makeSign('WAREHOUSE', 3, 0.5, '#0f172a', '#fbbf24')
    outside.position.set(maxX + T + 0.03, H - 0.9, shutter.z)
    outside.rotation.y = Math.PI / 2
    this.root.add(outside)
    const doorSign = makeSign('WAREHOUSE', 1.6, 0.26, '#0f172a', '#fbbf24')
    doorSign.position.set(minX - T - 0.03, door.height + 0.5, door.z)
    doorSign.rotation.y = -Math.PI / 2
    this.root.add(doorSign)
    const canvas = this.board.canvas
    canvas.width = 768
    canvas.height = 384
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    this.board.texture = texture
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.4, 0.05), dark)
    frame.position.set(racks.x[1]! + 2.2, 2.3, maxZ - 0.04)
    this.root.add(frame)
    const face = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 1.25), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }))
    face.position.set(racks.x[1]! + 2.2, 2.3, maxZ - 0.07)
    face.rotation.y = Math.PI
    this.root.add(face)

    this.root.add(this.dock)
    this.buildDesk()
  }

  /** Start the "rising out of the ground" animation (a freshly built warehouse). */
  appear(): void {
    this.rise = 0
    this.root.scale.y = 0.001
  }

  dispose(): void {
    for (const body of this.bodies) this.physics.removeBody(body)
    this.bodies.length = 0
    this.board.texture?.dispose()
    this.desk.texture?.dispose()
  }

  update(dt: number, game: GameManager): void {
    if (this.rise < 1) {
      this.rise = Math.min(1, this.rise + dt / RISE_SECONDS)
      this.root.scale.y = Math.max(0.001, 1 - (1 - this.rise) ** 3)
    }
    this.syncUpgrades(game)
    this.syncCrates(game)
    this.syncDock(game)
    this.syncTruck(dt, game)
    this.syncPolice(game)
    this.drawBoard(game)
    this.drawDesk(game)
  }

  // ------------------------------------------------------------------ upgrades: rack rows and rooms appear when bought

  private syncUpgrades(game: GameManager): void {
    const wh = game.warehouse
    if (wh.has('wh-cap-1') && !this.built.has('north')) {
      this.built.add('north')
      this.rackAlongX(ROW_NORTH_Z, ROW_X[0]! - 0.45, ROW_X[3]! + 0.45)
    }
    if (wh.has('wh-cap-2') && !this.built.has('south')) {
      this.built.add('south')
      this.rackAlongX(ROW_SOUTH_Z, ROW_X[0]! - 0.45, ROW_X[3]! + 0.45)
    }
    if (wh.coldCapacity > 0 && !this.built.has('cold')) {
      this.built.add('cold')
      this.room(COLD, { side: 'west', at: -14.65, width: 1.1 }, 0xe0f2fe, 'COLD ROOM', '#38bdf8', 0xbae6fd, 1.4)
    }
    if (wh.vaultCapacity > 0 && !this.built.has('vault')) {
      this.built.add('vault')
      this.room(VAULT, { side: 'north', at: 17.9, width: 1.1 }, 0x475569, 'VAULT', '#fbbf24', 0x1e293b, 0.9)
    }
    if (wh.hiddenCapacity > 0 && !this.built.has('hidden')) {
      this.built.add('hidden')
      this.room(HIDDEN, { side: 'north', at: 10.8, width: 1.0 }, 0xa8a29e, 'STAFF ONLY', '#e2e8f0', 0x78716c, 0.7)
    }
  }

  /** The crates in each section: one per stored crate, coloured by what is really in them (with a gold band on a VIP's). */
  private syncCrates(game: GameManager): void {
    const wh = game.warehouse
    const signature = JSON.stringify(wh.consignments.map((c) => [c.section, c.cargo, c.crates, c.kind, c.spoiled])) + `|${wh.capacity}|${wh.coldCapacity}|${wh.vaultCapacity}|${wh.hiddenCapacity}`
    if (signature === this.crateSignature) return
    this.crateSignature = signature
    for (const section of ['shelves', 'cold', 'vault', 'hidden'] as const) {
      const flat = wh.consignments.filter((c) => c.section === section).flatMap((c) => Array.from({ length: c.crates }, () => c))
      const open = Math.min(wh.sectionCapacity(section), this.crates[section].length)
      this.crates[section].forEach((crate, i) => {
        const c = i < open ? flat[i] : undefined
        crate.group.visible = c !== undefined
        if (!c) return
        crate.band.visible = c.kind === 'vip'
        crate.box.material = mat(c.spoiled ? 0x57534e : CARGO_COLOUR[c.cargo], 0.8)
      })
    }
  }

  /** The loads waiting on the dock: a pallet each with its crates, coloured by what they LOOK like, and a label. */
  private syncDock(game: GameManager): void {
    const loads = game.receivingLoads()
    const signature = JSON.stringify(loads.map((l) => [l.id, l.crates, l.looksLike, l.spoiled, l.opening]))
    if (signature === this.dockSignature) return
    this.dockSignature = signature
    this.dock.clear()
    const wood = mat(0x8b6b45, 0.9)
    loads.slice(0, 3).forEach((load, i) => {
      const z = DOCK_Z[i]!
      this.dockMesh(new THREE.BoxGeometry(1.1, 0.12, 1.2), wood, DOCK_X, 0.06, z)
      const colour = load.spoiled ? 0x57534e : CARGO_COLOUR[load.looksLike]
      const stack = mat(colour, 0.8)
      for (let n = 0; n < Math.min(load.crates, 6); n++) {
        const col = n % 2
        const layer = Math.floor(n / 2)
        this.dockMesh(new THREE.BoxGeometry(0.5, 0.45, 0.5), stack, DOCK_X - 0.27 + col * 0.54, 0.12 + 0.225 + layer * 0.46, z)
      }
      const tag = makeSign(`${load.owner.split(' (')[0]} · ${load.crates}${load.opening ? ' · opening…' : ''}`, 1.2, 0.18, '#0f172a', load.opening ? '#f59e0b' : '#e2e8f0')
      tag.position.set(DOCK_X, 1.9, z)
      tag.rotation.y = -Math.PI / 2
      this.dock.add(tag)
    })
  }

  private dockMesh(geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number): void {
    const mesh = new THREE.Mesh(geo, material)
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    this.dock.add(mesh)
  }

  // ------------------------------------------------------------------ vehicles

  private syncTruck(dt: number, game: GameManager): void {
    const t = game.warehouse.truck
    const w = CONFIG.warehouse
    if (!t) {
      if (this.truck) {
        this.yard.remove(this.truck.group)
        this.truck = null
      }
      this.moveShutter(dt, false)
      return
    }
    if (!this.truck || this.truck.id !== t.id) {
      if (this.truck) this.yard.remove(this.truck.group)
      this.truck = this.buildTruck(t)
      this.yard.add(this.truck.group)
    }
    const bay = WAREHOUSE.bay.z
    let z = bay
    if (t.phase === 'arriving') z = START_Z + (bay - START_Z) * easeOut(t.t / w.arriveSeconds)
    else if (t.phase === 'leaving') z = bay + (END_Z - bay) * easeIn(t.t / w.leaveSeconds)
    this.truck.group.position.set(WAREHOUSE.bay.x, 0, z)

    const n = Math.min(t.crates, this.truck.crates.length)
    const progress = t.phase === 'unloading' ? t.t / w.unloadSeconds : t.phase === 'leaving' ? 1 : 0
    let shown = n
    if (t.job === 'deliver') shown = t.phase === 'arriving' ? n : t.phase === 'leaving' ? 0 : Math.ceil(n * (1 - progress))
    else shown = t.phase === 'arriving' ? 0 : t.phase === 'leaving' ? n : Math.floor(n * progress)
    if (shown !== this.truck.shown) {
      this.truck.shown = shown
      this.truck.crates.forEach((c, i) => (c.visible = i < shown))
    }
    this.moveShutter(dt, t.phase === 'unloading' || (t.phase === 'arriving' && t.t > w.arriveSeconds - 2) || (t.phase === 'leaving' && t.t < 1.5))
  }

  private moveShutter(dt: number, open: boolean): void {
    this.shutterOpen += ((open ? 1 : 0) - this.shutterOpen) * Math.min(1, dt * 3)
    this.shutter.position.y = WAREHOUSE.shutter.height / 2 + this.shutterOpen * WAREHOUSE.shutter.height * 0.97
  }

  /** A kei truck (small white flatbed) or a box truck (a VIP's, navy with a gold stripe), facing −z, with the owner's name over it. */
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
    const text = t.job === 'deliver' ? `${t.owner} · ${CONFIG.warehouse.cargo[t.declared].label.toLowerCase()}` : t.owner
    const tag = makeNameSprite(text)
    tag.position.set(0, t.kind === 'kei' ? 2.4 : 3.5, 0)
    group.add(tag)
    group.position.set(WAREHOUSE.bay.x, 0, START_Z)
    return { id: t.id, group, crates, shown: -1, kind: t.kind }
  }

  /** The police car: white and black with a flashing light bar, parked on the road by the north end of the shed while they look round. */
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
    let z = POLICE_PARK_Z
    if (visit.phase === 'arriving') z = START_Z + (POLICE_PARK_Z - START_Z) * easeOut(visit.t / p.arriveSeconds)
    else if (visit.phase === 'leaving') z = POLICE_PARK_Z + (END_Z - POLICE_PARK_Z) * easeIn(visit.t / p.leaveSeconds)
    this.police.group.position.set(POLICE_X, 0, z)
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
    // Faces −z, like the trucks.
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
        const w = add(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 14), tyre, x, 0.34, z)
        w.rotation.z = Math.PI / 2
      }
    }
    const tag = makeNameSprite('POLICE · inspection')
    tag.position.set(0, 2.3, 0)
    group.add(tag)
    return { group, lights: [red, blue] }
  }

  // ------------------------------------------------------------------ the notice board and the receiving desk

  private drawBoard(game: GameManager): void {
    const wh = game.warehouse
    const truck = wh.truck
    const status = truck ? `${truck.owner}: ${truck.job === 'deliver' ? 'delivering' : 'collecting'} ${truck.crates}` : 'Bay free'
    const signature = [wh.stored, wh.capacity, wh.coldCapacity, wh.vaultCapacity, wh.hiddenCapacity, status, wh.waiting, wh.earned, wh.collected, wh.fines, wh.receiving.length, wh.police?.phase ?? ''].join('|')
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
    ctx.fillText(`Dock: ${wh.receiving.length} waiting · Bay: ${status}`, 32, 176)
    ctx.fillText(`In the road: ${wh.waiting}${wh.police ? '   ·   POLICE HERE' : ''}`, 32, 220)
    ctx.fillStyle = '#94a3b8'
    ctx.fillText(`Collected: ${wh.collected} crates · $${wh.earned}   Fines: $${wh.fines}`, 32, 272)
    ctx.font = '600 24px system-ui, sans-serif'
    ctx.fillText('Process loads at the receiving desk. Not everything is what it says.', 32, 340)
  }

  /** The receiving desk: a pedestal with a screen facing north (you stand on the dock side), tagged so you can aim at it. */
  private buildDesk(): void {
    const x = 16.2
    const z = -21.7
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
    const tilt = new THREE.Group()
    tilt.position.set(x, 1.12, z + 0.04)
    tilt.rotation.x = -0.45
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
    sign.position.set(x, 1.6, z + 0.1)
    this.root.add(sign)
  }

  private drawDesk(game: GameManager): void {
    const wh = game.warehouse
    const loads = wh.receiving.length
    const signature = [loads, wh.autoLevel, wh.scanner].join('|')
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
    ctx.fillStyle = loads > 0 && wh.autoLevel === 0 ? '#f59e0b' : '#22c55e'
    ctx.font = '800 54px system-ui, sans-serif'
    ctx.fillText(`${loads} on the dock`, 28, 118)
    ctx.fillStyle = '#e2e8f0'
    ctx.font = '600 30px system-ui, sans-serif'
    ctx.fillText(wh.autoLevel > 0 ? `Robots level ${wh.autoLevel} on duty` : 'Manual: you decide', 28, 184)
    ctx.fillText(wh.scanner ? 'Scanner: contents shown' : 'No scanner: trust the label?', 28, 230)
    ctx.fillStyle = '#94a3b8'
    ctx.font = '600 26px system-ui, sans-serif'
    ctx.fillText('Press E to process loads', 28, 306)
  }

  // ------------------------------------------------------------------ building blocks

  private slot(x: number, level: number, z: number): THREE.Vector3 {
    return new THREE.Vector3(x, level + 0.03 + CRATE.h / 2, z)
  }

  /** Slots on the floor and on one shelf (0.9 m up) in a grid of columns (x) and rows (z). */
  private gridSlots(section: Section, _rect: Rect, xs: number[], zs: number[]): void {
    for (const level of [0.0, 0.92]) for (const x of xs) for (const z of zs) this.slots[section].push(this.slot(x, level, z))
  }

  /** A pallet rack running along z: posts, beams, boards and a collider. */
  private rackAlongZ(rx: number, northZ: number, length: number, bays: number, pitch: number): void {
    const { racks } = WAREHOUSE
    const post = mat(0x1d4ed8, 0.5, 0.3)
    const beam = mat(0xf59e0b, 0.5, 0.3)
    const board = mat(0x9ca3af, 0.7, 0.2)
    const zMid = northZ - length / 2
    for (let i = 0; i <= bays; i++) for (const dx of [-0.55, 0.55]) this.deco(0.08, 3.2, 0.08, post, rx + dx, 1.6, northZ - i * pitch)
    for (const level of racks.levels) {
      this.deco(1.2, 0.06, length, board, rx, level, zMid)
      for (const dx of [-0.55, 0.55]) this.deco(0.06, 0.12, length, beam, rx + dx, level - 0.05, zMid)
    }
    this.physicsBox(rx, 1.6, zMid, 0.62, 1.6, length / 2)
    this.blocker(rx, 1.6, zMid, 1.24, 3.2, length)
  }

  /** A pallet rack running along x (the extra rows along the north and south walls). */
  private rackAlongX(z: number, x0: number, x1: number): void {
    const { racks } = WAREHOUSE
    const post = mat(0x1d4ed8, 0.5, 0.3)
    const beam = mat(0xf59e0b, 0.5, 0.3)
    const board = mat(0x9ca3af, 0.7, 0.2)
    const len = x1 - x0
    const xMid = (x0 + x1) / 2
    for (let x = x0; x <= x1 + 0.01; x += 0.9) for (const dz of [-0.55, 0.55]) this.deco(0.08, 3.2, 0.08, post, x, 1.6, z + dz)
    for (const level of racks.levels) {
      this.deco(len, 0.06, 1.2, board, xMid, level, z)
      for (const dz of [-0.55, 0.55]) this.deco(len, 0.12, 0.06, beam, xMid, level - 0.05, z + dz)
    }
    this.physicsBox(xMid, 1.6, z, len / 2, 1.6, 0.62)
    this.blocker(xMid, 1.6, z, len, 3.2, 1.24)
  }

  /** A walled room in a corner (cold room, vault, hidden room): four walls with a doorway, a floor, a sign and a light. */
  private room(rect: Rect, door: { side: 'west' | 'north'; at: number; width: number }, wallColour: number, text: string, textColour: string, floorColour: number, glow: number): void {
    const { minX, maxX, minZ, maxZ } = rect
    const h = 2.9
    const wallMat = mat(wallColour, 0.7, 0.2)
    const cx = (minX + maxX) / 2
    const cz = (minZ + maxZ) / 2
    this.deco(maxX - minX, 0.04, maxZ - minZ, mat(floorColour, 0.8), cx, 0.04, cz)
    const wallZ = (z: number, from: number, to: number) => {
      if (to - from > 0.01) this.solid(to - from, h, T, wallMat, (from + to) / 2, h / 2, z)
    }
    const wallX = (x: number, from: number, to: number) => {
      if (to - from > 0.01) this.solid(T, h, to - from, wallMat, x, h / 2, (from + to) / 2)
    }
    // Wall on the north edge (z = maxZ), the south edge (z = minZ), the west edge (x = minX) and the east edge (x = maxX), with the doorway on one.
    const doorLo = door.at - door.width / 2
    const doorHi = door.at + door.width / 2
    if (door.side === 'north') {
      wallZ(maxZ, minX, doorLo)
      wallZ(maxZ, doorHi, maxX)
      this.solid(door.width, h - 2.2, T, wallMat, door.at, 2.2 + (h - 2.2) / 2, maxZ)
    } else wallZ(maxZ, minX, maxX)
    wallZ(minZ, minX, maxX)
    if (door.side === 'west') {
      wallX(minX, minZ, doorLo)
      wallX(minX, doorHi, maxZ)
      this.solid(T, h - 2.2, door.width, wallMat, minX, 2.2 + (h - 2.2) / 2, door.at)
    } else wallX(minX, minZ, maxZ)
    wallX(maxX, minZ, maxZ)
    this.deco(maxX - minX, 0.1, maxZ - minZ, wallMat, cx, h + 0.05, cz) // ceiling
    const light = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: textColour === '#38bdf8' ? 0x7dd3fc : 0xfff8e7, emissiveIntensity: glow })
    const fixture = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.05, 0.4), light)
    fixture.position.set(cx, h - 0.06, cz)
    this.root.add(fixture)
    const sign = makeSign(text, 1.4, 0.24, '#0f172a', textColour)
    if (door.side === 'north') {
      sign.position.set(door.at, 2.6, maxZ - 0.12)
      sign.position.z = maxZ + T / 2 + 0.03 // on the outside of the north wall, facing north (+z)
    } else {
      sign.position.set(minX - T / 2 - 0.03, 2.6, door.at)
      sign.rotation.y = -Math.PI / 2
    }
    this.root.add(sign)
  }

  private solid(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number): void {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
    mesh.position.set(x, y, z)
    mesh.receiveShadow = true
    mesh.castShadow = true
    markBlocker(mesh)
    this.root.add(mesh)
    this.physicsBox(x, y, z, w / 2, h / 2, d / 2)
  }

  private blocker(x: number, y: number, z: number, w: number, h: number, d: number): void {
    const blocker = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false }))
    blocker.position.set(x, y, z)
    markBlocker(blocker)
    this.root.add(blocker)
  }

  private physicsBox(x: number, y: number, z: number, hx: number, hy: number, hz: number): void {
    this.bodies.push(this.physics.addStaticBox(new THREE.Vector3(x, y, z), new THREE.Vector3(hx, hy, hz)))
  }

  private deco(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number): void {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
    mesh.position.set(x, y, z)
    mesh.receiveShadow = true
    this.root.add(mesh)
  }

  private decoYard(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number): void {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
    mesh.position.set(x, y, z)
    mesh.receiveShadow = true
    this.yard.add(mesh)
  }
}

/** The rack rows that come with the capacity upgrades: along the north and south walls. */
const ROW_NORTH_Z = -14.4
const ROW_SOUTH_Z = -25.0
const ROW_X = [12.55, 13.45, 14.35, 15.25]
/** The rooms (interior rectangles) in the corners of the shed. */
const COLD: Rect = { minX: 16.0, maxX: 19.4, minZ: -16.0, maxZ: -13.2 }
const VAULT: Rect = { minX: 16.5, maxX: 19.4, minZ: -25.8, maxZ: -22.6 }
const HIDDEN: Rect = { minX: 9.7, maxX: 11.6, minZ: -25.8, maxZ: -22.0 }
/** Where the loads on the dock stand (by the shutter), and the x of the pallets. */
const DOCK_X = 17.7
const DOCK_Z = [-16.6, -18.2, -19.8]

const easeOut = (x: number): number => 1 - (1 - Math.min(1, Math.max(0, x))) ** 2
const easeIn = (x: number): number => Math.min(1, Math.max(0, x)) ** 2

const nameTextures = new Map<string, THREE.CanvasTexture>()

/** A name on a dark pill that always faces the camera. */
function makeNameSprite(text: string): THREE.Sprite {
  let texture = nameTextures.get(text)
  if (!texture) {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 80
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.8)'
      ctx.beginPath()
      ctx.roundRect(4, 6, 504, 68, 26)
      ctx.fill()
      ctx.fillStyle = '#fbbf24'
      ctx.font = '700 36px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, 256, 42, 480)
    }
    texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    nameTextures.set(text, texture)
  }
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }))
  sprite.scale.set(2.6, 0.41, 1)
  return sprite
}
