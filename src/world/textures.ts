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
  ceiling: [0.905, 0.905, 0.905],
  cladding: [0.209, 0.402, 0.468],
  grass: [0.13, 0.231, 0.025],
  sand: [0.462, 0.342, 0.165],
  gravel: [0.147, 0.15, 0.136],
  roof: [0.376, 0.089, 0.093],
  plate: [0.159, 0.125, 0.093],
  cardboard: [0.485, 0.275, 0.074],
  road: [0.053, 0.053, 0.05],
  yard: [0.188, 0.188, 0.188],
} as const
/** Lobby floor tiles (about 40 cm each). */
export const tileFloor = (color: number): THREE.MeshStandardMaterial => textured('floor-tiles', { color, average: AVG.tiles, repeat: 1 / 2.4, normalScale: 0.8 })
/** Grey concrete for the staff side, storage, halls and the warehouse (tiled every 2.5 m). */
export const concreteFloor = (color: number, glow = 0): THREE.MeshStandardMaterial =>
  textured('floor-concrete', { color, average: AVG.concrete, repeat: 0.4, normalScale: 0.6, glow, soften: { amount: 0.4, grey: 'rgb(145,136,115)' } })
export const carpetFloor = (color: number): THREE.MeshStandardMaterial => textured('floor-carpet', { color, average: AVG.carpet, repeat: 1 })
export const woodMat = (color: number): THREE.MeshStandardMaterial => textured('wood', { color, average: AVG.wood, repeat: 1, normalScale: 0.6 })
/** Suspended ceiling tiles (about 60 cm each), in the ceiling's own colour. Ceiling boxes need `metreUVs`. */
export const ceilingMat = (color: number): THREE.MeshStandardMaterial => textured('ceiling-tiles', { color, average: AVG.ceiling, repeat: 1 / 3.6, normalScale: 0.5 })
/** The warehouse: steel cladding (walls), ribbed roof sheet, diamond plate (vault), cardboard (crates), asphalt (road and yard). */
export const shedCladding = (color: number, glow = 0): THREE.MeshStandardMaterial =>
  textured('shed-cladding', { color, average: AVG.cladding, repeat: 0.5, metalness: 0.25, glow })
export const shedRoof = (color: number, glow = 0): THREE.MeshStandardMaterial =>
  textured('shed-roof', { color, average: AVG.roof, repeat: 0.5, metalness: 0.25, glow })
/** Steel wire mesh (cut out by its opacity map), for cages. */
let mesh: THREE.MeshStandardMaterial | null = null
export function wireMesh(): THREE.MeshStandardMaterial {
  if (mesh) return mesh
  const load = (file: string): THREE.Texture => {
    const t = loader.load(`${BASE}wire-mesh/${file}.jpg`)
    t.wrapS = THREE.RepeatWrapping
    t.wrapT = THREE.RepeatWrapping
    t.repeat.setScalar(2)
    return t
  }
  const map = load('color')
  map.colorSpace = THREE.SRGBColorSpace
  // Blended, not cut out: the thin wires would vanish at a distance with alphaTest (the mipmaps average them away).
  mesh = new THREE.MeshStandardMaterial({ map, alphaMap: load('opacity'), transparent: true, depthWrite: false, normalMap: load('normal'), metalness: 0.6, roughness: 0.45, side: THREE.DoubleSide, emissive: 0x555555, emissiveMap: map, emissiveIntensity: 0.35 })
  return mesh
}
export const diamondPlate = (color: number, glow = 0): THREE.MeshStandardMaterial =>
  textured('diamond-plate', { color, average: AVG.plate, repeat: 1, metalness: 0.35, glow })
export const cardboardMat = (color: number): THREE.MeshStandardMaterial => textured('cardboard', { color, average: AVG.cardboard, repeat: 1.5 })
export const roadAsphalt = (color: number): THREE.MeshStandardMaterial => textured('road-asphalt', { color, average: AVG.road, repeat: 0.25 })
export const yardAsphalt = (color: number): THREE.MeshStandardMaterial => textured('yard-asphalt', { color, average: AVG.yard, repeat: 0.25 })
/** Painted steel (rack uprights and beams): flat colour with scratches. */
export const paintedSteel = (color: number): THREE.MeshStandardMaterial => textured('arm-paint', { color, colorMap: false, metalness: 0.3, repeat: 0.5 })

/** The lawn round the buildings (the ground's UVs are in metres: tiled every 4 m). */
export const grassMat = (color: number): THREE.MeshStandardMaterial => textured('grass', { color, average: AVG.grass, repeat: 0.25, normalScale: 0.6 })
/** Beach sand (UVs in metres: tiled every 3 m). */
export const sandMat = (color: number): THREE.MeshStandardMaterial => textured('sand', { color, average: AVG.sand, repeat: 1 / 3, normalScale: 0.7 })
/** Gravel ballast on the flat roofs. */
export const roofGravel = (color: number): THREE.MeshStandardMaterial => textured('roof-gravel', { color, average: AVG.gravel, repeat: 1.2, normalScale: 0.6, soften: { amount: 0.45, grey: 'rgb(108,110,103)' } })




