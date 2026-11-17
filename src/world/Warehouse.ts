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
/** Trucks come in from the main street and leave by the far end of the road. */
const START_Z = 16
const RISE_SECONDS = 1.4
const CRATE = { w: 0.8, h: 0.6, d: 0.8 }
const POLICE = { x: 35.4, z: -11.5 }
/** The shutter opens when you are this close to it. */
const SHUTTER_REACH = 5

/** The look of each kind of crate (what it looks like: on a truck before you know, or what it really is once stored). */
const CARGO_COLOUR: Record<CargoType, number> = { general: 0xb08a5a, food: 0x84cc16, cold: 0x38bdf8, metals: 0x94a3b8, illegal: 0x111827 }
const SECTIONS: readonly Section[] = ['shelves', 'cold', 'vault', 'hidden']

type TruckView = { id: number; group: THREE.Group; crates: THREE.Mesh[]; shown: number; label: string; tag: THREE.Sprite | null }
type CrateView = { group: THREE.Group; box: THREE.Mesh; band: THREE.Mesh }
type Rect = { minX: number; maxX: number; minZ: number; maxZ: number }

/**
 * The warehouse extension: a walkway from the door in the south hall, a big steel-clad shed with pallet racks, a roller shutter on the east
 * side, three parking spots outside it where trucks wait while their crates are carried, the service road, a receiving desk, and (when bought)
 * extra rack rows, a cold room, a vault and a hidden room, each with its own racks. Now and then a police car. It draws `game.warehouse` and
 * decides nothing.
 *
 * `root` is the building (hidden when you are far away, like the halls); `yard` is the road, the parking and the vehicles (always drawn).
 */
export class Warehouse {
  readonly root = new THREE.Group()
  readonly yard = new THREE.Group()
  private readonly bodies: RAPIER.RigidBody[] = []
  private readonly physics: PhysicsWorld
  /** Crate slots per section (in the order they fill), and the crate views on them. */
  private readonly slots: Record<Section, THREE.Vector3[]> = { shelves: [], cold: [], vault: [], hidden: [] }
  private readonly crates: Record<Section, CrateView[]> = { shelves: [], cold: [], vault: [], hidden: [] }
  private readonly shutter: THREE.Mesh
  private shutterOpen = 0
  private readonly trucks = new Map<number, TruckView>()
  private readonly built = new Set<string>()
  private crateSignature = ''
  private police: { group: THREE.Group; lights: THREE.MeshBasicMaterial[] } | null = null
  private policeShown = false
  private readonly board = { canvas: document.createElement('canvas'), texture: null as THREE.CanvasTexture | null, signature: '' }
  private readonly desk = { canvas: document.createElement('canvas'), texture: null as THREE.CanvasTexture | null, signature: '' }
  private rise = 1

