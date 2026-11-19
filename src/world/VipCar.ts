import * as THREE from 'three'
import { CONFIG } from '../sim/config'
import type { GameManager } from '../sim/GameManager'
import { OFFICE } from './layout'
import { kenney, loadKenney } from './kenney'
import { animatePerson, makePerson, makeSign, type PersonRig } from './models'
import { Leg, rounded } from './paths'

/** Where the car parks (in the street in front of the deal office), and where it comes from and goes to. */
const PARK = { x: 9.3, z: 11.5 }
const FAR = 44
const SPEED = 9

type Phase = 'away' | 'arriving' | 'parked' | 'leaving'
type Walk = 'none' | 'in' | 'seated' | 'out'

/**
 * The VIP's walk from the car to the deal office: across the pavement, in through the shop's front door, across the lobby, through the
 * office door, round the desk to their chair (the office draws them seated from `readyAt`). They walk it backwards when they leave.
 */
const WALK: readonly (readonly [number, number])[] = [
  [PARK.x, 10.3],
  [PARK.x, 8.6],
  [0.6, 8.6],
  [0.6, 4.4],
  [4.6, 3.2],
  [7.2, 2.4],
  [8.8, 4.4],
  [OFFICE.vip.x, 4.4],
  [OFFICE.vip.x, OFFICE.vip.z],
]
const WALK_SPEED = 1.4

/**
 * A VIP's black car. When a VIP offer appears it drives in from the far end of the street and parks outside the deal office (with a
 * VIP plate over its roof, so you can see from the shop that someone important has come); when the offer is over it drives off. It makes
 * no decisions: it only follows `game.deals.offer`.
 */
export class VipCar {
  readonly root = new THREE.Group()
  private phase: Phase = 'away'
  private offerId = 0
  private plate: THREE.Mesh | null = null
  /** The VIP on foot (between the car and their chair), and where they are on the walk. */
  private walker: { rig: PersonRig; group: THREE.Group } | null = null
  private walk: Walk = 'none'
  private readonly walkIn: Leg = rounded(WALK, 0.6)
  private readonly walkOut: Leg = rounded([...WALK].reverse(), 0.6)
  private walkFrom = 0
  private walked = 0

  constructor() {
    // A black luxury SUV (Kenney Car Kit; its nose is +z, ours −x), with its own dark paint.
    const car = kenney('cars', 'suv-luxury', { x: 0, z: 0, rotY: -Math.PI / 2, scale: 1.55 })
    void loadKenney('cars', 'suv-luxury').then(() => {
      car.traverse((o) => {
        if (!(o instanceof THREE.Mesh) || o.name.startsWith('wheel')) return
        const m = (o.material as THREE.MeshStandardMaterial).clone()
        m.color.set(0x3a3f4a)
        m.metalness = 0.5
        m.roughness = 0.35
        o.material = m
      })
    })
    this.root.add(car)
    this.root.position.set(FAR, 0, PARK.z)
    this.root.visible = false
  }

  /** Take the VIP on foot out of the world (a new game). */
  dispose(): void {
    this.walker?.group.removeFromParent()
    this.walker = null
  }

  /** Where the car (and the VIP walking to the office) are, for the traffic to keep clear of. */
  obstacles(): THREE.Vector3[] {
    const out: THREE.Vector3[] = []
    if (this.phase !== 'away') out.push(this.root.position)
    if (this.walker) out.push(this.walker.group.position)
    return out
  }

  /** The VIP is near the shop's front door (so it opens for them). */
  nearDoor(): boolean {
    if (!this.walker?.group.visible) return false
    const p = this.walker.group.position
    return Math.abs(p.x) < 2.2 && Math.abs(p.z - 6.1) < 2.6
  }