/** The automation yellow: flat paint with scratches in the light. */
export const armYellow = (): THREE.MeshStandardMaterial => textured('arm-paint', { color: 0xe5a50a, metalness: 0.2, normalScale: 0.8, repeat: 0.5, colorMap: false })

/** Painted plaster in a wall's own colour, tiled every 2 m. Use it on boxes whose UVs are in metres (`metreUVs`). */
/**
 * Walls: painted block-work, drawn here (blocky, like the rest of the world, rather than a photo texture). Blocks 0.4 × 0.2 m in running
 * bond with thin mortar lines and a faint shade per block; the colour tints it, so each wall keeps its colour. One tile covers
 * 1.6 × 0.8 m on boxes with `metreUVs`. Own material per colour.
 */
let blockTexture: THREE.CanvasTexture | null = null
function wallBlocks(): THREE.CanvasTexture | null {
  if (blockTexture || typeof document === 'undefined') return blockTexture
  const W = 512
  const H = 256
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')
  if (g) {
    const rand = (k: number) => Math.abs(Math.sin(k * 91.7 + 3.1) * 43758.5453) % 1
    g.fillStyle = '#c9c9c9'
    g.fillRect(0, 0, W, H)
    const bw = W / 4
    const bh = H / 4
    for (let row = 0; row < 4; row++) {
      const shift = row % 2 === 0 ? 0 : bw / 2
      for (let col = -1; col < 5; col++) {
        const x = col * bw + shift
        const v = Math.round(238 + (rand(row * 13 + col * 7) - 0.5) * 14)
        g.fillStyle = `rgb(${v},${v},${v})`
        g.fillRect(x + 2, row * bh + 2, bw - 4, bh - 4)
        // A slight bevel: light along the top edge, shade along the bottom.
        g.fillStyle = 'rgba(255,255,255,0.35)'
        g.fillRect(x + 2, row * bh + 2, bw - 4, 2)
        g.fillStyle = 'rgba(0,0,0,0.06)'
        g.fillRect(x + 2, row * bh + bh - 5, bw - 4, 3)
      }
    }
  }
  blockTexture = new THREE.CanvasTexture(c)
  blockTexture.colorSpace = THREE.SRGBColorSpace
  blockTexture.wrapS = blockTexture.wrapT = THREE.RepeatWrapping
  blockTexture.repeat.set(1 / 1.6, 1 / 0.8)
  blockTexture.anisotropy = 8
  return blockTexture
}
const walls = new Map<number, THREE.MeshStandardMaterial>()
export const wallMat = (color: number): THREE.MeshStandardMaterial => {
  let m = walls.get(color)
  if (!m) {
    const map = wallBlocks()
    // The blocks average about 0.86 of white (linear), so lift the tint to keep the wall's colour.
    m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(map ? 1.15 : 1), map, roughness: 0.9 })
    walls.set(color, m)
  }
  return m
}

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

/**
 * Lake water: deep blue-green, glossy, reflecting the sky (registered with the glass so `setGlassEnvironment` reaches it), with a
 * ripple normal map drawn here. Scroll `waterRipples().offset` to make it move.
 */
let ripples: THREE.CanvasTexture | null = null
export function waterRipples(): THREE.CanvasTexture {
  if (ripples) return ripples
  const N = 256
  const canvas = document.createElement('canvas')
  canvas.width = N
  canvas.height = N
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const img = ctx.createImageData(N, N)
    const h = (x: number, y: number) => {
      const u = (x / N) * Math.PI * 2
      const v = (y / N) * Math.PI * 2
      return Math.sin(u * 3 + Math.sin(v * 2) * 1.5) * 0.5 + Math.sin(v * 5 + u * 2) * 0.3 + Math.sin((u - v) * 7) * 0.15
    }
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dx = h(x + 1, y) - h(x - 1, y)
        const dy = h(x, y + 1) - h(x, y - 1)
        const len = Math.hypot(dx * 2, dy * 2, 1)
        const i = (y * N + x) * 4
        img.data[i] = ((-dx * 2) / len) * 127 + 128
        img.data[i + 1] = ((-dy * 2) / len) * 127 + 128
        img.data[i + 2] = (1 / len) * 127 + 128
        img.data[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
  }
  ripples = new THREE.CanvasTexture(canvas)
  ripples.wrapS = THREE.RepeatWrapping
  ripples.wrapT = THREE.RepeatWrapping
  ripples.repeat.set(6, 6)
  return ripples
}

