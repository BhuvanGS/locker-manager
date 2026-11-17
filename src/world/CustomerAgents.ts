import * as THREE from 'three'
import type { GameManager } from '../sim/GameManager'
import type { CustomerId, ItemId } from '../sim/types'
import { tag } from './interactables'
import { COUNTER, CUSTOMER_PATH } from './layout'
import { fitInto, makeItemMesh, makePerson, type PersonRig } from './models'

type Slot = { kind: 'counter' | 'line'; index: number }

type Agent = {
  id: CustomerId
  rig: PersonRig
  path: THREE.Vector3[]
  leaving: boolean
  walkPhase: number
  slot: Slot | null
  /** Arrival order, so the line is first-come, first-served. */
  order: number
  carried: ItemId | null
  bar: THREE.Group
  barFill: THREE.Mesh
  /** Face above the head that shows how annoyed they are (after wrong packages). */
  mood: THREE.Sprite | null
  moodTier: number
}

const WALK_SPEED = 1.35
const BAR_WIDTH = 0.5

/**
 * The 3D side of customers: walking in and out, the counter spots and waiting line, carrying their
 * item, and a patience bar over anyone waiting. Only customers inside (or walking in/out) have an
 * agent; stored customers are just records in the sim.
 */
export class CustomerAgents {
  readonly root = new THREE.Group()
  private readonly bars = new THREE.Group()
  private readonly agents = new Map<CustomerId, Agent>()
  private readonly look = new THREE.Vector3()
  private nextOrder = 0
  private readonly barBack = new THREE.MeshBasicMaterial({ color: 0x0f172a, transparent: true, opacity: 0.75 })
  private readonly barGeo = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0)

  constructor() {
    this.root.add(this.bars)
  }

  spawn(game: GameManager, id: CustomerId): void {
    if (this.agents.has(id)) return
    const customer = game.customers.get(id)
    const rig = makePerson(customer.appearance)
    tag(rig.root, { kind: 'customer', customerId: id })
    rig.root.position.copy(CUSTOMER_PATH.street).add(new THREE.Vector3((Math.random() - 0.5) * 2, 0, 0))
    this.root.add(rig.root)

    const bar = new THREE.Group()
    const back = new THREE.Mesh(this.barGeo, this.barBack)
    back.scale.set(BAR_WIDTH + 0.04, 0.09, 1)
    back.position.x = -(BAR_WIDTH + 0.04) / 2
    const barFill = new THREE.Mesh(this.barGeo, new THREE.MeshBasicMaterial({ color: 0x4ade80 }))
    barFill.scale.set(BAR_WIDTH, 0.05, 1)
    barFill.position.set(-BAR_WIDTH / 2, 0, 0.002)
    bar.add(back, barFill)
    bar.visible = false
    this.bars.add(bar)

    const slot = this.claimSlot()
    const agent: Agent = {
      id,
      rig,
      path: [CUSTOMER_PATH.outsideDoor.clone(), CUSTOMER_PATH.insideDoor.clone(), this.slotPosition(slot).clone()],
      leaving: false,
      walkPhase: 0,
      slot,
      order: this.nextOrder++,
      carried: null,
      bar,
      barFill,
      mood: null,
      moodTier: 0,
    }
    this.agents.set(id, agent)
  }

  leave(id: CustomerId): void {
    const agent = this.agents.get(id)
    if (!agent) return
    agent.leaving = true
    agent.slot = null
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

  update(dt: number, game: GameManager, playerPos: THREE.Vector3, camera: THREE.Camera): void {
    this.promoteLine(game)
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
        // Standing: at the counter face the player; in line face the counter.
        const target = agent.slot?.kind === 'line' ? this.look.set(pos.x + 0.6, 0, COUNTER.z) : playerPos
        const desired = Math.atan2(target.x - pos.x, target.z - pos.z)
        agent.rig.root.rotation.y = dampAngle(agent.rig.root.rotation.y, desired, dt, 4)
        agent.walkPhase *= Math.max(0, 1 - dt * 6)
      }
      const swing = Math.sin(agent.walkPhase) * (agent.path.length > 0 ? 0.5 : 0)
      agent.rig.legL.rotation.x = swing
      agent.rig.legR.rotation.x = -swing
      agent.rig.armL.rotation.x = -swing * 0.7
      agent.rig.armR.rotation.x = agent.carried ? 0.15 : swing * 0.7
      this.updateBar(agent, game, camera)
      this.updateMood(agent, game)
    }
  }

  clear(): void {
    for (const agent of [...this.agents.values()]) this.remove(agent)
    this.nextOrder = 0
  }

  // ------------------------------------------------------------------ queue

  private claimSlot(): Slot {
    const taken = (kind: Slot['kind'], index: number) =>
      [...this.agents.values()].some((a) => a.slot?.kind === kind && a.slot.index === index)
    for (let i = 0; i < CUSTOMER_PATH.counterSpots.length; i++) if (!taken('counter', i)) return { kind: 'counter', index: i }
    for (let i = 0; i < CUSTOMER_PATH.lineSpots.length; i++) if (!taken('line', i)) return { kind: 'line', index: i }
    return { kind: 'line', index: CUSTOMER_PATH.lineSpots.length - 1 }
  }

  private slotPosition(slot: Slot): THREE.Vector3 {
    const list = slot.kind === 'counter' ? CUSTOMER_PATH.counterSpots : CUSTOMER_PATH.lineSpots
    const spot = list[slot.index] ?? list[list.length - 1]
    if (!spot) throw new Error('No customer spots configured')
    return spot
  }

  /** Move the front of the line up to any free counter spot, then close gaps in the line. */
  private promoteLine(game: GameManager): void {
    const all = [...this.agents.values()]
    const inLine = all.filter((a) => a.slot?.kind === 'line' && a.id !== game.dialogue?.customerId).sort((a, b) => a.order - b.order)
    for (let i = 0; i < CUSTOMER_PATH.counterSpots.length && inLine.length > 0; i++) {
      if (all.some((a) => a.slot?.kind === 'counter' && a.slot.index === i)) continue
      const next = inLine.shift()
      if (!next) break
      this.moveTo(next, { kind: 'counter', index: i })
    }
    // Shuffle the remaining line forward so there are no gaps.
    inLine.forEach((agent, index) => {
      if (agent.slot?.kind === 'line' && agent.slot.index !== index) this.moveTo(agent, { kind: 'line', index })
    })
  }

  private moveTo(agent: Agent, slot: Slot): void {
    agent.slot = slot
    const target = this.slotPosition(slot).clone()
    // Still walking in: replace only the final destination; otherwise walk straight there.
    if (agent.path.length > 0) agent.path[agent.path.length - 1] = target
    else agent.path = [target]
  }

  // ------------------------------------------------------------------ visuals

  /** 0 = calm, 1 = confused, 2 = angry, 3 = furious: from how many wrong packages they were handed. */
  private updateMood(agent: Agent, game: GameManager): void {
    const tries = game.customers.has(agent.id) ? game.customers.get(agent.id).visit.wrongAttempts : 0
    const tier = agent.leaving ? 0 : Math.min(3, tries)
    if (tier !== agent.moodTier) {
      agent.moodTier = tier
      if (tier > 0) {
        if (!agent.mood) {
          agent.mood = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }))
          agent.mood.scale.set(0.45, 0.45, 1)
          this.bars.add(agent.mood)
        }
        agent.mood.material.map = moodTexture(tier)
        agent.mood.material.needsUpdate = true
      }
    }
    if (!agent.mood) return
    agent.mood.visible = tier > 0
    if (tier === 0) return
    const p = agent.rig.root.position
    // Angrier faces bounce a little so they catch the eye.
    const bounce = tier >= 2 ? Math.sin(performance.now() / (tier === 3 ? 90 : 160)) * 0.04 : 0
    agent.mood.position.set(p.x, 2.4 + bounce, p.z)
  }

  private updateBar(agent: Agent, game: GameManager, camera: THREE.Camera): void {
    let ratio = -1
    if (game.customers.has(agent.id)) {
      const c = game.customers.get(agent.id)
      const waiting = c.state === 'waiting' || c.state === 'waitingForCollection' || c.state === 'depositing' || c.state === 'collecting'
      if (c.patienceDrains && waiting && c.maxPatience > 0) ratio = c.patience / c.maxPatience
    }
    agent.bar.visible = ratio >= 0 && !agent.leaving
    if (!agent.bar.visible) return
    const p = agent.rig.root.position
    agent.bar.position.set(p.x, 2.12, p.z)
    agent.bar.quaternion.copy(camera.quaternion)
    agent.barFill.scale.x = Math.max(0.001, BAR_WIDTH * ratio)
    const fill = agent.barFill.material as THREE.MeshBasicMaterial
    fill.color.setHex(ratio > 0.5 ? 0x4ade80 : ratio > 0.25 ? 0xfbbf24 : 0xf87171)
  }

  private syncCarried(agent: Agent, game: GameManager): void {
    let item: ItemId | null = null
    if (game.customers.has(agent.id)) {
      const record = game.customers.itemOf(game.customers.get(agent.id))
      if (record && (record.status === 'withCustomer' || record.status === 'returned')) item = record.id
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
    this.bars.remove(agent.bar)
    if (agent.mood) {
      this.bars.remove(agent.mood)
      agent.mood.material.dispose()
    }
    ;(agent.barFill.material as THREE.Material).dispose()
    this.agents.delete(agent.id)
  }
}

function dampAngle(current: number, desired: number, dt: number, speed: number): number {
  let delta = desired - current
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  return current + delta * Math.min(1, dt * speed)
}

const moodTextures = new Map<number, THREE.CanvasTexture>()

function moodTexture(tier: number): THREE.CanvasTexture {
  let texture = moodTextures.get(tier)
  if (!texture) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 128
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.font = '96px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(['', '😕', '😠', '🤬'][tier] ?? '🤬', 64, 70)
    }
    texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    moodTextures.set(tier, texture)
  }
  return texture
}
