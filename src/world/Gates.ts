import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { makePerson, makeSign, mat, animatePerson, type PersonRig } from './models'
import { metreUVs, roadAsphalt, wallMat } from './textures'

/**
 * Where the roads leave the little world. Each road ends in a building that it runs into through a tunnel portal (dark inside, with
 * strip lights), so vehicles drive in and are gone, and you never see a road running off to the horizon. The service road also has a
 * checkpost in front of its tunnel: a guard booth, a canopy over both lanes, and boom barriers that lift for the trucks.
 */
export type Box = { x: number; y: number; z: number; hx: number; hy: number; hz: number }

export type PortalSpec = {
  /** Which way the road runs, and the direction into the tunnel along it. */
  along: 'x' | 'z'
  dir: 1 | -1
  /** The road's centre across it, and where the portal's face is along it. */
  centre: number
  mouth: number
  roadWidth: number
  /** The building: its width across the road, depth along it, and height. */
  span?: number
  depth?: number
  height?: number
  colour?: number
  sign?: string
}

const glass = new THREE.MeshStandardMaterial({ color: 0x223040, roughness: 0.15, metalness: 0.5 })
const litGlass = new THREE.MeshStandardMaterial({ color: 0x8a7a55, emissive: 0xffd9a0, emissiveIntensity: 0.35, roughness: 0.3 })
const liner = new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.9 })
const strip = new THREE.MeshStandardMaterial({ color: 0xfff3d6, emissive: 0xffe6b0, emissiveIntensity: 1.6 })
const dark = new THREE.MeshBasicMaterial({ color: 0x050506 })

/** A tunnel-portal building (returns the group and its colliders in world space, with a plug so you cannot walk into the tunnel). */
export function tunnelPortal(p: PortalSpec): { group: THREE.Group; solids: Box[] } {
  const span = p.span ?? 32
  const depth = p.depth ?? 16
  const H = p.height ?? 11
  const W = p.roadWidth + 1.6
  const ph = 5.4
  const g = new THREE.Group()
  const local: Box[] = []
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, solid = false) => {
    const mesh = new THREE.Mesh(metreUVs(new THREE.BoxGeometry(w, h, d)), m)
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    g.add(mesh)
    if (solid) local.push({ x, y, z, hx: w / 2, hy: h / 2, hz: d / 2 })
    return mesh
  }
  // Local frame: the road runs along z, the portal's face at z = 0, the tunnel going to −z.
  const wall = wallMat(p.colour ?? 0xb8aa96)
  const side = (span - W) / 2
  for (const s of [-1, 1]) box(side, H, depth, wall, s * (W / 2 + side / 2), H / 2, -depth / 2, true)
  box(W, H - ph, depth, wall, 0, ph + (H - ph) / 2, -depth / 2)
  // A concrete surround round the portal, and a cornice along the top.
  const concrete = mat(0x9ca3af, 0.85)
  for (const s of [-1, 1]) box(0.7, ph + 0.7, 0.4, concrete, s * (W / 2 + 0.35), (ph + 0.7) / 2, 0.2)
  box(W + 1.4, 0.7, 0.4, concrete, 0, ph + 0.35, 0.2)
  box(span + 0.4, 0.5, depth + 0.4, mat(0x6b7280, 0.8), 0, H + 0.25, -depth / 2)
  // Windows on the front and back faces: rows of glass, some lit.
  for (const face of [0.03, -depth - 0.03])
    for (let y = ph + 1.6; y < H - 0.8; y += 2.8)
      for (let x = -span / 2 + 1.6; x < span / 2 - 1.2; x += 2.4) {
        if (Math.abs(x) < W / 2 + 0.6 && y < ph + 0.8) continue
        const lit = Math.sin(x * 3.1 + y * 1.7 + face) > 0.55
        box(1.3, 1.5, 0.06, lit ? litGlass : glass, x, y, face)
      }
  // Shopfront windows either side of the portal at street level.
  for (const s of [-1, 1])
    for (let x = W / 2 + 1.6; x < span / 2 - 1.2; x += 3.2) box(2.4, 2.4, 0.06, glass, s * x, 1.7, 0.03)
  // The tunnel: dark lining, strip lights receding into the dark, a black end.
  for (const s of [-1, 1]) box(0.1, ph, depth, liner, s * (W / 2 - 0.05), ph / 2, -depth / 2)
  box(W, 0.1, depth, liner, 0, ph - 0.05, -depth / 2)
  for (let z = -1.5; z > -depth + 1; z -= 3) box(0.25, 0.06, 1.6, strip, 0, ph - 0.14, z)
  const end = new THREE.Mesh(new THREE.PlaneGeometry(W, ph), dark)
  end.position.set(0, ph / 2, -depth + 0.3)
  g.add(end)
  box(W, 0.03, depth, roadAsphalt(0x2f3237), 0, 0.012, -depth / 2)
  // You cannot walk in (vehicles are not stopped by it).
  local.push({ x: 0, y: ph / 2, z: -1.2, hx: W / 2, hy: ph / 2, hz: 0.2 })
  if (p.sign) {
    const sign = makeSign(p.sign, Math.min(W + 1, 9), 0.6, '#0f172a', '#fde68a')
    sign.position.set(0, ph + 1.05, 0.42)
    g.add(sign)
  }

  // Place it: local −z points into the tunnel.
  const yaw = p.along === 'z' ? (p.dir === -1 ? 0 : Math.PI) : p.dir === 1 ? -Math.PI / 2 : Math.PI / 2
  if (p.along === 'z') g.position.set(p.centre, 0, p.mouth)
  else g.position.set(p.mouth, 0, p.centre)
  g.rotation.y = yaw
  g.updateMatrixWorld(true)
  const solids = local.map((b) => {
    const c = new THREE.Vector3(b.x, b.y, b.z).applyMatrix4(g.matrixWorld)
    const swap = p.along === 'x'
    return { x: c.x, y: c.y, z: c.z, hx: swap ? b.hz : b.hx, hy: b.hy, hz: swap ? b.hx : b.hz }
  })
  return { group: g, solids }
}

