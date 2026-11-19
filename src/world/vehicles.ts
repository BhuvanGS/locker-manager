import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { BOX, makeContainer } from './terminal'

/**
 * The game's own vehicles, built to the Locker Manager blueprints: a kei truck (3.4 × 1.5 × 1.8 m, cab-over with an open bed), a
 * delivery truck (6.8 × 2.3 × 3.2 m, white cab, coloured box with a swoosh and the box logo, rear roll door) and a hatchback
 * (4.25 × 1.7 × 1.42 m). Soft-edged low-poly blocks with matte paint, plastic trim, glass, glowing lights, rubber tyres and metal rims,
 * yellow number plates. Noses face −z (our vehicle convention); the origin is on the ground under the middle.
 */
export type VehicleModel = {
  group: THREE.Group
  /** Wheel groups: spin them about x by distance / `wheelRadius`. */
  wheels: THREE.Object3D[]
  wheelRadius: number
  /** The rear wheels (for tyre smoke and skid marks), in the model's frame. */
  rearWheels: THREE.Vector3[]
  /** Tail lights: brighten while braking (`setBraking`). */
  tail: THREE.MeshStandardMaterial
  length: number
  width: number
}

export const KEI_COLOURS = [0xf4f1ea, 0x9cc9e6, 0xa8dcc0, 0xe8d3b0, 0xd9443a, 0x2b3a67] as const
export const BOX_COLOURS = [0x34507a, 0xe0a52c, 0x4f9a4a, 0xc8413a] as const
export const CAR_COLOURS = [0xf1ede4, 0x24262b, 0xb9bec4, 0xc93a31, 0x2f62b5, 0xe8c43a] as const

// ------------------------------------------------------------------ shared pieces

const mats = new Map<string, THREE.MeshStandardMaterial>()
function m(color: number, roughness = 0.75, metalness = 0): THREE.MeshStandardMaterial {
  const key = `${color}-${roughness}-${metalness}`
  let x = mats.get(key)
  if (!x) {
    x = new THREE.MeshStandardMaterial({ color, roughness, metalness })
    mats.set(key, x)
  }
  return x
}
const TRIM = (): THREE.MeshStandardMaterial => m(0x23262b, 0.8)
const GLASS = (): THREE.MeshStandardMaterial => m(0x1d2633, 0.12, 0.55)
const RUBBER = (): THREE.MeshStandardMaterial => m(0x1b1c1f, 0.95)
const RIM = (): THREE.MeshStandardMaterial => m(0xc9ced4, 0.35, 0.7)
let headMat: THREE.MeshStandardMaterial | null = null
const HEAD = (): THREE.MeshStandardMaterial => (headMat ??= new THREE.MeshStandardMaterial({ color: 0xfff1c9, emissive: 0xffd88a, emissiveIntensity: 1.4 }))
let amberMat: THREE.MeshStandardMaterial | null = null
const AMBER = (): THREE.MeshStandardMaterial => (amberMat ??= new THREE.MeshStandardMaterial({ color: 0xffb547, emissive: 0xff9a1f, emissiveIntensity: 1.1 }))
function tailMat(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0xd62b2b, emissive: 0xa31616, emissiveIntensity: 0.7 })
}

const geos = new Map<string, THREE.BufferGeometry>()
function rbox(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  const key = `${w.toFixed(3)}-${h.toFixed(3)}-${d.toFixed(3)}-${r}`
  let g = geos.get(key)
  if (!g) {
    g = new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.1, h / 2.1, d / 2.1))
    geos.set(key, g)
  }
  return g
}

function part(parent: THREE.Object3D, w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number, r = 0.04): THREE.Mesh {
  const o = new THREE.Mesh(rbox(w, h, d, r), material)
  o.position.set(x, y, z)
  o.castShadow = true
  o.receiveShadow = true
  parent.add(o)
  return o
}

/** A flat decal (canvas texture) facing +z, nudged off the surface it sits on. */
function decal(parent: THREE.Object3D, w: number, h: number, tex: THREE.Texture | null, x: number, y: number, z: number, rotY = 0): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3 })
  const o = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat)
  o.position.set(x, y, z)
  o.rotation.y = rotY
  parent.add(o)
  return o
}

