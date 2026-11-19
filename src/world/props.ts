import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/**
 * 3D props: CC0 glTF models from Poly Haven in public/models/<name>/model.gltf (textures shrunk to 512 px; see
 * public/models/CREDITS.md). Each model loads once; every placement is a clone sharing its geometry and materials.
 * They are decoration only: callers add a collider where the player should not walk through one.
 */
export type PropName =
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

const loader = new GLTFLoader()
const models = new Map<PropName, Promise<THREE.Object3D>>()

function model(name: PropName): Promise<THREE.Object3D> {
  let m = models.get(name)
  if (!m) {
    m = loader.loadAsync(`${import.meta.env.BASE_URL}models/${name}/model.gltf`).then((gltf) => {
      gltf.scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.castShadow = true
          o.receiveShadow = true
          // None of these are glass, but some (the plastic crate) are marked as blended, which hides walls in the
          // wrong order: draw them opaque, cutting out any alpha, and double-sided for thin one-sided walls.
          const m = o.material as THREE.Material
          m.transparent = false
          m.alphaTest = 0.5
          m.side = THREE.DoubleSide
        }
      })
      return gltf.scene
    })
    models.set(name, m)
  }
  return m
}

export type PropPlacement = {
  x: number
  y?: number
  z: number
  /** Turn about y (radians). */
  rotY?: number
  /** Scale the model so it is this tall (metres); otherwise its real size. */
  height?: number
  /** Faint self-glow in the model's own colours, for the warehouse (lit by glowing surfaces, not lights). */
  glow?: number
}

/**
 * A group at the placement that fills with the model once it has loaded. The model stands on `y` (its lowest point is
 * put there) and is centred on x and z.
 */
export function prop(name: PropName, p: PropPlacement): THREE.Group {
  const holder = new THREE.Group()
  holder.position.set(p.x, p.y ?? 0, p.z)
  holder.rotation.y = p.rotY ?? 0
  void model(name).then((scene) => {
    const copy = scene.clone(true)
    const box = new THREE.Box3().setFromObject(copy)
    const size = box.getSize(new THREE.Vector3())
    const s = p.height ? p.height / Math.max(size.y, 1e-3) : 1
    copy.scale.setScalar(s)
    const centre = box.getCenter(new THREE.Vector3())
    copy.position.set(-centre.x * s, -box.min.y * s, -centre.z * s)
    if (p.glow) {
      copy.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return
        const m = (o.material as THREE.MeshStandardMaterial).clone()
        m.emissive.set(0xffffff)
        m.emissiveMap = m.map
        m.emissiveIntensity = p.glow!
        o.material = m
      })
    }
    holder.add(copy)
  })
  return holder
}
