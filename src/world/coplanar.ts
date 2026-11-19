import * as THREE from 'three'

/**
 * Stops z-fighting (flickering stripes where two surfaces share a plane): finds axis-aligned boxes in different materials whose faces
 * lie in the same plane, face the same way and overlap, and moves the smaller one out along that face by `EPS` (3 mm, invisible). Run it
 * after building the world and again whenever an upgrade adds geometry (`Engine.dezfight`). Moving parts are left alone (anything under a
 * root marked `userData.dynamic`), and so are hidden, transparent and see-through proxy meshes.
 */
const EPS = 0.003
const SNAP = 500 // faces within 2 mm of each other count as the same plane

type Face = { mesh: THREE.Mesh; mn: number[]; mx: number[]; axis: number; sign: 1 | -1; area: number }

export function dezfight(root: THREE.Object3D): number {
  root.updateMatrixWorld(true)
  const planes = new Map<string, Face[]>()
  const box = new THREE.Box3()
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    const g = o.geometry as THREE.BufferGeometry & { type: string }
    if (g.type !== 'BoxGeometry' && g.type !== 'RoundedBoxGeometry') return
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    if (mats.some((m) => m.visible === false || m.transparent)) return
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.userData.dynamic) return
    // Axis-aligned only (no rotation about any axis).
    const e = o.matrixWorld.elements
    if (Math.abs(e[1]!) + Math.abs(e[2]!) + Math.abs(e[4]!) + Math.abs(e[6]!) + Math.abs(e[8]!) + Math.abs(e[9]!) > 1e-4) return
    if (!g.boundingBox) g.computeBoundingBox()
    box.copy(g.boundingBox!).applyMatrix4(o.matrixWorld)
    const mn = [box.min.x, box.min.y, box.min.z]
    const mx = [box.max.x, box.max.y, box.max.z]
    for (let axis = 0; axis < 3; axis++) {
      const u = (axis + 1) % 3
      const v = (axis + 2) % 3
      const area = (mx[u]! - mn[u]!) * (mx[v]! - mn[v]!)
      for (const sign of [-1, 1] as const) {
        const at = sign < 0 ? mn[axis]! : mx[axis]!
        const key = `${axis}${sign}${Math.round(at * SNAP)}`
        let list = planes.get(key)
        if (!list) planes.set(key, (list = []))
        list.push({ mesh: o, mn, mx, axis, sign, area })
      }
    }
  })
  const moved = new Set<THREE.Mesh>()
  const dir = new THREE.Vector3()
  const inv = new THREE.Matrix4()
  for (const list of planes.values()) {
    if (list.length < 2 || list.length > 800) continue
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!
        const b = list[j]!
        if (a.mesh === b.mesh || a.mesh.material === b.mesh.material) continue
        const u = (a.axis + 1) % 3
        const v = (a.axis + 2) % 3
        const ou = Math.min(a.mx[u]!, b.mx[u]!) - Math.max(a.mn[u]!, b.mn[u]!)
        const ov = Math.min(a.mx[v]!, b.mx[v]!) - Math.max(a.mn[v]!, b.mn[v]!)
        if (ou <= 0.005 || ov <= 0.005) continue
        // Move the smaller face's box out, once.
        // (Each box moves at most once, ever: later runs, after upgrades, never push it further.)
        const pick = a.area <= b.area ? a : b
        const other = pick === a ? b : a
        const f = pick.mesh.userData.dezfought && !other.mesh.userData.dezfought ? other : pick
        if (moved.has(f.mesh) || f.mesh.userData.dezfought) continue
        moved.add(f.mesh)
        f.mesh.userData.dezfought = true
        dir.set(0, 0, 0).setComponent(f.axis, f.sign * EPS)
        const parent = f.mesh.parent
        if (parent) {
          inv.copy(parent.matrixWorld).invert()
          dir.transformDirection(inv).multiplyScalar(EPS / Math.max(1e-6, worldScale(parent)))
        }
        f.mesh.position.add(dir)
        f.mesh.updateMatrixWorld(true)
      }
  }
  return moved.size
}

function worldScale(o: THREE.Object3D): number {
  const s = new THREE.Vector3()
  o.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), s)
  return (Math.abs(s.x) + Math.abs(s.y) + Math.abs(s.z)) / 3 || 1
}
