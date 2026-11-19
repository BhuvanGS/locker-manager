import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { metreUVs, paintedSteel, shedCladding } from './textures'

/**
 * Container terminal models, at a consistent scale: a 20-foot-style container (6.0 × 2.6 × 2.45 m: corrugated sides, corner posts,
 * top and bottom rails, corner castings, and doors with locking bars at one end), the yard gantry (a rubber-tyred gantry crane:
 * four legs on tyred bogies, two girders, a trolley, and a spreader that turns to pick boxes from the stacks or the lorries), and
 * the container lorry (in `vehicles.ts`).
 */
export const BOX = { l: 6.0, h: 2.6, w: 2.45 }
export const CONTAINER_COLOURS = [0xb91c1c, 0x1d4ed8, 0x15803d, 0xc2410c, 0x6b7280, 0x0e7490, 0xa16207, 0x7c3aed, 0x0f766e, 0xbe185d]

const mats = new Map<string, THREE.Material>()
function steel(color: number): THREE.Material {
  const key = `s${color}`
  let m = mats.get(key)
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.35 })
    mats.set(key, m)
  }
  return m
}

const geo = {
  body: metreUVs(new THREE.BoxGeometry(BOX.l - 0.12, BOX.h - 0.12, BOX.w - 0.06)),
  post: new THREE.BoxGeometry(0.14, BOX.h, 0.14),
  railL: new THREE.BoxGeometry(BOX.l, 0.12, 0.1),
  railW: new THREE.BoxGeometry(0.1, 0.12, BOX.w),
  casting: new THREE.BoxGeometry(0.18, 0.12, 0.18),
  door: new THREE.BoxGeometry(0.04, BOX.h - 0.3, BOX.w / 2 - 0.08),
  bar: new THREE.CylinderGeometry(0.025, 0.025, BOX.h - 0.4, 6),
}

/** A container (origin at its centre, length along x, doors at +x). */
export function makeContainer(colour: number): THREE.Group {
  const g = new THREE.Group()
  const body = new THREE.Mesh(geo.body, shedCladding(colour))
  body.castShadow = true
  body.receiveShadow = true
  body.name = 'body'
  g.add(body)
  const frame = steel(new THREE.Color(colour).multiplyScalar(0.55).getHex())
  for (const x of [-1, 1])
    for (const z of [-1, 1]) {
      const post = new THREE.Mesh(geo.post, frame)
      post.position.set(x * (BOX.l / 2 - 0.07), 0, z * (BOX.w / 2 - 0.07))
      g.add(post)
      for (const y of [-1, 1]) {
        const c = new THREE.Mesh(geo.casting, steel(0x2b2b2b))
        c.position.set(x * (BOX.l / 2 - 0.09), y * (BOX.h / 2 - 0.06), z * (BOX.w / 2 - 0.09))
        g.add(c)
      }
    }
  for (const y of [-1, 1]) {
    for (const z of [-1, 1]) {
      const r = new THREE.Mesh(geo.railL, frame)
      r.position.set(0, y * (BOX.h / 2 - 0.06), z * (BOX.w / 2 - 0.05))
      g.add(r)
    }
    for (const x of [-1, 1]) {
      const r = new THREE.Mesh(geo.railW, frame)
      r.position.set(x * (BOX.l / 2 - 0.05), y * (BOX.h / 2 - 0.06), 0)
      g.add(r)
    }
  }
  // The doors at +x: two leaves, each with two locking bars.
  const doorM = shedCladding(colour)
  for (const s of [-1, 1]) {
    const d = new THREE.Mesh(geo.door, doorM)
    d.position.set(BOX.l / 2 - 0.02, 0, s * (BOX.w / 4))
    g.add(d)
    for (const k of [0.3, 0.75]) {
      const b = new THREE.Mesh(geo.bar, steel(0x9ca3af))
      b.position.set(BOX.l / 2 + 0.02, 0, s * (BOX.w / 2) * k)
      g.add(b)
    }
  }
  return g
}

/** Repaint a container. */
export function setContainerColour(c: THREE.Object3D, colour: number): void {
  const body = c.getObjectByName('body') as THREE.Mesh | undefined
  if (body && body.userData.colour !== colour) {
    body.material = shedCladding(colour)
    body.userData.colour = colour
  }
}

// ------------------------------------------------------------------ the yard gantry

export type Gantry = {
  group: THREE.Group
  trolley: THREE.Object3D
  spreader: THREE.Object3D
  cables: THREE.Mesh[]
  load: THREE.Group
  /** Runways (z of the two leg pairs) and the girders' height. */
  northZ: number
  southZ: number
  topY: number
}

/**
 * A rubber-tyred gantry crane over the yard: two leg frames (one on each runway, `northZ` and `southZ`), each a pair of legs ± 3.6 m
 * either side of the gantry's x on tyred bogies joined by a sill beam; two girders across the top along z; a trolley that runs along
 * them; the operator's cab; and a yellow spreader on four ropes. `poseGantry` moves it.
 */
