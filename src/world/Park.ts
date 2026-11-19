import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { Box } from './Gates'
import { tree } from './details'
import { blockBush } from './facade'
import { PARK } from './layout'
import { animatePerson, makePerson, mat, type PersonRig } from './models'
import { blockBench, blockBin } from './streetFurniture'
import { metreUVs, pavingMat, waterMat } from './textures'
import type { Appearance } from '../sim/types'

/**
 * The park east of the service road (`PARK` in `layout.ts`): a low hedge round it with gaps where the paths come in, paved paths crossing
 * at a round plaza with a fountain, flower beds, benches with people on them, a playground (slide, swings, sandpit), trees and lamps.
 * Decoration with colliders (hedges, fountain, benches, playground); the Town adds it and calls `update` for the fountain and swings.
 */
export class Park {
  readonly root = new THREE.Group()
  readonly solids: Box[] = []
  /** Where the Town should put street lamps (x, z). */
  readonly lamps: [number, number][] = []
  private readonly swings: THREE.Object3D[] = []
  private readonly jets: THREE.Mesh[] = []
  private readonly people: PersonRig[] = []
  private t = 0

  constructor() {
    const P = PARK
    const cx = P.centre.x
    const cz = P.centre.z
    const r = (k: number) => Math.abs(Math.sin(k * 12.9898 + 4.7) * 43758.5453) % 1
    const slabs = pavingMat(0xc9c1b3)
    const brick = pavingMat(0xc9a98a, 'brick')

    // Paths: one along z (north from the street's shops to the south hedge), one along x (in from the service road), and the round plaza.
    this.flat(P.path, 0.04, P.maxZ - P.minZ, slabs, cx, 0, (P.minZ + P.maxZ) / 2)
    this.flat(P.maxX - P.entryX, 0.04, P.path, slabs, (P.entryX + P.maxX) / 2, 0, cz)
    this.disc(P.plazaR, brick, cx, 0.03, cz)
    // A ring of stone kerb round the plaza.
    const kerb = new THREE.Mesh(new THREE.TorusGeometry(P.plazaR, 0.1, 6, 64).rotateX(Math.PI / 2), mat(0xa8a29e, 0.85))
    kerb.scale.y = 0.6
    kerb.position.set(cx, 0.04, cz)
    this.root.add(kerb)

    // The fountain: an octagonal basin, water, a pedestal, an upper bowl and jets.
    const stone = mat(0xd6cfc2, 0.8)
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.1, 0.55, 8), stone)
    basin.position.set(cx, 0.28, cz)
    basin.castShadow = true
    basin.receiveShadow = true
    this.root.add(basin)
    const water = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.7, 0.05, 8), waterMat())
    water.position.set(cx, 0.52, cz)
    this.root.add(water)
    this.block(0.7, 1.5, 0.7, stone, cx, 1.2, cz)
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.6, 0.3, 8), stone)
    bowl.position.set(cx, 2.0, cz)
    bowl.castShadow = true
    this.root.add(bowl)
    const jetMat = new THREE.MeshStandardMaterial({ color: 0xe0f2fe, transparent: true, opacity: 0.6, roughness: 0.1 })
    const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.16, 1.2, 8), jetMat)
    jet.position.set(cx, 2.7, cz)
    this.root.add(jet)
    this.jets.push(jet)
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2
      const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.08, 1.3, 6), jetMat)
      spout.position.set(cx + Math.cos(a) * 1.6, 1.2, cz + Math.sin(a) * 1.6)
      spout.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6)
      this.root.add(spout)
      this.jets.push(spout)
    }
    this.solids.push({ x: cx, y: 0.5, z: cz, hx: 2.6, hy: 0.5, hz: 2.6 })

    // Benches round the plaza facing the fountain, with bins, and some people sitting on them.
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8
      const bx = cx + Math.cos(a) * (P.plazaR - 0.8)
      const bz = cz + Math.sin(a) * (P.plazaR - 0.8)
      const yaw = Math.atan2(cx - bx, cz - bz)
      const bench = blockBench()
      bench.position.set(bx, 0.03, bz)
      bench.rotation.y = yaw
      this.root.add(bench)
      this.solids.push({ x: bx, y: 0.42, z: bz, hx: 0.6, hy: 0.42, hz: 0.6 })
      if (k % 2 === 0) {
        const bin = blockBin()
        const ba = a + 0.22
        bin.position.set(cx + Math.cos(ba) * (P.plazaR - 0.6), 0.03, cz + Math.sin(ba) * (P.plazaR - 0.6))
        this.root.add(bin)
      }
      if (k % 3 !== 2) this.person(bx + Math.sin(yaw) * 0.12, bz + Math.cos(yaw) * 0.12, yaw, 'sit', k * 5 + 1)
    }

    // Flower beds in the four corners round the plaza.
    const soil = mat(0x5b4030, 1)
    const petals = [0xef4444, 0xf59e0b, 0xec4899, 0xf8fafc, 0x8b5cf6]
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const fx = cx + sx * (P.plazaR + 4.5)
      const fz = cz + sz * (P.plazaR + 3.5)
      if (Math.abs(fx - P.playground.x) < 9 && Math.abs(fz - P.playground.z) < 7) continue
      this.block(5, 0.22, 3, mat(0xa8a29e, 0.85), fx, 0.11, fz)
      this.block(4.7, 0.05, 2.7, soil, fx, 0.23, fz)
      for (let i = 0; i < 18; i++) {
        const f = this.block(0.22, 0.22, 0.22, mat(petals[i % petals.length]!, 0.7), fx + (r(i * 3 + sx) - 0.5) * 4.2, 0.36, fz + (r(i * 7 + sz) - 0.5) * 2.3)
        f.rotation.y = r(i) * 3
      }
      for (let i = 0; i < 3; i++) this.root.add(blockBush(fx - 1.5 + i * 1.5, 0.25, fz, 0.7, i + sx * 3 + sz * 7 + 20))
      this.solids.push({ x: fx, y: 0.25, z: fz, hx: 2.5, hy: 0.25, hz: 1.5 })
    }

    // The playground, in the south-east quarter: a sandpit with a slide and a set of swings.
    const px = P.playground.x
    const pz = P.playground.z
    const sand = mat(0xe8d5a8, 1)
    this.block(10, 0.18, 8, mat(0x8b6b4a, 0.9), px, 0.09, pz)
    this.block(9.6, 0.06, 7.6, sand, px, 0.17, pz)
    const red = mat(0xdc2626, 0.6)
    const blue = mat(0x2563eb, 0.6)
    const yellow = mat(0xfacc15, 0.6)
    // Slide: a tower with a ladder and a chute.
    for (const dx of [-0.6, 0.6]) for (const dz of [-0.6, 0.6]) this.block(0.12, 1.9, 0.12, blue, px - 2.5 + dx, 0.95, pz + dz)
    this.block(1.4, 0.12, 1.4, yellow, px - 2.5, 1.6, pz)
    this.block(1.6, 0.6, 1.6, red, px - 2.5, 2.2, pz).scale.set(1, 0.4, 1)
    for (let i = 0; i < 5; i++) this.block(0.9, 0.06, 0.06, yellow, px - 2.5, 0.3 + i * 0.3, pz - 0.7)
    const chute = this.block(0.8, 0.08, 3.2, red, px - 2.5, 0.95, pz + 2.0)
    chute.rotation.x = 0.45
    this.solids.push({ x: px - 2.5, y: 1.1, z: pz, hx: 0.75, hy: 1.1, hz: 0.75 })
    // Swings: an A-frame with two seats on ropes.
    for (const dx of [-1.6, 1.6]) {
      for (const dz of [-0.7, 0.7]) {
        const leg = this.block(0.12, 2.6, 0.12, blue, px + 2 + dx, 1.25, pz + dz * 0.6)
        leg.rotation.x = dz * 0.35
      }
      this.solids.push({ x: px + 2 + dx, y: 1.2, z: pz, hx: 0.15, hy: 1.2, hz: 0.6 })
    }
    this.block(3.4, 0.14, 0.14, blue, px + 2, 2.5, pz)
    for (const dx of [-0.75, 0.75]) {
      const swing = new THREE.Group()
      swing.position.set(px + 2 + dx, 2.45, pz)
      for (const sx of [-0.22, 0.22]) {
        const rope = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.9, 0.03), mat(0x6b7280, 0.6))
        rope.position.set(sx, -0.95, 0)
        swing.add(rope)
      }
      const seat = this.block(0.55, 0.06, 0.25, red, 0, -1.9, 0, swing)
      seat.castShadow = true
      this.root.add(swing)
      this.swings.push(swing)
    }
    this.person(px + 0.5, pz + 2.2, Math.PI, 'idle', 31)
    this.person(px - 3.6, pz + 1.4, Math.PI / 2, 'idle', 37)

    // Trees scattered on the lawns, clear of the paths, the plaza, the beds and the playground.
    let k = 0
    for (let i = 0; i < 60 && k < 22; i++) {
      const x = P.minX + 2 + r(i * 11) * (P.maxX - P.minX - 4)
      const z = P.minZ + 2 + r(i * 13 + 5) * (P.maxZ - P.minZ - 4)
      if (Math.abs(x - cx) < P.path / 2 + 2 || Math.abs(z - cz) < P.path / 2 + 2) continue
      if (Math.hypot(x - cx, z - cz) < P.plazaR + 6) continue
      if (Math.abs(x - px) < 7 && Math.abs(z - pz) < 6) continue
      this.root.add(tree(x, z, 4.5 + r(i) * 2.5, i + 40))
      this.solids.push({ x, y: 1.5, z, hx: 0.25, hy: 1.5, hz: 0.25 })
      k++
    }

    // A low hedge all round, with gaps where the paths come in.
    const hedge = mat(0x3f7a33, 0.9)
    const gap = P.path / 2 + 0.4
    const runs: [number, number, number, number][] = [
      // [x0, z0, x1, z1]
      [P.minX, P.minZ, P.minX, cz - gap],
      [P.minX, cz + gap, P.minX, P.maxZ],
      [P.maxX, P.minZ, P.maxX, P.maxZ],
      [P.minX, P.minZ, cx - gap, P.minZ],
      [cx + gap, P.minZ, P.maxX, P.minZ],
      [P.minX, P.maxZ, cx - gap, P.maxZ],
      [cx + gap, P.maxZ, P.maxX, P.maxZ],
    ]
    for (const [x0, z0, x1, z1] of runs) {
      const len = Math.hypot(x1 - x0, z1 - z0)
      const along = x0 === x1 ? 'z' : 'x'
      this.block(along === 'x' ? len : 0.8, 0.9, along === 'z' ? len : 0.8, hedge, (x0 + x1) / 2, 0.45, (z0 + z1) / 2)
      this.solids.push({ x: (x0 + x1) / 2, y: 0.45, z: (z0 + z1) / 2, hx: along === 'x' ? len / 2 : 0.4, hy: 0.45, hz: along === 'z' ? len / 2 : 0.4 })
    }
    // Lamps along the paths.
    for (const z of [P.minZ + 4, cz - P.plazaR - 3, cz + P.plazaR + 3, P.maxZ - 4]) this.lamps.push([cx + P.path / 2 + 0.4, z])
    for (const x of [P.entryX + 3, cx - P.plazaR - 3, cx + P.plazaR + 4, P.maxX - 4]) this.lamps.push([x, cz - P.path / 2 - 0.4])
    // A few people strolling about (standing still on the paths).
    this.person(cx + 0.6, P.minZ + 6, 0, 'idle', 43)
    this.person(P.entryX + 8, cz + 0.5, -Math.PI / 2, 'idle', 47)
  }

  update(dt: number): void {
    this.t += dt
    this.swings.forEach((s, i) => (s.rotation.x = Math.sin(this.t * 1.9 + i * 1.3) * (0.35 + i * 0.1)))
    this.jets.forEach((j, i) => j.scale.set(1, 0.85 + 0.15 * Math.sin(this.t * 6 + i), 1))
    for (const p of this.people) animatePerson(p, dt, p.root.userData.pose as 'sit' | 'idle')
  }

  private person(x: number, z: number, yaw: number, pose: 'sit' | 'idle', seed: number): void {
    const rig = makePerson(look(seed), { female: seed % 2 === 1 })
    rig.root.position.set(x, 0.03, z)
    rig.root.rotation.y = yaw
    rig.root.userData.pose = pose
    this.root.add(rig.root)
    this.people.push(rig)
  }

  private flat(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const mesh = new THREE.Mesh(metreUVs(new THREE.BoxGeometry(w, h, d)), m)
    mesh.position.set(x, y, z)
    mesh.receiveShadow = true
    this.root.add(mesh)
    return mesh
  }

  private block(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.root): THREE.Mesh {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(0.04, w / 3, h / 3, d / 3)), m)
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }

  private disc(radius: number, m: THREE.Material, x: number, y: number, z: number): void {
    const geo = new THREE.CircleGeometry(radius, 64).rotateX(-Math.PI / 2)
    const pos = geo.getAttribute('position')
    const uv = geo.getAttribute('uv')
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) + x, -(pos.getZ(i) + z))
    const mesh = new THREE.Mesh(geo, m)
    mesh.position.set(x, y, z)
    mesh.receiveShadow = true
    this.root.add(mesh)
  }
}

function look(i: number): Appearance {
  const k = ((i + 3) * 2654435761) >>> 0
  const pick = <T,>(list: readonly T[], n: number): T => list[(k >>> n) % list.length]!
  return {
    skin: 0,
    hair: pick([0x1f1a17, 0x2b1d14, 0x4a2f1b, 0x8b5a2b, 0xd8b06a, 0x9a9a9a], 3),
    hairStyle: pick(['short', 'long', 'bun', 'bald', 'cap'] as const, 7),
    shirt: pick([0x2563eb, 0xdc2626, 0x16a34a, 0xf59e0b, 0x7c3aed, 0x0d9488, 0xdb2777, 0x475569, 0xf8fafc], 11),
    trousers: pick([0x1e293b, 0x374151, 0x3f3f46, 0x1e3a8a, 0x57534e, 0xd6c3a0], 15),
    height: 0.95 + ((i * 7) % 10) / 100,
  }
}
