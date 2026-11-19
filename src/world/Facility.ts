import * as THREE from 'three'
import { doorFrame, flatRoof, rooftopUnit, tree } from './details'
import { conduit } from './cables'
import type { PhysicsWorld } from '../engine/PhysicsWorld'
import { markBlocker, tag } from './interactables'
import type RAPIER from '@dimforge/rapier3d-compat'
import { ANNEX_DOOR, CATALOGUE_DESK, CONVEYOR, COUNTER, ENTRANCE, FLOOR_Y, KEY_BOARD, OFFICE_DOOR, PARTITION, ROOM, SOUTH, UNDERGROUND, LAKE, HARBOUR } from './layout'
import { mat } from './models'
import { prop } from './props'
import { blockBush, bollard, downlight, hazardStripes, shopSign, wallPanelDark } from './facade'
import { carpetFloor, ceilingMat, concreteFloor, glassMat, grassMat, lightPanel, metreUVs, roadAsphalt, roofGravel, textured, tileFloor, wallMat, woodMat } from './textures'

/**
 * The static building: street outside, shop front, lobby, counter, staff area, partition and storage
 * room shell. Lockers, keys and people are separate views that read the simulation.
 */
/** Where the sun sits relative to the point it lights (the same angle as before), and half the width of its shadow box. */
const SUN_OFFSET = new THREE.Vector3(-8, 14, 16)
const SHADOW_HALF = 16

export class Facility {
  readonly root = new THREE.Group()
  /** The sun. Its shadow covers a square around the player (`followSun`), so the far rooms, halls and the warehouse get shadows too. */
  private readonly sun = new THREE.DirectionalLight(0xfff1d6, 1.6)
  private readonly physics: PhysicsWorld
  private doorL: THREE.Mesh | null = null
  private doorR: THREE.Mesh | null = null
  private doorOpen = 0
  /** The removable wall panel at each annex doorway, and the unit-next-door block that an annex replaces. */
  private readonly plugs = new Map<'west' | 'east' | 'office', THREE.Mesh>()
  /** The front half of the unit east of the lobby (the deal office is built inside it), and the office's door frame. */
  private neighbourFront: THREE.Mesh | null = null
  private officeFrame: THREE.Group | null = null
  private readonly neighbourBack = new Map<'west' | 'east', THREE.Mesh>()
  private readonly doorFrames = new Map<'west' | 'east', THREE.Group>()
  /** The removable panel in the back wall where the south expansion's doorway is cut, and its door frame. */
  private southPlug: THREE.Mesh | null = null
  private southFrame: THREE.Group | null = null
  /** The removable panel in the partition where the conveyor belts pass through, and its frame. */
  private hatchPlug: THREE.Mesh | null = null
  private hatchFrame: THREE.Group | null = null
  /** The ground's plug over the underground vault's shaft (its collider) and the foundation piece over it, until the vault is built. */
  private vaultPlug: THREE.Mesh | null = null
  private vaultCap: THREE.Mesh | null = null
  private vaultOpen = false
  /** The "KEYS" sign over the key board (it goes when the keys do). */
  private keysSign: THREE.Object3D | null = null

  constructor(physics: PhysicsWorld) {
    this.physics = physics
    this.buildOutside()
    this.buildShell()
    this.buildLobby()
    this.buildCounter()
    this.buildStaffArea()
    this.buildCatalogueDesk()
    this.buildLights()
  }

  /** Slide the glass entrance doors open while someone is near them. */
  /**
   * Keep the sun's shadow box centred on the player. It moves in whole shadow-map texels (snapped), so shadow edges do not
   * shimmer as you walk.
   */
  followSun(x: number, y: number, z: number): void {
    const texel = (SHADOW_HALF * 2) / this.sun.shadow.mapSize.x
    const step = texel * 8
    const cx = Math.round(x / step) * step
    const cz = Math.round(z / step) * step
    const cy = Math.max(0, Math.round(y / 3) * 3 - 1.5)
    this.sun.target.position.set(cx, cy, cz)
    this.sun.position.set(cx + SUN_OFFSET.x, cy + SUN_OFFSET.y, cz + SUN_OFFSET.z)
  }

  update(dt: number, someoneNearDoor: boolean): void {
    const target = someoneNearDoor ? 1 : 0
    this.doorOpen += (target - this.doorOpen) * Math.min(1, dt * 5)
    const slide = this.doorOpen * 0.98
    if (this.doorL) this.doorL.position.x = -0.5 - slide
    if (this.doorR) this.doorR.position.x = 0.5 + slide
  }

  // ------------------------------------------------------------------ helpers

  /** Solid box: rendered, collides with the player, blocks reach. */
  private solid(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const mesh = new THREE.Mesh(metreUVs(new THREE.BoxGeometry(w, h, d)), material)
    mesh.position.set(x, y, z)
    mesh.receiveShadow = true
    mesh.castShadow = true
    markBlocker(mesh)
    this.root.add(mesh)
    // Kept so a wall panel can be taken out again (the annex doorways).
    mesh.userData.body = this.physics.addStaticBox(mesh.position.clone(), new THREE.Vector3(w / 2, h / 2, d / 2))
    mesh.userData.half = new THREE.Vector3(w / 2, h / 2, d / 2)
    return mesh
  }

