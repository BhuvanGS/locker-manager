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

  /**
   * Follow the eye, with motion on top: a head bob and sway while you walk (bigger, with a little shake and a wider view while you
   * sprint), and a dip when you land from a jump or a drop. `eye` itself stays exact (aiming and the debug handle use it).
   */
  update(eyePosition: THREE.Vector3, dt = 0, grounded = true, sprint = false): void {
    const dx = eyePosition.x - this.eye.x
    const dz = eyePosition.z - this.eye.z
    const dy = eyePosition.y - this.eye.y
    const step = Math.hypot(dx, dz)
    // A teleport or a climb is not walking.
    const speed = dt > 0 && step < 1 ? step / dt : 0
    if (dt > 0) {
      const target = grounded ? Math.min(1, speed / 3.4) : 0
      this.moving += (target - this.moving) * Math.min(1, dt * 8)
      this.bobPhase += dt * (speed > 0.2 && grounded ? 2.2 + speed * 1.55 : 0)
      // Landing: falling fast and now on the ground → a quick dip that springs back.
      if (grounded && !this.wasGrounded && this.fall < -2.5) this.dipVel -= Math.min(2.2, -this.fall * 0.22)
      this.fall = dt > 0 ? dy / dt : 0
      this.wasGrounded = grounded
      this.dipVel += (-this.dip * 90 - this.dipVel * 14) * dt
      this.dip += this.dipVel * dt
      const sprinting = sprint && speed > 4
      this.sprint += ((sprinting ? 1 : 0) - this.sprint) * Math.min(1, dt * 5)
      const fov = 65 + this.sprint * 6
      if (Math.abs(this.camera.fov - fov) > 0.01) {
        this.camera.fov = fov
        this.camera.updateProjectionMatrix()
      }
    }
    this.eye.copy(eyePosition)
    const amp = this.moving * (0.035 + this.sprint * 0.03)
    const bobY = Math.abs(Math.sin(this.bobPhase)) * amp * 1.4 - amp * 0.7
    const sway = Math.sin(this.bobPhase) * amp * 0.6
    const t = performance.now() / 1000
    const shake = this.sprint * this.moving * 0.004
    // Ground shake (the meteor): jitter in position and a little in angle.
    const q = this.quake * this.quake
    const qx = (Math.sin(t * 53) + Math.sin(t * 31 + 2)) * 0.12 * q
    const qy = (Math.sin(t * 47 + 1) + Math.sin(t * 29)) * 0.1 * q
    this.camera.position.set(
      this.eye.x + Math.cos(this.yaw) * sway + Math.sin(t * 37) * shake + qx,
      this.eye.y + bobY + this.dip + Math.sin(t * 41 + 1) * shake + qy,
      this.eye.z - Math.sin(this.yaw) * sway,
    )
    this.camera.rotation.y = this.yaw + Math.sin(t * 43) * 0.012 * q
    this.camera.rotation.x = this.pitch + this.dip * 0.25 + Math.sin(t * 39 + 3) * 0.015 * q
    this.camera.rotation.z = Math.sin(this.bobPhase) * this.moving * (0.006 + this.sprint * 0.008) + Math.sin(t * 35) * 0.02 * q
  }

  /** How hard the ground is shaking (0…1), set every frame by the Engine. */
  quake = 0
  private moving = 0
  private bobPhase = 0
  private sprint = 0
  private dip = 0
  private dipVel = 0
  private fall = 0
  private wasGrounded = true

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

  /** Set the view outright (filming: a scripted walk steers the head). */
  setAngles(yaw: number, pitch: number): void {
    this.yaw = yaw
    this.pitch = THREE.MathUtils.clamp(pitch, this.minPitch, this.maxPitch)
  }

  getPitch(): number {
    return this.pitch
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