  constructor(physics: PhysicsWorld) {
    this.physics = physics
    this.root.userData.zone = 'warehouse'
    const { minX, maxX, minZ, maxZ, height: H, door, shutter, road, parking } = WAREHOUSE
    const w = maxX - minX
    const d = maxZ - minZ
    const cx = (minX + maxX) / 2
    const cz = (minZ + maxZ) / 2
    // Inside, the roof shades everything from the sun, so the shed's own surfaces glow a little (no extra lights: see AGENTS.md, zones).
    const steel = lit(0xb9c3cd, 0.6, 0.25)
    const dark = mat(0x374151, 0.6, 0.3)

    // Outside: the road with its centre line, the concrete apron with the parking spots, and the walkway from the hall's door.
    const asphalt = mat(0x3a3d43, 0.9)
    this.decoYard(road.maxX - road.minX, 0.03, road.maxZ - road.minZ, asphalt, (road.minX + road.maxX) / 2, 0.005, (road.minZ + road.maxZ) / 2)
    for (let z = road.maxZ - 1; z > road.minZ; z -= 3.6) this.decoYard(0.15, 0.012, 1.6, mat(0xf2d16b, 0.6), (road.minX + road.maxX) / 2, 0.025, z)
    const concrete = mat(0xb8b4ac, 0.95)
    this.decoYard(road.minX - maxX - T, 0.03, d + 4, concrete, (maxX + T + road.minX) / 2, 0.012, cz)
    this.decoYard(minX - SOUTH.maxX - 0.2, 0.03, 2.4, concrete, (SOUTH.maxX + 0.2 + minX) / 2, 0.012, door.z)
    const paint = mat(0xf8fafc, 0.6)
    for (const z of parking.z) {
      for (const dz of [-3.3, 3.3]) this.decoYard(3.6, 0.012, 0.1, paint, parking.x, 0.03, z + dz)
      const spot = makeSign('PARKING', 1.4, 0.24, '#0f172a', '#e2e8f0')
      spot.position.set(parking.x + 2.3, 0.02, z)
      spot.rotation.x = -Math.PI / 2
      spot.rotation.z = Math.PI / 2
      this.yard.add(spot)
    }

    // The building: floor, walls (a door in the west wall, the shutter opening in the east wall), roof.
    this.deco(w, 0.03, d, lit(0x8f949a, 0.85, 0, 0.3), cx, 0.016, cz)
    // A light ceiling under the roof.
    this.deco(w, 0.02, d, lit(0xe5e7eb, 0.9, 0, 0.45), cx, H - 0.02, cz).receiveShadow = false
    const wall = (width: number, depth: number, x: number, z: number, y0 = 0, y1 = H) => {
      if (width < 0.01 || depth < 0.01) return
      this.solid(width, y1 - y0, depth, steel, x, (y0 + y1) / 2, z)
    }
    const south = minZ - T
    const north = maxZ + T
    wall(w + T * 2, T, cx, maxZ + T / 2)
    wall(w + T * 2, T, cx, minZ - T / 2)
    const dw = door.halfWidth + 0.2
    const dh = door.height + 0.3
    wall(T, door.z - dw - south, minX - T / 2, (south + door.z - dw) / 2)
    wall(T, north - (door.z + dw), minX - T / 2, (door.z + dw + north) / 2)
    wall(T, dw * 2, minX - T / 2, door.z, dh, H)
    wall(T, shutter.z - shutter.halfWidth - south, maxX + T / 2, (south + shutter.z - shutter.halfWidth) / 2)
    wall(T, north - (shutter.z + shutter.halfWidth), maxX + T / 2, (shutter.z + shutter.halfWidth + north) / 2)
    wall(T, shutter.halfWidth * 2, maxX + T / 2, shutter.z, shutter.height, H)
    // The roof casts a shadow, so the sun does not shine in through it (the shadow box follows the player in here too).
    this.deco(w + 0.8, 0.12, d + 0.8, mat(0x4b5563, 0.8), cx, H + 0.06, cz).castShadow = true
    // The blue stripe around the top of the outside walls (four thin strips, so it is not a false ceiling inside).
    const stripe = mat(0x1d4ed8, 0.7)
    const sy = H - 0.6
    this.deco(w + 0.42, 0.5, 0.01, stripe, cx, sy, maxZ + T + 0.01)
    this.deco(w + 0.42, 0.5, 0.01, stripe, cx, sy, minZ - T - 0.01)
    this.deco(0.01, 0.5, d + 0.42, stripe, minX - T - 0.01, sy, cz)
    this.deco(0.01, 0.5, d + 0.42, stripe, maxX + T + 0.01, sy, cz)

    this.shutter = new THREE.Mesh(new THREE.BoxGeometry(0.08, shutter.height, shutter.halfWidth * 2), mat(0x94a3b8, 0.5, 0.5))
    this.shutter.position.set(maxX - 0.02, shutter.height / 2, shutter.z)
    this.root.add(this.shutter)
    this.shutterBody = this.physics.addStaticBox(new THREE.Vector3(maxX + T / 2, shutter.height / 2, shutter.z), new THREE.Vector3(T / 2, shutter.height / 2, shutter.halfWidth))

    // Lights: two rows of panels along the shed.
    const panel = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff8e7, emissiveIntensity: 1.3 })
    for (const x of [cx - 3.6, cx, cx + 3.6]) {
      for (const z of [cz - 5, cz, cz + 5]) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.05, 0.5), panel)
        f.position.set(x, H - 0.05, z)
        this.root.add(f)
      }
    }

    // The two base racks (24 slots). The other racks' slots exist from the start; the racks themselves appear when bought.
    const { racks, rows } = WAREHOUSE
    for (const rx of racks.x) this.slots.shelves.push(...this.rackAlongZ(rx, racks.northZ, racks.bays, racks.pitch, racks.levels, 'shelves'))
    this.slots.shelves.push(...this.rowSlots(rows.northZ), ...this.rowSlots(rows.southZ))
    this.slots.cold.push(...this.rowSlotsAt(WAREHOUSE.cold.maxZ - 0.75, WAREHOUSE.cold.minX + 0.4, 4, 0.9, racks.levels))
    this.slots.vault.push(...this.rowSlotsAt(WAREHOUSE.vault.minZ + 0.75, WAREHOUSE.vault.minX + 0.4, 4, 0.9, racks.levels.slice(0, 2)))
    this.slots.hidden.push(...this.zSlotsAt(WAREHOUSE.hidden.minX + 0.75, WAREHOUSE.hidden.minZ + 0.6, 4, 0.9, racks.levels))
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
        group.position.copy(slot)
        group.visible = false
        this.root.add(group)
        this.crates[section].push({ group, box, band })
      }
    }

    // Signs, the notice board and the receiving desk.
    const outside = makeSign('WAREHOUSE', 3.4, 0.56, '#0f172a', '#fbbf24')
    outside.position.set(maxX + T + 0.03, H - 0.9, shutter.z)
    outside.rotation.y = Math.PI / 2
    this.root.add(outside)
    const doorSign = makeSign('WAREHOUSE', 1.6, 0.26, '#0f172a', '#fbbf24')
    doorSign.position.set(minX - T - 0.03, door.height + 0.6, door.z)
    doorSign.rotation.y = -Math.PI / 2
    this.root.add(doorSign)
    const canvas = this.board.canvas
    canvas.width = 768
    canvas.height = 384
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    this.board.texture = texture
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.5, 0.05), dark)
    frame.position.set(15.2, 3.4, maxZ - 0.04)
    this.root.add(frame)
    const face = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 1.35), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }))
    face.position.set(15.2, 3.4, maxZ - 0.07)
    face.rotation.y = Math.PI
    this.root.add(face)
    this.buildDesk()
  }

  private shutterBody: RAPIER.RigidBody
  private shutterSolid = true

  appear(): void {
    this.rise = 0
    this.root.scale.y = 0.001
  }

  dispose(): void {
    for (const body of this.bodies) this.physics.removeBody(body)
    this.bodies.length = 0
    if (this.shutterSolid) this.physics.removeBody(this.shutterBody)
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
    this.syncPolice(game)
    // The shutter rolls up when you walk towards it (or the robots are working a truck), so you can carry crates through.
    const near = Math.hypot(player.x - WAREHOUSE.maxX, player.z - WAREHOUSE.shutter.z) < SHUTTER_REACH && player.y < 2.5
    const robots = game.warehouse.autoLevel > 0 && game.warehouse.trucks.some((t) => t.phase === 'parked')
    this.moveShutter(dt, near || robots)
    this.drawBoard(game)
    this.drawDesk(game)
  }

  // ------------------------------------------------------------------ upgrades: racks and rooms appear when bought

  private syncUpgrades(game: GameManager): void {
    const wh = game.warehouse
    const { rows, racks } = WAREHOUSE
    if (wh.has('wh-cap-1') && !this.built.has('north')) {
      this.built.add('north')
      this.rackAlongX(rows.northZ, rows.x0, rows.bays, rows.pitch, racks.levels, 'shelves')
    }
    if (wh.has('wh-cap-2') && !this.built.has('south')) {
      this.built.add('south')
      this.rackAlongX(rows.southZ, rows.x0, rows.bays, rows.pitch, racks.levels, 'shelves')
    }
    if (wh.coldCapacity > 0 && !this.built.has('cold')) {
      this.built.add('cold')
      const r = WAREHOUSE.cold
      this.room(r, { side: 'west', at: -15.6, width: 1.4 }, 0xe0f2fe, 'COLD ROOM', '#38bdf8', 0xbae6fd, 'cold')
      this.rackAlongX(r.maxZ - 0.75, r.minX + 0.4, 4, 0.9, racks.levels, 'cold')
    }
    if (wh.vaultCapacity > 0 && !this.built.has('vault')) {
      this.built.add('vault')
      const r = WAREHOUSE.vault
      this.room(r, { side: 'north', at: 20.8, width: 1.4 }, 0x475569, 'VAULT', '#fbbf24', 0x1e293b, 'vault')
      this.rackAlongX(r.minZ + 0.75, r.minX + 0.4, 4, 0.9, racks.levels.slice(0, 2), 'vault')
    }
    if (wh.hiddenCapacity > 0 && !this.built.has('hidden')) {
      this.built.add('hidden')
      const r = WAREHOUSE.hidden
      this.room(r, { side: 'north', at: 11.9, width: 1.2 }, 0xa8a29e, 'STAFF ONLY', '#e2e8f0', 0x78716c, 'hidden')
      this.rackAlongZ(r.minX + 0.75, r.minZ + 0.6 + 4 * 0.9, 4, 0.9, racks.levels, 'hidden')
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

  // ------------------------------------------------------------------ vehicles

  /** One view per truck: it drives down the road, pulls into its parking spot, waits, and pulls out and drives off. */
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
      const spotZ = WAREHOUSE.parking.z[t.spot] ?? WAREHOUSE.parking.z[0]!
      const lane = WAREHOUSE.road.laneX
      const park = WAREHOUSE.parking.x
      let x = park
      let z = spotZ
      if (t.phase === 'arriving') {
        const p = Math.min(1, t.t / w.arriveSeconds)
        // Down the road, then in sideways to the spot.
        if (p < 0.7) {
          x = lane
          z = START_Z + (spotZ - START_Z) * easeOut(p / 0.7)
        } else {
          x = lane + (park - lane) * easeOut((p - 0.7) / 0.3)
        }
      } else if (t.phase === 'leaving') {
        const p = Math.min(1, t.t / w.leaveSeconds)
        if (p < 0.3) x = park + (lane - park) * easeIn(p / 0.3)
        else {
          x = lane
          z = spotZ + (WAREHOUSE.road.minZ - spotZ) * easeIn((p - 0.3) / 0.7)
        }
      }
      view.group.position.set(x, 0, z)
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

  private truckLabel(game: GameManager, t: Truck): string {
    const name = t.owner.split(' (')[0]
    if (t.job === 'collect') return `${name} · collecting · ${t.onBoard} loaded`
    const load = game.warehouse.loadOf(t)
    const looks = load ? game.warehouse.visibleCargo(load) : t.declared
    return `${name} · ${CONFIG.warehouse.cargo[looks].label.toLowerCase()} · ${t.onBoard} on board`
  }

  private moveShutter(dt: number, open: boolean): void {
    this.shutterOpen += ((open ? 1 : 0) - this.shutterOpen) * Math.min(1, dt * 3)
    this.shutter.position.y = WAREHOUSE.shutter.height / 2 + this.shutterOpen * WAREHOUSE.shutter.height * 0.97
    // You can walk through once it is mostly up.
    const solid = this.shutterOpen < 0.6
    if (solid !== this.shutterSolid) {
      this.shutterSolid = solid
      if (solid) {
        const { shutter, maxX } = WAREHOUSE
        this.shutterBody = this.physics.addStaticBox(
          new THREE.Vector3(maxX + T / 2, shutter.height / 2, shutter.z),
          new THREE.Vector3(T / 2, shutter.height / 2, shutter.halfWidth),
        )
      } else {
        this.physics.removeBody(this.shutterBody)
      }
    }
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
    group.position.set(WAREHOUSE.road.laneX, 0, START_Z)
    return { id: t.id, group, crates, shown: -1, label: '', tag: null }
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
    let z = POLICE.z
    if (visit.phase === 'arriving') z = START_Z + (POLICE.z - START_Z) * easeOut(visit.t / p.arriveSeconds)
    else if (visit.phase === 'leaving') z = POLICE.z + (WAREHOUSE.road.minZ - POLICE.z) * easeIn(visit.t / p.leaveSeconds)
    this.police.group.position.set(POLICE.x, 0, z)
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

  // ------------------------------------------------------------------ the notice board and the receiving desk

  private drawBoard(game: GameManager): void {
    const wh = game.warehouse
    const parked = wh.trucks.filter((t) => t.phase === 'parked').length
    const signature = [wh.stored, wh.capacity, wh.coldCapacity, wh.vaultCapacity, wh.hiddenCapacity, parked, wh.waiting, wh.earned, wh.collected, wh.fines, wh.police?.phase ?? ''].join('|')
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
    ctx.fillText(`Trucks parked: ${parked} · waiting in the road: ${wh.waiting}`, 32, 176)
    ctx.fillText(wh.police ? 'POLICE HERE' : wh.autoLevel > 0 ? `Robots level ${wh.autoLevel} carry the crates` : 'You carry the crates (E on a truck)', 32, 220)
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
    const loads = wh.loads.length
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
    ctx.fillStyle = loads > 0 ? '#f59e0b' : '#22c55e'
    ctx.font = '800 50px system-ui, sans-serif'
    ctx.fillText(`${loads} load${loads === 1 ? '' : 's'} parked`, 28, 116)
    ctx.fillStyle = '#e2e8f0'
    ctx.font = '600 30px system-ui, sans-serif'
    ctx.fillText(wh.scanner ? 'Scanner: contents shown' : 'Open a crate to be sure', 28, 184)
    ctx.fillText(wh.autoLevel > 0 ? `Robots level ${wh.autoLevel} on duty` : 'Refuse a load you do not want', 28, 230)
    ctx.fillStyle = '#94a3b8'
    ctx.font = '600 26px system-ui, sans-serif'
    ctx.fillText('Press E for the loads', 28, 306)
  }

  // ------------------------------------------------------------------ building blocks

  private slot(x: number, level: number, z: number): THREE.Vector3 {
    return new THREE.Vector3(x, level + 0.03 + CRATE.h / 2, z)
  }

  /** Slots of a rack row along x (crates in the middle of each bay). */
  private rowSlotsAt(z: number, x0: number, bays: number, pitch: number, levels: readonly number[]): THREE.Vector3[] {
    const out: THREE.Vector3[] = []
    for (const level of levels) for (let b = 0; b < bays; b++) out.push(this.slot(x0 + pitch * (b + 0.5), level, z))
    return out
  }

  private rowSlots(z: number): THREE.Vector3[] {
    const { rows, racks } = WAREHOUSE
    return this.rowSlotsAt(z, rows.x0, rows.bays, rows.pitch, racks.levels)
  }

  /** Slots of a rack along z (the hidden room's), from the south end. */
  private zSlotsAt(x: number, z0: number, bays: number, pitch: number, levels: readonly number[]): THREE.Vector3[] {
    const out: THREE.Vector3[] = []
    for (const level of levels) for (let b = 0; b < bays; b++) out.push(this.slot(x, level, z0 + pitch * (b + 0.5)))
    return out
  }

  /**
   * A pallet rack running along z, from `northZ` southwards: posts, beams, boards, a collider, and an invisible box tagged with its section
   * (aim at the rack to store a crate on it, or to take one for a collection). Returns its slots (base racks only use them).
   */
  private rackAlongZ(rx: number, northZ: number, bays: number, pitch: number, levels: readonly number[], section: Section): THREE.Vector3[] {
    const post = mat(0x1d4ed8, 0.5, 0.3)
    const beam = mat(0xf59e0b, 0.5, 0.3)
    const board = mat(0x9ca3af, 0.7, 0.2)
    const length = bays * pitch
    const zMid = northZ - length / 2
    const top = levels[levels.length - 1]! + 1.0
    for (let i = 0; i <= bays; i++) for (const dx of [-0.52, 0.52]) this.deco(0.08, top, 0.08, post, rx + dx, top / 2, northZ - i * pitch)
    for (const level of levels) {
      this.deco(1.12, 0.05, length, board, rx, level, zMid)
      for (const dx of [-0.52, 0.52]) this.deco(0.05, 0.1, length, beam, rx + dx, level - 0.08, zMid)
    }
    this.physicsBox(rx, top / 2, zMid, 0.58, top / 2, length / 2)
    this.sectionProxy(section, rx, top / 2, zMid, 1.3, top, length + 0.1)
    const out: THREE.Vector3[] = []
    for (const level of levels) for (let b = 0; b < bays; b++) out.push(this.slot(rx, level, northZ - pitch * (b + 0.5)))
    return out
  }

  /** A pallet rack running along x, from `x0` eastwards (the extra rows and the racks in the rooms). */
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
    this.sectionProxy(section, xMid, top / 2, z, len + 0.1, top, 1.3)
  }

  private sectionProxy(section: Section, x: number, y: number, z: number, w: number, h: number, d: number): void {
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false }))
    proxy.position.set(x, y, z)
    tag(proxy, { kind: 'section', section })
    this.root.add(proxy)
  }

  /** A walled room (cold room, vault, hidden room): walls with a wide doorway, a floor, a ceiling, a sign and a light. */
  private room(rect: Rect, door: { side: 'west' | 'north'; at: number; width: number }, wallColour: number, text: string, textColour: string, floorColour: number, section: Section): void {
    const { minX, maxX, minZ, maxZ } = rect
    const h = 3.4
    const wallMat = lit(wallColour, 0.7, 0.2)
    const cx = (minX + maxX) / 2
    const cz = (minZ + maxZ) / 2
    this.deco(maxX - minX, 0.02, maxZ - minZ, lit(floorColour, 0.8, 0, 0.25), cx, 0.045, cz)
    const wallZ = (z: number, from: number, to: number) => {
      if (to - from > 0.01) this.solid(to - from, h, T, wallMat, (from + to) / 2, h / 2, z)
    }
    const wallX = (x: number, from: number, to: number) => {
      if (to - from > 0.01) this.solid(T, h, to - from, wallMat, x, h / 2, (from + to) / 2)
    }
    const lo = door.at - door.width / 2
    const hi = door.at + door.width / 2
    const doorH = 2.4
    // Only the sides that face the inside of the shed are built (the others are the shed's own walls).
    const onNorth = maxZ >= WAREHOUSE.maxZ - 0.3
    const onSouth = minZ <= WAREHOUSE.minZ + 0.3
    const onWest = minX <= WAREHOUSE.minX + 0.3
    const onEast = maxX >= WAREHOUSE.maxX - 0.3
    if (!onNorth) {
      if (door.side === 'north') {
        wallZ(maxZ + T / 2, minX - T, lo)
        wallZ(maxZ + T / 2, hi, maxX + (onEast ? 0 : T))
        this.solid(door.width, h - doorH, T, wallMat, door.at, doorH + (h - doorH) / 2, maxZ + T / 2)
      } else wallZ(maxZ + T / 2, minX - T, maxX + (onEast ? 0 : T))
    }
    if (!onSouth) wallZ(minZ - T / 2, minX - T, maxX + (onEast ? 0 : T))
    if (!onWest) {
      if (door.side === 'west') {
        wallX(minX - T / 2, minZ, lo)
        wallX(minX - T / 2, hi, maxZ)
        this.solid(T, h - doorH, door.width, wallMat, minX - T / 2, doorH + (h - doorH) / 2, door.at)
      } else wallX(minX - T / 2, minZ, maxZ)
    }
    if (!onEast) wallX(maxX + T / 2, minZ, maxZ)
    this.deco(maxX - minX + T, 0.1, maxZ - minZ + T, wallMat, cx, h + 0.05, cz).castShadow = true // ceiling
    const light = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: section === 'cold' ? 0x7dd3fc : 0xfff8e7, emissiveIntensity: section === 'cold' ? 1.5 : 1.1 })
    const fixture = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.05, 0.4), light)
    fixture.position.set(cx, h - 0.04, cz)
    this.root.add(fixture)
    const sign = makeSign(text, 1.4, 0.24, '#0f172a', textColour)
    if (door.side === 'north') sign.position.set(door.at, doorH + 0.35, maxZ + T + 0.03)
    else {
      sign.position.set(minX - T - 0.03, doorH + 0.35, door.at)
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

  private physicsBox(x: number, y: number, z: number, hx: number, hy: number, hz: number): void {
    this.bodies.push(this.physics.addStaticBox(new THREE.Vector3(x, y, z), new THREE.Vector3(hx, hy, hz)))
  }

  private deco(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
    mesh.position.set(x, y, z)
    mesh.receiveShadow = true
    this.root.add(mesh)
    return mesh
  }

  private decoYard(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number): void {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
    mesh.position.set(x, y, z)
    mesh.receiveShadow = true
    this.yard.add(mesh)
  }
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
