import * as THREE from 'three'
import type { Appearance, Special } from '../sim/types'

/**
 * Stylised procedural people: soft rounded bodies (capsules and spheres), a big round head with a simple face, chunky hands and shoes,
 * and plenty of variety from one `Appearance` (clothes, sleeves, shorts or skirt, glasses, beards, hair). Four rare `Special` looks.
 * Animated by `animateToon` from the limb pivots (walk, idle, sit, carry), so nothing has to load.
 *
 * Proportions are for a 1.75 m person at `height` 1; the root's origin is between the feet, facing +z.
 */
export type ToonRig = {
  root: THREE.Group
  body: THREE.Group
  hips: THREE.Group
  torso: THREE.Group
  head: THREE.Group
  legL: THREE.Group
  legR: THREE.Group
  kneeL: THREE.Group
  kneeR: THREE.Group
  armL: THREE.Group
  armR: THREE.Group
  elbowL: THREE.Group
  elbowR: THREE.Group
  hand: THREE.Group
  /** Extra bits that sway (a cape). */
  cape: THREE.Object3D | null
  phase: number
  breathe: number
}

const mats = new Map<string, THREE.MeshStandardMaterial>()
function m(color: number, roughness = 0.75, metalness = 0): THREE.MeshStandardMaterial {
  const key = `${color}-${roughness}-${metalness}`
  let x = mats.get(key)
  if (!x) {
    x = new THREE.MeshStandardMaterial({ color, roughness, metalness })
    mats.set(key, x)
  }
  return x
}

const geos = new Map<string, THREE.BufferGeometry>()
function capsule(r: number, len: number): THREE.BufferGeometry {
  const key = `c${r}-${len}`
  let g = geos.get(key)
  if (!g) {
    g = new THREE.CapsuleGeometry(r, len, 6, 14)
    geos.set(key, g)
  }
  return g
}
function sphere(r: number): THREE.BufferGeometry {
  const key = `s${r}`
  let g = geos.get(key)
  if (!g) {
    g = new THREE.SphereGeometry(r, 20, 14)
    geos.set(key, g)
  }
  return g
}

/** The top of a sphere (a hair cap), `theta` of the way down from the crown. */
function cap(r: number, theta: number): THREE.BufferGeometry {
  const key = `cap${r}-${theta}`
  let g = geos.get(key)
  if (!g) {
    g = new THREE.SphereGeometry(r, 22, 12, 0, Math.PI * 2, 0, theta)
    geos.set(key, g)
  }
  return g
}

/** The bottom of a sphere, from `from` (radians from the crown) to the chin: a beard. */
function chin(r: number, from: number): THREE.BufferGeometry {
  const key = `chin${r}-${from}`
  let g = geos.get(key)
  if (!g) {
    g = new THREE.SphereGeometry(r, 22, 10, -Math.PI * 0.2, Math.PI * 1.4, from, Math.PI - from)
    geos.set(key, g)
  }
  return g
}

function mesh(geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1): THREE.Mesh {
  const o = new THREE.Mesh(geo, material)
  o.position.set(x, y, z)
  o.scale.set(sx, sy, sz)
  o.castShadow = true
  return o
}

function pivot(parent: THREE.Object3D, x: number, y: number, z = 0): THREE.Group {
  const g = new THREE.Group()
  g.position.set(x, y, z)
  parent.add(g)
  return g
}

/** A stable number from an appearance, for choosing clothes and details. */
function hashOf(a: Appearance): number {
  return Math.abs(Math.imul(a.shirt ^ (a.hair * 31) ^ (a.trousers * 17) ^ (a.skin * 7) ^ Math.round(a.height * 1000), 2654435761)) >>> 0
}

function shade(color: number, f: number): number {
  return new THREE.Color(color).multiplyScalar(f).getHex()
}

export type ToonOptions = { female?: boolean; smart?: boolean; worker?: boolean }

