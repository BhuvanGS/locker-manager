import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Fewer draw calls for scenery that never moves: every mesh under `root` (except under objects marked `userData.dynamic`, Kenney
 * holders that fill in later, interactables and reach blockers, sprites, instanced and skinned meshes) is baked into `root`'s space and merged with the others that
 * share its material and shadow flags, so a whole street of kerbs, paving, benches and walls becomes a handful of meshes.
 * Run it once the scenery is built (and after `dezfight`, which only understands separate boxes). Returns how many meshes went.
 */
const TILE = 40

export function mergeStatic(root: THREE.Object3D): number {
  root.updateMatrixWorld(true)
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert()
  const groups = new Map<string, { material: THREE.Material; cast: boolean; receive: boolean; parts: THREE.Mesh[] }>()
  const visit = (o: THREE.Object3D): void => {
    if (o !== root && (o.userData.dynamic || o.userData.model || o.userData.interact || !o.visible)) return
    if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh) && !(o instanceof THREE.SkinnedMesh) && !Array.isArray(o.material)) {
      const g = o.geometry as THREE.BufferGeometry
      if (g.getAttribute('position') && g.getAttribute('normal') && o.renderOrder === 0 && !o.userData.blocker) {
        // Grouped by 40 m tiles too, so the camera can still skip what is behind it or far away.
        const c = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld)
        const key = `${o.material.uuid}|${o.castShadow}|${o.receiveShadow}|${Math.floor(c.x / TILE)}|${Math.floor(c.z / TILE)}`
        let group = groups.get(key)
        if (!group) groups.set(key, (group = { material: o.material, cast: o.castShadow, receive: o.receiveShadow, parts: [] }))
        group.parts.push(o)
      }
    }
    for (const c of [...o.children]) visit(c)
  }
  visit(root)
  let removed = 0
  const m = new THREE.Matrix4()
  for (const group of groups.values()) {
    if (group.parts.length < 2) continue
    const geos: THREE.BufferGeometry[] = []
    for (const mesh of group.parts) {
      let g = (mesh.geometry as THREE.BufferGeometry).clone()
      // The same attributes everywhere (position, normal, uv), and no index, so any mix of shapes merges.
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name)
      if (g.index) g = g.toNonIndexed()
      if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2))
      g.clearGroups()
      m.multiplyMatrices(inv, mesh.matrixWorld)
      g.applyMatrix4(m)
      geos.push(g)
    }
    const merged = mergeGeometries(geos, false)
    for (const g of geos) g.dispose()
    if (!merged) continue
    merged.computeBoundingSphere()
    const mesh = new THREE.Mesh(merged, group.material)
    mesh.castShadow = group.cast
    mesh.receiveShadow = group.receive
    mesh.matrixAutoUpdate = false
    mesh.updateMatrix()
    root.add(mesh)
    for (const part of group.parts) {
      part.parent?.remove(part)
      removed++
    }
  }
  return removed
}

/** One mesh per material for a loaded model (its parts baked into the model's space), for scenery that never moves. */
export function mergeModel(scene: THREE.Object3D): THREE.Group {
  const out = new THREE.Group()
  const holder = new THREE.Group()
  holder.add(scene)
  mergeStatic(holder)
  // Whatever could not merge (single parts) is still in `scene`; the merged meshes are on `holder`.
  for (const c of [...holder.children]) out.add(c)
  return out
}
