import * as THREE from 'three'
import { mergeModel } from './mergeStatic'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'

/**
 * Low-poly CC0 kits from Kenney (kenney.nl: Car Kit, Watercraft Kit, City Kits) in public/models/kenney/<kit>/<name>.glb, sharing
 * each kit's palette texture (see public/models/CREDITS.md). Each model loads once; placements are clones sharing geometry and
 * materials. (People are procedural: world/people.ts.)
 */
export type KenneyKit = 'cars' | 'boats' | 'city' | 'street'


const loader = new GLTFLoader()
const cache = new Map<string, Promise<GLTF>>()
const ready = new Map<string, GLTF>()

function prepare(gltf: GLTF): GLTF {
  gltf.scene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true
      o.receiveShadow = true
      const m = o.material as THREE.MeshStandardMaterial
      // The palette textures are tiny swatches: keep them crisp.
      if (m.map && m.map.image && (m.map.image as { width?: number }).width! <= 64) {
        m.map.magFilter = THREE.NearestFilter
        m.map.anisotropy = 1
      }
      m.roughness = Math.max(m.roughness, 0.6)
      m.metalness = Math.min(m.metalness, 0.2)
    }
  })
  return gltf
}

export function loadKenney(kit: KenneyKit, name: string): Promise<GLTF> {
  const key = `${kit}/${name}`
  let p = cache.get(key)
  if (!p) {
    if (typeof document === 'undefined') return Promise.reject(new Error('no loader outside a browser'))
    const url = `models/kenney/${key}.glb`
    p = loader.loadAsync(`${import.meta.env.BASE_URL}${url}`).then((g) => {
      prepare(g)
      // Buildings and street furniture never move: merge their parts (vehicles and boats keep theirs, for the wheels).
      if (kit === 'city' || kit === 'street') g.scene = mergeModel(g.scene) as unknown as THREE.Group
      ready.set(key, g)
      return g
    })
    // A missing model must never break the game: log it and leave the placement empty.
    p.catch((e: unknown) => console.warn('model failed to load', key, e))
    cache.set(key, p)
  }
  return p
}

/** The loaded model now, or null while it is still loading. */
export function kenneyNow(kit: KenneyKit, name: string): GLTF | null {
  return ready.get(`${kit}/${name}`) ?? null
}


export type KenneyPlacement = {
  x: number
  y?: number
  z: number
  rotY?: number
  /** Uniform scale (Kenney units are about 1 m for people and 0.6 m for cars). */
  scale?: number
  /** Or: scale so the model is this long along its longest horizontal side. */
  length?: number
  /** Or: scale so the model is this tall. */
  height?: number
  /** Keep the model's own origin on x and z (default: centre its bounding box there). */
  keepOrigin?: boolean
}

/** Scale a fresh clone to the placement and stand it on its lowest point, centred on x and z. */
export function fit(copy: THREE.Object3D, p: Omit<KenneyPlacement, 'x' | 'z' | 'y' | 'rotY'>, centre = true): void {
  copy.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(copy)
  const size = box.getSize(new THREE.Vector3())
  const s = p.scale ?? (p.length ? p.length / Math.max(size.x, size.z, 1e-3) : p.height ? p.height / Math.max(size.y, 1e-3) : 1)
  copy.scale.setScalar(s)
  const c = box.getCenter(new THREE.Vector3())
  copy.position.set(centre ? -c.x * s : 0, -box.min.y * s, centre ? -c.z * s : 0)
}

/** A group at the placement that fills with a clone of the model once it has loaded. */
export function kenney(kit: KenneyKit, name: string, p: KenneyPlacement): THREE.Group {
  const holder = new THREE.Group()
  holder.position.set(p.x, p.y ?? 0, p.z)
  holder.rotation.y = p.rotY ?? 0
  holder.userData.model = `${kit}/${name}`
  void loadKenney(kit, name)
    .then((g) => {
      const copy = g.scene.clone(true)
      fit(copy, p, !p.keepOrigin)
      holder.add(copy)
    })
    .catch(() => undefined)
  return holder
}
