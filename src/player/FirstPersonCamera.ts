import * as THREE from 'three'

export class FirstPersonCamera {
  readonly camera: THREE.PerspectiveCamera
  private yaw = Math.PI
  private pitch = 0
  private readonly minPitch = -1.45
  private readonly maxPitch = 1.45
  private readonly eye = new THREE.Vector3()
  private readonly forward = new THREE.Vector3()

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(65, aspect, 0.05, 250)
    this.camera.rotation.order = 'YXZ'
  }

  handleMouseDelta(dx: number, dy: number, sensitivity = 0.0022): void {
    this.yaw -= dx * sensitivity
    this.pitch -= dy * sensitivity
    this.pitch = THREE.MathUtils.clamp(this.pitch, this.minPitch, this.maxPitch)
  }

  update(eyePosition: THREE.Vector3): void {
    this.eye.copy(eyePosition)
    this.camera.position.copy(this.eye)
    this.camera.rotation.y = this.yaw
    this.camera.rotation.x = this.pitch
    this.camera.rotation.z = 0
  }

  /** Face the point (x, z) from (fromX, fromZ). The camera looks down its local −z axis. */
  lookToward(x: number, z: number, fromX = 0, fromZ = 0): void {
    this.yaw = Math.atan2(-(x - fromX), -(z - fromZ))
    this.pitch = 0
  }

  /** Turn by a relative amount in radians (debug/automation; mouse look uses handleMouseDelta). */
  turn(yaw: number, pitch: number): void {
    this.yaw += yaw
    this.pitch = THREE.MathUtils.clamp(this.pitch + pitch, this.minPitch, this.maxPitch)
  }

  getYaw(): number {
    return this.yaw
  }

  getForwardHorizontal(): THREE.Vector3 {
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw))
    return this.forward
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
  }
}