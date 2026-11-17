import * as THREE from 'three'
import type { PhysicsWorld } from '../engine/PhysicsWorld'
import { GravelField } from '../gravel/GravelField'
import { mulberry32 } from '../lib/random'
import { NeighbourDirector } from '../npcs/NeighbourDirector'
import type { NeighbourObservation, Occluder, PlayerReport } from '../npcs/types'
import { WALK_HEIGHT_GROUND } from './constants'
import { createSky, type Sky } from './sky'

export type DoorSite = {
  position: THREE.Vector3
  radius: number
}

type HouseSpec = {
  x: number
  z: number
  w: number
  d: number
  h: number
  /** 1 = front faces +z (our side of the street), -1 = front faces -z (across). */
  facing: 1 | -1
  wall: number
  roof: number
  trim?: number
  label?: string
  chimney?: boolean
}

const ROAD_Z = 18
const ROAD_DEPTH = 7

export class Neighbourhood {
  readonly root = new THREE.Group()
  readonly obstructionRoot = new THREE.Group()
  readonly gravel: GravelField
  readonly playerSpawn = new THREE.Vector3(0, 0, 3.5)
  readonly door: DoorSite
  readonly neighbours: NeighbourDirector
  private doorMesh: THREE.Mesh | null = null
  private readonly occluderList: Occluder[] = []
  private readonly sky: Sky
  private readonly materials = new Map<string, THREE.Material>()
  private readonly scene: THREE.Scene

  constructor(scene: THREE.Scene, physics: PhysicsWorld, seed = 42) {
    this.scene = scene
    this.scene.add(this.root)
    this.root.add(this.obstructionRoot)

    this.sky = createSky()
    this.root.add(this.sky.group)
    this.buildGround(physics)
    this.buildStreet()
    this.buildPlayerHome(physics)
    this.buildNeighbourHouses(physics)
    this.buildStreetProps()
    this.buildTrees(seed)
    this.buildHills()
    this.neighbours = new NeighbourDirector(this.root, this.occluderList)

    this.gravel = new GravelField(seed, {
      centerX: 0,
      centerZ: 4,
      width: 17,
      depth: 13,
    })
    this.root.add(this.gravel.root)

    physics.addStaticBox(
      new THREE.Vector3(0, WALK_HEIGHT_GROUND - 0.05, 4),
      new THREE.Vector3(9.2, 0.12, 7.2),
    )

    this.playerSpawn.set(0, WALK_HEIGHT_GROUND, 5)
    this.door = {
      position: new THREE.Vector3(0, 1.45, -2.35),
      radius: 2,
    }
  }

  get obstructionTargets(): THREE.Object3D[] {
    return [this.obstructionRoot]
  }

  locationLabel(pos: THREE.Vector3): string {
    if (pos.distanceTo(this.door.position) < 2.8) return 'Front door'
    if (this.isOnGravel(pos)) return 'Front gravel lawn'
    if (pos.z > ROAD_Z - ROAD_DEPTH / 2 && pos.z < ROAD_Z + ROAD_DEPTH / 2) return 'Pebble Lane'
    if (pos.z >= ROAD_Z + ROAD_DEPTH / 2) return 'Across the street'
    if (pos.z > 10) return 'Sidewalk'
    if (pos.x < -12) return 'Side yard'
    if (pos.x > 12) return 'Next door'
    return 'Your property'
  }

  isOnGravel(pos: THREE.Vector3): boolean {
    const b = this.gravel.bounds
    return (
      Math.abs(pos.x - b.centerX) < b.width / 2 &&
      Math.abs(pos.z - b.centerZ) < b.depth / 2
    )
  }

  isAtDoor(pos: THREE.Vector3): boolean {
    return pos.distanceTo(this.door.position) <= this.door.radius
  }

  /** Ambient world animation (clouds drifting). */
  update(dt: number): void {
    this.sky.update(dt)
  }

  resetWitness(): void {
    this.neighbours.reset()
  }

