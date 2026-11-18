import * as THREE from 'three'
import { textured } from './textures'

/** Fixtures shared by several rooms: door frames, floor signs and the panel face of a console pedestal. */

const frameMat = (): THREE.MeshStandardMaterial => textured('arm-paint', { color: 0x4b5563, colorMap: false, metalness: 0.3, repeat: 0.5 })
const casingMat = (): THREE.MeshStandardMaterial => textured('arm-paint', { color: 0x6b7280, colorMap: false, metalness: 0.3, repeat: 0.5 })
const plateMat = (): THREE.MeshStandardMaterial => textured('locker-door', { color: 0xb8c0ca, metalness: 0.3, normalScale: 0.6, repeat: 0.5 })

function box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)
  mesh.position.set(x, y, z)
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

/**
 * A steel door frame for an opening `halfWidth` either side of (`x`, `z`) and `height` tall, through a wall `wall` thick: jambs and a
 * head lining the opening, a casing (architrave) round it on both faces, and a brushed threshold plate. `along` is the way the wall
 * runs: 'x' for a wall facing ±z, 'z' for one facing ±x. Its y is the floor it stands on.
 */
export function doorFrame(along: 'x' | 'z', x: number, z: number, halfWidth: number, height: number, wall = 0.2, y = 0): THREE.Group {
  const g = new THREE.Group()
  const frame = frameMat()
  const casing = casingMat()
  const depth = wall + 0.04
  // No face may lie in the plane of a wall face (they would flicker): the jambs and head stand 4 cm proud of the opening's cut edges,
  // and the casings sit just off the wall.
  for (const s of [-1, 1]) box(0.08, height, depth, frame, s * halfWidth, height / 2, 0, g)
  box(halfWidth * 2 + 0.08, 0.1, depth, frame, 0, height - 0.01, 0, g)
  for (const face of [-1, 1]) {
    const fz = face * (wall / 2 + 0.014)
    for (const s of [-1, 1]) box(0.09, height + 0.125, 0.025, casing, s * (halfWidth + 0.08), (height + 0.125) / 2, fz, g)
    box(halfWidth * 2 + 0.25, 0.09, 0.025, casing, 0, height + 0.08, fz, g)
  }
  // The threshold plate sits on top of the floors (which are up to 3 cm thick).
  box(halfWidth * 2 - 0.08, 0.012, wall + 0.08, plateMat(), 0, 0.037, 0, g)
  g.position.set(x, y, z)
  if (along === 'z') g.rotation.y = Math.PI / 2
  return g
}

/**
 * A flat roof's finish over minX…maxX × minZ…maxZ at height `y` (the top of the building): a gravel deck, a low parapet round the edge
 * in the wall's material, and a light coping on it. `skip` leaves out edges that butt against a taller neighbour ('n', 's', 'e', 'w').
 */
export function flatRoof(minX: number, maxX: number, minZ: number, maxZ: number, y: number, wall: THREE.Material, gravel: THREE.Material, skip = ''): THREE.Group {
  const g = new THREE.Group()
  const w = maxX - minX
  const d = maxZ - minZ
  const cx = (minX + maxX) / 2
  const cz = (minZ + maxZ) / 2
  // The deck stops 1 cm inside the parapet's outer faces (a shared face would flicker); the parapet reaches down over the seam.
  const deck = box(w - 0.02, 0.06, d - 0.02, gravel, cx, y + 0.03, cz, g)
  deck.castShadow = false
  const coping = new THREE.MeshStandardMaterial({ color: 0xd6d3cd, roughness: 0.6 })
  const t = 0.18
  const ph = 0.55
  for (const [side, pw, pd, px, pz] of [
    ['n', w, t, cx, maxZ - t / 2],
    ['s', w, t, cx, minZ + t / 2],
    ['e', t, d, maxX - t / 2, cz],
    ['w', t, d, minX + t / 2, cz],
  ] as const) {
    if (skip.includes(side)) continue
    box(pw, ph + 0.1, pd, wall, px, y + (ph - 0.1) / 2, pz, g)
    box(pw + (pw > pd ? 0.04 : 0.08), 0.05, pd + (pd > pw ? 0.04 : 0.08), coping, px, y + ph + 0.025, pz, g)
  }
  return g
}

/** A rooftop air-handling unit at (x, y, z): a grey casing with a fan grille on top and a duct down into the roof. */
export function rooftopUnit(x: number, y: number, z: number, rotY = 0): THREE.Group {
  const g = new THREE.Group()
  const casing = textured('arm-paint', { color: 0xc7ccd2, colorMap: false, metalness: 0.3, repeat: 0.5 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.6 })
  box(1.6, 0.9, 1.0, casing, 0, 0.45 + 0.1, 0, g)
  box(1.7, 0.1, 1.1, dark, 0, 0.05, 0, g)
  for (const dx of [-0.4, 0.4]) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 20), dark)
    ring.position.set(dx, 1.03, 0)
    g.add(ring)
    for (let i = 0; i < 4; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.02, 0.03), casing)
      bar.rotation.y = (i * Math.PI) / 4
      bar.position.set(dx, 1.07, 0)
      g.add(bar)
    }
  }
  for (let k = 0; k < 6; k++) box(0.02, 0.5, 0.9, dark, -0.79, 0.55, 0, g).position.z = -0.38 + k * 0.15
  const duct = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.6, 12), casing)
  duct.position.set(0.95, 0.3, 0)
  g.add(duct)
  g.position.set(x, y, z)
  g.rotation.y = rotY
  return g
}

