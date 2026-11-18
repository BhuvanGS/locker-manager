import * as THREE from 'three'
import type { RobotJob } from '../sim/WarehouseManager'
import { mat } from './models'
import { armDark, textured } from './textures'
import { Leg } from './paths'

type Pt = { x: number; z: number }
const key = (p: Pt): string => `${Math.round(p.x * 100)}:${Math.round(p.z * 100)}`

/**
 * The robots' painted lanes as a graph. Every lane is an axis-aligned segment; nodes are the segments' ends, every crossing, and any
 * extra point that lies on a lane (the spots in front of each rack slot and dock), so a robot can stop exactly there.
 */
export class LaneGraph {
  readonly nodes: Pt[] = []
  private readonly adj: { to: number; d: number }[][] = []
  private readonly index = new Map<string, number>()
  readonly segments: readonly (readonly [number, number, number, number])[]

  constructor(segments: readonly (readonly [number, number, number, number])[], extra: readonly Pt[]) {
    this.segments = segments
    const points = [...extra]
    for (const [x0, z0, x1, z1] of segments) points.push({ x: x0, z: z0 }, { x: x1, z: z1 })
    for (const [x0, z0, x1, z1] of segments) {
      // Every point that lies on this segment, in order along it.
      const on = points.filter((p) => onSegment(p, x0, z0, x1, z1))
      for (const [ax, az, bx, bz] of segments) {
        const c = crossing(x0, z0, x1, z1, ax, az, bx, bz)
        if (c) on.push(c)
      }
      const along = (p: Pt) => Math.hypot(p.x - x0, p.z - z0)
      on.sort((a, b) => along(a) - along(b))
      let prev = -1
      for (const p of on) {
        const id = this.node(p)
        if (prev >= 0 && prev !== id) {
          const d = Math.hypot(p.x - this.nodes[prev]!.x, p.z - this.nodes[prev]!.z)
          this.adj[prev]!.push({ to: id, d })
          this.adj[id]!.push({ to: prev, d })
        }
        prev = id
      }
    }
  }

  private node(p: Pt): number {
    const k = key(p)
    let id = this.index.get(k)
    if (id === undefined) {
      id = this.nodes.length
      this.nodes.push({ x: p.x, z: p.z })
      this.adj.push([])
      this.index.set(k, id)
    }
    return id
  }

