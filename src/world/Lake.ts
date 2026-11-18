import type RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import type { PhysicsWorld } from '../engine/PhysicsWorld'
import type { GameManager } from '../sim/GameManager'
import { FLOOR_Y, LAKE } from './layout'
import { makeSign, mat } from './models'
import { prop } from './props'
import { concreteFloor, grassMat, metreUVs, paintedSteel, roadAsphalt, waterMat, waterRipples, woodMat } from './textures'

/** How long before impact the meteor is a growing light in the sky, and how long its fiery fall lasts. */
const APPROACH = 90
const FALL = 10
/** Where it comes from: high in the north-west sky (relative to the crater). */
const FROM = new THREE.Vector3(-90, 150, -110)

const C = new THREE.Vector3(LAKE.x, 0, LAKE.z)

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

  constructor(physics: PhysicsWorld) {
    this.physics = physics

    // The grass over the crater site (the ground has a hole here), until the strike.
    const disc = new THREE.Shape()
    disc.absarc(LAKE.x, -LAKE.z, LAKE.r + 0.02, 0, Math.PI * 2, false)
    this.cap = new THREE.Mesh(new THREE.ShapeGeometry(disc, 48), grassMat(0x5f8a46))
    this.cap.rotation.x = -Math.PI / 2
    this.cap.position.y = FLOOR_Y - 0.02
    this.cap.receiveShadow = true
    this.root.add(this.cap)

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
    const rim = new THREE.Mesh(new THREE.TorusGeometry(LAKE.r + 0.7, 1.0, 6, 72), rimMat)
    rim.rotation.x = -Math.PI / 2
    rim.scale.set(1, 1, 0.45)
    rim.position.set(LAKE.x, -0.22, LAKE.z)
    rim.castShadow = true
    rim.receiveShadow = true
    this.crater.add(rim)

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
      if (Math.sin(a) > 0.75) continue
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
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2
      if (want === 'dock' && Math.abs(th - Math.PI / 2) < gap) continue
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
    for (const s of [-1, 1]) {
      this.box(0.14, 0.2, len, darkWood, pier.x + s * (pier.halfWidth - 0.07), top - 0.16, (pier.fromZ + pier.toZ) / 2, g)
      for (let z = pier.fromZ - 1; z >= pier.toZ; z -= 2.2) {
        const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, LAKE.depth + 0.4, 10), darkWood)
        pile.position.set(pier.x + s * (pier.halfWidth - 0.05), top - (LAKE.depth + 0.4) / 2 + 0.15, z)
        pile.castShadow = true
        g.add(pile)
      }
      // Bollards along each edge.
      for (const z of [pier.fromZ - 2.5, pier.toZ + 1.2]) {
        const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.42, 12), mat(0x1f2937, 0.5, 0.5))
        bollard.position.set(pier.x + s * (pier.halfWidth - 0.25), top + 0.21, z)
        g.add(bollard)
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.06, 12), mat(0x1f2937, 0.5, 0.5))
        cap.position.set(pier.x + s * (pier.halfWidth - 0.25), top + 0.45, z)
        g.add(cap)
      }
    }
    // A post with a lifebuoy at the far end.
    this.box(0.12, 1.2, 0.12, paintedSteel(0xe5e7eb), pier.x + pier.halfWidth - 0.3, top + 0.6, pier.toZ + 0.4, g)
    const buoy = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.08, 10, 24), mat(0xf97316, 0.6))
    buoy.position.set(pier.x + pier.halfWidth - 0.3, top + 0.85, pier.toZ + 0.32)
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
    this.pierBodies.push(this.physics.addStaticBox(new THREE.Vector3(pier.x, top - 0.05, (pier.fromZ + pier.toZ) / 2), new THREE.Vector3(pier.halfWidth, 0.05, len / 2)))
    for (const s of [-1, 1]) {
      this.pierBodies.push(this.physics.addStaticBox(new THREE.Vector3(pier.x + s * (pier.halfWidth + 0.1), 0.6, (pier.fromZ + pier.toZ) / 2 - 0.4), new THREE.Vector3(0.1, 0.6, len / 2 + 0.4)))
    }
    this.pierBodies.push(this.physics.addStaticBox(new THREE.Vector3(pier.x, 0.6, pier.toZ - 0.1), new THREE.Vector3(pier.halfWidth + 0.2, 0.6, 0.1)))
    this.root.add(g)
    this.dock = g
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