export function makeGantry(northZ: number, southZ: number, topY = 12.4): Gantry {
  const group = new THREE.Group()
  const yellow = paintedSteel(0xf2b51d)
  const white = paintedSteel(0xf1f5f9)
  const dark = steel(0x2b2f36)
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.95 })
  const span = Math.abs(northZ - southZ)
  const midZ = (northZ + southZ) / 2
  const part = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = group) => {
    const o = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(0.06, w / 3, h / 3, d / 3)), m)
    o.position.set(x, y, z)
    o.castShadow = true
    parent.add(o)
    return o
  }
  for (const z of [northZ, southZ]) {
    for (const s of [-1, 1]) {
      part(0.55, topY - 1.0, 0.55, yellow, s * 3.6, 1.0 + (topY - 1.0) / 2, z)
      // Bogie with two tyres.
      part(1.6, 0.5, 0.7, dark, s * 3.6, 0.95, z)
      for (const dx of [-0.5, 0.5]) {
        const t = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.45, 18), rubber)
        t.rotation.x = Math.PI / 2
        t.position.set(s * 3.6 + dx, 0.42, z)
        t.castShadow = true
        group.add(t)
      }
    }
    part(7.8, 0.5, 0.6, yellow, 0, 1.4, z) // sill beam
    part(7.8, 0.7, 0.7, yellow, 0, topY - 0.35, z) // top cross beam
  }
  // Two girders along z, with a walkway.
  for (const s of [-1, 1]) part(0.5, 0.9, span + 0.9, yellow, s * 3.3, topY + 0.2, midZ)
  part(1.0, 0.06, span, steel(0x6b7280), 3.9, topY - 0.25, midZ)
  // Diagonal braces in each leg frame.
  for (const z of [northZ, southZ]) {
    const brace = part(Math.hypot(7.2, topY - 3), 0.18, 0.18, yellow, 0, (topY + 1.6) / 2, z)
    brace.rotation.z = Math.atan2(topY - 3, 7.2)
  }
  // The operator's cab hangs under the trolley; a warning beacon on top.
  const trolley = new THREE.Group()
  part(3.2, 1.1, 2.6, white, 0, 0, 0, trolley)
  part(1.4, 1.3, 1.4, white, -1.0, -1.3, 0.9, trolley)
  part(1.42, 0.55, 0.04, new THREE.MeshStandardMaterial({ color: 0x1d2633, roughness: 0.1, metalness: 0.5 }), -1.0, -1.2, 1.62, trolley)
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffb547, emissive: 0xff9a1f, emissiveIntensity: 1.6 }))
  beacon.position.set(1.2, 0.7, 0)
  trolley.add(beacon)
  trolley.position.set(0, topY + 0.9, midZ)
  group.add(trolley)
  const cables = [-1, 1].flatMap((sx) =>
    [-1, 1].map((sz) => {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1, 5), steel(0x111111))
      c.userData.dx = sx * 2.4
      c.userData.dz = sz * 0.9
      group.add(c)
      return c
    }),
  )
  const spreader = new THREE.Group()
  part(BOX.l + 0.1, 0.22, 0.3, yellow, 0, 0, BOX.w / 2 - 0.15, spreader)
  part(BOX.l + 0.1, 0.22, 0.3, yellow, 0, 0, -BOX.w / 2 + 0.15, spreader)
  part(0.3, 0.3, BOX.w, yellow, 0, 0.05, 0, spreader)
  for (const x of [-1, 1]) part(0.3, 0.22, BOX.w, yellow, x * (BOX.l / 2 - 0.1), 0, 0, spreader)
  group.add(spreader)
  const load = makeContainer(CONTAINER_COLOURS[0]!)
  load.visible = false
  group.add(load)
  return { group, trolley, spreader, cables, load, northZ, southZ, topY }
}

/**
 * Put the gantry at `x` (the whole crane travels), its trolley at `z`, the spreader's underside at height `y`, turned `rot` (0: a box
 * lying along x, as in the stacks; π/2: along z, as on a lorry), carrying a container or not.
 */
export function poseGantry(g: Gantry, x: number, z: number, y: number, rot: number, carrying: boolean): void {
  g.group.position.x = x
  g.trolley.position.z = z
  g.spreader.position.set(0, y + 0.11, z)
  g.spreader.rotation.y = rot
  const top = g.topY + 0.35
  for (const c of g.cables) {
    const dx = c.userData.dx as number
    const dz = c.userData.dz as number
    const cx = dx * Math.cos(rot) - dz * Math.sin(rot) * 0.4
    const cz = z + dz + dx * Math.sin(rot) * 0.35
    c.position.set(cx, (top + y + 0.22) / 2, cz)
    c.scale.set(1, Math.max(0.05, top - y - 0.22), 1)
  }
  g.load.visible = carrying
  if (carrying) {
    g.load.position.set(0, y - BOX.h / 2, z)
    g.load.rotation.y = rot
  }
}
