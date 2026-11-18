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
