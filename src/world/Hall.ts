import type RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { doorFrame, levelSign } from './details'
import { cableCoil, conduit, floorBundle } from './cables'
import { prop } from './props'
import type { PhysicsWorld } from '../engine/PhysicsWorld'
import { markBlocker } from './interactables'
import { FLOOR_HEIGHT, ROOM, SLAB, SOUTH, stairHole, WAREHOUSE, POWER_FEEDS } from './layout'
import { makeSign, mat } from './models'
import { ceilingMat, concreteFloor, glassMat, lightPanel, metreUVs, wallMat } from './textures'

export type HallKind = 'south' | 'floor1' | 'floor2'

/** Which level each hall is on: the south expansion is on the ground, floors 1 and 2 are stacked above it. */
export const HALL_LEVEL: Record<HallKind, number> = { south: 0, floor1: 1, floor2: 2 }

/** The line under the floor number on the floor signs. */
const SUBTITLES: Record<HallKind, string> = { south: 'SOUTH EXPANSION · STORAGE HALL', floor1: 'UPPER STORAGE HALL', floor2: 'TOP STORAGE HALL' }
const T = 0.2 // wall thickness
const H = ROOM.height
const RISE_SECONDS = 1.6
const WIN_W = 1.6
const WIN_H = 1.4
const SILL = 0.9

/**
 * One big storage hall: the south expansion behind the storage room, or a floor stacked on top of it. They all share one
 * footprint (see SOUTH in layout.ts). A hall owns its walls, its ceiling slab (which is also the floor of the hall above)
 * and its lights. Its locker banks and key racks are separate views the Engine places inside it.
 *
 * Ceiling slabs of the south hall and floor 1 have a stairwell hole closed by a removable hatch; buying the floor above
 * removes the hatch and builds the stairs through it (see `Stairs`).
 */
export class Hall {
  readonly root = new THREE.Group()
  readonly kind: HallKind
  readonly level: number
  private readonly physics: PhysicsWorld
  private readonly floorY: number
  private bodies: RAPIER.RigidBody[] = []
  private hatch: { mesh: THREE.Mesh; body: RAPIER.RigidBody } | null = null
  /** The panel in the east wall that is taken out when the warehouse is built (ground-floor south hall only). */
  private doorPlug: { mesh: THREE.Mesh; body: RAPIER.RigidBody } | null = null
  private rise = 1