  nearest(p: Pt): number {
    let best = 0
    let bestD = Infinity
    this.nodes.forEach((n, i) => {
      const d = Math.hypot(n.x - p.x, n.z - p.z)
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    return best
  }

  /** The shortest way along the lanes from `from` to `to` (both snapped to the nearest node), as a leg to drive. */
  route(from: Pt, to: Pt): Leg {
    const a = this.nearest(from)
    const b = this.nearest(to)
    const dist = this.nodes.map(() => Infinity)
    const prev = this.nodes.map(() => -1)
    const done = this.nodes.map(() => false)
    dist[a] = 0
    for (;;) {
      let u = -1
      for (let i = 0; i < dist.length; i++) if (!done[i] && dist[i]! < Infinity && (u < 0 || dist[i]! < dist[u]!)) u = i
      if (u < 0 || u === b) break
      done[u] = true
      for (const { to: v, d } of this.adj[u]!) {
        if (dist[u]! + d < dist[v]!) {
          dist[v] = dist[u]! + d
          prev[v] = u
        }
      }
    }
    const path: Pt[] = []
    for (let v = b; v >= 0; v = prev[v]!) {
      path.unshift(this.nodes[v]!)
      if (v === a) break
    }
    if (path[0] !== this.nodes[a]) path.unshift(this.nodes[a]!) // unreachable: go straight
    return new Leg([{ x: from.x, z: from.z }, ...path])
  }
}

function onSegment(p: Pt, x0: number, z0: number, x1: number, z1: number): boolean {
  const eps = 0.01
  return p.x >= Math.min(x0, x1) - eps && p.x <= Math.max(x0, x1) + eps && p.z >= Math.min(z0, z1) - eps && p.z <= Math.max(z0, z1) + eps && (Math.abs(x0 - x1) < eps ? Math.abs(p.x - x0) < eps : Math.abs(p.z - z0) < eps)
}

function crossing(x0: number, z0: number, x1: number, z1: number, ax: number, az: number, bx: number, bz: number): Pt | null {
  const vertical = Math.abs(x0 - x1) < 0.01
  const otherVertical = Math.abs(ax - bx) < 0.01
  if (vertical === otherVertical) return null
  const p = vertical ? { x: x0, z: az } : { x: ax, z: z0 }
  return onSegment(p, x0, z0, x1, z1) && onSegment(p, ax, az, bx, bz) ? p : null
}

/** Where a robot goes for one end of a job: the spot on a lane it drives to, and the point its clamp reaches (a crate's centre). */
export type RobotTarget = { approach: Pt; reach: THREE.Vector3 }

const DECK_Y = 0.36
const CRATE = { w: 0.8, h: 0.6, d: 0.8 }
/** Moments in a job (fractions of it): arrive at the pick-up, (grab: the sim's `grabAt`), back in carrying pose, arrive at the drop-off. */
const ARRIVE_A = 0.3
const LIFTED = 0.55
const ARRIVE_B = 0.88
const smooth = (u: number): number => {
  const v = Math.min(1, Math.max(0, u))
  return v * v * (3 - 2 * v)
}

/**
 * One warehouse robot: a yellow wheeled base with a mast, a telescoping boom, and a big clamp sized for warehouse crates. It drives the
 * painted lanes to the truck or rack of its job, reaches out with the clamp, carries the crate on its deck, and puts it down at the other
 * end, all timed to the sim's `RobotJob` (`t / duration`, crate picked up at `grabAt`). Idle, it goes back to its charging spot.
 */
export class WarehouseRobot {
  private readonly base = new THREE.Group()
  private readonly boom: THREE.Mesh
  private readonly claw = new THREE.Group()
  private readonly jaws: THREE.Mesh[] = []
  private readonly crate: THREE.Mesh
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
  /** Where the clamp was when the last job ended (it eases back to the deck from there). */
  private readonly lastClaw = new THREE.Vector3()
  private settle = 1
  private readonly lanes: LaneGraph
  private readonly home: Pt

  constructor(parent: THREE.Group, lanes: LaneGraph, home: Pt) {
    this.lanes = lanes
    this.home = home
    this.pos = new THREE.Vector3(home.x, 0, home.z)
    const yellow = textured('arm-paint', { color: 0xf59e0b, metalness: 0.3, normalScale: 0.8, repeat: 0.5, colorMap: false })
    const dark = armDark()
    const steel = textured('locker-door', { color: 0xc4ccd6, metalness: 0.5, normalScale: 0.6, repeat: 0.5 })
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, into: THREE.Object3D = this.base) => {
      const mesh = new THREE.Mesh(geo, m)
      mesh.position.set(x, y, z)
      mesh.castShadow = true
      into.add(mesh)
      return mesh
    }
    // Base (faces −z): body, deck, wheels, a bumper, the mast at the back.
    add(new THREE.BoxGeometry(1.0, 0.24, 1.2), yellow, 0, 0.2, 0)
    add(new THREE.BoxGeometry(0.94, 0.04, 0.9), dark, 0, DECK_Y - 0.02, -0.12)
    add(new THREE.BoxGeometry(1.04, 0.08, 0.06), dark, 0, 0.16, -0.63)
    for (const x of [-0.46, 0.46]) {
      for (const z of [-0.42, 0.42]) {
        const wheel = add(new THREE.CylinderGeometry(0.11, 0.11, 0.1, 12), dark, x, 0.11, z)
        wheel.rotation.z = Math.PI / 2
      }
    }
    add(new THREE.BoxGeometry(0.22, 1.7, 0.22), yellow, 0, 0.32 + 0.85, 0.48)
    add(new THREE.BoxGeometry(0.34, 0.2, 0.34), dark, 0, 2.1, 0.48)
    this.lamp = new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x22c55e, emissiveIntensity: 1.2 })
    add(new THREE.SphereGeometry(0.07, 10, 8), this.lamp, 0, 2.27, 0.48)
    parent.add(this.base)

