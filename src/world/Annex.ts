import type RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { flatRoof, rooftopUnit } from './details'
import { conduit } from './cables'
import { prop } from './props'
import type { PhysicsWorld } from '../engine/PhysicsWorld'
import { markBlocker } from './interactables'
import { ANNEX, ANNEX_DOOR, ANNEX_ZONE, ROOM, POWER_FEEDS } from './layout'
import { makeSign, mat } from './models'
import { ceilingMat, concreteFloor, lightPanel, metreUVs, roofGravel, wallMat } from './textures'

export type AnnexSide = 'west' | 'east'

const RISE_SECONDS = 1.4
const T = 0.2 // wall thickness

/**
 * A storage hall built into the unit next door: floor, walls, ceiling, lights and signs. It is reached through
 * the doorway that `Facility.setAnnexOpen` cuts in the side wall. Its locker banks and key racks are separate
 * views (LockerWall / KeyRack) that the Engine places inside it. The hall rises out of the ground when bought.
 */
export class Annex {
  readonly root = new THREE.Group()
  readonly side: AnnexSide
  private readonly bodies: RAPIER.RigidBody[] = []
  private readonly physics: PhysicsWorld
  private rise = 1

  constructor(side: AnnexSide, physics: PhysicsWorld) {
    this.side = side
    this.physics = physics
    const a = ANNEX[side]
    const h = ROOM.height
    const { minZ, maxZ } = ANNEX_ZONE
    const w = a.maxX - a.minX
    const cx = (a.minX + a.maxX) / 2
    const depth = maxZ - minZ - 0.1
    const cz = (minZ + maxZ - 0.1) / 2

    // Each side has its own colour, matching the unit it replaces.
    const inner = wallMat(side === 'west' ? 0xd8c3a5 : 0xc3d0da)
    const outer = wallMat(side === 'west' ? 0xb9a58f : 0xa9b6bf)

    // Floor, ceiling and the roof slab seen from outside.
    this.deco(w, 0.02, maxZ - minZ, concreteFloor(0x8f949a), cx, 0.005, (minZ + maxZ) / 2)
    this.deco(w, 0.1, depth, ceilingMat(0xf4f2ee), cx, h + 0.05, cz)
    // A collider in the ceiling, so you cannot jump through it onto the roof.
    this.bodies.push(this.physics.addStaticBox(new THREE.Vector3(cx, h + 0.05, cz), new THREE.Vector3(w / 2, 0.05, depth / 2)))
    this.deco(w + 0.6, 0.18, depth + 0.5, mat(0x59544e, 0.9), cx, h + 0.19, cz)
    this.root.add(flatRoof(a.minX - 0.3, a.maxX + 0.3, ANNEX_ZONE.minZ - 0.25, ANNEX_ZONE.maxZ + 0.05, h + 0.28, outer, roofGravel(0x9a9a95), side === 'east' ? 'w' : 'e'))
    this.root.add(rooftopUnit(cx + (side === 'east' ? 1.5 : -1.5), h + 0.34, cz, 0.3))

    // Walls: back (same plane as the main back wall), front (same plane as the partition) and the far side.
    const x0 = side === 'west' ? a.minX - T : a.minX
    const x1 = side === 'west' ? a.maxX : a.maxX + T
    const outerX = side === 'west' ? a.minX - T / 2 : a.maxX + T / 2
    this.solid((x1 - x0), h, T, inner, (x0 + x1) / 2, h / 2, minZ - T / 2)
    this.solid((x1 - x0), h, T, inner, (x0 + x1) / 2, h / 2, maxZ + T / 2)
    this.solid(T, h, maxZ - minZ + T * 2, outer, outerX, h / 2, (minZ + maxZ) / 2)

    // The east annex's electrical box on its far wall (its arm console's cables run to it), fed from the ceiling.
    if (side === 'east') {
      const { x: bx, z: bz } = POWER_FEEDS.east.riser
      this.root.add(prop('power_box_01', { x: bx, y: 1.0, z: bz, rotY: -Math.PI / 2, height: 0.6 }))
      this.root.add(conduit([new THREE.Vector3(bx, 1.56, bz), new THREE.Vector3(bx, h - 0.05, bz)]))
    }

    // Light: two ceiling fixtures.
    const panel = lightPanel(0xfff8e7, 1.2)
    for (const dx of [-2.4, 2.4]) {
      const light = new THREE.PointLight(0xfff4e0, 9, 9, 1.6)
      light.position.set(cx + dx, h - 0.25, cz)
      this.root.add(light)
      const fixture = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.4), panel)
      fixture.position.set(cx + dx, h - 0.03, cz)
      this.root.add(fixture)
    }

    // Signs: above the new doorway (in the main storage room) and on the hall's back wall.
    const title = side === 'west' ? 'STORAGE ANNEX · WEST' : 'STORAGE ANNEX · EAST'
    const doorSign = makeSign(title, 1.7, 0.26, '#0f172a', '#fbbf24')
    const sx = side === 'west' ? ROOM.minX + 0.04 : ROOM.maxX - 0.04
    doorSign.position.set(sx, ANNEX_DOOR.height + 0.4, ANNEX_DOOR.z)
    doorSign.rotation.y = side === 'west' ? Math.PI / 2 : -Math.PI / 2
    this.root.add(doorSign)
    const hallSign = makeSign(title, 2.4, 0.34, '#0f172a', '#e2e8f0')
    hallSign.position.set(cx, h - 0.45, minZ + 0.03)
    this.root.add(hallSign)
  }

  /** Start the "rising out of the ground" animation (a freshly bought annex). */
  appear(): void {
    this.rise = 0
    this.root.scale.y = 0.001
  }

  update(dt: number): void {
    if (this.rise >= 1) return
    this.rise = Math.min(1, this.rise + dt / RISE_SECONDS)
    this.root.scale.y = Math.max(0.001, 1 - (1 - this.rise) ** 3)
  }

  dispose(): void {
    for (const body of this.bodies) this.physics.removeBody(body)
    this.bodies.length = 0
  }

  /** Solid wall: rendered, collides with the player, blocks reach. */
  private solid(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number): void {
    const mesh = new THREE.Mesh(metreUVs(new THREE.BoxGeometry(w, h, d)), material)
    mesh.position.set(x, y, z)
    mesh.receiveShadow = true
    mesh.castShadow = true
    markBlocker(mesh)
    this.root.add(mesh)
    this.bodies.push(this.physics.addStaticBox(mesh.position.clone(), new THREE.Vector3(w / 2, h / 2, d / 2)))
  }

  private deco(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number): void {
    const mesh = new THREE.Mesh(metreUVs(new THREE.BoxGeometry(w, h, d)), material)
    mesh.position.set(x, y, z)
    mesh.receiveShadow = true
    this.root.add(mesh)
  }
}