  update(dt: number, game: GameManager): void {
    const offer = game.deals.offer
    if (offer && offer.id !== this.offerId) {
      // A new VIP: swap the plate and the person, and drive in.
      this.offerId = offer.id
      if (this.plate) this.root.remove(this.plate)
      this.plate = makeSign(`VIP · ${offer.name}`, 1.8, 0.26, '#0f172a', '#fbbf24')
      this.plate.position.set(0.2, 2.0, 0)
      this.plate.rotation.y = Math.PI / 2
      this.root.add(this.plate)
      this.root.position.x = FAR
      this.phase = 'arriving'
      this.root.visible = true
      this.makeWalker(offer.vip, offer.name)
      this.walk = 'none'
    } else if (!offer && (this.walk === 'in' || this.walk === 'seated')) {
      // The meeting is over: they walk back out to the car.
      this.walk = 'out'
      this.walked = 0
    } else if (!offer && this.walk === 'none' && (this.phase === 'arriving' || this.phase === 'parked')) {
      this.phase = 'leaving'
    }

    this.updateWalker(dt, game)

    let target = this.root.position.x
    if (this.phase === 'arriving') target = PARK.x
    else if (this.phase === 'leaving') target = -FAR
    const dx = target - this.root.position.x
    // Drive at a steady speed and ease off as it reaches the kerb.
    const step = Math.sign(dx) * Math.min(Math.abs(dx), (this.phase === 'arriving' ? Math.max(1.2, Math.min(SPEED, Math.abs(dx) * 1.1)) : SPEED) * dt)
    this.root.position.x += step
    if (this.phase === 'arriving' && Math.abs(dx) < 0.02) {
      this.phase = 'parked'
      // Out they get, timed to sit down at the desk when the offer is ready.
      if (offer && this.walk === 'none') {
        this.walk = 'in'
        this.walkFrom = game.now
      }
    }
    if (this.phase === 'leaving' && Math.abs(dx) < 0.05) {
      this.phase = 'away'
      this.root.visible = false
    }
    // Facing: nose to −x when driving in; when leaving it drives on (same direction), so no turn is needed.
  }

  private makeWalker(vip: number, name: string): void {
    if (this.walker) this.walker.group.removeFromParent()
    const look = CONFIG.deals.vips[vip]?.look ?? CONFIG.deals.vips[0]!.look
    const rig = makePerson({ ...look, hairStyle: look.hairStyle as 'bald' }, { smart: true, female: name.startsWith('Oprah') })
    const group = new THREE.Group()
    group.add(rig.root)
    // Their name over their head, always facing you (a sprite made from a sign's texture).
    const sign = makeSign(name, 1.1, 0.16, '#0f172a', '#fbbf24')
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: (sign.material as THREE.MeshStandardMaterial).map, depthWrite: false }))
    label.scale.set(1.1, 0.16, 1)
    label.position.set(0, 2.1, 0)
    group.add(label)
    group.visible = false
    // The walker lives in the world, not in the car (it is added next to the car's root).
    this.root.parent?.add(group)
    this.walker = { rig, group }
  }

  private updateWalker(dt: number, game: GameManager): void {
    const walker = this.walker
    if (!walker) return
    if (!walker.group.parent && this.root.parent) this.root.parent.add(walker.group)
    const offer = game.deals.offer
    let pose: { x: number; z: number; yaw: number } | null = null
    if (this.walk === 'in' && offer) {
      const span = Math.max(1, offer.readyAt - this.walkFrom)
      const u = (game.now - this.walkFrom) / span
      if (u >= 1) this.walk = 'seated'
      else pose = this.walkIn.at(u)
    } else if (this.walk === 'out') {
      this.walked += dt * WALK_SPEED
      if (this.walked >= this.walkOut.length) {
        this.walk = 'none'
        this.phase = 'leaving'
      } else pose = this.walkOut.at(this.walked / this.walkOut.length)
    }
    walker.group.visible = pose !== null
    if (!pose) return
    animatePerson(walker.rig, dt, 'walk')
    walker.group.position.set(pose.x, 0.02, pose.z)
    // People face +z, paths give a −z heading.
    walker.group.rotation.y = pose.yaw + Math.PI
    const swing = Math.sin(performance.now() / 160) * 0.5
    walker.rig.legL.rotation.x = swing
    walker.rig.legR.rotation.x = -swing
    walker.rig.armL.rotation.x = -swing * 0.6
    walker.rig.armR.rotation.x = swing * 0.6
  }
}