    // The boom (a box along its own z, stretched from the mast's head to the clamp) and the clamp.
    this.boom = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 1), steel)
    this.boom.castShadow = true
    parent.add(this.boom)
    add(new THREE.BoxGeometry(1.08, 0.07, 1.0), dark, 0, CRATE.h / 2 + 0.07, 0, this.claw)
    add(new THREE.BoxGeometry(0.12, 0.12, 0.12), steel, 0, CRATE.h / 2 + 0.16, 0, this.claw)
    for (const side of [-1, 1]) {
      const jaw = add(new THREE.BoxGeometry(0.07, CRATE.h + 0.12, 0.92), yellow, side * (CRATE.w / 2 + 0.05), 0, 0, this.claw)
      jaw.userData.side = side
      this.jaws.push(jaw)
    }
    this.crate = add(new THREE.BoxGeometry(CRATE.w, CRATE.h, CRATE.d), mat(0xb08a5a, 0.85), 0, 0, 0, this.claw)
    this.crate.visible = false
    parent.add(this.claw)
    this.lastClaw.copy(this.carryPoint())
  }

  /** Where a carried crate sits: on the deck. */
  private carryPoint(): THREE.Vector3 {
    const local = new THREE.Vector3(0, DECK_Y + CRATE.h / 2, -0.12).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw)
    return local.add(this.pos)
  }

  /**
   * `job` is this robot's sim job (or null), `targets` turns a new job into its two ends, `grabAt` is the sim's pick-up moment and
   * `crateColour` the colour of the crate it holds.
   */
  update(dt: number, job: RobotJob | null, targets: (job: RobotJob) => { a: RobotTarget; b: RobotTarget }, grabAt: number, crateColour: number): void {
    if (job !== this.job) {
      if (this.job) {
        this.lastClaw.copy(this.claw.position)
        this.settle = 0
      }
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

    let clawAt = this.carryPoint()
    let holding = false
    let open = 0.12
    let face: number | null = null
    if (job && this.legA && this.legB && this.a && this.b) {
      const p = job.t / job.duration
      if (p < ARRIVE_A) this.drive(this.legA.at(smooth(p / ARRIVE_A)))
      else if (p < LIFTED) {
        this.drive(this.legA.at(1))
        face = this.faceTo(this.a.reach)
        const reach = p < grabAt ? smooth(((p - ARRIVE_A) / (grabAt - ARRIVE_A)) * 1.25) : 1 - smooth((p - grabAt) / (LIFTED - grabAt))
        clawAt = this.carryPoint().lerp(this.a.reach, reach)
        holding = p >= grabAt
        open = p >= grabAt - 0.02 ? 0 : 0.12
      } else if (p < ARRIVE_B) {
        this.drive(this.legB.at(smooth((p - LIFTED) / (ARRIVE_B - LIFTED))))
        clawAt = this.carryPoint()
        holding = true
        open = 0
      } else {
        this.drive(this.legB.at(1))
        face = this.faceTo(this.b.reach)
        clawAt = this.carryPoint().lerp(this.b.reach, smooth(((p - ARRIVE_B) / (1 - ARRIVE_B)) * 1.2))
        holding = true
        open = 0
      }
    } else {
      // Idle: settle the clamp back on the deck, and after a while drive home to charge.
      this.settle = Math.min(1, this.settle + dt * 1.6)
      clawAt = this.lastClaw.clone().lerp(this.carryPoint(), smooth(this.settle))
      this.idle += dt
      const away = Math.hypot(this.pos.x - this.home.x, this.pos.z - this.home.z) > 0.05
      if (this.idle > 6 && away && !this.homeLeg) {
        this.homeLeg = this.lanes.route(this.pos, this.home)
        this.homeLeg = new Leg([...this.homeLeg.pts, this.home])
        this.homeT = 0
      }
      if (this.homeLeg) {
        this.homeT = Math.min(this.homeLeg.length, this.homeT + dt * 1.6)
        this.drive(this.homeLeg.at(this.homeLeg.length > 0 ? this.homeT / this.homeLeg.length : 1))
        if (this.homeT >= this.homeLeg.length) this.homeLeg = null
      }
    }
    if (face !== null) this.turnTo(face, dt)

    this.base.position.copy(this.pos)
    this.base.rotation.y = this.yaw
    // The clamp hangs level, turned with the base; the boom runs from the mast head to the top of the clamp.
    this.claw.position.copy(clawAt)
    this.claw.rotation.y = this.yaw
    for (const jaw of this.jaws) jaw.position.x = (jaw.userData.side as number) * (CRATE.w / 2 + 0.05 + open)
    this.crate.visible = holding
    if (holding) (this.crate.material as THREE.MeshStandardMaterial).color.setHex(crateColour)
    const head = new THREE.Vector3(0, 2.1, 0.48).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw).add(this.pos)
    const wrist = clawAt.clone().add(new THREE.Vector3(0, CRATE.h / 2 + 0.2, 0))
    this.boom.position.copy(head).add(wrist).multiplyScalar(0.5)
    this.boom.scale.z = Math.max(0.05, head.distanceTo(wrist))
    this.boom.lookAt(this.boom.parent ? this.boom.parent.localToWorld(wrist.clone()) : wrist)
    this.lamp.color.setHex(job ? 0xf59e0b : 0x22c55e)
    this.lamp.emissive.setHex(job ? 0xf59e0b : 0x22c55e)
  }

  private drive(pose: { x: number; z: number; yaw: number }): void {
    const moved = Math.hypot(pose.x - this.pos.x, pose.z - this.pos.z)
    if (moved > 0.005) this.yaw = turnToward(this.yaw, pose.yaw, 0.35)
    this.pos.set(pose.x, 0, pose.z)
  }

  private faceTo(target: THREE.Vector3): number {
    return Math.atan2(-(target.x - this.pos.x), -(target.z - this.pos.z))
  }

  private turnTo(yaw: number, dt: number): void {
    this.yaw = turnToward(this.yaw, yaw, Math.min(1, dt * 5))
  }
}

function turnToward(from: number, to: number, f: number): number {
  let d = to - from
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return from + d * f
}