export function makeToon(a: Appearance, opts: ToonOptions = {}): ToonRig {
  const h = hashOf(a)
  const bit = (n: number, mod: number) => (h >>> n) % mod
  const special = a.special
  const female = !!opts.female

  // Clothes: a top (tee, long sleeves, jacket over it, hoodie), bottoms (trousers, shorts, skirt for some women), shoes.
  let top = a.shirt
  let bottom = a.trousers
  let sleeves: 'short' | 'long' = bit(3, 2) ? 'short' : 'long'
  let jacket: number | null = !opts.worker && bit(5, 4) === 0 ? [0x1f2937, 0x78350f, 0x334155, 0x14532d][bit(7, 4)]! : null
  let bottomKind: 'trousers' | 'shorts' | 'skirt' = female && bit(9, 3) === 0 ? 'skirt' : bit(11, 6) === 0 ? 'shorts' : 'trousers'
  let shoes = [0x1f2937, 0xf8fafc, 0x7c2d12, 0x111827][bit(13, 4)]!
  let hairStyle: string = a.hairStyle
  let hair = a.hair
  let glasses = bit(15, 6) === 0
  let beard = !female && bit(17, 5) === 0
  if (opts.smart) {
    top = 0xf8fafc
    jacket = female ? 0x7f1d1d : 0x111827
    bottom = 0x111827
    bottomKind = female ? 'skirt' : 'trousers'
    sleeves = 'long'
    shoes = 0x0b0b0b
  }
  if (opts.worker) {
    top = 0xf97316
    bottom = 0x1e3a8a
    hairStyle = 'cap'
    sleeves = 'long'
  }
  if (special === 'fighter') {
    top = 0xf97316
    bottom = 0xf97316
    jacket = null
    sleeves = 'short'
    bottomKind = 'trousers'
    shoes = 0x1d4ed8
    hairStyle = 'spiky'
    hair = 0x111111
    glasses = false
    beard = false
  } else if (special === 'ninja') {
    top = 0xf97316
    bottom = 0xf97316
    jacket = null
    sleeves = 'long'
    bottomKind = 'trousers'
    shoes = 0x1e3a8a
    hairStyle = 'spiky'
    hair = 0xfacc15
    glasses = false
    beard = false
  } else if (special === 'swordsman') {
    top = 0x0b0b0b
    bottom = 0x0b0b0b
    jacket = null
    sleeves = 'long'
    bottomKind = 'trousers'
    shoes = 0x1f2937
    hairStyle = 'spiky'
    hair = 0xf97316
    glasses = false
    beard = false
  } else if (special === 'caped') {
    top = 0xfacc15
    bottom = 0xfacc15
    jacket = null
    sleeves = 'long'
    bottomKind = 'trousers'
    shoes = 0xdc2626
    hairStyle = 'bald'
    glasses = false
    beard = false
  }

  const skinM = m(a.skin, 0.65)
  const topM = m(top, 0.85)
  const bottomM = m(bottom, 0.85)
  const shoeM = m(shoes, 0.55)
  const hairM = m(hair, 0.9)

  const root = new THREE.Group()
  const body = new THREE.Group()
  body.scale.setScalar(a.height)
  root.add(body)
  const hips = pivot(body, 0, 0.9)
  const torso = pivot(hips, 0, 0.02)

  // Torso: a rounded body, a little narrower for women, with the jacket as a slightly bigger shell and a belt.
  const w = female ? 0.92 : 1
  torso.add(mesh(capsule(0.2, 0.3), topM, 0, 0.3, 0, 1.05 * w, 1, 0.72))
  if (jacket !== null) {
    const jm = m(jacket, 0.8)
    for (const s of [-1, 1]) torso.add(mesh(capsule(0.11, 0.3), jm, s * 0.12 * w, 0.31, 0.012, 1, 1.02, 0.78 * 1.5))
    torso.add(mesh(capsule(0.2, 0.28), jm, 0, 0.31, -0.03, 1.08 * w, 1.02, 0.7))
  }
  torso.add(mesh(capsule(0.19, 0.02), bottomM, 0, 0.03, 0, 1.06 * w, 0.7, 0.74))
  torso.add(mesh(sphere(0.06), skinM, 0, 0.63, 0, 1, 0.9, 1)) // neck

  // Head: big and round, with a face (eyes with highlights, brows, a nose and a smile), ears and hair.
  const head = pivot(torso, 0, 0.72)
  head.add(mesh(sphere(0.21), skinM, 0, 0.12, 0, 1, 1.04, 0.96))
  for (const s of [-1, 1]) head.add(mesh(sphere(0.045), skinM, s * 0.205, 0.1, -0.01, 0.6, 1, 1))
  const eyeW = m(0xffffff, 0.3)
  const eyeB = m(0x1b1b1f, 0.3)
  for (const s of [-1, 1]) {
    head.add(mesh(sphere(0.038), eyeW, s * 0.075, 0.14, 0.17, 1, 1.15, 0.5))
    head.add(mesh(sphere(0.022), eyeB, s * 0.075, 0.135, 0.19, 1, 1.2, 0.5))
    head.add(mesh(sphere(0.007), eyeW, s * 0.075 + 0.008, 0.147, 0.2))
    const brow = mesh(capsule(0.009, 0.05), hairStyle === 'bald' ? m(shade(a.skin, 0.6)) : hairM, s * 0.078, 0.205, 0.175)
    brow.rotation.z = Math.PI / 2 + s * (special ? 0.25 : 0.08)
    head.add(brow)
  }
  head.add(mesh(sphere(0.028), m(shade(a.skin, 0.9), 0.6), 0, 0.09, 0.205, 1, 0.9, 0.9))
  const smile = mesh(new THREE.TorusGeometry(0.04, 0.008, 6, 16, Math.PI), m(0x7f1d1d, 0.5), 0, 0.045, 0.19)
  smile.rotation.z = Math.PI
  head.add(smile)
  if (female) for (const s of [-1, 1]) head.add(mesh(sphere(0.02), m(0xf9a8d4, 0.6), s * 0.13, 0.07, 0.165, 1, 0.6, 0.4)) // blush
  if (glasses) {
    const frame = m(0x111827, 0.4, 0.3)
    for (const s of [-1, 1]) {
      const ring = mesh(new THREE.TorusGeometry(0.045, 0.007, 6, 18), frame, s * 0.077, 0.14, 0.205)
      head.add(ring)
    }
    head.add(mesh(capsule(0.006, 0.04), frame, 0, 0.145, 0.212, 1, 1, 1).rotateZ(Math.PI / 2))
  }
  if (beard) {
    const bm = m(hair, 0.95)
    // Round the jaw and up the cheeks, below the mouth's corners, with a moustache over the mouth.
    head.add(mesh(chin(0.214, Math.PI * 0.64), bm, 0, 0.12, 0.004, 1.0, 1.04, 0.98))
    const tache = mesh(capsule(0.016, 0.07), bm, 0, 0.068, 0.198)
    tache.rotation.z = Math.PI / 2
    head.add(tache)
  }
  addHair(head, hairStyle, hairM, female, h, special)
  if (special === 'ninja') {
    head.add(mesh(new THREE.CylinderGeometry(0.215, 0.215, 0.05, 24, 1, true), m(0x1e3a8a, 0.6), 0, 0.22, 0))
    head.add(mesh(new THREE.BoxGeometry(0.12, 0.05, 0.02), m(0xcbd5e1, 0.3, 0.8), 0, 0.22, 0.212))
  }

  // Arms: a sleeve to the elbow, then sleeve or bare forearm, and a round hand.
  const shoulderX = 0.25 * w
  const armL = pivot(torso, -shoulderX, 0.52)
  const armR = pivot(torso, shoulderX, 0.52)
  const elbows: THREE.Group[] = []
  for (const arm of [armL, armR]) {
    arm.add(mesh(capsule(0.065, 0.2), topM, 0, -0.14, 0))
    if (jacket !== null) arm.add(mesh(capsule(0.072, 0.18), m(jacket, 0.8), 0, -0.13, 0))
    const elbow = pivot(arm, 0, -0.27)
    elbow.add(mesh(capsule(0.056, 0.18), sleeves === 'long' || jacket !== null ? (jacket !== null ? m(jacket, 0.8) : topM) : skinM, 0, -0.12, 0))
    elbow.add(mesh(sphere(0.068), special === 'caped' ? m(0xdc2626, 0.6) : skinM, 0, -0.27, 0.01, 1, 1.1, 0.95))
    elbows.push(elbow)
  }
  const hand = pivot(elbows[1]!, 0, -0.3, 0.02)

  // Legs: thigh and shin (shorts show the knee, a skirt covers the top), and a chunky shoe.
  const legL = pivot(hips, -0.1 * w, 0)
  const legR = pivot(hips, 0.1 * w, 0)
  const knees: THREE.Group[] = []
  for (const leg of [legL, legR]) {
    leg.add(mesh(capsule(0.085, 0.28), bottomKind === 'trousers' ? bottomM : bottomKind === 'shorts' ? bottomM : skinM, 0, -0.2, 0))
    const knee = pivot(leg, 0, -0.42)
    knee.add(mesh(capsule(0.072, 0.26), bottomKind === 'trousers' ? bottomM : skinM, 0, -0.2, 0))
    knee.add(mesh(sphere(0.085), shoeM, 0, -0.44, 0.045, 1, 0.62, 1.45))
    knees.push(knee)
  }
  if (bottomKind === 'shorts') for (const leg of [legL, legR]) leg.add(mesh(capsule(0.092, 0.12), bottomM, 0, -0.12, 0))
  if (bottomKind === 'skirt') hips.add(mesh(new THREE.CylinderGeometry(0.2, 0.3, 0.38, 18), bottomM, 0, -0.16, 0))

  // Specials' extras.
  let cape: THREE.Object3D | null = null
  if (special === 'fighter') {
    torso.add(mesh(capsule(0.2, 0.02), m(0x1d4ed8, 0.7), 0, 0.03, 0, 1.08, 0.6, 0.76)) // blue belt
    torso.add(mesh(capsule(0.12, 0.18), m(0x1d4ed8, 0.8), 0, 0.42, 0.02, 1.4, 0.9, 0.8)) // undershirt
  }
  if (special === 'swordsman') {
    const blade = new THREE.Group()
    blade.add(mesh(new THREE.BoxGeometry(0.16, 1.25, 0.03), m(0xd1d5db, 0.25, 0.9), 0, 0, 0))
    blade.add(mesh(new THREE.BoxGeometry(0.06, 0.3, 0.05), m(0x111827, 0.6), 0, -0.75, 0))
    blade.position.set(0.05, 0.35, -0.2)
    blade.rotation.z = 0.5
    torso.add(blade)
    torso.add(mesh(capsule(0.03, 0.55), m(0xf8fafc, 0.7), 0, 0.3, 0.07, 1, 1, 1).rotateZ(0.6)) // white sash
  }
  if (special === 'caped') {
    const c = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.95, 1, 6).translate(0, -0.47, 0), new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.85, side: THREE.DoubleSide }))
    c.position.set(0, 0.6, -0.16)
    c.castShadow = true
    torso.add(c)
    cape = c
    torso.add(mesh(capsule(0.2, 0.02), m(0x111827, 0.6), 0, 0.03, 0, 1.08, 0.6, 0.76)) // black belt
  }

  return {
    root,
    body,
    hips,
    torso,
    head,
    legL,
    legR,
    kneeL: knees[0]!,
    kneeR: knees[1]!,
    armL,
    armR,
    elbowL: elbows[0]!,
    elbowR: elbows[1]!,
    hand,
    cape,
    phase: (h % 628) / 100,
    breathe: (h % 300) / 100,
  }
}

