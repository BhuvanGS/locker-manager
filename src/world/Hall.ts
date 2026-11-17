import type RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import type { PhysicsWorld } from '../engine/PhysicsWorld'
import { markBlocker } from './interactables'
import { FLOOR_HEIGHT, ROOM, SLAB, SOUTH, stairHole } from './layout'
import { makeSign, mat } from './models'

export type HallKind = 'south' | 'floor1' | 'floor2'

/** Which level each hall is on: the south expansion is on the ground, floors 1 and 2 are stacked above it. */
export const HALL_LEVEL: Record<HallKind, number> = { south: 0, floor1: 1, floor2: 2 }

const TITLES: Record<HallKind, string> = { south: 'SOUTH EXPANSION', floor1: 'FLOOR 1', floor2: 'FLOOR 2' }
const T = 0.2 // wall thickness
const H = ROOM.height
const RISE_SECONDS = 1.6

/**
 * One big storage hall: the south expansion behind the storage room, or a floor stacked on top of it. They all share one
 * footprint (see SOUTH in layout.ts). A hall owns its walls, its ceiling slab (which is also the floor of the hall above)
 * and its lights. Its locker banks and key racks are separate views the Engine places inside it.
 *
 * Ceiling slabs of the south hall and floor 1 have a stairwell hole closed by a removable hatch; buying the floor above
 * removes the hatch and builds the stairs through it (see `Stairs`).
 */
export class Hall {
  readonly root = new THREE.Group()
  readonly kind: HallKind
  readonly level: number
  private readonly physics: PhysicsWorld
  private readonly floorY: number
  private bodies: RAPIER.RigidBody[] = []
  private hatch: { mesh: THREE.Mesh; body: RAPIER.RigidBody } | null = null
  private rise = 1

  constructor(kind: HallKind, physics: PhysicsWorld) {
    this.kind = kind
    this.level = HALL_LEVEL[kind]
    this.physics = physics
    this.floorY = this.level * FLOOR_HEIGHT
    // Everything is positioned relative to this hall's floor so the hall can rise in place.
    this.root.position.y = this.floorY
    this.root.userData.zone = kind

    const { minX, maxX, minZ, maxZ } = SOUTH
    const wall = mat(0xd5d9de, 0.9)
    const slab = mat(0xbfbab0, 0.95)
    const z0 = minZ - T // far end, outer face
    const z1 = maxZ + T // old back wall's south face plane, outer face
    const lenZ = z1 - z0
    const cz = (z0 + z1) / 2
    const widthX = maxX - minX + 2 * T

    // Walls: west, east and the far (south) end. Floors above also need their own north wall (on the ground the old
    // back wall of the storage room is the north wall).
    this.solid(T, H, lenZ, wall, minX - T / 2, H / 2, cz)
    this.solid(T, H, lenZ, wall, maxX + T / 2, H / 2, cz)
    this.solid(widthX, H, T, wall, 0, H / 2, minZ - T / 2)
    if (this.level > 0) this.solid(widthX, H, T, wall, 0, H / 2, maxZ + T / 2)

    // Ground floor (upper floors stand on the slab of the hall below).
    if (this.level === 0) {
      const floor = new THREE.Mesh(new THREE.BoxGeometry(maxX - minX, 0.02, maxZ - minZ), mat(0x8f949a, 0.85))
      floor.position.set(0, 0.005, (minZ + maxZ) / 2)
      floor.receiveShadow = true
      this.root.add(floor)
    }

    this.buildCeilingSlab(slab, z0, z1)

    // Ceiling light fixtures (no real lights: the global light already fills the room, and many point lights are costly).
    const panel = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff8e7, emissiveIntensity: 1.3 })
    for (const x of [-2.5, 2.5]) {
      for (const z of [-13.5, -18]) {
        const fixture = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.05, 0.4), panel)
        fixture.position.set(x, H - 0.03, z)
        this.root.add(fixture)
      }
    }

    // Signs: the hall's name on its far wall, and (south hall only) above the new doorway in the storage room.
    const title = makeSign(TITLES[kind], 2.6, 0.36, '#0f172a', '#fbbf24')
    title.position.set(0, H - 0.5, minZ + 0.03)
    this.root.add(title)
    if (this.level === 0) {
      const doorSign = makeSign('SOUTH EXPANSION', 1.6, 0.26, '#0f172a', '#fbbf24')
      doorSign.position.set(SOUTH.door.x, SOUTH.door.height + 0.4, ROOM.minZ + 0.03)
      this.root.add(doorSign)
    }
  }

  /** Start the "rising out of the ground" animation (a freshly bought hall). */
  appear(): void {
    this.rise = 0
    this.root.scale.y = 0.001
  }

  update(dt: number): void {
    if (this.rise >= 1) return
    this.rise = Math.min(1, this.rise + dt / RISE_SECONDS)
    this.root.scale.y = Math.max(0.001, 1 - (1 - this.rise) ** 3)
  }

  /** Take out the stairwell hatch so the stairs to the next floor can go through the ceiling. */
  openHatch(): void {
    if (!this.hatch) return
    this.root.remove(this.hatch.mesh)
    this.physics.removeBody(this.hatch.body)
    this.bodies = this.bodies.filter((b) => b !== this.hatch?.body)
    this.hatch = null
  }

  dispose(): void {
    for (const body of this.bodies) this.physics.removeBody(body)
    this.bodies = []
    this.hatch = null
  }

  /**
   * The ceiling slab (the floor of the next level up). Below the top floor it has a stairwell hole, built as four slab
   * pieces around the hole plus a hatch that fills the hole until the floor above is bought.
   */
  private buildCeilingSlab(material: THREE.Material, z0: number, z1: number): void {
    const y = H + SLAB / 2
    const x0 = SOUTH.minX - T
    const x1 = SOUTH.maxX + T
    const lenZ = z1 - z0
    const cz = (z0 + z1) / 2
    if (this.kind === 'floor2') {
      this.solid(x1 - x0, SLAB, lenZ, material, (x0 + x1) / 2, y, cz) // the roof: no hole
      return
    }
    const hole = stairHole(this.level)
    const hx = (hole.x0 + hole.x1) / 2
    const hw = hole.x1 - hole.x0
    this.solid(hole.x0 - x0, SLAB, lenZ, material, (x0 + hole.x0) / 2, y, cz) // west of the hole
    this.solid(x1 - hole.x1, SLAB, lenZ, material, (hole.x1 + x1) / 2, y, cz) // east of the hole
    this.solid(hw, SLAB, z1 - hole.z1, material, hx, y, (hole.z1 + z1) / 2) // north of the hole
    this.solid(hw, SLAB, hole.z0 - z0, material, hx, y, (z0 + hole.z0) / 2) // south of the hole
    this.hatch = this.solid(hw, SLAB, hole.z1 - hole.z0, material, hx, y, (hole.z0 + hole.z1) / 2)
  }

  /** Solid box: rendered, collides with the player, blocks reach. `y` is relative to this hall's floor. */
  private solid(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
    mesh.position.set(x, y, z)
    mesh.receiveShadow = true
    mesh.castShadow = true
    markBlocker(mesh)
    this.root.add(mesh)
    const body = this.physics.addStaticBox(new THREE.Vector3(x, y + this.floorY, z), new THREE.Vector3(w / 2, h / 2, d / 2))
    this.bodies.push(body)
    return { mesh, body }
  }
}