  /**
   * Knock through (or wall up again) the doorway into the unit next door. Opening removes the wall panel and its
   * collider, hides the neighbour's back half (the annex room takes its place) and adds a door frame.
   */
  setAnnexOpen(side: 'west' | 'east', open: boolean): void {
    const plug = this.plugs.get(side)
    const back = this.neighbourBack.get(side)
    if (!plug || !back) return
    const isOpen = plug.parent === null
    if (open === isOpen) return
    if (open) {
      this.root.remove(plug)
      this.physics.removeBody(plug.userData.body as RAPIER.RigidBody)
      this.root.remove(back)
      const frame = this.makeDoorFrame(side)
      this.doorFrames.set(side, frame)
      this.root.add(frame)
    } else {
      this.root.add(plug)
      plug.userData.body = this.physics.addStaticBox(plug.position.clone(), plug.userData.half as THREE.Vector3)
      this.root.add(back)
      const frame = this.doorFrames.get(side)
      if (frame) this.root.remove(frame)
      this.doorFrames.delete(side)
    }
  }

  private makeDoorFrame(side: 'west' | 'east'): THREE.Group {
    const { z, halfWidth, height } = ANNEX_DOOR
    return doorFrame('z', side === 'west' ? ROOM.minX - 0.1 : ROOM.maxX + 0.1, z, halfWidth, height)
  }

  /** The storage room's back wall, with a removable panel where the south expansion's doorway is cut. */
  private buildBackWall(): void {
    const { minX, maxX, minZ, height } = ROOM
    const t = 0.2
    const wall = wallMat(0xe9e4da)
    const { x, halfWidth, height: doorH } = SOUTH.door
    const z = minZ - t / 2
    const x0 = minX - t
    const x1 = maxX + t
    const lo = x - halfWidth
    const hi = x + halfWidth
    this.solid(lo - x0, height, t, wall, (x0 + lo) / 2, height / 2, z)
    this.solid(x1 - hi, height, t, wall, (hi + x1) / 2, height / 2, z)
    this.solid(halfWidth * 2, height - doorH, t, wall, x, doorH + (height - doorH) / 2, z)
    this.southPlug = this.solid(halfWidth * 2, doorH, t, wall, x, doorH / 2, z)
  }

  /** Knock through (or wall up again) the doorway into the south expansion. */
  setSouthOpen(open: boolean): void {
    const plug = this.southPlug
    if (!plug) return
    const isOpen = plug.parent === null
    if (open === isOpen) return
    if (open) {
      this.root.remove(plug)
      this.physics.removeBody(plug.userData.body as RAPIER.RigidBody)
      const { x, halfWidth, height } = SOUTH.door
      const frame = doorFrame('x', x, ROOM.minZ - 0.1, halfWidth, height)
      this.southFrame = frame
      this.root.add(frame)
    } else {
      this.root.add(plug)
      plug.userData.body = this.physics.addStaticBox(plug.position.clone(), plug.userData.half as THREE.Vector3)
      if (this.southFrame) this.root.remove(this.southFrame)
      this.southFrame = null
    }
  }

  /** The keys are gone (digital lockers): take the "KEYS" sign down. */
  setKeysSignVisible(visible: boolean): void {
    if (this.keysSign) this.keysSign.visible = visible
  }