function addHair(head: THREE.Group, style: string, hm: THREE.Material, female: boolean, h: number, special: Special | undefined): void {
  // Hair is a cap over the crown, tipped back so the forehead and face stay clear (the head's centre is at y 0.12).
  const crown = (r = 0.226, theta = Math.PI * 0.56, tilt = -0.42) => {
    const c = mesh(cap(r, theta), hm, 0, 0.125, -0.01, 1, 1.02, 1)
    c.rotation.x = tilt
    head.add(c)
    return c
  }
  switch (style) {
    case 'short':
      crown()
      if ((h >>> 19) % 2) head.add(mesh(sphere(0.08), hm, 0.06, 0.31, 0.08, 1.7, 0.55, 0.9)) // a quiff
      break
    case 'long':
      crown(0.23, Math.PI * 0.6, -0.36)
      head.add(mesh(capsule(0.16, 0.2), hm, 0, 0.0, -0.11, 1.3, 1, 0.55))
      for (const s of [-1, 1]) head.add(mesh(capsule(0.05, 0.18), hm, s * 0.19, 0.02, 0.02, 1, 1, 1))
      break
    case 'bun':
      crown()
      head.add(mesh(sphere(0.085), hm, 0, 0.33, -0.12))
      break
    case 'cap': {
      const cm = m([0xdc2626, 0x1d4ed8, 0x111827, 0x15803d][(h >>> 21) % 4]!, 0.7)
      const c = mesh(cap(0.23, Math.PI * 0.5), cm, 0, 0.15, -0.005)
      c.rotation.x = -0.15
      head.add(c)
      const brim = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.025, 20, 1, false, -Math.PI / 2, Math.PI), cm, 0, 0.2, 0.12, 1, 1, 1.25)
      brim.rotation.x = 0.12
      head.add(brim)
      head.add(mesh(sphere(0.022), cm, 0, 0.38, -0.03))
      break
    }
    case 'spiky': {
      // Big spikes pointing up and back (tallest for the fighter) round the crown, and a fringe of small ones over the brow.
      const tall = special === 'fighter' ? 1.7 : special === 'swordsman' ? 1.0 : 1.25
      crown(0.228, Math.PI * 0.55, -0.3)
      const spikes = special === 'fighter' ? 12 : 9
      for (let i = 0; i < spikes; i++) {
        const a = (i / spikes) * Math.PI * 2
        const len = (0.17 + ((h >>> (i % 20)) % 5) * 0.02) * tall
        // Mostly upwards, fanning out a little (and swept back for the fighter).
        const fan = special === 'fighter' ? 0.55 : 0.75
        const spike = mesh(new THREE.ConeGeometry(0.08, len, 6), hm, Math.sin(a) * 0.12, 0.28 + len * 0.42, Math.cos(a) * 0.1 - 0.05)
        spike.rotation.set(-Math.cos(a) * fan - (special === 'fighter' ? 0.15 : 0.3), 0, Math.sin(a) * fan)
        head.add(spike)
      }
      for (const x of [-0.1, 0, 0.1]) {
        const f = mesh(new THREE.ConeGeometry(0.045, 0.14, 5), hm, x, 0.27, 0.16)
        f.rotation.set(2.3, 0, -x * 2)
        head.add(f)
      }
      break
    }
    case 'bald':
    default:
      if (female) crown()
      break
  }
}

