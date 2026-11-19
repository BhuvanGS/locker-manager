import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { Appearance, Special } from '../sim/types'

/**
 * The game's own people: chunky blocky figures with soft edges, a big square head with a flat drawn face (heavy-lidded eyes, thick brows)
 * that changes with their mood (`setExpression`), messy block hair, and outfits by archetype (student, office worker, traveller, local,
 * tourist, business, casual): hoodies with hoods and pockets, shirts and ties, printed shirts, tank tops, open jackets over crop tops,
 * cargo pants, sneakers, backpacks, caps, sun hats, headphones, glasses, sunglasses, earrings, cameras. Four rare `Special` looks.
 *
 * Everything is built from an `Appearance` (its colours plus a hash for the choices), so the same customer always looks the same.
 * Animated by `animateToon` from the limb pivots (walk, idle, sit, carry, run). The root's origin is between the feet, facing +z.
 */
export type Expression = 'neutral' | 'happy' | 'surprised' | 'confused' | 'annoyed'

export type ToonRig = {
  root: THREE.Group
  body: THREE.Group
  hips: THREE.Group
  torso: THREE.Group
  head: THREE.Group
  legL: THREE.Group
  legR: THREE.Group
  kneeL: THREE.Group
  kneeR: THREE.Group
  armL: THREE.Group
  armR: THREE.Group
  elbowL: THREE.Group
  elbowR: THREE.Group
  hand: THREE.Group
  /** Extra bits that sway (a cape). */
  cape: THREE.Object3D | null
  /** The drawn face, and what it shows. */
  face: THREE.Mesh
  faceKey: FaceLook
  expression: Expression
  blinkIn: number
  phase: number
  breathe: number
}

type FaceLook = { skin: number; female: boolean; goatee: boolean; lashes: boolean; special: Special | undefined }

export type ToonOptions = { female?: boolean; smart?: boolean; worker?: boolean }
export type ToonPose = 'idle' | 'walk' | 'sit' | 'carry' | 'run'

// ------------------------------------------------------------------ caches

const mats = new Map<string, THREE.MeshStandardMaterial>()
function m(color: number, roughness = 0.8, metalness = 0): THREE.MeshStandardMaterial {
  const key = `${color}-${roughness}-${metalness}`
  let x = mats.get(key)
  if (!x) {
    x = new THREE.MeshStandardMaterial({ color, roughness, metalness })
    mats.set(key, x)
  }
  return x
}

const geos = new Map<string, THREE.BufferGeometry>()
/** A box with softly rounded edges (cached by size). */
function rbox(w: number, h: number, d: number, r = 0.035): THREE.BufferGeometry {
  const key = `${w.toFixed(3)}-${h.toFixed(3)}-${d.toFixed(3)}-${r}`
  let g = geos.get(key)
  if (!g) {
    g = new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.2, h / 2.2, d / 2.2))
    geos.set(key, g)
  }
  return g
}

function part(parent: THREE.Object3D, w: number, h: number, d: number, material: THREE.Material, x = 0, y = 0, z = 0, r = 0.035): THREE.Mesh {
  const o = new THREE.Mesh(rbox(w, h, d, r), material)
  o.position.set(x, y, z)
  o.castShadow = true
  parent.add(o)
  return o
}

function pivot(parent: THREE.Object3D, x: number, y: number, z = 0): THREE.Group {
  const g = new THREE.Group()
  g.position.set(x, y, z)
  parent.add(g)
  return g
}

function shade(color: number, f: number): number {
  return new THREE.Color(color).multiplyScalar(f).getHex()
}

// ------------------------------------------------------------------ faces

const faceMaterials = new Map<string, THREE.Material>()