function wheel(parent: THREE.Object3D, x: number, z: number, r: number, width: number, wheels: THREE.Object3D[], dual = false): void {
  const g = new THREE.Group()
  g.position.set(x, r, z)
  const tyre = new THREE.Mesh(new THREE.CylinderGeometry(r, r, width, 22), RUBBER())
  tyre.rotation.z = Math.PI / 2
  tyre.castShadow = true
  g.add(tyre)
  const side = Math.sign(x) || 1
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.58, r * 0.58, width + 0.01, 16), RIM())
  rim.rotation.z = Math.PI / 2
  g.add(rim)
  // Hub and wheel nuts on the outer face.
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.2, r * 0.2, 0.04, 10), m(0x8b9199, 0.4, 0.7))
  hub.rotation.z = Math.PI / 2
  hub.position.x = side * (width / 2 + 0.01)
  g.add(hub)
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.03, 6), m(0x6b7178, 0.4, 0.8))
    nut.rotation.z = Math.PI / 2
    nut.position.set(side * (width / 2 + 0.015), Math.sin(a) * r * 0.36, Math.cos(a) * r * 0.36)
    g.add(nut)
  }
  if (dual) {
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(r, r, width, 22), RUBBER())
    inner.rotation.z = Math.PI / 2
    inner.position.x = -side * (width + 0.02)
    g.add(inner)
  }
  parent.add(g)
  wheels.push(g)
}

// ------------------------------------------------------------------ canvas art

