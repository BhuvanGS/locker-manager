import * as THREE from 'three'
import type { RobotJob } from '../sim/WarehouseManager'
import { Leg } from './paths'
import { armDark, textured } from './textures'
import type { LaneGraph, RobotTarget } from './WarehouseRobot'

type Pt = { x: number; z: number }

const CRATE = { w: 0.8, h: 0.6, d: 0.8 }
/** How far ahead of the forklift's middle its forks carry the crates (it faces −z). */
const FORK_Z = -1.25
/** The carriage's lowest height, and the most crates it ever lifts. */
const FORK_LOW = 0.08
const MAX_STACK = 3
/** Moments in a job (fractions of it), as for the robots: at the pick-up, (grab at the sim's `grabAt`), lifted and backed off, at the drop-off. */
const ARRIVE_A = 0.3
const LIFTED = 0.55
const ARRIVE_B = 0.86
const smooth = (u: number): number => {
  const v = Math.min(1, Math.max(0, u))
  return v * v * (3 - 2 * v)
}

/**
 * An automated forklift (`wh-forklift-*`): an orange body with a counterweight, an overhead guard with a sensor dome instead of a driver,
 * a mast at the front whose carriage rides up and down, and two forks carrying a stack of up to three crates. It drives the robots' lanes,
 * timed to its sim `RobotJob` like a robot (`t / duration`, crates lifted at `grabAt`): to the pick-up, in under the crates, lift, back off,
 * to the drop-off, set them down. Idle, it parks at its home spot.
 */
export class WarehouseForklift {
  private readonly base = new THREE.Group()
  private readonly carriage = new THREE.Group()
  private readonly crates: THREE.Mesh[] = []
  private readonly lamp: THREE.MeshStandardMaterial
  private readonly pos: THREE.Vector3
  private yaw = 0
  private job: RobotJob | null = null
  private legA: Leg | null = null
  private legB: Leg | null = null
  private a: RobotTarget | null = null
  private b: RobotTarget | null = null
  private idle = 0
  private homeLeg: Leg | null = null
  private homeT = 0
  private forkY = FORK_LOW
  private readonly lanes: LaneGraph
  private readonly home: Pt

