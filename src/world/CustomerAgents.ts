import * as THREE from 'three'
import type { GameManager } from '../sim/GameManager'
import type { CustomerId, ItemId } from '../sim/types'
import { tag } from './interactables'
import { CUSTOMER_PATH } from './layout'
import { fitInto, makeItemMesh, makePerson, type PersonRig } from './models'

type Agent = {
  id: CustomerId
  rig: PersonRig
  path: THREE.Vector3[]
  leaving: boolean
  walkPhase: number
  spot: number
  carried: ItemId | null
}

const WALK_SPEED = 1.35

/**
 * The 3D side of customers: walking in and out, idling at the counter, carrying their item.
 * Only customers in the building have an agent; stored customers are just records in the sim.
 */
export class CustomerAgents {
  readonly root = new THREE.Group()
  private readonly agents = new Map<CustomerId, Agent>()
  private readonly look = new THREE.Vector3()

  spawn(game: GameManager, id: CustomerId): void {
    if (this.agents.has(id)) return
    const customer = game.customers.get(id)
    const rig = makePerson(customer.appearance)
    tag(rig.root, { kind: 'customer', customerId: id })
    rig.root.position.copy(CUSTOMER_PATH.street).add(new THREE.Vector3((Math.random() - 0.5) * 2, 0, 0))
    this.root.add(rig.root)
    const spot = this.freeSpot()
    const target = CUSTOMER_PATH.counterSpots[spot] ?? CUSTOMER_PATH.counterSpots[0]
    if (!target) return
    this.agents.set(id, {
      id,
      rig,
      path: [CUSTOMER_PATH.outsideDoor.clone(), CUSTOMER_PATH.insideDoor.clone(), target.clone()],
      leaving: false,
      walkPhase: 0,
      spot,
      carried: null,
    })
  }

  leave(id: CustomerId): void {
    const agent = this.agents.get(id)
    if (!agent) return
    agent.leaving = true
    agent.spot = -1
    agent.path = [CUSTOMER_PATH.insideDoor.clone(), CUSTOMER_PATH.outsideDoor.clone(), CUSTOMER_PATH.street.clone().add(new THREE.Vector3(3, 0, 0))]
  }

  /** True when any customer is close to the entrance (opens the sliding doors). */
  nearDoor(): boolean {
    for (const agent of this.agents.values()) {
      const p = agent.rig.root.position
      if (Math.abs(p.x) < 2.2 && Math.abs(p.z - 6.1) < 2.6) return true
    }
    return false
  }

  position(id: CustomerId): THREE.Vector3 | null {
    return this.agents.get(id)?.rig.root.position ?? null
  }

  update(dt: number, game: GameManager, playerPos: THREE.Vector3): void {
    for (const agent of [...this.agents.values()]) {
      this.syncCarried(agent, game)
      const pos = agent.rig.root.position
      const goal = agent.path[0]
      if (goal) {
        this.look.set(goal.x - pos.x, 0, goal.z - pos.z)
        const dist = this.look.length()
        if (dist < 0.05) {
          agent.path.shift()
          if (agent.path.length === 0) {
            if (agent.leaving) {
              this.remove(agent)
              game.customerExited(agent.id)
              continue
            }
            game.customerReachedCounter(agent.id)
          }
        } else {
          this.look.multiplyScalar(Math.min(1, (WALK_SPEED * dt) / dist))
          pos.add(this.look)
          agent.rig.root.rotation.y = dampAngle(agent.rig.root.rotation.y, Math.atan2(this.look.x, this.look.z), dt, 10)
          agent.walkPhase += dt * 7
        }
      } else {
        // Waiting at the counter: face the player, settle the limbs.
        const desired = Math.atan2(playerPos.x - pos.x, playerPos.z - pos.z)
        agent.rig.root.rotation.y = dampAngle(agent.rig.root.rotation.y, desired, dt, 4)
        agent.walkPhase *= Math.max(0, 1 - dt * 6)
      }
      const swing = Math.sin(agent.walkPhase) * (agent.path.length > 0 ? 0.5 : 0)
      agent.rig.legL.rotation.x = swing
      agent.rig.legR.rotation.x = -swing
      agent.rig.armL.rotation.x = -swing * 0.7
      agent.rig.armR.rotation.x = agent.carried ? 0.15 : swing * 0.7
    }
  }

  clear(): void {
    for (const agent of [...this.agents.values()]) this.remove(agent)
  }

  private syncCarried(agent: Agent, game: GameManager): void {
    let item: ItemId | null = null
    try {
      const customer = game.customers.get(agent.id)
      const record = game.customers.itemOf(customer)
      if (record && (record.status === 'withCustomer' || record.status === 'returned')) item = record.id
    } catch {
      item = null
    }
    if (item === agent.carried) return
    agent.carried = item
    agent.rig.hand.clear()
    if (!item) return
    const record = game.customers.item(item)
    const mesh = makeItemMesh(record.category, record.color)
    fitInto(mesh, 0.5, 0.65, 0.3)
    mesh.rotation.y = Math.PI / 2
    // Hang from the hand: the item's top sits at the hand.
    const size = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3())
    mesh.position.set(0, -size.y + 0.02, 0)
    agent.rig.hand.add(mesh)
  }

  private remove(agent: Agent): void {
    this.root.remove(agent.rig.root)
    this.agents.delete(agent.id)
  }

  private freeSpot(): number {
    const taken = new Set([...this.agents.values()].map((a) => a.spot))
    for (let i = 0; i < CUSTOMER_PATH.counterSpots.length; i++) if (!taken.has(i)) return i
    return 0
  }
}

function dampAngle(current: number, desired: number, dt: number, speed: number): number {
  let delta = desired - current
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  return current + delta * Math.min(1, dt * speed)
}
