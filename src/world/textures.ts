import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

/**
 * Image-textured materials. Each set lives in public/textures/<name>/ as color.jpg, normal.jpg and roughness.jpg (CC0, from
 * ambientCG; see public/textures/CREDITS.md). Materials are cached like `mat()`, so each set loads once however many meshes use it.
 */
const loader = new THREE.TextureLoader()
const BASE = `${import.meta.env.BASE_URL}textures/`
const materials = new Map<string, THREE.MeshStandardMaterial>()

export type Surface = {
  /** Tint multiplied into the colour map. */
  color?: number
  metalness?: number
  normalScale?: number
  /** Texture repeats per face (below 1 shows a part of it, for small parts). */
  repeat?: number
  /** false: keep a flat `color` and use only the surface detail (normal and roughness maps). */
  colorMap?: boolean
  /** Brightens the tint, to cancel out a dark colour map (1 / its average linear brightness keeps `color` on average). */
  gain?: number
  /** 0…1: fades the colour map towards its average grey `soften.grey` (lower contrast, same brightness). */
  soften?: { amount: number; grey: string }
  /** The colour map's average linear colour: `color` is divided by it per channel, so the surface averages out at `color`. */
  average?: readonly [number, number, number]
  /** Faint self-glow in the surface's own colours (the warehouse: its roof shades the sun, so it glows instead of using lights). */
  glow?: number
  /** A fixed roughness instead of the set's roughness map. */
  roughness?: number
}

export function textured(name: string, s: Surface = {}): THREE.MeshStandardMaterial {
  const { color = 0xffffff, metalness = 0, normalScale = 1, repeat = 1, colorMap = true, gain = 1, soften, average, glow = 0, roughness } = s
  const key = `${name}-${color}-${metalness}-${normalScale}-${repeat}-${colorMap}-${gain}-${soften?.amount}-${!!average}-${glow}-${roughness}`
  let m = materials.get(key)
  if (m) return m
  const load = (file: string): THREE.Texture => {
    const t = loader.load(`${BASE}${name}/${file}.jpg`)
    t.wrapS = THREE.RepeatWrapping
    t.wrapT = THREE.RepeatWrapping
    t.repeat.setScalar(repeat)
    return t
  }
  const map = !colorMap ? null : soften ? softened(name, soften.amount, soften.grey) : load('color')
  if (map) {
    map.colorSpace = THREE.SRGBColorSpace
    map.wrapS = THREE.RepeatWrapping
    map.wrapT = THREE.RepeatWrapping
    map.repeat.setScalar(repeat)
  }
  const tint = new THREE.Color(color).multiplyScalar(gain)
  if (average && map) tint.setRGB(tint.r / average[0], tint.g / average[1], tint.b / average[2])
  m = new THREE.MeshStandardMaterial({
    color: tint,
    map,
    // The glow follows the texture: tint × map averages out at `color`, so it is as bright as a flat `lit()` glow.
    emissive: glow ? tint : 0x000000,
    emissiveMap: glow ? map : null,
    emissiveIntensity: glow,
    normalMap: load('normal'),
    normalScale: new THREE.Vector2(normalScale, normalScale),
    roughnessMap: roughness === undefined ? load('roughness') : null,
    roughness: roughness ?? 1,
    metalness,
  })
  materials.set(key, m)
  return m
}

const softenedMaps = new Map<string, THREE.CanvasTexture>()
function softened(name: string, amount: number, grey: string): THREE.CanvasTexture {
  const key = `${name}-${amount}`
  const cached = softenedMaps.get(key)
  if (cached) return cached // shared, not cloned: a clone would not redraw when the image arrives
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  const texture = new THREE.CanvasTexture(canvas)
  if (ctx) {
    ctx.fillStyle = grey
    ctx.fillRect(0, 0, 512, 512)
    withImage(name, (img) => {
      ctx.globalAlpha = 1
      ctx.drawImage(img, 0, 0, 512, 512)
      ctx.globalAlpha = amount
      ctx.fillStyle = grey
      ctx.fillRect(0, 0, 512, 512)
      ctx.globalAlpha = 1
      texture.needsUpdate = true
    })
  }
  softenedMaps.set(key, texture)
  return texture
}

