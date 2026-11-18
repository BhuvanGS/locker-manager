import * as THREE from 'three'

/**
 * Cables and conduit, so the robotics look wired up: rubber cables are smooth tubes through points (`cable`, and `festoon` for
 * the looped cable that hangs along a gantry rail); conduit is straight grey pipe with bends (`conduit`) ending in a junction box.
 */
const RUBBER = new THREE.MeshStandardMaterial({ color: 0x16191e, roughness: 0.55 })
const PIPE = new THREE.MeshStandardMaterial({ color: 0x8f969e, roughness: 0.45, metalness: 0.3 })
const BOX = new THREE.MeshStandardMaterial({ color: 0x9aa1a9, roughness: 0.5, metalness: 0.25 })

export function cable(points: THREE.Vector3[], radius = 0.016): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal')
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, points.length * 6), radius, 6), RUBBER)
  mesh.castShadow = true
  return mesh
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
