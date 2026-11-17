import * as THREE from 'three'
import { mat } from './models'

/** From the wrist to the base of a bag in the gripper. */
export const HANG = 0.4

export type Pose = { x: number; wrist: number; reach: number; claw: number }
type Key = [p: number, x: number, wrist: number, reach: number, claw: number]

/** Where an arm picks bags up and drops them, in world coordinates (`reach` is a z offset from the rail). */
export interface Dock {
  x: number
  reach: number
  wrist: number
}

/** The fixed geometry of one arm: its rail, where it rests, and its two docks. */
export interface RigSpec {
  railY: number
  railZ: number
  pick: Dock
  drop: Dock
}

const YELLOW = mat(0xe5a50a, 0.55, 0.2)
const DARK = mat(0x1f2937, 0.5, 0.4)

/**
 * One robot arm hanging from a gantry rail: a carriage on the rail, a column down from it, a horizontal bar at the wrist
 * and a two-finger gripper. It moves smoothly towards the pose it is given each frame, so its motion lines up with the
 * simulation's arm job (door opening, bag moving, door shutting) without ever jumping.
 */
export class ArmRig {
  readonly root = new THREE.Group()
  /** A bag attached here moves with the gripper. */
  readonly anchor = new THREE.Group()
  readonly spec: RigSpec
  private readonly carriage = new THREE.Group()
  private readonly column: THREE.Mesh
  private readonly bar: THREE.Mesh
  private readonly gripper = new THREE.Group()
  private readonly fingers: THREE.Mesh[] = []
  private readonly lamp = new THREE.MeshBasicMaterial({ color: 0x22c55e })
  private pose: Pose

  constructor(spec: RigSpec) {
    this.spec = spec
    this.pose = this.idle()
    this.carriage.position.set(this.pose.x, spec.railY, spec.railZ)
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.4), DARK)
    this.carriage.add(body)
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.06), this.lamp)
    lamp.position.set(0, 0.14, 0.2)
    this.carriage.add(lamp)
    this.column = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1, 0.12), YELLOW)
    this.carriage.add(this.column)
    this.bar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 1), YELLOW)
    this.carriage.add(this.bar)
    this.carriage.add(this.gripper)
    const wrist = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.2), DARK)
    this.gripper.add(wrist)
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.22), DARK)
    palm.position.y = -0.14
    this.gripper.add(palm)
    for (const side of [-1, 1]) {
      const finger = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22, 0.2), YELLOW)
      finger.position.set(side * 0.24, -0.25, 0)
      this.gripper.add(finger)
      this.fingers.push(finger)
    }
    this.anchor.position.y = -HANG
    this.gripper.add(this.anchor)
    this.root.add(this.carriage)
    this.place()
  }

  /** Where the arm rests between jobs: over its pick-up dock, wrist high. */
  private idle(): Pose {
    return { x: this.spec.pick.x, wrist: this.spec.railY - 0.6, reach: 0, claw: 0 }
  }

  /** Move towards `target` (or rest if null) and redraw. `busy` lights the carriage lamp amber. */
  update(dt: number, target: Pose | null): void {
    const t = target ?? this.idle()
    const k = 1 - Math.exp(-7 * dt)
    this.pose.x += (t.x - this.pose.x) * k
    this.pose.wrist += (t.wrist - this.pose.wrist) * k
    this.pose.reach += (t.reach - this.pose.reach) * k
    this.pose.claw += (t.claw - this.pose.claw) * (1 - Math.exp(-14 * dt))
    this.lamp.color.setHex(target ? 0xf59e0b : 0x22c55e)
    this.place()
  }

  /** The gripper's x (for attaching things to the carriage's position). */
  get x(): number {
    return this.pose.x
  }

  /**
   * Where the arm should be, `progress` (0…1) of the way through a job on a locker whose opening is at `slot` (world
   * coordinates; `y` is the middle of the opening and `z` where the bag sits). The keyframes line up with the simulation's
   * `ARM_STEPS`: a store opens the door at 0.5, places at 0.64 and shuts at 0.86; a fetch opens at 0.3, grabs at 0.56 and shuts at 0.82.
   */
  target(kind: 'store' | 'fetch', progress: number, slot: { x: number; y: number; z: number }): Pose {
    const { railY, railZ, pick, drop } = this.spec
    const home = railY - 0.6
    const lockWrist = slot.y - 0.03
    const lockReach = slot.z - railZ
    const keys: Key[] =
      kind === 'store'
        ? [
            [0, pick.x, pick.wrist, pick.reach, 0],
            [0.1, pick.x, pick.wrist, pick.reach, 0],
            [0.18, pick.x, pick.wrist, pick.reach, 1],
            [0.3, pick.x, home, 0, 1],
            [0.42, slot.x, home, 0, 1],
            [0.5, slot.x, lockWrist, 0, 1],
            [0.62, slot.x, lockWrist, lockReach, 1],
            [0.68, slot.x, lockWrist, lockReach, 0],
            [0.78, slot.x, lockWrist, 0, 0],
            [0.86, slot.x, home, 0, 0],
            [1, pick.x, home, 0, 0],
          ]
        : [
            [0, slot.x, home, 0, 0],
            [0.2, slot.x, lockWrist, 0, 0],
            [0.36, slot.x, lockWrist, 0, 0],
            [0.5, slot.x, lockWrist, lockReach, 0],
            [0.56, slot.x, lockWrist, lockReach, 1],
            [0.66, slot.x, lockWrist, 0, 1],
            [0.74, slot.x, home, 0, 1],
            [0.84, drop.x, home, 0, 1],
            [0.92, drop.x, drop.wrist, drop.reach, 1],
            [0.97, drop.x, drop.wrist, drop.reach, 0],
            [1, drop.x, drop.wrist, drop.reach, 0],
          ]
    return sample(keys, progress)
  }

  /** Attach a bag to the gripper, or put it back in `parent`. */
  hold(bag: THREE.Object3D): void {
    if (bag.parent !== this.anchor) this.anchor.add(bag)
    bag.position.set(0, 0, 0)
    bag.rotation.set(0, 0, 0)
  }

  private place(): void {
    const { railY } = this.spec
    const { x, wrist, reach, claw } = this.pose
    this.carriage.position.x = x
    const down = railY - wrist // how far the wrist hangs below the rail
    this.column.scale.y = Math.max(0.01, down)
    this.column.position.y = -down / 2
    this.bar.scale.z = Math.max(0.01, Math.abs(reach))
    this.bar.position.set(0, -down, reach / 2)
    this.gripper.position.set(0, -down, reach)
    const open = 0.24 - claw * 0.09
    this.fingers[0]?.position.setX(-open)
    this.fingers[1]?.position.setX(open)
  }
}

/** Linear interpolation through keyframes `[progress, x, wrist, reach, claw]` (progress ascending), eased. */
function sample(keys: Key[], p: number): Pose {
  const first = keys[0]!
  if (p <= first[0]) return { x: first[1], wrist: first[2], reach: first[3], claw: first[4] }
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1]!
    const b = keys[i]!
    if (p > b[0]) continue
    const t = b[0] === a[0] ? 1 : (p - a[0]) / (b[0] - a[0])
    const s = t * t * (3 - 2 * t)
    return {
      x: a[1] + (b[1] - a[1]) * s,
      wrist: a[2] + (b[2] - a[2]) * s,
      reach: a[3] + (b[3] - a[3]) * s,
      claw: a[4] + (b[4] - a[4]) * s,
    }
  }
  const last = keys[keys.length - 1]!
  return { x: last[1], wrist: last[2], reach: last[3], claw: last[4] }
}
