import * as THREE from 'three'

/**
 * The sky and the time of day: a gradient dome (deep blue overhead fading to a pale horizon by day, oranges and pinks at sunrise
 * and sunset, navy at night), the sun and the moon crossing it, stars at night, and drifting clouds lit to match. `update` turns
 * game time into a time of day (a whole day is `DAY_SECONDS`) and returns how the world should be lit; the Engine passes that to
 * the sun, the ambient light, the fog and the street lamps. View only: nothing in the sim depends on it.
 *
 * Everything is drawn round the camera (the dome, the sun and the stars follow it), inside the camera's far plane.
 */
export const DAY_SECONDS = 720
/** The time of day when a game starts (0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset): mid-morning. */
const START = 0.33
const R = 230

export type Daylight = {
  /** Where the light comes from (towards the sun by day, the moon by night), and its strength and colour. */
  lightDir: THREE.Vector3
  lightIntensity: number
  lightColour: THREE.Color
  hemiSky: THREE.Color
  hemiGround: THREE.Color
  hemiIntensity: number
  fog: THREE.Color
  /** 0 by day, 1 at night (street lamps glow brighter). */
  night: number
  /** The time of day, 0…1. */
  time: number
}

const C = (hex: number) => new THREE.Color(hex)
const SKY = {
  dayTop: C(0x3f7fd0),
  dayHorizon: C(0xb9d8ef),
  duskTop: C(0x3a4a8a),
  duskHorizon: C(0xf2a366),
  nightTop: C(0x060a1c),
  nightHorizon: C(0x18213d),
}

export class Sky {
  readonly root = new THREE.Group()
  /** Shift the time of day (debugging: `__game.engine.sky.offset = 0.5` jumps half a day). */
  offset = 0
  private readonly dome: THREE.Mesh
  private readonly uniforms: { top: { value: THREE.Color }; horizon: { value: THREE.Color }; sunDir: { value: THREE.Vector3 }; glow: { value: THREE.Color } }
  private readonly sun: THREE.Sprite
  private readonly moon: THREE.Sprite
  private readonly stars: THREE.Points
  private readonly clouds: { sprite: THREE.Sprite; x: number; z: number; y: number; speed: number }[] = []
  private readonly out: Daylight = {
    lightDir: new THREE.Vector3(),
    lightIntensity: 1,
    lightColour: new THREE.Color(),
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    hemiIntensity: 1,
    fog: new THREE.Color(),
    night: 0,
    time: START,
  }

