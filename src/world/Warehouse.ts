import type RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import type { PhysicsWorld } from '../engine/PhysicsWorld'
import { CONFIG } from '../sim/config'
import type { GameManager } from '../sim/GameManager'
import type { Truck } from '../sim/WarehouseManager'
import { markBlocker } from './interactables'
import { SOUTH, WAREHOUSE } from './layout'
import { makeSign, mat } from './models'

const T = 0.2
/** Trucks come in from the main street and leave out of the far end of the road. */
const START_Z = 16
const END_Z = -56
const RISE_SECONDS = 1.4
const CRATE = { w: 0.8, h: 0.6, d: 0.9 }

type TruckView = { id: number; group: THREE.Group; crates: THREE.Mesh[]; shown: number; kind: Truck['kind'] }

/**
 * The warehouse extension: a walkway from the door in the south hall, a steel-clad shed with two pallet racks (24 crate slots), a roller
 * shutter and a notice board, and the service road with the trucks that drive in from the street, stop at the bay and drive out the far
 * end. Built when the warehouse upgrade is bought. It draws `game.warehouse` and decides nothing.
 *
 * `root` is the building (hidden when you are far away, like the halls); `yard` is the road and the trucks (always drawn, you can see the
 * trucks from the street).
 */
export class Warehouse {
  readonly root = new THREE.Group()
  readonly yard = new THREE.Group()
  private readonly bodies: RAPIER.RigidBody[] = []
  private readonly physics: PhysicsWorld
  private readonly crates: { group: THREE.Group; band: THREE.Mesh; box: THREE.Mesh }[] = []
  private readonly slots: THREE.Vector3[] = []
  private readonly shutter: THREE.Mesh
  private shutterOpen = 0
  private truck: TruckView | null = null
  private crateSignature = ''
  private readonly board = { canvas: document.createElement('canvas'), texture: null as THREE.CanvasTexture | null, signature: '' }
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
    // North and south walls.
    wall(w + T * 2, T, cx, maxZ + T / 2)
    wall(w + T * 2, T, cx, minZ - T / 2)
    // West wall with the door (a plain opening: this building only exists once the hall's door does).
    const dw = door.halfWidth + 0.1
    const dh = door.height + 0.2
    wall(T, door.z - dw - south, minX - T / 2, (south + door.z - dw) / 2)
    wall(T, north - (door.z + dw), minX - T / 2, (door.z + dw + north) / 2)
    wall(T, dw * 2, minX - T / 2, door.z, dh, H)
    // East wall with the roller-shutter opening.
    wall(T, shutter.z - shutter.halfWidth - south, maxX + T / 2, (south + shutter.z - shutter.halfWidth) / 2)
    wall(T, north - (shutter.z + shutter.halfWidth), maxX + T / 2, (shutter.z + shutter.halfWidth + north) / 2)
    wall(T, shutter.halfWidth * 2, maxX + T / 2, shutter.z, shutter.height, H)
    this.deco(w + 0.8, 0.12, d + 0.8, mat(0x4b5563, 0.8), cx, H + 0.06, cz)
    // A pale band round the outside, so it reads as a shed.
    this.deco(w + 0.42, 0.5, d + 0.42, mat(0x1d4ed8, 0.7), cx, H - 0.6, cz)
    this.deco(w + 0.38, 0.52, d + 0.38, steel, cx, H - 0.6, cz)

    // The shutter: a slatted panel that rolls up behind the lintel when a truck is at the bay.
    this.shutter = new THREE.Mesh(new THREE.BoxGeometry(0.08, shutter.height, shutter.halfWidth * 2), mat(0x94a3b8, 0.5, 0.5))
    this.shutter.position.set(maxX - 0.02, shutter.height / 2, shutter.z)
    this.root.add(this.shutter)