  unlockDoor(): void {
    const mat = this.doorMesh?.material
    if (mat instanceof THREE.MeshStandardMaterial) {
      mat.color.setHex(0xc6f6d5)
      mat.emissive.setHex(0x276749)
      mat.emissiveIntensity = 0.35
    }
  }

  updateNeighbours(dt: number, report: PlayerReport): NeighbourObservation {
    return this.neighbours.update(dt, report)
  }

  dispose(): void {
    this.gravel.dispose()
    this.scene.remove(this.root)
    const seen = new Set<THREE.Material | THREE.Texture>()
    this.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Sprite) {
        obj.geometry.dispose()
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
        for (const m of mats) {
          if (seen.has(m)) continue
          seen.add(m)
          const map = (m as THREE.MeshStandardMaterial).map
          if (map && !seen.has(map)) {
            seen.add(map)
            map.dispose()
          }
          m.dispose()
        }
      }
    })
  }


  // ---------------------------------------------------------------- ground & street

  private buildGround(physics: PhysicsWorld): void {
    const grass = new THREE.Mesh(
      new THREE.BoxGeometry(150, 0.15, 120),
      this.mat('grass', { color: 0x4f8a48, roughness: 0.96 }),
    )
    grass.position.set(0, -0.12, 8)
    grass.receiveShadow = true
    this.root.add(grass)
    physics.addStaticBox(grass.position.clone(), new THREE.Vector3(75, 0.075, 60))

    // Far field that runs to the horizon (visual only).
    const field = new THREE.Mesh(
      new THREE.CircleGeometry(460, 48),
      this.mat('field', { color: 0x5e8f4f, roughness: 1 }),
    )
    field.rotation.x = -Math.PI / 2
    field.position.y = -0.22
    field.receiveShadow = true
    this.root.add(field)
  }

  private buildStreet(): void {
    const length = 150
    const road = new THREE.Mesh(
      new THREE.BoxGeometry(length, 0.1, ROAD_DEPTH),
      this.mat('asphalt', { color: 0x3c3f45, roughness: 0.92 }),
    )
    road.position.set(0, 0.0, ROAD_Z)
    road.receiveShadow = true
    this.root.add(road)

    const lineMat = this.mat('roadLine', { color: 0xf2d16b, roughness: 0.7 })
    for (let x = -length / 2 + 2; x < length / 2; x += 5) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.02, 0.16), lineMat)
      dash.position.set(x, 0.06, ROAD_Z)
      this.root.add(dash)
    }

    const curbMat = this.mat('curb', { color: 0xb5b0a8, roughness: 0.9 })
    for (const side of [-1, 1]) {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(length, 0.16, 0.25), curbMat)
      curb.position.set(0, 0.06, ROAD_Z + side * (ROAD_DEPTH / 2 + 0.12))
      curb.receiveShadow = true
      this.root.add(curb)
    }

    const walkMat = this.mat('sidewalk', { color: 0xcdc8bf, roughness: 0.92 })
    const nearWalk = new THREE.Mesh(new THREE.BoxGeometry(length, 0.08, 2.2), walkMat)
    nearWalk.position.set(0, 0.04, 11.5)
    nearWalk.receiveShadow = true
    this.root.add(nearWalk)
    const farWalk = new THREE.Mesh(new THREE.BoxGeometry(length, 0.08, 1.6), walkMat)
    farWalk.position.set(0, 0.04, ROAD_Z + ROAD_DEPTH / 2 + 1.1)
    farWalk.receiveShadow = true
    this.root.add(farWalk)
  }

  // ---------------------------------------------------------------- houses

  private buildPlayerHome(physics: PhysicsWorld): void {
    const { group, door } = this.buildHouse(physics, {
      x: 0,
      z: -6,
      w: 11,
      d: 8,
      h: 5.5,
      facing: 1,
      wall: 0xe8e0d4,
      roof: 0x5c4a42,
      trim: 0xffffff,
      chimney: true,
    })
    this.doorMesh = door

    const porch = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.25, 2.4), this.mat('porch', { color: 0x9a9088 }))
    porch.position.set(0, 0.2, 5)
    group.add(porch)
    physics.addStaticBox(group.position.clone().add(porch.position), new THREE.Vector3(2.1, 0.125, 1.2))

    const mailbox = new THREE.Group()
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 0.1), this.mat('post', { color: 0x6b4f2a }))
    post.position.y = 0.5
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.32, 0.5), this.mat('mailbox', { color: 0x1e3a5f, metalness: 0.3 }))
    box.position.y = 1.1
    mailbox.add(post, box)
    mailbox.position.set(4.5, 0, 16.8)
    group.add(mailbox)

    this.addSign(group, '1427 Pebble Lane', new THREE.Vector3(0, 3.2, 4.06))

    for (const x of [-9, 9]) {
      const fence = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 1.2, 18),
        this.mat('fence', { color: 0x8b6914, roughness: 0.85 }),
      )
      fence.position.set(x, 0.65, 4)
      fence.castShadow = true
      fence.receiveShadow = true
      this.obstructionRoot.add(fence)
      physics.addStaticBox(fence.position.clone(), new THREE.Vector3(0.06, 0.6, 9))
      this.occluderList.push({
        center: new THREE.Vector3(x, 0.7, 4),
        half: new THREE.Vector3(0.2, 0.8, 9),
      })
    }
  }

  private buildNeighbourHouses(physics: PhysicsWorld): void {
    const homes: HouseSpec[] = [
      // Across the street — first row (Mrs. Hale, Mr. Okonkwo live at ±16).
      { x: -16, z: 27, w: 7.2, d: 6.2, h: 4.4, facing: -1, wall: 0xd6c7b0, roof: 0x4b3c38, label: '1419', chimney: true },
      { x: 16, z: 27, w: 7.2, d: 6.2, h: 4.4, facing: -1, wall: 0xc5d0dc, roof: 0x3e4a5c, label: '1435' },
      { x: 0, z: 28, w: 8.4, d: 6.6, h: 4.8, facing: -1, wall: 0xe9d8c4, roof: 0x7a4a3a, label: '1430', chimney: true },
      { x: -32, z: 27, w: 7.6, d: 6.4, h: 4.2, facing: -1, wall: 0xb8c9b4, roof: 0x3b4636, label: '1411' },
      { x: 32, z: 27, w: 7.6, d: 6.4, h: 4.6, facing: -1, wall: 0xe2c9c9, roof: 0x5a3a3a, label: '1443', chimney: true },
      // Across the street — second row (Samir at -20).
      { x: -20, z: 38, w: 7.2, d: 6.2, h: 4.4, facing: -1, wall: 0xd9c2b0, roof: 0x4b3c38, label: '1408' },
      { x: 18, z: 38, w: 7.2, d: 6.2, h: 4.4, facing: -1, wall: 0xb7c4b0, roof: 0x41493a, label: '1442', chimney: true },
      { x: -2, z: 40, w: 8, d: 6.4, h: 4.6, facing: -1, wall: 0xcfd6e2, roof: 0x444b5e },
      // Our side of the street.
      { x: -21, z: -4, w: 8.4, d: 7, h: 5, facing: 1, wall: 0xd4dbc8, roof: 0x4a5040, label: '1423', chimney: true },
      { x: 21, z: -4, w: 8.4, d: 7, h: 5, facing: 1, wall: 0xe6d3b8, roof: 0x6a4b38, label: '1431' },
      { x: -36, z: -4, w: 7.6, d: 6.6, h: 4.4, facing: 1, wall: 0xc7cfd9, roof: 0x3d4656, label: '1415' },
      { x: 36, z: -4, w: 7.6, d: 6.6, h: 4.4, facing: 1, wall: 0xd8c4d4, roof: 0x55404f, label: '1439', chimney: true },
    ]
    for (const spec of homes) {
      const { group } = this.buildHouse(physics, spec)
      const porch = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.18, 1.6), this.mat('porch', { color: 0x9a9088 }))
      porch.position.set(0, 0.1, spec.d / 2 + 0.8)
      group.add(porch)

      // Walkway from the porch to the sidewalk.
      const walkLen = spec.facing === -1 ? spec.z - spec.d / 2 - 1.6 - (ROAD_Z + ROAD_DEPTH / 2 + 1.9) : 10.4 - (spec.z + spec.d / 2 + 1.6)
      if (walkLen > 0.3) {
        const walk = new THREE.Mesh(
          new THREE.BoxGeometry(1.3, 0.06, walkLen),
          this.mat('sidewalk', { color: 0xcdc8bf, roughness: 0.92 }),
        )
        walk.position.set(0, 0.03, spec.d / 2 + 1.6 + walkLen / 2)
        walk.receiveShadow = true
        group.add(walk)
      }
    }
  }

  private buildHouse(physics: PhysicsWorld, spec: HouseSpec): { group: THREE.Group; door: THREE.Mesh } {
    const { w, d, h } = spec
    const group = new THREE.Group()
    group.position.set(spec.x, 0, spec.z)
    group.rotation.y = spec.facing === 1 ? 0 : Math.PI

    const wallMat = this.mat(`wall-${spec.wall}`, { color: spec.wall, roughness: 0.85 })
    const roofMat = this.mat(`roof-${spec.roof}`, { color: spec.roof, roughness: 0.9 })
    const trimMat = this.mat(`trim-${spec.trim ?? 0xf5f1ea}`, { color: spec.trim ?? 0xf5f1ea, roughness: 0.7 })

    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat)
    body.position.y = h / 2
    body.castShadow = true
    body.receiveShadow = true
    group.add(body)

    // Foundation strip.
    const base = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, 0.35, d + 0.12), this.mat('foundation', { color: 0x7d766e }))
    base.position.y = 0.17
    group.add(base)

    // Gable roof: triangular end walls + two sloped slabs, ridge running front-to-back.
    const pitch = Math.min(w * 0.32, 2.6)
    const shape = new THREE.Shape()
    shape.moveTo(-w / 2, 0)
    shape.lineTo(w / 2, 0)
    shape.lineTo(0, pitch)
    shape.closePath()
    const gable = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false }), wallMat)
    gable.position.set(0, h, -d / 2)
    gable.castShadow = true
    group.add(gable)

    const slope = Math.atan2(pitch, w / 2)
    const slabLen = Math.hypot(w / 2, pitch) + 0.45
    for (const side of [-1, 1]) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(slabLen, 0.18, d + 0.7), roofMat)
      slab.position.set(side * (w / 4 + 0.08), h + pitch / 2 + 0.06, 0)
      slab.rotation.z = -side * slope
      slab.castShadow = true
      slab.receiveShadow = true
      group.add(slab)
    }

    if (spec.chimney) {
      const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2, 0.7), this.mat('brick', { color: 0x8a4b3a, roughness: 0.95 }))
      chimney.position.set(w * 0.25, h + pitch * 0.55 + 0.6, -d * 0.2)
      chimney.castShadow = true
      group.add(chimney)
    }

    // Front door with frame.
    const doorMat = new THREE.MeshStandardMaterial({ color: spec.facing === 1 && spec.x === 0 ? 0x3d4f5f : 0x5b3b2a, roughness: 0.6, metalness: 0.1 })
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.4, 0.15), doorMat)
    door.position.set(0, 1.2 + 0.1, d / 2 + 0.05)
    group.add(door)
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.65, 0.08), trimMat)
    frame.position.set(0, 1.32, d / 2 + 0.01)
    group.add(frame)

    // Windows: ground floor, upper floor when tall enough, and the sides.
    const glassMat = this.mat('glass', {
      color: 0x9fc4dc,
      roughness: 0.15,
      metalness: 0.4,
      emissive: 0x24455c,
      emissiveIntensity: 0.25,
    })
    const addWindow = (x: number, y: number, z: number, rotY: number) => {
      const win = new THREE.Group()
      const pane = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.1, 0.06), glassMat)
      const frameMesh = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.3, 0.04), trimMat)
      frameMesh.position.z = -0.02
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.1, 0.08), trimMat)
      const sill = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.18), trimMat)
      sill.position.set(0, -0.62, 0.05)
      win.add(frameMesh, pane, bar, sill)
      win.position.set(x, y, z)
      win.rotation.y = rotY
      group.add(win)
    }
    const fx = w * 0.3
    addWindow(-fx, 1.6, d / 2 + 0.03, 0)
    addWindow(fx, 1.6, d / 2 + 0.03, 0)
    if (h >= 4.4) {
      addWindow(-fx, h - 1.25, d / 2 + 0.03, 0)
      addWindow(fx, h - 1.25, d / 2 + 0.03, 0)
    }
    for (const side of [-1, 1]) {
      addWindow(side * (w / 2 + 0.03), 1.6, 0, side * (Math.PI / 2))
      addWindow(side * (w / 2 + 0.03), 1.6, -d / 2 + 1.4, side * (Math.PI / 2))
    }
    addWindow(-fx, 1.6, -d / 2 - 0.03, Math.PI)
    addWindow(fx, 1.6, -d / 2 - 0.03, Math.PI)

    if (spec.label) this.addSign(group, spec.label, new THREE.Vector3(0, 2.95, d / 2 + 0.06), 1.3)

    this.obstructionRoot.add(group)
    physics.addStaticBox(new THREE.Vector3(spec.x, h / 2, spec.z), new THREE.Vector3(w / 2, h / 2, d / 2))
    this.occluderList.push({
      center: new THREE.Vector3(spec.x, (h + pitch) / 2, spec.z),
      half: new THREE.Vector3(w / 2, (h + pitch) / 2 + 0.1, d / 2),
    })
    return { group, door }
  }

  // ---------------------------------------------------------------- props

  private buildStreetProps(): void {
    const cars: { x: number; z: number; color: number }[] = [
      { x: -9, z: ROAD_Z + 2, color: 0x9b2c2c },
      { x: 9.5, z: ROAD_Z + 2, color: 0x374151 },
      { x: 27, z: ROAD_Z + 2, color: 0xe2e8f0 },
      { x: -27, z: ROAD_Z - 2, color: 0x2b6cb0 },
    ]
    for (const spec of cars) this.root.add(this.makeCar(spec.x, spec.z, spec.color))

    // Street lamps along both sidewalks.
    const poleMat = this.mat('lampPole', { color: 0x2d3340, metalness: 0.5, roughness: 0.5 })
    const bulbMat = this.mat('lampBulb', { color: 0xfff6d8, emissive: 0xffe7a3, emissiveIntensity: 0.6 })
    const lamp = (x: number, z: number, facing: number) => {
      const g = new THREE.Group()
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 4.2, 8), poleMat)
      pole.position.y = 2.1
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 1.1), poleMat)
      arm.position.set(0, 4.15, 0.5 * facing)
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.16, 0.6), poleMat)
      head.position.set(0, 4.05, 1.0 * facing)
      const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.5), bulbMat)
      bulb.position.set(0, 3.96, 1.0 * facing)
      g.add(pole, arm, head, bulb)
      g.traverse((o) => (o.castShadow = true))
      g.position.set(x, 0, z)
      this.root.add(g)
    }
    for (const x of [-34, -14, 14, 34]) lamp(x, 10.15, 1)
    for (const x of [-24, -6, 8, 24]) lamp(x, ROAD_Z + ROAD_DEPTH / 2 + 1.75, -1)

    // Mailboxes at the curb for the houses across the street.
    const postMat = this.mat('post', { color: 0x6b4f2a })
    const boxMat = this.mat('mailboxB', { color: 0x2f3b2f, metalness: 0.3 })
    for (const x of [-13.2, -15, 13.2, 2, -30, 30]) {
      const g = new THREE.Group()
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 0.1), postMat)
      post.position.y = 0.5
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.32, 0.5), boxMat)
      box.position.y = 1.1
      g.add(post, box)
      g.position.set(x, 0, 13.7)
      this.root.add(g)
    }

    // White picket fences along the back yards of our row.
    const picketMat = this.mat('picket', { color: 0xf1ede4, roughness: 0.8 })
    const picketRow = (x0: number, x1: number, z: number) => {
      const len = Math.abs(x1 - x0)
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.06), picketMat)
      rail.position.set((x0 + x1) / 2, 0.7, z)
      this.root.add(rail)
      const count = Math.floor(len / 0.35)
      const geo = new THREE.BoxGeometry(0.1, 1, 0.04)
      const inst = new THREE.InstancedMesh(geo, picketMat, count)
      const m = new THREE.Matrix4()
      for (let i = 0; i < count; i++) {
        m.makeTranslation(Math.min(x0, x1) + 0.17 + i * 0.35, 0.5, z)
        inst.setMatrixAt(i, m)
      }
      inst.castShadow = true
      this.root.add(inst)
    }
    picketRow(-42, 42, -13)
  }

  private makeCar(x: number, z: number, color: number): THREE.Group {
    const car = new THREE.Group()
    const paint = this.mat(`car-${color}`, { color, roughness: 0.35, metalness: 0.45 })
    const glass = this.mat('carGlass', { color: 0x1f2a36, roughness: 0.1, metalness: 0.6 })
    const tyre = this.mat('tyre', { color: 0x15171a, roughness: 0.9 })
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.75, 1.85), paint)
    body.position.y = 0.7
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.62, 1.65), glass)
    cabin.position.set(-0.2, 1.38, 0)
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.08, 1.6), paint)
    roof.position.set(-0.2, 1.72, 0)
    car.add(body, cabin, roof)
    const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 14)
    for (const wx of [-1.35, 1.35]) {
      for (const wz of [-0.88, 0.88]) {
        const wheel = new THREE.Mesh(wheelGeo, tyre)
        wheel.rotation.x = Math.PI / 2
        wheel.position.set(wx, 0.36, wz)
        car.add(wheel)
      }
    }
    for (const side of [-1, 1]) {
      const light = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.14, 0.4),
        this.mat('headlight', { color: 0xfffbe6, emissive: 0xfff2c0, emissiveIntensity: 0.4 }),
      )
      light.position.set(2.16, 0.78, side * 0.62)
      const tail = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.14, 0.4),
        this.mat('taillight', { color: 0xb91c1c, emissive: 0x7f1d1d, emissiveIntensity: 0.5 }),
      )
      tail.position.set(-2.16, 0.78, side * 0.62)
      car.add(light, tail)
    }
    car.traverse((o) => {
      o.castShadow = true
      o.receiveShadow = true
    })
    car.position.set(x, 0, z)
    return car
  }

  private buildTrees(seed: number): void {
    const rand = mulberry32(seed ^ 0x51ed)
    const trunk = this.mat('trunk', { color: 0x5c4033, roughness: 0.9 })
    const leafA = this.mat('leafA', { color: 0x2f6b3a, roughness: 0.9, flatShading: true })
    const leafB = this.mat('leafB', { color: 0x3f7f3a, roughness: 0.9, flatShading: true })
    const pine = this.mat('pine', { color: 0x234f33, roughness: 0.9, flatShading: true })

    const addTree = (x: number, z: number, scale: number, kind: 'round' | 'pine') => {
      const tree = new THREE.Group()
      if (kind === 'round') {
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, 1.8, 6), trunk)
        stem.position.y = 0.9
        tree.add(stem)
        const leaf = rand() > 0.5 ? leafA : leafB
        for (const [cx, cy, cz, r] of [
          [0, 2.4, 0, 1.25],
          [0.55, 2.0, 0.2, 0.85],
          [-0.5, 2.1, -0.25, 0.9],
          [0.1, 3.05, -0.1, 0.8],
        ] as const) {
          const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), leaf)
          crown.position.set(cx, cy, cz)
          tree.add(crown)
        }
      } else {
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.22, 1.2, 6), trunk)
        stem.position.y = 0.6
        tree.add(stem)
        for (let i = 0; i < 3; i++) {
          const cone = new THREE.Mesh(new THREE.ConeGeometry(1.4 - i * 0.35, 1.8, 8), pine)
          cone.position.y = 1.6 + i * 0.95
          tree.add(cone)
        }
      }
      tree.traverse((o) => (o.castShadow = true))
      tree.position.set(x, 0, z)
      tree.scale.setScalar(scale)
      tree.rotation.y = rand() * Math.PI * 2
      this.root.add(tree)
    }

    // Street trees on the grass strip, and a few framing our yard.
    for (const x of [-38, -24, -12, 12, 24, 38]) addTree(x, 9.2, 1.1, 'round')
    addTree(-11.5, -8, 1.3, 'round')
    addTree(12, -9.5, 1.2, 'pine')

    // Scatter around the back yards and behind the far row, avoiding houses, road and our lot.
    const blocked = (x: number, z: number) => {
      if (z > 8 && z < 25) return true // sidewalks, road, front yards across
      if (Math.abs(x) < 11 && z > -11 && z < 12) return true // our lot
      for (const o of this.occluderList) {
        if (Math.abs(x - o.center.x) < o.half.x + 1.8 && Math.abs(z - o.center.z) < o.half.z + 1.8) return true
      }
      return false
    }
    let placed = 0
    for (let tries = 0; tries < 500 && placed < 70; tries++) {
      const x = (rand() * 2 - 1) * 70
      const z = -45 + rand() * 105
      if (blocked(x, z)) continue
      addTree(x, z, 0.9 + rand() * 0.7, rand() > 0.6 ? 'pine' : 'round')
      placed++
    }

    // A ring of distant trees at the edge of the neighbourhood.
    for (let i = 0; i < 70; i++) {
      const a = (i / 70) * Math.PI * 2 + rand() * 0.05
      const r = 85 + rand() * 25
      addTree(Math.cos(a) * r, 8 + Math.sin(a) * r, 1.4 + rand() * 1.2, rand() > 0.5 ? 'pine' : 'round')
    }
  }

  private buildHills(): void {
    const rand = mulberry32(99)
    const near = this.mat('hillNear', { color: 0x5f8a55, roughness: 1, flatShading: true })
    const far = this.mat('hillFar', { color: 0x7d9c86, roughness: 1, flatShading: true })
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2 + rand() * 0.2
      const isFar = i % 2 === 0
      const r = isFar ? 230 + rand() * 60 : 150 + rand() * 40
      const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), isFar ? far : near)
      hill.scale.set(50 + rand() * 50, 14 + rand() * 22, 40 + rand() * 30)
      hill.position.set(Math.cos(a) * r, -1, 8 + Math.sin(a) * r)
      hill.rotation.y = rand() * Math.PI
      this.root.add(hill)
    }
  }

  // ---------------------------------------------------------------- helpers

  private mat(key: string, params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
    let m = this.materials.get(key)
    if (!m) {
      m = new THREE.MeshStandardMaterial(params)
      this.materials.set(key, m)
    }
    return m as THREE.MeshStandardMaterial
  }

  private addSign(parent: THREE.Group, text: string, localPos: THREE.Vector3, width = 2.8): void {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 128
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#2d3748'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#f7fafc'
    ctx.font = 'bold 48px system-ui,sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, canvas.width / 2, canvas.height / 2)
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(width, width / 4),
      new THREE.MeshStandardMaterial({ map: tex }),
    )
    plane.position.copy(localPos)
    parent.add(plane)
  }
}
