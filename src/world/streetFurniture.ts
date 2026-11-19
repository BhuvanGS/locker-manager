import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

/**
 * Blocky street furniture in the world's own style (soft-edged blocks, flat colours, like the people and the vehicles): a bench, a
 * bin, a fire hydrant, a picnic table, a café chair and table with a parasol, a stop sign and an ice-cream kiosk. Each returns a group
 * standing on y = 0 at its origin; the caller places it and adds any collider. Fronts face +z.
 */
const mats = new Map<number, THREE.MeshStandardMaterial>()
function m(color: number, roughness = 0.75, metalness = 0): THREE.MeshStandardMaterial {
  const key = color * 7 + Math.round(roughness * 10) + metalness * 1000
  let out = mats.get(key)
  if (!out) {
    out = new THREE.MeshStandardMaterial({ color, roughness, metalness })
    mats.set(key, out)
  }
  return out
}

const geos = new Map<string, THREE.BufferGeometry>()
function block(g: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const key = `${w}|${h}|${d}`
  let geo = geos.get(key)
  if (!geo) {
    geo = new RoundedBoxGeometry(w, h, d, 2, Math.min(0.03, w / 3, h / 3, d / 3))
    geos.set(key, geo)
  }
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(x, y, z)
  mesh.castShadow = true
  mesh.receiveShadow = true
  g.add(mesh)
  return mesh
}

const WOOD = 0xb7793f
const WOOD_DARK = 0x8a5a2e
const IRON = 0x2f3640

/** A park bench 1.7 m long: three seat slats, two back slats, and chunky iron end frames. Sit at its origin + 0.12 m towards +z. */
export function blockBench(): THREE.Group {
  const g = new THREE.Group()
  const wood = m(WOOD, 0.8)
  const iron = m(IRON, 0.55, 0.3)
  for (const z of [-0.14, 0.02, 0.18]) block(g, 1.7, 0.06, 0.14, wood, 0, 0.45, z)
  for (const y of [0.64, 0.82]) {
    const s = block(g, 1.7, 0.13, 0.05, wood, 0, y, -0.27 - (y - 0.64) * 0.25)
    s.rotation.x = -0.18
  }
  for (const x of [-0.72, 0.72]) {
    block(g, 0.08, 0.42, 0.08, iron, x, 0.21, 0.16)
    block(g, 0.08, 0.86, 0.08, iron, x, 0.43, -0.24)
    block(g, 0.08, 0.06, 0.5, iron, x, 0.4, -0.03)
    block(g, 0.1, 0.04, 0.56, iron, x, 0.02, -0.03)
  }
  return g
}

/** A street bin: a green box with a darker hood, a slot and a little base. */
export function blockBin(color = 0x2f6b3f): THREE.Group {
  const g = new THREE.Group()
  const body = m(color, 0.6, 0.2)
  const dark = m(new THREE.Color(color).multiplyScalar(0.6).getHex(), 0.6, 0.2)
  block(g, 0.44, 0.06, 0.44, dark, 0, 0.03, 0)
  block(g, 0.5, 0.72, 0.5, body, 0, 0.42, 0)
  block(g, 0.56, 0.14, 0.56, dark, 0, 0.84, 0)
  block(g, 0.3, 0.06, 0.02, m(0x111111, 0.8), 0, 0.84, 0.28)
  // A band with a recycling mark.
  block(g, 0.52, 0.06, 0.52, m(0xe5e7eb, 0.6), 0, 0.62, 0)
  return g
}

/** A fire hydrant: a stocky red post with a white-banded cap, a nut on top and two side outlets. */
export function blockHydrant(): THREE.Group {
  const g = new THREE.Group()
  const red = m(0xd62f2f, 0.5, 0.15)
  const cap = m(0xf1f5f9, 0.5, 0.15)
  const brass = m(0xc9a24a, 0.4, 0.6)
  block(g, 0.36, 0.08, 0.36, red, 0, 0.04, 0)
  block(g, 0.26, 0.46, 0.26, red, 0, 0.31, 0)
  block(g, 0.32, 0.07, 0.32, cap, 0, 0.56, 0)
  block(g, 0.24, 0.12, 0.24, red, 0, 0.65, 0)
  block(g, 0.08, 0.06, 0.08, brass, 0, 0.74, 0)
  for (const s of [-1, 1]) {
    block(g, 0.12, 0.1, 0.1, red, s * 0.18, 0.38, 0)
    block(g, 0.03, 0.11, 0.11, brass, s * 0.25, 0.38, 0)
  }
  block(g, 0.12, 0.12, 0.08, red, 0, 0.36, 0.16)
  return g
}