function css(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`
}

/** The face for a look and expression, drawn on a transparent canvas (eyes, lids, brows, nose, mouth). `blink` closes the eyes. */
function faceMaterial(look: FaceLook, expr: Expression, blink: boolean): THREE.Material {
  const key = `${look.skin}-${look.female}-${look.goatee}-${look.lashes}-${look.special ?? ''}-${expr}-${blink}`
  let mat = faceMaterials.get(key)
  if (mat) return mat
  if (typeof document === 'undefined') {
    mat = new THREE.MeshBasicMaterial({ visible: false })
  } else {
    const c = document.createElement('canvas')
    c.width = c.height = 256
    const g = c.getContext('2d')
    if (g) drawFace(g, look, expr, blink)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.05, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 })
  }
  faceMaterials.set(key, mat)
  return mat
}

function drawFace(g: CanvasRenderingContext2D, look: FaceLook, expr: Expression, blink: boolean): void {
  const ink = '#141217'
  const lid = css(shade(look.skin, 0.78))
  g.lineCap = 'round'
  g.lineJoin = 'round'
  const eyeY = 118
  const wide = expr === 'surprised'
  for (const [i, x] of [78, 178].entries()) {
    const s = i === 0 ? -1 : 1
    if (blink || expr === 'happy') {
      // Closed: a curve (happy: smiling eyes).
      g.strokeStyle = ink
      g.lineWidth = 9
      g.beginPath()
      if (expr === 'happy') g.arc(x, eyeY + 10, 22, Math.PI * 1.15, Math.PI * 1.85)
      else g.arc(x, eyeY - 6, 24, Math.PI * 0.15, Math.PI * 0.85)
      g.stroke()
    } else {
      const rw = wide ? 30 : 31
      const rh = wide ? 30 : 23
      g.fillStyle = '#ffffff'
      g.strokeStyle = ink
      g.lineWidth = 6
      g.beginPath()
      g.ellipse(x, eyeY, rw, rh, 0, 0, Math.PI * 2)
      g.fill()
      g.stroke()
      // The pupil (glancing aside when confused), with a highlight.
      const px = x + (expr === 'confused' ? 9 : 0)
      g.fillStyle = ink
      g.beginPath()
      g.ellipse(px, eyeY + (wide ? 0 : 4), wide ? 9 : 13, wide ? 9 : 15, 0, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = '#ffffff'
      g.beginPath()
      g.arc(px + 4, eyeY - 3, 3.5, 0, Math.PI * 2)
      g.fill()
      // The heavy upper lid that gives everyone their sleepy, unimpressed look (lower when annoyed, none when surprised).
      if (!wide) {
        const drop = expr === 'annoyed' ? 0.62 : 0.42
        const tilt = expr === 'annoyed' ? -s * 8 : 0
        g.save()
        g.beginPath()
        g.ellipse(x, eyeY, rw, rh, 0, 0, Math.PI * 2)
        g.clip()
        g.fillStyle = lid
        g.beginPath()
        g.moveTo(x - rw - 4, eyeY - rh - 4)
        g.lineTo(x + rw + 4, eyeY - rh - 4)
        g.lineTo(x + rw + 4, eyeY - rh + rh * 2 * drop - tilt)
        g.lineTo(x - rw - 4, eyeY - rh + rh * 2 * drop + tilt)
        g.closePath()
        g.fill()
        g.restore()
        g.strokeStyle = ink
        g.lineWidth = 7
        g.beginPath()
        g.moveTo(x - rw, eyeY - rh + rh * 2 * drop + tilt)
        g.lineTo(x + rw, eyeY - rh + rh * 2 * drop - tilt)
        g.stroke()
      }
      if (look.lashes) {
        g.strokeStyle = ink
        g.lineWidth = 5
        g.beginPath()
        g.moveTo(x + s * (rw - 2), eyeY - 6)
        g.lineTo(x + s * (rw + 12), eyeY - 16)
        g.moveTo(x + s * (rw - 6), eyeY - 14)
        g.lineTo(x + s * (rw + 6), eyeY - 26)
        g.stroke()
      }
    }
    // Brows: thick; raised when surprised, one up when confused, angled down when annoyed.
    g.strokeStyle = ink
    g.lineWidth = look.female ? 9 : 13
    let y0 = eyeY - 44
    let y1 = eyeY - 46
    if (expr === 'surprised') {
      y0 -= 12
      y1 -= 14
    } else if (expr === 'annoyed') {
      y0 -= 4
      y1 += 12
    } else if (expr === 'confused' && i === 1) {
      y0 -= 14
      y1 -= 16
    } else if (expr === 'happy') {
      y0 -= 6
      y1 -= 8
    }
    g.beginPath()
    g.moveTo(x - s * 30, y0)
    g.quadraticCurveTo(x, Math.min(y0, y1) - 6, x + s * 28, y1)
    g.stroke()
  }
  // Nose: a small shadow.
  g.strokeStyle = css(shade(look.skin, 0.7))
  g.lineWidth = 6
  g.beginPath()
  g.moveTo(130, 150)
  g.quadraticCurveTo(138, 166, 126, 170)
  g.stroke()
  // Mouth.
  g.strokeStyle = ink
  g.fillStyle = '#5a1f24'
  g.lineWidth = 7
  const my = 200
  g.beginPath()
  if (expr === 'happy') {
    g.moveTo(98, my - 8)
    g.quadraticCurveTo(128, my + 26, 160, my - 8)
    g.closePath()
    g.fill()
    g.stroke()
    g.fillStyle = '#ffffff'
    g.fillRect(110, my - 6, 38, 6)
  } else if (expr === 'surprised') {
    g.ellipse(128, my, 13, 17, 0, 0, Math.PI * 2)
    g.fill()
    g.stroke()
  } else if (expr === 'confused') {
    g.moveTo(104, my + 2)
    g.quadraticCurveTo(118, my - 8, 130, my + 2)
    g.quadraticCurveTo(142, my + 10, 154, my - 2)
    g.stroke()
  } else if (expr === 'annoyed') {
    g.moveTo(104, my + 6)
    g.quadraticCurveTo(128, my - 8, 152, my + 6)
    g.stroke()
  } else {
    g.moveTo(108, my)
    g.lineTo(146, my - 2)
    g.stroke()
  }
  if (look.female && expr !== 'surprised') {
    g.fillStyle = 'rgba(244,114,182,0.35)'
    for (const x of [62, 194]) {
      g.beginPath()
      g.ellipse(x, 166, 16, 9, 0, 0, Math.PI * 2)
      g.fill()
    }
  }
  if (look.goatee) {
    g.fillStyle = ink
    g.beginPath()
    g.moveTo(112, 222)
    g.lineTo(144, 222)
    g.lineTo(136, 248)
    g.lineTo(120, 248)
    g.closePath()
    g.fill()
  }
  if (look.special === 'ninja') {
    // Whisker marks on the cheeks.
    g.strokeStyle = ink
    g.lineWidth = 4
    for (const s of [-1, 1]) {
      for (const dy of [-8, 4, 16]) {
        g.beginPath()
        g.moveTo(128 + s * 70, 160 + dy)
        g.lineTo(128 + s * 100, 156 + dy)
        g.stroke()
      }
    }
  }
}

// ------------------------------------------------------------------ prints

let floral: THREE.CanvasTexture | null = null
/** A loud holiday print (flowers and leaves on white), tinted per person by the material colour. */
function floralTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null
  if (floral) return floral
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')
  if (g) {
    g.fillStyle = '#ffffff'
    g.fillRect(0, 0, 128, 128)
    const flower = (x: number, y: number, r: number, col: string) => {
      g.fillStyle = col
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2
        g.beginPath()
        g.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, r * 0.75, 0, Math.PI * 2)
        g.fill()
      }
      g.fillStyle = '#fde047'
      g.beginPath()
      g.arc(x, y, r * 0.5, 0, Math.PI * 2)
      g.fill()
    }
    flower(24, 26, 9, '#fecdd3')
    flower(88, 18, 7, '#ffffff')
    flower(64, 70, 10, '#fecdd3')
    flower(18, 98, 7, '#ffffff')
    flower(104, 96, 9, '#fecdd3')
    g.fillStyle = '#86efac'
    for (const [x, y] of [[44, 40], [110, 52], [36, 70], [82, 112], [8, 60]] as const) {
      g.beginPath()
      g.ellipse(x, y, 9, 4, 0.6, 0, Math.PI * 2)
      g.fill()
    }
  }
  floral = new THREE.CanvasTexture(c)
  floral.colorSpace = THREE.SRGBColorSpace
  return floral
}

const printMats = new Map<number, THREE.MeshStandardMaterial>()
function printMat(color: number): THREE.MeshStandardMaterial {
  let x = printMats.get(color)
  if (!x) {
    x = new THREE.MeshStandardMaterial({ color, map: floralTexture(), roughness: 0.85 })
    printMats.set(color, x)
  }
  return x
}

// ------------------------------------------------------------------ outfits

type Archetype = 'student' | 'office' | 'traveller' | 'local' | 'tourist' | 'business' | 'casual'
const ARCHETYPES: Archetype[] = ['student', 'office', 'traveller', 'local', 'tourist', 'business', 'casual', 'student', 'casual']

/** A stable number from an appearance, for choosing clothes and details. */
function hashOf(a: Appearance): number {
  return Math.abs(Math.imul(a.shirt ^ (a.hair * 31) ^ (a.trousers * 17) ^ (a.skin * 7) ^ Math.round(a.height * 1000), 2654435761)) >>> 0
}

type Outfit = {
  top: 'hoodie' | 'tee' | 'shirt' | 'print' | 'tank' | 'suit' | 'jacket' | 'gi' | 'jumpsuit' | 'robe' | 'hero'
  topColor: number
  inner: number
  pants: 'cargo' | 'jeans' | 'trousers' | 'shorts' | 'wide'
  pantsColor: number
  shoes: number
  sole: number
  hat: 'none' | 'cap' | 'sunhat' | 'beanie'
  hatColor: number
  backpack: boolean
  headphones: boolean
  glasses: 'none' | 'specs' | 'shades'
  tie: boolean
  lanyard: boolean
  chain: boolean
  camera: boolean
  earrings: boolean
}

const HOODIES = [0x9ca3af, 0x1f2937, 0x3f6212, 0xb91c1c, 0x1d4ed8, 0x7c3aed]
const JACKETS = [0x111827, 0x7f1d1d, 0x365314, 0x1e3a8a, 0x78716c]
const PRINTS = [0xdc2626, 0x0ea5e9, 0x16a34a, 0xf97316, 0x1e293b]

function outfitFor(a: Appearance, opts: ToonOptions, female: boolean, h: number): Outfit {
  const bit = (n: number, mod: number) => (h >>> n) % mod
  const arche: Archetype = opts.smart ? 'business' : ARCHETYPES[bit(4, ARCHETYPES.length)]!
  const o: Outfit = {
    top: 'tee', topColor: a.shirt, inner: 0xf5f5f4, pants: 'jeans', pantsColor: a.trousers, shoes: 0x1f2937, sole: 0xf8fafc,
    hat: 'none', hatColor: 0x111827, backpack: false, headphones: false, glasses: bit(9, 7) === 0 ? 'specs' : 'none', tie: false,
    lanyard: false, chain: false, camera: false, earrings: female && bit(11, 2) === 0,
  }
  switch (arche) {
    case 'student':
      o.top = 'hoodie'
      o.topColor = HOODIES[bit(13, HOODIES.length)]!
      o.pants = female ? 'wide' : 'cargo'
      o.pantsColor = [0x111827, 0x3f3f46, 0x9ca3af][bit(15, 3)]!
      o.backpack = bit(17, 3) !== 0
      o.hat = !female && bit(19, 3) === 0 ? 'cap' : 'none'
      o.headphones = female && bit(19, 2) === 0
      o.shoes = 0x111827
      break
    case 'office':
      o.top = 'shirt'
      o.topColor = [0xf8fafc, 0xdbeafe, 0xf1f5f9][bit(13, 3)]!
      o.pants = 'trousers'
      o.pantsColor = 0x1f2937
      o.tie = !female
      o.lanyard = true
      o.glasses = bit(15, 2) === 0 ? 'specs' : 'none'
      o.shoes = 0x111111
      o.sole = 0x111111
      break
    case 'traveller':
      o.top = female ? 'tank' : 'print'
      o.topColor = female ? 0xf5e6c8 : PRINTS[bit(13, PRINTS.length)]!
      o.pants = 'shorts'
      o.pantsColor = [0x3f3f46, 0xd6c3a0, 0x57534e][bit(15, 3)]!
      o.hat = 'sunhat'
      o.hatColor = 0xd6b27a
      o.backpack = true
      o.glasses = female ? 'shades' : 'none'
      break
    case 'local':
      o.top = 'tank'
      o.topColor = [0xf8fafc, 0xe5e7eb, 0x111827][bit(13, 3)]!
      o.pants = 'jeans'
      o.pantsColor = [0x1e3a8a, 0x334155, 0x9ca3af][bit(15, 3)]!
      o.chain = !female
      break
    case 'tourist':
      o.top = female ? 'tank' : 'print'
      o.topColor = female ? 0xf8fafc : PRINTS[bit(13, PRINTS.length)]!
      o.pants = 'shorts'
      o.pantsColor = 0xd6c3a0
      o.hat = 'sunhat'
      o.hatColor = 0xe7c98a
      o.glasses = 'shades'
      o.camera = !female
      break
    case 'business':
      o.top = 'suit'
      o.topColor = female ? 0x1e3a8a : 0x111827
      o.inner = 0xf8fafc
      o.pants = 'trousers'
      o.pantsColor = female ? 0x1e293b : 0x111827
      o.tie = !female
      o.shoes = 0x0b0b0b
      o.sole = 0x0b0b0b
      break
    case 'casual':
      o.top = 'jacket'
      o.topColor = JACKETS[bit(13, JACKETS.length)]!
      o.inner = female ? 0xf5f5f4 : a.shirt
      o.pants = female ? 'wide' : 'cargo'
      o.pantsColor = [0x3f3f46, 0x111827, 0x57534e][bit(15, 3)]!
      o.headphones = female && bit(17, 3) === 0
      o.hat = !female && bit(17, 4) === 0 ? 'beanie' : 'none'
      o.hatColor = a.shirt
      break
  }
  if (opts.worker) {
    o.top = 'hoodie'
    o.topColor = 0xf97316
    o.pants = 'cargo'
    o.pantsColor = 0x1e3a8a
    o.hat = 'cap'
    o.hatColor = 0x1e3a8a
    o.backpack = false
  }
  return o
}

function specialOutfit(o: Outfit, s: Special): void {
  Object.assign(o, { hat: 'none', backpack: false, headphones: false, glasses: 'none', tie: false, lanyard: false, chain: false, camera: false, earrings: false })
  if (s === 'fighter') Object.assign(o, { top: 'gi', topColor: 0xf97316, inner: 0x1d4ed8, pants: 'trousers', pantsColor: 0xf97316, shoes: 0x1d4ed8, sole: 0x1e3a8a })
  if (s === 'ninja') Object.assign(o, { top: 'jumpsuit', topColor: 0xf97316, inner: 0x1e3a8a, pants: 'trousers', pantsColor: 0xf97316, shoes: 0x1e3a8a, sole: 0x1e3a8a })
  if (s === 'swordsman') Object.assign(o, { top: 'robe', topColor: 0x0b0b0b, inner: 0xf8fafc, pants: 'wide', pantsColor: 0x0b0b0b, shoes: 0x1f2937, sole: 0x111111 })
  if (s === 'caped') Object.assign(o, { top: 'hero', topColor: 0xfacc15, inner: 0x111827, pants: 'trousers', pantsColor: 0xfacc15, shoes: 0xdc2626, sole: 0xb91c1c })
}

// ------------------------------------------------------------------ the figure

const HEAD = { w: 0.46, h: 0.44, d: 0.42 }
/** Everyone has the same warm skin tone (the house style); people differ by face, hair and clothes. */
const SKIN = 0xe3a872

export function makeToon(a: Appearance, opts: ToonOptions = {}): ToonRig {
  const h = hashOf(a)
  const bit = (n: number, mod: number) => (h >>> n) % mod
  const special = a.special
  const female = !!opts.female && !special
  const o = outfitFor(a, opts, female, h)
  if (special) specialOutfit(o, special)

  const skinM = m(SKIN, 0.7)
  const topM = o.top === 'print' ? printMat(o.topColor) : m(o.topColor, 0.85)
  const innerM = m(o.inner, 0.85)
  const pantsM = m(o.pantsColor, 0.88)
  const shoeM = m(o.shoes, 0.6)
  const soleM = m(o.sole, 0.6)

  const root = new THREE.Group()
  const body = new THREE.Group()
  body.scale.setScalar(a.height * 0.97)
  root.add(body)
  const hips = pivot(body, 0, 0.84)
  const torso = pivot(hips, 0, 0)

  // Torso: a block (a crop top and a strip of skin under an open jacket for some women), with the outfit's details.
  const tw = female ? 0.44 : 0.5
  const th = 0.56
  const td = 0.27
  const open = o.top === 'jacket' || o.top === 'suit'
  if (female && o.top === 'jacket') {
    part(torso, tw - 0.04, 0.12, td - 0.04, skinM, 0, 0.1, 0) // midriff
    part(torso, tw - 0.03, th - 0.18, td - 0.03, innerM, 0, 0.18 + (th - 0.18) / 2, 0)
  } else {
    part(torso, tw, th, td, open ? innerM : topM, 0, th / 2, 0, 0.05)
  }
  if (open) {
    // An open jacket: two front panels and the back, a little proud of the body, with the shirt showing down the middle.
    const jm = m(o.topColor, 0.8)
    const panel = (tw - 0.14) / 2
    for (const s of [-1, 1]) part(torso, panel, th + 0.02, 0.05, jm, s * (tw / 2 - panel / 2 + 0.01), th / 2, td / 2 - 0.005, 0.02)
    part(torso, tw + 0.02, th + 0.02, td - 0.06, jm, 0, th / 2, -0.03, 0.05)
    for (const s of [-1, 1]) {
      const lapel = part(torso, 0.06, 0.2, 0.03, m(shade(o.topColor, 0.8), 0.8), s * 0.06, th - 0.12, td / 2 + 0.02, 0.01)
      lapel.rotation.z = s * 0.35
    }
  }
  if (o.top === 'hoodie') {
    part(torso, tw - 0.02, 0.16, 0.14, m(shade(o.topColor, 0.9), 0.85), 0, th - 0.02, -td / 2 + 0.02, 0.05) // the hood, down
    part(torso, tw * 0.6, 0.14, 0.03, m(shade(o.topColor, 0.92), 0.85), 0, 0.16, td / 2 + 0.005, 0.02) // the pocket
    for (const s of [-1, 1]) part(torso, 0.018, 0.16, 0.018, m(0xf5f5f4), s * 0.05, th - 0.12, td / 2 + 0.012, 0.006) // strings
  }
  if (o.top === 'shirt' || o.top === 'print' || o.top === 'suit') {
    for (const s of [-1, 1]) {
      const collar = part(torso, 0.1, 0.05, 0.04, o.top === 'suit' ? innerM : topM, s * 0.06, th - 0.02, td / 2 + 0.005, 0.01)
      collar.rotation.z = -s * 0.3
    }
  }
  if (o.tie) part(torso, 0.05, 0.3, 0.02, m(bit(21, 2) ? 0x7f1d1d : 0x1e3a8a, 0.6), 0, th - 0.19, td / 2 + 0.012, 0.008)
  if (o.lanyard) {
    for (const s of [-1, 1]) part(torso, 0.012, 0.22, 0.012, m(0x2563eb), s * 0.06, th - 0.12, td / 2 + 0.008, 0.004)
    part(torso, 0.09, 0.11, 0.012, m(0xf8fafc, 0.4), 0, th - 0.28, td / 2 + 0.012, 0.01)
  }
  if (o.chain) part(torso, 0.16, 0.012, 0.012, m(0xfbbf24, 0.3, 0.8), 0, th - 0.1, td / 2 + 0.006, 0.004)
  if (o.camera) {
    part(torso, 0.16, 0.1, 0.06, m(0x111827, 0.4), 0.02, th - 0.3, td / 2 + 0.04, 0.015)
    part(torso, 0.06, 0.06, 0.04, m(0x334155, 0.2, 0.5), 0.02, th - 0.3, td / 2 + 0.085, 0.015)
  }
  if (o.backpack) {
    const bc = [0x111827, 0x334155, 0x7c2d12, 0x14532d][bit(23, 4)]!
    const bm = m(bc, 0.75)
    part(torso, tw - 0.06, 0.44, 0.16, bm, 0, th / 2 + 0.02, -td / 2 - 0.08, 0.04)
    part(torso, tw - 0.14, 0.18, 0.05, m(shade(bc, 0.8), 0.75), 0, th / 2 - 0.08, -td / 2 - 0.17, 0.02)
    // Straps over the shoulders, down to the chest.
    for (const s of [-1, 1]) {
      part(torso, 0.06, 0.05, td + 0.04, bm, s * (tw / 2 - 0.07), th + 0.005, 0, 0.015)
      part(torso, 0.06, 0.2, 0.03, bm, s * (tw / 2 - 0.07), th - 0.1, td / 2 + 0.01, 0.01)
    }
  }
  // Specials' extras.
  let cape: THREE.Object3D | null = null
  if (o.top === 'gi' || o.top === 'jumpsuit') {
    part(torso, tw - 0.2, 0.2, 0.02, innerM, 0, th - 0.12, td / 2 + 0.004, 0.01) // the undershirt in the V
    part(torso, tw + 0.02, 0.06, td + 0.02, m(o.top === 'gi' ? 0x1d4ed8 : 0x111827), 0, 0.05, 0, 0.02) // the belt
  }
  if (o.top === 'robe') {
    part(torso, tw + 0.04, th + 0.02, td + 0.03, topM, 0, th / 2, 0, 0.05)
    part(torso, 0.08, th, 0.02, innerM, 0, th / 2, td / 2 + 0.02, 0.01)
    const blade = new THREE.Group()
    part(blade, 0.16, 1.2, 0.03, m(0xd1d5db, 0.25, 0.9), 0, 0, 0, 0.01)
    part(blade, 0.05, 0.32, 0.05, m(0x111827, 0.6), 0, -0.76, 0, 0.01)
    part(blade, 0.2, 0.04, 0.06, m(0x6b7280, 0.4, 0.6), 0, -0.6, 0, 0.01)
    blade.position.set(0.02, th / 2 + 0.05, -td / 2 - 0.05)
    blade.rotation.z = 0.55
    torso.add(blade)
  }
  if (o.top === 'hero') {
    const c = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 1.0, 1, 6).translate(0, -0.5, 0), new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.85, side: THREE.DoubleSide }))
    c.position.set(0, th - 0.02, -td / 2 - 0.01)
    c.castShadow = true
    torso.add(c)
    cape = c
    part(torso, tw + 0.02, 0.06, td + 0.02, m(0x111827), 0, 0.05, 0, 0.02)
  }

  // Head: a big soft block with the drawn face on its front and ears at the sides.
  const head = pivot(torso, 0, th + 0.02)
  part(head, 0.14, 0.08, 0.14, skinM, 0, 0.02, 0, 0.03) // neck
  part(head, HEAD.w, HEAD.h, HEAD.d, skinM, 0, 0.06 + HEAD.h / 2, 0, 0.07)
  for (const s of [-1, 1]) part(head, 0.05, 0.1, 0.08, skinM, s * (HEAD.w / 2 + 0.01), 0.06 + HEAD.h * 0.46, -0.01, 0.02)
  const look: FaceLook = { skin: SKIN, female, goatee: !female && !special && bit(25, 4) === 0, lashes: female, special }
  const face = new THREE.Mesh(new THREE.PlaneGeometry(HEAD.w * 0.92, HEAD.h * 0.92), faceMaterial(look, 'neutral', false))
  face.position.set(0, 0.06 + HEAD.h / 2, HEAD.d / 2 + 0.004)
  head.add(face)
  if (o.earrings) {
    for (const s of [-1, 1]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 14), m(0xfbbf24, 0.3, 0.9))
      ring.position.set(s * (HEAD.w / 2 + 0.03), 0.06 + HEAD.h * 0.3, 0.0)
      ring.rotation.y = Math.PI / 2
      head.add(ring)
    }
  }
  if (o.glasses !== 'none') {
    const frame = m(0x111827, 0.4, 0.2)
    const lens = o.glasses === 'shades' ? m(0x0b0b0b, 0.15, 0.4) : new THREE.MeshStandardMaterial({ color: 0xbfdbfe, transparent: true, opacity: 0.25, roughness: 0.1 })
    for (const s of [-1, 1]) {
      part(head, 0.15, 0.11, 0.015, frame, s * 0.09, 0.06 + HEAD.h * 0.58, HEAD.d / 2 + 0.02, 0.02)
      part(head, 0.12, 0.08, 0.016, lens, s * 0.09, 0.06 + HEAD.h * 0.58, HEAD.d / 2 + 0.026, 0.015)
    }
    part(head, 0.06, 0.015, 0.015, frame, 0, 0.06 + HEAD.h * 0.6, HEAD.d / 2 + 0.02, 0.005)
  }
  addHair(head, a, female, h, special, m(a.hair, 0.9), o)
  if (o.headphones) {
    const hm = m([0xf472b6, 0xf8fafc, 0x111827][bit(27, 3)]!, 0.5)
    part(head, HEAD.w + 0.1, 0.05, 0.06, hm, 0, 0.06 + HEAD.h + 0.06, 0, 0.02)
    for (const s of [-1, 1]) part(head, 0.07, 0.14, 0.14, hm, s * (HEAD.w / 2 + 0.04), 0.06 + HEAD.h * 0.48, 0, 0.03)
  }

  // Arms: upper and lower (sleeves or bare), and a square hand.
  const sleeveM = open ? m(o.topColor, 0.8) : topM
  const bare = o.top === 'tank' || o.top === 'hero' ? 'both' : o.top === 'tee' || o.top === 'print' || o.top === 'gi' ? 'lower' : 'none'
  const shoulderX = tw / 2 + 0.085
  const armL = pivot(torso, -shoulderX, th - 0.06)
  const armR = pivot(torso, shoulderX, th - 0.06)
  const elbows: THREE.Group[] = []
  for (const arm of [armL, armR]) {
    part(arm, 0.16, 0.3, 0.17, bare === 'both' ? (o.top === 'hero' ? topM : skinM) : sleeveM, 0, -0.13, 0, 0.04)
    const elbow = pivot(arm, 0, -0.27)
    part(elbow, 0.15, 0.24, 0.16, bare === 'none' || o.top === 'hero' ? (o.top === 'hero' ? topM : sleeveM) : skinM, 0, -0.1, 0, 0.04)
    part(elbow, 0.14, 0.12, 0.15, o.top === 'hero' ? m(0xdc2626, 0.6) : skinM, 0, -0.27, 0.005, 0.04)
    elbows.push(elbow)
  }
  const hand = pivot(elbows[1]!, 0, -0.33, 0.02)

  // Legs: thigh and shin, chunky sneakers with white soles; cargo pockets, shorts or wide legs.
  const lx = female ? 0.105 : 0.12
  const legL = pivot(hips, -lx, 0)
  const legR = pivot(hips, lx, 0)
  const knees: THREE.Group[] = []
  const wide = o.pants === 'wide' ? 0.03 : 0
  for (const [i, leg] of [legL, legR].entries()) {
    part(leg, 0.2 + wide, 0.42, 0.22 + wide, pantsM, 0, -0.19, 0, 0.04)
    if (o.pants === 'cargo') part(leg, 0.04, 0.14, 0.12, m(shade(o.pantsColor, 0.85)), (i === 0 ? -1 : 1) * 0.115, -0.24, 0, 0.015)
    const knee = pivot(leg, 0, -0.4)
    part(knee, 0.19 + wide, 0.36, 0.21 + wide, o.pants === 'shorts' ? skinM : pantsM, 0, -0.18, 0, 0.04)
    part(knee, 0.21, 0.09, 0.3, shoeM, 0, -0.39, 0.04, 0.035)
    part(knee, 0.22, 0.04, 0.31, soleM, 0, -0.43, 0.04, 0.015)
    knees.push(knee)
  }
  part(hips, female ? 0.44 : 0.48, 0.12, 0.25, pantsM, 0, -0.03, 0, 0.04) // seat

  return {
    root,
    body,
    hips,
    torso,
    head,
    legL,
    legR,
    kneeL: knees[0]!,
    kneeR: knees[1]!,
    armL,
    armR,
    elbowL: elbows[0]!,
    elbowR: elbows[1]!,
    hand,
    cape,
    face,
    faceKey: look,
    expression: 'neutral',
    blinkIn: 1 + (h % 400) / 100,
    phase: (h % 628) / 100,
    breathe: (h % 300) / 100,
  }
}

/** Messy block hair: a cap of chunks over the crown and back, a fringe of tufts, and the style's extras (bun, ponytail, long). */
function addHair(head: THREE.Group, a: Appearance, female: boolean, h: number, special: Special | undefined, hm: THREE.Material, o: Outfit): void {
  const top = 0.06 + HEAD.h
  const cy = 0.06 + HEAD.h / 2
  const rnd = (k: number) => ((Math.imul(h ^ Math.imul(k, 0x9e3779b1), 2246822519) >>> 0) % 1000) / 1000
  const chunk = (w: number, ht: number, d: number, x: number, y: number, z: number, rx = 0, rz = 0) => {
    const c = part(head, w, ht, d, hm, x, y, z, 0.025)
    c.rotation.set(rx, 0, rz)
    return c
  }
  if (special === 'caped') return
  if (special) {
    // Big angular spikes (four-sided, to match the blocks): tallest for the fighter.
    const tall = special === 'fighter' ? 1.5 : special === 'swordsman' ? 0.95 : 1.15
    chunk(HEAD.w + 0.04, 0.12, HEAD.d + 0.04, 0, top + 0.02, -0.01)
    const n = special === 'fighter' ? 11 : 9
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2
      const len = (0.2 + rnd(i) * 0.1) * tall
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.09, len, 4), hm)
      spike.castShadow = true
      spike.position.set(Math.sin(ang) * 0.14, top + 0.06 + len * 0.38, Math.cos(ang) * 0.12 - 0.04)
      spike.rotation.set(-Math.cos(ang) * 0.6 - 0.25, Math.PI / 4, Math.sin(ang) * 0.6)
      head.add(spike)
    }
    for (const x of [-0.13, -0.03, 0.08]) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 4), hm)
      f.position.set(x, top - 0.04, HEAD.d / 2 + 0.01)
      f.rotation.set(2.6, Math.PI / 4, -x * 2)
      head.add(f)
    }
    if (special === 'ninja') {
      part(head, HEAD.w + 0.05, 0.07, HEAD.d + 0.05, m(0x1e3a8a, 0.6), 0, top - 0.06, 0, 0.02)
      part(head, 0.14, 0.06, 0.02, m(0xcbd5e1, 0.3, 0.8), 0, top - 0.06, HEAD.d / 2 + 0.03, 0.01)
    }
    return
  }
  const bald = a.hairStyle === 'bald' && !female
  const hatted = o.hat !== 'none'
  if (!bald) {
    // The cap of hair: a slab over the crown and down the back and sides.
    chunk(HEAD.w + 0.04, 0.1, HEAD.d + 0.04, 0, top + 0.01, -0.005)
    chunk(HEAD.w + 0.04, HEAD.h * 0.72, 0.08, 0, cy + 0.04, -HEAD.d / 2 - 0.01)
    for (const s of [-1, 1]) chunk(0.06, HEAD.h * 0.42, HEAD.d * 0.8, s * (HEAD.w / 2 + 0.01), cy + 0.1, -0.04)
    if (!hatted) {
      // Messy tufts on top.
      const tufts = 6 + Math.floor(rnd(1) * 5)
      for (let i = 0; i < tufts; i++) {
        const x = (rnd(i + 10) - 0.5) * HEAD.w * 0.95
        const z = (rnd(i + 30) - 0.55) * HEAD.d * 0.9
        const s = 0.09 + rnd(i + 50) * 0.07
        chunk(s, s * 0.8, s, x, top + 0.05 + rnd(i + 70) * 0.04, z, (rnd(i + 90) - 0.5) * 0.7, (rnd(i + 110) - 0.5) * 0.7)
      }
    }
    // A fringe of chunks over the forehead.
    const fringe = female ? 4 : 5
    for (let i = 0; i < fringe; i++) {
      const x = -HEAD.w / 2 + 0.06 + (i / (fringe - 1)) * (HEAD.w - 0.12)
      chunk(0.1 + rnd(i + 130) * 0.04, 0.1 + rnd(i + 150) * 0.05, 0.06, x, top - 0.045 - rnd(i + 170) * 0.025, HEAD.d / 2 - 0.005, 0.25, (rnd(i + 190) - 0.5) * 0.6)
    }
    if (female) {
      const style = a.hairStyle
      if (style === 'bun' || style === 'short') {
        chunk(0.2, 0.18, 0.18, 0, top + 0.08, -0.12, -0.2) // a messy bun
        chunk(0.12, 0.1, 0.12, 0.05, top + 0.16, -0.1, 0.3, 0.4)
      }
      if (style === 'long' || style === 'bald') {
        chunk(HEAD.w + 0.06, 0.42, 0.1, 0, cy - 0.12, -HEAD.d / 2 - 0.03)
        for (const s of [-1, 1]) chunk(0.08, 0.36, 0.12, s * (HEAD.w / 2 + 0.02), cy - 0.08, 0.1)
      }
      if (style === 'cap') chunk(0.12, 0.32, 0.1, 0, cy - 0.1, -HEAD.d / 2 - 0.08, 0.2) // a ponytail
    }
  }
  // Hats.
  if (o.hat === 'cap') {
    const cm = m(o.hatColor, 0.7)
    part(head, HEAD.w + 0.06, 0.14, HEAD.d + 0.06, cm, 0, top + 0.04, 0, 0.05)
    part(head, HEAD.w * 0.8, 0.03, 0.18, cm, 0, top - 0.01, HEAD.d / 2 + 0.08, 0.01)
  } else if (o.hat === 'beanie') {
    const cm = m(o.hatColor, 0.9)
    part(head, HEAD.w + 0.06, 0.2, HEAD.d + 0.06, cm, 0, top + 0.04, 0, 0.07)
    part(head, HEAD.w + 0.08, 0.06, HEAD.d + 0.08, m(shade(o.hatColor, 0.85), 0.9), 0, top - 0.04, 0, 0.02)
  } else if (o.hat === 'sunhat') {
    const sm = m(o.hatColor, 0.9)
    part(head, HEAD.w + 0.02, 0.14, HEAD.d + 0.02, sm, 0, top + 0.06, 0, 0.05)
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.44, 0.03, 20), sm)
    brim.position.set(0, top, 0)
    brim.castShadow = true
    head.add(brim)
    part(head, HEAD.w + 0.03, 0.04, HEAD.d + 0.03, m(0x7c2d12, 0.8), 0, top + 0.02, 0, 0.015)
  }
}

// ------------------------------------------------------------------ expression and animation

/** Show an expression on a person's face (a cached drawn texture per look and mood). */
export function setExpression(rig: ToonRig, expr: Expression): void {
  if (rig.expression === expr) return
  rig.expression = expr
  rig.face.material = faceMaterial(rig.faceKey, expr, false)
}

/** Move a toon's limbs for a pose and blink now and then; `speed` scales the walk cycle. Call every frame. */
export function animateToon(rig: ToonRig, dt: number, pose: ToonPose, speed = 1): void {
  const moving = pose === 'walk' || pose === 'run'
  rig.phase += dt * (moving ? 7.5 * speed * (pose === 'run' ? 1.5 : 1) : 0)
  rig.breathe += dt
  // Blink: eyes shut for a moment every few seconds.
  rig.blinkIn -= dt
  if (rig.blinkIn <= 0) {
    const shut = rig.blinkIn > -0.13
    rig.face.material = faceMaterial(rig.faceKey, rig.expression, shut && rig.expression !== 'happy')
    if (!shut) rig.blinkIn = 2.5 + ((rig.breathe * 977) % 3)
  }
  const k = Math.min(1, dt * 12)
  const lerp = (o: THREE.Object3D, x: number, z = 0) => {
    o.rotation.x += (x - o.rotation.x) * k
    o.rotation.z += (z - o.rotation.z) * k
  }
  const s = Math.sin(rig.phase)
  const amp = pose === 'run' ? 0.9 : 0.55
  let bodyY = 0
  if (pose === 'sit') {
    lerp(rig.legL, -1.5, -0.05)
    lerp(rig.legR, -1.5, 0.05)
    lerp(rig.kneeL, 1.5)
    lerp(rig.kneeR, 1.5)
    lerp(rig.armL, -0.5, -0.1)
    lerp(rig.armR, -0.5, 0.1)
    lerp(rig.elbowL, -0.5)
    lerp(rig.elbowR, -0.5)
    lerp(rig.torso, -0.05)
    bodyY = -0.4
  } else if (moving) {
    lerp(rig.legL, s * amp)
    lerp(rig.legR, -s * amp)
    lerp(rig.kneeL, Math.max(0, -Math.cos(rig.phase)) * amp * 1.2)
    lerp(rig.kneeR, Math.max(0, Math.cos(rig.phase)) * amp * 1.2)
    lerp(rig.armL, -s * amp * 0.8, -0.06)
    lerp(rig.elbowL, -0.3)
    if (rig.hand.children.length > 0) {
      lerp(rig.armR, 0.05, 0.1)
      lerp(rig.elbowR, 0)
    } else {
      lerp(rig.armR, s * amp * 0.8, 0.06)
      lerp(rig.elbowR, -0.3)
    }
    lerp(rig.torso, pose === 'run' ? 0.15 : 0.03)
    bodyY = Math.abs(Math.cos(rig.phase)) * 0.035
    rig.head.rotation.y *= 1 - k
  } else {
    // Standing: weight shifts, breathing, arms relaxed (or holding a bag), now and then a look around.
    const b = Math.sin(rig.breathe * 1.6)
    lerp(rig.legL, 0, -0.025)
    lerp(rig.legR, 0, 0.025)
    lerp(rig.kneeL, 0)
    lerp(rig.kneeR, 0)
    lerp(rig.armL, 0.02 * b, -0.08)
    lerp(rig.elbowL, -0.1)
    lerp(rig.armR, pose === 'carry' ? 0.05 : -0.02 * b, 0.08)
    lerp(rig.elbowR, pose === 'carry' ? -0.05 : -0.1)
    lerp(rig.torso, 0.01 * b)
    rig.head.rotation.y = Math.sin(rig.breathe * 0.4) * 0.22
    bodyY = b * 0.006
  }
  rig.hips.position.y = 0.84 + bodyY
  if (rig.cape) rig.cape.rotation.x = 0.12 + (moving ? 0.35 + s * 0.06 : Math.sin(rig.breathe * 2) * 0.04)
}
