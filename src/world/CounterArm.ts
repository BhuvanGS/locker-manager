import * as THREE from 'three'
import { cableTray } from './cables'
import type { GameManager } from '../sim/GameManager'
import { ArmRig, HANG, sample, type Key } from './ArmRig'
import { CONVEYOR, COUNTER, ROOM } from './layout'
import { fitInto, makeItemMesh, mat } from './models'
import { armYellow } from './textures'

const RAIL_Y = 2.85
/** The rail runs along the counter on the staff side, just behind it. */
const RAIL_Z = COUNTER.z - COUNTER.depth / 2 - 0.15
const MIN_X = -5.6
const MAX_X = 3.7
const HOME_X = -4.7
const HOME_WRIST = RAIL_Y - 0.6
/** Where a customer holds their bag (in front of the counter) and the height of their hand. */
const CUSTOMER_Z = COUNTER.z + COUNTER.depth / 2 + 0.4
const HAND_WRIST = 0.78 + HANG
const BELT_WRIST = CONVEYOR.topY + HANG

/** The second counter arm rides its own rail behind the first (further from the counter), and rests at the other end. */
const RAILS = [
  { z: RAIL_Z, homeX: HOME_X },
  { z: RAIL_Z - 0.5, homeX: 2.8 },
] as const

type Arm = { rig: ArmRig; z: number; homeX: number; bag: { group: THREE.Group; itemId: string } | null }

/**
 * The counter arms (late automation): robot arms on rails over the counter. For a customer leaving a bag an arm reaches over the
 * counter, takes the bag from their hand and carries it to the start of the belt; for a customer collecting it takes their bag from the
 * return tray and hands it to them. The second arm (an upgrade) has its own rail. They draw `game.counterJobViews()` and decide nothing.
 */
export class CounterArm {
  readonly root = new THREE.Group()
  private readonly arms: Arm[] = []

  constructor() {
    this.root.userData.zone = 'main'
    this.addArm(0)
  }

  private addArm(i: number): void {
    const { z, homeX } = RAILS[i]!
    const rig = new ArmRig({
      railY: RAIL_Y,
      rowZ: () => z,
      runX: null,
      pick: { x: homeX, z, reach: 0, wrist: HOME_WRIST },
      drop: { x: homeX, z, reach: 0, wrist: HOME_WRIST },
    })
    this.root.add(rig.root)
    const yellow = armYellow()
    const dark = mat(0x1f2937, 0.5, 0.4)
    const beam = new THREE.Mesh(new THREE.BoxGeometry(MAX_X - MIN_X, 0.14, 0.16), yellow)
    beam.position.set((MIN_X + MAX_X) / 2, RAIL_Y + 0.12, z)
    this.root.add(beam)
    if (i === 0) this.root.add(cableTray(MIN_X + 0.05, MAX_X - 0.05, RAIL_Y + 0.09, z - 0.15, RAIL_Y + 0.09))
    for (const x of [-4.5, -1.5, 1.5, 3.3]) {
      const hanger = new THREE.Mesh(new THREE.BoxGeometry(0.06, ROOM.height - RAIL_Y - 0.05, 0.06), dark)
      hanger.position.set(x, (ROOM.height + RAIL_Y + 0.05) / 2, z)
      this.root.add(hanger)
    }
    this.arms.push({ rig, z, homeX, bag: null })
  }

  dispose(): void {
    for (const arm of this.arms) arm.bag?.group.removeFromParent()
  }

  update(dt: number, game: GameManager, customerX: (id: string) => number | null): void {
    while (this.arms.length < game.counterArms) this.addArm(this.arms.length)
    const jobs = game.counterJobViews()
    this.arms.forEach((arm, i) => {
      const job = jobs.find((j) => j.arm === i)
      if (!job) {
        arm.rig.update(dt, null)
        this.dropBag(arm)
        return
      }
      const z = arm.z
      const home = arm.homeX
      const reach = CUSTOMER_Z - z
      const inReach = CONVEYOR.startZ - 0.15 - z
      const outReach = CONVEYOR.trayZ - z
      const cx = Math.max(MIN_X, Math.min(MAX_X, customerX(job.customerId) ?? 0))
      const take: Key[] = [
        [0, home, z, HOME_WRIST, 0, 0],
        [0.2, cx, z, HOME_WRIST, 0, 0],
        [0.28, cx, z, HAND_WRIST, reach, 0],
        [0.4, cx, z, HAND_WRIST, reach, 1],
        [0.5, cx, z, HOME_WRIST, 0, 1],
        [0.78, CONVEYOR.inX, z, HOME_WRIST, 0, 1],
        [0.86, CONVEYOR.inX, z, BELT_WRIST, inReach, 1],
        [0.95, CONVEYOR.inX, z, BELT_WRIST, inReach, 0],
        [1, CONVEYOR.inX, z, BELT_WRIST, inReach, 0],
      ]
      const give: Key[] = [
        [0, home, z, HOME_WRIST, 0, 0],
        [0.12, CONVEYOR.outX, z, HOME_WRIST, 0, 0],
        [0.22, CONVEYOR.outX, z, BELT_WRIST, outReach, 0],
        [0.35, CONVEYOR.outX, z, BELT_WRIST, outReach, 1],
        [0.42, CONVEYOR.outX, z, HOME_WRIST, 0, 1],
        [0.7, cx, z, HOME_WRIST, 0, 1],
        [0.8, cx, z, HAND_WRIST, reach, 1],
        [0.94, cx, z, HAND_WRIST, reach, 0],
        [1, cx, z, HAND_WRIST, reach, 0],
      ]
      arm.rig.update(dt, sample(job.kind === 'take' ? take : give, job.progress))

      // The bag is in the gripper from the moment it is grabbed (the sim marks it `withArm`) until it is let go.
      const customer = game.customers.has(job.customerId) ? game.customers.get(job.customerId) : null
      const item = customer ? game.customers.itemOf(customer) : null
      if (item?.status === 'withArm' && job.progress < (job.kind === 'take' ? 0.99 : 1)) {
        if (!arm.bag || arm.bag.itemId !== item.id) {
          this.dropBag(arm)
          const mesh = makeItemMesh(item.category, item.color)
          fitInto(mesh, 0.38, 0.3, 0.3)
          const group = new THREE.Group()
          group.add(mesh)
          arm.bag = { group, itemId: item.id }
        }
        arm.rig.hold(arm.bag.group)
      } else {
        this.dropBag(arm)
      }
    })
  }

  private dropBag(arm: Arm): void {
    if (!arm.bag) return
    arm.bag.group.removeFromParent()
    arm.bag = null
  }
}