  /** Cut (or fill in again) the hatch in the partition for the conveyor belts, with a dark frame and rubber flaps. */
  setConveyorOpen(open: boolean): void {
    const plug = this.hatchPlug
    if (!plug) return
    const isOpen = plug.parent === null
    if (open === isOpen) return
    if (open) {
      this.root.remove(plug)
      this.physics.removeBody(plug.userData.body as RAPIER.RigidBody)
      const frame = new THREE.Group()
      const trim = mat(0x374151, 0.6, 0.3)
      const { minX, maxX, height } = CONVEYOR.hatch
      const z = PARTITION.z
      const w = maxX - minX
      for (const [x, y, bw, bh] of [
        // Standing proud of the opening's cut edges, so no face is in a wall face's plane (they would flicker).
        [(minX + maxX) / 2, height - 0.01, w + 0.08, 0.1],
        [minX + 0.01, height / 2, 0.08, height],
        [maxX - 0.01, height / 2, 0.08, height],
      ] as const) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.34), trim)
        bar.position.set(x, y, z)
        frame.add(bar)
      }
      // Rubber flaps hanging in the opening (the belts run under them).
      const rubber = mat(0x111827, 0.9)
      for (let i = 0; i < 6; i++) {
        const flap = new THREE.Mesh(new THREE.BoxGeometry(w / 6 - 0.02, 0.28, 0.02), rubber)
        flap.position.set(minX + (w / 6) * (i + 0.5), height - 0.16, z + 0.05)
        frame.add(flap)
      }
      this.hatchFrame = frame
      this.root.add(frame)
    } else {
      this.root.add(plug)
      plug.userData.body = this.physics.addStaticBox(plug.position.clone(), plug.userData.half as THREE.Vector3)
      if (this.hatchFrame) this.root.remove(this.hatchFrame)
      this.hatchFrame = null
    }
  }

  /** A side wall of the storage room with a removable panel where an annex doorway can be cut. */
  private buildSideWall(side: 'west' | 'east'): void {
    const { minX, maxX, minZ, maxZ, height } = ROOM
    const t = 0.2
    const wall = wallMat(0xe9e4da)
    const x = side === 'west' ? minX - t / 2 : maxX + t / 2
    // The east wall also has the deal office's doorway (up in the lobby); each doorway is a removable panel under a lintel.
    const doors = [{ key: side as 'west' | 'east' | 'office', ...ANNEX_DOOR }]
    if (side === 'east') doors.push({ key: 'office', ...OFFICE_DOOR })
    doors.sort((p, q) => p.z - q.z)
    let cursor = minZ
    for (const { key, z, halfWidth, height: doorH } of doors) {
      const lo = z - halfWidth
      const hi = z + halfWidth
      this.solid(t, height, lo - cursor, wall, x, height / 2, (cursor + lo) / 2)
      this.solid(t, height - doorH, halfWidth * 2, wall, x, doorH + (height - doorH) / 2, z)
      this.plugs.set(key, this.solid(t, doorH, halfWidth * 2, wall, x, doorH / 2, z))
      cursor = hi
    }
    this.solid(t, height, maxZ - cursor, wall, x, height / 2, (cursor + maxZ) / 2)
  }

  /** Open the shaft down to the underground vault (or close it again for a new game). */
  setVaultOpen(open: boolean): void {
    const plug = this.vaultPlug
    if (!plug || open === this.vaultOpen) return
    this.vaultOpen = open
    if (open) {
      this.physics.removeBody(plug.userData.body as RAPIER.RigidBody)
      if (this.vaultCap) this.root.remove(this.vaultCap)
    } else {
      plug.userData.body = this.physics.addStaticBox(plug.position.clone(), plug.userData.half as THREE.Vector3)
      if (this.vaultCap) this.root.add(this.vaultCap)
    }
  }

  /**
   * Knock through (or wall up again) the doorway into the deal office. Opening removes the wall panel and its collider, shrinks the
   * neighbour's front block to what is left of the unit east of the office, and adds a door frame.
   */
  setOfficeOpen(open: boolean): void {
    const plug = this.plugs.get('office')
    const block = this.neighbourFront
    if (!plug || !block) return
    const isOpen = plug.parent === null
    if (open === isOpen) return
    if (open) {
      this.root.remove(plug)
      this.physics.removeBody(plug.userData.body as RAPIER.RigidBody)
      // The block spans x 6.2…16.2; the office takes the west part, leaving x 12.6…16.2.
      block.scale.x = 3.6 / 10
      block.position.x = 14.4
      const frame = doorFrame('z', ROOM.maxX + 0.1, OFFICE_DOOR.z, OFFICE_DOOR.halfWidth, OFFICE_DOOR.height)
      this.officeFrame = frame
      this.root.add(frame)
    } else {
      this.root.add(plug)
      plug.userData.body = this.physics.addStaticBox(plug.position.clone(), plug.userData.half as THREE.Vector3)
      block.scale.x = 1
      block.position.x = 11.2
      if (this.officeFrame) this.root.remove(this.officeFrame)
      this.officeFrame = null
    }
  }

  private deco(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const mesh = new THREE.Mesh(metreUVs(new THREE.BoxGeometry(w, h, d)), material)
    mesh.position.set(x, y, z)
    mesh.receiveShadow = true
    this.root.add(mesh)
    return mesh
  }

  private sign(text: string, w: number, h: number, bg: string, fg: string): THREE.Mesh {
    const canvas = document.createElement('canvas')
    canvas.width = 1024
    canvas.height = Math.round((1024 * h) / w)
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = fg
      ctx.font = `700 ${Math.round(canvas.height * 0.5)}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, canvas.width / 2, canvas.height / 2)
    }
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }))
  }

  // ------------------------------------------------------------------ parts

  private buildOutside(): void {
    // The ground, with the underground vault's shaft cut out of it (closed by a plug until the vault is built).
    const hole = UNDERGROUND.hatch
    // Grass from the beach (west) to the far side, with the harbour's basin cut out of its west edge (the Lake covers it with grass
    // where nothing has been dug yet).
    const B = HARBOUR.basin
    const notch: [number, number][] = [[LAKE.coast.grassX, B.maxZ], [B.maxX, B.maxZ], [B.maxX, B.minZ], [LAKE.coast.grassX, B.minZ]]
    const outline: [number, number][] = [[100, -100], [100, 100], [LAKE.coast.grassX, 100], ...notch, [LAKE.coast.grassX, -100]]
    const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)))
    // Shape y becomes −z once the plane is laid flat.
    const cut = new THREE.Path()
    cut.moveTo(hole.minX, -hole.maxZ)
    cut.lineTo(hole.minX, -hole.minZ)
    cut.lineTo(hole.maxX, -hole.minZ)
    cut.lineTo(hole.maxX, -hole.maxZ)
    cut.closePath()
    shape.holes.push(cut)
    const ground = new THREE.Mesh(new THREE.ShapeGeometry(shape), grassMat(0x5f8a46))
    ground.rotation.x = -Math.PI / 2
    ground.position.y = FLOOR_Y - 0.02
    ground.receiveShadow = true
    this.root.add(ground)
    for (const r of aroundHole(LAKE.coast.shoreX, 60, -60, 60, hole)) {
      this.physics.addStaticBox(new THREE.Vector3((r.minX + r.maxX) / 2, -0.5, (r.minZ + r.maxZ) / 2), new THREE.Vector3((r.maxX - r.minX) / 2, 0.48, (r.maxZ - r.minZ) / 2))
    }
    const plug = new THREE.Mesh(new THREE.BoxGeometry(hole.maxX - hole.minX, 0.96, hole.maxZ - hole.minZ), new THREE.MeshBasicMaterial({ visible: false }))
    plug.position.set((hole.minX + hole.maxX) / 2, -0.5, (hole.minZ + hole.maxZ) / 2)
    plug.userData.half = new THREE.Vector3((hole.maxX - hole.minX) / 2, 0.48, (hole.maxZ - hole.minZ) / 2)
    plug.userData.body = this.physics.addStaticBox(plug.position.clone(), plug.userData.half as THREE.Vector3)
    this.vaultPlug = plug

    // Trees round the complex: along the west side, behind the halls, and across the service road (none on a path or a drive).
    for (const [i, [x, z, h]] of ([
      [-11, -19.5, 5.5], [-10.5, -13.5, 6.5], [-8.8, -23, 5], [-8.5, -31.5, 6], [-10, -34, 5.5], [-1, -35, 4.8],
      [2.5, -40, 6], [-12, -40, 5.2], [52, -6, 6], [53, -22, 5.4], [51, -38, 6.4], [54, -55, 5.6], [-21, 3, 6],
    ] as const).entries())
      this.root.add(tree(x, z, h, i + 1))

    // A concrete foundation under the whole building, just below every floor: no grass shows through at door thresholds
    // or where a floor stops short of a wall (from the pavement back to the warehouse, the shop's west wall to the yard).
    const foundation = concreteFloor(0x9a9ea3)
    for (const r of aroundHole(-6.3, 24.3, -31.5, 6.25, hole)) this.deco(r.maxX - r.minX, 0.01, r.maxZ - r.minZ, foundation, (r.minX + r.maxX) / 2, -0.006, (r.minZ + r.maxZ) / 2)
    this.vaultCap = this.deco(hole.maxX - hole.minX, 0.01, hole.maxZ - hole.minZ, foundation, (hole.minX + hole.maxX) / 2, -0.006, (hole.minZ + hole.maxZ) / 2)
    this.deco(60, 0.04, 4, mat(0xbdb8b0, 0.95), 0, 0.0, 8.2)
    this.deco(60, 0.03, 8, roadAsphalt(0x3a3d43), 0, -0.005, 14.2)
    // The main street carries on west to the beach, where it ends.
    const extX = (LAKE.coast.grassX - 30) / 2 // the middle of x -30…grassX
    this.deco(-30 - LAKE.coast.grassX, 0.03, 8, roadAsphalt(0x3a3d43), extX, -0.005, 14.2)
    this.deco(-30 - LAKE.coast.grassX, 0.04, 4, mat(0xbdb8b0, 0.95), extX, 0.0, 8.2)
    for (let x = -32; x > LAKE.coast.grassX + 2; x -= 4) this.deco(2, 0.01, 0.15, mat(0xf2d16b, 0.6), x, 0.012, 14.2)
    for (let x = -28; x < 30; x += 4) this.deco(2, 0.01, 0.15, mat(0xf2d16b, 0.6), x, 0.012, 14.2)

    // The buildings across the street, the lamps, benches, traffic and passers-by are the Town's (world/Town.ts).
    // Neighbouring shops on our side.
    // Each is a front half and a back half: the back half is what an annex replaces when it is built.
    const west = wallMat(0xb9a58f)
    const east = wallMat(0xa9b6bf)
    this.deco(10, 4.4, 8.5, west, -11.2, 2.2, 1.75)
    this.neighbourFront = this.deco(10, 3.8, 8.5, east, 11.2, 1.9, 1.75)
    this.neighbourBack.set('west', this.deco(10, 4.4, 6.5, west, -11.2, 2.2, -5.75))
    this.neighbourBack.set('east', this.deco(10, 3.8, 6.5, east, 11.2, 1.9, -5.75))
    // The west neighbour: a shopfront (dark glass under a striped awning), a cornice and a gravel roof with a parapet.
    const glassDark = mat(0x22313f, 0.15, 0.6)
    this.deco(7.6, 2.0, 0.06, glassDark, -11.2, 1.45, 6.03)
    this.deco(7.8, 0.12, 0.08, mat(0x1f2937, 0.5, 0.4), -11.2, 2.5, 6.04)
    for (let k = 0; k < 8; k++) this.deco(1.0, 0.32, 0.9, mat(k % 2 ? 0xf5f1e6 : 0x15803d, 0.7), -14.7 + k * 1.0, 2.8, 6.5)
    this.deco(10.1, 0.18, 0.2, mat(0xe7e2d6, 0.6), -11.2, 4.25, 6.05)
    this.root.add(flatRoof(-16.2, -6.2, -9.0, 6.0, 4.4, west, roofGravel(0x9a9a95), 'e'))
  }

  private buildShell(): void {
    const { minX, maxX, minZ, maxZ, height } = ROOM
    const t = 0.2
    const width = maxX - minX
    const depth = maxZ - minZ
    const cz = (minZ + maxZ) / 2

    // Floors: warm tiles in the lobby, grey vinyl behind the counter and in storage.
    this.deco(width, 0.02, maxZ - COUNTER.z, tileFloor(0xcdbfa8), 0, 0.005, (maxZ + COUNTER.z) / 2)
    this.deco(width, 0.02, COUNTER.z - minZ, concreteFloor(0x8f949a), 0, 0.005, (COUNTER.z + minZ) / 2)
    const ceiling = this.deco(width, 0.1, depth, ceilingMat(0xf4f2ee), 0, height + 0.05, cz)
    ceiling.receiveShadow = false

    // The flat roof: gravel inside a parapet (no parapet at the back, where the halls rise), two air-handling units.
    this.root.add(flatRoof(minX - t, maxX + t, minZ - t, maxZ + t, height + 0.1, mat(0x2f3e4f, 0.6, 0.2), roofGravel(0x9a9a95), 's'))
    this.root.add(rooftopUnit(-3.2, height + 0.16, 1.5, 0.2))
    this.root.add(rooftopUnit(3.4, height + 0.16, -3.5, -0.1))

    // Side walls (each has a panel that can be knocked out for an annex) and the back wall.
    this.buildSideWall('west')
    this.buildSideWall('east')
    this.buildBackWall()

    // Front wall with a glass entrance and two shop windows.
    // Dark composite panels (the facade sheet's Wall_Panel_Dark).
    const front = wallPanelDark()
    const sideW = maxX - ENTRANCE.halfWidth
    const sideX = ENTRANCE.halfWidth + sideW / 2
    for (const s of [-1, 1]) {
      this.solid(sideW, 0.9, t, front, s * sideX, 0.45, maxZ + t / 2)
      this.solid(sideW, height - 2.5, t, front, s * sideX, 2.5 + (height - 2.5) / 2, maxZ + t / 2)
      this.solid(0.2, 1.6, t, front, s * (ENTRANCE.halfWidth + 0.1), 1.7, maxZ + t / 2)
      this.solid(0.2, 1.6, t, front, s * (maxX - 0.1), 1.7, maxZ + t / 2)
      const glass = new THREE.Mesh(
        new THREE.BoxGeometry(sideW - 0.4, 1.6, 0.04),
        glassMat(0.28),
      )
      glass.position.set(s * sideX, 1.7, maxZ + t / 2)
      markBlocker(glass)
      this.root.add(glass)
      this.physics.addStaticBox(glass.position.clone(), new THREE.Vector3((sideW - 0.4) / 2, 0.8, 0.05))
    }
    this.solid(ENTRANCE.halfWidth * 2, height - ENTRANCE.height, t, front, 0, ENTRANCE.height + (height - ENTRANCE.height) / 2, maxZ + t / 2)

    // A steel canopy over the shopfront, hung on tie rods, with a soffit light strip under it.
    const canopy = new THREE.Group()
    const steelDark = mat(0x1f2937, 0.5, 0.4)
    const cz0 = maxZ + t
    const cDepth = 1.3
    const cy = 2.47 // just above the doors, below the shop sign
    const cw = (maxX - minX) + 0.4
    const slab = new THREE.Mesh(new THREE.BoxGeometry(cw, 0.12, cDepth), steelDark)
    slab.position.set(0, cy, cz0 + cDepth / 2)
    slab.castShadow = true
    canopy.add(slab)
    const fascia = new THREE.Mesh(new THREE.BoxGeometry(cw, 0.14, 0.05), mat(0xfbbf24, 0.5, 0.2))
    fascia.position.set(0, cy, cz0 + cDepth)
    canopy.add(fascia)
    const strip = new THREE.Mesh(new THREE.BoxGeometry(cw - 0.6, 0.02, 0.08), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3d6, emissiveIntensity: 1.4 }))
    strip.position.set(0, cy - 0.07, cz0 + cDepth - 0.25)
    canopy.add(strip)
    for (const x of [-5.2, -1.6, 1.6, 5.2]) {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.5, 6), mat(0x9ca3af, 0.4, 0.6))
      rod.position.set(x, cy + 0.55, cz0 + cDepth / 2 + 0.05)
      rod.rotation.x = -Math.atan2(1.1, cDepth - 0.1)
      canopy.add(rod)
    }
    this.root.add(canopy)

    // Planters either side of the door (the street lamps are the Town's).
    for (const sx of [-1, 1]) {
      const px = sx * 2.1
      this.deco(0.9, 0.5, 0.5, mat(0x374151, 0.6), px, 0.25, maxZ + t + 0.45)
      this.root.add(blockBush(px, 0.5, maxZ + t + 0.45, 0.8, sx + 3))
    }

    // Sliding glass doors (visual only; customers and the player pass when open).
    const doorMat = glassMat(0.32, 0xcfe6f2)
    const frameMat = mat(0x6b7280, 0.4, 0.6)
    const makeDoor = (x: number) => {
      const door = new THREE.Mesh(new THREE.BoxGeometry(1, ENTRANCE.height - 0.05, 0.04), doorMat)
      door.position.set(x, (ENTRANCE.height - 0.05) / 2, maxZ + 0.3)
      door.add(new THREE.Mesh(new THREE.BoxGeometry(1, 0.06, 0.06), frameMat).translateY(-(ENTRANCE.height - 0.05) / 2 + 0.03))
      door.add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.06), frameMat).translateX(x < 0 ? 0.45 : -0.45))
      this.root.add(door)
      return door
    }
    this.doorL = makeDoor(-0.5)
    this.doorR = makeDoor(0.5)

    const sign = shopSign(4.6, 0.66, 'LOCKER MANAGER')
    sign.position.set(0, 2.86, maxZ + 0.3)
    this.root.add(sign)
    // Warm downlights under the canopy, each throwing a pool of light on the pavement; bollards along the kerb of the forecourt.
    for (const x of [-4.6, -2.2, 2.2, 4.6]) this.root.add(downlight(x, 2.4, maxZ + t + 0.7))
    for (const x of [-5.6, -3.7, -1.8, 1.8, 3.7, 5.6]) {
      this.root.add(bollard(x, 7.05))
      this.physics.addStaticBox(new THREE.Vector3(x, 0.45, 7.05), new THREE.Vector3(0.12, 0.45, 0.12))
    }
    // The VIP's parking bay in front of the office: yellow lines and a hazard-striped kerb.
    const bay = mat(0xf2c230, 0.6)
    for (const z of [10.35, 12.65]) this.deco(5.4, 0.012, 0.12, bay, 9.3, 0.014, z)
    for (const x of [6.6, 12.0]) this.deco(0.12, 0.012, 2.3, bay, x, 0.014, 11.5)
    this.deco(5.4, 0.05, 0.16, hazardStripes(), 9.3, 0.045, 10.2)
    const hours = this.sign('Bag & luggage storage · Open', 2.2, 0.28, '#f8fafc', '#0f172a')
    hours.position.set(-3.5, 2.1, maxZ + 0.32)
    this.root.add(hours)
  }

  private buildLobby(): void {
    // Bench along the left wall.
    const wood = woodMat(0x8a5a3b)
    const steel = mat(0x4b5563, 0.4, 0.6)
    this.solid(0.5, 0.08, 2.4, wood, ROOM.minX + 0.4, 0.46, 3.8)
    for (const z of [2.8, 4.8]) this.deco(0.06, 0.42, 0.06, steel, ROOM.minX + 0.4, 0.21, z)
    // Plants in the corners and fire extinguishers either side of the storage doorway.
    for (const [x, z] of [
      [ROOM.maxX - 0.5, 5.4],
      [ROOM.minX + 0.5, 5.4],
    ] as const) {
      this.root.add(prop('potted_plant_02', { x, z, height: 1.4 }))
      this.physics.addStaticBox(new THREE.Vector3(x, 0.5, z), new THREE.Vector3(0.25, 0.5, 0.25))
    }
    for (const [x, z] of [
      [1.35, PARTITION.z + 0.26],
      [-3.6, PARTITION.z - 0.26],
    ] as const)
      this.root.add(prop('korean_fire_extinguisher_01', { x, z, height: 0.6 }))
    // An electrical box on the storage side of the partition, its conduit up into the ceiling.
    // (The model's door hangs open beside the box, so the box itself is ~0.12 m to one side of the model's centre.)
    this.root.add(prop('power_box_01', { x: 5.0, y: 1.0, z: PARTITION.z - 0.34, rotY: Math.PI, height: 0.6 }))
    this.root.add(conduit([new THREE.Vector3(4.88, 1.56, PARTITION.z - 0.34), new THREE.Vector3(4.88, ROOM.height - 0.05, PARTITION.z - 0.34)]))
    // Rug and queue posts.
    this.deco(2.4, 0.01, 2.6, carpetFloor(0x7c2d12), 0, 0.02, 3.3)
    const price = this.sign('Storage $15 · pay on collection', 2.4, 0.4, '#1e293b', '#e2e8f0')
    price.position.set(3.3, 2.2, ROOM.maxZ - 0.11)
    price.rotation.y = Math.PI
    this.root.add(price)
  }

  private buildCounter(): void {
    const { minX, maxX, z, depth, height } = COUNTER
    const w = maxX - minX
    const cx = (minX + maxX) / 2
    this.solid(w, height - 0.06, depth, mat(0x334155, 0.6), cx, (height - 0.06) / 2, z)
    const top = this.deco(w + 0.1, 0.06, depth + 0.14, mat(0xd6c7ae, 0.4), cx, height - 0.03, z)
    markBlocker(top)
    // Bell and a "staff only" sign on the counter.
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xd4af37, 0.3, 0.9))
    bell.position.set(1.6, height, z + 0.1)
    this.root.add(bell)
    this.buildTill(-1.8, height, z - 0.05)
  }

  /** A cash till on the counter, keys and display facing the staff side (−z). Monitor-less: the computer terminal is a Stage 3 upgrade. */
  private buildTill(x: number, y: number, z: number): void {
    const plastic = textured('till-plastic', { color: 0x9aa3b0, metalness: 0.1 })
    const keyMat = mat(0xd1d5db, 0.5)
    const till = new THREE.Group()
    till.position.set(x, y, z)
    const part = (w: number, h: number, d: number, m: THREE.Material, px: number, py: number, pz: number, parent: THREE.Object3D = till): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)
      mesh.position.set(px, py, pz)
      mesh.castShadow = true
      parent.add(mesh)
      return mesh
    }
    part(0.38, 0.09, 0.34, plastic, 0, 0.045, 0)
    // Cash drawer: its seam and a little handle on the staff side.
    part(0.32, 0.006, 0.004, mat(0x0b0f14, 0.6), 0, 0.03, -0.171)
    part(0.08, 0.012, 0.012, keyMat, 0, 0.055, -0.176)
    // Sloping keypad with a grid of keys.
    const pad = part(0.3, 0.035, 0.17, plastic, 0, 0.11, -0.06)
    pad.rotation.x = -0.32
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 5; c++) part(0.036, 0.012, 0.032, c === 4 ? mat(0xf59e0b, 0.5) : keyMat, -0.1 + c * 0.05, 0.022, -0.045 + r * 0.045, pad)
    // Display on a short post at the back.
    part(0.03, 0.1, 0.03, plastic, 0, 0.14, 0.12)
    const screen = part(0.17, 0.08, 0.025, plastic, 0, 0.22, 0.12)
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.145, 0.055), new THREE.MeshBasicMaterial({ color: 0x4ade80, toneMapped: false }))
    face.position.set(0, 0, -0.0135)
    face.rotation.y = Math.PI
    screen.add(face)
    this.root.add(till)
  }

  private buildStaffArea(): void {
    const wall = wallMat(0xdcd6cb)
    const { z, doorHalfWidth } = PARTITION
    const t = 0.2
    const sideW = ROOM.maxX - doorHalfWidth
    this.solid(sideW, ROOM.height, t, wall, doorHalfWidth + sideW / 2, ROOM.height / 2, z)
    // The west half has a removable panel where the conveyor belts pass through later.
    const { minX: hx0, maxX: hx1, height: hh } = CONVEYOR.hatch
    const west0 = -doorHalfWidth - sideW
    const west1 = -doorHalfWidth
    this.solid(hx0 - west0, ROOM.height, t, wall, (west0 + hx0) / 2, ROOM.height / 2, z)
    this.solid(west1 - hx1, ROOM.height, t, wall, (hx1 + west1) / 2, ROOM.height / 2, z)
    this.solid(hx1 - hx0, ROOM.height - hh, t, wall, (hx0 + hx1) / 2, hh + (ROOM.height - hh) / 2, z)
    this.hatchPlug = this.solid(hx1 - hx0, hh, t, wall, (hx0 + hx1) / 2, hh / 2, z)
    this.solid(doorHalfWidth * 2, ROOM.height - 2.3, t, wall, 0, 2.3 + (ROOM.height - 2.3) / 2, z)

    // The storage room's doorway gets a frame too (it is always open).
    this.root.add(doorFrame('x', 0, z, doorHalfWidth, 2.3, t))
    const storage = this.sign('STORAGE', 1.2, 0.26, '#0f172a', '#e2e8f0')
    storage.position.set(0, 2.5, z + 0.11)
    this.root.add(storage)
    const keys = this.sign('KEYS', 0.6, 0.18, '#0f172a', '#fbbf24')
    keys.position.set(KEY_BOARD.center.x, KEY_BOARD.center.y + KEY_BOARD.height / 2 + 0.16, KEY_BOARD.center.z)
    this.root.add(keys)
    this.keysSign = keys

    // Shelving in the storage room for atmosphere (future expansion space).
    const shelf = mat(0x9ca3af, 0.5, 0.5)
    for (const x of [ROOM.minX + 0.35, ROOM.maxX - 0.35]) {
      this.solid(0.5, 0.04, 2.6, shelf, x, 0.6, -6)
      this.solid(0.5, 0.04, 2.6, shelf, x, 1.3, -6)
      for (const dz of [-1.25, 1.25]) this.deco(0.04, 1.4, 0.04, shelf, x, 0.7, -6 + dz)
      this.root.add(prop('cardboard_box_01', { x, y: 0.62, z: -6.6, rotY: 0.2, height: 0.3 }))
      this.root.add(prop('cardboard_box_01', { x, y: 0.62, z: -5.9, rotY: -0.15, height: 0.24 }))
      this.root.add(prop('cardboard_box_01', { x, y: 1.32, z: -5.4, rotY: Math.PI / 2 + 0.1, height: 0.27 }))
    }
  }

  /** A small desk with the supplier catalogue: this is where upgrades are bought. */
  private buildCatalogueDesk(): void {
    const { x, z, width, depth, height } = CATALOGUE_DESK
    const wood = mat(0x7c5a3a, 0.6)
    const top = this.solid(width, 0.05, depth, wood, x, height - 0.025, z)
    const body = this.solid(width - 0.12, height - 0.05, depth - 0.1, mat(0x4a3b2c, 0.8), x, (height - 0.05) / 2, z)
    tag(top, { kind: 'catalogue' })
    tag(body, { kind: 'catalogue' })

    // The catalogue itself (red cover, white pages), slightly open, and a desk lamp.
    const cover = this.deco(0.42, 0.04, 0.3, mat(0xb91c1c, 0.6), x - 0.2, height + 0.02, z + 0.02)
    const pages = this.deco(0.39, 0.03, 0.27, mat(0xf5f1e6, 0.9), x - 0.2, height + 0.05, z + 0.02)
    cover.rotation.y = pages.rotation.y = 0.3
    tag(cover, { kind: 'catalogue' })
    tag(pages, { kind: 'catalogue' })
    this.deco(0.14, 0.02, 0.14, mat(0x1f2937, 0.5, 0.5), x + 0.4, height + 0.01, z - 0.12)
    this.deco(0.02, 0.3, 0.02, mat(0x1f2937, 0.5, 0.5), x + 0.4, height + 0.16, z - 0.12)
    const shade = new THREE.Mesh(
      new THREE.ConeGeometry(0.1, 0.12, 14, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xfacc15, emissiveIntensity: 0.35, side: THREE.DoubleSide }),
    )
    shade.position.set(x + 0.4, height + 0.34, z - 0.12)
    this.root.add(shade)

    const label = this.sign('SUPPLIES', 1.1, 0.24, '#0f172a', '#fbbf24')
    label.position.set(x, 1.55, PARTITION.z + 0.11)
    this.root.add(label)
  }

  private buildLights(): void {
    const hemi = new THREE.HemisphereLight(0xf5f0e6, 0x6b6257, 1.1)
    this.root.add(hemi)
    const sun = this.sun
    sun.position.copy(SUN_OFFSET)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.left = -SHADOW_HALF
    sun.shadow.camera.right = SHADOW_HALF
    sun.shadow.camera.top = SHADOW_HALF
    sun.shadow.camera.bottom = -SHADOW_HALF
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 60
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.03
    this.root.add(sun, sun.target)

    const panel = lightPanel(0xfff8e7, 1.2)
    for (const [x, z] of [
      [-2.5, 3.8],
      [2.5, 3.8],
      [0, -0.6],
      [0, -5],
      [0, -7.6],
    ] as const) {
      const light = new THREE.PointLight(0xfff4e0, 9, 9, 1.6)
      light.position.set(x, ROOM.height - 0.25, z)
      this.root.add(light)
      const fixture = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.4), panel)
      fixture.position.set(x, ROOM.height - 0.03, z)
      this.root.add(fixture)
    }
  }
}

type Rect = { minX: number; maxX: number; minZ: number; maxZ: number }
/** The rectangle `minX…maxX` × `minZ…maxZ` cut into four pieces around `hole` (which lies inside it). */
export function aroundHole(minX: number, maxX: number, minZ: number, maxZ: number, hole: Rect): Rect[] {
  return [
    { minX, maxX: hole.minX, minZ, maxZ },
    { minX: hole.maxX, maxX, minZ, maxZ },
    { minX: hole.minX, maxX: hole.maxX, minZ, maxZ: hole.minZ },
    { minX: hole.minX, maxX: hole.maxX, minZ: hole.maxZ, maxZ },
  ]
}