    // Lights.
    const panel = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff8e7, emissiveIntensity: 1.3 })
    for (const x of [cx - 2.4, cx + 2.4]) {
      for (const z of [cz - 3.6, cz + 3.6]) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.05, 0.5), panel)
        f.position.set(x, H - 0.05, z)
        this.root.add(f)
      }
    }

    // Two pallet racks: posts, beams and boards, and a collider each. The crates sit on the boards.
    const { racks } = WAREHOUSE
    const post = mat(0x1d4ed8, 0.5, 0.3)
    const beam = mat(0xf59e0b, 0.5, 0.3)
    const board = mat(0x9ca3af, 0.7, 0.2)
    const length = racks.bays * racks.pitch
    for (const rx of racks.x) {
      const z0 = racks.firstZ + racks.pitch / 2 // north end of the rack
      const zMid = z0 - length / 2
      for (let i = 0; i <= racks.bays; i++) {
        for (const dx of [-0.55, 0.55]) this.deco(0.08, 3.2, 0.08, post, rx + dx, 1.6, z0 - i * racks.pitch)
      }
      for (const level of racks.levels) {
        this.deco(1.2, 0.06, length, board, rx, level, zMid)
        for (const dx of [-0.55, 0.55]) this.deco(0.06, 0.12, length, beam, rx + dx, level - 0.05, zMid)
      }
      this.physicsBox(rx, 1.6, zMid, 0.62, 1.6, length / 2)
      const blocker = new THREE.Mesh(new THREE.BoxGeometry(1.24, 3.2, length), new THREE.MeshBasicMaterial({ visible: false }))
      blocker.position.set(rx, 1.6, zMid)
      markBlocker(blocker)
      this.root.add(blocker)
    }
    // Crate slots, filled bottom shelf first.
    for (const level of racks.levels) {
      for (const rx of racks.x) {
        for (let b = 0; b < racks.bays; b++) this.slots.push(new THREE.Vector3(rx, level + 0.03 + CRATE.h / 2, racks.firstZ - b * racks.pitch))
      }
    }
    const cardboard = mat(0xb08a5a, 0.85)
    const gold = mat(0xfbbf24, 0.5, 0.5)
    for (const slot of this.slots) {
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
      this.crates.push({ group, band, box })
    }

    // Signs and the notice board.
    const outside = makeSign('WAREHOUSE', 3, 0.5, '#0f172a', '#fbbf24')
    outside.position.set(maxX + T + 0.03, H - 0.9, shutter.z)
    outside.rotation.y = Math.PI / 2 // faces the road (+x)
    this.root.add(outside)
    const doorSign = makeSign('WAREHOUSE', 1.6, 0.26, '#0f172a', '#fbbf24')
    doorSign.position.set(minX - T - 0.03, door.height + 0.5, door.z)
    doorSign.rotation.y = -Math.PI / 2 // faces the walkway (−x)
    this.root.add(doorSign)
    const canvas = this.board.canvas
    canvas.width = 768
    canvas.height = 384
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    this.board.texture = texture
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.4, 0.05), dark)
    frame.position.set(racks.x[1]! + 2.2, 2.2, maxZ - 0.04)
    this.root.add(frame)
    const face = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 1.25), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }))
    face.position.set(racks.x[1]! + 2.2, 2.2, maxZ - 0.07)
    face.rotation.y = Math.PI // faces −z, into the shed
    this.root.add(face)
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
  }

  update(dt: number, game: GameManager): void {
    if (this.rise < 1) {
      this.rise = Math.min(1, this.rise + dt / RISE_SECONDS)
      this.root.scale.y = Math.max(0.001, 1 - (1 - this.rise) ** 3)
    }
    this.syncCrates(game)
    this.syncTruck(dt, game)
    this.drawBoard(game)
  }

  /** The crates on the racks: one per stored crate, brown for a trucker's, navy with a gold band for a VIP's. */
  private syncCrates(game: GameManager): void {
    const kinds = game.warehouse.consignments.flatMap((c) => Array.from({ length: c.crates }, () => c.kind))
    const signature = kinds.join(',')
    if (signature === this.crateSignature) return
    this.crateSignature = signature
    const cardboard = mat(0xb08a5a, 0.85)
    const navy = mat(0x1e3a8a, 0.7)
    this.crates.forEach((crate, i) => {
      const kind = kinds[i]
      crate.group.visible = kind !== undefined
      crate.band.visible = kind === 'vip'
      crate.box.material = kind === 'vip' ? navy : cardboard
    })
  }

  // ------------------------------------------------------------------ trucks

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

    // The crates on a kei truck's bed: a delivery unloads them one by one, a collection loads them.
    const n = Math.min(t.crates, this.truck.crates.length)
    const progress = t.phase === 'unloading' ? t.t / w.unloadSeconds : t.phase === 'leaving' ? 1 : 0
    let shown = n
    if (t.job === 'deliver') shown = t.phase === 'arriving' || t.rejected ? n : t.phase === 'leaving' ? 0 : Math.ceil(n * (1 - progress))
    else shown = t.phase === 'arriving' ? 0 : t.phase === 'leaving' ? n : Math.floor(n * progress)
    if (shown !== this.truck.shown) {
      this.truck.shown = shown
      this.truck.crates.forEach((c, i) => (c.visible = i < shown))
    }
    // The shutter is open while a truck is working at the bay.
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
      const cardboard = mat(0xb08a5a, 0.85)
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
    const tag = makeNameSprite(t.owner)
    tag.position.set(0, t.kind === 'kei' ? 2.4 : 3.5, 0)
    group.add(tag)
    group.position.set(WAREHOUSE.bay.x, 0, START_Z)
    return { id: t.id, group, crates, shown: -1, kind: t.kind }
  }

  // ------------------------------------------------------------------ the board

  private drawBoard(game: GameManager): void {
    const wh = game.warehouse
    const truck = wh.truck
    const status = truck ? `${truck.owner}: ${truck.job === 'deliver' ? 'delivering' : 'collecting'} ${truck.crates}` : 'Bay free'
    const signature = [wh.stored, wh.capacity, status, wh.waiting, wh.earned, wh.collected].join('|')
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
    ctx.font = '800 46px system-ui, sans-serif'
    ctx.fillText('WAREHOUSE', 32, 50)
    ctx.fillStyle = wh.stored >= wh.capacity ? '#ef4444' : '#22c55e'
    ctx.font = '800 64px system-ui, sans-serif'
    ctx.fillText(`${wh.stored} / ${wh.capacity} crates`, 32, 128)
    ctx.fillStyle = '#e2e8f0'
    ctx.font = '600 32px system-ui, sans-serif'
    ctx.fillText(`Bay: ${status}`, 32, 200)
    ctx.fillText(`Waiting in the road: ${wh.waiting}`, 32, 246)
    ctx.fillStyle = '#94a3b8'
    ctx.fillText(`Collected so far: ${wh.collected} crates · $${wh.earned}`, 32, 300)
    ctx.font = '600 24px system-ui, sans-serif'
    ctx.fillText('A load that does not fit is turned away.', 32, 350)
  }

  // ------------------------------------------------------------------ helpers

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
      ctx.font = '700 38px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, 256, 42, 480)
    }
    texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    nameTextures.set(text, texture)
  }
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }))
  sprite.scale.set(2.4, 0.375, 1)
  return sprite
}
