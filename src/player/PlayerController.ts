import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import type { PhysicsWorld } from '../engine/PhysicsWorld'
import type { InputSnapshot } from '../engine/InputManager'
import { FLOOR_Y, SLOPE_LIMITS } from '../world/layout'

const PLAYER_HEIGHT = 1.75
const PLAYER_RADIUS = 0.38
const CROUCH_EYE_DROP = 0.55
/** Upward speed of a jump (m/s): with gravity 20 m/s² the jump is about 0.85 m high. */
const JUMP_SPEED = 5.8
const GRAVITY = 20

export class PlayerController {
  readonly mesh = new THREE.Group()
  private readonly physics: PhysicsWorld
  private body: RAPIER.RigidBody | null = null
  private collider: RAPIER.Collider | null = null
  private characterController: RAPIER.KinematicCharacterController | null = null
  private verticalVelocity = 0
  private grounded = false
  private crouching = false

  constructor(physics: PhysicsWorld, spawn: THREE.Vector3) {
    this.physics = physics
    const startY = FLOOR_Y + PLAYER_HEIGHT / 2 + 0.05
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
    this.characterController.setMaxSlopeClimbAngle((SLOPE_LIMITS.maxClimbDeg * Math.PI) / 180)
    this.characterController.setMinSlopeSlideAngle((SLOPE_LIMITS.minSlideDeg * Math.PI) / 180)
    this.characterController.enableAutostep(0.38, 0.2, true)
  }

  update(input: InputSnapshot, cameraYaw: number, dt: number): void {
    if (!this.body || !this.characterController || !this.collider) return

    this.crouching = input.crouch
    if (input.jumpPressed && this.grounded) {
      this.verticalVelocity = JUMP_SPEED
      this.grounded = false
    }
    this.computeDesiredMove(input, cameraYaw, dt)

    this.characterController.computeColliderMovement(
      this.collider,
      {
        x: this.pendingMove.x,
        y: this.verticalVelocity * dt,
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

    this.grounded = this.characterController.computedGrounded()
    if (this.verticalVelocity > 0 && movement.y < this.verticalVelocity * dt - 1e-3) {
      this.verticalVelocity = 0 // bumped your head on something
    } else if (this.grounded && this.verticalVelocity <= 0) {
      this.verticalVelocity = 0
    } else {
      this.verticalVelocity -= GRAVITY * dt
    }
  }

  private pendingMove = new THREE.Vector3()

  private computeDesiredMove(input: InputSnapshot, cameraYaw: number, dt: number): void {
    let speed = input.sprint ? 5.2 : 3.4
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
  /** Move the player instantly. `feetY` puts their feet at that height (e.g. 3.5 for floor 1); omitted, they drop in from just above. */
  teleport(x: number, z: number, feetY?: number): void {
    if (!this.body) return
    const t = this.body.translation()
    this.verticalVelocity = 0
    this.body.setTranslation({ x, y: feetY !== undefined ? feetY + PLAYER_HEIGHT / 2 + 0.05 : t.y + 0.2, z }, true)
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