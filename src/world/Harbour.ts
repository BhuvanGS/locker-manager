import type RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { kenney } from './kenney'
import type { PhysicsWorld } from '../engine/PhysicsWorld'
import { CONFIG } from '../sim/config'
import type { GameManager } from '../sim/GameManager'
import type { BoatKind, BoatVisit, HarbourManager, ShipVisit } from '../sim/HarbourManager'
import { HARBOUR, LAKE } from './layout'
import { makeSign, mat } from './models'
import { rounded, type Leg, type Pose } from './paths'
import { armYellow, concreteFloor, metreUVs, paintedSteel, roadAsphalt, roofGravel, shedCladding, shedRoof, waterMat, woodMat } from './textures'

const H = HARBOUR
const J = H.jetty
const B = H.basin
const CH = LAKE.coast.channel
/** Where boats and ships appear and vanish, far out at sea. */
const SEA_X = -175
const LAKE_Y = -LAKE.waterDrop
const BASIN_Y = LAKE.coast.seaY
const BOX = { l: 5.0, h: 1.25, w: 2.05 }
const COLOURS = [0xb91c1c, 0x1d4ed8, 0x15803d, 0xc2410c, 0x6b7280, 0x0e7490, 0xa16207, 0x7c3aed, 0x0f766e, 0xbe185d]
/** The crane's boom height and the spreader's travel height (clear of the stacks on deck). */
const BOOM_Y = 9.5
const CLEAR_Y = 6.2

type CraneGeo = (typeof H.crane)['lake'] | (typeof H.crane)['basin']

const smooth = (u: number): number => {
  const c = Math.min(1, Math.max(0, u))
  return c * c * (3 - 2 * c)
}
/** 0…1 across [a, b] of `u`, smoothed. */
const span = (u: number, a: number, b: number): number => smooth((u - a) / (b - a))

/** Where each container sits on a ship of `size` (ship coordinates: x along it, bow +x; y up from the waterline). */
interface Slot {
  x: number
  y: number
  z: number
  tier: number
  col: number
}
const COLS = [2, 3, 4] as const
const ROWS = [2, 2, 3] as const

function shipSlots(size: number): Slot[] {
  const def = CONFIG.harbour.ships[size]!
  const cols = COLS[size] ?? 2
  const rows = ROWS[size] ?? 2
  const out: Slot[] = []
  for (let tier = 0; tier < 2; tier++)
    for (let c = 0; c < cols; c++)
      for (let r = 0; r < rows; r++) {
        if (out.length >= def.containers) break
        out.push({ x: 0.35 + (c - (cols - 1) / 2) * 5.3, y: 1.6 + BOX.h / 2 + tier * 1.3, z: (r - (rows - 1) / 2) * 2.15, tier, col: c })
      }
  return out
}

/** The order the crane(s) lift them: top tier first; with two cranes the west one takes the western columns, the east one the rest. */
function unloadOrder(size: number, cranes: number): number[] {
  const slots = shipSlots(size)
  const cols = COLS[size] ?? 2
  const by = (a: number, b: number) => slots[b]!.tier - slots[a]!.tier || slots[a]!.col - slots[b]!.col || slots[a]!.z - slots[b]!.z
  const all = slots.map((_, i) => i)
  if (cranes < 2) return all.sort(by)
  const west = all.filter((i) => slots[i]!.col < cols / 2).sort(by)
  const east = all.filter((i) => slots[i]!.col >= cols / 2).sort(by)
  const out: number[] = []
  for (let k = 0; k < Math.max(west.length, east.length); k++) {
    if (k < west.length) out.push(west[k]!)
    if (k < east.length) out.push(east[k]!)
  }
  return out
}

interface ShipModel {
  /** Positioned and turned by the route (its nose, −z, along the heading). */
  group: THREE.Group
  containers: THREE.Mesh[]
}

interface CraneRig {
  group: THREE.Group
  trolley: THREE.Mesh
  spreader: THREE.Mesh
  cables: THREE.Mesh[]
  /** The container it is carrying (or has just set down). */
  load: THREE.Mesh
  x: number
}

interface BoatView {
  group: THREE.Group
  kind: BoatKind
}

/**
 * The harbour on the lake, drawn from `game.harbour`: the jetty and the marina with their boats, the cargo quay, crane and port warehouse
 * with the container ship being unloaded, and (the last upgrade) the great rectangular basin with its long north quay and two cranes.
 * Static parts are rebuilt (with their colliders) whenever what is built changes, so a new game takes them all away again.
 */
export class Harbour {
  readonly root = new THREE.Group()
  private readonly physics: PhysicsWorld
  private built = ''
  private parts: THREE.Group | null = null
  private bodies: RAPIER.RigidBody[] = []
  private cranes: CraneRig[] = []
  private yard: THREE.Mesh[] = []
  private readonly ships: ShipModel[]
  private readonly lines: THREE.Mesh[] = []
  private readonly boats = new Map<number, BoatView>()
  private basinMode = false