const texCache = new Map<string, THREE.Texture | null>()
function canvasTex(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.Texture | null {
  if (texCache.has(key)) return texCache.get(key) ?? null
  if (typeof document === 'undefined') {
    texCache.set(key, null)
    return null
  }
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')
  if (g) draw(g)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  texCache.set(key, t)
  return t
}

/** A yellow number plate. */
function plateTex(text: string): THREE.Texture | null {
  return canvasTex(`plate-${text}`, 256, 96, (g) => {
    g.fillStyle = '#f2c230'
    g.beginPath()
    g.roundRect(4, 4, 248, 88, 12)
    g.fill()
    g.strokeStyle = '#1c1b18'
    g.lineWidth = 5
    g.stroke()
    g.fillStyle = '#1c1b18'
    g.font = '800 56px system-ui, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(text, 128, 52)
  })
}

/** The isometric box logo (white outline cube with a tape line), on transparent. */
function boxLogoTex(): THREE.Texture | null {
  return canvasTex('box-logo', 256, 256, (g) => {
    const cx = 128
    const top = 40
    const s = 80
    g.fillStyle = 'rgba(255,255,255,0.95)'
    g.strokeStyle = 'rgba(255,255,255,0.95)'
    g.lineJoin = 'round'
    g.lineWidth = 12
    const p = (x: number, y: number) => [cx + x, top + y] as const
    const face = (pts: (readonly [number, number])[], alpha: number) => {
      g.globalAlpha = alpha
      g.beginPath()
      g.moveTo(...pts[0]!)
      for (const q of pts.slice(1)) g.lineTo(...q)
      g.closePath()
      g.fill()
      g.globalAlpha = 1
      g.stroke()
    }
    face([p(0, 0), p(s, s * 0.5), p(0, s), p(-s, s * 0.5)], 0.35)
    face([p(-s, s * 0.5), p(0, s), p(0, s * 2.1), p(-s, s * 1.6)], 0.6)
    face([p(s, s * 0.5), p(0, s), p(0, s * 2.1), p(s, s * 1.6)], 0.85)
    g.strokeStyle = 'rgba(30,40,60,0.6)'
    g.lineWidth = 8
    g.beginPath()
    g.moveTo(...p(-s * 0.5, s * 0.25))
    g.lineTo(...p(s * 0.5, s * 0.75))
    g.stroke()
  })
}

/** The box's side art: an orange swoosh along the bottom, the box logo towards the rear. */
function boxSideTex(mirror: boolean): THREE.Texture | null {
  return canvasTex(`box-side-${mirror}`, 1024, 512, (g) => {
    // Drawn with the cab on the left; mirrored for the other side of the truck so the logo is always towards the rear.
    if (mirror) {
      g.translate(1024, 0)
      g.scale(-1, 1)
    }
    g.translate(1024, 0)
    g.scale(-1, 1)
    g.fillStyle = '#f28c28'
    g.beginPath()
    g.moveTo(0, 470)
    g.bezierCurveTo(300, 470, 620, 380, 1024, 250)
    g.lineTo(1024, 300)
    g.bezierCurveTo(640, 430, 320, 500, 0, 505)
    g.closePath()
    g.fill()
    g.fillStyle = 'rgba(255,255,255,0.9)'
    g.beginPath()
    g.moveTo(0, 505)
    g.bezierCurveTo(330, 505, 650, 440, 1024, 318)
    g.lineTo(1024, 330)
    g.bezierCurveTo(660, 452, 330, 512, 0, 512)
    g.closePath()
    g.fill()
    const logo = boxLogoTex()
    const img = logo?.image as CanvasImageSource | undefined
    if (img) {
      // The logo itself is never mirrored.
      g.save()
      g.translate(810, 0)
      g.scale(-1, 1)
      g.translate(-810, 0)
      g.drawImage(img, 680, 40, 260, 260)
      g.restore()
    }
  })
}

/** A roll door: light grey slats. */
function rollDoorTex(): THREE.Texture | null {
  return canvasTex('roll-door', 256, 256, (g) => {
    g.fillStyle = '#c9ccd0'
    g.fillRect(0, 0, 256, 256)
    for (let y = 0; y < 256; y += 16) {
      g.fillStyle = '#9fa4aa'
      g.fillRect(0, y + 12, 256, 3)
      g.fillStyle = '#e1e3e6'
      g.fillRect(0, y, 256, 2)
    }
    g.fillStyle = '#6b7178'
    g.fillRect(108, 228, 40, 10)
  })
}

/** A grille: dark slats with a badge. */
function grilleTex(badge: string): THREE.Texture | null {
  return canvasTex(`grille-${badge}`, 256, 96, (g) => {
    g.fillStyle = '#1f2226'
    g.beginPath()
    g.roundRect(0, 0, 256, 96, 14)
    g.fill()
    g.fillStyle = '#34383e'
    for (let y = 14; y < 90; y += 18) g.fillRect(14, y, 228, 8)
    if (badge) {
      g.fillStyle = '#dfe3e8'
      g.font = '800 40px system-ui, sans-serif'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(badge, 128, 50)
    }
  })
}

/** Turn the tail lights up while braking. */
export function setBraking(v: VehicleModel, on: boolean): void {
  v.tail.emissiveIntensity = on ? 2.4 : 0.7
}

// ------------------------------------------------------------------ the kei truck

/**
 * The kei truck: a cab-over with a big windscreen, "KEI" grille, square lamps and mirrors on stalks; an open bed with drop sides and
 * a tailgate, a cab guard, and a blue tarp folded at the front (`cargo`: boxes under a strapped tarp, for trucks on the road).
 * The bed's floor top is at y 0.75, from z −0.4 to 1.92 (the warehouse puts its crates there).
 */
export function makeKeiTruck(colour: number, opts: { cargo?: boolean; plate?: string } = {}): VehicleModel {
  const group = new THREE.Group()
  const wheels: THREE.Object3D[] = []
  const paint = m(colour, 0.6)
  const trim = TRIM()
  const glass = GLASS()
  const tail = tailMat()
  const W = 1.48
  // Chassis and cab.
  part(group, 1.3, 0.2, 3.4, trim, 0, 0.5, 0.15, 0.03)
  part(group, W, 1.16, 1.28, paint, 0, 1.15, -1.02, 0.12)
  part(group, W - 0.1, 0.52, 0.05, glass, 0, 1.42, -1.665, 0.03) // windscreen
  for (const s of [-1, 1]) {
    part(group, 0.04, 0.42, 0.78, glass, s * (W / 2 + 0.005), 1.43, -0.98, 0.02) // side windows
    part(group, 0.02, 0.62, 0.02, trim, s * (W / 2 + 0.008), 0.95, -0.55, 0.005) // door seam
    part(group, 0.03, 0.04, 0.14, trim, s * (W / 2 + 0.012), 1.1, -0.72, 0.01) // handle
    // Mirror on a stalk.
    part(group, 0.04, 0.04, 0.16, trim, s * (W / 2 + 0.08), 1.32, -1.5, 0.01)
    part(group, 0.05, 0.2, 0.12, trim, s * (W / 2 + 0.16), 1.3, -1.56, 0.02)
    // Square headlights, front indicators, wheel arches.
    part(group, 0.26, 0.2, 0.04, HEAD(), s * 0.52, 0.93, -1.67, 0.03)
    part(group, 0.12, 0.06, 0.03, AMBER(), s * 0.52, 0.78, -1.67, 0.01)
    for (const z of [-1.2, 1.3]) part(group, 0.1, 0.3, 0.72, trim, s * (W / 2 - 0.02), 0.62, z, 0.04)
  }
  decal(group, 0.66, 0.24, grilleTex('KEI'), 0, 0.93, -1.668, Math.PI)
  part(group, W + 0.04, 0.18, 0.2, trim, 0, 0.6, -1.64, 0.05) // bumper
  decal(group, 0.36, 0.13, plateTex(opts.plate ?? 'LM-0421'), 0, 0.6, -1.745, Math.PI)
  // Bed: floor, drop sides with hinges, tailgate, the guard behind the cab, tail lights and a plate.
  part(group, W - 0.02, 0.06, 2.34, m(0x8f969e, 0.5, 0.4), 0, 0.72, 0.77, 0.01)
  for (const s of [-1, 1]) {
    part(group, 0.05, 0.32, 2.34, paint, s * (W / 2 - 0.02), 0.9, 0.77, 0.02)
    for (const z of [0.2, 1.4]) part(group, 0.03, 0.05, 0.06, trim, s * (W / 2 + 0.005), 0.85, z, 0.01)
  }
  part(group, W - 0.02, 0.32, 0.05, paint, 0, 0.9, 1.92, 0.02)
  for (const s of [-1, 1]) {
    part(group, 0.05, 0.75, 0.05, trim, s * 0.62, 1.4, -0.36, 0.01)
    part(group, 0.18, 0.12, 0.03, tail, s * 0.58, 0.88, 1.955, 0.02)
  }
  for (const y of [1.25, 1.55, 1.76]) part(group, 1.28, 0.04, 0.04, trim, 0, y, -0.36, 0.01)
  decal(group, 0.32, 0.12, plateTex(opts.plate ?? 'LM-0421'), 0, 0.75, 1.948)
  // The tarp: folded against the cab guard, or (`cargo`) over a load of boxes with straps.
  const tarp = m(0x2f55b8, 0.85)
  if (opts.cargo) {
    const card = m(0xc99a5b, 0.9)
    for (const [x, z] of [[-0.33, 0.15], [0.33, 0.15], [-0.33, 0.9], [0.33, 0.9]] as const) part(group, 0.6, 0.48, 0.68, card, x, 0.99, z, 0.02)
    part(group, 0.62, 0.42, 0.66, card, 0.32, 1.44, 0.5, 0.02)
    part(group, 1.36, 0.14, 1.5, tarp, 0, 1.28, 0.52, 0.06)
    part(group, 0.7, 0.5, 0.75, tarp, 0.2, 1.5, 0.45, 0.08)
    for (const z of [0.1, 0.95]) part(group, 1.4, 0.03, 0.05, m(0x111111), 0, 1.36, z, 0.01)
  } else {
    part(group, 1.3, 0.16, 0.3, tarp, 0, 0.83, -0.2, 0.06)
  }
  for (const s of [-1, 1]) for (const z of [-1.2, 1.3]) wheel(group, s * 0.66, z, 0.3, 0.2, wheels)
  return { group, wheels, wheelRadius: 0.3, rearWheels: [new THREE.Vector3(-0.66, 0, 1.3), new THREE.Vector3(0.66, 0, 1.3)], tail, length: 3.6, width: W }
}

// ------------------------------------------------------------------ the delivery truck

/**
 * The delivery truck: a white cab (windscreen, side windows, amber roof lights, grille, square lamps, big mirrors, step) and a box
 * in `colour` with the orange swoosh and box logo on both sides, marker lights along the top, and a rear roll door with tail lights.
 * The cab spans z −3.1…−1.35, the box −1.15…3.15 (the warehouse's docking numbers).
 */
export function makeDeliveryTruck(colour: number, opts: { plate?: string } = {}): VehicleModel {
  const group = new THREE.Group()
  const wheels: THREE.Object3D[] = []
  const white = m(0xf1efe9, 0.6)
  const trim = TRIM()
  const glass = GLASS()
  const tail = tailMat()
  const W = 2.3
  part(group, 1.9, 0.26, 6.3, trim, 0, 0.62, 0.05, 0.04) // chassis
  // Cab.
  part(group, 2.1, 1.62, 1.75, white, 0, 1.55, -2.22, 0.12)
  part(group, 1.92, 0.66, 0.05, glass, 0, 1.92, -3.1, 0.03)
  for (const s of [-1, 1]) {
    part(group, 0.04, 0.56, 1.0, glass, s * 1.055, 1.92, -2.25, 0.02)
    part(group, 0.02, 1.0, 0.02, trim, s * 1.058, 1.4, -1.7, 0.005)
    part(group, 0.03, 0.05, 0.16, trim, s * 1.065, 1.55, -1.85, 0.01)
    part(group, 0.05, 0.05, 0.26, trim, s * 1.15, 1.75, -2.95, 0.01)
    part(group, 0.07, 0.42, 0.16, trim, s * 1.3, 1.7, -3.02, 0.02) // mirror
    part(group, 0.34, 0.26, 0.05, HEAD(), s * 0.72, 1.05, -3.11, 0.03)
    part(group, 0.14, 0.08, 0.04, AMBER(), s * 0.72, 0.86, -3.11, 0.01)
    part(group, 0.4, 0.08, 0.3, trim, s * 0.78, 0.55, -1.85, 0.02) // step
  }
  for (let k = 0; k < 4; k++) part(group, 0.12, 0.06, 0.08, AMBER(), -0.45 + k * 0.3, 2.39, -3.0, 0.02) // roof lights
  decal(group, 1.0, 0.34, grilleTex(''), 0, 1.06, -3.115, Math.PI)
  part(group, 2.2, 0.24, 0.24, trim, 0, 0.66, -3.12, 0.05)
  decal(group, 0.42, 0.15, plateTex(opts.plate ?? 'DL-4317'), 0, 0.66, -3.245, Math.PI)
  // Box.
  const boxM = m(colour, 0.7)
  part(group, W, 2.28, 4.3, boxM, 0, 2.08, 1.0, 0.08)
  for (const s of [-1, 1]) decal(group, 4.1, 2.05, boxSideTex(s > 0), s * (W / 2 + 0.005), 2.05, 1.0, s * (Math.PI / 2))
  for (let k = 0; k < 4; k++) part(group, 0.1, 0.06, 0.06, AMBER(), -0.9 + k * 0.6, 3.24, -1.12, 0.02)
  // Rear: roll door, frame, tail light clusters, plate, bumper.
  decal(group, W - 0.3, 2.0, rollDoorTex(), 0, 2.02, 3.155)
  part(group, W + 0.02, 0.12, 0.1, trim, 0, 0.98, 3.13, 0.02)
  for (const s of [-1, 1]) {
    part(group, 0.12, 2.2, 0.08, trim, s * (W / 2 - 0.05), 2.06, 3.13, 0.02)
    part(group, 0.26, 0.2, 0.04, tail, s * 0.85, 0.8, 3.17, 0.02)
    part(group, 0.12, 0.2, 0.04, AMBER(), s * 0.62, 0.8, 3.17, 0.02)
    part(group, 0.5, 0.42, 0.03, trim, s * 0.85, 0.42, 2.98, 0.01) // mudflap
  }
  decal(group, 0.4, 0.14, plateTex(opts.plate ?? 'DL-4317'), 0, 0.62, 3.172)
  part(group, 1.7, 0.16, 0.16, trim, 0, 0.62, 3.1, 0.04)
  for (const s of [-1, 1]) {
    wheel(group, s * 0.95, -2.3, 0.42, 0.28, wheels)
    for (const z of [1.8, 2.5]) wheel(group, s * 1.0, z, 0.42, 0.26, wheels, true)
  }
  return { group, wheels, wheelRadius: 0.42, rearWheels: [new THREE.Vector3(-1.0, 0, 2.5), new THREE.Vector3(1.0, 0, 2.5)], tail, length: 6.8, width: W }
}

// ------------------------------------------------------------------ the hatchback

/** The hatchback: a boxy little five-door with black bumpers and trim, square headlamps, wide tail lights and a yellow plate. */
export function makeCar(colour: number, opts: { plate?: string } = {}): VehicleModel {
  const group = new THREE.Group()
  const wheels: THREE.Object3D[] = []
  const paint = m(colour, 0.5, 0.1)
  const trim = TRIM()
  const glass = GLASS()
  const tail = tailMat()
  const W = 1.7
  const L = 4.25
  part(group, W, 0.56, L - 0.1, paint, 0, 0.6, 0, 0.12) // lower body
  part(group, W - 0.18, 0.56, 2.2, paint, 0, 1.12, 0.25, 0.12) // cabin
  part(group, W - 0.24, 0.44, 0.05, glass, 0, 1.14, -0.86, 0.03).rotation.x = -0.35 // windscreen
  part(group, W - 0.26, 0.42, 0.05, glass, 0, 1.14, 1.36, 0.03).rotation.x = 0.22 // rear window
  for (const s of [-1, 1]) {
    part(group, 0.04, 0.38, 1.9, glass, s * ((W - 0.18) / 2 + 0.005), 1.16, 0.25, 0.02)
    part(group, 0.04, 0.4, 0.05, paint, s * ((W - 0.18) / 2 + 0.01), 1.16, 0.25, 0.01) // B-pillar
    part(group, 0.03, 0.08, L - 0.6, trim, s * (W / 2 + 0.005), 0.62, 0, 0.01) // side strip
    for (const z of [-0.25, 0.75]) part(group, 0.03, 0.04, 0.14, trim, s * (W / 2 + 0.012), 0.82, z, 0.01) // handles
    part(group, 0.12, 0.1, 0.16, trim, s * (W / 2 + 0.05), 1.0, -0.72, 0.02) // mirror
    part(group, 0.34, 0.16, 0.04, HEAD(), s * 0.55, 0.72, -L / 2 + 0.02, 0.03)
    part(group, 0.36, 0.14, 0.04, tail, s * 0.55, 0.78, L / 2 - 0.02, 0.03)
    for (const z of [-1.3, 1.3]) part(group, 0.08, 0.3, 0.75, trim, s * (W / 2 - 0.02), 0.45, z, 0.04)
  }
  decal(group, 0.6, 0.18, grilleTex(''), 0, 0.72, -L / 2 + 0.01, Math.PI)
  for (const z of [-L / 2 + 0.03, L / 2 - 0.03]) part(group, W + 0.04, 0.18, 0.16, trim, 0, 0.42, z, 0.05)
  decal(group, 0.36, 0.13, plateTex(opts.plate ?? 'LM-1027'), 0, 0.42, -L / 2 - 0.06, Math.PI)
  decal(group, 0.36, 0.13, plateTex(opts.plate ?? 'LM-1027'), 0, 0.42, L / 2 + 0.06)
  for (const s of [-1, 1]) for (const z of [-1.3, 1.3]) wheel(group, s * 0.72, z, 0.31, 0.2, wheels)
  return { group, wheels, wheelRadius: 0.31, rearWheels: [new THREE.Vector3(-0.72, 0, 1.3), new THREE.Vector3(0.72, 0, 1.3)], tail, length: L, width: W }
}

// ------------------------------------------------------------------ the container lorry

export const LORRY_COLOURS = [0xf1efe9, 0x2f62b5, 0xc93a31, 0x2e7d4f, 0xe0a52c, 0x3a3f4a] as const

/** A container lorry and where its container sits (its centre, in the lorry's frame). */
export type ContainerLorry = VehicleModel & { container: THREE.Group; containerAt: THREE.Vector3 }

/**
 * The container lorry: a cab-over tractor (cab z −5.2…−2.6: windscreen, amber roof lights, grille, square lamps, mirrors, step,
 * exhaust stack) and a skeletal trailer (two beams, cross members, twist locks, landing legs, tandem axles, rear lights and bumper)
 * with one container lying along it (doors at the back). Nose −z; 10.2 m long, 2.5 m wide.
 */
export function makeContainerLorry(cab: number, opts: { plate?: string } = {}): ContainerLorry {
  const group = new THREE.Group()
  const wheels: THREE.Object3D[] = []
  const paint = m(cab, 0.55, 0.1)
  const trim = TRIM()
  const glass = GLASS()
  const tail = tailMat()
  const W = 2.5
  // Tractor: chassis, cab, details.
  part(group, 1.0, 0.3, 4.6, trim, 0, 0.85, -3.3, 0.04)
  part(group, W, 2.2, 2.6, paint, 0, 2.15, -3.9, 0.14)
  part(group, W - 0.2, 0.95, 0.05, glass, 0, 2.55, -5.205, 0.03)
  for (const s of [-1, 1]) {
    part(group, 0.04, 0.8, 1.2, glass, s * (W / 2 + 0.005), 2.55, -4.0, 0.02)
    part(group, 0.06, 0.5, 0.18, trim, s * (W / 2 + 0.18), 2.4, -5.0, 0.02) // mirror
    part(group, 0.05, 0.05, 0.3, trim, s * (W / 2 + 0.08), 2.4, -5.0, 0.01)
    part(group, 0.36, 0.26, 0.05, HEAD(), s * 0.82, 1.42, -5.21, 0.03)
    part(group, 0.16, 0.09, 0.04, AMBER(), s * 0.82, 1.22, -5.21, 0.01)
    part(group, 0.5, 0.1, 0.4, trim, s * 0.95, 0.95, -3.4, 0.02) // step
    part(group, 0.2, 0.45, 1.3, trim, s * (W / 2 - 0.1), 0.9, -4.6, 0.04) // wheel arch
  }
  for (let k = 0; k < 4; k++) part(group, 0.12, 0.06, 0.08, AMBER(), -0.45 + k * 0.3, 3.28, -5.0, 0.02)
  decal(group, 1.1, 0.42, grilleTex(''), 0, 1.5, -5.215, Math.PI)
  part(group, W + 0.05, 0.28, 0.28, trim, 0, 0.88, -5.2, 0.05)
  decal(group, 0.42, 0.15, plateTex(opts.plate ?? 'CT-2210'), 0, 0.88, -5.35, Math.PI)
  const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.6, 10), m(0xb8bec6, 0.3, 0.8))
  stack.position.set(W / 2 - 0.25, 3.2, -2.55)
  group.add(stack)
  part(group, 0.8, 0.12, 0.8, m(0x2b2f36, 0.5, 0.5), 0, 1.06, -1.9, 0.03) // fifth wheel
  // Trailer: beams, cross members, twist locks at the container's corners, landing legs, bumper, lights.
  for (const s of [-1, 1]) part(group, 0.16, 0.28, 7.2, trim, s * 0.45, 1.18, 1.0, 0.03)
  for (let z = -2.4; z <= 4.5; z += 1.15) part(group, 2.3, 0.1, 0.12, trim, 0, 1.3, z, 0.02)
  for (const z of [-1.6, 4.4]) for (const s of [-1, 1]) part(group, 0.14, 0.08, 0.14, m(0xf2b51d, 0.5, 0.3), s * 1.08, 1.37, z, 0.02)
  for (const s of [-1, 1]) {
    part(group, 0.08, 0.9, 0.08, trim, s * 0.7, 0.75, -1.2, 0.02)
    part(group, 0.28, 0.14, 0.04, tail, s * 0.95, 1.05, 4.62, 0.02)
    part(group, 0.5, 0.5, 0.03, trim, s * 1.05, 0.55, 3.95, 0.01)
  }
  part(group, 2.3, 0.12, 0.12, trim, 0, 0.72, 4.58, 0.03)
  decal(group, 0.42, 0.15, plateTex(opts.plate ?? 'CT-2210'), 0, 0.92, 4.65)
  // Wheels: steer axle, drive axle, trailer tandem.
  for (const s of [-1, 1]) {
    wheel(group, s * 1.05, -4.6, 0.5, 0.3, wheels)
    wheel(group, s * 1.05, -2.95, 0.5, 0.3, wheels, true)
    for (const z of [2.9, 3.95]) wheel(group, s * 1.05, z, 0.5, 0.3, wheels, true)
  }
  // The container (doors at the back), on the twist locks.
  const containerAt = new THREE.Vector3(0, 1.36 + BOX.h / 2, 1.4)
  const container = makeContainer(0xb91c1c)
  container.rotation.y = -Math.PI / 2
  container.position.copy(containerAt)
  group.add(container)
  return { group, wheels, wheelRadius: 0.5, rearWheels: [new THREE.Vector3(-1.05, 0, 3.95), new THREE.Vector3(1.05, 0, 3.95)], tail, length: 10.2, width: W, container, containerAt }
}