export function waterMat(): THREE.MeshStandardMaterial {
  let m = glasses.get('water')
  if (m) return m
  m = new THREE.MeshStandardMaterial({
    color: 0x1a5a70,
    roughness: 0.2,
    metalness: 0.15,
    transparent: true,
    opacity: 0.9,
    normalMap: waterRipples(),
    normalScale: new THREE.Vector2(0.35, 0.35),
    envMap: environment,
    envMapIntensity: 0.65,
    depthWrite: false,
  })
  glasses.set('water', m)
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

/**
 * Paving slabs for the footpaths, drawn here: square slabs (`slab` m) with dark joints, a slightly different shade per slab and fine
 * speckle, on boxes with `metreUVs`. `style: 'brick'` lays small herringbone-ish block pavers instead (the seafront plaza). Its own
 * material per colour and style (never `mat()`'s shared cache).
 */
const pavings = new Map<string, THREE.MeshStandardMaterial>()
export function pavingMat(color: number, style: 'slab' | 'brick' = 'slab'): THREE.MeshStandardMaterial {
  const key = `${color}-${style}`
  let m = pavings.get(key)
  if (m) return m
  // One tile of texture covers 2.4 m: 4 × 4 slabs of 0.6 m, or 12 × 24 pavers of 0.2 × 0.1 m.
  const SPAN = 2.4
  let map: THREE.CanvasTexture | null = null
  if (typeof document !== 'undefined') {
    const S = 512
    const c = document.createElement('canvas')
    c.width = c.height = S
    const g = c.getContext('2d')
    if (g) {
      const rand = (k: number) => Math.abs(Math.sin(k * 12.9898 + 4.1) * 43758.5453) % 1
      g.fillStyle = '#6f6c66'
      g.fillRect(0, 0, S, S)
      const shade = (k: number, base: number) => {
        const v = Math.round(base + (rand(k) - 0.5) * 22)
        return `rgb(${v + 4},${v + 2},${v - 2})`
      }
      if (style === 'slab') {
        const n = 4
        const p = S / n
        for (let i = 0; i < n; i++)
          for (let j = 0; j < n; j++) {
            g.fillStyle = shade(i * 7 + j * 13, 196)
            g.fillRect(i * p + 3, j * p + 3, p - 6, p - 6)
            // A soft bevel: lighter top-left edge, darker bottom-right.
            g.fillStyle = 'rgba(255,255,255,0.10)'
            g.fillRect(i * p + 3, j * p + 3, p - 6, 3)
            g.fillStyle = 'rgba(0,0,0,0.10)'
            g.fillRect(i * p + 3, j * p + p - 6, p - 6, 3)
          }
      } else {
        // Stretcher-bond pavers in alternating directions per 0.4 m block (a basket weave): reads as block paving from eye height.
        const b = S / 6
        for (let i = 0; i < 6; i++)
          for (let j = 0; j < 6; j++) {
            const along = (i + j) % 2 === 0
            for (let k = 0; k < 2; k++) {
              g.fillStyle = shade(i * 31 + j * 17 + k * 5, 184)
              if (along) g.fillRect(i * b + 2, j * b + k * (b / 2) + 2, b - 4, b / 2 - 4)
              else g.fillRect(i * b + k * (b / 2) + 2, j * b + 2, b / 2 - 4, b - 4)
            }
          }
      }
      // Speckle and a few stains.
      for (let k = 0; k < 2600; k++) {
        const v = rand(k + 99) > 0.5 ? 255 : 0
        g.fillStyle = `rgba(${v},${v},${v},${0.04 + rand(k + 7) * 0.06})`
        g.fillRect(rand(k * 3 + 1) * S, rand(k * 5 + 2) * S, 1.5, 1.5)
      }
      for (let k = 0; k < 6; k++) {
        const grad = g.createRadialGradient(rand(k + 300) * S, rand(k + 400) * S, 0, rand(k + 300) * S, rand(k + 400) * S, 30 + rand(k) * 40)
        grad.addColorStop(0, 'rgba(60,55,50,0.12)')
        grad.addColorStop(1, 'rgba(60,55,50,0)')
        g.fillStyle = grad
        g.fillRect(0, 0, S, S)
      }
    }
    map = new THREE.CanvasTexture(c)
    map.colorSpace = THREE.SRGBColorSpace
    map.wrapS = map.wrapT = THREE.RepeatWrapping
    map.repeat.setScalar(1 / SPAN)
    map.anisotropy = 8
  }
  // The canvas averages about 0.75 of white (sRGB ~190), so lift the tint to keep the surface near `color`.
  const tint = new THREE.Color(color).multiplyScalar(map ? 1.9 : 1)
  m = new THREE.MeshStandardMaterial({ color: tint, map, roughness: 0.92 })
  pavings.set(key, m)
  return m
}