  constructor(physics: PhysicsWorld) {
    this.physics = physics
    this.ships = [0, 1, 2].map((size) => makeShip(size))
    for (const s of this.ships) {
      s.group.visible = false
      this.root.add(s.group)
    }
    for (let i = 0; i < 2; i++) {
      const line = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 6), mat(0xe7d9b8, 0.8))
      line.visible = false
      this.root.add(line)
      this.lines.push(line)
    }
  }

  update(dt: number, game: GameManager): void {
    const h = game.harbour
    const lake = game.meteor.phase === 'lake'
    const key = lake ? ['lake-road', 'lake-marina', 'lake-dock', 'lake-harbour'].map((id) => (h.has(id) ? '1' : '0')).join('') : ''
    if (key !== this.built) this.rebuild(key, h)
    const now = game.now
    this.updateBoats(lake ? h.boats : [], now)
    this.updateShip(lake ? h.ship : null, now)
    for (let i = 0; i < this.yard.length; i++) this.yard[i]!.visible = i < h.stock
    void dt
  }

  // ------------------------------------------------------------------ building

  private rebuild(key: string, h: HarbourManager): void {
    this.parts?.removeFromParent()
    this.parts = null
    for (const b of this.bodies) this.physics.removeBody(b)
    this.bodies = []
    this.cranes = []
    this.yard = []
    this.built = key
    this.basinMode = h.basin
    if (!key || !h.has('lake-road')) return
    const g = new THREE.Group()
    this.parts = g
    this.root.add(g)
    if (h.basin) this.buildBasin(g)
    this.buildRoad(g, h.basin)
    this.buildJetty(g, h.basin, h.has('lake-marina'))
    if (h.has('lake-dock')) {
      if (!h.basin) this.buildQuay(g)
      this.buildPort(g, h.basin)
      const geo = h.basin ? H.crane.basin : H.crane.lake
      this.addRails(g, geo)
      for (let k = 0; k < h.cranes; k++) this.cranes.push(this.makeCrane(g, geo, h.cranes === 1 ? (geo.minX + geo.maxX) / 2 : k === 0 ? geo.minX + 4 : geo.maxX - 4))
    }
  }

  private box(w: number, hgt: number, d: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D, shadow = true): THREE.Mesh {
    const mesh = new THREE.Mesh(metreUVs(new THREE.BoxGeometry(w, hgt, d)), m)
    mesh.position.set(x, y, z)
    mesh.castShadow = shadow
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }

  /** A fixed collider box from its extents. */
  private solid(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void {
    this.bodies.push(this.physics.addStaticBox(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), new THREE.Vector3((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2)))
  }

  private bollard(x: number, y: number, z: number, parent: THREE.Object3D): void {
    const iron = mat(0x1f2937, 0.5, 0.5)
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.17, 0.42, 12), iron)
    post.position.set(x, y + 0.21, z)
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 12), iron)
    cap.position.set(x, y + 0.45, z)
    post.castShadow = true
    parent.add(post, cap)
  }

  /** The road down from the main street, the hard-standing on the shore (not with the basin: its quay takes it in), and the harbour office. */
  private buildRoad(g: THREE.Group, basin: boolean): void {
    const { road, apron } = LAKE
    const asphalt = roadAsphalt(0x3a3d43)
    const white = mat(0xf8fafc, 0.6)
    const yellow = mat(0xf2d16b, 0.6)
    // The road stops where the hard-standing (or the basin's quay) starts, so the two never overlap.
    const minZ = basin ? H.basinQuayMaxZ : apron.maxZ
    const cz = (minZ + road.maxZ) / 2
    const len = road.maxZ - minZ
    this.box(road.maxX - road.minX, 0.03, len, asphalt, (road.minX + road.maxX) / 2, 0.015, cz, g, false)
    const cx = (road.minX + road.maxX) / 2
    for (let z = road.maxZ - 1.2; z > minZ + 0.5; z -= 3.6) this.box(0.12, 0.008, 1.6, yellow, cx, 0.034, z, g, false)
    for (const x of [road.minX + 0.2, road.maxX - 0.2]) this.box(0.1, 0.008, len - 0.4, white, x, 0.034, cz, g, false)
    if (!basin) {
      this.box(apron.maxX - apron.minX, 0.03, apron.maxZ - apron.minZ, concreteFloor(0xa8a49c), (apron.minX + apron.maxX) / 2, 0.015, (apron.minZ + apron.maxZ) / 2, g, false)
      this.box(apron.maxX - apron.minX, 0.18, 0.25, concreteFloor(0x8c8a85), (apron.minX + apron.maxX) / 2, 0.09, apron.minZ + 0.12, g)
    }
    const sign = makeSign('← HARBOUR', 1.6, 0.32, '#0f172a', '#7dd3fc')
    sign.position.set(road.maxX + 0.4, 2.0, road.maxZ - 1.5)
    sign.rotation.y = Math.PI / 2
    g.add(sign)
    this.box(0.08, 2.0, 0.08, paintedSteel(0x6b7280), road.maxX + 0.4, 1.0, road.maxZ - 1.5, g)

    // The harbour office: white walls, a blue roof, a window and a door facing the water.
    const o = H.office
    const ox = (o.minX + o.maxX) / 2
    const oz = (o.minZ + o.maxZ) / 2
    const w = o.maxX - o.minX
    const d = o.maxZ - o.minZ
    this.box(w, 2.6, d, mat(0xe2e8f0, 0.8), ox, 1.3, oz, g)
    this.box(w + 0.3, 0.15, d + 0.3, mat(0x1e3a8a, 0.6, 0.2), ox, 2.68, oz, g)
    this.box(1.5, 0.9, 0.05, mat(0x22313f, 0.15, 0.6), ox + 0.5, 1.5, o.minZ - 0.03, g)
    this.box(0.8, 2.0, 0.05, mat(0x1e3a8a, 0.6), ox - 0.9, 1.0, o.minZ - 0.03, g)
    const officeSign = makeSign('HARBOUR', 1.6, 0.34, '#0f172a', '#7dd3fc')
    officeSign.position.set(ox, 2.35, o.minZ - 0.06)
    officeSign.rotation.y = Math.PI
    g.add(officeSign)
    this.solid(o.minX, o.maxX, 0, 2.6, o.minZ, o.maxZ)
    g.add(kenney('street', 'light-curved', { x: road.minX - 0.6, z: (basin ? H.basinQuayMaxZ : apron.maxZ) + 1, rotY: -Math.PI / 2, scale: 7.5, keepOrigin: true }))
  }

  /** The timber jetty (and the marina's floating pontoon on beyond it), the footpath round to it, and the marina hut. */
  private buildJetty(g: THREE.Group, basin: boolean, marina: boolean): void {
    const root = basin ? J.basinRootX : J.lakeRootX
    const tip = root - J.length
    const end = marina ? tip - J.marinaLength : tip
    const top = 0.08
    const depth = (basin ? -B.floorY : LAKE.depth) + 0.4
    const plank = woodMat(0x8a6a48)
    const darkWood = woodMat(0x4a3826)
    const start = root + 1.2 // the deck starts on the bank
    // Timber deck, side beams and piles.
    for (let x = start - 0.17; x > tip; x -= 0.34) this.box(0.3, 0.06, J.halfWidth * 2, plank, x, top - 0.03, J.z, g)
    for (const s of [-1, 1]) {
      this.box(start - tip, 0.2, 0.14, darkWood, (start + tip) / 2, top - 0.16, J.z + s * (J.halfWidth - 0.07), g)
      for (let x = root - 1; x >= tip; x -= 2.3) {
        const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, depth, 10), darkWood)
        pile.position.set(x, top - depth / 2 + 0.15, J.z + s * (J.halfWidth - 0.05))
        pile.castShadow = true
        g.add(pile)
      }
    }
    // Cleats and fenders at each berth on the north side.
    const berths = [...H.jettyBerths, ...(marina ? H.marinaBerths : [])]
    for (const b of berths) {
      for (const dx of [-1.8, 1.8]) this.bollard(root - b + dx, top, J.z + J.halfWidth - 0.25, g)
      const fender = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.7, 10), mat(0x1e40af, 0.6))
      fender.rotation.z = Math.PI / 2
      fender.position.set(root - b, top - 0.25, J.z + J.halfWidth + 0.1)
      g.add(fender)
    }
    if (marina) {
      // The floating pontoon: a grey composite deck on blue floats, joined to the jetty's end by a short ramp.
      const deck = mat(0x9ca3af, 0.85)
      this.box(tip - end, 0.12, J.halfWidth * 2, deck, (tip + end) / 2, top - 0.06, J.z, g)
      for (let x = tip - 1; x > end; x -= 2) {
        for (const s of [-1, 1]) {
          const float = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 1.6, 12), mat(0x1d4ed8, 0.6))
          float.rotation.z = Math.PI / 2
          float.position.set(x, top - 0.38, J.z + s * (J.halfWidth - 0.35))
          g.add(float)
        }
      }
      this.box(0.08, 0.14, J.halfWidth * 2, mat(0x6b7280, 0.4, 0.6), tip, top + 0.01, J.z, g)
      // The fuel pump at the far end, and a lifebuoy.
      const px = end + 0.6
      this.box(0.6, 1.3, 0.45, mat(0xdc2626, 0.5), px, top + 0.65, J.z - 0.5, g)
      this.box(0.5, 0.35, 0.05, mat(0xf8fafc, 0.4), px, top + 1.0, J.z - 0.25, g)
      const hose = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 6, 16), mat(0x111111, 0.8))
      hose.position.set(px + 0.33, top + 0.8, J.z - 0.5)
      hose.rotation.y = Math.PI / 2
      g.add(hose)
      const fuel = makeSign('FUEL', 0.6, 0.22, '#7f1d1d', '#fef2f2')
      fuel.position.set(px, top + 1.45, J.z - 0.5)
      fuel.rotation.y = Math.PI / 2
      g.add(fuel)
    }
    this.box(0.12, 1.2, 0.12, paintedSteel(0xe5e7eb), end + 0.3, top + 0.6, J.z + J.halfWidth - 0.3, g)
    const buoy = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.08, 10, 24), mat(0xf97316, 0.6))
    buoy.position.set(end + 0.3, top + 0.85, J.z + J.halfWidth - 0.2)
    buoy.rotation.y = Math.PI / 2
    g.add(buoy)
    // You walk on the deck; low rails (invisible) along its sides and its end keep you out of the water.
    this.solid(end, start, top - 0.1, top, J.z - J.halfWidth, J.z + J.halfWidth)
    for (const s of [-1, 1]) this.solid(end - 0.2, root - 0.6, 0, 1.2, J.z + s * (J.halfWidth + 0.1) - 0.1, J.z + s * (J.halfWidth + 0.1) + 0.1)
    this.solid(end - 0.4, end - 0.2, 0, 1.2, J.z - J.halfWidth - 0.2, J.z + J.halfWidth + 0.2)

    // The footpath: from the hard-standing (or the quay) along the shore to the jetty's root.
    const gravel = roofGravel(0xa8a29e)
    const px = basin ? H.path.basin.x : H.path.lake.x
    const fromX = basin ? B.maxX : LAKE.apron.maxX
    const connZ = basin ? -6.8 : -8
    const north = connZ + 0.8
    this.box(1.6, 0.02, north - (J.z - 0.8), gravel, px, 0.01, (north + J.z - 0.8) / 2, g, false)
    this.box(px - start + 0.8, 0.02, 1.6, gravel, (px + start) / 2, 0.01, J.z, g, false)
    this.box(px + 0.8 - fromX, 0.02, 1.6, gravel, (px + 0.8 + fromX) / 2, 0.01, connZ, g, false)
    if (marina) {
      // The marina hut beside the path.
      const hx = px + H.hut.dx
      const hz = J.z + 1.5
      this.box(2.4, 2.4, 2.4, woodMat(0xdbeafe), hx, 1.2, hz, g)
      this.box(2.8, 0.14, 2.8, mat(0x0e7490, 0.6), hx, 2.47, hz, g)
      this.box(0.05, 0.8, 1.2, mat(0x22313f, 0.15, 0.6), hx - 1.23, 1.5, hz, g)
      const sign = makeSign('MARINA', 1.4, 0.3, '#0e7490', '#ecfeff')
      sign.position.set(hx - 1.26, 2.15, hz)
      sign.rotation.y = -Math.PI / 2
      g.add(sign)
      this.solid(hx - 1.2, hx + 1.2, 0, 2.4, hz - 1.2, hz + 1.2)
    }
  }

  /** The cargo quay on the round lake's north shore: a concrete block down into the water, with bollards and fenders on its face. */
  private buildQuay(g: THREE.Group): void {
    const q = H.quay
    const top = 0.05
    const conc = concreteFloor(0xb4b0a8)
    const h = LAKE.depth + 0.4
    this.box(q.maxX - q.minX, h, q.maxZ - q.minZ, conc, (q.minX + q.maxX) / 2, top - h / 2, (q.minZ + q.maxZ) / 2, g)
    this.edgeDetails(g, q.minX, q.maxX, q.minZ, top)
    this.solid(q.minX, q.maxX, top - 0.2, top, q.minZ, q.maxZ)
    this.solid(q.minX, q.maxX, 0, 1.2, q.minZ - 0.3, q.minZ - 0.1)
    for (const x of [q.minX - 0.2, q.maxX]) this.solid(x, x + 0.2, 0, 1.2, q.minZ - 0.3, q.maxZ)
  }

  /** Along a quay's water face (at `faceZ`, the water to the south): a yellow edge line, bollards and black fenders. */
  private edgeDetails(g: THREE.Group, minX: number, maxX: number, faceZ: number, top: number): void {
    this.box(maxX - minX, 0.006, 0.15, mat(0xf2c94c, 0.6), (minX + maxX) / 2, top + 0.003, faceZ + 0.55, g, false)
    for (let x = minX + 1.5; x < maxX - 0.5; x += 3.5) this.bollard(x, top, faceZ + 0.32, g)
    const rubber = mat(0x111111, 0.9)
    for (let x = minX + 0.8; x < maxX; x += 2.6) this.box(0.5, 1.4, 0.25, rubber, x, top - 0.85, faceZ - 0.12, g)
  }

  /** The great harbour: a rectangular basin with concrete walls, its long north quay (taking in the hard-standing) and its water. */
  private buildBasin(g: THREE.Group): void {
    const conc = concreteFloor(0xb4b0a8)
    const wallH = 0.05 - B.floorY
    const wy = 0.05 - wallH / 2
    const t = 0.5
    // The north quay: one slab from the basin's edge back to the hard-standing's far side, down into the water at its face.
    this.box(B.maxX - B.minX + t, wallH, H.basinQuayMaxZ - B.maxZ, conc, (B.minX - t + B.maxX) / 2, wy, (B.maxZ + H.basinQuayMaxZ) / 2, g)
    this.solid(B.minX - t, B.maxX, -0.2, 0.05, B.maxZ, H.basinQuayMaxZ)
    this.edgeDetails(g, B.minX + 0.5, B.maxX - 0.5, B.maxZ, 0.05)
    // East and south walls, and the west wall either side of the channel.
    this.box(t, wallH, B.maxZ - B.minZ + t, conc, B.maxX + t / 2, wy, (B.minZ - t + B.maxZ) / 2, g)
    this.box(B.maxX - B.minX + t * 2, wallH, t, conc, (B.minX + B.maxX) / 2, wy, B.minZ - t / 2, g)
    for (const [z0, z1] of [[B.minZ - t, CH.z - CH.halfWidth], [CH.z + CH.halfWidth, B.maxZ]] as const) this.box(t, wallH, z1 - z0, conc, B.minX - t / 2, wy, (z0 + z1) / 2, g)
    // The bed, and the water (out through the channel to where the sea starts).
    this.box(B.maxX - B.minX, 0.2, B.maxZ - B.minZ, mat(0x3b342c, 1), (B.minX + B.maxX) / 2, B.floorY - 0.1, (B.minZ + B.maxZ) / 2, g, false)
    const pts = [
      [-58, CH.z - CH.halfWidth], [B.minX, CH.z - CH.halfWidth], [B.minX, B.minZ], [B.maxX, B.minZ], [B.maxX, B.maxZ], [B.minX, B.maxZ], [B.minX, CH.z + CH.halfWidth], [-58, CH.z + CH.halfWidth],
    ].map(([x, z]) => new THREE.Vector2(x!, -z!))
    const geo = new THREE.ShapeGeometry(new THREE.Shape(pts))
    const pos = geo.getAttribute('position')
    const uv = geo.getAttribute('uv')
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 26, pos.getY(i) / 26)
    const water = new THREE.Mesh(geo, waterMat())
    water.rotation.x = -Math.PI / 2
    water.position.y = BASIN_Y
    water.receiveShadow = true
    g.add(water)
  }

  /** The port warehouse (roller door facing the quay), the concrete in front of it and the container yard. */
  private buildPort(g: THREE.Group, basin: boolean): void {
    const w = H.warehouse
    const cx = (w.minX + w.maxX) / 2
    const cz = (w.minZ + w.maxZ) / 2
    const W = w.maxX - w.minX
    const D = w.maxZ - w.minZ
    const wallH = 6
    if (!basin) {
      const a = H.portApron
      this.box(a.maxX - a.minX, 0.03, a.maxZ - a.minZ, concreteFloor(0xa8a49c), (a.minX + a.maxX) / 2, 0.016, (a.minZ + a.maxZ) / 2, g, false)
    }
    this.box(W, wallH, D, shedCladding(0x5b6b7d), cx, wallH / 2, cz, g)
    // A shallow pitched roof (ridge along z) with overhanging eaves.
    const roof = shedRoof(0x9aa3ad)
    for (const s of [-1, 1]) {
      const half = new THREE.Mesh(metreUVs(new THREE.BoxGeometry(W / 2 + 0.5, 0.12, D + 0.6)), roof)
      half.position.set(cx + s * (W / 4 + 0.1), wallH + 0.45, cz)
      half.rotation.z = -s * 0.2
      half.castShadow = true
      g.add(half)
    }
    // Gable triangles closing the roof's ends.
    for (const z of [w.minZ, w.maxZ]) {
      const tri = new THREE.Shape([new THREE.Vector2(-W / 2, 0), new THREE.Vector2(W / 2, 0), new THREE.Vector2(0, (W / 2) * Math.tan(0.2))])
      const m = new THREE.Mesh(new THREE.ShapeGeometry(tri), shedCladding(0x5b6b7d))
      m.position.set(cx, wallH, z + (z === w.minZ ? -0.01 : 0.01))
      if (z === w.minZ) m.rotation.y = Math.PI
      g.add(m)
    }
    // The roller door on the east side, with a hood over it, and a sign.
    this.box(0.06, 4, 5, mat(0x9ca3af, 0.5, 0.4), w.maxX + 0.04, 2, cz, g)
    for (let y = 0.25; y < 4; y += 0.25) this.box(0.02, 0.03, 5, mat(0x6b7280, 0.5, 0.4), w.maxX + 0.08, y, cz, g, false)
    this.box(0.4, 0.4, 5.4, paintedSteel(0x374151), w.maxX + 0.2, 4.2, cz, g)
    const sign = makeSign('PORT WAREHOUSE', 3.6, 0.5, '#0f172a', '#fde68a')
    sign.position.set(w.maxX + 0.05, 5.1, cz)
    sign.rotation.y = Math.PI / 2
    g.add(sign)
    this.solid(w.minX, w.maxX, 0, wallH, w.minZ, w.maxZ)
    // The yard: 2 rows × 2 stacks × 3 high, filled as containers come off the ships.
    for (let tier = 0; tier < 3; tier++)
      for (const z of H.yard.z)
        for (const x of H.yard.x) {
          const box = this.containerMesh(COLOURS[this.yard.length % COLOURS.length]!)
          box.position.set(x, 0.05 + BOX.h / 2 + tier * BOX.h, z)
          box.visible = false
          g.add(box)
          this.yard.push(box)
        }
    // A reach stacker's parking spot, and floodlight masts.
    for (const [x, z] of [[-55.6, -6.6], [-36.2, 0.4]] as const) {
      this.box(0.25, 12, 0.25, paintedSteel(0x6b7280), x, 6, z, g)
      this.box(1.6, 0.4, 0.5, mat(0xf8fafc, 0.3, 0.3), x, 12.1, z, g)
    }
  }

  private containerMesh(colour: number): THREE.Mesh {
    const m = new THREE.Mesh(metreUVs(new THREE.BoxGeometry(BOX.l, BOX.h, BOX.w)), shedCladding(colour))
    m.castShadow = true
    m.receiveShadow = true
    return m
  }

  /** The crane's rails, along the quay at the waterside and landside legs. */
  private addRails(g: THREE.Group, geo: CraneGeo): void {
    for (const z of [geo.waterZ, geo.landZ]) this.box(geo.maxX - geo.minX + 5, 0.06, 0.18, mat(0x52525b, 0.4, 0.8), (geo.minX + geo.maxX) / 2, geo.topY + 0.03, z, g, false)
  }

  /** A ship-to-shore crane: four legs on bogies, a portal, the boom over the water with a trolley, hoist ropes and a yellow spreader. */
  private makeCrane(g: THREE.Group, geo: CraneGeo, x: number): CraneRig {
    const group = new THREE.Group()
    group.position.x = x
    const steel = paintedSteel(0x1d4ed8)
    const white = paintedSteel(0xf1f5f9)
    const y0 = geo.topY
    const legH = BOOM_Y - 0.5 - y0
    for (const z of [geo.waterZ, geo.landZ])
      for (const s of [-1, 1]) {
        this.box(0.4, legH, 0.4, steel, s * 1.8, y0 + legH / 2 + 0.4, z, group)
        this.box(0.8, 0.4, 0.9, mat(0x374151, 0.6, 0.4), s * 1.8, y0 + 0.2, z, group)
      }
    // The portal: beams along z joining the legs at two heights, and across x.
    for (const s of [-1, 1]) {
      this.box(0.35, 0.5, Math.abs(geo.landZ - geo.waterZ), steel, s * 1.8, 6.2, (geo.waterZ + geo.landZ) / 2, group)
      this.box(0.3, 0.3, Math.abs(geo.landZ - geo.waterZ), steel, s * 1.8, 3.4, (geo.waterZ + geo.landZ) / 2, group)
    }
    for (const z of [geo.waterZ, geo.landZ]) this.box(3.9, 0.45, 0.4, steel, 0, BOOM_Y - 0.5, z, group)
    // The boom (two girders) from the backreach out over the water, the A-frame and its stays.
    const boomLen = Math.abs(geo.backZ - geo.outZ)
    const boomZ = (geo.backZ + geo.outZ) / 2
    for (const s of [-1, 1]) this.box(0.3, 0.8, boomLen, white, s * 0.9, BOOM_Y, boomZ, group)
    const apexY = BOOM_Y + 4.5
    for (const s of [-1, 1]) this.box(0.3, apexY - BOOM_Y, 0.3, white, s * 0.9, (BOOM_Y + apexY) / 2, geo.landZ, group)
    for (const end of [geo.outZ, geo.backZ]) {
      const from = new THREE.Vector3(0, apexY, geo.landZ)
      const to = new THREE.Vector3(0, BOOM_Y + 0.3, end)
      const stay = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, from.distanceTo(to), 6), mat(0x9ca3af, 0.4, 0.8))
      stay.position.copy(from).add(to).multiplyScalar(0.5)
      stay.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize())
      group.add(stay)
    }
    // The machinery house over the backreach and the driver's cab under the boom.
    this.box(2.6, 2.0, 3.0, white, 0, BOOM_Y + 1.4, geo.backZ + Math.sign(geo.outZ - geo.backZ) * 1.8, group)
    this.box(1.4, 1.3, 1.4, white, 1.3, BOOM_Y - 1.2, geo.waterZ + Math.sign(geo.outZ - geo.backZ) * 1.5, group)
    this.box(1.42, 0.6, 0.02, mat(0x1e293b, 0.15, 0.5), 1.3, BOOM_Y - 1.1, geo.waterZ + Math.sign(geo.outZ - geo.backZ) * 2.21, group, false)
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3b30 }))
    lamp.position.set(0, apexY + 0.2, geo.landZ)
    group.add(lamp)
    // The trolley, its ropes and the spreader.
    const trolley = this.box(2.0, 0.5, 2.0, mat(0x374151, 0.5, 0.5), 0, BOOM_Y - 0.6, geo.dropZ, group)
    const cables = [-0.7, 0.7].map((dx) => {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 6), mat(0x111111, 0.4, 0.8))
      c.position.x = dx
      group.add(c)
      return c
    })
    const spreader = this.box(BOX.l + 0.1, 0.22, BOX.w + 0.06, armYellow(), 0, CLEAR_Y, geo.dropZ, group)
    const load = this.containerMesh(COLOURS[0]!)
    load.visible = false
    g.add(load)
    g.add(group)
    return { group, trolley, spreader, cables, load, x }
  }

  // ------------------------------------------------------------------ traffic

  /** A boat's berth (on the jetty's north side) in the current harbour, with its moored heading (bow east). */
  private berth(kind: BoatKind, slot: number): { x: number; z: number } {
    const root = this.basinMode ? J.basinRootX : J.lakeRootX
    const along = kind === 'motor' ? H.marinaBerths[slot] ?? H.marinaBerths[0] : H.jettyBerths[slot] ?? H.jettyBerths[0]
    return { x: root - along, z: J.z + J.halfWidth + 0.15 + BOAT[kind].beam / 2 }
  }

  private updateBoats(visits: readonly BoatVisit[], now: number): void {
    const alive = new Set(visits.map((v) => v.id))
    for (const [id, view] of this.boats) {
      if (alive.has(id)) continue
      view.group.removeFromParent()
      this.boats.delete(id)
    }
    const waterY = this.basinMode ? BASIN_Y : LAKE_Y
    for (const v of visits) {
      let view = this.boats.get(v.id)
      if (!view) {
        view = { group: makeBoat(v.kind, v.id), kind: v.kind }
        this.boats.set(v.id, view)
        this.root.add(view.group)
      }
      const pose = this.boatPose(v, now)
      const g = view.group
      g.visible = pose !== null
      if (!pose) continue
      g.position.set(pose.x, waterY + Math.sin(now * 1.3 + v.id) * 0.05, pose.z)
      g.rotation.set(Math.sin(now * 0.9 + v.id) * 0.03, pose.yaw, Math.sin(now * 1.1 + v.id * 2) * 0.04)
    }
  }

  /** In along the lane and into the berth; out: back off, turn round on the spot, and away down the channel. */
  private boatPose(v: BoatVisit, now: number): Pose | null {
    const b = this.berth(v.kind, v.slot)
    const lane = H.boatLane
    if (now < v.mooredAt) {
      const p = (now - v.spawnAt) / (v.mooredAt - v.spawnAt)
      const leg = rounded([[SEA_X, lane], [-60, lane], [b.x - 7, lane], [b.x - 3, b.z], [b.x, b.z]], 2.5)
      return leg.at(1 - (1 - Math.max(0, p)) ** 2)
    }
    if (now < v.leaveAt) return { x: b.x, z: b.z, yaw: -Math.PI / 2 }
    const q = (now - v.leaveAt) / (v.goneAt - v.leaveAt)
    const back = { x: b.x - 4, z: b.z + 1.1 }
    if (q < 0.12) return rounded([[b.x, b.z], [back.x, back.z]], 1, true).at(smooth(q / 0.12))
    if (q < 0.25) {
      const yaw = -Math.PI / 2 + (Math.atan2(1, 0) + Math.PI / 2) * smooth((q - 0.12) / 0.13)
      return { x: back.x, z: back.z, yaw }
    }
    const leg = rounded([[back.x, back.z], [back.x - 4, lane], [-60, lane], [SEA_X, lane]], 2.5)
    const p = (q - 0.25) / 0.75
    return leg.at(p * p)
  }

  /** The ship's berth for its size in the current harbour (its centre; bow east, along the quay's face). */
  private shipBerth(size: number): { x: number; z: number } {
    const def = CONFIG.harbour.ships[size]!
    return this.basinMode ? { x: H.berthX.basin, z: B.maxZ - 0.3 - def.beam / 2 } : { x: H.berthX.lake, z: H.quay.minZ - 0.3 - def.beam / 2 }
  }

  private shipLeg(size: number, reverse: boolean): Leg {
    const b = this.shipBerth(size)
    const pts: [number, number][] = this.basinMode ? [[SEA_X, CH.z], [-64, CH.z], [-40, CH.z], [b.x, b.z]] : [[SEA_X, CH.z], [-58, CH.z], [-50, b.z], [b.x, b.z]]
    return rounded(reverse ? pts.reverse() : pts, this.basinMode ? 9 : 6, reverse)
  }

  private updateShip(s: ShipVisit | null, now: number): void {
    for (const m of this.ships) m.group.visible = false
    for (const l of this.lines) l.visible = false
    if (!s) {
      this.idleCranes()
      return
    }
    const model = this.ships[s.size]!
    const b = this.shipBerth(s.size)
    let pose: Pose
    if (now < s.mooredAt) pose = this.shipLeg(s.size, false).at(1 - (1 - Math.max(0, (now - s.spawnAt) / (s.mooredAt - s.spawnAt))) ** 2.2)
    else if (now < s.leaveAt) pose = { x: b.x, z: b.z, yaw: -Math.PI / 2 }
    else pose = this.shipLeg(s.size, true).at(Math.min(1, (now - s.leaveAt) / (s.goneAt - s.leaveAt)) ** 2.2)
    const g = model.group
    g.visible = true
    g.position.set(pose.x, (this.basinMode ? BASIN_Y : LAKE_Y) + Math.sin(now * 0.8) * 0.03, pose.z)
    g.rotation.set(0, pose.yaw, 0)
    g.updateMatrixWorld(true)

    // Which containers are still aboard, and the crane jobs.
    const order = unloadOrder(s.size, s.cranes)
    const per = CONFIG.harbour.unloadSeconds
    const t = now - s.mooredAt
    const moored = now >= s.mooredAt && now < s.leaveAt
    order.forEach((slot, o) => {
      const job = Math.floor(o / s.cranes)
      model.containers[slot]!.visible = !moored || t < (job + 0.38) * per
      if (now >= s.leaveAt) model.containers[slot]!.visible = false
    })
    if (!moored || t >= Math.ceil(order.length / s.cranes) * per) this.idleCranes()
    else {
      const job = Math.floor(t / per)
      const u = (t - job * per) / per
      this.cranes.forEach((crane, k) => {
        if (k >= s.cranes) return this.idle(crane)
        const o = job * s.cranes + k
        const slot = order[o]
        if (slot === undefined) return this.idle(crane)
        const prev = order[o - s.cranes]
        const at = model.containers[slot]!.getWorldPosition(new THREE.Vector3())
        const from = prev !== undefined ? model.containers[prev]!.getWorldPosition(new THREE.Vector3()).x : crane.x
        this.craneJob(crane, u, from, at, COLOURS[slot % COLOURS.length]!)
      })
    }

    // Mooring lines, bow and stern, to the quay's face while it is alongside.
    if (moored) {
      const L = CONFIG.harbour.ships[s.size]!.length
      const faceZ = this.basinMode ? B.maxZ : H.quay.minZ
      ;[-L / 2 + 1.5, L / 2 - 2.5].forEach((dx, i) => {
        const line = this.lines[i]!
        const from = new THREE.Vector3(b.x + dx, (this.basinMode ? BASIN_Y : LAKE_Y) + 1.55, b.z + CONFIG.harbour.ships[s.size]!.beam / 2 - 0.2)
        const to = new THREE.Vector3(b.x + dx * 1.15, 0.45, faceZ + 0.32)
        line.visible = true
        line.position.copy(from).add(to).multiplyScalar(0.5)
        line.scale.set(1, from.distanceTo(to), 1)
        line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize())
      })
    }
  }

  private idleCranes(): void {
    for (const c of this.cranes) this.idle(c)
  }

  private idle(c: CraneRig): void {
    const geo = this.basinMode ? H.crane.basin : H.crane.lake
    c.group.position.x = c.x
    this.pose(c, geo.dropZ, CLEAR_Y)
    c.load.visible = false
  }

  /** Put the trolley at `z` and the spreader at height `y`, ropes between them. */
  private pose(c: CraneRig, z: number, y: number): void {
    c.trolley.position.z = z
    c.spreader.position.set(0, y, z)
    const top = BOOM_Y - 0.85
    for (const cable of c.cables) {
      cable.position.set(cable.position.x, (top + y + 0.11) / 2, z)
      cable.scale.set(1, Math.max(0.05, top - y - 0.11), 1)
    }
  }

  /**
   * One container's lift, `u` 0…1 of the job: travel along the rails to it (from the last one's column) with the trolley running out, lower,
   * grab, lift clear, run back over the quay, set it down, let go and lift; the container then goes off to the yard.
   */
  private craneJob(c: CraneRig, u: number, fromX: number, at: THREE.Vector3, colour: number): void {
    const geo = this.basinMode ? H.crane.basin : H.crane.lake
    const x = THREE.MathUtils.clamp(at.x, geo.minX, geo.maxX)
    const fx = THREE.MathUtils.clamp(fromX, geo.minX, geo.maxX)
    c.group.position.x = fx + (x - fx) * span(u, 0, 0.18)
    const grabY = at.y + BOX.h / 2 + 0.11
    const dropY = geo.topY + BOX.h + 0.11
    let z: number = geo.dropZ
    let y: number = CLEAR_Y
    let held = false
    let sitting = false
    if (u < 0.25) z = geo.dropZ + (at.z - geo.dropZ) * span(u, 0, 0.25)
    else if (u < 0.38) {
      z = at.z
      y = CLEAR_Y + (grabY - CLEAR_Y) * span(u, 0.25, 0.38)
    } else if (u < 0.5) {
      z = at.z
      y = grabY + (CLEAR_Y - grabY) * span(u, 0.38, 0.5)
      held = true
    } else if (u < 0.66) {
      z = at.z + (geo.dropZ - at.z) * span(u, 0.5, 0.66)
      held = true
    } else if (u < 0.78) {
      y = CLEAR_Y + (dropY - CLEAR_Y) * span(u, 0.66, 0.78)
      held = true
    } else if (u < 0.8) {
      y = dropY
      sitting = true
    } else {
      y = dropY + (CLEAR_Y - dropY) * span(u, 0.8, 0.92)
      sitting = u < 0.95
    }
    this.pose(c, z, y)
    const load = c.load
    load.visible = held || sitting
    ;(load.material as THREE.MeshStandardMaterial).color.setHex(colour)
    if (held) load.position.set(c.group.position.x, y - 0.11 - BOX.h / 2, z)
    else if (sitting) load.position.set(c.group.position.x, geo.topY + BOX.h / 2, geo.dropZ)
  }
}

