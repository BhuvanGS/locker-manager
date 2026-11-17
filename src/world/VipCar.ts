import * as THREE from 'three'
import { CONFIG } from '../sim/config'
import type { GameManager } from '../sim/GameManager'
import { OFFICE } from './layout'
import { makePerson, makeSign, mat, type PersonRig } from './models'
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
  private readonly wheels: THREE.Mesh[] = []
  /** The VIP on foot (between the car and their chair), and where they are on the walk. */
  private walker: { rig: PersonRig; group: THREE.Group } | null = null
  private walk: Walk = 'none'
  private readonly walkIn: Leg = rounded(WALK, 0.6)
  private readonly walkOut: Leg = rounded([...WALK].reverse(), 0.6)
  private walkFrom = 0
  private walked = 0

  constructor() {
    const body = mat(0x0b0f19, 0.35, 0.5)
    const trim = mat(0xfbbf24, 0.4, 0.6)
    const glass = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.1, metalness: 0.6 })
    // The car faces −x. Length 4.8, width 1.9.
    const add = (geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(geo, material)
      mesh.position.set(x, y, z)
      mesh.castShadow = true
      this.root.add(mesh)
      return mesh
    }
    add(new THREE.BoxGeometry(4.8, 0.62, 1.9), body, 0, 0.62, 0)
    add(new THREE.BoxGeometry(2.9, 0.55, 1.7), glass, 0.2, 1.18, 0)
    add(new THREE.BoxGeometry(2.7, 0.06, 1.6), body, 0.2, 1.49, 0)
    add(new THREE.BoxGeometry(4.82, 0.05, 1.92), trim, 0, 0.9, 0)
    for (const z of [-0.7, 0.7]) add(new THREE.BoxGeometry(0.08, 0.14, 0.3), mat(0xfff7d6, 0.3), -2.4, 0.7, z)
    for (const z of [-0.7, 0.7]) add(new THREE.BoxGeometry(0.08, 0.12, 0.3), mat(0xef4444, 0.4), 2.4, 0.7, z)
    const tyre = mat(0x111827, 0.9)
    for (const x of [-1.5, 1.5]) {
      for (const z of [-0.95, 0.95]) {
        const wheel = add(new THREE.CylinderGeometry(0.38, 0.38, 0.26, 16), tyre, x, 0.38, z)
        wheel.rotation.x = Math.PI / 2
        this.wheels.push(wheel)
        add(new THREE.CylinderGeometry(0.2, 0.2, 0.28, 12), mat(0xc0c7cf, 0.3, 0.8), x, 0.38, z).rotation.x = Math.PI / 2
      }
    }
    this.root.position.set(FAR, 0, PARK.z)
    this.root.visible = false
  }

  /** Take the VIP on foot out of the world (a new game). */
  dispose(): void {
    this.walker?.group.removeFromParent()
    this.walker = null
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
    const moving = Math.abs(step) > 1e-4
    if (moving) for (const w of this.wheels) w.rotation.y += (step / 0.38) * Math.sign(-1)
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
    const rig = makePerson({ ...look, hairStyle: look.hairStyle as 'bald' })
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