  constructor(kind: HallKind, physics: PhysicsWorld) {
    this.kind = kind
    this.level = HALL_LEVEL[kind]
    this.physics = physics
    this.floorY = this.level * FLOOR_HEIGHT
    // Everything is positioned relative to this hall's floor so the hall can rise in place.
    this.root.position.y = this.floorY
    this.root.userData.zone = kind

    const { minX, maxX, minZ, maxZ } = SOUTH
    const wall = wallMat(0xd5d9de)
    // The slab's top face is the floor of the hall above; the rest is ceiling (faces: +x, −x, +y, −y, +z, −z).
    const edge = mat(0xbfbab0, 0.95)
    const slab = [edge, edge, concreteFloor(0x8f949a), ceilingMat(0xe7e5e0), edge, edge]
    const z0 = minZ - T // far end, outer face
    const z1 = maxZ + T // old back wall's south face plane, outer face
    const widthX = maxX - minX + 2 * T

    // The wire mess: bundles from the aisles between the locker rows and from the bay's belt drives, all down the corridor beside
    // the stairs and along the aisle in front of the bay into the electrical box, with a coil of spare cable on the floor.
    const box = POWER_FEEDS.hall.riser
    const runs: [number, readonly (readonly [number, number])[]][] = [
      [5, [[-5.6, -14.1], [3.55, -14.25], [3.6, -19.4], [-4.55, -19.42], [-4.82, -20.5]]],
      [4, [[-5.5, -17.15], [3.75, -17.2], [3.8, -19.5], [-4.4, -19.52], [-4.75, -20.5]]],
      [3, [[2.9, -11.4], [3.15, -11.6], [3.2, -19.2], [-4.65, -19.22], [-5.0, -20.5]]],
      [3, [[-3.3, -19.75], [-4.2, -19.68], [-4.7, -20.5]]],
    ]
    for (const [i, [count, route]] of runs.entries()) this.root.add(floorBundle(route, { ...box, x: box.x + (i - 1.5) * 0.05 }, count, 0, 1))
    this.root.add(cableCoil(-4.1, -20.45, [-4.75, -20.6]))
    this.root.add(cableCoil(3.95, -18.6, [3.6, -19.3], 0, 0x1e40af))

    // An electrical box on the far wall, west of the windows, with its conduit to the ceiling.
    this.root.add(prop('power_box_01', { x: minX + 0.9, y: 1.0, z: minZ + 0.2, height: 0.6 }))
    this.root.add(conduit([new THREE.Vector3(minX + 1.02, 1.56, minZ + 0.2), new THREE.Vector3(minX + 1.02, H - 0.05, minZ + 0.2)]))

    // Walls: west, east and the far (south) end. Floors above also need their own north wall (on the ground the old
    // back wall of the storage room is the north wall).
    // Windows are real openings with glass (the glass blocks you, so you cannot jump out). West: in the lobby, the aisle between
    // the rows and behind the last row. East: only beyond the stairs. South: either side of the hall's name.
    this.windowedWall('z', minX - T / 2, z0, z1, [-10.8, -14.2, -18.5], wall)
    if (kind === 'south') {
      // The south hall's east wall has a panel where the warehouse door will be cut (and the window beside it stays).
      const { z, halfWidth, height: doorH } = WAREHOUSE.door
      this.windowedWall('z', maxX + T / 2, z0, z - halfWidth, [-20.2], wall)
      this.windowedWall('z', maxX + T / 2, z + halfWidth, z1, [], wall)
      this.solid(T, H - doorH, halfWidth * 2, wall, maxX + T / 2, doorH + (H - doorH) / 2, z)
      this.doorPlug = this.solid(T, doorH, halfWidth * 2, wall, maxX + T / 2, doorH / 2, z)
    } else {
      // Floor 1's east wall is against the warehouse up to its roof (a window there would look at the roof edge): no window.
      this.windowedWall('z', maxX + T / 2, z0, z1, this.floorY + SILL < WAREHOUSE.height + 0.2 ? [] : [-20.2], wall)
    }
    this.windowedWall('x', minZ - T / 2, -widthX / 2, widthX / 2, [-3.5, 3.5], wall)
    if (this.level > 0) this.solid(widthX, H, T, wall, 0, H / 2, maxZ + T / 2)

    // Ground floor (upper floors stand on the slab of the hall below).
    if (this.level === 0) {
      const floor = new THREE.Mesh(metreUVs(new THREE.BoxGeometry(maxX - minX, 0.02, maxZ - minZ)), concreteFloor(0x8f949a))
      floor.position.set(0, 0.005, (minZ + maxZ) / 2)
      floor.receiveShadow = true
      this.root.add(floor)
    }

    this.buildCeilingSlab(slab, z0, z1)

    // Ceiling light fixtures (no real lights: the global light already fills the room, and many point lights are costly).
    const panel = lightPanel(0xfff8e7, 1.3)
    for (const x of [-2.5, 2.5]) {
      for (const z of [-13.5, -18]) {
        const fixture = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.05, 0.4), panel)
        fixture.position.set(x, H - 0.03, z)
        this.root.add(fixture)
      }
    }

    // Signs: the hall's name on its far wall, and (south hall only) above the new doorway in the storage room.
    // Floor signs: on the far wall, and on the north wall facing into the hall (above the key racks on the ground floor).
    const title = levelSign(this.level, SUBTITLES[kind], 2.2, 0.5)
    title.position.set(0, H - 0.36, minZ + 0.03)
    this.root.add(title)
    const north = levelSign(this.level, SUBTITLES[kind], 2.0, 0.48)
    north.position.set(1.6, H - 0.45, maxZ - 0.03)
    north.rotation.y = Math.PI
    this.root.add(north)
    if (this.level === 0) {
      const doorSign = makeSign('SOUTH EXPANSION', 1.6, 0.26, '#0f172a', '#fbbf24')
      doorSign.position.set(SOUTH.door.x, SOUTH.door.height + 0.4, ROOM.minZ + 0.03)
      this.root.add(doorSign)
    }
  }

  /** Start the "rising out of the ground" animation (a freshly bought hall). */
  appear(): void {
    this.rise = 0
    this.root.scale.y = 0.001
  }

  update(dt: number): void {
    if (this.rise >= 1) return
    this.rise = Math.min(1, this.rise + dt / RISE_SECONDS)
    this.root.scale.y = Math.max(0.001, 1 - (1 - this.rise) ** 3)
  }

  /** Cut the door in the east wall (the warehouse is built): remove the panel, add a frame and a sign. */
  openWarehouseDoor(): void {
    const plug = this.doorPlug
    if (!plug) return
    this.root.remove(plug.mesh)
    this.physics.removeBody(plug.body)
    this.bodies = this.bodies.filter((b) => b !== plug.body)
    this.doorPlug = null
    const { z, halfWidth, height } = WAREHOUSE.door
    this.root.add(doorFrame('z', SOUTH.maxX + T / 2, z, halfWidth, height, T))
    const sign = makeSign('WAREHOUSE', 1.5, 0.24, '#0f172a', '#fbbf24')
    sign.position.set(SOUTH.maxX - 0.04, height + 0.4, z)
    sign.rotation.y = -Math.PI / 2 // faces into the hall (−x)
    this.root.add(sign)
  }

  /** Take out the stairwell hatch so the stairs to the next floor can go through the ceiling. */
  openHatch(): void {
    if (!this.hatch) return
    this.root.remove(this.hatch.mesh)
    this.physics.removeBody(this.hatch.body)
    this.bodies = this.bodies.filter((b) => b !== this.hatch?.body)
    this.hatch = null
  }

  dispose(): void {
    for (const body of this.bodies) this.physics.removeBody(body)
    this.bodies = []
    this.hatch = null
  }

  /**
   * A wall with window openings. `axis` is the way the wall runs: 'z' for the west and east walls, 'x' for the far wall.
   * `fixed` is the wall's centre on the other axis; `centers` are the windows' centres along the wall.
   */
  private windowedWall(axis: 'z' | 'x', fixed: number, from: number, to: number, centers: number[], material: THREE.Material): void {
    const piece = (a: number, b: number, y0: number, y1: number) => {
      const len = b - a
      if (len < 0.01) return
      const h = y1 - y0
      const mid = (a + b) / 2
      if (axis === 'z') this.solid(T, h, len, material, fixed, y0 + h / 2, mid)
      else this.solid(len, h, T, material, mid, y0 + h / 2, fixed)
    }
    piece(from, to, 0, SILL) // below the windows
    piece(from, to, SILL + WIN_H, H) // above them
    let cursor = from
    for (const c of [...centers].sort((a, b) => a - b)) {
      piece(cursor, c - WIN_W / 2, SILL, SILL + WIN_H) // the pier between windows
      cursor = c + WIN_W / 2
      const glassY = SILL + WIN_H / 2
      const pane = axis === 'z' ? this.solid(0.04, WIN_H, WIN_W, glassMat(0.22), fixed, glassY, c) : this.solid(WIN_W, WIN_H, 0.04, glassMat(0.22), c, glassY, fixed)
      pane.mesh.castShadow = false
      // A sill ledge on the inside.
      const sill = new THREE.Mesh(
        axis === 'z' ? new THREE.BoxGeometry(0.3, 0.05, WIN_W + 0.2) : new THREE.BoxGeometry(WIN_W + 0.2, 0.05, 0.3),
        mat(0xf1f5f9, 0.7),
      )
      const inward = axis === 'z' ? (fixed < 0 ? 0.12 : -0.12) : 0.12
      if (axis === 'z') sill.position.set(fixed + inward, SILL + 0.02, c)
      else sill.position.set(c, SILL + 0.02, fixed + inward)
      this.root.add(sill)
    }
    piece(cursor, to, SILL, SILL + WIN_H)
  }

  /**
   * The ceiling slab (the floor of the next level up). Below the top floor it has a stairwell hole, built as four slab
   * pieces around the hole plus a hatch that fills the hole until the floor above is bought.
   */
  private buildCeilingSlab(material: THREE.Material[], z0: number, z1: number): void {
    const y = H + SLAB / 2
    const x0 = SOUTH.minX - T
    const x1 = SOUTH.maxX + T
    const lenZ = z1 - z0
    const cz = (z0 + z1) / 2
    if (this.kind === 'floor2') {
      this.solid(x1 - x0, SLAB, lenZ, material, (x0 + x1) / 2, y, cz) // the roof: no hole
      return
    }
    const hole = stairHole(this.level)
    const hx = (hole.x0 + hole.x1) / 2
    const hw = hole.x1 - hole.x0
    this.solid(hole.x0 - x0, SLAB, lenZ, material, (x0 + hole.x0) / 2, y, cz) // west of the hole
    this.solid(x1 - hole.x1, SLAB, lenZ, material, (hole.x1 + x1) / 2, y, cz) // east of the hole
    this.solid(hw, SLAB, z1 - hole.z1, material, hx, y, (hole.z1 + z1) / 2) // north of the hole
    this.solid(hw, SLAB, hole.z0 - z0, material, hx, y, (z0 + hole.z0) / 2) // south of the hole
    this.hatch = this.solid(hw, SLAB, hole.z1 - hole.z0, material, hx, y, (hole.z0 + hole.z1) / 2)
  }

  /** Solid box: rendered, collides with the player, blocks reach. `y` is relative to this hall's floor. */
  private solid(w: number, h: number, d: number, material: THREE.Material | THREE.Material[], x: number, y: number, z: number) {
    const mesh = new THREE.Mesh(metreUVs(new THREE.BoxGeometry(w, h, d)), material)
    mesh.position.set(x, y, z)
    mesh.receiveShadow = true
    mesh.castShadow = true
    markBlocker(mesh)
    this.root.add(mesh)
    const body = this.physics.addStaticBox(new THREE.Vector3(x, y + this.floorY, z), new THREE.Vector3(w / 2, h / 2, d / 2))
    this.bodies.push(body)
    return { mesh, body }
  }
}