  constructor(parent: THREE.Group, lanes: LaneGraph, home: Pt) {
    this.lanes = lanes
    this.home = home
    this.pos = new THREE.Vector3(home.x, 0, home.z)
    const orange = textured('arm-paint', { color: 0xea580c, metalness: 0.3, normalScale: 0.8, repeat: 0.5, colorMap: false })
    const dark = armDark()
    const steel = textured('locker-door', { color: 0x9aa3ad, metalness: 0.55, normalScale: 0.6, repeat: 0.5 })
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, into: THREE.Object3D = this.base): THREE.Mesh => {
      const mesh = new THREE.Mesh(geo, m)
      mesh.position.set(x, y, z)
      mesh.castShadow = true
      into.add(mesh)
      return mesh
    }
    // Body, counterweight, step and wheels (small at the back, big under the mast).
    add(new THREE.BoxGeometry(1.0, 0.46, 1.4), orange, 0, 0.38, 0.12)
    add(new THREE.BoxGeometry(1.02, 0.56, 0.36), dark, 0, 0.46, 0.86)
    add(new THREE.BoxGeometry(0.9, 0.06, 0.5), dark, 0, 0.64, 0.0)
    for (const x of [-0.5, 0.5]) {
      const front = add(new THREE.CylinderGeometry(0.2, 0.2, 0.16, 12), dark, x, 0.2, -0.38)
      front.rotation.z = Math.PI / 2
      const back = add(new THREE.CylinderGeometry(0.15, 0.15, 0.14, 12), dark, x, 0.15, 0.68)
      back.rotation.z = Math.PI / 2
    }
    // The overhead guard: four posts and a slatted roof, a sensor dome and the status lamp on top.
    for (const x of [-0.44, 0.44]) for (const z of [-0.3, 0.6]) add(new THREE.BoxGeometry(0.06, 1.36, 0.06), dark, x, 1.29, z)
    for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.94, 0.04, 0.12), dark, 0, 1.98, -0.27 + i * 0.28)
    add(new THREE.BoxGeometry(0.3, 0.12, 0.3), steel, 0, 2.06, 0.15)
    this.lamp = new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x22c55e, emissiveIntensity: 1.2 })
    add(new THREE.BoxGeometry(0.12, 0.1, 0.12), this.lamp, 0, 2.17, 0.15)
    // The mast: two uprights and a cross-head at the front.
    for (const x of [-0.32, 0.32]) add(new THREE.BoxGeometry(0.08, 2.5, 0.1), steel, x, 1.3, -0.68)
    add(new THREE.BoxGeometry(0.72, 0.08, 0.1), steel, 0, 2.55, -0.68)
    parent.add(this.base)

    // The carriage (backrest and forks) rides up the mast; the crates sit on the forks.
    add(new THREE.BoxGeometry(0.84, 0.5, 0.05), dark, 0, 0.3, -0.75, this.carriage)
    for (const x of [-0.24, 0.24]) {
      add(new THREE.BoxGeometry(0.1, 0.05, 1.0), steel, x, 0.025, FORK_Z + 0.02, this.carriage)
      add(new THREE.BoxGeometry(0.1, 0.5, 0.05), steel, x, 0.27, -0.76, this.carriage)
    }
    for (let i = 0; i < MAX_STACK; i++) {
      // Their own materials (not mat()'s cache): each is recoloured to the crate it carries.
      const crate = add(new THREE.BoxGeometry(CRATE.w, CRATE.h, CRATE.d), new THREE.MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.85 }), 0, 0.05 + CRATE.h / 2 + i * (CRATE.h + 0.04), FORK_Z, this.carriage)
      crate.visible = false
      this.crates.push(crate)
    }
    this.base.add(this.carriage)
    this.carriage.position.y = FORK_LOW
  }

  /** `job` is this forklift's sim job (or null), `targets` turns a new job into its two ends, `grabAt` the sim's pick-up moment. */
  update(dt: number, job: RobotJob | null, targets: (job: RobotJob) => { a: RobotTarget; b: RobotTarget }, grabAt: number, crateColour: number): void {
    if (job !== this.job) {
      this.job = job
      this.legA = this.legB = null
      if (job) {
        const t = targets(job)
        this.a = t.a
        this.b = t.b
        this.legA = this.lanes.route(this.pos, t.a.approach)
        this.legB = this.lanes.route(t.a.approach, t.b.approach)
        this.idle = 0
        this.homeLeg = null
      }
    }

    let holding = false
    let forkY = FORK_LOW
    let face: number | null = null
    let nudge = 0
    if (job && this.legA && this.legB && this.a && this.b) {
      const p = job.t / job.duration
      if (p < ARRIVE_A) this.drive(this.legA.at(smooth(p / ARRIVE_A)))
      else if (p < LIFTED) {
        // In under the crates, lift them off, back away.
        this.drive(this.legA.at(1))
        face = this.faceTo(this.a.reach)
        const inward = p < grabAt ? smooth((p - ARRIVE_A) / (grabAt - ARRIVE_A)) : 1 - smooth((p - grabAt) / (LIFTED - grabAt))
        nudge = inward * this.reachRoom(this.a)
        forkY = THREE.MathUtils.lerp(FORK_LOW, this.liftFor(this.a), Math.min(1, inward * 1.4)) + (p >= grabAt ? 0.06 : 0)
        holding = p >= grabAt
      } else if (p < ARRIVE_B) {
        this.drive(this.legB.at(smooth((p - LIFTED) / (ARRIVE_B - LIFTED))))
        forkY = FORK_LOW + 0.12
        holding = true
      } else {
        // In to the drop-off, and set them down.
        this.drive(this.legB.at(1))
        face = this.faceTo(this.b.reach)
        const inward = smooth(((p - ARRIVE_B) / (1 - ARRIVE_B)) * 1.3)
        nudge = inward * this.reachRoom(this.b)
        forkY = THREE.MathUtils.lerp(FORK_LOW + 0.12, this.liftFor(this.b), Math.min(1, inward * 1.3))
        holding = true
      }
    } else {
      // Idle: forks down, and after a while back to its parking spot.
      this.idle += dt
      const away = Math.hypot(this.pos.x - this.home.x, this.pos.z - this.home.z) > 0.05
      if (this.idle > 6 && away && !this.homeLeg) {
        this.homeLeg = this.lanes.route(this.pos, this.home)
        this.homeLeg = new Leg([...this.homeLeg.pts, this.home])
        this.homeT = 0
      }
      if (this.homeLeg) {
        this.homeT = Math.min(this.homeLeg.length, this.homeT + dt * 1.5)
        this.drive(this.homeLeg.at(this.homeLeg.length > 0 ? this.homeT / this.homeLeg.length : 1))
        if (this.homeT >= this.homeLeg.length) this.homeLeg = null
      }
    }
    if (face !== null) this.yaw = turnToward(this.yaw, face, Math.min(1, dt * 5))
    this.forkY += (forkY - this.forkY) * Math.min(1, dt * 6)

    const ahead = new THREE.Vector3(0, 0, -nudge).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw)
    this.base.position.copy(this.pos).add(ahead)
    this.base.rotation.y = this.yaw
    this.carriage.position.y = this.forkY
    const count = holding ? Math.min(MAX_STACK, Math.max(1, job?.count ?? 1)) : 0
    this.crates.forEach((crate, i) => {
      crate.visible = i < count
      if (i < count) (crate.material as THREE.MeshStandardMaterial).color.setHex(crateColour)
    })
    const busy = job !== null
    this.lamp.color.setHex(busy ? 0xf59e0b : 0x22c55e)
    this.lamp.emissive.setHex(busy ? 0xf59e0b : 0x22c55e)
  }

  /** How far it rolls in from the lane spot so the forks are under the crate (the crate's centre is `reach`). */
  private reachRoom(t: RobotTarget): number {
    const d = Math.hypot(t.reach.x - t.approach.x, t.reach.z - t.approach.z)
    return Math.max(0, Math.min(1.1, d + FORK_Z))
  }

  /** Carriage height that puts the bottom crate of the stack where `t.reach` (a crate's centre) is. */
  private liftFor(t: RobotTarget): number {
    return Math.max(FORK_LOW, t.reach.y - CRATE.h / 2 - 0.05)
  }

  private drive(pose: { x: number; z: number; yaw: number }): void {
    const moved = Math.hypot(pose.x - this.pos.x, pose.z - this.pos.z)
    if (moved > 0.005) this.yaw = turnToward(this.yaw, pose.yaw, 0.35)
    this.pos.set(pose.x, 0, pose.z)
  }

  private faceTo(target: THREE.Vector3): number {
    return Math.atan2(-(target.x - this.pos.x), -(target.z - this.pos.z))
  }
}

function turnToward(from: number, to: number, f: number): number {
  let d = to - from
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return from + d * f
}
