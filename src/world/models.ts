import * as THREE from 'three'
import type { Appearance, ItemCategory } from '../sim/types'

/**
 * Procedural low-poly models. Materials are cached by colour so hundreds of items/customers share a
 * handful of materials (later milestones can swap these for GLB models behind the same functions).
 */
const materialCache = new Map<string, THREE.MeshStandardMaterial>()

export function mat(color: number, roughness = 0.7, metalness = 0): THREE.MeshStandardMaterial {
  const key = `${color}-${roughness}-${metalness}`
  let m = materialCache.get(key)
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness, metalness })
    materialCache.set(key, m)
  }
  return m
}

function box(w: number, h: number, d: number, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
  mesh.position.set(x, y, z)
  mesh.castShadow = true
  return mesh
}

function shade(color: number, factor: number): number {
  const c = new THREE.Color(color)
  c.multiplyScalar(factor)
  return c.getHex()
}

// ------------------------------------------------------------------ items

/** A stored item. Origin at the bottom centre. */
export function makeItemMesh(category: ItemCategory, color: number): THREE.Group {
  const g = new THREE.Group()
  const main = mat(color, 0.55)
  const dark = mat(shade(color, 0.55), 0.6)
  const black = mat(0x111827, 0.5)
  switch (category) {
    case 'suitcase':
      g.add(box(0.44, 0.6, 0.24, main, 0, 0.36, 0))
      g.add(box(0.46, 0.04, 0.26, dark, 0, 0.36, 0))
      g.add(box(0.16, 0.04, 0.04, black, 0, 0.7, 0))
      g.add(box(0.03, 0.06, 0.03, black, -0.07, 0.67, 0), box(0.03, 0.06, 0.03, black, 0.07, 0.67, 0))
      for (const x of [-0.17, 0.17]) g.add(box(0.05, 0.06, 0.05, black, x, 0.03, 0.08))
      break
    case 'backpack':
      g.add(box(0.32, 0.44, 0.18, main, 0, 0.22, 0))
      g.add(box(0.24, 0.2, 0.06, dark, 0, 0.15, 0.11))
      g.add(box(0.12, 0.04, 0.03, black, 0, 0.46, 0))
      break
    case 'handbag': {
      g.add(box(0.32, 0.22, 0.12, main, 0, 0.11, 0))
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.012, 6, 16, Math.PI), dark)
      handle.position.y = 0.22
      g.add(handle)
      break
    }
    case 'laptopBag':
      g.add(box(0.42, 0.3, 0.08, main, 0, 0.15, 0))
      g.add(box(0.42, 0.12, 0.085, dark, 0, 0.25, 0.002))
      g.add(box(0.04, 0.16, 0.02, black, -0.15, 0.36, 0), box(0.04, 0.16, 0.02, black, 0.15, 0.36, 0))
      break
    case 'shoppingBag':
      g.add(box(0.3, 0.36, 0.15, main, 0, 0.18, 0))
      g.add(box(0.02, 0.1, 0.02, dark, -0.06, 0.4, 0), box(0.02, 0.1, 0.02, dark, 0.06, 0.4, 0))
      break
    case 'instrument': {
      g.add(box(0.34, 0.5, 0.12, main, 0, 0.25, 0))
      g.add(box(0.16, 0.38, 0.11, main, 0, 0.69, 0))
      g.add(box(0.12, 0.03, 0.04, black, 0, 0.5, 0.07))
      break
    }
    case 'box':
      g.add(box(0.42, 0.36, 0.36, mat(0xb08a5a, 0.85), 0, 0.18, 0))
      g.add(box(0.43, 0.06, 0.37, main, 0, 0.36, 0))
      break
    case 'accessory':
      g.add(box(0.18, 0.13, 0.09, main, 0, 0.065, 0))
      g.add(box(0.14, 0.02, 0.095, black, 0, 0.1, 0))
      break
  }
  return g
}

/** Uniformly shrink `object` (never grow) so it fits inside w × h × d. */
export function fitInto(object: THREE.Object3D, w: number, h: number, d: number): void {
  object.scale.setScalar(1)
  const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3())
  const s = Math.min(1, w / Math.max(size.x, 1e-3), h / Math.max(size.y, 1e-3), d / Math.max(size.z, 1e-3))
  object.scale.setScalar(s)
}

// ------------------------------------------------------------------ keys

/** A small brass locker key. All keys look the same on purpose (Stage 1: unlabelled keys). */
export function makeKeyMesh(): THREE.Group {
  const g = new THREE.Group()
  const brass = mat(0xc9a227, 0.35, 0.8)
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.007, 6, 14), brass)
  bow.position.y = 0.0
  const blade = box(0.012, 0.07, 0.006, brass, 0, -0.055, 0)
  const bit = box(0.018, 0.012, 0.006, brass, 0.012, -0.08, 0)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.003, 4, 12), mat(0x9ca3af, 0.3, 0.9))
  ring.position.y = 0.028
  ring.rotation.y = Math.PI / 2
  g.add(bow, blade, bit, ring)
  // A number tag hangs beside the key. It stays hidden until the labels upgrade is bought (see setKeyLabel).
  const tag = new THREE.Mesh(KEY_TAG_GEO, NO_LABEL)
  tag.position.set(0.062, -0.004, 0.006)
  tag.visible = false
  g.add(tag)
  g.userData.tag = tag
  return g
}