/** Boat sizes (length, beam). */
const BOAT: Record<BoatKind, { length: number; beam: number }> = {
  row: { length: 3.2, beam: 1.3 },
  sail: { length: 5.0, beam: 1.8 },
  motor: { length: 4.6, beam: 1.9 },
}


/** A rowing boat, a small sailing yacht, or a motorboat (bow to −z, waterline at y = 0). */
function makeBoat(kind: BoatKind, seed: number): THREE.Group {
  // Kenney Watercraft Kit boats (bow +z, so turned round: our boats' noses point −z), sunk a little into the water.
  const g = new THREE.Group()
  const { length: L } = BOAT[kind]
  const names = kind === 'row' ? ['boat-row-small', 'boat-row-large'] : kind === 'sail' ? ['boat-sail-a', 'boat-sail-b'] : ['boat-speed-a', 'boat-speed-c', 'boat-speed-e', 'boat-fishing-small']
  const name = names[seed % names.length]!
  const model = kenney('boats', name, { x: 0, y: kind === 'sail' ? -0.35 : -0.25, z: 0, rotY: Math.PI, length: L })
  g.add(model)
  return g
}

/**
 * A container ship of `size` (from `CONFIG.harbour.ships`): a red-bottomed hull with a pointed bow, a white bridge and funnel at the stern,
 * and its containers on deck (one mesh each, so they can come off). Built bow +x inside a holder turned so its nose is −z.
 */
