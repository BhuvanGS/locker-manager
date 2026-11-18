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
const CUSTOMER_REACH = CUSTOMER_Z - RAIL_Z
const BELT_WRIST = CONVEYOR.topY + HANG
const IN_REACH = CONVEYOR.startZ - 0.15 - RAIL_Z
const OUT_REACH = CONVEYOR.trayZ - RAIL_Z

/**
 * The counter arm (late automation): a robot arm on a rail over the counter. For a customer leaving a bag it reaches over the counter,
 * takes the bag from their hand and carries it to the start of the belt; for a customer collecting it takes their bag from the return
 * tray and hands it to them. It draws `game.counterJob` and decides nothing.
 */
export class CounterArm {
  readonly root = new THREE.Group()
  private readonly rig: ArmRig
  private bag: { group: THREE.Group; itemId: string } | null = null

  constructor() {
    this.root.userData.zone = 'main'
    this.rig = new ArmRig({
      railY: RAIL_Y,
      rowZ: () => RAIL_Z,
      runX: null,
      pick: { x: HOME_X, z: RAIL_Z, reach: 0, wrist: HOME_WRIST },
      drop: { x: HOME_X, z: RAIL_Z, reach: 0, wrist: HOME_WRIST },
    })
    this.root.add(this.rig.root)
    const yellow = armYellow()
    const dark = mat(0x1f2937, 0.5, 0.4)
    const beam = new THREE.Mesh(new THREE.BoxGeometry(MAX_X - MIN_X, 0.14, 0.16), yellow)
    beam.position.set((MIN_X + MAX_X) / 2, RAIL_Y + 0.12, RAIL_Z)
    this.root.add(beam)
    this.root.add(cableTray(MIN_X + 0.05, MAX_X - 0.05, RAIL_Y + 0.09, RAIL_Z - 0.15, RAIL_Y + 0.09))
    for (const x of [-4.5, -1.5, 1.5, 3.3]) {
      const hanger = new THREE.Mesh(new THREE.BoxGeometry(0.06, ROOM.height - RAIL_Y - 0.05, 0.06), dark)
      hanger.position.set(x, (ROOM.height + RAIL_Y + 0.05) / 2, RAIL_Z)
      this.root.add(hanger)
    }
  }

  dispose(): void {
    if (this.bag) this.bag.group.removeFromParent()
  }

  update(dt: number, game: GameManager, customerX: (id: string) => number | null): void {
    const job = game.counterJobView()
    if (!job) {
      this.rig.update(dt, null)
      this.dropBag()
      return
    }
    const cx = Math.max(MIN_X, Math.min(MAX_X, customerX(job.customerId) ?? 0))
    const take: Key[] = [
      [0, HOME_X, RAIL_Z, HOME_WRIST, 0, 0],
      [0.2, cx, RAIL_Z, HOME_WRIST, 0, 0],
      [0.28, cx, RAIL_Z, HAND_WRIST, CUSTOMER_REACH, 0],
      [0.4, cx, RAIL_Z, HAND_WRIST, CUSTOMER_REACH, 1],
      [0.5, cx, RAIL_Z, HOME_WRIST, 0, 1],
      [0.78, CONVEYOR.inX, RAIL_Z, HOME_WRIST, 0, 1],
      [0.86, CONVEYOR.inX, RAIL_Z, BELT_WRIST, IN_REACH, 1],
      [0.95, CONVEYOR.inX, RAIL_Z, BELT_WRIST, IN_REACH, 0],
      [1, CONVEYOR.inX, RAIL_Z, BELT_WRIST, IN_REACH, 0],
    ]
    const give: Key[] = [
      [0, HOME_X, RAIL_Z, HOME_WRIST, 0, 0],
      [0.12, CONVEYOR.outX, RAIL_Z, HOME_WRIST, 0, 0],
      [0.22, CONVEYOR.outX, RAIL_Z, BELT_WRIST, OUT_REACH, 0],
      [0.35, CONVEYOR.outX, RAIL_Z, BELT_WRIST, OUT_REACH, 1],
      [0.42, CONVEYOR.outX, RAIL_Z, HOME_WRIST, 0, 1],
      [0.7, cx, RAIL_Z, HOME_WRIST, 0, 1],
      [0.8, cx, RAIL_Z, HAND_WRIST, CUSTOMER_REACH, 1],
      [0.94, cx, RAIL_Z, HAND_WRIST, CUSTOMER_REACH, 0],
      [1, cx, RAIL_Z, HAND_WRIST, CUSTOMER_REACH, 0],
    ]
    this.rig.update(dt, sample(job.kind === 'take' ? take : give, job.progress))

    // The bag is in the gripper from the moment it is grabbed (the sim marks it `withArm`) until it is let go.
    const customer = game.customers.has(job.customerId) ? game.customers.get(job.customerId) : null
    const item = customer ? game.customers.itemOf(customer) : null
    if (item?.status === 'withArm' && job.progress < (job.kind === 'take' ? 0.99 : 1)) {
      if (!this.bag || this.bag.itemId !== item.id) {
        this.dropBag()
        const mesh = makeItemMesh(item.category, item.color)
        fitInto(mesh, 0.38, 0.3, 0.3)
        const group = new THREE.Group()
        group.add(mesh)
        this.bag = { group, itemId: item.id }
      }
      this.rig.hold(this.bag.group)
    } else {
      this.dropBag()
    }
  }

  private dropBag(): void {
    if (!this.bag) return
    this.bag.group.removeFromParent()
    this.bag = null
  }
}
