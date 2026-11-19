import * as THREE from 'three'
import type RAPIER from '@dimforge/rapier3d-compat'
import type { PhysicsWorld } from '../engine/PhysicsWorld'
import type { Appearance, Special } from '../sim/types'
import { kenney, loadKenney } from './kenney'
import { BOX_COLOURS, CAR_COLOURS, KEI_COLOURS, makeCar, makeDeliveryTruck, makeKeiTruck, setBraking, type VehicleModel } from './vehicles'
import { LAKE, STREET } from './layout'
import { animatePerson, makePerson, mat, type PersonRig } from './models'
import { Leg, rounded } from './paths'
import { prop } from './props'
import { concreteFloor, roadAsphalt } from './textures'

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

/** How far a sitting person's feet are below the seat they sit on (the sit clips put the hips ~0.45 m up): a lounger is 0.36 m high. */
const LOUNGER_SEAT = -0.12

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
    this.loop = rounded(
      [
        [STREET.eastX, LANE_WEST],
        [STREET.turnX, LANE_WEST],
        [STREET.turnX - 1.4, (LANE_WEST + LANE_EAST) / 2],
        [STREET.turnX, LANE_EAST],
        [STREET.eastX, LANE_EAST],
      ],
      1.5,
    )
    this.buildStreet()
    this.buildBuildings()
    this.buildFurniture()
    this.buildBeachLife()
    for (let i = 0; i < WALKERS; i++) this.addWalker(i)
    // A few cars already on the road.
    for (let i = 0; i < 4; i++) this.addCar(this.loop.length * (0.12 + i * 0.22))
  }

  // ------------------------------------------------------------------ static

  private deco(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)
    mesh.position.set(x, y, z)
    mesh.receiveShadow = true
    this.root.add(mesh)
    return mesh
  }

  private solid(x: number, y: number, z: number, hx: number, hy: number, hz: number): void {
    this.physics.addStaticBox(new THREE.Vector3(x, y, z), new THREE.Vector3(hx, hy, hz))
  }

  private buildStreet(): void {
    const asphalt = roadAsphalt(0x3a3d43)
    const kerb = mat(0xbdb8b0, 0.95)
    const line = mat(0xf2d16b, 0.6)
    // The road and our pavement carry on east (the shop's part, x −30…30, is the Facility's), with a gap for the service road.
    this.deco(STREET.eastX - 30, 0.03, STREET.road.maxZ - STREET.road.minZ, asphalt, (STREET.eastX + 30) / 2, -0.009, 14.2)
    for (let x = 31; x < STREET.eastX; x += 4) this.deco(2, 0.01, 0.15, line, x, 0.012, 14.2)
    const near = STREET.near
    for (const [a, b] of [[30, STREET.service.minX], [STREET.service.maxX, STREET.eastX]] as const)
      this.deco(b - a, 0.04, near.maxZ - near.minZ, kerb, (a + b) / 2, 0.0, (near.minZ + near.maxZ) / 2)
    this.deco(STREET.service.maxX - STREET.service.minX, 0.03, near.maxZ - near.minZ, asphalt, (STREET.service.minX + STREET.service.maxX) / 2, -0.004, (near.minZ + near.maxZ) / 2)
    // The far pavement, with a concrete kerb along the road.
    const far = STREET.far
    const west = LAKE.coast.grassX
    this.deco(STREET.eastX - west, 0.08, far.maxZ - far.minZ, concreteFloor(0xc4beb4), (STREET.eastX + west) / 2, 0.02, (far.minZ + far.maxZ) / 2)
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

  private buildBuildings(): void {
    // Shops and offices across the street (fronts on `buildingZ`, facing the road), then taller blocks behind them.
    const names = 'abcdefghijklmn'.split('').map((c) => `building-${c}`)
    let x = LAKE.coast.grassX + 6
    let i = 0
    while (x < STREET.eastX - 4) {
      const name = names[(i * 5 + 3) % names.length]!
      const width = 6.5 + ((i * 7) % 3)
      this.root.add(kenney('city', name, { x: x + width / 2, z: STREET.buildingZ + 3.4, rotY: Math.PI, length: width }))
      this.solid(x + width / 2, 4, STREET.buildingZ + 3.4, width / 2 - 0.2, 4, 3.2)
      x += width + 0.4
      i++
    }
    const tall = ['building-skyscraper-a', 'building-skyscraper-b', 'building-skyscraper-c', 'building-skyscraper-d', 'building-skyscraper-e']
    for (let k = 0; k < 12; k++) {
      const tx = -40 + k * 13 + ((k * 37) % 5)
      this.root.add(kenney('city', tall[k % tall.length]!, { x: tx, z: 40 + ((k * 13) % 9), rotY: Math.PI * (k % 2), scale: 7 + (k % 3) }))
    }
  }

  private buildFurniture(): void {
    // Street lamps: a curved post every 12 m on both pavements, the lamp over the road.
    const lampAt: [number, number, number][] = []
    for (let x = -50; x < STREET.eastX - 10; x += 12) {
      const nx = x + 3.5
      if (Math.abs(nx) > 2.5 && (nx < STREET.service.minX - 1 || nx > STREET.service.maxX + 1)) lampAt.push([nx, STREET.near.maxZ - 0.3, Math.PI])
      lampAt.push([x + 9.5, STREET.far.minZ + 0.35, 0])
    }
    for (const [lx, lz, yaw] of lampAt) this.lamp(lx, lz, yaw)

    // Benches facing the road, bins beside them, and hydrants at the kerb.
    for (const [bx, side] of [[-9, 'near'], [5.5, 'near'], [20, 'near'], [-26, 'near'], [-4, 'far'], [14, 'far'], [32, 'far'], [-30, 'far']] as const) {
      const z = side === 'near' ? STREET.near.minZ + 1.0 : STREET.far.maxZ - 0.45
      const yaw = side === 'near' ? 0 : Math.PI
      this.root.add(prop('painted_wooden_bench', { x: bx, z, rotY: yaw, height: 0.85 }))
      this.solid(bx, 0.42, z, 0.85, 0.42, 0.3)
      this.benches.push({ x: bx, z: z + (side === 'near' ? 0.12 : -0.12), yaw, taken: false })
      this.root.add(prop('metal_trash_can', { x: bx + 1.35, z, height: 0.95 }))
      this.solid(bx + 1.35, 0.47, z, 0.28, 0.47, 0.28)
    }
    for (const [hx, hz] of [[-12.5, STREET.near.maxZ - 0.45], [26, STREET.near.maxZ - 0.45], [8, STREET.far.minZ + 0.5], [-34, STREET.far.minZ + 0.5]] as const) {
      this.root.add(prop('fire_hydrant', { x: hx, z: hz, height: 0.75 }))
      this.solid(hx, 0.37, hz, 0.18, 0.37, 0.18)
    }
    // Picnic tables on the grass by the beach.
    for (const [px, pz] of [[LAKE.coast.grassX + 4, 2], [LAKE.coast.grassX + 4, 27], [LAKE.coast.grassX + 5, 34]] as const) {
      this.root.add(prop('wooden_picnic_table', { x: px, z: pz, rotY: Math.PI / 2, height: 0.8 }))
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
    post.add(lens, glow)
    this.solid(x, 2.6, z, 0.12, 2.6, 0.12)
  }

  /** People on the beach: sunbathing on towels, sitting under the parasols, standing at the water's edge. */
  private buildBeachLife(): void {
    // Sitters sit on the loungers by the parasols (Lake.buildBeach: a lounger at x + 1.2, back towards +z), facing −z.
    const spots: [number, number, number, 'sit' | 'idle'][] = [
      [-59.6 + 1.2, 22.1, Math.PI, 'sit'],
      [-59.2 + 1.2, 28.6, Math.PI, 'sit'],
      [-59.8 + 1.2, 34.8, Math.PI, 'sit'],
      [-63.8, 31, -Math.PI / 2, 'idle'],
      [-64.0, 39, -Math.PI / 2, 'idle'],
      [-59.2 + 1.2, -49.2, Math.PI, 'sit'],
      [-63.6, -52, -Math.PI / 2, 'idle'],
    ]
    spots.forEach(([x, z, yaw, pose], i) => {
      const rig = makePerson(randomLook(i * 7 + 3), { female: i % 2 === 0 })
      rig.root.position.set(x, pose === 'sit' ? LOUNGER_SEAT : sandHeight(x), z)
      rig.root.rotation.y = yaw
      rig.root.userData.pose = pose
      this.root.add(rig.root)
      this.loungers.push(rig)
    })
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
    }
    if (model) car.wheels.push(...model.wheels)
    else
      void loadKenney('cars', name).then(() => {
        inner.traverse((o) => {
          if (o.name.startsWith('wheel')) car.wheels.push(o)
        })
      })
    this.root.add(group)
    this.cars.push(car)
    this.placeCar(car)
  }

  private placeCar(car: Car): void {
    const p = car.leg.at(car.s / car.leg.length)
    car.group.position.set(p.x, 0, p.z)
    car.group.rotation.y = p.yaw
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
      const yaw = car.group.rotation.y
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
      // Slow for the turn at the beach end.
      const u = car.s / car.leg.length
      if (Math.abs(p.x - STREET.turnX) < 9) target = Math.min(target, 3.6)
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
    const x = -45 + ((i * 37) % 80)
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
    const minX = w.side === 'near' ? -52 : LAKE.coast.grassX + 2
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
    this.updateWalkers(dt, player)
    for (const rig of this.loungers) animatePerson(rig, dt, rig.root.userData.pose as 'sit' | 'idle')
  }

  /** Walkers' positions (for anything else that should avoid them). */
  people(): THREE.Vector3[] {
    return this.walkers.map((w) => w.rig.root.position)
  }
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

/** The beach's height at x (matches the Lake's sand). */
function sandHeight(x: number): number {
  const { shoreX } = LAKE.coast
  return x >= shoreX ? -0.02 : Math.max(-4, -0.02 - (shoreX - x) * 0.12)
}
