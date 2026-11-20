import * as THREE from 'three'
import { dezfight } from './coplanar'
import { mergeStatic } from './mergeStatic'
import type RAPIER from '@dimforge/rapier3d-compat'
import type { PhysicsWorld } from '../engine/PhysicsWorld'
import type { Appearance, Special } from '../sim/types'
import { kenney, loadKenney } from './kenney'
import { BOX_COLOURS, CAR_COLOURS, KEI_COLOURS, makeCar, makeDeliveryTruck, makeKeiTruck, setBraking, type VehicleModel } from './vehicles'
import { HARBOUR, LAKE, PARK, sandHeight, STREET } from './layout'
import { animatePerson, makePerson, mat, type PersonRig } from './models'
import { Leg, rounded } from './paths'
import { prop } from './props'
import { grassMat, metreUVs, pavingMat, roadAsphalt, sandMat, wallMat, woodMat, yardAsphalt } from './textures'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { blockBeachHut, blockDeckChair, blockBench, blockBin, blockCafeTable, blockChair, blockHydrant, blockKiosk, blockPalm, blockPicnicTable, blockStopSign } from './streetFurniture'
import { blockBush } from './facade'
import { tunnelPortal } from './Gates'
import { TyreFx } from './drift'
import { Park } from './Park'
import { buildBounds } from './Bounds'

/**
 * The town round the shop, which lives on its own (no sim state): buildings across the street, street lamps and furniture, traffic
 * driving up and down the main street, and people walking the pavements, crossing at the zebra, sitting on benches and on the beach.
 *
 * Cars and walkers are moving colliders (the player bumps into them). Cars brake for anything in front of them: the player, customers,
 * walkers, the VIP's car, trucks and other cars (`update`'s `obstacles`); walkers wait for the player to step aside.
 */
const CAR_SCALE = 1.45
const CRUISE = 8.5
const MAX_CARS = 9
const WALKERS = 16

type Car = {
  group: THREE.Group
  wheels: THREE.Object3D[]
  leg: Leg
  s: number
  speed: number
  body: RAPIER.RigidBody
  half: number
  /** Our own vehicle (null: a Kenney model). */
  model: VehicleModel | null
  /** Cars drift round the roundabout (delivery trucks do not): the body's angle off the way it is going, and the next puff of smoke. */
  drifter: boolean
  slip: number
  smokeAt: number
  /** The way along the road (the body may be turned off it in a drift). */
  pathYaw: number
}

type Walker = {
  rig: PersonRig
  path: THREE.Vector3[]
  speed: number
  /** Which pavement they are on (they cross at the zebra to change). */
  side: 'near' | 'far'
  /** Seconds left sitting or standing about. */
  rest: number
  bench: number | null
  body: RAPIER.RigidBody
}

type Bench = { x: number; z: number; yaw: number; taken: boolean }

const SPECIALS: Special[] = ['fighter', 'ninja', 'swordsman', 'caped']

const LANE_EAST = STREET.lanes.east
const LANE_WEST = STREET.lanes.west

export class Town {
  readonly root = new THREE.Group()
  private readonly physics: PhysicsWorld
  private readonly cars: Car[] = []
  private readonly walkers: Walker[] = []
  private readonly benches: Bench[] = []
  private readonly loop: Leg
  private nextCar = 1
  private readonly tmp = new THREE.Vector3()

