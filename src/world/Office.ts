import type RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import type { PhysicsWorld } from '../engine/PhysicsWorld'
import { CONFIG } from '../sim/config'
import type { GameManager } from '../sim/GameManager'
import { markBlocker, tag } from './interactables'
import { OFFICE, ROOM } from './layout'
import { makePerson, makeSign, mat, type PersonRig } from './models'

const T = 0.2
const RISE_SECONDS = 1.2

/**
 * The deal office off the lobby: a carpeted room with a big desk, where VIPs make their storage offers. Built when the upgrade is bought.
 * When a VIP is waiting they stand behind the desk (with their name over their head); a wall board counts the deals you have signed.
 * The desk is what you aim at to talk business.
 */
export class Office {
  readonly root = new THREE.Group()
  private readonly bodies: RAPIER.RigidBody[] = []
  private readonly physics: PhysicsWorld
  private vip: { id: number; rig: PersonRig; group: THREE.Group } | null = null
  private readonly board = { canvas: document.createElement('canvas'), texture: null as THREE.CanvasTexture | null, signature: '' }
  private rise = 1

  constructor(physics: PhysicsWorld) {
    this.physics = physics
    this.root.userData.zone = 'office'
    const h = ROOM.height
    const { minX, maxX, minZ, maxZ } = OFFICE
    const w = maxX - minX
    const d = maxZ - minZ
    const cx = (minX + maxX) / 2
    const cz = (minZ + maxZ) / 2
    const wall = mat(0xe3ddd0, 0.9)
    const outside = mat(0xa9b6bf, 0.9)

    // Floor (carpet), ceiling and roof.
    this.deco(w, 0.03, d, mat(0x3b4a5c, 0.95), cx, 0.016, cz)
    this.deco(w + 0.4, 0.1, d + 0.4, mat(0xf4f2ee, 1), cx, h + 0.05, cz)
    this.deco(w + 0.6, 0.18, d + 0.6, mat(0x59544e, 0.9), cx, h + 0.19, cz)

    // Walls: north, south and the far (east) end. The west wall is the lobby's own, with the doorway cut in it.
    this.solid(w + T * 2, h, T, outside, cx, h / 2, minZ - T / 2)
    this.solid(w + T * 2, h, T, outside, cx, h / 2, maxZ + T / 2)
    this.solid(T, h, d + T * 2, outside, maxX + T / 2, h / 2, cz)
    // A window in the far wall.
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 1.4, 2.6),
      new THREE.MeshStandardMaterial({ color: 0xbcd7e6, transparent: true, opacity: 0.25, roughness: 0.05, depthWrite: false }),
    )
    glass.position.set(maxX - 0.05, 1.7, cz)
    this.root.add(glass)
    // Inside faces: a paler skin on the inside of each wall so the room reads as a room.
    this.deco(w, h, 0.02, wall, cx, h / 2, minZ + 0.01)
    this.deco(w, h, 0.02, wall, cx, h / 2, maxZ - 0.01)
    this.deco(0.02, h, d, wall, maxX - 0.01, h / 2, cz)

    // Lights: two emissive panels (the lobby's lights spill in through the doorway).
    const panel = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff8e7, emissiveIntensity: 1.3 })
    for (const dz of [-1.6, 1.6]) {
      const fixture = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.05, 0.4), panel)
      fixture.position.set(cx, h - 0.03, OFFICE.desk.z + dz)
      this.root.add(fixture)
    }

    // The desk, a nameplate and the leather chair behind it.
    const { x, z, width, length, height } = OFFICE.desk
    const wood = mat(0x5b3a24, 0.55)
    this.solid(width, height - 0.05, length, mat(0x4a3b2c, 0.8), x, (height - 0.05) / 2, z)
    this.deco(width + 0.1, 0.06, length + 0.1, wood, x, height - 0.02, z)
    const plate = makeSign('DEAL DESK', 0.7, 0.14, '#0f172a', '#fbbf24')
    plate.position.set(x - width / 2 - 0.02, height - 0.12, z)
    plate.rotation.y = -Math.PI / 2
    this.root.add(plate)
    this.deco(0.5, 0.06, 0.5, mat(0x1f2937, 0.7), x + 0.95, 0.5, z)
    this.deco(0.5, 0.55, 0.08, mat(0x1f2937, 0.7), x + 1.17, 0.8, z)
    this.deco(0.08, 0.5, 0.08, mat(0x374151, 0.5), x + 0.95, 0.25, z)
    // A pen and a phone, for atmosphere.
    this.deco(0.2, 0.04, 0.14, mat(0x111827, 0.4), x - 0.1, height + 0.03, z + 0.5)

    // A plant in each far corner, and the signs.
    for (const pz of [minZ + 0.5, maxZ - 0.5]) {
      this.deco(0.4, 0.4, 0.4, mat(0x9a6b4f, 0.8), maxX - 0.5, 0.2, pz)
      this.deco(0.45, 0.8, 0.45, mat(0x2f6b3a, 0.9), maxX - 0.5, 0.8, pz)
    }
    const door = makeSign('DEAL OFFICE', 1.5, 0.24, '#0f172a', '#fbbf24')
    door.position.set(minX + 0.05, 2.65, OFFICE.desk.z)
    door.rotation.y = Math.PI / 2 // faces into the office (+x)
    this.root.add(door)
    const lobbySign = makeSign('DEAL OFFICE', 1.5, 0.24, '#0f172a', '#fbbf24')
    lobbySign.position.set(ROOM.maxX - 0.04, 2.5, OFFICE.desk.z)
    lobbySign.rotation.y = -Math.PI / 2 // faces the lobby (−x)
    this.root.add(lobbySign)

    // A wall board for the deals you have signed.
    const canvas = this.board.canvas
    canvas.width = 768
    canvas.height = 384
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    this.board.texture = texture
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.3, 0.05), mat(0x1f2937, 0.5, 0.4))
    frame.position.set(cx, 1.8, maxZ - 0.04)
    this.root.add(frame)
    const face = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.15), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }))
    face.position.set(cx, 1.8, maxZ - 0.07)
    face.rotation.y = Math.PI // faces −z, into the room
    this.root.add(face)

    // What you aim at to talk business.
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(width + 0.4, 1.3, length + 0.4), new THREE.MeshBasicMaterial({ visible: false }))
    proxy.position.set(x, 0.65, z)
    tag(proxy, { kind: 'dealDesk' })
    this.root.add(proxy)
    // (The proxy sits inside the blocker, so draw order does not matter: the desk itself is a blocker, the proxy is tagged.)
  }

  /** Start the "rising out of the ground" animation (a freshly built office). */
  appear(): void {
    this.rise = 0
    this.root.scale.y = 0.001
  }

  dispose(): void {
    for (const body of this.bodies) this.physics.removeBody(body)
    this.bodies.length = 0
    this.board.texture?.dispose()
  }

  update(dt: number, game: GameManager): void {
    if (this.rise < 1) {
      this.rise = Math.min(1, this.rise + dt / RISE_SECONDS)
      this.root.scale.y = Math.max(0.001, 1 - (1 - this.rise) ** 3)
    }
    this.syncVip(dt, game)
    this.drawBoard(game)
  }

  /** The VIP waiting at the desk (if any), in their own look and with their name over their head. */
  private syncVip(dt: number, game: GameManager): void {
    const offer = game.deals.offer
    if (!offer || game.now < offer.readyAt) {
      if (this.vip) {
        this.root.remove(this.vip.group)
        this.vip = null
      }
      return
    }
    if (!this.vip || this.vip.id !== offer.id) {
      if (this.vip) this.root.remove(this.vip.group)
      const look = CONFIG.deals.vips[offer.vip]?.look
      const rig = makePerson({ ...(look ?? CONFIG.deals.vips[0]!.look), hairStyle: (look?.hairStyle ?? 'bald') as 'bald' })
      const group = new THREE.Group()
      group.add(rig.root)
      group.position.set(OFFICE.vip.x, 0.02, OFFICE.vip.z)
      group.rotation.y = -Math.PI / 2 // facing the door
      const name = makeSign(offer.name, 1.1, 0.16, '#0f172a', '#fbbf24')
      name.position.set(0, 2.1, 0)
      group.add(name)
      this.root.add(group)
      this.vip = { id: offer.id, rig, group }
    }
    // A little life: they shift their weight and tap the desk.
    const t = performance.now() / 1000
    this.vip.rig.armR.rotation.x = -0.7 + Math.sin(t * 3) * 0.08
    this.vip.rig.armL.rotation.x = Math.sin(t * 0.8) * 0.05
    void dt
  }

  private drawBoard(game: GameManager): void {
    const signed = game.deals.signed
    const offer = game.deals.offer
    const signature = JSON.stringify([signed.length, game.deals.crates, offer?.id ?? 0])
    if (signature === this.board.signature) return
    this.board.signature = signature
    const ctx = this.board.canvas.getContext('2d')
    if (!ctx || !this.board.texture) return
    this.board.texture.needsUpdate = true
    ctx.fillStyle = '#0b1220'
    ctx.fillRect(0, 0, 768, 384)
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.fillStyle = '#fbbf24'
    ctx.font = '800 46px system-ui, sans-serif'
    ctx.fillText('SIGNED DEALS', 32, 52)
    ctx.fillStyle = '#e2e8f0'
    ctx.font = '700 40px system-ui, sans-serif'
    ctx.fillText(`${signed.length} deals · ${game.deals.crates} crates promised`, 32, 112)
    ctx.font = '600 30px system-ui, sans-serif'
    signed.slice(-5).reverse().forEach((deal, i) => {
      ctx.fillStyle = '#94a3b8'
      ctx.fillText(`${deal.name}  ·  ${deal.crates} crates  ·  $${deal.retainer}`, 32, 176 + i * 38)
    })
    if (signed.length === 0) {
      ctx.fillStyle = '#64748b'
      ctx.fillText('None yet: wait for a VIP to turn up.', 32, 176)
    }
    ctx.fillStyle = '#64748b'
    ctx.font = '600 26px system-ui, sans-serif'
    ctx.fillText('The crates arrive when the warehouse opens.', 32, 350)
  }

  /** Solid wall: rendered, collides with the player, blocks reach. */
  private solid(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number): void {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
    mesh.position.set(x, y, z)
    mesh.receiveShadow = true
    mesh.castShadow = true
    markBlocker(mesh)
    this.root.add(mesh)
    this.bodies.push(this.physics.addStaticBox(mesh.position.clone(), new THREE.Vector3(w / 2, h / 2, d / 2)))
  }

  private deco(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number): void {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
    mesh.position.set(x, y, z)
    mesh.receiveShadow = true
    this.root.add(mesh)
  }
}
