import type RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import type { PhysicsWorld } from '../engine/PhysicsWorld'
import type { GameManager } from '../sim/GameManager'
import { craterNotch, FLOOR_Y, LAKE } from './layout'
import { makeSign, mat } from './models'
import { prop } from './props'
import { concreteFloor, grassMat, metreUVs, paintedSteel, roadAsphalt, sandMat, shedCladding, waterMat, waterRipples, woodMat } from './textures'

/** How long before impact the meteor is a growing light in the sky, and how long its fiery fall lasts. */
const APPROACH = 90
const FALL = 10
/** Where it comes from: high in the north-west sky (relative to the crater). */
const FROM = new THREE.Vector3(-90, 150, -110)

const C = new THREE.Vector3(LAKE.x, 0, LAKE.z)
const COAST = LAKE.coast
const CH = COAST.channel
/** Where the channel meets the crater's edge (x, on each bank). */
const MOUTH_X = LAKE.x - Math.sqrt(LAKE.r ** 2 - CH.halfWidth ** 2)
/** The lake's water radius once full. */
const FULL_R = LAKE.r * Math.sqrt(1 - LAKE.waterDrop / LAKE.depth) + 0.15
/** The beach: flat to the shore, then shelving into the sea. */
const sandY = (x: number): number => (x >= COAST.shoreX ? -0.02 : Math.max(-4, -0.02 - (COAST.shoreX - x) * 0.12))
/** A visiting ship's day: sailing in, alongside the pier head, backing out, gone (seconds). */
/** Bollards on the pier head the ship ties up to. */
const BOLLARDS = [LAKE.pier.head.minX + 1.4, LAKE.pier.head.maxX - 1.4]
const SHIP = { arrive: 55, moored: 110, depart: 50, away: 25, fromX: -175 }

/** The crater's shape: depth at radius r (a bowl, deepest in the middle). */
const bowlY = (r: number): number => -LAKE.depth * (1 - (r / LAKE.r) ** 2)

/**
 * The meteor and its lake, drawn from `game.meteor`: the grass over the crater site until the strike; the meteor coming in (a light
 * in the sky, then a fireball); the impact (a flash and a cloud of dust); the crater with its rim, rocks and scorch, the meteorite at
 * the bottom; the water rising until it is a lake; and the road and dock once they are bought. It owns its colliders (a low invisible
 * fence round the water, and the pier) and rebuilds them from the state, so a new game puts everything back.
 */
export class Lake {
  readonly root = new THREE.Group()
  private readonly physics: PhysicsWorld
  private readonly cap: THREE.Mesh
  private readonly crater = new THREE.Group()
  private readonly water: THREE.Mesh
  private readonly fireball = new THREE.Group()
  private readonly trail: THREE.Mesh
  private readonly flash: THREE.Mesh
  private readonly dust: { mesh: THREE.Sprite; dir: THREE.Vector3; speed: number; size: number }[] = []
  private readonly smoke: { mesh: THREE.Sprite; phase: number }[] = []
  private road: THREE.Group | null = null
  private dock: THREE.Group | null = null
  private fence: RAPIER.RigidBody[] = []
  private fenceFor: string | null = null
  private pierBodies: RAPIER.RigidBody[] = []
  /** The beach's sand where the channel will be: whole until the strike, then dug out (with its banks). */
  private readonly sandWhole: THREE.Mesh
  private readonly channel = new THREE.Group()
  private readonly ship: THREE.Group
  private readonly lines: THREE.Mesh[] = []

  constructor(physics: PhysicsWorld) {
    this.physics = physics

    // The grass over the crater site (the ground has a hole here), until the strike.
    const notch = new THREE.Shape(craterNotch().map(([x, z]) => new THREE.Vector2(x, -z)))
    this.cap = new THREE.Mesh(new THREE.ShapeGeometry(notch), grassMat(0x5f8a46))
    this.cap.rotation.x = -Math.PI / 2
    this.cap.position.y = FLOOR_Y - 0.02
    this.cap.receiveShadow = true
    this.root.add(this.cap)

    // The beach and the sea (always there), and the channel the meteor will cut through to the lake.
    const sand = sandMat(0xd9c49a)
    const hw = CH.halfWidth
    this.root.add(this.sandStrip(-300, CH.z - hw, sand), this.sandStrip(CH.z + hw, 300, sand))
    this.sandWhole = this.sandStrip(CH.z - hw, CH.z + hw, sand)
    this.root.add(this.sandWhole)
    const sea = new THREE.Mesh(metreWaterUVs(new THREE.PlaneGeometry(440, 1000)), waterMat())
    sea.rotation.x = -Math.PI / 2
    sea.position.set(-58 - 220, COAST.seaY, 0)
    this.root.add(sea)
    this.buildBeach()
    this.buildChannel(sand)
    this.channel.visible = false
    this.root.add(this.channel)
    // You can wade in up to your knees, no further: a slope you walk down, then a fence.
    // (all along the coast: once the channel is cut, its banks fence it off)
    for (const [z0, z1] of [[-300, 300]] as const) {
      const len = COAST.shoreX - COAST.wadeX
      const angle = Math.atan(0.12)
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle)
      this.physics.addStaticBoxRotated(
        new THREE.Vector3((COAST.shoreX + COAST.wadeX) / 2, sandY((COAST.shoreX + COAST.wadeX) / 2) - 0.3, (z0 + z1) / 2),
        new THREE.Vector3(len / 2 + 0.1, 0.3, (z1 - z0) / 2),
        { x: q.x, y: q.y, z: q.z, w: q.w },
      )
      this.physics.addStaticBox(new THREE.Vector3(COAST.wadeX - 0.2, 0, (z0 + z1) / 2), new THREE.Vector3(0.2, 1.5, (z1 - z0) / 2))
    }

