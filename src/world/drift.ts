import * as THREE from 'three'
import type { Leg, Pose } from './paths'

/**
 * Kei trucks arrive with style: they come down the yard aisle at speed, then throw the tail out and slide sideways into their dock,
 * swinging round so the bed ends up against the door (a handbrake drift), with tyre smoke and skid marks.
 *
 * `driftArrival` gives the pose at time `t` of an arrival lasting `total` seconds: the first part drives `approach` (speeding up, then
 * flat out), the last `drift` seconds slide along a curve from the end of the approach into `park`, the body turning further and
 * faster than the path does (so it slips), overshooting a little and settling.
 */
export const DRIFT_SECONDS = 2.8

export type DriftPose = Pose & {
  /** 0…1 through the slide, or −1 before it. */
  slide: number
  /** False until the truck sets off (it waits out of sight at the start of the approach). */
  visible: boolean
}

/** How hard a truck accelerates from a standstill on the approach (m/s²). */
const ACCEL = 5
/** How the slide loses speed: distance 1 − (1 − s)^SLIDE_POW (lower = gentler braking at the start of the slide). */
const SLIDE_POW = 1.7

export function driftArrival(approach: Leg, park: Pose, t: number, total: number, drift = DRIFT_SECONDS): DriftPose {
  const before = Math.max(0.1, total - drift)
  const curve = slideCurve(approach, park)
  // The slide starts at this speed: the curve's speed at its start (3 |p1 − p0| per unit of u) times du/ds = SLIDE_POW at s = 0.
  const entry = (SLIDE_POW * curve.startRate) / drift
  if (t < before) {
    // Speed up once and then hold the slide's entry speed, so drive and slide join without a jolt. The truck waits out of sight at
    // the start of the approach until it has to set off to reach the slide on time.
    const L = approach.length
    const accelDist = Math.min(L, (entry * entry) / (2 * ACCEL))
    const accelTime = Math.sqrt((2 * accelDist) / ACCEL)
    const need = accelTime + (L - accelDist) / entry
    const go = before - need
    if (t < go) return { ...approach.at(0), slide: -1, visible: go <= 0.05 }
    const tt = t - Math.max(0, go)
    // If the approach is too long for the time (never with the yard's numbers), squeeze it evenly.
    const squeeze = go < 0 ? need / before : 1
    const tm = tt * squeeze
    const d = tm < accelTime ? 0.5 * ACCEL * tm * tm : accelDist + (tm - accelTime) * entry
    return { ...approach.at(Math.min(1, d / L)), slide: -1, visible: true }
  }
  const s = Math.min(1, (t - before) / drift)
  const start = approach.at(1)
  // Lose speed through the slide.
  const u = 1 - (1 - s) ** SLIDE_POW
  const q = curve.at(u)
  // The body: from the approach heading round to the park heading, ahead of the path, with an overshoot that settles.
  let turn = park.yaw - start.yaw
  turn = Math.atan2(Math.sin(turn), Math.cos(turn))
  const lead = 1 - (1 - Math.min(1, s * 1.25)) ** 3
  const over = Math.sin(Math.min(1, s * 1.15) * Math.PI) * 0.22 * Math.sign(turn) * (1 - s)
  const yaw = start.yaw + turn * lead + over
  return { x: q.x, z: q.y, yaw: s >= 1 ? park.yaw : yaw, slide: s, visible: true }
}

/** The slide's path: a cubic from the end of the approach (carrying straight on) round into the bay (from in front of it). */
function slideCurve(approach: Leg, park: Pose): { at: (u: number) => THREE.Vector2; length: number; startRate: number } {
  const start = approach.at(1)
  const end = approach.at(0.995)
  const dx = start.x - end.x
  const dz = start.z - end.z
  const len = Math.hypot(dx, dz) || 1
  const fx = dx / len
  const fz = dz / len
  const reach = Math.hypot(park.x - start.x, park.z - start.z)
  const p0 = new THREE.Vector2(start.x, start.z)
  const p1 = new THREE.Vector2(start.x + fx * reach * 0.55, start.z + fz * reach * 0.55)
  const nx = -Math.sin(park.yaw)
  const nz = -Math.cos(park.yaw)
  const p2 = new THREE.Vector2(park.x + nx * reach * 0.45, park.z + nz * reach * 0.45)
  const p3 = new THREE.Vector2(park.x, park.z)
  const at = (u: number) => cubic(p0, p1, p2, p3, u)
  let length = 0
  let prev = at(0)
  for (let k = 1; k <= 24; k++) {
    const q = at(k / 24)
    length += q.distanceTo(prev)
    prev = q
  }
  return { at, length, startRate: 3 * p1.distanceTo(p0) }
}

function cubic(a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2, d: THREE.Vector2, u: number): THREE.Vector2 {
  const v = 1 - u
  return new THREE.Vector2(
    v * v * v * a.x + 3 * v * v * u * b.x + 3 * v * u * u * c.x + u * u * u * d.x,
    v * v * v * a.y + 3 * v * v * u * b.y + 3 * v * u * u * c.y + u * u * u * d.y,
  )
}

// ------------------------------------------------------------------ effects

type Puff = { sprite: THREE.Sprite; life: number; max: number; vx: number; vy: number; vz: number; size: number }

