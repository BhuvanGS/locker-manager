import RAPIER from '@dimforge/rapier3d-compat'
import type { Vector3 } from 'three'

export class PhysicsWorld {
  private world: RAPIER.World | null = null
  private initialized = false

  async init(): Promise<void> {
    if (this.initialized) return
    await RAPIER.init()
    this.world = new RAPIER.World({ x: 0, y: -18, z: 0 })
    this.initialized = true
  }

  getWorld(): RAPIER.World {
    if (!this.world) {
      throw new Error('PhysicsWorld not initialized')
    }
    return this.world
  }

  step(dt: number): void {
    if (!this.world) return
    this.world.timestep = Math.min(dt, 1 / 30)
    this.world.step()
  }

  addStaticBox(
    position: Vector3,
    halfExtents: Vector3,
    rotationY = 0,
  ): RAPIER.RigidBody {
    const world = this.getWorld()
    const bodyDesc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(position.x, position.y, position.z)
      .setRotation({ x: 0, y: rotationY, z: 0, w: Math.cos(rotationY / 2) })
    const body = world.createRigidBody(bodyDesc)
    const colliderDesc = RAPIER.ColliderDesc.cuboid(
      halfExtents.x,
      halfExtents.y,
      halfExtents.z,
    )
    world.createCollider(colliderDesc, body)
    return body
  }

  /** Remove a body made by addStaticBox (e.g. an upgrade that is discarded on a new game). */
  removeBody(body: RAPIER.RigidBody): void {
    this.world?.removeRigidBody(body)
  }

  dispose(): void {
    if (this.world) {
      this.world.free()
      this.world = null
    }
    this.initialized = false
  }
}