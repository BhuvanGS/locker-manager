import type RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { kenney } from './kenney'
import type { PhysicsWorld } from '../engine/PhysicsWorld'
import { CONFIG } from '../sim/config'
import type { GameManager } from '../sim/GameManager'
import type { BoatKind, BoatVisit, HarbourManager, LorryVisit, ShipVisit } from '../sim/HarbourManager'
import { HARBOUR, LAKE } from './layout'
import { makeSign, mat } from './models'
import { Route, rounded, type Pose } from './paths'
import { BOX, CONTAINER_COLOURS as COLOURS, makeContainer, makeGantry, poseGantry, setContainerColour, type Gantry } from './terminal'
import { armYellow, concreteFloor, metreUVs, paintedSteel, roadAsphalt, roofGravel, shedCladding, shedRoof, waterMat, wireMesh, woodMat } from './textures'
import { LORRY_COLOURS, makeContainerLorry, setBraking, type ContainerLorry } from './vehicles'

const H = HARBOUR
const J = H.jetty
const B = H.basin
const T = H.terminal
const CH = LAKE.coast.channel
/** Where boats and ships appear and vanish, far out at sea. */
const SEA_X = -175
const LAKE_Y = -LAKE.waterDrop
const BASIN_Y = LAKE.coast.seaY
/** The quay crane's boom height and the spreader's travel height over the ship (clear of the stacks on deck). */
const BOOM_Y = 13.6
const CLEAR_Y = 10.2
/** The yard gantry's spreader travel height (a carried box clears three high stacks). */
const YARD_CLEAR = 11.0
/** A ship's main deck above the waterline. */
const DECK = 1.6
/** The dock's south quay face (water to the north of it). */
const QUAY_Z = B.minZ
/** Where a lorry's container sits on its trailer, above the ground (its underside). */
const LORRY_DECK = 1.36

type CraneGeo = (typeof H.crane)['basin']

const smooth = (u: number): number => {
  const c = Math.min(1, Math.max(0, u))
  return c * c * (3 - 2 * c)
}
/** 0…1 across [a, b] of `u`, smoothed. */
const span = (u: number, a: number, b: number): number => smooth((u - a) / (b - a))
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k
const lerpAngle = (a: number, b: number, k: number): number => {
  let d = b - a
  d = Math.atan2(Math.sin(d), Math.cos(d))
  return a + d * k
}
const blendPose = (a: Pose, b: Pose, k: number): Pose => ({ x: lerp(a.x, b.x, k), z: lerp(a.z, b.z, k), yaw: lerpAngle(a.yaw, b.yaw, k) })
/** How far off its berth a ship stops before the tugs push it alongside. */
const OFF_BERTH = 4

// ------------------------------------------------------------------ ship slots

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
/** Container pitch along the ship (a box and a gap). */
const PITCH = BOX.l + 0.6

function shipSlots(size: number): Slot[] {
  const def = CONFIG.harbour.ships[size]!
  const cols = COLS[size] ?? 2
  const rows = ROWS[size] ?? 2
  const out: Slot[] = []
  for (let tier = 0; tier < 2; tier++)
    for (let c = 0; c < cols; c++)
      for (let r = 0; r < rows; r++) {
        if (out.length >= def.containers) break
        out.push({ x: 0.5 + (c - (cols - 1) / 2) * PITCH, y: DECK + BOX.h / 2 + tier * (BOX.h + 0.02), z: (r - (rows - 1) / 2) * (BOX.w + 0.15), tier, col: c })
      }
  return out
}

type CraneTask = { slot: number; kind: 'in' | 'out' }

/**
 * Each quay crane's list of jobs for a visit: first the imports it lifts off (top tier first), then the exports it puts on (bottom tier
 * first). With two cranes the west one works the western columns and the east one the rest, so they never cross.
 */
function craneTasks(s: ShipVisit): CraneTask[][] {
  const slots = shipSlots(s.size)
  const cols = COLS[s.size] ?? 2
  const sideOf = (i: number) => (s.cranes < 2 ? 0 : slots[i]!.col < cols / 2 ? 0 : 1)
  const topFirst = (a: number, b: number) => slots[b]!.tier - slots[a]!.tier || slots[a]!.col - slots[b]!.col || slots[a]!.z - slots[b]!.z
  const all = slots.map((_, i) => i)
  const lists: CraneTask[][] = Array.from({ length: s.cranes }, () => [])
  for (const i of all.slice(0, s.containers).sort(topFirst)) lists[sideOf(i)]!.push({ slot: i, kind: 'in' })
  // Exports go in bottom tier first, alternating sides so both cranes get a share.
  const bottom = [...all].sort((a, b) => -topFirst(a, b))
  const bySide = [bottom.filter((i) => sideOf(i) === 0), bottom.filter((i) => sideOf(i) === 1)]
  let taken = 0
  for (let k = 0; taken < s.exports && k < all.length; k++) {
    for (let side = 0; side < s.cranes && taken < s.exports; side++) {
      const i = bySide[side]![k]
      if (i === undefined) continue
      lists[side]!.push({ slot: i, kind: 'out' })
      taken++
    }
  }
  return lists
}

interface ShipModel {
  /** Positioned and turned by the route (its nose, −z, along the heading). */
  group: THREE.Group
  containers: THREE.Group[]
  /** The ship's name on its bows. */
  names: THREE.Mesh[]
}

interface CraneRig {
  group: THREE.Group
  trolley: THREE.Mesh
  spreader: THREE.Mesh
  cables: THREE.Mesh[]
  /** The container it is carrying (or has just set down). */
  load: THREE.Group
  x: number
}

interface BoatView {
  group: THREE.Group
  kind: BoatKind
}

interface LorryView {
  model: ContainerLorry
  arrive: Route
  leave: Route
  park: Pose
  last: THREE.Vector3
}

type ShipState = { pose: Pose; phase: 'in' | 'crabIn' | 'moored' | 'crabOut' | 'astern' | 'pivot' | 'out'; q: number }

/**
 * The harbour on the lake, drawn from `game.harbour`. Before the cargo dock: the round lake with the jetty and the marina and their boats.
 * With the cargo dock the lake is dug into the dock basin: the jetty moves to its north side, and its south quay is a container terminal
 * (quay cranes on rails, the container yard and its gantry, lorry bays, lanes, a gate, the access road and the port warehouse). Ships come
 * in with two tugs, are pushed sideways onto the berth, worked by the crane(s), and back out to sea. Lorries come and go through the gate.
 * Static parts are rebuilt (with their colliders) whenever what is built changes, so a new game takes them all away again.
 */
export class Harbour {
  readonly root = new THREE.Group()
  private readonly physics: PhysicsWorld
  private built = ''
  private parts: THREE.Group | null = null
  private bodies: RAPIER.RigidBody[] = []
  private cranes: CraneRig[] = []
  private gantry: Gantry | null = null
  private gates: THREE.Object3D[] = []
  private imports: THREE.Group[] = []
  private exports: THREE.Group[] = []
  private readonly ships: ShipModel[]
  private readonly tugs: THREE.Group[] = []
  private readonly lines: THREE.Mesh[] = []
  private readonly boats = new Map<number, BoatView>()
  private readonly lorries = new Map<number, LorryView>()
  /** The colour of the box each collecting lorry was given (taken from the stack when the gantry picks it). */
  private readonly lorryColour = new Map<number, number>()
  private basinMode = false
  private shipFor = -1