const leafMats = [0x3f6b2a, 0x4a7a30, 0x355c24].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, flatShading: true }))
const barkMat = new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.9 })
/** A tree: a trunk and a crown of a few leafy clumps (`seed` varies its shape), `h` tall, standing at (x, z). */
export function tree(x: number, z: number, h = 5, seed = 1): THREE.Group {
  const g = new THREE.Group()
  const r = (k: number) => {
    const v = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453
    return v - Math.floor(v)
  }
  const trunkH = h * 0.42
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.11 * (h / 5), 0.17 * (h / 5), trunkH, 8), barkMat)
  trunk.position.y = trunkH / 2
  trunk.castShadow = true
  g.add(trunk)
  const n = 4 + Math.floor(r(1) * 3)
  for (let i = 0; i < n; i++) {
    const s = (0.9 + r(i + 2) * 0.7) * (h / 5)
    const clump = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), leafMats[i % leafMats.length]!)
    const a = r(i + 10) * Math.PI * 2
    const rad = i === 0 ? 0 : 0.5 + r(i + 20) * 0.7
    clump.position.set(Math.cos(a) * rad * (h / 5), trunkH + 0.6 * (h / 5) + r(i + 30) * 1.2 * (h / 5), Math.sin(a) * rad * (h / 5))
    clump.scale.y = 0.85
    clump.castShadow = true
    clump.receiveShadow = true
    g.add(clump)
  }
  g.position.set(x, 0, z)
  g.rotation.y = r(99) * Math.PI * 2
  return g
}

/** A floor sign: a big yellow disc with the floor's number (G for the ground) and its name beside it. */
export function levelSign(level: number, name: string, w = 2.6, h = 0.62): THREE.Mesh {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = Math.round((1024 * h) / w)
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const H = canvas.height
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(0, 0, 1024, H)
    ctx.strokeStyle = '#fbbf24'
    ctx.lineWidth = 6
    ctx.strokeRect(8, 8, 1024 - 16, H - 16)
    ctx.fillStyle = '#fbbf24'
    ctx.beginPath()
    ctx.arc(H / 2 + 10, H / 2, H * 0.36, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#0f172a'
    ctx.font = `800 ${Math.round(H * 0.46)}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(level === 0 ? 'G' : String(level), H / 2 + 10, H / 2 + H * 0.02)
    ctx.textAlign = 'left'
    ctx.fillStyle = '#f8fafc'
    ctx.font = `800 ${Math.round(H * 0.3)}px system-ui, sans-serif`
    ctx.fillText(level === 0 ? 'GROUND FLOOR' : `FLOOR ${level}`, H + 30, H * 0.36)
    ctx.fillStyle = '#fbbf24'
    ctx.font = `700 ${Math.round(H * 0.2)}px system-ui, sans-serif`
    ctx.fillText(name, H + 32, H * 0.72)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }))
}

let hazard: THREE.CanvasTexture | null = null
function hazardTexture(): THREE.CanvasTexture {
  if (hazard) return hazard
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 32
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#facc15'
    ctx.fillRect(0, 0, 256, 32)
    ctx.fillStyle = '#111827'
    for (let x = -32; x < 256; x += 32) {
      ctx.beginPath()
      ctx.moveTo(x, 32)
      ctx.lineTo(x + 16, 32)
      ctx.lineTo(x + 32, 0)
      ctx.lineTo(x + 16, 0)
      ctx.fill()
    }
  }
  hazard = new THREE.CanvasTexture(canvas)
  hazard.colorSpace = THREE.SRGBColorSpace
  return hazard
}

/**
 * The front of a console pedestal `w` wide and `h` tall whose front face is at z = `front` (local to the pedestal's root, floor at
 * y = 0): an access door with screws and vent slots, and a hazard stripe along the kick plate.
 */
export function pedestalFace(w: number, h: number, front: number): THREE.Group {
  const g = new THREE.Group()
  const door = textured('arm-paint', { color: 0x3a414b, colorMap: false, metalness: 0.25, repeat: 0.5 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x0b0f14, roughness: 0.7 })
  const screw = new THREE.MeshStandardMaterial({ color: 0xc9ced4, roughness: 0.3, metalness: 0.7 })
  const dw = w - 0.1
  const dh = h - 0.3
  box(dw, dh, 0.012, door, 0, 0.17 + dh / 2, front + 0.006, g)
  for (let i = 0; i < 5; i++) box(dw * 0.6, 0.012, 0.004, dark, 0, 0.17 + dh - 0.08 - i * 0.035, front + 0.014, g)
  for (const sx of [-1, 1])
    for (const sy of [0, 1]) {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.006, 8), screw)
      s.rotation.x = Math.PI / 2
      s.position.set(sx * (dw / 2 - 0.03), 0.2 + sy * (dh - 0.06), front + 0.014)
      g.add(s)
    }
  const handle = box(0.012, 0.09, 0.016, screw, dw / 2 - 0.05, 0.17 + dh / 2, front + 0.02, g)
  handle.castShadow = false
  const stripe = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.09), new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.6 }))
  stripe.position.set(0, 0.07, front + 0.002)
  g.add(stripe)
  return g
}