  constructor(physics: PhysicsWorld) {
    this.physics = physics
    // West along the far lane, round the roundabout's island (north side, west, south side), and back east.
    const R = STREET.roundabout
    const ring: [number, number][] = []
    // A smooth arc (points every 5°, rounded far less than their spacing: with corners rounded more than half a segment the path doubled
    // back on itself and cars flipped round).
    // Entry and exit: cubic curves from the lane into the ring and back out, tangent at both ends.
    const at = (deg: number): [number, number] => [R.x + R.lane * Math.cos((deg * Math.PI) / 180), R.z + R.lane * Math.sin((deg * Math.PI) / 180)]
    const tangent = (deg: number): [number, number] => [-Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180)]
    const cubic = (a: [number, number], b: [number, number], c: [number, number], d: [number, number]) => {
      const out: [number, number][] = []
      for (let i = 1; i < 12; i++) {
        const t = i / 12
        const u = 1 - t
        out.push([u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0], u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1]])
      }
      return out
    }
    const IN = 75
    const OUT = 285
    const e = at(IN)
    const te = tangent(IN)
    const x = at(OUT)
    const tx = tangent(OUT)
    const inStart: [number, number] = [R.x + 10, LANE_WEST]
    const outEnd: [number, number] = [R.x + 10, LANE_EAST]
    const entry = cubic(inStart, [inStart[0] - 3, LANE_WEST], [e[0] - te[0] * 2.5, e[1] - te[1] * 2.5], e)
    for (let deg = IN; deg <= OUT; deg += 5) ring.push(at(deg))
    const exit = cubic(x, [x[0] + tx[0] * 2.5, x[1] + tx[1] * 2.5], [outEnd[0] - 3, LANE_EAST], outEnd)
    this.loop = rounded([[STREET.eastX, LANE_WEST], inStart, ...entry, ...ring, ...exit, outEnd, [STREET.eastX, LANE_EAST]], 0.15)
    this.tyres.root.userData.dynamic = true
    this.root.add(this.tyres.root)
    this.buildStreet()
    this.buildJunction()
    for (const x of [STREET.service.minX - STREET.junction.cornerR - 0.6, STREET.service.maxX + STREET.junction.cornerR + 0.6]) this.hydrant(x, STREET.near.maxZ - 0.45)
    this.buildSeafront()
    this.buildBuildings()
    this.buildLot()
    this.buildLotEast()
    this.buildEastGate()
    this.buildPark()
    for (const b of buildBounds(this.root)) this.solid(b.x, b.y, b.z, b.hx, b.hy, b.hz)
    this.buildDunes()
    this.buildFurniture()
    this.buildBeachLife()
    for (let i = 0; i < WALKERS; i++) this.addWalker(i)
    // A few cars already on the road.
    for (let i = 0; i < 4; i++) this.addCar(this.loop.length * (0.12 + i * 0.22))
    // Thousands of kerbs, slabs, benches and walls never move: bake them into a few meshes per material (far fewer draw calls).
    dezfight(this.root)
    mergeStatic(this.root)
  }

  // ------------------------------------------------------------------ static

  private deco(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const mesh = new THREE.Mesh(metreUVs(new THREE.BoxGeometry(w, h, d)), m)
    mesh.position.set(x, y, z)
    mesh.receiveShadow = true
    this.root.add(mesh)
    return mesh
  }

  /** A flat disc lying at height y (texture in metres, so it tiles like the boxes round it). */
  private disc(r: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const geo = new THREE.CircleGeometry(r, 72).rotateX(-Math.PI / 2)
    const pos = geo.getAttribute('position')
    const uv = geo.getAttribute('uv')
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) + x, -(pos.getZ(i) + z))
    const mesh = new THREE.Mesh(geo, m)
    mesh.position.set(x, y, z)
    mesh.receiveShadow = true
    this.root.add(mesh)
    return mesh
  }

  /**
   * A slab of pavement (`x0…x1` × `z0…z1`, `h` thick, centred on y = 0) with one corner rounded off (radius `r`): the kerb line
   * curving round a junction. `corner` names the rounded corner.
   */
  private cornerSlab(x0: number, x1: number, z0: number, z1: number, corner: 'maxX-maxZ' | 'minX-maxZ', r: number, h: number, m: THREE.Material): void {
    const pts: [number, number][] = []
    const arc = (cx: number, cz: number, a0: number, a1: number) => {
      for (let k = 0; k <= 10; k++) {
        const a = a0 + ((a1 - a0) * k) / 10
        pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)])
      }
    }
    if (corner === 'maxX-maxZ') {
      pts.push([x0, z0], [x1, z0])
      arc(x1 - r, z1 - r, 0, Math.PI / 2)
      pts.push([x0, z1])
    } else {
      pts.push([x0, z0], [x1, z0], [x1, z1])
      arc(x0 + r, z1 - r, Math.PI / 2, Math.PI)
    }
    // Shape space is (x, -z); extruded up by h once turned flat.
    const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)))
    const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false }).rotateX(-Math.PI / 2)
    const mesh = new THREE.Mesh(geo, m)
    mesh.position.y = -h / 2
    mesh.receiveShadow = true
    this.root.add(mesh)
  }

  private solid(x: number, y: number, z: number, hx: number, hy: number, hz: number): void {
    this.physics.addStaticBox(new THREE.Vector3(x, y, z), new THREE.Vector3(hx, hy, hz))
  }

  private buildStreet(): void {
    const asphalt = roadAsphalt(0x3a3d43)
    const kerb = pavingMat(0xbdb8b0)
    const j = STREET.junction.cornerR
    const line = mat(0xf2d16b, 0.6)
    // The road and our pavement carry on east (the shop's part, x −30…30, is the Facility's), with a gap for the service road.
    this.deco(STREET.eastX - 30, 0.03, STREET.road.maxZ - STREET.road.minZ, asphalt, (STREET.eastX + 30) / 2, -0.009, 14.2)
    for (let x = 31; x < STREET.eastX; x += 4) this.deco(2, 0.01, 0.15, line, x, 0.012, 14.2)
    const near = STREET.near
    for (const [a, b] of [[30, STREET.service.minX - j], [STREET.service.maxX + j, STREET.eastX]] as const)
      this.deco(b - a, 0.04, near.maxZ - near.minZ, kerb, (a + b) / 2, 0.0, (near.minZ + near.maxZ) / 2)

    // The far pavement, with a concrete kerb along the road.
    const far = STREET.far
    const west = STREET.plaza.maxX
    this.deco(STREET.eastX - west, 0.08, far.maxZ - far.minZ, pavingMat(0xc4beb4), (STREET.eastX + west) / 2, 0.02, (far.minZ + far.maxZ) / 2)
    this.deco(STREET.eastX - west, 0.12, 0.2, mat(0x9ca3af, 0.8), (STREET.eastX + west) / 2, 0.04, far.minZ + 0.1)
    // A zebra crossing, and its yellow-topped beacons.
    for (let z = STREET.road.minZ + 0.5; z < STREET.road.maxZ - 0.3; z += 0.9) this.deco(3, 0.012, 0.5, mat(0xf1f5f9, 0.6), STREET.crossingX, 0.014, z)
    for (const z of [near.maxZ - 0.3, far.minZ + 0.35]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 8), mat(0x111827, 0.5))
      pole.position.set(STREET.crossingX - 1.9, 1.3, z)
      const globe = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8), new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xf59e0b, emissiveIntensity: 1.2 }))
      globe.position.set(STREET.crossingX - 1.9, 2.7, z)
      this.root.add(pole, globe)
      this.solid(STREET.crossingX - 1.9, 1.3, z, 0.08, 1.3, 0.08)
    }
  }

  /**
   * The junction with the warehouse's service road: the pavement curves round both corners, a zebra over the side road's mouth with
   * beacons, a stop line and a stop sign for traffic coming out, a give-way line going in, a centre line, and hydrants on the corners.
   */
  private buildJunction(): void {
    const first = this.root.children.length
    this.junctionParts()
    for (const o of this.root.children.slice(first)) this.junction.add(o)
    this.junction.visible = false
    // Until the service road is built, the pavement runs straight across where its mouth will be.
    const j = STREET.junction.cornerR
    const n = STREET.near
    this.junctionClosed = this.deco(STREET.service.maxX - STREET.service.minX + 2 * j, 0.04, n.maxZ - n.minZ, pavingMat(0xbdb8b0), (STREET.service.minX + STREET.service.maxX) / 2, 0, (n.minZ + n.maxZ) / 2)
    this.junction.userData.dynamic = true
    if (this.junctionClosed) this.junctionClosed.userData.dynamic = true
    this.root.add(this.junction)
  }

  private readonly junction = new THREE.Group()
  private junctionClosed: THREE.Mesh | null = null
  private junctionSolids: [number, number, number, number, number, number][] = []
  private junctionBodies: RAPIER.RigidBody[] = []

  /** The junction with the service road appears with the warehouse (`open`), and goes again on a new game. */
  setJunctionOpen(open: boolean): void {
    this.junction.visible = open
    if (this.junctionClosed) this.junctionClosed.visible = !open
    if (open && this.junctionBodies.length === 0)
      this.junctionBodies = this.junctionSolids.map(([x, y, z, hx, hy, hz]) => this.physics.addStaticBox(new THREE.Vector3(x, y, z), new THREE.Vector3(hx, hy, hz)))
    if (!open) {
      for (const b of this.junctionBodies) this.physics.removeBody(b)
      this.junctionBodies = []
    }
  }

  private junctionParts(): void {
    const { minX, maxX } = STREET.service
    const near = STREET.near
    const j = STREET.junction.cornerR
    const kerb = pavingMat(0xbdb8b0)
    // The mouth: asphalt under the pavement's rounded corners.
    this.deco(maxX - minX + 2 * j, 0.03, near.maxZ - near.minZ, roadAsphalt(0x3a3d43), (minX + maxX) / 2, -0.004, (near.minZ + near.maxZ) / 2)
    this.cornerSlab(minX - j, minX, near.minZ, near.maxZ, 'maxX-maxZ', j, 0.04, kerb)
    this.cornerSlab(maxX, maxX + j, near.minZ, near.maxZ, 'minX-maxZ', j, 0.04, kerb)
    const white = mat(0xf1f5f9, 0.6)
    for (let x = minX + 0.35; x < maxX - 0.2; x += 0.9) this.deco(0.5, 0.01, 2.2, white, x, 0.016, 8.4)
    const mid = (minX + maxX) / 2
    this.deco(maxX - mid - 0.2, 0.01, 0.3, white, (mid + maxX) / 2, 0.016, 6.85)
    for (let x = minX + 0.2; x < mid - 0.3; x += 0.7) this.deco(0.4, 0.01, 0.2, white, x + 0.2, 0.016, 9.95)
    for (let z = 6.6; z < 7.2; z += 1.2) this.deco(0.12, 0.01, 0.6, mat(0xf2d16b, 0.6), mid, 0.017, z)
    for (const x of [minX - 0.45, maxX + 0.45]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 8), mat(0x111827, 0.5))
      pole.position.set(x, 1.3, 7.2)
      const globe = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8), new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xf59e0b, emissiveIntensity: 1.2 }))
      globe.position.set(x, 2.7, 7.2)
      this.root.add(pole, globe)
      this.junctionSolids.push([x, 1.3, 7.2, 0.08, 1.3, 0.08])
    }
    const stop = blockStopSign()
    stop.position.set(maxX + 0.5, 0, 6.5)
    stop.rotation.y = Math.PI
    this.root.add(stop)
    this.junctionSolids.push([maxX + 0.5, 1.15, 6.5, 0.06, 1.15, 0.06])
  }

  /**
   * The seafront where the main street meets the beach: a roundabout with a planted island, a paved plaza from the end of the street
   * to a low sea wall with a railing, boardwalks onto the sand, a small car park, an ice-cream kiosk with café tables, benches
   * looking out to sea, beach huts and lamps.
   */
  private buildSeafront(): void {
    const P = STREET.plaza
    const R = STREET.roundabout
    const road = STREET.road
    const brick = pavingMat(0xc9b9a3, 'brick')
    this.deco(P.maxX - P.minX, 0.04, road.minZ - P.minZ, brick, (P.minX + P.maxX) / 2, 0, (P.minZ + road.minZ) / 2)
    this.deco(P.maxX - P.minX, 0.04, P.maxZ - road.maxZ, brick, (P.minX + P.maxX) / 2, 0, (road.maxZ + P.maxZ) / 2)
    this.deco(R.x + 4 - P.minX, 0.04, road.maxZ - road.minZ, brick, (P.minX + R.x + 4) / 2, 0, (road.minZ + road.maxZ) / 2)

    // The roundabout: an asphalt disc a little above the plaza (its own material, nudged forward so it never flickers), a kerb ring
    // round it (open where the street comes in), and the island.
    const disc = roadAsphalt(0x3a3d43).clone()
    disc.polygonOffset = true
    disc.polygonOffsetFactor = -2
    disc.polygonOffsetUnits = -2
    this.disc(R.r, disc, R.x, 0.035, R.z)
    const lo = Math.asin((road.maxZ - R.z) / R.r)
    const hi = 2 * Math.PI + Math.asin((road.minZ - R.z) / R.r)
    const kerbRing = new THREE.Mesh(new THREE.TorusGeometry(R.r, 0.12, 6, 64, hi - lo).rotateX(Math.PI / 2), mat(0xa8a29e, 0.85))
    kerbRing.scale.y = 0.6
    kerbRing.position.set(R.x, 0.04, R.z)
    kerbRing.rotation.y = -lo
    kerbRing.receiveShadow = true
    this.root.add(kerbRing)
    for (let z = R.z + 0.4; z < road.maxZ - 0.3; z += 0.7) this.deco(0.4, 0.01, 0.35, mat(0xf1f5f9, 0.6), R.x + Math.sqrt(R.r * R.r - (z - R.z) ** 2) - 0.6, 0.05, z)
    for (let k = 0; k < 32; k += 2) {
      const a = (k / 32) * Math.PI * 2
      const dash = this.deco(0.9, 0.01, 0.12, mat(0xf1f5f9, 0.6), R.x + (R.island + 0.6) * Math.cos(a), 0.05, R.z + (R.island + 0.6) * Math.sin(a))
      dash.rotation.y = -a - Math.PI / 2
    }
    const island = new THREE.Mesh(new THREE.CylinderGeometry(R.island, R.island + 0.05, 0.2, 48), mat(0xbdb8b0, 0.9))
    island.position.set(R.x, 0.1, R.z)
    island.receiveShadow = true
    this.root.add(island)
    this.disc(R.island - 0.15, grassMat(0x6f9c4a), R.x, 0.205, R.z)
    const palm = blockPalm(4.6, 2)
    palm.position.set(R.x, 0.2, R.z)
    this.root.add(palm)
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + 0.3
      this.root.add(blockBush(R.x + 1.5 * Math.cos(a), 0.2, R.z + 1.5 * Math.sin(a), 0.75, k + 4))
    }
    this.solid(R.x, 0.6, R.z, R.island * 0.72, 0.6, R.island * 0.72)

    // The car park on the south side, with a drive up to the roundabout.
    const K = STREET.parking
    const lot = yardAsphalt(0x4b4f56)
    this.deco(K.maxX - K.minX, 0.03, K.maxZ - K.minZ, lot, (K.minX + K.maxX) / 2, 0.02, (K.minZ + K.maxZ) / 2)
    this.deco(4, 0.03, R.z - R.r + 1.2 - K.maxZ, lot, R.x + 0.5, 0.02, (K.maxZ + R.z - R.r + 1.2) / 2)
    const paint = mat(0xf1f5f9, 0.6)
    for (let x = K.minX; x <= K.maxX + 0.01; x += 2.5) this.deco(0.12, 0.01, 4.8, paint, x, 0.04, K.minZ + 2.6)
    this.deco(K.maxX - K.minX, 0.01, 0.12, paint, (K.minX + K.maxX) / 2, 0.04, K.minZ + 0.2)
    const parkedColours = [0x2563eb, 0xf2f2f2, 0xd9480f]
    ;[0, 1, 3].forEach((bay, i) => {
      const car = makeCar(parkedColours[i]!, { plate: plateFor(40 + i) })
      const x = K.minX + 1.25 + bay * 2.5
      car.group.position.set(x, 0.03, K.minZ + 2.5)
      this.root.add(car.group)
      this.solid(x, 0.8, K.minZ + 2.5, car.width / 2, 0.8, car.length / 2)
    })
    const pSign = new THREE.Group()
    const pPost = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 8), mat(0x9ca3af, 0.5))
    pPost.position.y = 1.2
    const pFace = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.04), new THREE.MeshStandardMaterial({ map: letterTexture('P', '#1d4ed8'), roughness: 0.6 }))
    pFace.position.set(0, 2.2, 0.03)
    pSign.add(pPost, pFace)
    pSign.position.set(R.x + 3, 0, K.maxZ + 0.2)
    this.root.add(pSign)
    this.solid(R.x + 3, 1.2, K.maxZ + 0.2, 0.06, 1.2, 0.06)

    // The sea wall with a railing, and openings onto boardwalks over the sand.
    const stone = mat(0xd6cbb6, 0.9)
    const steel = mat(0xcbd5e1, 0.4)
    const gaps = STREET.boardwalkZ.map((z) => [z - 1.3, z + 1.3] as const)
    let z0: number = P.minZ
    for (const [g0, g1] of [...gaps, [P.maxZ, P.maxZ] as const]) {
      if (g0 > z0) {
        const len = g0 - z0
        const mid = (z0 + g0) / 2
        this.deco(0.34, 0.45, len, stone, STREET.wallX, 0.225, mid).castShadow = true
        this.deco(0.42, 0.06, len, mat(0xe7dfcf, 0.85), STREET.wallX, 0.48, mid)
        for (let z = z0 + 0.2; z <= g0 - 0.15; z += 1.6) this.deco(0.05, 0.55, 0.05, steel, STREET.wallX, 0.78, z)
        this.deco(0.06, 0.06, len, steel, STREET.wallX, 1.06, mid)
        this.deco(0.04, 0.04, len, steel, STREET.wallX, 0.8, mid)
        this.solid(STREET.wallX, 0.55, mid, 0.17, 0.55, len / 2)
      }
      z0 = g1
    }
    const deck = woodMat(0xb08b5e)
    const rope = mat(0xe8d8b0, 0.9)
    for (const bz of STREET.boardwalkZ) {
      const x0 = STREET.wallX - 0.2
      const x1 = LAKE.coast.shoreX + 1
      this.deco(x0 - x1, 0.1, 2.4, deck, (x0 + x1) / 2, 0.04, bz).castShadow = true
      for (let x = x0 - 0.3; x > x1; x -= 1.6)
        for (const s of [-1, 1]) this.deco(0.1, 0.8, 0.1, mat(0x8a6a48, 0.9), x, 0.4, bz + s * 1.15)
      for (const s of [-1, 1]) this.deco(x0 - x1, 0.04, 0.04, rope, (x0 + x1) / 2, 0.72, bz + s * 1.15)
    }

    // Beach huts on the sand between the boardwalks, facing the land.
    const hutColours = [0x38bdf8, 0xfacc15, 0xf472b6, 0x4ade80]
    hutColours.forEach((c, i) => {
      const hz = 6.6 + i * 2.4
      const hut = blockBeachHut(c)
      hut.position.set(-59.3, -0.02, hz)
      hut.rotation.y = Math.PI / 2
      this.root.add(hut)
      this.solid(-59.3, 1.3, hz, 1.1, 1.3, 1.0)
    })

    // The ice-cream kiosk, its café tables, and benches along the wall looking out to sea.
    const kiosk = blockKiosk()
    kiosk.position.set(-54.1, 0.02, 22.2)
    kiosk.rotation.y = Math.PI / 2
    this.root.add(kiosk)
    this.solid(-54.1, 1.3, 22.2, 1.1, 1.3, 1.3)
    const canopies = [0xf5c542, 0x38bdf8, 0xf472b6]
    ;[-50.6, -47.6, -44.6].forEach((tx, i) => {
      const tz = 23.4
      const table = blockCafeTable(canopies[i]!)
      table.position.set(tx, 0.02, tz)
      this.root.add(table)
      this.solid(tx, 0.4, tz, 0.4, 0.4, 0.4)
      for (const s of [-1, 1]) {
        const chair = blockChair(i % 2 ? 0x3aa6b9 : 0xe85d3f)
        chair.position.set(tx + s * 0.7, 0.02, tz)
        chair.rotation.y = -s * (Math.PI / 2)
        this.root.add(chair)
        if ((i + s + 3) % 2 === 0) this.sitter(tx + s * 0.58, tz, chair.rotation.y, 10 + i * 2 + s)
      }
    })
    for (const bz of [8.0, 12.3]) {
      const bench = blockBench()
      bench.position.set(-55.25, 0.02, bz)
      bench.rotation.y = -Math.PI / 2
      this.root.add(bench)
      this.solid(-55.25, 0.42, bz, 0.3, 0.42, 0.85)
      this.bin(-55.3, bz + 1.35)
    }
    this.sitter(-55.37, 8.0, -Math.PI / 2, 21)
    for (const lz of [P.minZ + 1.5, 10.6, 20.0]) this.lamp(-55.5, lz, -Math.PI / 2)
    this.lamp(R.x + 3, P.maxZ - 0.6, 0)
  }

  /** Shops on the lot in front of the warehouse, facing the street (the same city blocks as across the road). */
  private buildLot(): void {
    const L = STREET.lot
    const plan: [string, number][] = [['building-c', 7.2], ['building-h', 7.8], ['building-k', 6.4]]
    const depth = L.maxZ - L.minZ
    let x = L.minX
    for (const [name, w] of plan) {
      if (x > L.minX) this.gapFill(x - 0.2, L.maxZ - depth / 2, 0.6, depth - 0.4)
      this.root.add(kenney('city', name, { x: x + w / 2, z: L.maxZ - depth / 2, length: w }))
      this.solid(x + w / 2, 4, L.maxZ - depth / 2, w / 2 - 0.2, 4, depth / 2 - 0.2)
      x += w + 0.4
    }
    // Paving in front of them, out to the street's pavement.
    this.deco(L.maxX - L.minX, 0.04, STREET.near.minZ - L.maxZ + 0.05, pavingMat(0xbdb8b0), (L.minX + L.maxX) / 2, 0, (L.maxZ + STREET.near.minZ) / 2)
  }

  /** A wall filling the gap between two blocks (so there is no alley to slip through), with its collider. */
  private gapFill(x: number, z: number, w: number, d: number): void {
    const h = 7
    this.deco(w, h, d, wallMat(0x6b6f76), x, h / 2, z).castShadow = true
    this.solid(x, h / 2, z, w / 2 + 0.05, h / 2, d / 2)
  }

  private hydrant(x: number, z: number): void {
    const h = blockHydrant()
    h.position.set(x, 0.02, z)
    this.root.add(h)
    this.solid(x, 0.37, z, 0.18, 0.37, 0.18)
  }

  private bin(x: number, z: number): void {
    const b = blockBin()
    b.position.set(x, 0.02, z)
    this.root.add(b)
    this.solid(x, 0.45, z, 0.28, 0.45, 0.28)
  }

  /** Someone sitting still on a seat at (x, z), facing `yaw`. */
  private sitter(x: number, z: number, yaw: number, seed: number): void {
    const rig = makePerson(randomLook(seed), { female: seed % 2 === 0 })
    rig.root.position.set(x, 0.02, z)
    rig.root.rotation.y = yaw
    rig.root.userData.pose = 'sit'
    this.root.add(rig.root)
    rig.root.userData.dynamic = true
    this.loungers.push(rig)
  }

  private buildBuildings(): void {
    // Shops and offices across the street (fronts on `buildingZ`, facing the road), then taller blocks behind them.
    const names = 'abcdefghijklmn'.split('').map((c) => `building-${c}`)
    let x = STREET.plaza.maxX + 1
    let i = 0
    while (x + 8.6 < STREET.gateX) {
      const name = names[(i * 5 + 3) % names.length]!
      const width = 6.5 + ((i * 7) % 3)
      if (i > 0) this.gapFill(x - 0.2, STREET.buildingZ + 3.4, 0.6, 6.4)
      this.root.add(kenney('city', name, { x: x + width / 2, z: STREET.buildingZ + 3.4, rotY: Math.PI, length: width }))
      this.solid(x + width / 2, 4, STREET.buildingZ + 3.4, width / 2 - 0.2, 4, 3.2)
      x += width + 0.4
      i++
    }
    // A back street behind them (the plaza leads round into it): paving from the blocks' backs, with a kerb on the far side.
    const back = STREET.buildingZ + 6.8
    const bx0 = STREET.plaza.maxX
    this.deco(STREET.gateX - bx0, 0.04, 4.2, pavingMat(0xbdb8b0), (STREET.gateX + bx0) / 2, 0, back + 2.1)
    this.deco(STREET.gateX - bx0, 0.12, 0.2, mat(0x9ca3af, 0.8), (STREET.gateX + bx0) / 2, 0.04, back + 4.3)
    const tall = ['building-skyscraper-a', 'building-skyscraper-b', 'building-skyscraper-c', 'building-skyscraper-d', 'building-skyscraper-e']
    for (let k = 0; k < 12; k++) {
      const tx = -40 + k * 13 + ((k * 37) % 5)
      this.root.add(kenney('city', tall[k % tall.length]!, { x: tx, z: 40 + ((k * 13) % 9), rotY: Math.PI * (k % 2), scale: 7 + (k % 3) }))
    }
  }

  private buildFurniture(): void {
    // Street lamps: a curved post every 12 m on both pavements, the lamp over the road.
    const lampAt: [number, number, number][] = []
    for (let x = -50; x < STREET.gateX - 10; x += 12) {
      const nx = x + 3.5
      if (Math.abs(nx) > 2.5 && (nx < STREET.service.minX - 1 || nx > STREET.service.maxX + 1)) lampAt.push([nx, STREET.near.maxZ - 0.3, Math.PI])
      lampAt.push([x + 9.5, STREET.far.minZ + 0.35, 0])
    }
    for (const [lx, lz, yaw] of lampAt) if (lx > STREET.plaza.maxX + 1) this.lamp(lx, lz, yaw)

    // Benches facing the road, bins beside them, and hydrants at the kerb.
    for (const [bx, side] of [[-9, 'near'], [5.5, 'near'], [20, 'near'], [-26, 'near'], [-4, 'far'], [14, 'far'], [32, 'far'], [-30, 'far']] as const) {
      const z = side === 'near' ? STREET.near.minZ + 1.0 : STREET.far.maxZ - 0.45
      const yaw = side === 'near' ? 0 : Math.PI
      const bench = blockBench()
      bench.position.set(bx, side === 'near' ? 0.02 : 0.06, z)
      bench.rotation.y = yaw
      this.root.add(bench)
      this.solid(bx, 0.42, z, 0.85, 0.42, 0.3)
      this.benches.push({ x: bx, z: z + (side === 'near' ? 0.12 : -0.12), yaw, taken: false })
      this.bin(bx + 1.35, z)
    }
    for (const [hx, hz] of [[-12.5, STREET.near.maxZ - 0.45], [26, STREET.near.maxZ - 0.45], [8, STREET.far.minZ + 0.5], [-34, STREET.far.minZ + 0.5]] as const) this.hydrant(hx, hz)
    // Picnic tables on the grass by the beach, north of the plaza.
    // A block across the back street's west end, so it cannot be walked into from the plaza (a wall fills the sliver beside it).
    this.root.add(kenney('city', 'building-j', { x: -44.2, z: 30.6, rotY: Math.PI, length: 8 }))
    this.solid(-44.2, 4, 30.6, 3.8, 4, 3.3)
    this.gapFill(-40.15, 30.6, 0.7, 6.6)
    for (const [px, pz] of [[LAKE.coast.grassX + 4, 39], [LAKE.coast.grassX + 9, 41]] as const) {
      const t = blockPicnicTable()
      t.position.set(px, 0, pz)
      t.rotation.y = Math.PI / 2
      this.root.add(t)
      this.solid(px, 0.4, pz, 0.85, 0.4, 1.0)
    }
    // Buoys offshore.
    for (const [bx, bz] of [[-80, 0], [-84, 30], [-78, -60], [-90, -20]] as const) this.root.add(prop('ocean_buoy', { x: bx, y: LAKE.coast.seaY - 0.4, z: bz, height: 2.2 }))
  }

  /** A curved lamp post at (x, z), its arm reaching along `yaw` (0: towards −z), with a warm glowing lens. */
  private lamp(x: number, z: number, yaw: number): void {
    const s = 8.2
    const post = kenney('street', 'light-curved', { x, z, rotY: yaw, scale: s, keepOrigin: true })
    this.root.add(post)
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.5), LENS)
    lens.position.set(0, 0.6 * s - 0.1, -0.17 * s)
    const glow = new THREE.Sprite(GLOW)
    glow.scale.set(1.3, 0.7, 1)
    glow.position.set(0, 0.6 * s - 0.25, -0.17 * s)
    // Its pool of light on the ground under the head (the post is turned by `yaw`, so this is in its frame).
    const pool = new THREE.Mesh(POOL_GEO, POOL)
    pool.position.set(0, 0.06, -0.17 * s)
    pool.renderOrder = 3
    post.add(lens, glow, pool)
    this.solid(x, 2.6, z, 0.12, 2.6, 0.12)
  }

  /** People on the beach: in deck chairs under the parasols, looking out to sea, and standing at the water's edge. */
  private buildBeachLife(): void {
    const chairColours = [0x2563eb, 0xef4444, 0x10b981, 0xf59e0b]
    LAKE.coast.parasols.forEach(([px, pz], i) => {
      // A deck chair beside each parasol, facing the sea (−x); most have someone in it.
      const cx = px + 1.2
      const cz = pz + 0.3
      const chair = blockDeckChair(chairColours[i % chairColours.length]!)
      chair.position.set(cx, sandHeight(cx), cz)
      chair.rotation.y = -Math.PI / 2
      this.root.add(chair)
      this.solid(cx, 0.4, cz, 0.35, 0.4, 0.35)
      if (i % 4 !== 3) this.sitter(cx - 0.1, cz, -Math.PI / 2, i * 7 + 3)
    })
    const edge = LAKE.coast.shoreX - 1.2
    for (const [z, k] of [[31, 1], [39, 2], [-52, 3], [8, 4]] as const) {
      const rig = makePerson(randomLook(k * 11 + 5), { female: k % 2 === 0 })
      rig.root.position.set(edge, sandHeight(edge), z)
      rig.root.rotation.y = -Math.PI / 2
      rig.root.userData.pose = 'idle'
      this.root.add(rig.root)
      rig.root.userData.dynamic = true
    this.loungers.push(rig)
    }
  }

  private park: Park | null = null

  /** The park east of the service road, and a row of blocks closing the world off beyond it (from the street down to the district). */
  private buildPark(): void {
    const park = new Park()
    this.root.add(park.root)
    for (const b of park.solids) this.solid(b.x, b.y, b.z, b.hx, b.hy, b.hz)
    for (const [x, z] of park.lamps) this.lamp(x, z, Math.PI)
    this.park = park
    const names = ['building-a', 'building-f', 'building-i', 'building-c', 'building-m', 'building-g', 'building-k']
    let k = 0
    for (let z = STREET.lot.minZ - 3; z > -100; ) {
      const w = 7.2 + (k % 3) * 0.8
      if (k > 0) this.gapFill(PARK.borderX, z + 0.25, 6.4, 0.7)
      this.root.add(kenney('city', names[k % names.length]!, { x: PARK.borderX, z: z - w / 2, rotY: -Math.PI / 2, length: w }))
      this.solid(PARK.borderX, 4, z - w / 2, 3.2, 4, w / 2 - 0.2)
      z -= w + 0.5
      k++
    }
    const tall = ['building-skyscraper-b', 'building-skyscraper-d', 'building-skyscraper-a']
    for (let i = 0; i < 6; i++) this.root.add(kenney('city', tall[i % tall.length]!, { x: PARK.borderX + 16 + (i % 2) * 9, z: -12 - i * 15, rotY: -Math.PI / 2, scale: 7 + (i % 3) }))
  }

  /** The main street's east end: it runs into a tunnel under a block, with taller blocks behind, so the town ends there. */
  private buildEastGate(): void {
    const road = STREET.road
    const portal = tunnelPortal({ along: 'x', dir: 1, centre: (road.minZ + road.maxZ) / 2, mouth: STREET.gateX, roadWidth: road.maxZ - road.minZ, span: 36, depth: 20, height: 14, colour: 0xb4a48c, sign: 'CITY CENTRE · TUNNEL' })
    this.root.add(portal.group)
    for (const b of portal.solids) this.solid(b.x, b.y, b.z, b.hx, b.hy, b.hz)
    const tall = ['building-skyscraper-a', 'building-skyscraper-c', 'building-skyscraper-e', 'building-skyscraper-b']
    for (let i = 0; i < 6; i++) this.root.add(kenney('city', tall[i % tall.length]!, { x: STREET.gateX + 28 + (i % 2) * 10, z: -14 + i * 9, rotY: -Math.PI / 2, scale: 7 + (i % 3) }))
  }

  /** More shops along our side of the street east of the service road, facing it. */
  private buildLotEast(): void {
    const names = ['building-d', 'building-f', 'building-a', 'building-j', 'building-m', 'building-e', 'building-l', 'building-b', 'building-i']
    const front = STREET.lot.maxZ
    const depth = 6.8
    let x = STREET.service.maxX + STREET.junction.cornerR + 2.2
    let i = 0
    while (x + 8.6 < STREET.gateX) {
      const w = 6.6 + ((i * 5) % 3) * 0.9
      if (i > 0) this.gapFill(x - 0.25, front - depth / 2, 0.7, depth - 0.4)
      this.root.add(kenney('city', names[i % names.length]!, { x: x + w / 2, z: front - depth / 2, length: w }))
      this.solid(x + w / 2, 4, front - depth / 2, w / 2 - 0.2, 4, depth / 2 - 0.2)
      x += w + 0.5
      i++
    }
    this.deco(x - (STREET.service.maxX + 2), 0.04, STREET.near.minZ - front + 0.05, pavingMat(0xbdb8b0), (x + STREET.service.maxX + 2) / 2, 0, (front + STREET.near.minZ) / 2)
    // A paved lane behind them, along the park's north hedge.
    const backZ = front - depth
    this.deco(x - (STREET.service.maxX + 1.5), 0.04, backZ - PARK.maxZ + 0.4, pavingMat(0xbdb8b0), (x + STREET.service.maxX + 1.5) / 2, 0, (backZ + PARK.maxZ) / 2)
  }

  /**
   * The top of the beach, so the grass does not just stop at a line: low dunes on the sand (you can walk over them), clumps of beach
   * grass on and around them and on the grass edge, and drifts of sand blown onto the grass. Not in front of the plaza, nor where
   * the crater's channel and the dock will be.
   */
  private buildDunes(): void {
    const { grassX, duneX, channel } = LAKE.coast
    const rand = (k: number) => Math.abs(Math.sin(k * 12.9898 + 78.233) * 43758.5453) % 1
    const P = STREET.plaza
    const B = HARBOUR.basin
    const clear = (z: number, pad: number) =>
      (z < P.minZ - pad || z > P.maxZ + pad) && Math.abs(z - channel.z) > channel.halfWidth + 2 + pad && (z < B.minZ - 2 - pad || z > B.maxZ + 2 + pad)
    const sand = sandMat(0xdcc8a0).clone()
    sand.flatShading = true
    const duneGeo = new THREE.IcosahedronGeometry(1, 1)
    const dunes: THREE.Matrix4[] = []
    const tufts: THREE.Matrix4[] = []
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const tuft = (x: number, y: number, z: number, k: number, s = 1) =>
      tufts.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(up, rand(k) * 6.28).clone(), new THREE.Vector3(s, s * (0.7 + rand(k + 1) * 0.6), s)))
    let k = 0
    for (let z = -150; z < 150; z += 4.5 + rand(z) * 3) {
      k++
      if (!clear(z, 1)) continue
      const w = 1.2 + rand(k * 3) * 1.0
      const d = 1.8 + rand(k * 5) * 1.6
      const h = 0.26 + rand(k * 7) * 0.16
      const x = (grassX + duneX) / 2 + (rand(k * 11) - 0.5) * 1.2
      dunes.push(new THREE.Matrix4().compose(new THREE.Vector3(x, -0.06, z), new THREE.Quaternion(), new THREE.Vector3(w, h + 0.06, d)))
      this.solid(x, h * 0.35, z, w * 0.6, h * 0.35, d * 0.6)
      for (let t = 0; t < 7; t++) tuft(x + (rand(k * 13 + t) - 0.5) * w * 1.3, h * 0.7, z + (rand(k * 17 + t) - 0.5) * d * 1.3, k * 19 + t, 0.8 + rand(t + k) * 0.6)
    }
    // Clumps along the edge itself, on both sides of it.
    for (let z = -150; z < 150; z += 0.9) {
      k++
      if (!clear(z, 0) || rand(k * 23) < 0.35) continue
      const x = grassX + (rand(k * 29) - 0.65) * 3.5
      tuft(x, -0.01, z + rand(k * 31) * 0.6, k * 37, 0.6 + rand(k * 41) * 0.7)
    }
    const duneMesh = new THREE.InstancedMesh(duneGeo, sand, dunes.length)
    dunes.forEach((m, i) => duneMesh.setMatrixAt(i, m))
    duneMesh.receiveShadow = true
    duneMesh.castShadow = true
    this.root.add(duneMesh)

    // A tuft: a fan of thin blades.
    const blades: THREE.BufferGeometry[] = []
    for (let b = 0; b < 7; b++) {
      const blade = new THREE.BoxGeometry(0.03, 0.5, 0.015).translate(0, 0.25, 0)
      blade.rotateZ((b - 3) * 0.16).rotateY(b * 0.9)
      blades.push(blade)
    }
    const tuftGeo = mergeGeometries(blades)
    const tuftMesh = new THREE.InstancedMesh(tuftGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), tufts.length)
    const c = new THREE.Color()
    tufts.forEach((m, i) => {
      tuftMesh.setMatrixAt(i, m)
      tuftMesh.setColorAt(i, c.setHex(0x9caa55).lerp(new THREE.Color(0xcdbb72), rand(i * 3)))
    })
    tuftMesh.castShadow = true
    this.root.add(tuftMesh)

    // Sand blown onto the grass: overlapping soft patches, thinning out away from the beach.
    const drift = sandMat(0xd8c49c).clone()
    drift.polygonOffset = true
    drift.polygonOffsetFactor = -1
    drift.polygonOffsetUnits = -1
    const patches: THREE.Matrix4[] = []
    for (let z = -150; z < 150; z += 0.7) {
      k++
      if (!clear(z, 0)) continue
      const reach = rand(k * 43) ** 2 * 4
      const s = 0.4 + rand(k * 47) * 1.1 * (1 - reach / 5)
      patches.push(new THREE.Matrix4().compose(new THREE.Vector3(grassX + reach, -0.012, z), q.setFromAxisAngle(up, rand(k) * 6.28).clone(), new THREE.Vector3(s * 1.6, 1, s)))
    }
    const patchGeo = new THREE.CircleGeometry(1, 9).rotateX(-Math.PI / 2)
    const patchMesh = new THREE.InstancedMesh(patchGeo, drift, patches.length)
    patches.forEach((m, i) => patchMesh.setMatrixAt(i, m))
    patchMesh.receiveShadow = true
    this.root.add(patchMesh)
  }

  private readonly loungers: PersonRig[] = []

  // ------------------------------------------------------------------ traffic

  private addCar(s = 0): void {
    // Mostly our own hatchbacks and kei trucks, some delivery trucks, and now and then a Kenney taxi, police car or ambulance.
    const k = this.nextCar++
    const pick = (k * 7 + 3) % 10
    const group = new THREE.Group()
    let model: VehicleModel | null = null
    if (pick < 5) model = makeCar(CAR_COLOURS[(k * 5) % CAR_COLOURS.length]!, { plate: plateFor(k) })
    else if (pick < 8) model = makeKeiTruck(KEI_COLOURS[(k * 3) % KEI_COLOURS.length]!, { cargo: k % 2 === 0, plate: plateFor(k) })
    else if (pick < 9) model = makeDeliveryTruck(BOX_COLOURS[k % BOX_COLOURS.length]!, { plate: plateFor(k) })
    const name = ['taxi', 'police', 'ambulance'][k % 3]!
    const inner = model ? model.group : kenney('cars', name, { x: 0, z: 0, rotY: Math.PI, scale: CAR_SCALE })
    group.add(inner)
    const half = model ? model.length / 2 : 2.0
    const car: Car = {
      group,
      wheels: [],
      leg: this.loop,
      s,
      speed: s > 0 ? CRUISE : CRUISE * 0.7,
      body: this.physics.addMovingBox(new THREE.Vector3(0, -20, 0), new THREE.Vector3((model?.width ?? 2.1) / 2, 0.8, half)),
      half,
      model,
      drifter: !model || model.length < 5,
      slip: 0,
      smokeAt: 0,
      pathYaw: 0,
    }
    if (model) car.wheels.push(...model.wheels)
    else
      void loadKenney('cars', name).then(() => {
        inner.traverse((o) => {
          if (o.name.startsWith('wheel')) car.wheels.push(o)
        })
      })
    this.root.add(group)
    group.userData.dynamic = true
    this.cars.push(car)
    this.placeCar(car)
  }

  private placeCar(car: Car): void {
    const p = car.leg.at(car.s / car.leg.length)
    car.group.position.set(p.x, 0, p.z)
    car.group.rotation.y = p.yaw + car.slip
    car.pathYaw = p.yaw
    this.physics.moveBody(car.body, p.x, 0.8, p.z, p.yaw)
  }

  private updateCars(dt: number, obstacles: readonly THREE.Vector3[]): void {
    if (this.cars.length < MAX_CARS && Math.random() < dt / 3.2) {
      const clear = this.cars.every((c) => c.s > 16)
      if (clear) this.addCar(0)
    }
    const fwd = this.tmp
    for (const car of [...this.cars]) {
      const p = car.group.position
      const yaw = car.pathYaw
      fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw))
      // The nearest thing ahead in our path (people, the player, vehicles, other cars).
      let nearest = Infinity
      const look = 4 + car.speed * 0.9
      const check = (o: THREE.Vector3, width: number) => {
        const dx = o.x - p.x
        const dz = o.z - p.z
        const ahead = dx * fwd.x + dz * fwd.z
        const side = Math.abs(dx * fwd.z - dz * fwd.x)
        if (ahead > -0.3 && ahead < look + car.half && side < width && ahead < nearest) nearest = ahead
      }
      for (const o of obstacles) check(o, 1.7)
      for (const w of this.walkers) check(w.rig.root.position, 1.5)
      // Other cars: follow the one ahead along the loop (by distance along it, so two cars can never wait for each other).
      for (const other of this.cars) {
        // Measured to the back of the car ahead (a delivery truck is long).
        const d = other.s - car.s - (other.half - car.half)
        if (other !== car && other.s > car.s && d < nearest) nearest = d
      }
      const gap = nearest - car.half - 1.4
      let target = CRUISE
      if (nearest < Infinity) target = Math.max(0, Math.min(CRUISE, gap * 1.3))
      // The roundabout: delivery trucks slow right down and go round normally; cars take it faster and drift round.
      const u = car.s / car.leg.length
      const R = STREET.roundabout
      const onRing = Math.hypot(p.x - R.x, p.z - R.z) < R.r + 2
      if (Math.abs(p.x - STREET.turnX) < 11) target = Math.min(target, car.drifter ? 6.8 : 3.6)
      this.drift(car, dt, onRing)
      const accel = target > car.speed ? 3 : 9
      car.speed += THREE.MathUtils.clamp(target - car.speed, -accel * dt, accel * dt)
      const ds = car.speed * dt
      car.s += ds
      for (const w of car.wheels) w.rotation.x += car.model ? -ds / car.model.wheelRadius : ds / (0.3 * CAR_SCALE)
      if (car.model) setBraking(car.model, target < car.speed - 0.5 || car.speed < 0.3)
      if (u >= 1 || car.s >= car.leg.length) {
        this.removeCar(car)
        continue
      }
      this.placeCar(car)
    }
  }

  /**
   * A drifting car: on the ring its body swings into the turn (the more it turns, the more it slides), with smoke and skid marks off the
   * back tyres and the brake lights on; out of the ring it straightens up and carries on.
   */
  private drift(car: Car, dt: number, onRing: boolean): void {
    let want = 0
    if (car.drifter && onRing && car.speed > 3) {
      const ahead = car.leg.at(Math.min(1, (car.s + 2.5) / car.leg.length))
      const turn = Math.atan2(Math.sin(ahead.yaw - car.pathYaw), Math.cos(ahead.yaw - car.pathYaw))
      want = THREE.MathUtils.clamp(turn * 1.5, -0.62, 0.62)
    }
    car.slip += (want - car.slip) * Math.min(1, dt * (want ? 3.5 : 2.2))
    if (Math.abs(car.slip) < 0.2) return
    if (car.model) setBraking(car.model, true)
    car.smokeAt -= dt
    const p = car.group.position
    const body = car.group.rotation.y
    const cos = Math.cos(body)
    const sin = Math.sin(body)
    const vx = -Math.sin(car.pathYaw) * car.speed
    const vz = -Math.cos(car.pathYaw) * car.speed
    const rear = car.model?.rearWheels ?? [new THREE.Vector3(-0.8, 0, 1.4), new THREE.Vector3(0.8, 0, 1.4)]
    for (const r of rear) {
      const wx = p.x + r.x * cos + r.z * sin
      const wz = p.z - r.x * sin + r.z * cos
      this.tyres.skid(wx, wz, Math.atan2(vx, vz))
      if (car.smokeAt <= 0) this.tyres.smoke(wx, wz, vx, vz, 0.6 + Math.abs(car.slip))
    }
    if (car.smokeAt <= 0) car.smokeAt = 0.05
  }

  private readonly tyres = new TyreFx()

  private removeCar(car: Car): void {
    this.root.remove(car.group)
    this.physics.removeBody(car.body)
    this.cars.splice(this.cars.indexOf(car), 1)
  }

  // ------------------------------------------------------------------ walkers

  private addWalker(i: number): void {
    const side: Walker['side'] = i % 3 === 0 ? 'far' : 'near'
    // Now and then one of the rare visitors is out for a stroll too.
    const look = randomLook(i)
    if (Math.random() < 0.05) look.special = SPECIALS[Math.floor(Math.random() * SPECIALS.length)]
    const rig = makePerson(look, { female: !look.special && i % 2 === 1 })
    const x = -38 + ((i * 37) % 76)
    rig.root.position.set(x, 0, this.laneZ(side, i))
    this.root.add(rig.root)
    const w: Walker = {
      rig,
      path: [],
      speed: 1.0 + ((i * 13) % 6) * 0.08,
      side,
      rest: 0,
      bench: null,
      body: this.physics.addMovingBox(rig.root.position.clone().setY(0.9), new THREE.Vector3(0.25, 0.9, 0.25)),
    }
    rig.root.userData.dynamic = true
    this.walkers.push(w)
    this.plan(w)
  }

  private laneZ(side: Walker['side'], k: number): number {
    const zs = side === 'near' ? STREET.near.walkZ : STREET.far.walkZ
    return zs[k % 2]! + (Math.random() - 0.5) * 0.25
  }

  /** What a walker does next: stroll somewhere along the pavement, cross the road at the zebra, or sit on a bench for a while. */
  private plan(w: Walker): void {
    const p = w.rig.root.position
    const roll = Math.random()
    const minX = STREET.plaza.maxX + 1
    const maxX = w.side === 'near' ? STREET.service.minX - 2 : 70
    if (roll < 0.18) {
      // Cross: to the zebra on this side, over the road, then on along the other pavement.
      const fromZ = w.side === 'near' ? STREET.near.maxZ - 0.6 : STREET.far.minZ + 0.6
      const toZ = w.side === 'near' ? STREET.far.minZ + 0.6 : STREET.near.maxZ - 0.6
      w.side = w.side === 'near' ? 'far' : 'near'
      const cx = STREET.crossingX + (Math.random() - 0.5)
      w.path = [new THREE.Vector3(cx, 0, p.z), new THREE.Vector3(cx, 0, fromZ), new THREE.Vector3(cx, 0, toZ), new THREE.Vector3(cx + (Math.random() < 0.5 ? -6 : 6), 0, this.laneZ(w.side, 0))]
      return
    }
    if (roll < 0.32) {
      const free = this.benches.map((b, i) => [b, i] as const).filter(([b]) => !b.taken && Math.abs(b.z - p.z) < 3)
      const pick = free[Math.floor(Math.random() * free.length)]
      if (pick) {
        const [b, i] = pick
        b.taken = true
        w.bench = i
        const front = b.z + (b.yaw === 0 ? 0.6 : -0.6)
        w.path = [new THREE.Vector3(b.x, 0, front), new THREE.Vector3(b.x, 0, b.z)]
        return
      }
    }
    const tx = THREE.MathUtils.clamp(p.x + (Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 25), minX, maxX)
    w.path = [new THREE.Vector3(tx, 0, this.laneZ(w.side, Math.floor(Math.random() * 2)))]
  }

  private updateWalkers(dt: number, player: THREE.Vector3): void {
    for (const w of this.walkers) {
      const pos = w.rig.root.position
      if (w.rest > 0) {
        w.rest -= dt
        const sitting = w.bench !== null
        if (sitting) {
          const b = this.benches[w.bench!]!
          w.rig.root.rotation.y = b.yaw
          pos.set(b.x, 0, b.z)
        }
        animatePerson(w.rig, dt, sitting ? 'sit' : 'idle')
        if (w.rest <= 0) {
          if (w.bench !== null) {
            const b = this.benches[w.bench]!
            b.taken = false
            w.bench = null
            pos.z = b.z + (b.yaw === 0 ? 0.6 : -0.6)
          }
          this.plan(w)
        }
        this.physics.moveBody(w.body, pos.x, 0.9, pos.z, 0)
        continue
      }
      const goal = w.path[0]
      if (!goal) {
        w.rest = Math.random() < 0.3 ? 2 + Math.random() * 4 : 0
        if (w.rest <= 0) this.plan(w)
        continue
      }
      const dx = goal.x - pos.x
      const dz = goal.z - pos.z
      const dist = Math.hypot(dx, dz)
      // Wait for the player to step aside, or for the road to clear at the zebra (cars stop for them anyway).
      const px = player.x - pos.x
      const pz = player.z - pos.z
      const blocked = Math.hypot(px, pz) < 0.9 && (px * dx + pz * dz) > 0
      if (dist < 0.08) {
        w.path.shift()
        if (w.path.length === 0 && w.bench !== null) w.rest = 8 + Math.random() * 14
      } else if (!blocked) {
        const step = Math.min(dist, w.speed * dt)
        pos.x += (dx / dist) * step
        pos.z += (dz / dist) * step
        const want = Math.atan2(dx, dz)
        let d = want - w.rig.root.rotation.y
        d = Math.atan2(Math.sin(d), Math.cos(d))
        w.rig.root.rotation.y += d * Math.min(1, dt * 8)
      }
      animatePerson(w.rig, dt, blocked ? 'idle' : 'walk', w.speed / 1.25)
      this.physics.moveBody(w.body, pos.x, 0.9, pos.z, 0)
    }
  }

  // ------------------------------------------------------------------ frame

  /** `obstacles`: things the traffic must not run into (the player, customers, the VIP's car, trucks). */
  update(dt: number, player: THREE.Vector3, obstacles: readonly THREE.Vector3[]): void {
    dt = Math.min(dt, 0.1)
    this.updateCars(dt, [player, ...obstacles])
    this.tyres.update(dt)
    this.updateWalkers(dt, player)
    for (const rig of this.loungers) animatePerson(rig, dt, rig.root.userData.pose as 'sit' | 'idle')
    this.park?.update(dt)
  }

  /** Walkers' positions (for anything else that should avoid them). */
  people(): THREE.Vector3[] {
    return this.walkers.map((w) => w.rig.root.position)
  }
}