    this.ship = makeShip()
    this.ship.visible = false
    this.root.add(this.ship)
    for (let i = 0; i < 2; i++) {
      const line = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 6), mat(0xe7d9b8, 0.8))
      line.visible = false
      this.root.add(line)
      this.lines.push(line)
    }

    this.buildCrater()
    this.crater.visible = false
    this.root.add(this.crater)

    this.water = new THREE.Mesh(new THREE.CircleGeometry(1, 72), waterMat())
    this.water.rotation.x = -Math.PI / 2
    this.water.position.set(LAKE.x, -LAKE.depth, LAKE.z)
    this.water.visible = false
    this.water.receiveShadow = true
    this.root.add(this.water)

    // The meteor: a glowing core, a halo, and a trail of fire behind it while it falls.
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4, 1), new THREE.MeshBasicMaterial({ color: 0xffc46b, fog: false }))
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff7a1a, transparent: true, depthWrite: false, fog: false }))
    halo.scale.setScalar(9)
    this.trail = new THREE.Mesh(
      new THREE.ConeGeometry(1.5, 1, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff5a14, transparent: true, opacity: 0.8, fog: false, depthWrite: false, side: THREE.DoubleSide }),
    )
    this.trail.visible = false
    this.fireball.add(core, halo, this.trail)
    this.fireball.visible = false
    this.root.add(this.fireball)

    this.flash = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffd28a, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }),
    )
    this.flash.position.copy(C)
    this.flash.visible = false
    this.root.add(this.flash)

    // Dust thrown out by the impact, and smoke rising from the crater afterwards: soft puffs (sprites) that grow and fade.
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2 + Math.sin(i * 7.3) * 0.25
      const up = 0.25 + (Math.sin(i * 3.1) * 0.5 + 0.5) * 1.1
      const tone = i % 3 === 0 ? 0x6b5a48 : i % 3 === 1 ? 0x8a7a68 : 0x9a948c
      const mesh = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTexture(), color: tone, transparent: true, depthWrite: false }))
      mesh.visible = false
      this.root.add(mesh)
      this.dust.push({ mesh, dir: new THREE.Vector3(Math.cos(a), up, Math.sin(a)).normalize(), speed: 6 + (i % 5) * 2.5, size: 3 + (i % 4) })
    }
    for (let i = 0; i < 12; i++) {
      const mesh = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTexture(), color: 0x9a958e, transparent: true, depthWrite: false }))
      mesh.visible = false
      this.root.add(mesh)
      this.smoke.push({ mesh, phase: i / 12 })
    }
  }

  /** The crater: a rough bowl, a raised rim of thrown-up earth, boulders, a scorch mark, and the meteorite itself at the bottom. */
  private buildCrater(): void {
    const soil = new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 1, flatShading: true, side: THREE.DoubleSide })
    const pts: THREE.Vector2[] = []
    for (let i = 0; i <= 16; i++) {
      const r = (i / 16) * LAKE.r
      pts.push(new THREE.Vector2(r, bowlY(r)))
    }
    const bowlGeo = new THREE.LatheGeometry(pts, 64)
    // Roughen it a little (not the very edge, so it meets the ground).
    const pos = bowlGeo.getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const r = Math.hypot(x, z)
      // Where the channel breaks through (west), the bowl is dug down to the channel's bed.
      if (x < 0 && Math.abs(z - (CH.z - LAKE.z)) < CH.halfWidth + 0.4 && r > 5) {
        pos.setY(i, Math.min(pos.getY(i), -2.6))
        continue
      }
      if (r > LAKE.r - 0.3) continue
      pos.setY(i, pos.getY(i) + (Math.sin(x * 1.7) * Math.cos(z * 1.3) + Math.sin((x + z) * 0.7)) * 0.18)
    }
    bowlGeo.computeVertexNormals()
    const bowl = new THREE.Mesh(bowlGeo, soil)
    bowl.position.copy(C)
    bowl.receiveShadow = true
    this.crater.add(bowl)

    // The rim: a ring of earth just outside the edge.
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1, flatShading: true })
    // (open on the west, where the channel runs out to the sea)
    const gap = Math.asin((CH.halfWidth + 1) / (LAKE.r + 0.7))
    const arc = Math.PI * 2 - gap * 2
    const rim = new THREE.Mesh(new THREE.TorusGeometry(LAKE.r + 0.7, 1.0, 6, 72, arc), rimMat)
    rim.rotation.x = -Math.PI / 2
    rim.scale.set(1, 1, 0.45)
    rim.castShadow = true
    rim.receiveShadow = true
    const rimTurn = new THREE.Group()
    rimTurn.position.set(LAKE.x, -0.22, LAKE.z)
    rimTurn.rotation.y = -arc / 2
    rimTurn.add(rim)
    this.crater.add(rimTurn)

    // A scorch mark round it, fading out.
    const scorch = new THREE.Mesh(
      new THREE.RingGeometry(LAKE.r + 1.2, LAKE.r + 9, 72),
      new THREE.MeshBasicMaterial({ map: scorchTexture(), transparent: true, depthWrite: false }),
    )
    scorch.rotation.x = -Math.PI / 2
    scorch.position.set(LAKE.x, 0.004, LAKE.z)
    this.crater.add(scorch)

    // Boulders thrown out around the rim.
    const rock = new THREE.MeshStandardMaterial({ color: 0x5b5651, roughness: 0.95, flatShading: true })
    for (let i = 0; i < 18; i++) {
      const a = i * 2.39996
      const d = LAKE.r + 2 + (Math.sin(i * 5.1) * 0.5 + 0.5) * 6
      const s = 0.3 + (Math.sin(i * 2.7) * 0.5 + 0.5) * 0.7
      const b = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rock)
      b.position.set(LAKE.x + Math.cos(a) * d, s * 0.5, LAKE.z + Math.sin(a) * d)
      b.rotation.set(i, i * 2, i * 3)
      b.castShadow = true
      // Keep the shore by the pier clear.
      if (Math.sin(a) > 0.75 || Math.cos(a) < -0.75) continue
      this.crater.add(b)
    }
    // The meteorite, half buried at the bottom (the water closes over it).
    const meteorite = new THREE.Mesh(
      new THREE.DodecahedronGeometry(1.6, 1),
      new THREE.MeshStandardMaterial({ color: 0x2a2523, roughness: 0.6, metalness: 0.4, emissive: 0x7a2a08, emissiveIntensity: 0.6, flatShading: true }),
    )
    meteorite.position.set(LAKE.x + 1.2, -LAKE.depth + 0.6, LAKE.z - 0.8)
    meteorite.scale.set(1.2, 0.8, 1)
    meteorite.castShadow = true
    this.crater.add(meteorite)
  }

  update(dt: number, game: GameManager): void {
    const m = game.meteor
    const now = game.now
    this.cap.visible = !m.struck
    this.crater.visible = m.struck
    this.sandWhole.visible = !m.struck
    this.channel.visible = m.struck
    this.updateShip(now, m.dock && m.phase === 'lake')

    // The meteor coming in.
    const left = m.timeLeft(now)
    if (left !== null && left < APPROACH) {
      const k = 1 - left / APPROACH
      const t = Math.pow(k, 6)
      this.fireball.visible = true
      this.fireball.position.copy(C).addScaledVector(FROM, 1 - t)
      this.fireball.scale.setScalar(0.4 + 1.6 * Math.pow(k, 3))
      const falling = left < FALL
      this.trail.visible = falling
      if (falling) {
        // The trail points back up the path, longer as it speeds up.
        const len = 6 + 50 * (1 - left / FALL)
        this.trail.scale.set(1, len, 1)
        const back = FROM.clone().normalize()
        this.trail.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), back.negate())
        this.trail.position.copy(FROM).normalize().multiplyScalar(len / 2)
      }
    } else {
      this.fireball.visible = false
    }

    // The impact: a flash, then dust flying out and settling, then smoke while it fills.
    const since = m.struck && m.impactAt !== null ? now - m.impactAt : -1
    this.flash.visible = since >= 0 && since < 2.5
    if (this.flash.visible) {
      this.flash.scale.setScalar(3 + since * 16)
      ;(this.flash.material as THREE.MeshBasicMaterial).opacity = 1 - since / 2.5
    }
    const dustOn = since >= 0 && since < 22
    for (const d of this.dust) {
      d.mesh.visible = dustOn
      if (!dustOn) continue
      const s = Math.min(since, 6)
      const out = d.speed * (1 - Math.exp(-s * 0.6)) / 0.6
      d.mesh.position.set(LAKE.x + d.dir.x * out, Math.max(1, d.dir.y * out * 1.3 + since * 0.4), LAKE.z + d.dir.z * out)
      d.mesh.scale.setScalar(d.size * (1 + since * 0.25))
      d.mesh.material.opacity = Math.min(1, since * 4) * Math.max(0, 0.8 - since / 22)
    }
    const level = m.waterLevel(now)
    const smoking = m.phase === 'filling'
    for (const p of this.smoke) {
      p.mesh.visible = smoking
      if (!smoking) continue
      const u = (now * 0.08 + p.phase) % 1
      p.mesh.position.set(LAKE.x + Math.sin(p.phase * 20) * 2.5, -LAKE.depth + 1 + u * 14, LAKE.z + Math.cos(p.phase * 20) * 2.5)
      p.mesh.scale.setScalar(3 + u * 6)
      p.mesh.material.opacity = (1 - u) * 0.45 * (1 - level)
    }

    // The water rises up the bowl.
    this.water.visible = m.struck && level > 0.005
    if (this.water.visible) {
      const y = -LAKE.depth + level * (LAKE.depth - LAKE.waterDrop)
      const r = LAKE.r * Math.sqrt(Math.max(0, 1 + y / LAKE.depth)) + 0.15
      this.water.position.y = y
      this.water.scale.setScalar(r)
      const ripples = waterRipples()
      ripples.offset.x = (ripples.offset.x + dt * 0.01) % 1
      ripples.offset.y = (ripples.offset.y + dt * 0.006) % 1
    }

    this.syncFence(m.struck, m.dock)
    this.syncRoad(m.road)
    this.syncDock(m.dock)
  }

  /** A low invisible fence round the crater (with a gap where the pier goes, once there is one). */
  private syncFence(struck: boolean, dock: boolean): void {
    const want = struck ? (dock ? 'dock' : 'full') : null
    if (want === this.fenceFor) return
    for (const b of this.fence) this.physics.removeBody(b)
    this.fence = []
    this.fenceFor = want
    if (!want) return
    const r = LAKE.r + 0.9
    const n = 72
    const seg = (2 * Math.PI * r) / n
    const gap = (LAKE.pier.halfWidth + 0.15) / r
    const west = Math.asin((CH.halfWidth + 0.2) / r)
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2
      if (want === 'dock' && Math.abs(th - Math.PI / 2) < gap) continue
      if (Math.abs(th - Math.PI) < west) continue
      const phi = -(th + Math.PI / 2)
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), phi)
      this.fence.push(
        this.physics.addStaticBoxRotated(
          new THREE.Vector3(LAKE.x + Math.cos(th) * r, 0.6, LAKE.z + Math.sin(th) * r),
          new THREE.Vector3(seg / 2 + 0.1, 0.6, 0.2),
          { x: q.x, y: q.y, z: q.z, w: q.w },
        ),
      )
    }
    // Both banks of the channel, from the crater out to the sea.
    for (const z of [CH.z + CH.halfWidth + 0.25, CH.z - CH.halfWidth - 0.25]) {
      const x0 = COAST.wadeX - 0.4
      const x1 = MOUTH_X + 0.6
      this.fence.push(this.physics.addStaticBox(new THREE.Vector3((x0 + x1) / 2, 0.6, z), new THREE.Vector3((x1 - x0) / 2, 0.6, 0.2)))
    }
  }

  private box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D, shadow = true): THREE.Mesh {
    const mesh = new THREE.Mesh(metreUVs(new THREE.BoxGeometry(w, h, d)), m)
    mesh.position.set(x, y, z)
    mesh.castShadow = shadow
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }

  /** The road from the main street down to the hard-standing on the lake's north shore. */
  private syncRoad(want: boolean): void {
    if (want === !!this.road) return
    if (!want) {
      this.road?.removeFromParent()
      this.road = null
      return
    }
    const g = new THREE.Group()
    const { road, apron } = LAKE
    const asphalt = roadAsphalt(0x3a3d43)
    const white = mat(0xf8fafc, 0.6)
    const yellow = mat(0xf2d16b, 0.6)
    this.box(road.maxX - road.minX, 0.03, road.maxZ - road.minZ, asphalt, (road.minX + road.maxX) / 2, 0.015, (road.minZ + road.maxZ) / 2, g, false)
    this.box(apron.maxX - apron.minX, 0.03, apron.maxZ - apron.minZ, concreteFloor(0xa8a49c), (apron.minX + apron.maxX) / 2, 0.015, (apron.minZ + apron.maxZ) / 2, g, false)
    const cx = (road.minX + road.maxX) / 2
    for (let z = road.maxZ - 1.2; z > road.minZ + 0.5; z -= 3.6) this.box(0.12, 0.008, 1.6, yellow, cx, 0.034, z, g, false)
    for (const x of [road.minX + 0.2, road.maxX - 0.2]) this.box(0.1, 0.008, road.maxZ - road.minZ - 0.4, white, x, 0.034, (road.minZ + road.maxZ) / 2, g, false)
    // A kerb of stone blocks along the shore side of the hard-standing.
    this.box(apron.maxX - apron.minX, 0.18, 0.25, concreteFloor(0x8c8a85), (apron.minX + apron.maxX) / 2, 0.09, apron.minZ + 0.12, g)
    const sign = makeSign('← LAKE', 1.4, 0.32, '#0f172a', '#7dd3fc')
    sign.position.set(road.maxX + 0.4, 2.0, road.maxZ - 1.5)
    sign.rotation.y = Math.PI / 2
    g.add(sign)
    this.box(0.08, 2.0, 0.08, paintedSteel(0x6b7280), road.maxX + 0.4, 1.0, road.maxZ - 1.5, g)
    this.root.add(g)
    this.road = g
  }

  /** The small dock: a timber pier on piles out into the water, bollards, lamps, a lifebuoy and the harbour office. */
  private syncDock(want: boolean): void {
    if (want === !!this.dock) {
      return
    }
    for (const b of this.pierBodies) this.physics.removeBody(b)
    this.pierBodies = []
    if (!want) {
      this.dock?.removeFromParent()
      this.dock = null
      return
    }
    const g = new THREE.Group()
    const { pier, apron } = LAKE
    const plank = woodMat(0x8a6a48)
    const darkWood = woodMat(0x4a3826)
    const len = pier.fromZ - pier.toZ
    const top = 0.08
    for (let z = pier.fromZ - 0.17; z > pier.toZ; z -= 0.34) this.box(pier.halfWidth * 2, 0.06, 0.3, plank, pier.x, top - 0.03, z, g)
    // The pier head: a cross-piece the ships lie alongside.
    const head = pier.head
    const hd = head.maxZ - head.minZ
    for (let x = head.minX + 0.17; x < head.maxX; x += 0.34) this.box(0.3, 0.06, hd, plank, x, top - 0.03, (head.minZ + head.maxZ) / 2, g)
    this.box(head.maxX - head.minX, 0.2, 0.14, darkWood, (head.minX + head.maxX) / 2, top - 0.16, head.minZ + 0.07, g)
    for (let x = head.minX + 0.2; x <= head.maxX; x += 2) {
      const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, LAKE.depth + 0.4, 10), darkWood)
      pile.position.set(x, top - (LAKE.depth + 0.4) / 2 + 0.15, head.minZ + 0.1)
      pile.castShadow = true
      g.add(pile)
    }
    // Fenders (old tyres) along the head's south face, and its bollards.
    for (let x = head.minX + 1; x < head.maxX; x += 2.5) {
      const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.1, 8, 16), mat(0x111111, 0.9))
      tyre.position.set(x, top - 0.35, head.minZ - 0.08)
      g.add(tyre)
    }
    for (const x of BOLLARDS) {
      const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.42, 12), mat(0x1f2937, 0.5, 0.5))
      bollard.position.set(x, top + 0.21, head.minZ + 0.3)
      g.add(bollard)
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.06, 12), mat(0x1f2937, 0.5, 0.5))
      cap.position.set(x, top + 0.45, head.minZ + 0.3)
      g.add(cap)
    }
    for (const s of [-1, 1]) {
      this.box(0.14, 0.2, len, darkWood, pier.x + s * (pier.halfWidth - 0.07), top - 0.16, (pier.fromZ + pier.toZ) / 2, g)
      for (let z = pier.fromZ - 1; z >= pier.toZ; z -= 2.2) {
        const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, LAKE.depth + 0.4, 10), darkWood)
        pile.position.set(pier.x + s * (pier.halfWidth - 0.05), top - (LAKE.depth + 0.4) / 2 + 0.15, z)
        pile.castShadow = true
        g.add(pile)
      }
      // Bollards along each edge.
      for (const z of [pier.fromZ - 2.5]) {
        const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.42, 12), mat(0x1f2937, 0.5, 0.5))
        bollard.position.set(pier.x + s * (pier.halfWidth - 0.25), top + 0.21, z)
        g.add(bollard)
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.06, 12), mat(0x1f2937, 0.5, 0.5))
        cap.position.set(pier.x + s * (pier.halfWidth - 0.25), top + 0.45, z)
        g.add(cap)
      }
    }
    // A post with a lifebuoy at the far end.
    this.box(0.12, 1.2, 0.12, paintedSteel(0xe5e7eb), head.maxX - 0.3, top + 0.6, head.maxZ - 0.3, g)
    const buoy = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.08, 10, 24), mat(0xf97316, 0.6))
    buoy.position.set(head.maxX - 0.3, top + 0.85, head.maxZ - 0.38)
    g.add(buoy)
    // Lamps either side of the pier's root.
    for (const s of [-1, 1]) g.add(prop('street_lamp_02', { x: pier.x + s * (pier.halfWidth + 0.8), z: pier.fromZ + 0.9, height: 4.2 }))
    // The harbour office at the west end of the hard-standing.
    const ox = apron.minX + 2.2
    const oz = (apron.minZ + apron.maxZ) / 2 + 0.6
    const wall = mat(0xe2e8f0, 0.8)
    this.box(3.2, 2.6, 2.8, wall, ox, 1.3, oz, g)
    this.box(3.5, 0.15, 3.1, mat(0x1e3a8a, 0.6, 0.2), ox, 2.68, oz, g)
    this.box(1.6, 0.9, 0.05, mat(0x22313f, 0.15, 0.6), ox + 0.3, 1.5, oz - 1.42, g)
    this.box(0.8, 2.0, 0.05, mat(0x1e3a8a, 0.6), ox - 1.0, 1.0, oz - 1.42, g)
    const sign = makeSign('HARBOUR', 1.6, 0.34, '#0f172a', '#7dd3fc')
    sign.position.set(ox, 2.35, oz - 1.45)
    sign.rotation.y = Math.PI
    g.add(sign)
    this.pierBodies.push(this.physics.addStaticBox(new THREE.Vector3(ox, 1.3, oz), new THREE.Vector3(1.6, 1.3, 1.4)))
    // The deck you walk on, and its edges (the fence has a gap here).
    const box = (x0: number, x1: number, z0: number, z1: number, y: number, hy: number) =>
      this.pierBodies.push(this.physics.addStaticBox(new THREE.Vector3((x0 + x1) / 2, y, (z0 + z1) / 2), new THREE.Vector3((x1 - x0) / 2, hy, (z1 - z0) / 2)))
    box(pier.x - pier.halfWidth, pier.x + pier.halfWidth, head.maxZ, pier.fromZ, top - 0.05, 0.05)
    box(head.minX, head.maxX, head.minZ, head.maxZ, top - 0.05, 0.05)
    // Its edges (the fence has a gap where the pier crosses it).
    for (const s of [-1, 1]) box(pier.x + s * (pier.halfWidth + 0.1) - 0.1, pier.x + s * (pier.halfWidth + 0.1) + 0.1, head.maxZ, pier.fromZ, 0.6, 0.6)
    box(head.minX - 0.2, head.maxX + 0.2, head.minZ - 0.2, head.minZ, 0.6, 0.6)
    box(head.minX - 0.2, head.minX, head.minZ, head.maxZ, 0.6, 0.6)
    box(head.maxX, head.maxX + 0.2, head.minZ, head.maxZ, 0.6, 0.6)
    box(head.minX, pier.x - pier.halfWidth, head.maxZ, head.maxZ + 0.2, 0.6, 0.6)
    box(pier.x + pier.halfWidth, head.maxX, head.maxZ, head.maxZ + 0.2, 0.6, 0.6)
    this.root.add(g)
    this.dock = g
  }

  /** A strip of beach from z0 to z1: flat sand to the shore, then shelving down under the sea. UVs in metres. */
  private sandStrip(z0: number, z1: number, material: THREE.Material): THREE.Mesh {
    const xs: number[] = []
    for (let x = -130; x < COAST.grassX; x += 1) xs.push(x)
    xs.push(COAST.grassX)
    const pos: number[] = []
    const uv: number[] = []
    const idx: number[] = []
    xs.forEach((x, i) => {
      for (const z of [z0, z1]) {
        pos.push(x, sandY(x), z)
        uv.push(x, -z)
      }
      if (i > 0) {
        const a = (i - 1) * 2
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    })
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    geo.setIndex(idx)
    geo.computeVertexNormals()
    const mesh = new THREE.Mesh(geo, material)
    mesh.receiveShadow = true
    return mesh
  }

  /** The channel the strike cuts from the crater to the sea: its dug-out bed, earth banks, and the water in it. */
  private buildChannel(sand: THREE.Material): void {
    const hw = CH.halfWidth
    const bed = -2.7
    const soil = new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 1, flatShading: true, side: THREE.DoubleSide })
    // Under the grass: two earth walls and a floor, from the grass edge to the crater.
    for (const z of [CH.z + hw, CH.z - hw]) this.box(MOUTH_X + 0.6 - COAST.grassX, -bed, 0.1, soil, (COAST.grassX + MOUTH_X + 0.6) / 2, bed / 2 - 0.02, z, this.channel, false)
    this.box(MOUTH_X + 0.6 - COAST.grassX, 0.1, hw * 2, soil, (COAST.grassX + MOUTH_X + 0.6) / 2, bed, CH.z, this.channel, false)
    // Across the beach: the sand dug down to the bed, with sandy banks following the shelving beach.
    const flat = this.sandStrip(CH.z - hw, CH.z + hw, sand)
    const p = flat.geometry.getAttribute('position')
    for (let i = 0; i < p.count; i++) p.setY(i, Math.min(p.getY(i), bed))
    flat.geometry.computeVertexNormals()
    this.channel.add(flat)
    for (const z of [CH.z + hw, CH.z - hw]) {
      const pos: number[] = []
      const idx: number[] = []
      let n = 0
      for (let x = -130; x <= COAST.grassX; x += 1) {
        pos.push(x, sandY(x), z, x, bed, z)
        if (n > 0) idx.push(n * 2 - 2, n * 2 - 1, n * 2, n * 2 - 1, n * 2 + 1, n * 2)
        n++
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      geo.setIndex(idx)
      geo.computeVertexNormals()
      this.channel.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xbfa77a, roughness: 1, side: THREE.DoubleSide })))
    }
    // The water: from the sea (it starts where the sea plane stops) to the lake's edge.
    const a = Math.atan2(hw, -Math.sqrt(FULL_R ** 2 - hw ** 2))
    const pts: THREE.Vector2[] = [new THREE.Vector2(-58, -(CH.z + hw))]
    for (let i = 0; i <= 24; i++) {
      const t = a + ((Math.PI * 2 - 2 * a) * i) / 24
      pts.push(new THREE.Vector2(LAKE.x + Math.cos(t) * FULL_R, -(LAKE.z + Math.sin(t) * FULL_R)))
    }
    pts.push(new THREE.Vector2(-58, -(CH.z - hw)))
    const water = new THREE.Mesh(metreWaterUVs(new THREE.ShapeGeometry(new THREE.Shape(pts))), waterMat())
    water.rotation.x = -Math.PI / 2
    water.position.y = COAST.seaY
    this.channel.add(water)
  }

  /** A bit of seaside: umbrellas and sun loungers on the sand either side of the channel, and a sign at the end of the street. */
  private buildBeach(): void {
    const cloth = [0xef4444, 0x2563eb, 0xf59e0b, 0x10b981]
    const spots: [number, number][] = [[-59.6, 22], [-59.2, 28.5], [-59.8, 35], [-59.4, 42], [-59.5, -42], [-59.2, -49], [-59.7, -56]]
    spots.forEach(([x, z], i) => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.3, 6), mat(0xe5e7eb, 0.5))
      pole.position.set(x, 1.15, z)
      const shade = new THREE.Mesh(new THREE.ConeGeometry(1.25, 0.5, 8, 1, true), new THREE.MeshStandardMaterial({ color: cloth[i % cloth.length], roughness: 0.8, side: THREE.DoubleSide }))
      shade.position.set(x, 2.25, z)
      shade.castShadow = true
      const lounger = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.12, 1.8), mat(0xf8fafc, 0.6))
      lounger.position.set(x + 1.2, 0.3, z + 0.3)
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.1, 0.7), mat(0xf8fafc, 0.6))
      back.position.set(x + 1.2, 0.5, z + 1.05)
      back.rotation.x = -0.7
      const towel = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.01, 1.7), mat(cloth[(i + 1) % cloth.length]!, 0.9))
      towel.position.set(x - 1.2, 0.0, z + 0.4)
      this.root.add(pole, shade, lounger, back, towel)
    })
    const sign = makeSign('BEACH', 1.2, 0.32, '#0f172a', '#fde68a')
    sign.position.set(COAST.grassX + 0.6, 2.0, 10.6)
    sign.rotation.y = Math.PI / 2
    this.root.add(sign)
    this.box(0.08, 2.0, 0.08, paintedSteel(0x6b7280), COAST.grassX + 0.6, 1.0, 10.55, this.root)
  }

  /** The visiting cargo ship: sails in from the haze, lies alongside the pier head (moored by two lines), backs out to sea. */
  private updateShip(now: number, dock: boolean): void {
    const period = SHIP.arrive + SHIP.moored + SHIP.depart + SHIP.away
    const t = now % period
    const { berth } = LAKE
    let x: number | null = null
    let moored = false
    if (!dock) x = null
    else if (t < SHIP.arrive) x = SHIP.fromX + (berth.x - SHIP.fromX) * (1 - (1 - t / SHIP.arrive) ** 3)
    else if (t < SHIP.arrive + SHIP.moored) {
      x = berth.x
      moored = true
    } else if (t < SHIP.arrive + SHIP.moored + SHIP.depart) x = berth.x + (SHIP.fromX - berth.x) * ((t - SHIP.arrive - SHIP.moored) / SHIP.depart) ** 3
    this.ship.visible = x !== null
    if (x !== null) {
      this.ship.position.set(x, COAST.seaY + Math.sin(now * 0.8) * 0.04, berth.z)
      this.ship.rotation.x = Math.sin(now * 0.6) * 0.012
    }
    const head = LAKE.pier.head
    BOLLARDS.forEach((bx, i) => {
      const line = this.lines[i]!
      line.visible = moored
      if (!moored) return
      const from = new THREE.Vector3(berth.x + (i === 0 ? -7 : 6.5), COAST.seaY + 1.5, berth.z + berth.beam / 2 - 0.2)
      const to = new THREE.Vector3(bx, 0.45, head.minZ + 0.3)
      line.position.copy(from).add(to).multiplyScalar(0.5)
      line.scale.set(1, from.distanceTo(to), 1)
      line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize())
    })
  }

}