/** Floors and furniture, keeping each one's old flat colour on average (see `average`). Floor boxes need `metreUVs`. */
const AVG = {
  tiles: [0.456, 0.347, 0.25],
  concrete: [0.279, 0.246, 0.171],
  carpet: [0.034, 0.044, 0.065],
  wood: [0.198, 0.125, 0.074],
} as const
/** Lobby floor tiles (about 40 cm each). */
export const tileFloor = (color: number): THREE.MeshStandardMaterial => textured('floor-tiles', { color, average: AVG.tiles, repeat: 1 / 2.4, normalScale: 0.8 })
/** Grey concrete for the staff side, storage, halls and the warehouse (tiled every 2.5 m). */
export const concreteFloor = (color: number, glow = 0): THREE.MeshStandardMaterial =>
  textured('floor-concrete', { color, average: AVG.concrete, repeat: 0.4, normalScale: 0.6, glow, soften: { amount: 0.4, grey: 'rgb(145,136,115)' } })
export const carpetFloor = (color: number): THREE.MeshStandardMaterial => textured('floor-carpet', { color, average: AVG.carpet, repeat: 1 })
export const woodMat = (color: number): THREE.MeshStandardMaterial => textured('wood', { color, average: AVG.wood, repeat: 1, normalScale: 0.6 })
/** Leather keeps its flat colour (the texture is almost black, so only its grain is used). */
export const leatherMat = (color: number): THREE.MeshStandardMaterial => textured('chair-leather', { color, colorMap: false, repeat: 2, roughness: 0.55 })

/** The automation yellow: flat paint with scratches in the light. */
export const armYellow = (): THREE.MeshStandardMaterial => textured('arm-paint', { color: 0xe5a50a, metalness: 0.2, normalScale: 0.8, repeat: 0.5, colorMap: false })

/** Painted plaster in a wall's own colour, tiled every 2 m. Use it on boxes whose UVs are in metres (`metreUVs`). */
export const wallMat = (color: number): THREE.MeshStandardMaterial =>
  textured('wall-plaster', { color, gain: 3.1, repeat: 0.5, normalScale: 0.8, soften: { amount: 0.6, grey: 'rgb(155,154,150)' } })

/**
 * Rewrites a box's UVs in metres, so a texture keeps its size on every face of every box (a long wall and a short pier match)
 * instead of stretching once across each face. Boxes from `new THREE.BoxGeometry(w, h, d)` only (one segment per side).
 */
export function metreUVs(geometry: THREE.BoxGeometry): THREE.BoxGeometry {
  const { width: w, height: h, depth: d } = geometry.parameters
  // Faces in order +x, −x, +y, −y, +z, −z, four vertices each; each face's (u, v) span in metres.
  const spans = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]] as const
  const uv = geometry.getAttribute('uv')
  for (let i = 0; i < uv.count; i++) {
    const [su, sv] = spans[Math.floor(i / 4)]!
    uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv)
  }
  uv.needsUpdate = true
  return geometry
}

