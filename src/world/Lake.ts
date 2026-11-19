import type RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import type { PhysicsWorld } from '../engine/PhysicsWorld'
import type { GameManager } from '../sim/GameManager'
import type { HarbourManager } from '../sim/HarbourManager'
import { Harbour } from './Harbour'
import { craterNotch, FLOOR_Y, HARBOUR, LAKE } from './layout'
import { makeSign, mat } from './models'
import { grassMat, metreUVs, paintedSteel, sandMat, waterMat, waterRipples } from './textures'

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
/** Where the sand meets the sea (sandY(x) = seaY). */
const WATERLINE_X = COAST.shoreX - (-0.02 - COAST.seaY) / 0.12

const beachMats = new Map<THREE.Material, THREE.Material>()
/** The sand material with vertex colours on (only the beach strips carry colours). */
function beachMat(m: THREE.Material): THREE.Material {
  let b = beachMats.get(m)
  if (!b) {
    b = m.clone()
    ;(b as THREE.MeshStandardMaterial).vertexColors = true
    beachMats.set(m, b)
  }
  return b
}

let foamTex: THREE.CanvasTexture | null = null
/** A soft white band, brightest along its middle, with a broken edge. */
function foamTexture(): THREE.Texture {
  if (foamTex) return foamTex
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 256
  const ctx = c.getContext('2d')
  if (ctx) {
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 64; x++) {
        const d = Math.abs(x - 32 + Math.sin(y * 0.21) * 6 + Math.sin(y * 0.07) * 4) / 32
        const a = Math.max(0, 1 - d * d * 1.6) * (0.6 + 0.4 * Math.sin(x * 1.3 + y * 0.9) ** 2)
        ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`
        ctx.fillRect(x, y, 1, 1)
      }
    }
  }
  foamTex = new THREE.CanvasTexture(c)
  foamTex.wrapT = THREE.RepeatWrapping
  foamTex.repeat.set(1, 60)
  return foamTex
}

const sandY = (x: number): number => (x >= COAST.shoreX ? -0.02 : Math.max(-4, -0.02 - (COAST.shoreX - x) * 0.12))
const BASIN = HARBOUR.basin
const JETTY = HARBOUR.jetty

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
  /** Grass over the whole harbour site (until the strike), and over what the crater does not take (until the basin is dug). */
  private readonly cap: THREE.Mesh
  private readonly capRing: THREE.Mesh
  /** The harbour built on the lake (jetty, marina, quay, crane, warehouse, basin) and its boats and ships. */
  readonly harbour: Harbour
  private readonly crater = new THREE.Group()
  private readonly water: THREE.Mesh
  private readonly fireball = new THREE.Group()
  private readonly trail: THREE.Mesh
  private readonly flash: THREE.Mesh
  private readonly dust: { mesh: THREE.Sprite; dir: THREE.Vector3; speed: number; size: number }[] = []
  private readonly smoke: { mesh: THREE.Sprite; phase: number }[] = []
  private fence: RAPIER.RigidBody[] = []
  private fenceFor: string | null = null
  /** The beach's sand where the channel will be: whole until the strike, then dug out (with its banks). */
  private readonly sandWhole: THREE.Mesh
  private readonly channel = new THREE.Group()
  /** The parts of the channel the basin replaces (its walls under the grass, and its water). */
  private readonly channelInland = new THREE.Group()
  private readonly sea: THREE.Mesh
  private readonly foam: THREE.Mesh[] = []
  private surfT = 0

  constructor(physics: PhysicsWorld) {
    this.physics = physics

    // The ground has the harbour's whole site cut out; grass covers it all until the strike, then all but the crater and its channel.
    const { grassX } = COAST
    const site: [number, number][] = [[grassX, BASIN.maxZ], [BASIN.maxX, BASIN.maxZ], [BASIN.maxX, BASIN.minZ], [grassX, BASIN.minZ]]
    const flat = (pts: [number, number][]) => new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)))
    const notch = craterNotch()
    const ring: [number, number][] = [...site, ...notch.slice().reverse()]
    this.cap = new THREE.Mesh(new THREE.ShapeGeometry(flat(site)), grassMat(0x5f8a46))
    this.capRing = new THREE.Mesh(new THREE.ShapeGeometry(flat(ring)), grassMat(0x5f8a46))
    for (const c of [this.cap, this.capRing]) {
      c.rotation.x = -Math.PI / 2
      c.position.y = FLOOR_Y - 0.02
      c.receiveShadow = true
      this.root.add(c)
    }

    // The beach and the sea (always there), and the channel the meteor will cut through to the lake.
    const sand = sandMat(0xd9c49a)
    const hw = CH.halfWidth
    this.root.add(this.sandStrip(-300, CH.z - hw, sand), this.sandStrip(CH.z + hw, 300, sand))
    this.sandWhole = this.sandStrip(CH.z - hw, CH.z + hw, sand)
    this.root.add(this.sandWhole)
    // The sea: shallow turquoise by the beach, deepening to dark blue offshore (vertex colours over the water material).
    const seaGeo = metreWaterUVs(new THREE.PlaneGeometry(440, 1000, 88, 1))
    const sp = seaGeo.getAttribute('position')
    const seaCol: number[] = []
    const shallow = new THREE.Color(0x7fe0d6)
    const deep = new THREE.Color(0x2a4f7a)
    const c = new THREE.Color()
    for (let i = 0; i < sp.count; i++) {
      const worldX = -58 - 220 + sp.getX(i)
      const t = THREE.MathUtils.smoothstep(COAST.shoreX - worldX, 1, 40)
      c.copy(shallow).lerp(deep, t)
      seaCol.push(c.r * 1.6, c.g * 1.6, c.b * 1.6)
    }
    seaGeo.setAttribute('color', new THREE.Float32BufferAttribute(seaCol, 3))
    const seaMat = waterMat().clone()
    seaMat.vertexColors = true
    this.sea = new THREE.Mesh(seaGeo, seaMat)
    this.sea.rotation.x = -Math.PI / 2
    this.sea.position.set(-58 - 220, COAST.seaY, 0)
    this.root.add(this.sea)
    // Surf: two soft white bands that wash up and down the sand at the waterline.
    for (let k = 0; k < 2; k++) {
      const foam = new THREE.Mesh(
        new THREE.PlaneGeometry(1.1, 600),
        new THREE.MeshBasicMaterial({ map: foamTexture(), color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false }),
      )
      foam.rotation.x = -Math.PI / 2
      foam.position.set(WATERLINE_X, COAST.seaY + 0.012 + k * 0.004, 0)
      foam.renderOrder = 2
      this.foam.push(foam)
      this.root.add(foam)
    }
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

    this.harbour = new Harbour(physics)
    this.root.add(this.harbour.root)

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

    // The rim: a ring of earth just outside the edge, open where the channel, the cargo quay and the jetty cross it.
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1, flatShading: true })
    const rimR = LAKE.r + 0.7
    const q = HARBOUR.quay
    const half = (w: number) => Math.asin(Math.min(1, w / rimR))
    // Gaps as [centre angle, half width] (angles from +x towards +z).
    const gaps: [number, number][] = [
      [Math.PI, half(CH.halfWidth + 1)],
      [Math.PI / 2, half((q.maxX - q.minX) / 2 + 0.8)],
      [Math.atan2(JETTY.z - LAKE.z, Math.sqrt(rimR ** 2 - (JETTY.z - LAKE.z) ** 2)), half(JETTY.halfWidth + 0.9)],
    ]
    gaps.sort((a, b) => ((a[0] + Math.PI * 2) % (Math.PI * 2)) - ((b[0] + Math.PI * 2) % (Math.PI * 2)))
    for (let i = 0; i < gaps.length; i++) {
      const [c0, w0] = gaps[i]!
      const [c1, w1] = gaps[(i + 1) % gaps.length]!
      const from = c0 + w0
      let to = c1 - w1
      while (to <= from) to += Math.PI * 2
      const rim = new THREE.Mesh(new THREE.TorusGeometry(rimR, 1.0, 6, Math.max(4, Math.round(((to - from) / (Math.PI * 2)) * 72)), to - from), rimMat)
      rim.rotation.x = Math.PI / 2
      rim.rotation.z = from
      rim.scale.set(1, 1, 0.45)
      rim.castShadow = true
      rim.receiveShadow = true
      rim.position.set(LAKE.x, -0.22, LAKE.z)
      this.crater.add(rim)
    }

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
      // Keep the harbour's ground clear: the quay, the port and the hard-standing (north), the channel (west), the jetty and path (east).
      if (Math.sin(a) > 0.35 || Math.cos(a) < -0.75 || Math.cos(a) > 0.55) continue
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
    this.surfT += dt
    this.foam.forEach((f, k) => {
      const w = Math.sin(this.surfT * 0.55 + k * Math.PI)
      f.position.x = WATERLINE_X + 0.35 + w * 0.55
      ;(f.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.4 * (0.5 + 0.5 * Math.sin(this.surfT * 0.55 + k * Math.PI + 1.2))
    })
    ;(this.sea.material as THREE.MeshStandardMaterial).normalMap?.offset.set(this.surfT * 0.004, this.surfT * 0.002)
    const m = game.meteor
    const now = game.now
    const basin = m.phase === 'lake' && game.harbour.basin
    this.cap.visible = !m.struck
    this.capRing.visible = m.struck && !basin
    this.crater.visible = m.struck && !basin
    this.sandWhole.visible = !m.struck
    this.channel.visible = m.struck
    this.channelInland.visible = !basin

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
    this.water.visible = m.struck && level > 0.005 && !basin
    if (this.water.visible) {
      const y = -LAKE.depth + level * (LAKE.depth - LAKE.waterDrop)
      const r = LAKE.r * Math.sqrt(Math.max(0, 1 + y / LAKE.depth)) + 0.15
      this.water.position.y = y
      this.water.scale.setScalar(r)
      const ripples = waterRipples()
      ripples.offset.x = (ripples.offset.x + dt * 0.01) % 1
      ripples.offset.y = (ripples.offset.y + dt * 0.006) % 1
    }

    this.syncFence(m.struck, m.phase === 'lake' ? game.harbour : null)
    this.harbour.update(dt, game)
  }

  /**
   * A low invisible fence round the water: round the crater (open where the jetty and the cargo quay meet the shore, which have their
   * own rails), or round the basin (open at the jetty); and along both banks of the channel out to the sea.
   */
  private syncFence(struck: boolean, h: HarbourManager | null): void {
    const jetty = !!h?.has('lake-road')
    const quay = !!h?.has('lake-dock')
    const basin = !!h?.basin
    const want = struck ? `${jetty}${quay}${basin}` : null
    if (want === this.fenceFor) return
    for (const b of this.fence) this.physics.removeBody(b)
    this.fence = []
    this.fenceFor = want
    if (!want) return
    const wall = (x0: number, x1: number, z0: number, z1: number) =>
      this.fence.push(this.physics.addStaticBox(new THREE.Vector3((x0 + x1) / 2, 0.6, (z0 + z1) / 2), new THREE.Vector3((x1 - x0) / 2, 0.6, (z1 - z0) / 2)))
    const hw = CH.halfWidth
    if (basin) {
      const B = BASIN
      const t = 0.2
      wall(B.minX - t, B.maxX + t, B.maxZ + 0.15, B.maxZ + 0.15 + t)
      wall(B.minX - t, B.maxX + t, B.minZ - 0.15 - t, B.minZ - 0.15)
      wall(B.maxX + 0.15, B.maxX + 0.15 + t, B.minZ, JETTY.z - JETTY.halfWidth - 0.1)
      wall(B.maxX + 0.15, B.maxX + 0.15 + t, JETTY.z + JETTY.halfWidth + 0.1, B.maxZ)
      wall(B.minX - 0.15 - t, B.minX - 0.15, B.minZ, CH.z - hw - 0.25)
      wall(B.minX - 0.15 - t, B.minX - 0.15, CH.z + hw + 0.25, B.maxZ)
      for (const z of [CH.z + hw + 0.25, CH.z - hw - 0.25]) wall(COAST.wadeX - 0.4, B.minX - 0.15, z - 0.2, z + 0.2)
      return
    }
    const r = LAKE.r + 0.9
    const n = 72
    const seg = (2 * Math.PI * r) / n
    const west = Math.asin((CH.halfWidth + 0.2) / r)
    const q = HARBOUR.quay
    const rootX = JETTY.lakeRootX
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2
      if (Math.abs(th - Math.PI) < west) continue
      const x = LAKE.x + Math.cos(th) * r
      const z = LAKE.z + Math.sin(th) * r
      if (jetty && x > rootX - 2.5 && Math.abs(z - JETTY.z) < JETTY.halfWidth + 0.5) continue
      if (quay && x > q.minX - 0.6 && x < q.maxX + 0.6 && z > q.minZ) continue
      const phi = -(th + Math.PI / 2)
      const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), phi)
      this.fence.push(
        this.physics.addStaticBoxRotated(new THREE.Vector3(x, 0.6, z), new THREE.Vector3(seg / 2 + 0.1, 0.6, 0.2), { x: rot.x, y: rot.y, z: rot.z, w: rot.w }),
      )
    }
    // Both banks of the channel, from the crater out to the sea.
    for (const z of [CH.z + hw + 0.25, CH.z - hw - 0.25]) wall(COAST.wadeX - 0.4, MOUTH_X + 0.6, z - 0.2, z + 0.2)
  }

  private box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D, shadow = true): THREE.Mesh {
    const mesh = new THREE.Mesh(metreUVs(new THREE.BoxGeometry(w, h, d)), m)
    mesh.position.set(x, y, z)
    mesh.castShadow = shadow
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }

  /** A strip of beach from z0 to z1: flat sand to the shore, then shelving down under the sea. UVs in metres. */
  private sandStrip(z0: number, z1: number, material: THREE.Material): THREE.Mesh {
    // Colour across the beach: grassy at the top, pale dry sand, then darker wet sand and the sea floor below the waterline.
    const tint = (x: number): [number, number, number] => {
      if (x > COAST.grassX - 1.4) {
        const t = (x - (COAST.grassX - 1.4)) / 1.4
        return [1.02 - t * 0.2, 1.02 - t * 0.02, 0.98 - t * 0.28]
      }
      if (x > COAST.shoreX + 1.5) return [1.04, 1.02, 0.98]
      if (x > WATERLINE_X) {
        const t = (COAST.shoreX + 1.5 - x) / (COAST.shoreX + 1.5 - WATERLINE_X)
        return [1.04 - t * 0.34, 1.02 - t * 0.32, 0.98 - t * 0.26]
      }
      const t = Math.min(1, (WATERLINE_X - x) / 6)
      return [0.7 - t * 0.2, 0.7 - t * 0.12, 0.72 - t * 0.04]
    }
    const col: number[] = []
    const xs: number[] = []
    for (let x = -130; x < COAST.grassX; x += x > WATERLINE_X - 8 ? 0.5 : 2) xs.push(x)
    xs.push(COAST.grassX)
    const pos: number[] = []
    const uv: number[] = []
    const idx: number[] = []
    xs.forEach((x, i) => {
      for (const z of [z0, z1]) {
        pos.push(x, sandY(x), z)
        uv.push(x, -z)
        col.push(...tint(x))
      }
      if (i > 0) {
        const a = (i - 1) * 2
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    })
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    geo.setIndex(idx)
    geo.computeVertexNormals()
    const mesh = new THREE.Mesh(geo, beachMat(material))
    mesh.receiveShadow = true
    return mesh
  }

  /** The channel the strike cuts from the crater to the sea: its dug-out bed, earth banks, and the water in it. */
  private buildChannel(sand: THREE.Material): void {
    const hw = CH.halfWidth
    const bed = -2.7
    const soil = new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 1, flatShading: true, side: THREE.DoubleSide })
    // Under the grass: two earth walls and a floor, from the grass edge to the crater.
    for (const z of [CH.z + hw, CH.z - hw]) this.box(MOUTH_X + 0.6 - COAST.grassX, -bed, 0.1, soil, (COAST.grassX + MOUTH_X + 0.6) / 2, bed / 2 - 0.02, z, this.channelInland, false)
    this.box(MOUTH_X + 0.6 - COAST.grassX, 0.1, hw * 2, soil, (COAST.grassX + MOUTH_X + 0.6) / 2, bed, CH.z, this.channelInland, false)
    this.channel.add(this.channelInland)
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
    this.channelInland.add(water)
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