let glow: THREE.CanvasTexture | null = null
function glowTexture(): THREE.CanvasTexture {
  if (glow) return glow
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.25, 'rgba(255,200,120,0.8)')
    g.addColorStop(1, 'rgba(255,120,40,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 128, 128)
  }
  glow = new THREE.CanvasTexture(canvas)
  glow.colorSpace = THREE.SRGBColorSpace
  return glow
}

/** Scorched earth round the crater: dark at the rim, fading out (RingGeometry maps its texture flat, so this is a radial gradient). */
function scorchTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const inner = (LAKE.r + 1.2) / (LAKE.r + 9)
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128)
    g.addColorStop(0, 'rgba(30,22,16,0.85)')
    g.addColorStop(inner, 'rgba(30,22,16,0.85)')
    g.addColorStop(inner + (1 - inner) * 0.45, 'rgba(45,35,25,0.35)')
    g.addColorStop(1, 'rgba(60,50,35,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 256, 256)
  }
  const t = new THREE.CanvasTexture(canvas)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

let puff: THREE.CanvasTexture | null = null
/** A soft round puff of dust or smoke (white, tinted by the sprite's colour). */
function puffTexture(): THREE.CanvasTexture {
  if (puff) return puff
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (ctx) {
    for (let i = 0; i < 6; i++) {
      const x = 64 + Math.sin(i * 2.1) * 16
      const y = 64 + Math.cos(i * 1.7) * 16
      const g = ctx.createRadialGradient(x, y, 0, x, y, 46)
      g.addColorStop(0, 'rgba(255,255,255,0.55)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, 128, 128)
    }
  }
  puff = new THREE.CanvasTexture(canvas)
  puff.colorSpace = THREE.SRGBColorSpace
  return puff
}

/** Water UVs in metres (scaled so the ripples are the same size on every piece of water: the lake disc's tile is ~4 m). */
function metreWaterUVs<T extends THREE.BufferGeometry>(geo: T): T {
  const pos = geo.getAttribute('position')
  const uv = geo.getAttribute('uv')
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 26, pos.getY(i) / 26)
  uv.needsUpdate = true
  return geo
}