/** A picnic table: a plank top and two benches on chunky A-frames, along x. */
export function blockPicnicTable(): THREE.Group {
  const g = new THREE.Group()
  const wood = m(WOOD, 0.85)
  const dark = m(WOOD_DARK, 0.85)
  for (const z of [-0.27, -0.09, 0.09, 0.27]) block(g, 1.8, 0.06, 0.16, wood, 0, 0.75, z)
  for (const z of [-0.68, 0.68]) block(g, 1.8, 0.06, 0.26, wood, 0, 0.45, z)
  for (const x of [-0.7, 0.7]) {
    block(g, 0.08, 0.06, 1.6, dark, x, 0.4, 0)
    for (const s of [-1, 1]) {
      const leg = block(g, 0.08, 0.86, 0.08, dark, x, 0.38, s * 0.35)
      leg.rotation.x = s * 0.5
    }
  }
  return g
}

/** A café chair (seat facing +z). */
export function blockChair(color = 0xe85d3f): THREE.Group {
  const g = new THREE.Group()
  const seat = m(color, 0.6)
  const frame = m(0xd4d4d8, 0.4, 0.5)
  block(g, 0.44, 0.06, 0.42, seat, 0, 0.45, 0)
  block(g, 0.44, 0.36, 0.05, seat, 0, 0.7, -0.2)
  for (const x of [-0.19, 0.19]) for (const z of [-0.18, 0.18]) block(g, 0.04, 0.44, 0.04, frame, x, 0.22, z)
  return g
}

/** A square café table with a blocky parasol (a stepped canopy on a pole). */
export function blockCafeTable(canopy = 0xf5c542): THREE.Group {
  const g = new THREE.Group()
  const top = m(0xf8fafc, 0.5)
  const frame = m(0x52525b, 0.5, 0.4)
  block(g, 0.8, 0.05, 0.8, top, 0, 0.74, 0)
  block(g, 0.08, 0.72, 0.08, frame, 0, 0.36, 0)
  block(g, 0.5, 0.04, 0.5, frame, 0, 0.02, 0)
  block(g, 0.04, 1.6, 0.04, frame, 0, 1.5, 0)
  const cloth = m(canopy, 0.85)
  block(g, 2.0, 0.08, 2.0, cloth, 0, 2.2, 0)
  block(g, 1.3, 0.1, 1.3, cloth, 0, 2.3, 0)
  block(g, 0.6, 0.12, 0.6, m(0xffffff, 0.85), 0, 2.4, 0)
  return g
}

/** A stop sign on a post (the sign faces +z). */
export function blockStopSign(): THREE.Group {
  const g = new THREE.Group()
  block(g, 0.07, 2.3, 0.07, m(0x9ca3af, 0.5, 0.5), 0, 1.15, 0)
  const tex = signTexture('STOP', '#c81e1e', '#ffffff', true)
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.36, 8, Math.PI / 8), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }))
  face.position.set(0, 2.15, 0.045)
  const back = new THREE.Mesh(new THREE.CircleGeometry(0.36, 8, Math.PI / 8), m(0x9ca3af, 0.6))
  back.rotation.y = Math.PI
  back.position.set(0, 2.15, 0.04)
  g.add(face, back)
  return g
}

/** A little ice-cream kiosk (2.6 × 2.2 m): a striped awning over a serving hatch at the front, and a giant cone on the roof. */
export function blockKiosk(): THREE.Group {
  const g = new THREE.Group()
  const wall = m(0xf3e7d3, 0.8)
  const trim = m(0x3aa6b9, 0.6)
  block(g, 2.6, 0.12, 2.2, m(0x7a7f87, 0.8), 0, 0.06, 0)
  block(g, 2.5, 2.3, 2.1, wall, 0, 1.27, 0)
  block(g, 2.7, 0.18, 2.3, trim, 0, 2.5, 0)
  // The hatch: a dark opening with a counter.
  block(g, 1.7, 0.9, 0.04, m(0x1f2937, 0.4), 0, 1.5, 1.05)
  block(g, 1.9, 0.08, 0.36, trim, 0, 1.02, 1.15)
  block(g, 2.5, 0.3, 0.04, trim, 0, 0.3, 1.06)
  // Striped awning.
  for (let i = 0; i < 7; i++) {
    const s = block(g, 0.36, 0.05, 0.9, m(i % 2 === 0 ? 0xf472b6 : 0xffffff, 0.85), -1.08 + i * 0.36, 2.2, 1.45)
    s.rotation.x = 0.35
  }
  // The cone.
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.9, 6), m(0xd9a35b, 0.8))
  cone.rotation.x = Math.PI
  cone.position.set(0, 3.05, 0)
  const scoop = block(g, 0.6, 0.5, 0.6, m(0xf9a8d4, 0.7), 0, 3.7, 0)
  scoop.rotation.y = 0.4
  block(g, 0.4, 0.3, 0.4, m(0xfef3c7, 0.7), 0.05, 4.05, 0.02)
  g.add(cone)
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.36), new THREE.MeshStandardMaterial({ map: signTexture('GELATO', '#3aa6b9', '#ffffff'), roughness: 0.6 }))
  sign.position.set(0, 2.5, 1.16)
  g.add(sign)
  return g
}

