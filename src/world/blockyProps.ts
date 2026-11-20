import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { blockBench, blockBin, blockChair, blockHydrant, blockPicnicTable } from './streetFurniture'

/**
 * The game's own blocky versions of the props (in place of the photo-real glTF models): soft-edged blocks in flat colours, like the
 * people, vehicles and street furniture. Each builder returns a group at roughly real size standing on y = 0; `prop()` scales it to
 * the height asked for and centres it. Fronts face +z.
 */
const mats = new Map<string, THREE.MeshStandardMaterial>()
function m(color: number, roughness = 0.75, metalness = 0, emissive = 0, intensity = 0): THREE.MeshStandardMaterial {
  const key = `${color}|${roughness}|${metalness}|${emissive}|${intensity}`
  let out = mats.get(key)
  if (!out) {
    out = new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive, emissiveIntensity: intensity })
    mats.set(key, out)
  }
  return out
}

function block(g: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, r = 0.025): THREE.Mesh {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 1, Math.min(r, w / 3, h / 3, d / 3)), mat)
  mesh.position.set(x, y, z)
  mesh.castShadow = true
  mesh.receiveShadow = true
  g.add(mesh)
  return mesh
}

/** An electrical box on a wall: grey casing, a door with a seam and handle, a yellow warning label, a conduit stub on top. */
function powerBox(): THREE.Group {
  const g = new THREE.Group()
  const grey = m(0x8d949c, 0.55, 0.3)
  block(g, 0.5, 0.62, 0.3, grey, 0, 0.31, 0)
  block(g, 0.44, 0.56, 0.02, m(0x9ea5ad, 0.5, 0.3), 0, 0.31, 0.155)
  block(g, 0.02, 0.5, 0.01, m(0x5b6168, 0.6), 0, 0.31, 0.168, 0.004)
  block(g, 0.03, 0.09, 0.03, m(0x2a2d33, 0.5), 0.15, 0.32, 0.18, 0.01)
  // A yellow warning triangle with a black bolt.
  const tri = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.01, 3).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), m(0xf2c230, 0.6))
  tri.rotation.z = Math.PI / 2
  tri.position.set(-0.11, 0.46, 0.168)
  g.add(tri)
  const bolt = block(g, 0.014, 0.07, 0.01, m(0x111111, 0.6), -0.11, 0.455, 0.175, 0.003)
  bolt.rotation.z = 0.45
  // The conduit stub on top, and two struts back to the wall (not counted when the prop is centred).
  block(g, 0.08, 0.12, 0.08, grey, 0, 0.68, 0)
  for (const x of [-0.18, 0.18]) {
    const strut = block(g, 0.04, 0.7, 0.16, m(0x5f6670, 0.5, 0.4), x, 0.31, -0.22, 0.008)
    strut.userData.noBounds = true
  }
  return g
}

/** A cardboard box: tan, a strip of tape over the top and down the front, a printed arrow. */
function cardboardBox(): THREE.Group {
  const g = new THREE.Group()
  block(g, 0.5, 0.36, 0.4, m(0xc3955a, 0.9), 0, 0.18, 0, 0.03)
  const tape = m(0xe9d9a8, 0.6)
  block(g, 0.508, 0.012, 0.09, tape, 0, 0.362, 0, 0.004)
  block(g, 0.508, 0.1, 0.012, tape, 0, 0.31, 0.202, 0.004)
  block(g, 0.05, 0.08, 0.008, m(0x5a4128, 0.9), -0.15, 0.17, 0.202, 0.003)
  block(g, 0.08, 0.025, 0.008, m(0x5a4128, 0.9), -0.15, 0.22, 0.202, 0.003)
  return g
}

