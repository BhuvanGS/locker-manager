import * as THREE from 'three'
import { textured } from './textures'

/**
 * Cables and conduit, so the robotics look wired up: rubber cables are smooth tubes through points (`cable`, and `festoon` for
 * the looped cable that hangs along a gantry rail); conduit is straight grey pipe with bends (`conduit`) ending in a junction box.
 */
/** Rubber cable sheathing: flat colour with the grain of a CC0 rubber (ambientCG Rubber004; there is no CC0 cable texture). */
const sheath = (color: number): THREE.MeshStandardMaterial => textured('belt-rubber', { color, colorMap: false, roughness: 0.5, normalScale: 0.6 })
const RUBBER = sheath(0x16191e)
/** Cable colours in a bundle: mostly black and grey, with the odd blue, yellow and red. */
const BUNDLE = [0x16191e, 0x3a4048, 0x1e40af, 0x16191e, 0xa16207, 0x2a2f36, 0x991b1b]
const PIPE = new THREE.MeshStandardMaterial({ color: 0x8f969e, roughness: 0.45, metalness: 0.3 })
const BOX = new THREE.MeshStandardMaterial({ color: 0x9aa1a9, roughness: 0.5, metalness: 0.25 })

export function cable(points: THREE.Vector3[], radius = 0.016, material: THREE.Material = RUBBER): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal')
  const geometry = new THREE.TubeGeometry(curve, Math.max(8, points.length * 6), radius, 6)
  // The grain tiles every 5 cm along the cable instead of stretching once over its whole length.
  const along = curve.getLength() / 0.05
  const uv = geometry.getAttribute('uv')
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * along)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = true
  return mesh
}

/**
 * A bundle of `count` cables lying side by side on the floor along `route` (x, z points), then climbing the wall into a power box
 * whose bottom is at (`riser.x`, `riser.top`, `riser.z`). `y` is the floor height. Each cable wanders a little, like real cable runs.
 */
export function floorBundle(route: readonly (readonly [number, number])[], riser: { x: number; z: number; top: number }, count = 5, y = 0): THREE.Group {
  const group = new THREE.Group()
  const r = 0.013
  for (let i = 0; i < count; i++) {
    const off = (i - (count - 1) / 2) * (2 * r + 0.006)
    const lift = y + r + 0.034 + (i % 2) * 0.006 // above the thickest floor (the warehouse's)
    const pts: THREE.Vector3[] = []
    for (let k = 0; k < route.length; k++) {
      const [x, z] = route[k]!
      const [px, pz] = route[Math.max(0, k - 1)]!
      const [nx, nz] = route[Math.min(route.length - 1, k + 1)]!
      let dx = nx - px
      let dz = nz - pz
      const len = Math.hypot(dx, dz) || 1
      dx /= len
      dz /= len
      pts.push(new THREE.Vector3(x - dz * off, lift, z + dx * off))
      if (k < route.length - 1) {
        // Points along the stretch, each nudged sideways a few millimetres.
        const [bx, bz] = route[k + 1]!
        const seg = Math.hypot(bx - x, bz - z)
        const steps = Math.floor(seg / 0.9)
        for (let s = 1; s < steps; s++) {
          const t = s / steps
          const wob = Math.sin(i * 2.3 + k * 1.7 + s * 1.3) * 0.012
          const sx = (bx - x) / seg
          const sz = (bz - z) / seg
          pts.push(new THREE.Vector3(x + (bx - x) * t - sz * (off + wob), lift, z + (bz - z) * t + sx * (off + wob)))
        }
      }
    }
    // Up the wall into the box (the bundle narrows as it climbs).
    const last = pts[pts.length - 1]!
    const rx = riser.x + (last.x - route[route.length - 1]![0]) * 0.5
    const rz = riser.z + (last.z - route[route.length - 1]![1]) * 0.5
    pts.push(new THREE.Vector3(rx, y + 0.12, rz), new THREE.Vector3(rx, y + riser.top * 0.55, rz), new THREE.Vector3(rx, y + riser.top + 0.05, rz))
    group.add(cable(pts, r, sheath(BUNDLE[i % BUNDLE.length]!)))
  }
  return group
}

/** A cable looping along a rail from (x0, y, z) to (x1, y, z): clipped every `loop` metres, sagging `sag` between clips. */
export function festoon(x0: number, x1: number, y: number, z: number, loop = 0.75, sag = 0.2): THREE.Mesh {
  const n = Math.max(1, Math.round(Math.abs(x1 - x0) / loop))
  const step = (x1 - x0) / n
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= n; i++) {
    pts.push(new THREE.Vector3(x0 + i * step, y, z))
    if (i < n) pts.push(new THREE.Vector3(x0 + (i + 0.5) * step, y - sag, z))
  }
  return cable(pts)
}

/** Straight conduit through `points` (each corner rounded a little), with a junction box at the end. */
export function conduit(points: THREE.Vector3[], radius = 0.022): THREE.Group {
  const group = new THREE.Group()
  const path = new THREE.CurvePath<THREE.Vector3>()
  for (let i = 1; i < points.length; i++) path.add(new THREE.LineCurve3(points[i - 1]!, points[i]!))
  const pipe = new THREE.Mesh(new THREE.TubeGeometry(path, points.length * 4, radius, 8), PIPE)
  pipe.castShadow = true
  group.add(pipe)
  for (const p of points.slice(1, -1)) {
    const joint = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.25, 8, 6), PIPE)
    joint.position.copy(p)
    group.add(joint)
  }
  const end = points[points.length - 1]!
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.14), BOX)
  box.position.copy(end)
  box.castShadow = true
  group.add(box)
  return group
}
