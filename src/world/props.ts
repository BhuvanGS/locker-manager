import * as THREE from 'three'
import { buildBlocky, type BlockyName } from './blockyProps'

/**
 * 3D props: the game's own blocky models (`blockyProps.ts`), built in code, in place of the photo-real glTF models they replaced.
 * They are decoration only: callers add a collider where the player should not walk through one.
 */
export type PropName = BlockyName

export type PropPlacement = {
  x: number
  y?: number
  z: number
  /** Turn about y (radians). */
  rotY?: number
  /** Scale the model so it is this tall (metres); otherwise its own size. */
  height?: number
  /** Faint self-glow in the model's own colours, for the warehouse (lit by glowing surfaces, not lights). */
  glow?: number
}

/** A group at the placement holding the model, standing on `y` (its lowest point is put there) and centred on x and z. */
export function prop(name: PropName, p: PropPlacement): THREE.Group {
  const holder = new THREE.Group()
  holder.position.set(p.x, p.y ?? 0, p.z)
  holder.rotation.y = p.rotY ?? 0
  const model = buildBlocky(name)
  // Sized and centred on its body: parts marked `noBounds` (wall brackets) stick out behind without moving it.
  const box = new THREE.Box3()
  model.updateMatrixWorld(true)
  model.traverse((o) => {
    if (o instanceof THREE.Mesh && !o.userData.noBounds) box.expandByObject(o)
  })
  const size = box.getSize(new THREE.Vector3())
  const s = p.height ? p.height / Math.max(size.y, 1e-3) : 1
  model.scale.setScalar(s)
  const centre = box.getCenter(new THREE.Vector3())
  model.position.set(-centre.x * s, -box.min.y * s, -centre.z * s)
  if (p.glow) {
    model.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      const m = (o.material as THREE.MeshStandardMaterial).clone()
      m.emissive.copy(m.color)
      m.emissiveIntensity = Math.max(m.emissiveIntensity, p.glow!)
      o.material = m
    })
  }
  holder.add(model)
  return holder
}