/** A fire extinguisher: a red body with a white label band, a black valve head and handle, and a hose down the side. */
function extinguisher(): THREE.Group {
  const g = new THREE.Group()
  const red = m(0xd12a22, 0.45, 0.2)
  block(g, 0.18, 0.46, 0.18, red, 0, 0.23, 0, 0.06)
  block(g, 0.185, 0.12, 0.185, m(0xf3f4f6, 0.6), 0, 0.26, 0, 0.05)
  const black = m(0x1c1d21, 0.6)
  block(g, 0.08, 0.06, 0.08, black, 0, 0.49, 0)
  block(g, 0.16, 0.025, 0.04, black, 0.03, 0.535, 0, 0.01)
  block(g, 0.03, 0.3, 0.03, black, 0.1, 0.33, 0.04, 0.012)
  block(g, 0.05, 0.05, 0.05, black, 0.1, 0.17, 0.04, 0.015)
  return g
}

/** A potted plant: a terracotta pot and a heap of blocky leaves. */
function pottedPlant(): THREE.Group {
  const g = new THREE.Group()
  block(g, 0.42, 0.36, 0.42, m(0xb5633c, 0.85), 0, 0.18, 0, 0.05)
  block(g, 0.46, 0.06, 0.46, m(0xa35634, 0.85), 0, 0.37, 0, 0.03)
  block(g, 0.38, 0.03, 0.38, m(0x4a3524, 1), 0, 0.395, 0, 0.01)
  const greens = [0x3f8a3a, 0x4f9e43, 0x357a33]
  const leaves: [number, number, number, number][] = [[0, 0.75, 0, 0.36], [0.14, 0.6, 0.08, 0.28], [-0.13, 0.62, -0.06, 0.3], [0.02, 0.98, 0.04, 0.26], [-0.06, 0.52, 0.14, 0.22], [0.1, 0.84, -0.12, 0.24]]
  leaves.forEach(([x, y, z, s], i) => {
    const leaf = block(g, s, s * 0.9, s, m(greens[i % 3]!, 0.85), x, y, z, s * 0.2)
    leaf.rotation.y = i * 0.6
  })
  return g
}

/** A leather armchair: a deep seat, a high back, chunky arms, short dark feet. */
function armchair(): THREE.Group {
  const g = new THREE.Group()
  const leather = m(0x6b3a22, 0.55)
  const dark = m(0x2a1a10, 0.6)
  block(g, 0.78, 0.18, 0.74, leather, 0, 0.36, 0.02, 0.06)
  block(g, 0.6, 0.1, 0.58, m(0x7d4529, 0.55), 0, 0.5, 0.06, 0.05)
  block(g, 0.78, 0.5, 0.18, leather, 0, 0.66, -0.3, 0.06)
  for (const s of [-1, 1]) block(g, 0.14, 0.32, 0.74, leather, s * 0.34, 0.57, 0.02, 0.05)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) block(g, 0.07, 0.27, 0.07, dark, sx * 0.32, 0.135, sz * 0.28, 0.015)
  return g
}

/** A storage cart: two grey shelves on posts, a push handle, four castors. */
function storageCart(): THREE.Group {
  const g = new THREE.Group()
  const steel = m(0x5f6670, 0.5, 0.4)
  for (const y of [0.22, 0.62]) block(g, 0.9, 0.05, 0.55, m(0x7b838d, 0.5, 0.35), 0, y, 0)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) block(g, 0.04, 0.62, 0.04, steel, sx * 0.43, 0.43, sz * 0.25, 0.01)
  block(g, 0.04, 0.3, 0.5, steel, -0.47, 0.82, 0, 0.01)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) block(g, 0.08, 0.1, 0.05, m(0x1c1d21, 0.7), sx * 0.4, 0.05, sz * 0.23, 0.02)
  block(g, 0.4, 0.22, 0.3, m(0xc3955a, 0.9), 0.15, 0.36, 0, 0.02)
  return g
}