  constructor(physics: PhysicsWorld) {
    this.physics = physics
    this.ships = [0, 1, 2].map((size) => makeShip(size))
    for (const s of this.ships) {
      s.group.visible = false
      this.root.add(s.group)
    }
    for (let i = 0; i < 2; i++) {
      const tug = new THREE.Group()
      tug.add(kenney('boats', 'boat-tug-a', { x: 0, y: -0.45, z: 0, rotY: Math.PI, length: 7.5 }))
      tug.visible = false
      this.root.add(tug)
      this.tugs.push(tug)
    }
    for (let i = 0; i < 4; i++) {
      const line = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 6), mat(0xe7d9b8, 0.8))
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
    this.updateShip(lake && h.basin ? h.ship : null, now)
    this.updateTerminal(lake && h.basin ? h : null, now, dt)
  }

  // ------------------------------------------------------------------ building

  private rebuild(key: string, h: HarbourManager): void {
    this.parts?.removeFromParent()
    this.parts = null
    for (const b of this.bodies) this.physics.removeBody(b)
    this.bodies = []
    this.cranes = []
    this.gantry = null
    this.gates = []
    this.imports = []
    this.exports = []
    for (const v of this.lorries.values()) v.model.group.removeFromParent()
    this.lorries.clear()
    this.built = key
    this.basinMode = h.basin
    if (!key || !h.has('lake-road')) return
    const g = new THREE.Group()
    this.parts = g
    this.root.add(g)
    if (h.basin) this.buildBasin(g)
    this.buildRoad(g, h.basin)
    this.buildJetty(g, h.basin, h.has('lake-marina'))
    if (h.basin) {
      this.buildTerminal(g)
      const geo = H.crane.basin
      this.addRails(g, geo)
      for (let k = 0; k < h.cranes; k++) this.cranes.push(this.makeCrane(g, geo, h.cranes === 1 ? (geo.minX + geo.maxX) / 2 : k === 0 ? geo.minX + 6 : geo.maxX - 6))
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

  /** The jetty's line (z): on the round lake's south-east shore, or across the dock basin's north side, clear of the ships. */
  private jettyZ(basin: boolean): number {
    return basin ? J.basinZ : J.z
  }

  /** The timber jetty (and the marina's floating pontoon on beyond it), the footpath round to it, and the marina hut. */
  private buildJetty(g: THREE.Group, basin: boolean, marina: boolean): void {
    const jz = this.jettyZ(basin)
    const root = basin ? J.basinRootX : J.lakeRootX
    const tip = root - J.length
    const end = marina ? tip - J.marinaLength : tip
    const top = 0.08
    const depth = (basin ? -B.floorY : LAKE.depth) + 0.4
    const plank = woodMat(0x8a6a48)
    const darkWood = woodMat(0x4a3826)
    const start = root + 1.2 // the deck starts on the bank
    // Timber deck, side beams and piles.
    for (let x = start - 0.17; x > tip; x -= 0.34) this.box(0.3, 0.06, J.halfWidth * 2, plank, x, top - 0.03, jz, g)
    for (const s of [-1, 1]) {
      this.box(start - tip, 0.2, 0.14, darkWood, (start + tip) / 2, top - 0.16, jz + s * (J.halfWidth - 0.07), g)
      for (let x = root - 1; x >= tip; x -= 2.3) {
        const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, depth, 10), darkWood)
        pile.position.set(x, top - depth / 2 + 0.15, jz + s * (J.halfWidth - 0.05))
        pile.castShadow = true
        g.add(pile)
      }
    }
    // Cleats and fenders at each berth on the north side.
    const berths = [...H.jettyBerths, ...(marina ? H.marinaBerths : [])]
    for (const b of berths) {
      for (const dx of [-1.8, 1.8]) this.bollard(root - b + dx, top, jz + J.halfWidth - 0.25, g)
      const fender = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.7, 10), mat(0x1e40af, 0.6))
      fender.rotation.z = Math.PI / 2
      fender.position.set(root - b, top - 0.25, jz + J.halfWidth + 0.1)
      g.add(fender)
    }
    if (marina) {
      // The floating pontoon: a grey composite deck on blue floats, joined to the jetty's end by a short ramp.
      const deck = mat(0x9ca3af, 0.85)
      this.box(tip - end, 0.12, J.halfWidth * 2, deck, (tip + end) / 2, top - 0.06, jz, g)
      for (let x = tip - 1; x > end; x -= 2) {
        for (const s of [-1, 1]) {
          const float = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 1.6, 12), mat(0x1d4ed8, 0.6))
          float.rotation.z = Math.PI / 2
          float.position.set(x, top - 0.38, jz + s * (J.halfWidth - 0.35))
          g.add(float)
        }
      }
      this.box(0.08, 0.14, J.halfWidth * 2, mat(0x6b7280, 0.4, 0.6), tip, top + 0.01, jz, g)
      // The fuel pump at the far end, and a lifebuoy.
      const px = end + 0.6
      this.box(0.6, 1.3, 0.45, mat(0xdc2626, 0.5), px, top + 0.65, jz - 0.5, g)
      this.box(0.5, 0.35, 0.05, mat(0xf8fafc, 0.4), px, top + 1.0, jz - 0.25, g)
      const hose = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 6, 16), mat(0x111111, 0.8))
      hose.position.set(px + 0.33, top + 0.8, jz - 0.5)
      hose.rotation.y = Math.PI / 2
      g.add(hose)
      const fuel = makeSign('FUEL', 0.6, 0.22, '#7f1d1d', '#fef2f2')
      fuel.position.set(px, top + 1.45, jz - 0.5)
      fuel.rotation.y = Math.PI / 2
      g.add(fuel)
    }
    this.box(0.12, 1.2, 0.12, paintedSteel(0xe5e7eb), end + 0.3, top + 0.6, jz + J.halfWidth - 0.3, g)
    const buoy = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.08, 10, 24), mat(0xf97316, 0.6))
    buoy.position.set(end + 0.3, top + 0.85, jz + J.halfWidth - 0.2)
    buoy.rotation.y = Math.PI / 2
    g.add(buoy)
    // You walk on the deck; low rails (invisible) along its sides and its end keep you out of the water.
    this.solid(end, start, top - 0.1, top, jz - J.halfWidth, jz + J.halfWidth)
    for (const s of [-1, 1]) this.solid(end - 0.2, root - 0.6, 0, 1.2, jz + s * (J.halfWidth + 0.1) - 0.1, jz + s * (J.halfWidth + 0.1) + 0.1)
    this.solid(end - 0.4, end - 0.2, 0, 1.2, jz - J.halfWidth - 0.2, jz + J.halfWidth + 0.2)

    // The footpath: from the hard-standing (or the quay) along the shore to the jetty's root.
    const gravel = roofGravel(0xa8a29e)
    const px = basin ? H.path.basin.x : H.path.lake.x
    const fromX = basin ? B.maxX : LAKE.apron.maxX
    const connZ = basin ? -6.8 : -8
    const north = connZ + 0.8
    this.box(1.6, 0.02, north - (jz - 0.8), gravel, px, 0.01, (north + jz - 0.8) / 2, g, false)
    this.box(px - start + 0.8, 0.02, 1.6, gravel, (px + start) / 2, 0.01, jz, g, false)
    this.box(px + 0.8 - fromX, 0.02, 1.6, gravel, (px + 0.8 + fromX) / 2, 0.01, connZ, g, false)
    if (basin) {
      // On down the east side to the terminal's side gate.
      this.box(1.6, 0.02, jz - 0.8 - (QUAY_Z - 4), gravel, px, 0.01, (jz - 0.8 + QUAY_Z - 4) / 2, g, false)
      this.box(px - T.maxX + 0.8, 0.02, 1.6, gravel, (px + T.maxX) / 2, 0.01, QUAY_Z - 4, g, false)
    }
    if (marina) {
      // The marina hut beside the path.
      const hx = px + H.hut.dx
      const hz = jz + 1.5
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

  /** The dock basin: concrete walls, its north quay (taking in the hard-standing), the bed, and the water out through the channel. */
  private buildBasin(g: THREE.Group): void {
    const conc = concreteFloor(0xb4b0a8)
    const wallH = 0.05 - B.floorY
    const wy = 0.05 - wallH / 2
    const t = 0.5
    // The north quay: one slab from the basin's edge back to the hard-standing's far side, down into the water at its face.
    this.box(B.maxX - B.minX + t, wallH, H.basinQuayMaxZ - B.maxZ, conc, (B.minX - t + B.maxX) / 2, wy, (B.maxZ + H.basinQuayMaxZ) / 2, g)
    this.solid(B.minX - t, B.maxX, -0.2, 0.05, B.maxZ, H.basinQuayMaxZ)
    this.edgeDetails(g, B.minX + 0.5, B.maxX - 0.5, B.maxZ, 0.05, -1)
    // East and south walls (the south one is the terminal's quay wall), and the west wall either side of the channel.
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

  /**
   * Along a quay's water face (at `faceZ`): a yellow edge line, bollards and black fenders. `water` is the side the water is on
   * (−1: to the south, +1: to the north).
   */
  private edgeDetails(g: THREE.Group, minX: number, maxX: number, faceZ: number, top: number, water: -1 | 1): void {
    const land = -water
    this.box(maxX - minX, 0.006, 0.15, mat(0xf2c94c, 0.6), (minX + maxX) / 2, top + 0.003, faceZ + land * 0.55, g, false)
    for (let x = minX + 1.5; x < maxX - 0.5; x += 3.5) this.bollard(x, top, faceZ + land * 0.32, g)
    const rubber = mat(0x111111, 0.9)
    for (let x = minX + 0.8; x < maxX; x += 2.6) this.box(0.5, 1.4, 0.25, rubber, x, top - 0.85, faceZ + water * 0.12, g)
  }

  /**
   * The container terminal on the south quay: concrete with painted markings, the yard's stack footprints and the gantry's runways, the
   * loading bays, the lanes and the gate, the access road, the port warehouse, floodlight masts and a perimeter fence.
   */
  private buildTerminal(g: THREE.Group): void {
    const c = concreteFloor(0xb7b3ab)
    const white = mat(0xf8fafc, 0.6)
    const yellow = mat(0xf2c230, 0.6)
    const asphalt = roadAsphalt(0x3a3d43)
    const north = QUAY_Z - 0.5
    // Concrete across the whole terminal, and the quay edge's markings.
    this.box(T.maxX - T.minX, 0.03, north - T.minZ, c, (T.minX + T.maxX) / 2, 0.016, (north + T.minZ) / 2, g, false)
    this.edgeDetails(g, T.minX + 1, T.maxX - 1, QUAY_Z, 0.05, 1)
    const hz = QUAY_Z - 2.2
    for (let x = T.minX + 1; x < T.maxX - 1; x += 1.2) {
      const stripe = this.box(0.5, 0.008, 0.28, (Math.round((x - T.minX) / 1.2) % 2 ? yellow : mat(0x16171a, 0.7)), x, 0.035, hz, g, false)
      stripe.rotation.y = 0.6
    }
    // Stack footprints (white boxes on the ground), the gantry's runways (yellow), and the bays (yellow, with STOP bars).
    const outline = (x: number, z: number, w: number, d: number, m: THREE.Material) => {
      this.box(w, 0.008, 0.1, m, x, 0.036, z - d / 2, g, false)
      this.box(w, 0.008, 0.1, m, x, 0.036, z + d / 2, g, false)
      this.box(0.1, 0.008, d, m, x - w / 2, 0.036, z, g, false)
      this.box(0.1, 0.008, d, m, x + w / 2, 0.036, z, g, false)
    }
    for (const x of T.columns) {
      for (const z of [...T.importRows, ...T.exportRows]) outline(x, z, BOX.l + 0.3, BOX.w + 0.2, white)
      outline(x, T.bayContainerZ - 1.0, 3.0, 11.0, yellow)
      this.box(2.6, 0.008, 0.3, white, x, 0.036, T.bayContainerZ + 3.6, g, false)
    }
    for (const z of [T.gantry.northZ, T.gantry.southZ]) this.box(T.gantry.maxX - T.gantry.minX + 9, 0.008, 1.0, mat(0x7a6a2a, 0.8), (T.gantry.minX + T.gantry.maxX) / 2, 0.034, z, g, false)
    const yardSign = makeSign('IMPORTS', 2.4, 0.5, '#0f172a', '#fde68a')
    yardSign.position.set(T.columns[0]! - 4.6, 2.2, (T.importRows[0]! + T.importRows[1]!) / 2)
    yardSign.rotation.y = -Math.PI / 2
    const expSign = makeSign('EXPORTS', 2.4, 0.5, '#0f172a', '#a7f3d0')
    expSign.position.set(T.columns[0]! - 4.6, 2.2, (T.exportRows[0]! + T.exportRows[1]!) / 2)
    expSign.rotation.y = -Math.PI / 2
    g.add(yardSign, expSign)
    for (const s of [yardSign, expSign]) this.box(0.1, 2.0, 0.1, paintedSteel(0x6b7280), s.position.x, 1.0, s.position.z, g)

    // Lanes (in westwards, out eastwards) with arrows, and the road away south through the gate.
    const laneW = 3.4
    const laneEast = T.road.inX + 1.7
    for (const z of [T.laneIn, T.laneOut]) {
      this.box(laneEast - T.laneWestX, 0.03, laneW, asphalt, (laneEast + T.laneWestX) / 2, 0.02, z, g, false)
      for (let x = T.laneWestX + 2; x < laneEast - 1; x += 5) this.box(2.4, 0.008, 0.14, white, x, 0.04, z + (z === T.laneIn ? laneW / 2 - 0.15 : -laneW / 2 + 0.15), g, false)
    }
    const roadW = T.road.inX - T.road.outX + 3.4
    const roadX = (T.road.inX + T.road.outX) / 2
    this.box(roadW, 0.03, T.laneOut - laneW / 2 - T.road.minZ, asphalt, roadX, 0.02, (T.laneOut - laneW / 2 + T.road.minZ) / 2, g, false)
    for (let z = T.laneOut - 4; z > T.road.minZ; z -= 4) this.box(0.14, 0.008, 2.2, yellow, roadX, 0.04, z, g, false)
    // The gate: a booth, a canopy and two barrier arms (which lift for a lorry).
    this.box(2.2, 2.6, 2.2, mat(0xe2e8f0, 0.7), T.road.inX + 4.2, 1.3, T.gateZ, g)
    this.box(2.6, 0.15, 2.6, mat(0xc0392b, 0.6), T.road.inX + 4.2, 2.68, T.gateZ, g)
    this.box(0.05, 0.9, 1.4, mat(0x1d2633, 0.15, 0.5), T.road.inX + 3.08, 1.6, T.gateZ, g)
    const gateSign = makeSign('TERMINAL GATE', 3.2, 0.5, '#0f172a', '#fde68a')
    gateSign.position.set(roadX, 5.6, T.gateZ)
    gateSign.rotation.y = Math.PI
    g.add(gateSign)
    for (const x of [T.road.outX - 2.2, T.road.inX + 2.2]) this.box(0.3, 6.0, 0.3, paintedSteel(0x374151), x, 3.0, T.gateZ, g)
    this.box(T.road.inX - T.road.outX + 4.7, 0.4, 0.4, paintedSteel(0x374151), roadX, 5.9, T.gateZ, g)
    for (const [x, dir] of [[T.road.inX + 1.6, -1], [T.road.outX - 1.6, 1]] as const) {
      const arm = new THREE.Group()
      arm.position.set(x, 1.05, T.gateZ - 0.4)
      const bar = this.box(3.0, 0.1, 0.1, mat(0xf8fafc, 0.5), (dir * 3.0) / 2, 0, 0, arm)
      for (let k = 0; k < 3; k++) this.box(0.4, 0.105, 0.105, mat(0xdc2626, 0.5), dir * (0.5 + k * 0.9), 0, 0, bar.parent!)
      this.box(0.3, 1.0, 0.3, mat(0xf2c230, 0.5), 0, -0.5, 0, arm)
      arm.userData.dir = dir
      g.add(arm)
      this.gates.push(arm)
    }

    // The port warehouse east of the yard: corrugated walls, a pitched roof, roller doors to the yard.
    const w = T.warehouse
    const cx = (w.minX + w.maxX) / 2
    const cz = (w.minZ + w.maxZ) / 2
    const W = w.maxX - w.minX
    const D = w.maxZ - w.minZ
    const wallH = 7
    this.box(W, wallH, D, shedCladding(0x5b6b7d), cx, wallH / 2, cz, g)
    const roof = shedRoof(0x9aa3ad)
    for (const s of [-1, 1]) {
      const half = new THREE.Mesh(metreUVs(new THREE.BoxGeometry(W / 2 + 0.5, 0.12, D + 0.6)), roof)
      half.position.set(cx + s * (W / 4 + 0.1), wallH + 0.55, cz)
      half.rotation.z = -s * 0.2
      half.castShadow = true
      g.add(half)
    }
    for (const z of [w.minZ, w.maxZ]) {
      const tri = new THREE.Shape([new THREE.Vector2(-W / 2, 0), new THREE.Vector2(W / 2, 0), new THREE.Vector2(0, (W / 2) * Math.tan(0.2))])
      const m = new THREE.Mesh(new THREE.ShapeGeometry(tri), shedCladding(0x5b6b7d))
      m.position.set(cx, wallH, z + (z === w.minZ ? -0.01 : 0.01))
      if (z === w.minZ) m.rotation.y = Math.PI
      g.add(m)
    }
    for (const dz of [-4, 4]) {
      this.box(0.06, 4.4, 4.2, mat(0x9ca3af, 0.5, 0.4), w.minX - 0.04, 2.2, cz + dz, g)
      for (let y = 0.25; y < 4.4; y += 0.25) this.box(0.02, 0.03, 4.2, mat(0x6b7280, 0.5, 0.4), w.minX - 0.08, y, cz + dz, g, false)
      this.box(0.4, 0.4, 4.6, paintedSteel(0x374151), w.minX - 0.2, 4.6, cz + dz, g)
    }
    const sign = makeSign('PORT WAREHOUSE', 4.0, 0.6, '#0f172a', '#fde68a')
    sign.position.set(w.minX - 0.05, 5.8, cz)
    sign.rotation.y = -Math.PI / 2
    g.add(sign)
    this.solid(w.minX, w.maxX, 0, wallH, w.minZ, w.maxZ)

    // Floodlight masts at the corners of the yard, with glowing heads.
    const head = new THREE.MeshStandardMaterial({ color: 0xfff4dc, emissive: 0xffe2a8, emissiveIntensity: 1.6 })
    for (const [x, z] of [[T.minX + 1.5, QUAY_Z - 5], [T.minX + 1.5, T.laneIn + 3], [T.maxX - 1.5, QUAY_Z - 5], [T.maxX - 1.5, T.minZ + 2]] as const) {
      this.box(0.35, 18, 0.35, paintedSteel(0x6b7280), x, 9, z, g)
      this.box(2.4, 0.5, 0.8, paintedSteel(0x374151), x, 18.2, z, g)
      this.box(2.2, 0.06, 0.6, head, x, 17.93, z, g, false)
      this.solid(x - 0.2, x + 0.2, 0, 4, z - 0.2, z + 0.2)
    }

    // The perimeter fence: wire mesh on posts, with the gate (road) and a side gate on the east (the path from the jetty).
    const mesh = wireMesh()
    const post = paintedSteel(0x4b5563)
    const fence = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0)
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(len, 2.2), mesh)
      panel.position.set((x0 + x1) / 2, 1.1, (z0 + z1) / 2)
      panel.rotation.y = -Math.atan2(z1 - z0, x1 - x0)
      g.add(panel)
      for (let k = 0; k <= Math.ceil(len / 3); k++) {
        const f = Math.min(1, (k * 3) / len)
        this.box(0.08, 2.3, 0.08, post, lerp(x0, x1, f), 1.15, lerp(z0, z1, f), g)
      }
      this.solid(Math.min(x0, x1) - 0.1, Math.max(x0, x1) + 0.1, 0, 2.2, Math.min(z0, z1) - 0.1, Math.max(z0, z1) + 0.1)
    }
    fence(T.minX, north, T.minX, T.minZ)
    fence(T.minX, T.minZ, T.road.outX - 2.4, T.minZ)
    fence(T.road.inX + 2.4, T.minZ, T.maxX, T.minZ)
    fence(T.maxX, T.minZ, T.maxX, QUAY_Z - 5)
    fence(T.maxX, QUAY_Z - 3, T.maxX, north)

    // The containers in the yard: import stacks (3 high) and export stacks (2 high), shown as many as the yard holds.
    const slot = (rows: readonly number[], tiers: number, out: THREE.Group[], shift: number) => {
      for (let tier = 0; tier < tiers; tier++)
        for (const x of T.columns)
          for (const z of rows) {
            const box = makeContainer(COLOURS[(out.length * 3 + shift) % COLOURS.length]!)
            box.position.set(x, 0.05 + BOX.h / 2 + tier * (BOX.h + 0.02), z)
            box.visible = false
            g.add(box)
            out.push(box)
          }
    }
    slot(T.importRows, T.importTiers, this.imports, 0)
    slot(T.exportRows, T.exportTiers, this.exports, 5)
    this.orderYard(this.imports)
    this.orderYard(this.exports)

    // The yard gantry.
    this.gantry = makeGantry(T.gantry.northZ, T.gantry.southZ)
    g.add(this.gantry.group)
    poseGantry(this.gantry, (T.gantry.minX + T.gantry.maxX) / 2, (T.gantry.northZ + T.gantry.southZ) / 2, YARD_CLEAR, 0, false)
  }

  /** Fill order for a stack area: bottom tier first, column by column, so the stacks grow evenly and the top box is the last one. */
  private orderYard(list: THREE.Group[]): void {
    list.sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x || b.position.z - a.position.z)
  }

  /** The crane's rails, along the quay at the waterside and landside legs. */
  private addRails(g: THREE.Group, geo: CraneGeo): void {
    for (const z of [geo.waterZ, geo.landZ]) this.box(geo.maxX - geo.minX + 9, 0.06, 0.18, mat(0x52525b, 0.4, 0.8), (geo.minX + geo.maxX) / 2, geo.topY + 0.03, z, g, false)
  }

  /** A ship-to-shore crane: four legs on bogies, a portal, the boom over the water with a trolley, hoist ropes and a yellow spreader. */
  private makeCrane(g: THREE.Group, geo: CraneGeo, x: number): CraneRig {
    const group = new THREE.Group()
    group.position.x = x
    const steel = paintedSteel(0x1d4ed8)
    const white = paintedSteel(0xf1f5f9)
    const y0 = geo.topY
    const legH = BOOM_Y - 0.5 - y0
    const out = Math.sign(geo.outZ - geo.backZ)
    for (const z of [geo.waterZ, geo.landZ])
      for (const s of [-1, 1]) {
        this.box(0.6, legH, 0.6, steel, s * 3.0, y0 + legH / 2 + 0.5, z, group)
        this.box(1.4, 0.5, 1.1, mat(0x374151, 0.6, 0.4), s * 3.0, y0 + 0.25, z, group)
        for (const dx of [-0.45, 0.45]) {
          const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.3, 14), mat(0x1f2937, 0.5, 0.6))
          wheel.rotation.x = Math.PI / 2
          wheel.position.set(s * 3.0 + dx, y0 + 0.28, z)
          group.add(wheel)
        }
      }
    // The portal: beams along z joining the legs at two heights, and across x; diagonal braces.
    for (const s of [-1, 1]) {
      this.box(0.5, 0.7, Math.abs(geo.landZ - geo.waterZ), steel, s * 3.0, 8.0, (geo.waterZ + geo.landZ) / 2, group)
      this.box(0.4, 0.4, Math.abs(geo.landZ - geo.waterZ), steel, s * 3.0, 4.2, (geo.waterZ + geo.landZ) / 2, group)
    }
    for (const z of [geo.waterZ, geo.landZ]) this.box(6.6, 0.6, 0.6, steel, 0, BOOM_Y - 0.5, z, group)
    // The boom (two girders) from the backreach out over the water, the A-frame and its stays.
    const boomLen = Math.abs(geo.backZ - geo.outZ)
    const boomZ = (geo.backZ + geo.outZ) / 2
    for (const s of [-1, 1]) this.box(0.4, 1.0, boomLen, white, s * 1.2, BOOM_Y, boomZ, group)
    const apexY = BOOM_Y + 6
    for (const s of [-1, 1]) this.box(0.4, apexY - BOOM_Y, 0.4, white, s * 1.2, (BOOM_Y + apexY) / 2, geo.landZ, group)
    for (const end of [geo.outZ, geo.backZ]) {
      const from = new THREE.Vector3(0, apexY, geo.landZ)
      const to = new THREE.Vector3(0, BOOM_Y + 0.4, end)
      const stay = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, from.distanceTo(to), 6), mat(0x9ca3af, 0.4, 0.8))
      stay.position.copy(from).add(to).multiplyScalar(0.5)
      stay.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize())
      group.add(stay)
    }
    // The machinery house over the backreach and the driver's cab under the boom.
    this.box(3.4, 2.4, 3.6, white, 0, BOOM_Y + 1.7, geo.backZ + out * 2.0, group)
    this.box(1.6, 1.5, 1.6, white, 1.6, BOOM_Y - 1.4, geo.waterZ + out * 1.8, group)
    this.box(1.62, 0.7, 0.02, mat(0x1e293b, 0.15, 0.5), 1.6, BOOM_Y - 1.3, geo.waterZ + out * 2.61, group, false)
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3b30 }))
    lamp.position.set(0, apexY + 0.25, geo.landZ)
    group.add(lamp)
    const name = makeSign('QC ' + (this.cranes.length + 1), 1.8, 0.5, '#1d4ed8', '#f8fafc')
    name.position.set(3.32, 6.5, geo.landZ)
    name.rotation.y = Math.PI / 2
    group.add(name)
    // The trolley, its ropes and the spreader.
    const trolley = this.box(2.4, 0.6, 2.4, mat(0x374151, 0.5, 0.5), 0, BOOM_Y - 0.65, geo.dropZ, group)
    const cables = [-0.9, 0.9].map((dx) => {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 6), mat(0x111111, 0.4, 0.8))
      c.position.x = dx
      group.add(c)
      return c
    })
    const spreader = this.box(BOX.l + 0.1, 0.24, BOX.w + 0.06, armYellow(), 0, CLEAR_Y, geo.dropZ, group)
    const load = makeContainer(COLOURS[0]!)
    load.visible = false
    g.add(load)
    g.add(group)
    // Its legs are solid (you walk round them, or between them).
    return { group, trolley, spreader, cables, load, x }
  }

  // ------------------------------------------------------------------ boats

  /** A boat's berth (on the jetty's north side) in the current harbour, with its moored heading (bow east). */
  private berth(kind: BoatKind, slot: number): { x: number; z: number } {
    const root = this.basinMode ? J.basinRootX : J.lakeRootX
    const along = kind === 'motor' ? H.marinaBerths[slot] ?? H.marinaBerths[0] : H.jettyBerths[slot] ?? H.jettyBerths[0]
    return { x: root - along, z: this.jettyZ(this.basinMode) + J.halfWidth + 0.15 + BOAT[kind].beam / 2 }
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

  /** The way in from the sea to just off a berth: straight along the lake's lane, or (in the dock) up the channel, then north of the jetty. */
  private boatWay(b: { x: number; z: number }): [number, number][] {
    if (!this.basinMode) {
      const lane = H.boatLane
      return [[SEA_X, lane], [-60, lane], [b.x - 7, lane]]
    }
    // In the dock: up the channel, then round the west end of the jetty (and marina) and along north of it.
    const lane = H.boatLaneBasin
    return [[SEA_X, CH.z], [-62, CH.z], [-52, CH.z], [-46, lane], [b.x - 7, lane]]
  }

  /** In along the lane and into the berth; out: back off, turn round on the spot, and away the way it came. */
  private boatPose(v: BoatVisit, now: number): Pose | null {
    const b = this.berth(v.kind, v.slot)
    const way = this.boatWay(b)
    const lane = way[way.length - 1]![1]
    if (now < v.mooredAt) {
      const p = (now - v.spawnAt) / (v.mooredAt - v.spawnAt)
      const leg = rounded([...way, [b.x - 3, b.z], [b.x, b.z]], 2.5)
      return leg.at(1 - (1 - Math.max(0, p)) ** 2)
    }
    if (now < v.leaveAt) return { x: b.x, z: b.z, yaw: -Math.PI / 2 }
    const q = (now - v.leaveAt) / (v.goneAt - v.leaveAt)
    // Back off towards the lane, turn round, and leave the way it came.
    const back = { x: b.x - 4, z: b.z + (lane - b.z) * 0.5 }
    if (q < 0.12) return rounded([[b.x, b.z], [back.x, back.z]], 1, true).at(smooth(q / 0.12))
    if (q < 0.25) {
      const yaw = -Math.PI / 2 + Math.PI * smooth((q - 0.12) / 0.13)
      return { x: back.x, z: back.z, yaw }
    }
    const leg = rounded([[back.x, back.z], [back.x - 4, lane], ...[...way].reverse().slice(1)], 2.5)
    const p = (q - 0.25) / 0.75
    return leg.at(p * p)
  }

  // ------------------------------------------------------------------ the ship

  /** The ship's berth for its size: alongside the terminal's quay, bow east. */
  private shipBerth(size: number): { x: number; z: number } {
    const def = CONFIG.harbour.ships[size]!
    return { x: H.berthX.basin, z: QUAY_Z + 0.45 + def.beam / 2 }
  }

  /** The way in: up the channel, into the dock, and along to a point `OFF_BERTH` off the berth (from where the tugs push it alongside). */
  private shipWay(size: number): [number, number][] {
    const b = this.shipBerth(size)
    return [[SEA_X, CH.z], [-66, CH.z], [-54, CH.z], [b.x - 13, b.z + OFF_BERTH], [b.x, b.z + OFF_BERTH]]
  }

  private shipState(s: ShipVisit, now: number): ShipState {
    const b = this.shipBerth(s.size)
    const off = { x: b.x, z: b.z + OFF_BERTH }
    const east = -Math.PI / 2
    if (now < s.mooredAt) {
      const q = (now - s.spawnAt) / (s.mooredAt - s.spawnAt)
      if (q < 0.8) return { pose: rounded(this.shipWay(s.size), 8).at(1 - (1 - Math.max(0, q / 0.8)) ** 2), phase: 'in', q }
      // It holds off the berth while the tugs come alongside (0.8…0.88), then they push it in.
      const k = smooth((q - 0.88) / 0.12)
      return { pose: { x: off.x, z: lerp(off.z, b.z, k), yaw: east + Math.sin(k * Math.PI) * 0.015 }, phase: 'crabIn', q }
    }
    if (now < s.leaveAt) return { pose: { x: b.x, z: b.z, yaw: east }, phase: 'moored', q: 0 }
    const q = Math.min(1, (now - s.leaveAt) / (s.goneAt - s.leaveAt))
    if (q < 0.14) return { pose: { x: b.x, z: lerp(b.z, off.z, smooth(q / 0.14)), yaw: east }, phase: 'crabOut', q }
    const turnX = -96
    if (q < 0.6) {
      const leg = rounded([...this.shipWay(s.size)].reverse().slice(0, -1).concat([[turnX, CH.z]]), 8, true)
      return { pose: leg.at(smooth((q - 0.14) / 0.46)), phase: 'astern', q }
    }
    if (q < 0.72) return { pose: { x: turnX, z: CH.z, yaw: east + Math.PI * smooth((q - 0.6) / 0.12) }, phase: 'pivot', q }
    const k = (q - 0.72) / 0.28
    return { pose: { x: lerp(turnX, SEA_X, k * k), z: CH.z, yaw: Math.PI / 2 }, phase: 'out', q }
  }

  private updateShip(s: ShipVisit | null, now: number): void {
    for (const m of this.ships) m.group.visible = false
    for (const l of this.lines) l.visible = false
    if (!s) {
      // Between ships the tugs wait in the dock, south of the jetty.
      const z = J.basinZ - J.halfWidth - 4.5
      this.tugs.forEach((t, i) => {
        t.visible = this.basinMode && this.built !== ''
        t.position.set(i === 0 ? B.maxX - 4.5 : B.maxX - 13, BASIN_Y + Math.sin(now * 1.4 + i) * 0.05, z)
        t.rotation.set(0, Math.PI / 2, Math.sin(now * 1.1 + i * 2) * 0.03)
      })
      this.idleCranes()
      return
    }
    const model = this.ships[s.size]!
    if (this.shipFor !== s.id) {
      this.shipFor = s.id
      setShipName(model, s.name)
      model.containers.forEach((c, i) => setContainerColour(c, COLOURS[(i * 7 + s.id) % COLOURS.length]!))
    }
    const state = this.shipState(s, now)
    const pose = state.pose
    const g = model.group
    g.visible = true
    g.position.set(pose.x, BASIN_Y + Math.sin(now * 0.8) * 0.03, pose.z)
    g.rotation.set(0, pose.yaw, Math.sin(now * 0.6) * 0.004)
    g.updateMatrixWorld(true)
    this.updateTugs(s, state, now)

    // Which containers are aboard, and the cranes' jobs: imports come off (top tier first), then exports go on (bottom tier first).
    const per = CONFIG.harbour.unloadSeconds
    const t = now - s.mooredAt
    const moored = now >= s.mooredAt && now < s.leaveAt
    const lists = craneTasks(s)
    const onBoard = new Array<boolean>(model.containers.length).fill(false)
    for (let i = 0; i < s.containers; i++) onBoard[i] = now < s.mooredAt
    lists.forEach((list) =>
      list.forEach((task, round) => {
        if (task.kind === 'in') onBoard[task.slot] = !moored ? now < s.mooredAt : t < (round + 0.38) * per
        else onBoard[task.slot] = moored ? t >= (round + 0.62) * per : now >= s.leaveAt
      }),
    )
    model.containers.forEach((c, i) => (c.visible = onBoard[i]!))
    if (!moored) this.idleCranes()
    else {
      const round = Math.floor(t / per)
      const u = (t - round * per) / per
      this.cranes.forEach((crane, k) => {
        const list = lists[k]
        const task = list?.[round]
        if (!task) return this.idle(crane)
        const at = model.containers[task.slot]!.getWorldPosition(new THREE.Vector3())
        const colour = (model.containers[task.slot]!.getObjectByName('body') as THREE.Mesh | undefined)?.userData.colour as number | undefined
        if (task.kind === 'in') {
          const prev = list[round - 1]
          const from = prev ? model.containers[prev.slot]!.getWorldPosition(new THREE.Vector3()).x : crane.x
          this.craneJob(crane, u, from, at, colour ?? COLOURS[0]!)
        } else {
          const next = list[round + 1]
          const to = next ? model.containers[next.slot]!.getWorldPosition(new THREE.Vector3()).x : at.x
          this.craneJob(crane, 1 - u, to, at, colour ?? COLOURS[0]!)
        }
      })
    }

    // Mooring lines, head, springs and stern, to bollards on the quay while it is alongside.
    if (moored || state.phase === 'crabIn' || state.phase === 'crabOut') {
      const def = CONFIG.harbour.ships[s.size]!
      const L = def.length
      ;[-L / 2 + 1.5, -L / 6, L / 6, L / 2 - 2.5].forEach((dx, i) => {
        const line = this.lines[i]!
        const from = new THREE.Vector3(pose.x + dx, BASIN_Y + DECK + 0.3, pose.z - def.beam / 2 + 0.3)
        const to = new THREE.Vector3(pose.x + dx * (i === 1 || i === 2 ? 0.4 : 1.15), 0.45, QUAY_Z - 0.32)
        line.visible = moored
        line.position.copy(from).add(to).multiplyScalar(0.5)
        line.scale.set(1, from.distanceTo(to), 1)
        line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize())
      })
    }
  }

  /**
   * The two tugs. They wait in the dock, south of the jetty (clear of everything), while a ship comes up the channel; once it has
   * stopped off its berth they come alongside and push it in, then go back to wait while it is worked; when it leaves they pull it
   * off the berth and go back again while it backs out on its own. Every move is between spots that are clear of the ship, the
   * quays and the jetty, along lines that stay clear too.
   */
  private updateTugs(s: ShipVisit, state: ShipState, now: number): void {
    const def = CONFIG.harbour.ships[s.size]!
    const jettySouth = J.basinZ - J.halfWidth
    const wait = [
      { x: B.maxX - 4.5, z: jettySouth - 4.5, yaw: Math.PI / 2 },
      { x: B.maxX - 13, z: jettySouth - 4.5, yaw: Math.PI / 2 },
    ]
    // Alongside the north side, bows against the hull (a tug is 7.5 m long), following the ship while it moves sideways.
    const pushAt = (p: Pose) => {
      const z = Math.min(p.z + def.beam / 2 + 3.9, jettySouth - 4.1)
      return [
        { x: p.x + def.length / 4, z, yaw: 0 },
        { x: p.x - def.length / 4, z, yaw: 0 },
      ]
    }
    const b = this.shipBerth(s.size)
    const push = pushAt(state.pose)
    const pushOff = pushAt({ x: b.x, z: b.z + OFF_BERTH, yaw: 0 })
    let poses = wait
    if (state.phase === 'crabIn') poses = state.q < 0.88 ? wait.map((w, i) => blendPose(w, pushOff[i]!, span(state.q, 0.8, 0.87))) : push
    else if (state.phase === 'moored') {
      const k = Math.min(span(now - s.mooredAt, 0, 10), span(s.leaveAt - now, 0, 10))
      poses = push.map((p, i) => blendPose(p, wait[i]!, k))
    } else if (state.phase === 'crabOut') poses = push
    else if (state.phase === 'astern') poses = pushOff.map((p, i) => blendPose(p, wait[i]!, span(state.q, 0.14, 0.26)))
    this.tugs.forEach((tug, i) => {
      const p = poses[i]!
      tug.visible = true
      tug.position.set(p.x, BASIN_Y + Math.sin(now * 1.4 + i) * 0.05, p.z)
      tug.rotation.set(0, p.yaw, Math.sin(now * 1.1 + i * 2) * 0.03)
    })
  }

  private idleCranes(): void {
    for (const c of this.cranes) this.idle(c)
  }

  private idle(c: CraneRig): void {
    const geo = H.crane.basin
    c.group.position.x = c.x
    this.pose(c, geo.dropZ, CLEAR_Y)
    c.load.visible = false
  }

  /** Put the trolley at `z` and the spreader at height `y`, ropes between them. */
  private pose(c: CraneRig, z: number, y: number): void {
    c.trolley.position.z = z
    c.spreader.position.set(0, y, z)
    const top = BOOM_Y - 0.95
    for (const cable of c.cables) {
      cable.position.set(cable.position.x, (top + y + 0.12) / 2, z)
      cable.scale.set(1, Math.max(0.05, top - y - 0.12), 1)
    }
  }

  /**
   * One container's lift, `u` 0…1 of the job: travel along the rails to it (from the last one's column) with the trolley running out, lower,
   * grab, lift clear, run back over the quay, set it down, let go and lift; the container then goes off to the yard. Run backwards
   * (`u` from 1 to 0) it is an export going on board: picked up from the quay, carried out and set down in its slot.
   */
  private craneJob(c: CraneRig, u: number, fromX: number, at: THREE.Vector3, colour: number): void {
    const geo = H.crane.basin
    const x = THREE.MathUtils.clamp(at.x, geo.minX, geo.maxX)
    const fx = THREE.MathUtils.clamp(fromX, geo.minX, geo.maxX)
    c.group.position.x = fx + (x - fx) * span(u, 0, 0.18)
    const grabY = at.y + BOX.h / 2 + 0.12
    const dropY = geo.topY + BOX.h + 0.12
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
    setContainerColour(load, colour)
    if (held) load.position.set(c.group.position.x, y - 0.12 - BOX.h / 2, z)
    else if (sitting) load.position.set(c.group.position.x, geo.topY + BOX.h / 2, geo.dropZ)
  }

  // ------------------------------------------------------------------ the terminal: yard, gantry, lorries, gate

  /** The yard slot `i` (in fill order) of the imports or the exports. */
  private yardSlot(list: THREE.Group[], i: number): THREE.Group | undefined {
    return list[Math.max(0, Math.min(list.length - 1, i))]
  }

  private updateTerminal(h: HarbourManager | null, now: number, dt: number): void {
    if (!h || !this.gantry) {
      for (const v of this.lorries.values()) v.model.group.removeFromParent()
      this.lorries.clear()
      return
    }
    const L = CONFIG.harbour.lorry
    // The lorry the gantry is working, and how far through.
    const job = h.lorries.find((l) => now >= l.handleAt && now < l.handledAt) ?? null
    const u = job ? (now - job.handleAt) / (job.handledAt - job.handleAt) : 0
    const picked = !!job && job.job === 'collect' && u >= 0.34
    const placed = !!job && job.job === 'deliver' && u >= 0.82
    const importsShown = Math.max(0, h.stock - (picked ? 1 : 0))
    const exportsShown = Math.min(this.exports.length, h.exports + (placed ? 1 : 0))
    this.imports.forEach((c, i) => (c.visible = i < importsShown))
    this.exports.forEach((c, i) => (c.visible = i < exportsShown))

    // Lorries.
    const alive = new Set(h.lorries.map((l) => l.id))
    for (const [id, view] of this.lorries) {
      if (alive.has(id)) continue
      view.model.group.removeFromParent()
      this.lorries.delete(id)
      this.lorryColour.delete(id)
    }
    for (const l of h.lorries) {
      let view = this.lorries.get(l.id)
      if (!view) {
        view = this.makeLorryView(l)
        this.lorries.set(l.id, view)
        this.parts?.add(view.model.group)
      }
      this.updateLorry(view, l, now, dt)
    }

    // The gantry.
    const g = this.gantry
    const midX = (T.gantry.minX + T.gantry.maxX) / 2
    const midZ = (T.gantry.northZ + T.gantry.southZ) / 2
    if (!job) {
      poseGantry(g, midX, midZ, YARD_CLEAR, 0, false)
    } else {
      const bay = { x: T.columns[job.bay]!, z: T.bayContainerZ, y: LORRY_DECK, rot: Math.PI / 2 }
      const stackOf = (c: THREE.Group | undefined) => (c ? { x: c.position.x, z: c.position.z, y: c.position.y - BOX.h / 2, rot: 0 } : bay)
      const src = job.job === 'collect' ? stackOf(this.yardSlot(this.imports, h.stock - 1)) : bay
      const dst = job.job === 'collect' ? bay : stackOf(this.yardSlot(this.exports, h.exports))
      const stackColour = this.yardSlot(this.imports, h.stock - 1)?.getObjectByName('body')?.userData.colour as number | undefined
      if (job.job === 'collect' && !this.lorryColour.has(job.id)) this.lorryColour.set(job.id, stackColour ?? COLOURS[0]!)
      const colour = job.job === 'collect' ? this.lorryColour.get(job.id)! : COLOURS[job.colour % COLOURS.length]!
      setContainerColour(g.load, colour)
      let x = midX
      let z = midZ
      let y = YARD_CLEAR
      let rot = 0
      let carrying = false
      if (u < 0.2) {
        x = lerp(midX, src.x, span(u, 0, 0.2))
        z = lerp(midZ, src.z, span(u, 0, 0.2))
        rot = src.rot * span(u, 0, 0.2)
      } else if (u < 0.34) {
        x = src.x
        z = src.z
        rot = src.rot
        y = lerp(YARD_CLEAR, src.y + BOX.h, span(u, 0.2, 0.32))
      } else if (u < 0.48) {
        x = src.x
        z = src.z
        rot = src.rot
        y = lerp(src.y + BOX.h, YARD_CLEAR, span(u, 0.36, 0.48))
        carrying = true
      } else if (u < 0.66) {
        const k = span(u, 0.48, 0.66)
        x = lerp(src.x, dst.x, k)
        z = lerp(src.z, dst.z, k)
        rot = lerp(src.rot, dst.rot, k)
        carrying = true
      } else if (u < 0.82) {
        x = dst.x
        z = dst.z
        rot = dst.rot
        y = lerp(YARD_CLEAR, dst.y + BOX.h, span(u, 0.66, 0.78))
        carrying = true
      } else {
        x = lerp(dst.x, midX, span(u, 0.9, 1))
        z = lerp(dst.z, midZ, span(u, 0.9, 1))
        rot = dst.rot * (1 - span(u, 0.9, 1))
        y = lerp(dst.y + BOX.h, YARD_CLEAR, span(u, 0.82, 0.92))
      }
      poseGantry(g, x, z, y, rot, carrying)
    }

    // The gate's barriers lift for a lorry close by.
    for (const arm of this.gates) {
      const ax = arm.position.x
      const near = [...this.lorries.values()].some((v) => Math.abs(v.model.group.position.z - T.gateZ) < 9 && Math.abs(v.model.group.position.x - ax) < 4)
      const target = near ? 1.35 : 0
      const dir = arm.userData.dir as number
      arm.rotation.z += (dir * target - arm.rotation.z) * Math.min(1, dt * 4)
    }
    void L
  }

  private makeLorryView(l: LorryVisit): LorryView {
    const model = makeContainerLorry(LORRY_COLOURS[l.id % LORRY_COLOURS.length]!, { plate: `CT-${String(1000 + ((l.id * 7919) % 9000)).slice(0, 4)}` })
    const bx = T.columns[l.bay]!
    const bz = T.bayOriginZ
    const arrive = new Route([
      rounded([[T.road.inX, T.road.minZ], [T.road.inX, T.laneIn], [bx - 7, T.laneIn]], 5),
      rounded([[bx - 7, T.laneIn], [bx, T.laneIn], [bx, bz]], 5.5, true),
    ])
    const leave = new Route([rounded([[bx, bz], [bx, T.laneOut], [T.road.outX, T.laneOut], [T.road.outX, T.road.minZ]], 5)])
    const park = { x: bx, z: bz, yaw: 0 }
    model.group.rotation.order = 'YXZ'
    return { model, arrive, leave, park, last: new THREE.Vector3(T.road.inX, 0, T.road.minZ) }
  }

  private updateLorry(view: LorryView, l: LorryVisit, now: number, dt: number): void {
    let pose: Pose
    if (now < l.atBayAt) pose = view.arrive.at(Math.max(0, (now - l.spawnAt) / (l.atBayAt - l.spawnAt)))
    else if (now < l.leaveAt) pose = view.park
    else pose = view.leave.at(Math.min(1, (now - l.leaveAt) / (l.goneAt - l.leaveAt)))
    const g = view.model.group
    const dx = pose.x - view.last.x
    const dz = pose.z - view.last.z
    const dist = Math.hypot(dx, dz)
    if (dist < 5) {
      const fwd = dx * -Math.sin(pose.yaw) + dz * -Math.cos(pose.yaw) >= 0 ? 1 : -1
      for (const w of view.model.wheels) w.rotation.x -= (fwd * dist) / view.model.wheelRadius
    }
    view.last.set(pose.x, 0, pose.z)
    g.position.set(pose.x, 0, pose.z)
    g.rotation.y = pose.yaw
    setBraking(view.model, now >= l.atBayAt - 1.5 && now < l.leaveAt + 0.5)
    // Its container: a collecting lorry leaves with one, a delivering lorry brings one (until the gantry lifts it off).
    const H = l.handledAt - l.handleAt
    const has = l.job === 'collect' ? now >= l.handleAt + 0.82 * H : now < l.handleAt + 0.34 * H
    view.model.container.visible = has
    if (has) setContainerColour(view.model.container, l.job === 'collect' ? (this.lorryColour.get(l.id) ?? COLOURS[0]!) : COLOURS[l.colour % COLOURS.length]!)
    void dt
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

/** Paint a ship's name on both bows. */
function setShipName(model: ShipModel, name: string): void {
  if (typeof document === 'undefined') return
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 96
  const g = c.getContext('2d')
  if (g) {
    g.fillStyle = '#f8fafc'
    // As big as fits.
    let size = 64
    g.font = `800 ${size}px system-ui, sans-serif`
    while (g.measureText(name.toUpperCase()).width > 490 && size > 20) g.font = `800 ${(size -= 4)}px system-ui, sans-serif`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(name.toUpperCase(), 256, 50)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  for (const m of model.names) {
    const mat = m.material as THREE.MeshStandardMaterial
    mat.map?.dispose()
    mat.map = tex
    mat.needsUpdate = true
  }
}

/**
 * A container ship of `size` (from `CONFIG.harbour.ships`): a red-bottomed hull with a raked bow, a white superstructure with a window
 * band, bridge wings, a funnel in the line's colours, deck railings, hatch covers, a lifeboat, and its containers on deck (one each, so
 * they can come off and go on). Built bow +x inside a holder turned so its nose is −z.
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
    new THREE.Vector2(-L / 2, -W / 2 + 0.4),
    new THREE.Vector2(-L / 2 + 0.6, -W / 2),
    new THREE.Vector2(L / 2 - 5, -W / 2),
    new THREE.Vector2(L / 2 - 1.5, -W / 4),
    new THREE.Vector2(L / 2, 0),
    new THREE.Vector2(L / 2 - 1.5, W / 4),
    new THREE.Vector2(L / 2 - 5, W / 2),
    new THREE.Vector2(-L / 2 + 0.6, W / 2),
    new THREE.Vector2(-L / 2, W / 2 - 0.4),
  ])
  const topColour = [0x1e2a44, 0x1f3d2b, 0x0f2747][size] ?? 0x1e2a44
  const hullPart = (y0: number, h: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(outline, { depth: h, bevelEnabled: false }), m)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.y = y0
    mesh.castShadow = true
    mesh.receiveShadow = true
    g.add(mesh)
  }
  hullPart(-1.4, 1.3, paintedSteel(0x9f1d1d))
  hullPart(-0.1, 0.12, paintedSteel(0xf1f5f9))
  hullPart(0.02, DECK - 0.02, paintedSteel(topColour))
  const part = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(metreUVs(new THREE.BoxGeometry(w, h, d)), m)
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    g.add(mesh)
    return mesh
  }
  // Deck, hatch covers under the containers, railings round the edge.
  part(L - 6, 0.1, W - 0.4, paintedSteel(0x3f6b4a), -0.5, DECK + 0.02, 0)
  const cols = COLS[size] ?? 2
  for (let c = 0; c < cols; c++) part(PITCH - 0.3, 0.12, W - 1.0, paintedSteel(0x5b6470), 0.5 + (c - (cols - 1) / 2) * PITCH, DECK + 0.1, 0)
  const rail = paintedSteel(0xe5e7eb)
  for (const s of [-1, 1]) {
    part(L - 6, 0.05, 0.05, rail, -0.5, DECK + 1.0, s * (W / 2 - 0.1))
    for (let x = -L / 2 + 1; x < L / 2 - 5; x += 1.6) part(0.05, 1.0, 0.05, rail, x, DECK + 0.5, s * (W / 2 - 0.1))
  }
  // The superstructure at the stern (taller on the bigger ships): decks, a window band, bridge wings, mast, funnel, lifeboat.
  const white = paintedSteel(0xf1f5f9)
  const bh = 4.2 + size * 1.4
  const sx = -L / 2 + 2.6
  part(4.2, bh, W - 1.0, white, sx, DECK + bh / 2, 0)
  part(4.4, 0.15, W + 1.0, white, sx, DECK + bh + 0.07, 0)
  part(0.05, 0.8, W - 1.4, new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.15, metalness: 0.5 }), sx + 2.11, DECK + bh - 0.7, 0)
  for (let y = DECK + 1.4; y < DECK + bh - 1.5; y += 1.4) part(0.04, 0.4, W - 1.6, new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.2, metalness: 0.4 }), sx + 2.11, y, 0)
  const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.6 + size * 0.15, 0.7 + size * 0.15, 2.2, 16), paintedSteel(0x1d4ed8))
  funnel.position.set(sx - 1.0, DECK + bh + 1.2, 0)
  g.add(funnel)
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.62 + size * 0.15, 0.62 + size * 0.15, 0.4, 16), paintedSteel(0xf1f5f9))
  band.position.set(sx - 1.0, DECK + bh + 1.4, 0)
  g.add(band)
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.4, 6), white)
  mast.position.set(sx + 0.6, DECK + bh + 1.8, 0)
  g.add(mast)
  const lifeboat = part(2.6, 0.9, 1.1, paintedSteel(0xf97316), sx, DECK + bh * 0.55, W / 2 + 0.2)
  lifeboat.castShadow = true
  const foremast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4, 6), white)
  foremast.position.set(L / 2 - 3, DECK + 2, 0)
  g.add(foremast)
  // The name on both bows.
  const names: THREE.Mesh[] = []
  for (const s of [-1, 1]) {
    const n = new THREE.Mesh(new THREE.PlaneGeometry(5, 0.9), new THREE.MeshStandardMaterial({ transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }))
    n.position.set(L / 2 - 7, 0.75, s * (W / 2 + 0.01))
    if (s < 0) n.rotation.y = Math.PI
    g.add(n)
    names.push(n)
  }
  const containers = shipSlots(size).map((s, i) => {
    const c = makeContainer(COLOURS[i % COLOURS.length]!)
    c.position.set(s.x, s.y, s.z)
    g.add(c)
    return c
  })
  return { group, containers, names }
}
