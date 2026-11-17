import type RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import type { PhysicsWorld } from '../engine/PhysicsWorld'
import { markBlocker } from './interactables'
import { ROOM, STAIRS, type Zone } from './layout'
import { makeSign, mat } from './models'

const RISE_SECONDS = 1.2
const RAMP_THICKNESS = 0.3
/** The inner face of the hall's north wall (the old back wall's south face). */
const SOUTH_WALL_Z = ROOM.minZ - 0.2

/**
 * One flight of stairs along the east wall of the south hall. Flight 0 climbs from the ground to floor 1, flight 1 from
 * floor 1 to floor 2. They climb towards the north wall: you walk up from the south end and step off to the west at the top.
 *
 * What you SEE is a flight of solid steps, but what you WALK on is a smooth ramp along the same slope (one sloped box, from
 * the foot of the first step to the top of the last). Real step colliders made the player stutter and get stuck, and a ramp
 * glides. The ramp starts exactly at floor level and ends exactly at the level of the floor above, so there are no bumps
 * at either end. The steps touch the east wall (no gap), and the open west side has a guard wall.
 */
export class Stairs {
  readonly root = new THREE.Group()
  readonly flight: 0 | 1
  private readonly physics: PhysicsWorld
  private readonly baseY: number
  private bodies: RAPIER.RigidBody[] = []
  private rise = 1

  constructor(flight: 0 | 1, physics: PhysicsWorld) {
    this.flight = flight
    this.physics = physics
    const { baseY, startZ } = STAIRS.flights[flight]
    this.baseY = baseY
    const { x, width, steps, rise, tread, guardX, guardSteps } = STAIRS
    this.root.position.y = baseY
    this.root.userData.zone = (flight === 0 ? 'south' : 'floor1') satisfies Zone

    const concrete = mat(0xa8a29a, 0.9)
    const guard = mat(0x64748b, 0.5, 0.15)
    const run = steps * tread
    const total = steps * rise

    // The visible steps (no colliders): each is a block from the floor up to its tread.
    for (let i = 0; i < steps; i++) {
      const height = (i + 1) * rise
      this.visual(width, height, tread, concrete, x, height / 2, startZ + i * tread + tread / 2)
    }

    // The ramp you walk on: a sloped box whose TOP surface runs from (start, floor level) to (end, next floor level).
    const angle = Math.atan2(total, run)
    const slope = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -angle)
    const up = new THREE.Vector3(0, Math.cos(angle), -Math.sin(angle)) // the ramp's upward normal
    const centre = new THREE.Vector3(x, total / 2, startZ + run / 2).addScaledVector(up, -RAMP_THICKNESS / 2)
    this.collider(centre, new THREE.Vector3(width / 2, RAMP_THICKNESS / 2, Math.hypot(run, total) / 2), slope)

    // The open west side: a stepped guard wall you can see, and one tall collider that also acts as the rail round the
    // stairwell on the floor above. The top steps stay open so you can step off to the west.
    const guardRun = guardSteps * tread
    for (let i = 0; i < guardSteps; i++) {
      const height = (i + 1) * rise
      this.visual(0.08, height + 0.9, tread, guard, guardX, (height + 0.9) / 2, startZ + i * tread + tread / 2)
    }
    this.visual(0.08, 1.0, guardRun, guard, guardX, total + 0.5, startZ + guardRun / 2)

    // A sign on the north wall above the landing at the top of the flight, pointing back down.
    const down = makeSign(flight === 0 ? '↓ GROUND FLOOR' : '↓ FLOOR 1', 1.4, 0.24, '#0f172a', '#e2e8f0')
    down.position.set(x, total + 2.5, SOUTH_WALL_Z - 0.03)
    down.rotation.y = Math.PI // faces the hall (−z)
    this.root.add(down)
    this.collider(new THREE.Vector3(guardX, (total + 1.0) / 2, startZ + guardRun / 2), new THREE.Vector3(0.04, (total + 1.0) / 2, guardRun / 2))
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

  /** A box you can see (and that blocks reach), with no collider. Positions are relative to this flight's base height. */
  private visual(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number): void {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
    mesh.position.set(x, y, z)
    mesh.receiveShadow = true
    mesh.castShadow = true
    markBlocker(mesh)
    this.root.add(mesh)
  }

  /** An invisible collider. `local` is relative to this flight's base height. */
  private collider(local: THREE.Vector3, half: THREE.Vector3, rotation?: THREE.Quaternion): void {
    const world = new THREE.Vector3(local.x, local.y + this.baseY, local.z)
    this.bodies.push(
      rotation ? this.physics.addStaticBoxRotated(world, half, rotation) : this.physics.addStaticBox(world, half),
    )
  }
}