/** Tyre smoke (soft sprites that billow, rise and fade) and skid marks (dark strips on the ground that fade over half a minute). */
export class TyreFx {
  readonly root = new THREE.Group()
  private readonly puffs: Puff[] = []
  private next = 0
  private readonly skids: THREE.InstancedMesh
  private readonly born: Float32Array
  private skidNext = 0
  private time = 0
  private readonly tmp = new THREE.Object3D()
  private readonly colour = new THREE.Color()
  private static readonly SKIDS = 600
  private static readonly SKID_LIFE = 30

  constructor() {
    const tex = smokeTexture()
    for (let i = 0; i < 90; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xd9d9d6, transparent: true, depthWrite: false, opacity: 0 }))
      sprite.visible = false
      this.root.add(sprite)
      this.puffs.push({ sprite, life: 0, max: 1, vx: 0, vy: 0, vz: 0, size: 1 })
    }
    const geo = new THREE.PlaneGeometry(0.2, 0.42).rotateX(-Math.PI / 2)
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -4, transparent: true, opacity: 0.85, depthWrite: false })
    this.skids = new THREE.InstancedMesh(geo, mat, TyreFx.SKIDS)
    this.skids.frustumCulled = false
    this.skids.renderOrder = 1
    this.born = new Float32Array(TyreFx.SKIDS).fill(-1e9)
    this.tmp.position.set(0, -50, 0)
    this.tmp.updateMatrix()
    for (let i = 0; i < TyreFx.SKIDS; i++) {
      this.skids.setMatrixAt(i, this.tmp.matrix)
      this.skids.setColorAt(i, this.colour.set(0x3a3d43))
    }
    this.root.add(this.skids)
  }

  /** A puff of smoke at a tyre, thrown back from the way the truck is sliding. */
  smoke(x: number, z: number, vx: number, vz: number, strength = 1): void {
    const p = this.puffs[this.next]!
    this.next = (this.next + 1) % this.puffs.length
    p.life = 0
    p.max = 1.4 + Math.random() * 1.2
    p.size = (0.6 + Math.random() * 0.5) * strength
    p.vx = -vx * 0.15 + (Math.random() - 0.5) * 0.8
    p.vz = -vz * 0.15 + (Math.random() - 0.5) * 0.8
    p.vy = 0.35 + Math.random() * 0.4
    p.sprite.position.set(x, 0.25, z)
    p.sprite.visible = true
  }

  /** A strip of skid mark at a tyre, along `yaw`. */
  skid(x: number, z: number, yaw: number): void {
    const i = this.skidNext
    this.skidNext = (this.skidNext + 1) % TyreFx.SKIDS
    this.tmp.position.set(x, 0.022, z)
    this.tmp.rotation.set(0, yaw, 0)
    this.tmp.updateMatrix()
    this.skids.setMatrixAt(i, this.tmp.matrix)
    this.born[i] = this.time
    this.skids.instanceMatrix.needsUpdate = true
  }

  update(dt: number): void {
    this.time += dt
    for (const p of this.puffs) {
      if (!p.sprite.visible) continue
      p.life += dt
      const k = p.life / p.max
      if (k >= 1) {
        p.sprite.visible = false
        continue
      }
      p.sprite.position.x += p.vx * dt
      p.sprite.position.y += p.vy * dt
      p.sprite.position.z += p.vz * dt
      p.vx *= 1 - dt * 1.5
      p.vz *= 1 - dt * 1.5
      const size = p.size * (0.6 + k * 2.4)
      p.sprite.scale.set(size, size, 1)
      ;(p.sprite.material as THREE.SpriteMaterial).opacity = 0.55 * (1 - k) * Math.min(1, k * 8)
    }
    // Skid marks: dark, fading to the asphalt's colour.
    let changed = false
    for (let i = 0; i < TyreFx.SKIDS; i++) {
      const age = this.time - this.born[i]!
      if (age < 0 || age > TyreFx.SKID_LIFE + 1) continue
      const k = Math.min(1, age / TyreFx.SKID_LIFE)
      this.colour.setRGB(0.05 + 0.18 * k, 0.05 + 0.19 * k, 0.055 + 0.2 * k)
      this.skids.setColorAt(i, this.colour)
      changed = true
    }
    if (changed && this.skids.instanceColor) this.skids.instanceColor.needsUpdate = true
  }
}

let smokeTex: THREE.Texture | null = null
function smokeTexture(): THREE.Texture | null {
  if (smokeTex || typeof document === 'undefined') return smokeTex
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  if (g) {
    for (let k = 0; k < 6; k++) {
      const x = 22 + Math.sin(k * 2.1) * 10
      const y = 32 + Math.cos(k * 1.7) * 10
      const grad = g.createRadialGradient(x, y, 0, x, y, 22)
      grad.addColorStop(0, 'rgba(255,255,255,0.55)')
      grad.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = grad
      g.fillRect(0, 0, 64, 64)
    }
    // Fade the whole puff out towards its edge so no square corners show.
    g.globalCompositeOperation = 'destination-in'
    const mask = g.createRadialGradient(32, 32, 4, 32, 32, 31)
    mask.addColorStop(0, 'rgba(0,0,0,1)')
    mask.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = mask
    g.fillRect(0, 0, 64, 64)
  }
  smokeTex = new THREE.CanvasTexture(c)
  return smokeTex
}