type Arm = { pivot: THREE.Group; laneX: number; z: number; open: number; dir: 1 | -1 }

/**
 * The checkpost on a road running along z (`minX…maxX`, lanes at `outLaneX` going −z and `inLaneX` going +z): a guard booth (with a guard)
 * on the east side, a canopy over both lanes, a little island between them, stop lines, and a barrier on each lane that lifts when a
 * vehicle comes up to it.
 */
export class Checkpost {
  readonly group = new THREE.Group()
  readonly solids: Box[] = []
  private readonly arms: Arm[] = []
  private readonly guard: PersonRig

  constructor(minX: number, maxX: number, z: number, outLaneX: number, inLaneX: number) {
    const g = this.group
    const part = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, zz: number, parent: THREE.Object3D = g) => {
      const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(0.05, w / 3, h / 3, d / 3)), m)
      mesh.position.set(x, y, zz)
      mesh.castShadow = true
      mesh.receiveShadow = true
      parent.add(mesh)
      return mesh
    }
    const white = mat(0xf1f5f9, 0.7)
    const red = mat(0xc0392b, 0.6)
    const steel = mat(0x4b5563, 0.5, 0.4)
    const midX = (minX + maxX) / 2
    // The booth, east of the road.
    const bx = maxX + 2.2
    part(2.4, 0.2, 2.6, mat(0x9ca3af, 0.8), bx, 0.1, z)
    part(2.2, 2.5, 2.4, white, bx, 1.45, z)
    part(2.9, 0.25, 3.0, red, bx, 2.8, z)
    part(0.06, 1.0, 2.0, glass, bx - 1.12, 1.75, z)
    part(1.6, 1.0, 0.06, glass, bx, 1.75, z + 1.21)
    part(1.6, 1.0, 0.06, glass, bx, 1.75, z - 1.21)
    this.solids.push({ x: bx, y: 1.4, z, hx: 1.2, hy: 1.4, hz: 1.3 })
    const sign = makeSign('CHECKPOINT', 2.2, 0.36, '#c0392b', '#ffffff')
    sign.position.set(bx - 1.16, 2.8, z)
    sign.rotation.y = -Math.PI / 2
    g.add(sign)
    this.guard = makePerson({ skin: 0, hair: 0x1f1a17, hairStyle: 'cap', shirt: 0x1e3a8a, trousers: 0x1e293b, height: 1 }, { worker: true })
    this.guard.root.position.set(bx - 0.2, 0.2, z)
    this.guard.root.rotation.y = -Math.PI / 2
    g.add(this.guard.root)
    // The canopy over both lanes, on four posts, lit underneath.
    const top = 5.6
    for (const x of [minX - 0.5, maxX + 0.5])
      for (const dz of [-2.6, 2.6]) {
        part(0.3, top, 0.3, steel, x, top / 2, z + dz)
        this.solids.push({ x, y: top / 2, z: z + dz, hx: 0.15, hy: top / 2, hz: 0.15 })
      }
    part(maxX - minX + 2, 0.5, 6.4, white, midX, top + 0.25, z)
    part(maxX - minX + 2.1, 0.18, 6.5, red, midX, top + 0.55, z)
    for (const dz of [-1.8, 0, 1.8]) part(maxX - minX - 0.6, 0.05, 0.3, strip, midX, top - 0.03, z + dz)
    const canopySign = makeSign('WAREHOUSE DISTRICT', maxX - minX + 1.6, 0.5, '#0f172a', '#fbbf24')
    canopySign.position.set(midX, top + 0.25, z + 3.22)
    g.add(canopySign)
    const back = makeSign('WAREHOUSE DISTRICT', maxX - minX + 1.6, 0.5, '#0f172a', '#fbbf24')
    back.position.set(midX, top + 0.25, z - 3.22)
    back.rotation.y = Math.PI
    g.add(back)
    // The island between the lanes, with a bollard at each end.
    part(0.8, 0.16, 5.2, mat(0xd1d5db, 0.8), midX, 0.08, z)
    for (const dz of [-2.4, 2.4]) {
      part(0.22, 0.9, 0.22, mat(0xf2b51d, 0.6), midX, 0.5, z + dz)
      this.solids.push({ x: midX, y: 0.45, z: z + dz, hx: 0.11, hy: 0.45, hz: 0.11 })
    }
    // Stop lines before each barrier.
    const paint = mat(0xf8fafc, 0.6)
    part(midX - minX - 0.6, 0.012, 0.3, paint, (minX + midX) / 2, 0.03, z + 3.4)
    part(maxX - midX - 0.6, 0.012, 0.3, paint, (maxX + midX) / 2, 0.03, z - 3.4)
    // Barriers: the out lane's on the island's west side, pivoting at the west kerb; the in lane's from the east kerb.
    for (const [laneX, pivotX, bz, dir] of [[outLaneX, minX + 0.2, z + 2.2, 1], [inLaneX, maxX - 0.2, z - 2.2, -1]] as const) {
      part(0.4, 1.1, 0.4, mat(0xf2b51d, 0.6), pivotX, 0.55, bz)
      this.solids.push({ x: pivotX, y: 0.55, z: bz, hx: 0.2, hy: 0.55, hz: 0.2 })
      const pivot = new THREE.Group()
      pivot.position.set(pivotX, 1.0, bz)
      const len = Math.abs(midX - pivotX) - 0.5
      for (let i = 0; i < 6; i++) part(len / 6, 0.12, 0.08, i % 2 === 0 ? red : white, dir * (len / 6) * (i + 0.5), 0, 0, pivot)
      g.add(pivot)
      this.arms.push({ pivot, laneX, z: bz, open: 0, dir })
    }
  }

  /** Lift the barriers for vehicles coming up to them (`vehicles`: the visible vehicles' positions). */
  update(dt: number, vehicles: readonly THREE.Vector3[]): void {
    for (const a of this.arms) {
      const want = vehicles.some((v) => Math.abs(v.x - a.laneX) < 2.2 && Math.abs(v.z - a.z) < 11) ? 1 : 0
      a.open += THREE.MathUtils.clamp(want - a.open, -dt * 1.2, dt * 2.4)
      a.pivot.rotation.z = a.dir * THREE.MathUtils.smoothstep(a.open, 0, 1) * 1.35
    }
    animatePerson(this.guard, dt, 'idle')
  }
}