export type ToonPose = 'idle' | 'walk' | 'sit' | 'carry' | 'run'

/** Move a toon's limbs for a pose; `speed` scales the walk cycle. Call every frame. */
export function animateToon(rig: ToonRig, dt: number, pose: ToonPose, speed = 1): void {
  const moving = pose === 'walk' || pose === 'run'
  rig.phase += dt * (moving ? 7.5 * speed * (pose === 'run' ? 1.5 : 1) : 0)
  rig.breathe += dt
  const k = Math.min(1, dt * 12)
  const lerp = (o: THREE.Object3D, x: number, z = 0) => {
    o.rotation.x += (x - o.rotation.x) * k
    o.rotation.z += (z - o.rotation.z) * k
  }
  const s = Math.sin(rig.phase)
  const amp = pose === 'run' ? 0.9 : 0.55
  let bodyY = 0
  if (pose === 'sit') {
    lerp(rig.legL, -1.5, -0.05)
    lerp(rig.legR, -1.5, 0.05)
    lerp(rig.kneeL, 1.5)
    lerp(rig.kneeR, 1.5)
    lerp(rig.armL, -0.5, -0.1)
    lerp(rig.armR, -0.5, 0.1)
    lerp(rig.elbowL, -0.5)
    lerp(rig.elbowR, -0.5)
    lerp(rig.torso, -0.05)
    bodyY = -0.42
  } else if (moving) {
    lerp(rig.legL, s * amp)
    lerp(rig.legR, -s * amp)
    lerp(rig.kneeL, Math.max(0, -Math.cos(rig.phase)) * amp * 1.2)
    lerp(rig.kneeR, Math.max(0, Math.cos(rig.phase)) * amp * 1.2)
    lerp(rig.armL, -s * amp * 0.8, -0.08)
    lerp(rig.elbowL, -0.3)
    if (pose === 'walk' && rig.hand.children.length > 0) {
      lerp(rig.armR, 0.05, 0.12)
      lerp(rig.elbowR, 0)
    } else {
      lerp(rig.armR, s * amp * 0.8, 0.08)
      lerp(rig.elbowR, -0.3)
    }
    lerp(rig.torso, pose === 'run' ? 0.15 : 0.04)
    bodyY = Math.abs(Math.cos(rig.phase)) * 0.035
  } else {
    // Standing: weight shifts, breathing, arms relaxed (or holding a bag).
    const b = Math.sin(rig.breathe * 1.6)
    lerp(rig.legL, 0, -0.03)
    lerp(rig.legR, 0, 0.03)
    lerp(rig.kneeL, 0)
    lerp(rig.kneeR, 0)
    lerp(rig.armL, 0.02 * b, -0.1)
    lerp(rig.elbowL, -0.12)
    lerp(rig.armR, pose === 'carry' ? 0.05 : -0.02 * b, 0.1)
    lerp(rig.elbowR, pose === 'carry' ? -0.05 : -0.12)
    lerp(rig.torso, 0.01 * b)
    rig.head.rotation.y = Math.sin(rig.breathe * 0.4) * 0.25
    bodyY = b * 0.006
  }
  rig.hips.position.y = 0.9 + bodyY
  if (rig.cape) rig.cape.rotation.x = 0.12 + (moving ? 0.35 + s * 0.06 : Math.sin(rig.breathe * 2) * 0.04)
}
