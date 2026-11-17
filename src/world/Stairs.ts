import type RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import type { PhysicsWorld } from '../engine/PhysicsWorld'
import { markBlocker } from './interactables'
import { STAIRS, type Zone } from './layout'
import { mat } from './models'

const RISE_SECONDS = 1.2

/**
 * One flight of stairs along the east wall of the south hall. Flight 0 climbs from the ground to floor 1, flight 1 from
 * floor 1 to floor 2. They climb towards the north wall: you walk up from the south end and step off to the west at the
 * top. Steps are solid boxes (the player's character controller auto-steps 0.38 m, steps are 0.25 m), with a stepped
 * guard wall on the open west side and a rail round the stairwell on the floor above.
 */
export class Stairs {
  readonly root = new THREE.Group()
  readonly flight: 0 | 1
  private readonly physics: PhysicsWorld
  private bodies: RAPIER.RigidBody[] = []
  private rise = 1

  constructor(flight: 0 | 1, physics: PhysicsWorld) {
    this.flight = flight
    this.physics = physics
    const { baseY, startZ } = STAIRS.flights[flight]
    const { x, width, steps, rise, tread, guardX, guardSteps } = STAIRS
    this.root.position.y = baseY
    this.root.userData.zone = (flight === 0 ? 'south' : 'floor1') satisfies Zone

    const concrete = mat(0xa8a29a, 0.9)
    const guard = mat(0x64748b, 0.5, 0.4)
    for (let i = 0; i < steps; i++) {
      const height = (i + 1) * rise
      const z = startZ + i * tread + tread / 2
      // A step is a block from the floor up to its tread.
      this.solid(width, height, tread, concrete, x, height / 2, z)
      // The open west side is closed by a stepped guard wall (not at the top steps, where you step off).
      if (i < guardSteps) this.solid(0.08, height + 0.9, tread, guard, guardX, (height + 0.9) / 2, z)
    }
    // A rail along the stairwell on the floor above, so nobody walks into the hole from that side.
    const top = steps * rise
    const railLength = guardSteps * tread
    this.solid(0.08, 1.0, railLength, guard, guardX, top + 0.5, startZ + railLength / 2)
  }

  /** Start the "rising out of the ground" animation (freshly built stairs). */
  appear(): void {
    this.rise = 0
    this.root.scale.y = 0.001
  }

  update(dt: number): void {
    if (this.rise >= 1) return
    this.rise = Math.min(1, this.rise + dt / RISE_SECONDS)
    this.root.scale.y = Math.max(0.001, 1 - (1 - this.rise) ** 3)
  }

  dispose(): void {
    for (const body of this.bodies) this.physics.removeBody(body)
    this.bodies = []
  }

  private solid(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number): void {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
    mesh.position.set(x, y, z)
    mesh.receiveShadow = true
    mesh.castShadow = true
    markBlocker(mesh)
    this.root.add(mesh)
    const baseY = STAIRS.flights[this.flight].baseY
    this.bodies.push(this.physics.addStaticBox(new THREE.Vector3(x, y + baseY, z), new THREE.Vector3(w / 2, h / 2, d / 2)))
  }
}