/** A ceiling light panel: a brushed rim around a glowing prismatic diffuser (drawn here, used as both colour and glow). */
const panels = new Map<string, THREE.MeshStandardMaterial>()
let panelTextures: { map: THREE.CanvasTexture; glow: THREE.CanvasTexture } | null = null
function panelCanvas(glow: boolean): THREE.CanvasTexture {
  const W = 280
  const H = 80
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const rim = 7
    ctx.fillStyle = glow ? '#000000' : '#a3aab3'
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = glow ? '#ffffff' : '#f8fafc'
    ctx.fillRect(rim, rim, W - rim * 2, H - rim * 2)
    // The prismatic diffuser: a fine grid of little squares, slightly darker at their edges.
    ctx.strokeStyle = glow ? 'rgba(0,0,0,0.16)' : 'rgba(100,116,139,0.18)'
    ctx.lineWidth = 1
    for (let x = rim; x < W - rim; x += 6) {
      ctx.beginPath()
      ctx.moveTo(x + 0.5, rim)
      ctx.lineTo(x + 0.5, H - rim)
      ctx.stroke()
    }
    for (let y = rim; y < H - rim; y += 6) {
      ctx.beginPath()
      ctx.moveTo(rim, y + 0.5)
      ctx.lineTo(W - rim, y + 0.5)
      ctx.stroke()
    }
    // The diffuser's inner shadow line just inside the rim.
    ctx.strokeStyle = glow ? 'rgba(0,0,0,0.45)' : 'rgba(71,85,105,0.5)'
    ctx.lineWidth = 2
    ctx.strokeRect(rim + 1, rim + 1, W - rim * 2 - 2, H - rim * 2 - 2)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}
export function lightPanel(emissive = 0xfff8e7, intensity = 1.25): THREE.MeshStandardMaterial {
  const key = `${emissive}-${intensity}`
  let m = panels.get(key)
  if (m) return m
  panelTextures ??= { map: panelCanvas(false), glow: panelCanvas(true) }
  m = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: panelTextures.map,
    emissive,
    emissiveMap: panelTextures.glow,
    emissiveIntensity: intensity,
    roughness: 0.6,
    metalness: 0.1,
  })
  panels.set(key, m)
  return m
}

/**
 * Window glass: faintly tinted, with smudges (a CC0 smear map as roughness) that show where it reflects the room. The reflection
 * comes from `setGlassEnvironment`, which the Engine calls once it has a renderer; only glass gets it, so nothing else changes look.
 */
const glasses = new Map<string, THREE.MeshStandardMaterial>()
let smear: THREE.Texture | null = null
let environment: THREE.Texture | null = null
export function glassMat(opacity: number, color = 0xbcd7e6): THREE.MeshStandardMaterial {
  const key = `${opacity}-${color}`
  let m = glasses.get(key)
  if (m) return m
  smear ??= loader.load(`${BASE}glass-smear/roughness.jpg`)
  m = new THREE.MeshStandardMaterial({
    color,
    transparent: true,
    opacity,
    roughness: 0.4,
    roughnessMap: smear,
    metalness: 0.3,
    envMap: environment,
    envMapIntensity: 1.6,
    depthWrite: false,
  })
  glasses.set(key, m)
  return m
}

export function setGlassEnvironment(renderer: THREE.WebGLRenderer): void {
  if (environment) return
  const pmrem = new THREE.PMREMGenerator(renderer)
  environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  pmrem.dispose()
  for (const m of glasses.values()) {
    m.envMap = environment
    m.needsUpdate = true
  }
}

/** Console and kiosk pedestals: brushed steel, only slightly metallic (with nothing to reflect, metal renders black). */
export const consoleSteel = (): THREE.MeshStandardMaterial => textured('locker-door', { color: 0x9aa3ae, metalness: 0.15, normalScale: 0.6, repeat: 0.5 })

/** The robots' dark parts: scuffed black plastic. */
export const armDark = (): THREE.MeshStandardMaterial => textured('till-plastic', { color: 0x8a94a3, metalness: 0.3, repeat: 0.5 })

/** Calls `draw` with the colour image of a texture set once it has loaded (straight away if it already has). */
const images = new Map<string, { img: HTMLImageElement; waiting: ((img: HTMLImageElement) => void)[] }>()
export function withImage(name: string, draw: (img: HTMLImageElement) => void): void {
  let entry = images.get(name)
  if (!entry) {
    const img = new Image()
    const e = { img, waiting: [] as ((img: HTMLImageElement) => void)[] }
    img.onload = () => {
      for (const f of e.waiting) f(img)
      e.waiting.length = 0
    }
    img.src = `${BASE}${name}/color.jpg`
    images.set(name, e)
    entry = e
  }
  if (entry.img.complete && entry.img.naturalWidth > 0) draw(entry.img)
  else entry.waiting.push(draw)
}
