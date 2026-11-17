import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import type { PhysicsWorld } from '../engine/PhysicsWorld'
import type { InputSnapshotWithMouse } from '../engine/InputManager'
import { WALK_HEIGHT_GROUND } from '../world/constants'

const PLAYER_HEIGHT = 1.75
const PLAYER_RADIUS = 0.38
const CROUCH_EYE_DROP = 0.55

export class PlayerController {
  readonly mesh = new THREE.Group()
  private readonly physics: PhysicsWorld
  private body: RAPIER.RigidBody | null = null
  private collider: RAPIER.Collider | null = null
  private characterController: RAPIER.KinematicCharacterController | null = null
  private verticalVelocity = 0
  private crouching = false

  constructor(physics: PhysicsWorld, spawn: THREE.Vector3) {
    this.physics = physics
    const startY = WALK_HEIGHT_GROUND + PLAYER_HEIGHT / 2 + 0.05
    this.mesh.position.set(spawn.x, startY, spawn.z)
  }

  buildPhysics(): void {
    const world = this.physics.getWorld()
    const p = this.mesh.position
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(p.x, p.y, p.z)
    this.body = world.createRigidBody(bodyDesc)

    const colliderDesc = RAPIER.ColliderDesc.capsule(PLAYER_HEIGHT / 2 - PLAYER_RADIUS, PLAYER_RADIUS)
      .setFriction(0.85)
    this.collider = world.createCollider(colliderDesc, this.body)

    this.characterController = world.createCharacterController(0.02)
    this.characterController.enableSnapToGround(0.45)
    this.characterController.setMaxSlopeClimbAngle((38 * Math.PI) / 180)
    this.characterController.setMinSlopeSlideAngle((48 * Math.PI) / 180)
    this.characterController.enableAutostep(0.38, 0.2, true)
  }

  update(input: InputSnapshotWithMouse, cameraYaw: number, dt: number, elevatorDy: number): void {
    if (!this.body || !this.characterController || !this.collider) return

    this.crouching = input.crouch
    this.computeDesiredMove(input, cameraYaw, dt)

    this.characterController.computeColliderMovement(
      this.collider,
      {
        x: this.pendingMove.x,
        y: this.verticalVelocity * dt + elevatorDy,
        z: this.pendingMove.z,
      },
    )

    const movement = this.characterController.computedMovement()
    const pos = this.mesh.position
    const next = {
      x: pos.x + movement.x,
      y: pos.y + movement.y,
      z: pos.z + movement.z,
    }
    this.body.setNextKinematicTranslation(next)

    if (this.characterController.computedGrounded()) {
      this.verticalVelocity = 0
    } else {
      this.verticalVelocity -= 20 * dt
    }
  }

  private pendingMove = new THREE.Vector3()

  private computeDesiredMove(input: InputSnapshotWithMouse, cameraYaw: number, dt: number): void {
    let speed = input.sprint ? 6.2 : 4.2
    if (this.crouching) speed = 2.1
    const dir = new THREE.Vector3(input.right, 0, -input.forward)
    if (dir.lengthSq() > 0) {
      dir.normalize()
      dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), cameraYaw)
    }
    this.pendingMove.copy(dir.multiplyScalar(speed * dt))
  }

  syncFromPhysics(): void {
    if (!this.body) return
    const t = this.body.translation()
    this.mesh.position.set(t.x, t.y, t.z)
  }

  /** Debug helper: move the player instantly (keeps current height). */
  teleport(x: number, z: number): void {
    if (!this.body) return
    const t = this.body.translation()
    this.body.setTranslation({ x, y: t.y + 0.2, z }, true)
    this.syncFromPhysics()
  }

  getPosition(): THREE.Vector3 {
    return this.mesh.position.clone()
  }

  isCrouching(): boolean {
    return this.crouching
  }

  getEyePosition(target = new THREE.Vector3()): THREE.Vector3 {
    const drop = this.crouching ? CROUCH_EYE_DROP : 0
    return target.set(
      this.mesh.position.x,
      this.mesh.position.y + PLAYER_HEIGHT / 2 - 0.12 - drop,
      this.mesh.position.z,
    )
  }

  dispose(physics: PhysicsWorld): void {
    const world = physics.getWorld()
    if (this.characterController) {
      world.removeCharacterController(this.characterController)
      this.characterController = null
    }
    if (this.collider) {
      world.removeCollider(this.collider, true)
      this.collider = null
    }
    if (this.body) {
      world.removeRigidBody(this.body)
      this.body = null
    }
  }
}