/** Street lamps glow brighter after dark (`night` 0…1, from the sky). */
export function setStreetLampsNight(night: number): void {
  LENS.emissiveIntensity = 1.2 + 2.6 * night
  GLOW.opacity = 0.3 + 0.65 * night
  POOL.opacity = 0.75 * night
  POOL.visible = night > 0.02
}

/** The pool of warm light a street lamp throws on the ground (seen after dark). */
const POOL = new THREE.MeshBasicMaterial({ map: poolTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 })
const POOL_GEO = new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2)

function poolTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')
  if (g) {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
    grad.addColorStop(0, 'rgba(255,214,150,0.7)')
    grad.addColorStop(0.45, 'rgba(255,196,120,0.25)')
    grad.addColorStop(1, 'rgba(255,196,120,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 128, 128)
  }
  return new THREE.CanvasTexture(c)
}

const LENS = new THREE.MeshStandardMaterial({ color: 0xfff7e0, emissive: 0xffe2a8, emissiveIntensity: 1.6 })
const GLOW = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffd9a0, transparent: true, opacity: 0.55, depthWrite: false })

function glowTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    g.addColorStop(0, 'rgba(255,240,210,1)')
    g.addColorStop(1, 'rgba(255,240,210,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 64, 64)
  }
  return new THREE.CanvasTexture(c)
}