/** A beach hut: a little timber shed in one bright colour with white trim, a door and a pitched roof (front at +z). */
export function blockBeachHut(color: number): THREE.Group {
  const g = new THREE.Group()
  const paint = m(color, 0.7)
  const white = m(0xf8fafc, 0.7)
  block(g, 2.0, 0.2, 2.2, m(0x8a6a48, 0.9), 0, 0.1, 0)
  block(g, 1.8, 2.0, 1.8, paint, 0, 1.2, 0)
  block(g, 0.8, 1.6, 0.04, white, 0, 1.0, 0.91)
  block(g, 0.7, 1.5, 0.05, paint, 0, 1.0, 0.93)
  for (const s of [-1, 1]) {
    const r = block(g, 1.25, 0.08, 2.1, white, s * 0.5, 2.48, 0)
    r.rotation.z = -s * 0.6
  }
  block(g, 1.8, 0.5, 0.06, paint, 0, 2.4, 0.9)
  return g
}

/** A blocky palm: a leaning trunk of stacked blocks and a crown of long flat leaves. */
export function blockPalm(h = 4.2, seed = 1): THREE.Group {
  const g = new THREE.Group()
  const bark = m(0x9b7b55, 0.9)
  const leaf = m(0x4f9a3a, 0.8)
  const n = 7
  let x = 0
  for (let i = 0; i < n; i++) {
    x += 0.04 * Math.sin(seed + i * 0.5)
    block(g, 0.3 - i * 0.015, h / n + 0.02, 0.3 - i * 0.015, bark, x, (i + 0.5) * (h / n), 0)
  }
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + seed
    const holder = new THREE.Group()
    holder.position.set(x, h, 0)
    holder.rotation.y = a
    block(holder, 0.42, 0.05, 1.7, leaf, 0, -0.2, 0.8).rotation.x = 0.35
    g.add(holder)
  }
  block(g, 0.34, 0.3, 0.34, m(0x6b4f2e, 0.8), x, h - 0.1, 0)
  return g
}

function signTexture(text: string, bg: string, fg: string, octagon = false): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = octagon ? 128 : 320
  c.height = octagon ? 128 : 64
  const g = c.getContext('2d')
  if (g) {
    g.fillStyle = bg
    g.fillRect(0, 0, c.width, c.height)
    if (octagon) {
      g.strokeStyle = '#ffffff'
      g.lineWidth = 6
      g.strokeRect(8, 8, 112, 112)
    }
    g.fillStyle = fg
    g.font = `bold ${octagon ? 38 : 40}px sans-serif`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(text, c.width / 2, c.height / 2 + 2)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/**
 * A beach deck chair (front at +z): a wooden frame with a striped canvas sling, seat at sitting height (the sit pose puts the hips
 * 0.45 m up), a reclined back and armrests. Someone sitting in it stands at its origin moved 0.1 m forward.
 */
export function blockDeckChair(color: number): THREE.Group {
  const g = new THREE.Group()
  const wood = m(0xc89a62, 0.8)
  const cloth = m(color, 0.85)
  const white = m(0xf8fafc, 0.85)
  for (const x of [-0.29, 0.29]) {
    block(g, 0.05, 0.45, 0.05, wood, x, 0.22, 0.22)
    block(g, 0.05, 0.4, 0.05, wood, x, 0.2, -0.22)
    block(g, 0.06, 0.05, 0.6, wood, x, 0.58, -0.02)
    block(g, 0.05, 0.15, 0.05, wood, x, 0.5, 0.24)
    const rail = block(g, 0.05, 0.75, 0.05, wood, x, 0.72, -0.33)
    rail.rotation.x = -0.35
  }
  // Seat and back slings, in stripes.
  for (let i = 0; i < 4; i++) {
    const x = -0.21 + i * 0.14
    const c = i % 2 === 0 ? cloth : white
    block(g, 0.14, 0.04, 0.5, c, x, 0.42, 0)
    const back = block(g, 0.14, 0.62, 0.04, c, x, 0.75, -0.33)
    back.rotation.x = -0.35
  }
  return g
}
