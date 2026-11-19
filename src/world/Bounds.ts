import * as THREE from 'three'
import type { Box } from './Gates'

/**
 * The edge of the little world, kept cheap: a handful of big low-poly shapes and invisible walls. Rocky headlands close both ends of
 * the beach, a line of green hills stands behind the town to the north and past the port road to the south, and walls (colliders only)
 * run round the playable area behind the buildings, so you cannot walk off into empty country. A dozen meshes sharing one geometry.
 */
export const BOUNDS = {
  /** North: the beach end, then (east of the plaza) behind the back street. */
  northBeachZ: 46,
  northZ: 34,
  /** Where the north line steps from the beach end to behind the back street. */
  stepX: -41,
  eastX: 135,
  /** South: behind the warehouse district east of `southStepX`, and past the port at `southFarZ` west of it. */
  southZ: -100,
  southFarZ: -150,
  southStepX: -10,
  /** Out at sea, beyond the wading fence. */
  seaX: -75,
} as const

const rock = new THREE.MeshStandardMaterial({ color: 0x8c8478, roughness: 1, flatShading: true })
const green = new THREE.MeshStandardMaterial({ color: 0x6a8f4e, roughness: 1, flatShading: true })

let lump: THREE.BufferGeometry | null = null
/** A rough lump: an icosahedron with its corners pushed in and out (the same for every hill; each is scaled differently). */
function lumpGeometry(): THREE.BufferGeometry {
  if (lump) return lump
  const g = new THREE.IcosahedronGeometry(1, 1)
  const p = g.getAttribute('position')
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const y = p.getY(i)
    const z = p.getZ(i)
    const k = 1 + 0.18 * Math.sin(x * 5.1 + z * 3.3) + 0.1 * Math.cos(y * 7.7 + x * 2.1)
    p.setXYZ(i, x * k, y * k, z * k)
  }
  g.computeVertexNormals()
  lump = g
  return g
}

export function buildBounds(root: THREE.Object3D): Box[] {
  const geo = lumpGeometry()
  const add = (m: THREE.Material, x: number, z: number, sx: number, sy: number, sz: number, rot = 0) => {
    const mesh = new THREE.Mesh(geo, m)
    mesh.position.set(x, -sy * 0.25, z)
    mesh.scale.set(sx, sy, sz)
    mesh.rotation.y = rot
    mesh.castShadow = true
    mesh.receiveShadow = true
    root.add(mesh)
  }
  // Headlands: rock running out into the sea at each end of the beach, grass on top inland.
  for (const z of [BOUNDS.northBeachZ + 7, BOUNDS.southFarZ - 6]) {
    add(rock, -86, z, 16, 10, 9, 0.3)
    add(rock, -72, z + 1, 13, 13, 10, -0.2)
    add(green, -58, z - 1, 13, 11, 10, 0.5)
    add(green, -46, z + 2, 12, 9, 9, 0.1)
  }
  // Hills behind the town (north) and past the port and the warehouse district (south).
  for (let i = 0; i < 7; i++) add(green, -30 + i * 26, 68 + (i % 2) * 8, 22, 16 + (i % 3) * 5, 14, i * 0.7)
  for (let i = 0; i < 6; i++) add(green, -62 + i * 30, -178 - (i % 2) * 8, 24, 15 + (i % 3) * 4, 14, i * 0.9)

  // The walls (colliders only), 6 m high.
  const B = BOUNDS
  const H = 3
  const wall = (x0: number, z0: number, x1: number, z1: number): Box => ({
    x: (x0 + x1) / 2,
    y: H,
    z: (z0 + z1) / 2,
    hx: Math.max(0.5, Math.abs(x1 - x0) / 2),
    hy: H,
    hz: Math.max(0.5, Math.abs(z1 - z0) / 2),
  })
  return [
    wall(B.seaX, B.northBeachZ, B.stepX, B.northBeachZ),
    wall(B.stepX, B.northZ, B.stepX, B.northBeachZ),
    wall(B.stepX, B.northZ, B.eastX, B.northZ),
    wall(B.eastX, B.southZ, B.eastX, B.northZ),
    wall(B.southStepX, B.southZ, B.eastX, B.southZ),
    wall(B.southStepX, B.southFarZ, B.southStepX, B.southZ),
    wall(B.seaX, B.southFarZ, B.southStepX, B.southFarZ),
  ]
}