/** A grey steel office desk with a drawer pedestal. */
function officeDesk(): THREE.Group {
  const g = new THREE.Group()
  const grey = m(0x7d858f, 0.55, 0.3)
  block(g, 1.3, 0.05, 0.7, m(0x5b636d, 0.5, 0.25), 0, 0.735, 0)
  block(g, 0.42, 0.7, 0.62, grey, 0.4, 0.35, 0)
  for (const y of [0.18, 0.4, 0.6]) block(g, 0.12, 0.02, 0.01, m(0x2a2d33, 0.5), 0.4, y, 0.315, 0.004)
  block(g, 0.05, 0.7, 0.62, grey, -0.6, 0.35, 0)
  block(g, 1.2, 0.3, 0.03, grey, -0.05, 0.55, -0.31)
  return g
}

/** An arm desk lamp: a heavy base, two arm sections and a shade glowing warm underneath. */
function deskLamp(): THREE.Group {
  const g = new THREE.Group()
  const black = m(0x1f2226, 0.5, 0.3)
  block(g, 0.16, 0.03, 0.16, black, 0, 0.015, 0, 0.01)
  const a = block(g, 0.025, 0.25, 0.025, black, 0, 0.14, 0, 0.008)
  a.rotation.z = 0.25
  const b = block(g, 0.025, 0.22, 0.025, black, -0.08, 0.33, 0, 0.008)
  b.rotation.z = -0.9
  block(g, 0.12, 0.08, 0.1, m(0xe3a92b, 0.5, 0.2), -0.2, 0.38, 0, 0.02)
  block(g, 0.08, 0.01, 0.07, m(0xfff3d0, 0.4, 0, 0xffe2a8, 1.8), -0.2, 0.335, 0, 0.004)
  return g
}

/** A white plastic chair (the monobloc). */
function plasticChair(): THREE.Group {
  return blockChair(0xeeeeea)
}

/** A sea buoy: a red and white stacked float with a little light on top. */
function buoy(): THREE.Group {
  const g = new THREE.Group()
  block(g, 0.9, 0.5, 0.9, m(0xd12a22, 0.5), 0, 0.25, 0, 0.15)
  block(g, 0.6, 0.4, 0.6, m(0xf3f4f6, 0.55), 0, 0.7, 0, 0.1)
  block(g, 0.4, 0.4, 0.4, m(0xd12a22, 0.5), 0, 1.1, 0, 0.08)
  block(g, 0.06, 0.4, 0.06, m(0x1f2226, 0.6), 0, 1.5, 0, 0.02)
  block(g, 0.12, 0.12, 0.12, m(0xfff3d0, 0.3, 0, 0xffd27a, 2), 0, 1.75, 0, 0.04)
  return g
}

export type BlockyName =
  | 'potted_plant_02'
  | 'cardboard_box_01'
  | 'korean_fire_extinguisher_01'
  | 'modern_arm_chair_01'
  | 'industrial_storage_cart'
  | 'power_box_01'
  | 'metal_office_desk'
  | 'desk_lamp_arm_01'
  | 'plastic_monobloc_chair_01'
  | 'fire_hydrant'
  | 'metal_trash_can'
  | 'painted_wooden_bench'
  | 'ocean_buoy'
  | 'wooden_picnic_table'

const BUILDERS: Record<BlockyName, () => THREE.Group> = {
  potted_plant_02: pottedPlant,
  cardboard_box_01: cardboardBox,
  korean_fire_extinguisher_01: extinguisher,
  modern_arm_chair_01: armchair,
  industrial_storage_cart: storageCart,
  power_box_01: powerBox,
  metal_office_desk: officeDesk,
  desk_lamp_arm_01: deskLamp,
  plastic_monobloc_chair_01: plasticChair,
  fire_hydrant: blockHydrant,
  metal_trash_can: () => blockBin(0x5f6670),
  painted_wooden_bench: blockBench,
  ocean_buoy: buoy,
  wooden_picnic_table: blockPicnicTable,
}

export function buildBlocky(name: BlockyName): THREE.Group {
  return BUILDERS[name]()
}