const KEY_TAG_GEO = new THREE.PlaneGeometry(0.075, 0.055)
const NO_LABEL = new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide })
const numberMaterials = new Map<string, THREE.MeshBasicMaterial>()

/** A flat material showing a number: a dark plate with white digits for lockers, a yellow tag for keys. */
export function numberMaterial(n: number, style: 'door' | 'tag'): THREE.MeshBasicMaterial {
  const key = `${style}:${n}`
  let material = numberMaterials.get(key)
  if (!material) {
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = style === 'door' ? 64 : 96
    const ctx = canvas.getContext('2d')
    if (ctx) {
      const door = style === 'door'
      ctx.fillStyle = door ? '#0f172a' : '#facc15'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.strokeStyle = door ? '#e2e8f0' : '#a16207'
      ctx.lineWidth = 6
      ctx.strokeRect(3, 3, canvas.width - 6, canvas.height - 6)
      ctx.fillStyle = door ? '#f8fafc' : '#1c1917'
      ctx.font = `800 ${Math.round(canvas.height * (door ? 0.72 : 0.62))}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(n), canvas.width / 2, canvas.height / 2 + 3)
    }
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 4
    material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide })
    numberMaterials.set(key, material)
  }
  return material
}

/** Show locker number `n` on a key's tag, or hide the tag (`null`: labels not bought, or no key here). */
export function setKeyLabel(key: THREE.Object3D, n: number | null): void {
  const tag = key.userData.tag as THREE.Mesh | undefined
  if (!tag) return
  tag.visible = n !== null
  if (n !== null && tag.userData.n !== n) {
    tag.material = numberMaterial(n, 'tag')
    tag.userData.n = n
  }
}

// ------------------------------------------------------------------ people

export type PersonRig = {
  root: THREE.Group
  legL: THREE.Object3D
  legR: THREE.Object3D
  armL: THREE.Object3D
  armR: THREE.Object3D
  /** Where a carried item hangs (right hand). */
  hand: THREE.Object3D
}

export function makePerson(a: Appearance): PersonRig {
  const root = new THREE.Group()
  const body = new THREE.Group()
  body.scale.setScalar(a.height)
  root.add(body)
  const skin = mat(a.skin, 0.65)
  const shirt = mat(a.shirt, 0.75)
  const trousers = mat(a.trousers, 0.8)
  const hair = mat(a.hair, 0.9)
  const shoes = mat(0x1f2937, 0.6)

  const limb = (w: number, h: number, material: THREE.Material, x: number, y: number) => {
    const pivot = new THREE.Group()
    pivot.position.set(x, y, 0)
    const mesh = box(w, h, w, material, 0, -h / 2, 0)
    pivot.add(mesh)
    body.add(pivot)
    return pivot
  }
  const legL = limb(0.15, 0.82, trousers, -0.1, 0.86)
  const legR = limb(0.15, 0.82, trousers, 0.1, 0.86)
  legL.add(box(0.16, 0.07, 0.24, shoes, 0, -0.8, 0.04))
  legR.add(box(0.16, 0.07, 0.24, shoes, 0, -0.8, 0.04))
  body.add(box(0.42, 0.6, 0.24, shirt, 0, 1.16, 0))
  const armL = limb(0.11, 0.6, shirt, -0.27, 1.43)
  const armR = limb(0.11, 0.6, shirt, 0.27, 1.43)
  armL.add(box(0.1, 0.1, 0.1, skin, 0, -0.62, 0))
  armR.add(box(0.1, 0.1, 0.1, skin, 0, -0.62, 0))
  const hand = new THREE.Group()
  hand.position.set(0, -0.66, 0.05)
  armR.add(hand)

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), skin)
  head.position.y = 1.64
  head.castShadow = true
  body.add(head)
  body.add(box(0.03, 0.03, 0.02, mat(0x111827), -0.055, 1.67, 0.15), box(0.03, 0.03, 0.02, mat(0x111827), 0.055, 1.67, 0.15))

  switch (a.hairStyle) {
    case 'short':
      body.add(box(0.33, 0.1, 0.33, hair, 0, 1.77, -0.01))
      break
    case 'long':
      body.add(box(0.34, 0.12, 0.34, hair, 0, 1.77, -0.01), box(0.34, 0.36, 0.08, hair, 0, 1.6, -0.15))
      break
    case 'bun': {
      body.add(box(0.33, 0.09, 0.33, hair, 0, 1.77, -0.01))
      const bun = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), hair)
      bun.position.set(0, 1.86, -0.08)
      body.add(bun)
      break
    }
    case 'cap':
      body.add(box(0.34, 0.09, 0.34, mat(a.shirt, 0.6), 0, 1.78, 0), box(0.3, 0.025, 0.16, mat(a.shirt, 0.6), 0, 1.74, 0.2))
      break
    case 'bald':
      break
  }
  return { root, legL, legR, armL, armR, hand }
}

/** A flat canvas-texture sign (text on a coloured plate), facing +z. */
export function makeSign(text: string, w: number, h: number, bg: string, fg: string): THREE.Mesh {
  // No canvas outside a browser (unit tests): a plain plate in the background colour.
  if (typeof document === 'undefined') return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: bg }))
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = Math.max(32, Math.round((512 * h) / w))
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = fg
    ctx.font = `700 ${Math.round(canvas.height * 0.52)}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, canvas.width / 2, canvas.height / 2)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }))
}