function makeShip(size: number): ShipModel {
  const def = CONFIG.harbour.ships[size]!
  const L = def.length
  const W = def.beam
  const group = new THREE.Group()
  const g = new THREE.Group()
  g.rotation.y = Math.PI / 2
  group.add(g)
  const outline = new THREE.Shape([
    new THREE.Vector2(-L / 2, -W / 2),
    new THREE.Vector2(L / 2 - 3.5, -W / 2),
    new THREE.Vector2(L / 2, 0),
    new THREE.Vector2(L / 2 - 3.5, W / 2),
    new THREE.Vector2(-L / 2, W / 2),
  ])
  const topColour = [0x1e2a44, 0x1f3d2b, 0x0f2747][size] ?? 0x1e2a44
  const hullPart = (y0: number, h: number, color: number) => {
    const m = new THREE.Mesh(new THREE.ExtrudeGeometry(outline, { depth: h, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2 }))
    m.rotation.x = -Math.PI / 2
    m.position.y = y0
    m.castShadow = true
    g.add(m)
  }
  hullPart(-1.0, 1.1, 0x9f1d1d)
  hullPart(0.1, 1.4, topColour)
  const part = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    g.add(mesh)
    return mesh
  }
  part(L - 4.2, 0.1, W - 0.4, new THREE.MeshStandardMaterial({ color: 0x3f6b4a, roughness: 0.8 }), -0.8, 1.55, 0)
  // The bridge at the stern (taller on the bigger ships), with its windows, wings and funnel.
  const white = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.6 })
  const bh = 3.4 + size * 1.6
  part(3.4, bh, W - 0.6, white, -L / 2 + 2.2, 1.6 + bh / 2, 0)
  part(3.6, 0.15, W + 0.6, white, -L / 2 + 2.2, 1.6 + bh + 0.07, 0)
  part(0.05, 0.6, W - 1.0, new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.2, metalness: 0.4 }), -L / 2 + 3.93, 1.6 + bh - 0.6, 0)
  const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.45 + size * 0.15, 0.55 + size * 0.15, 1.6, 14), new THREE.MeshStandardMaterial({ color: 0xc2410c, roughness: 0.6 }))
  funnel.position.set(-L / 2 + 1.4, 1.6 + bh + 0.9, 0)
  g.add(funnel)
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3, 6), white)
  mast.position.set(L / 2 - 2.2, 3.0, 0)
  g.add(mast)
  const containers = shipSlots(size).map((s, i) => {
    const m = new THREE.Mesh(metreUVs(new THREE.BoxGeometry(BOX.l, BOX.h, BOX.w)), shedCladding(COLOURS[i % COLOURS.length]!))
    m.position.set(s.x, s.y, s.z)
    m.castShadow = true
    m.receiveShadow = true
    g.add(m)
    return m
  })
  return { group, containers }
}
