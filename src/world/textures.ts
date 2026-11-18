import * as THREE from 'three'

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
}

export function textured(name: string, s: Surface = {}): THREE.MeshStandardMaterial {
  const { color = 0xffffff, metalness = 0, normalScale = 1, repeat = 1, colorMap = true } = s
  const key = `${name}-${color}-${metalness}-${normalScale}-${repeat}-${colorMap}`
  let m = materials.get(key)
  if (m) return m
  const load = (file: string): THREE.Texture => {
    const t = loader.load(`${BASE}${name}/${file}.jpg`)
    t.wrapS = THREE.RepeatWrapping
    t.wrapT = THREE.RepeatWrapping
    t.repeat.setScalar(repeat)
    return t
  }
  const map = colorMap ? load('color') : null
  if (map) map.colorSpace = THREE.SRGBColorSpace
  m = new THREE.MeshStandardMaterial({
    color,
    map,
    normalMap: load('normal'),
    normalScale: new THREE.Vector2(normalScale, normalScale),
    roughnessMap: load('roughness'),
    roughness: 1,
    metalness,
  })
  materials.set(key, m)
  return m
}

/** The automation yellow: flat paint with scratches in the light. */
export const armYellow = (): THREE.MeshStandardMaterial => textured('arm-paint', { color: 0xe5a50a, metalness: 0.2, normalScale: 0.8, repeat: 0.5, colorMap: false })

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