/** A plausible look for a passer-by (only used to pick a model). */
function randomLook(i: number): Appearance {
  const k = ((i + 1) * 2654435761) >>> 0
  const pick = <T,>(list: readonly T[], n: number): T => list[(k >>> n) % list.length]!
  return {
    skin: 0,
    hair: pick([0x1f1a17, 0x2b1d14, 0x4a2f1b, 0x8b5a2b, 0xd8b06a, 0x9a9a9a, 0xa3392b], 3),
    hairStyle: pick(['short', 'long', 'bun', 'bald', 'cap'] as const, 7),
    shirt: pick([0x2563eb, 0xdc2626, 0x16a34a, 0xf59e0b, 0x7c3aed, 0x0d9488, 0xdb2777, 0x475569, 0xf8fafc, 0x111827], 11),
    trousers: pick([0x1e293b, 0x374151, 0x3f3f46, 0x1e3a8a, 0x57534e, 0xd6c3a0], 15),
    height: 0.95 + ((i * 7) % 10) / 100,
  }
}

/** A number plate for traffic car `k`. */
function plateFor(k: number): string {
  return `${['LM', 'KT', 'DL', 'SW'][k % 4]}-${String(1000 + ((k * 7919) % 9000)).slice(0, 4)}`
}


/** A square road sign with one big white letter. */
function letterTexture(letter: string, bg: string): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')
  if (g) {
    g.fillStyle = bg
    g.fillRect(0, 0, 128, 128)
    g.strokeStyle = '#ffffff'
    g.lineWidth = 6
    g.strokeRect(8, 8, 112, 112)
    g.fillStyle = '#ffffff'
    g.font = 'bold 84px sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(letter, 64, 70)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