  constructor() {
    this.uniforms = { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, glow: { value: new THREE.Color() } }
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(R, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `
          uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 glow; varying vec3 vDir;
          void main() {
            float h = clamp(vDir.y, -0.2, 1.0);
            vec3 c = mix(horizon, top, pow(max(h, 0.0), 0.55));
            // A warm glow round the sun, strongest near the horizon.
            float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
            c += glow * (pow(s, 8.0) * 0.6 + pow(s, 64.0) * 0.8);
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    )
    this.dome.renderOrder = -10
    this.dome.frustumCulled = false
    this.root.add(this.dome)

    this.sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: discTexture('#fff6d8', 'rgba(255,210,140,0)'), transparent: true, depthWrite: false, fog: false }))
    this.sun.scale.setScalar(34)
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: discTexture('#eef2ff', 'rgba(190,205,255,0)'), transparent: true, depthWrite: false, fog: false }))
    this.moon.scale.setScalar(16)
    for (const s of [this.sun, this.moon]) {
      s.renderOrder = -9
      this.root.add(s)
    }

    // Stars: points on the upper sky, seen only at night.
    const pos: number[] = []
    for (let i = 0; i < 700; i++) {
      const a = Math.random() * Math.PI * 2
      const y = 0.08 + Math.random() * 0.92
      const r = Math.sqrt(1 - y * y)
      pos.push(Math.cos(a) * r * (R - 5), y * (R - 5), Math.sin(a) * r * (R - 5))
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    this.stars = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, depthWrite: false, fog: false }))
    this.stars.renderOrder = -9
    this.stars.frustumCulled = false
    this.root.add(this.stars)

    // Clouds: soft puffy sprites drifting with the wind, high over a wide area round you.
    const tex = cloudTexture()
    for (let i = 0; i < 28; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, opacity: 0.9 }))
      const w = 45 + ((i * 37) % 40)
      sprite.scale.set(w, w * 0.42, 1)
      sprite.renderOrder = -8
      this.root.add(sprite)
      this.clouds.push({ sprite, x: ((i * 137) % 400) - 200, z: ((i * 91) % 400) - 200, y: 75 + ((i * 53) % 40), speed: 1.2 + (i % 5) * 0.4 })
    }
  }

  /** The time of day (0…1) at game time `now`. */
  timeOfDay(now: number): number {
    return (((now / DAY_SECONDS + START + this.offset) % 1) + 1) % 1
  }

  update(now: number, camera: THREE.Vector3): Daylight {
    const o = this.out
    const time = this.timeOfDay(now)
    o.time = time
    // The sun rises in the east (+x), is high in the south at noon, and sets in the west; the moon is opposite.
    const a = (time - 0.25) * Math.PI * 2
    const sun = new THREE.Vector3(Math.cos(a), Math.sin(a), -0.35).normalize()
    const day = THREE.MathUtils.smoothstep(sun.y, -0.1, 0.22)
    const dusk = Math.max(0, 1 - Math.abs(sun.y) / 0.3) * THREE.MathUtils.smoothstep(sun.y, -0.25, 0.0)
    const night = 1 - day
    o.night = night

    // Sky colours: night → day, with the sunset tint near the horizon.
    const top = SKY.nightTop.clone().lerp(SKY.dayTop, day).lerp(SKY.duskTop, dusk * 0.5)
    const horizon = SKY.nightHorizon.clone().lerp(SKY.dayHorizon, day).lerp(SKY.duskHorizon, dusk * 0.8)
    this.uniforms.top.value.copy(top)
    this.uniforms.horizon.value.copy(horizon)
    this.uniforms.sunDir.value.copy(sun)
    this.uniforms.glow.value.copy(C(0xffb070)).multiplyScalar(0.25 + dusk * 0.9).multiplyScalar(day > 0.02 || dusk > 0 ? 1 : 0)
    o.fog.copy(horizon)

    this.dome.position.copy(camera)
    this.stars.position.copy(camera)
    this.stars.rotation.y = time * Math.PI * 2 * 0.2
    ;(this.stars.material as THREE.PointsMaterial).opacity = Math.max(0, night - 0.3) / 0.7
    this.sun.position.copy(camera).addScaledVector(sun, R - 20)
    this.sun.visible = sun.y > -0.15
    ;(this.sun.material as THREE.SpriteMaterial).color.copy(C(0xffffff).lerp(C(0xffa060), dusk))
    const moon = sun.clone().negate()
    this.moon.position.copy(camera).addScaledVector(moon, R - 20)
    this.moon.visible = moon.y > -0.1

    // The light: the sun by day (warm and low at dawn and dusk), the moon by night (dim and blue).
    if (sun.y > -0.05) {
      o.lightDir.copy(sun)
      o.lightIntensity = 1.75 * THREE.MathUtils.smoothstep(sun.y, -0.05, 0.25)
      o.lightColour.copy(C(0xfff1d6)).lerp(C(0xffa46a), dusk)
    } else {
      o.lightDir.copy(moon)
      o.lightIntensity = 0.4 * THREE.MathUtils.smoothstep(moon.y, 0.0, 0.3)
      o.lightColour.copy(C(0x9fb4ff))
    }
    o.hemiSky.copy(C(0x5a6a99)).lerp(C(0xf5f0e6), day)
    o.hemiGround.copy(C(0x25222a)).lerp(C(0x6b6257), day)
    // Never pitch black indoors: the halls and the warehouse are lit by their glowing fittings and this.
    o.hemiIntensity = 0.62 + 0.48 * day

    // Clouds drift east; they wrap round a 400 m square centred on you. White by day, pink at dusk, dark at night.
    const tint = C(0x2a3048).lerp(C(0xffffff), day).lerp(C(0xffc4a8), dusk * 0.7)
    for (const c of this.clouds) {
      const x = ((((c.x + now * c.speed - camera.x) % 400) + 600) % 400) - 200
      const z = ((((c.z - camera.z) % 400) + 600) % 400) - 200
      c.sprite.position.set(camera.x + x, c.y, camera.z + z)
      const m = c.sprite.material as THREE.SpriteMaterial
      m.color.copy(tint)
      m.opacity = 0.55 + 0.35 * day
    }
    return o
  }
}

/** A glowing disc (the sun or the moon) with a soft halo. */
function discTexture(core: string, edge: string): THREE.Texture | null {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')
  if (g) {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
    grad.addColorStop(0, core)
    grad.addColorStop(0.22, core)
    grad.addColorStop(0.3, 'rgba(255,240,210,0.45)')
    grad.addColorStop(1, edge)
    g.fillStyle = grad
    g.fillRect(0, 0, 128, 128)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** A puffy cloud: overlapping soft blobs, flatter underneath. */
function cloudTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 128
  const g = c.getContext('2d')
  if (g) {
    const blobs: [number, number, number][] = [[70, 80, 40], [115, 64, 52], [165, 74, 44], [200, 86, 30], [45, 92, 26], [135, 92, 40]]
    for (const [x, y, r] of blobs) {
      const grad = g.createRadialGradient(x, y, 0, x, y, r)
      grad.addColorStop(0, 'rgba(255,255,255,0.95)')
      grad.addColorStop(0.6, 'rgba(255,255,255,0.6)')
      grad.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = grad
      g.fillRect(0, 0, 256, 128)
    }
    // Flatten the base a little.
    g.globalCompositeOperation = 'destination-out'
    const base = g.createLinearGradient(0, 100, 0, 128)
    base.addColorStop(0, 'rgba(0,0,0,0)')
    base.addColorStop(1, 'rgba(0,0,0,1)')
    g.fillStyle = base
    g.fillRect(0, 100, 256, 28)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