/**
 * A small container ship, bow to +x, waterline at y = 0: a red and navy hull with a pointed bow, a white bridge and funnel at the
 * stern, and two tiers of containers on deck.
 */
function makeShip(): THREE.Group {
  const g = new THREE.Group()
  const { length: L, beam: B } = LAKE.berth
  const outline = new THREE.Shape([
    new THREE.Vector2(-L / 2, -B / 2),
    new THREE.Vector2(L / 2 - 3.5, -B / 2),
    new THREE.Vector2(L / 2, 0),
    new THREE.Vector2(L / 2 - 3.5, B / 2),
    new THREE.Vector2(-L / 2, B / 2),
  ])
  const hullPart = (y0: number, h: number, color: number) => {
    const m = new THREE.Mesh(new THREE.ExtrudeGeometry(outline, { depth: h, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2 }))
    m.rotation.x = -Math.PI / 2
    m.position.y = y0
    m.castShadow = true
    g.add(m)
  }
  hullPart(-1.0, 1.1, 0x9f1d1d)
  hullPart(0.1, 1.4, 0x1e2a44)
  const part = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    g.add(mesh)
    return mesh
  }
  part(L - 4.2, 0.1, B - 0.4, new THREE.MeshStandardMaterial({ color: 0x3f6b4a, roughness: 0.8 }), -0.8, 1.55, 0)
  // The bridge at the stern.
  const white = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.6 })
  part(3.4, 3.4, B - 0.6, white, -L / 2 + 2.2, 3.3, 0)
  part(3.6, 0.15, B - 0.2, white, -L / 2 + 2.2, 5.05, 0)
  part(0.05, 0.6, B - 1.0, new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.2, metalness: 0.4 }), -L / 2 + 3.93, 4.4, 0)
  const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 1.6, 14), new THREE.MeshStandardMaterial({ color: 0xc2410c, roughness: 0.6 }))
  funnel.position.set(-L / 2 + 1.4, 5.9, 0)
  g.add(funnel)
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3, 6), white)
  mast.position.set(L / 2 - 2.2, 3.0, 0)
  g.add(mast)
  // Containers, two tiers.
  const colours = [0xb91c1c, 0x1d4ed8, 0x15803d, 0xc2410c, 0x6b7280, 0x0e7490, 0xa16207, 0x7c3aed]
  let k = 0
  for (let tier = 0; tier < 2; tier++)
    for (const x of [-2.6, 2.7])
      for (const z of [-1.1, 1.1]) {
        const box = part(5.0, 1.25, 2.05, shedCladding(colours[k++ % colours.length]!), x, 2.25 + tier * 1.3, z)
        box.receiveShadow = true
      }
  return g
}

