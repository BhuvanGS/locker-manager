import type RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import type { PhysicsWorld } from '../engine/PhysicsWorld'
import { CONFIG } from '../sim/config'
import type { GameManager } from '../sim/GameManager'
import { makeBag } from './bags'
import { beltTexture, TEXTURE_TILE } from './belts'
import { markBlocker, tag } from './interactables'
import { CONVEYOR, PARTITION, STATION } from './layout'
import { makeSign, mat } from './models'
import { PICKUP_Z, StationView } from './StationView'

const RISE_SECONDS = 1.5
/** Bags wait on the belts this far apart. */
const SPACING = 0.5
const BELT_LENGTH = CONVEYOR.startZ - CONVEYOR.endZ

/**
 * The conveyor system you see: two belts from the staff area through the partition to the back of the storage room, the
 * gantry rail along the front of the lockers with the robot arm hanging from it, and the terminal. Bought as one upgrade
 * ("Conveyor & robot arm"). Everything is drawn from `game.conveyor`; this class makes no decisions of its own.
 *
 * The arm moves smoothly towards a target pose that depends on how far through its job the simulation says it is, so its
 * motions line up with the lockers' doors opening and the bag appearing in (or leaving) a locker.
 */
export class ConveyorBay {
  readonly root = new THREE.Group()
  /** The arms of the storage room's row of lockers (they hang from the rail along the lockers). */
  readonly station: StationView
  private readonly bodies: RAPIER.RigidBody[] = []
  private readonly physics: PhysicsWorld
  private readonly beltTextures: { texture: THREE.CanvasTexture; direction: number }[] = []
  private readonly parcels = new Map<number, { group: THREE.Group; z: number; x: number }>()
  private readonly kiosk = { canvas: document.createElement('canvas'), texture: null as THREE.CanvasTexture | null, signature: '' }
  private rise = 1

  /** `locate` gives the world position of a locker's opening (see Engine). */
  constructor(physics: PhysicsWorld, locate: (lockerId: string) => { x: number; y: number; z: number }) {
    this.physics = physics
    this.root.userData.zone = 'main'
    this.buildBelts()
    this.buildSigns()
    this.buildKiosk()
    this.station = new StationView({
      zone: 'main',
      floorY: 0,
      rows: [{ row: 0, frontZ: CONVEYOR.rail.z - STATION.railOffset }],
      minX: STATION.extent.main[0],
      maxX: STATION.extent.main[1],
      dock: 'belt',
      locate,
    })
    this.root.add(this.station.root)
  }

  /** Start the "rising out of the floor" animation (a freshly installed system). */
  appear(): void {
    this.rise = 0
    this.root.scale.y = 0.001
  }

  dispose(): void {
    for (const body of this.bodies) this.physics.removeBody(body)
    this.bodies.length = 0
    for (const { texture } of this.beltTextures) texture.dispose()
  }

  update(dt: number, game: GameManager): void {
    if (this.rise < 1) {
      this.rise = Math.min(1, this.rise + dt / RISE_SECONDS)
      this.root.scale.y = Math.max(0.001, 1 - (1 - this.rise) ** 3)
    }
    const speed = BELT_LENGTH / CONFIG.automation.beltSeconds
    for (const { texture, direction } of this.beltTextures) texture.offset.y += (direction * speed * dt) / TEXTURE_TILE
    this.station.update(dt, game)
    this.syncParcels(dt, game)
    this.drawKiosk(game)
  }

  // ------------------------------------------------------------------ bags

  private syncParcels(dt: number, game: GameManager): void {
    const live = new Set<number>()
    const inbound = game.conveyor.inbound()
    const returning = game.conveyor.returning()
    const { beltSeconds } = CONFIG.automation
    const smooth = 1 - Math.exp(-9 * dt)

    for (const parcel of game.conveyor.parcels) {
      let x = parcel.kind === 'store' ? CONVEYOR.inX : CONVEYOR.outX
      let z = PICKUP_Z
      let startZ = PICKUP_Z
      if (parcel.phase === 'beltIn' || (parcel.phase === 'waitingForArm' && parcel.zone === 'main')) {
        const rank = inbound.indexOf(parcel)
        const travelled = parcel.phase === 'beltIn' ? parcel.t / beltSeconds : 1
        z = Math.max(CONVEYOR.startZ + (CONVEYOR.endZ - CONVEYOR.startZ) * travelled, PICKUP_Z + rank * SPACING)
        startZ = z
      } else if (parcel.phase === 'beltOut' || parcel.phase === 'ready') {
        const rank = returning.indexOf(parcel)
        const travelled = parcel.phase === 'beltOut' ? parcel.t / beltSeconds : 1
        z = Math.min(PICKUP_Z + (CONVEYOR.trayZ - PICKUP_Z) * travelled, CONVEYOR.trayZ - rank * SPACING)
        // It was dropped by its arm a little to one side of the others (a second arm drops further back).
        startZ = PICKUP_Z + parcel.arm * SPACING
      } else {
        continue // in a duct, with an arm, or still in its locker: not on the belts
      }
      live.add(parcel.id)

      let view = this.parcels.get(parcel.id)
      if (!view) {
        view = { group: makeBag(game, parcel), z: startZ, x }
        this.parcels.set(parcel.id, view)
        this.root.add(view.group)
      }
      view.z += (z - view.z) * smooth
      view.group.position.set(x, CONVEYOR.topY + 0.02, view.z)
    }
    for (const [id, view] of this.parcels) {
      if (live.has(id)) continue
      view.group.removeFromParent()
      this.parcels.delete(id)
    }
  }

  // ------------------------------------------------------------------ building

  private buildBelts(): void {
    const { inX, outX, width, topY, startZ, endZ } = CONVEYOR
    const len = startZ - endZ
    const midZ = (startZ + endZ) / 2
    const frameMat = mat(0x4b5563, 0.55, 0.3)
    const legMat = mat(0x1f2937, 0.6, 0.3)
    const railMat = mat(0xe5a50a, 0.55, 0.2)
    for (const [x, direction] of [
      [inX, -1],
      [outX, 1],
    ] as const) {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(width + 0.1, 0.14, len), frameMat)
      frame.position.set(x, topY - 0.08, midZ)
      frame.castShadow = true
      this.root.add(frame)
      for (const side of [-1, 1]) {
        const lip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, len), railMat)
        lip.position.set(x + side * (width / 2 + 0.03), topY + 0.01, midZ)
        this.root.add(lip)
      }
      for (let z = startZ - 0.3; z > endZ; z -= 1.4) {
        for (const side of [-1, 1]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, topY - 0.15, 0.06), legMat)
          leg.position.set(x + side * (width / 2 + 0.01), (topY - 0.15) / 2, z)
          this.root.add(leg)
        }
      }
      for (const z of [startZ - 0.02, endZ + 0.02]) {
        const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, width, 14), legMat)
        roller.rotation.z = Math.PI / 2
        roller.position.set(x, topY - 0.01, z)
        this.root.add(roller)
      }
      const texture = beltTexture()
      texture.repeat.set(1, len / TEXTURE_TILE)
      const surface = new THREE.Mesh(new THREE.PlaneGeometry(width, len), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9 }))
      surface.rotation.x = -Math.PI / 2
      surface.position.set(x, topY + 0.003, midZ)
      surface.receiveShadow = true
      this.root.add(surface)
      this.beltTextures.push({ texture, direction })
    }
    // The end stop where the arm picks up (and drops).
    for (const x of [inX, outX]) {
      const stop = new THREE.Mesh(new THREE.BoxGeometry(width + 0.1, 0.12, 0.05), railMat)
      stop.position.set(x, topY + 0.07, endZ - 0.04)
      this.root.add(stop)
    }
    // One box for both belts: you cannot walk through them (you can jump over).
    const half = new THREE.Vector3((outX - inX + width + 0.1) / 2, topY / 2, len / 2)
    this.bodies.push(this.physics.addStaticBox(new THREE.Vector3((inX + outX) / 2, topY / 2, midZ), half))
    const block = new THREE.Mesh(new THREE.BoxGeometry(half.x * 2, topY, len), new THREE.MeshBasicMaterial({ visible: false }))
    block.position.set((inX + outX) / 2, topY / 2, midZ)
    markBlocker(block)
    this.root.add(block)

    // The invisible targets for E: the loading end and the collection tray.
    for (const [x, kind] of [
      [inX, 'conveyorIn'],
      [outX, 'conveyorOut'],
    ] as const) {
      const proxy = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.7, 1.2), new THREE.MeshBasicMaterial({ visible: false }))
      proxy.position.set(x, topY + 0.35, startZ - 0.62)
      tag(proxy, { kind })
      this.root.add(proxy)
    }
  }

  private buildSigns(): void {
    const { inX, outX, startZ } = CONVEYOR
    const midX = (inX + outX) / 2
    const steel = mat(0x1f2937, 0.5, 0.4)
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.25, 0.05), steel)
    pole.position.set(midX, 1.125, startZ + 0.18)
    this.root.add(pole)
    const arm = new THREE.Mesh(new THREE.BoxGeometry(outX - inX + 0.9, 0.04, 0.04), steel)
    arm.position.set(midX, 2.22, startZ + 0.18)
    this.root.add(arm)
    for (const [x, text, bg] of [
      [inX, '▼ LOAD', '#f59e0b'],
      [outX, '▲ COLLECT', '#22c55e'],
    ] as const) {
      const sign = makeSign(text, 0.62, 0.2, bg, '#0f172a')
      sign.position.set(x, 2.0, startZ + 0.2)
      this.root.add(sign)
    }
    // A name plate on the storage side of the hatch.
    const plate = makeSign('CONVEYOR', 0.9, 0.2, '#0f172a', '#fbbf24')
    plate.position.set(midX, CONVEYOR.hatch.height + 0.4, PARTITION.z - 0.11)
    plate.rotation.y = Math.PI
    this.root.add(plate)
  }

  private buildKiosk(): void {
    const { x, z } = CONVEYOR.kiosk
    const body = mat(0x1f2937, 0.5, 0.4)
    const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.95, 0.36), body)
    pedestal.position.set(x, 0.475, z)
    pedestal.castShadow = true
    markBlocker(pedestal)
    this.root.add(pedestal)
    this.bodies.push(this.physics.addStaticBox(new THREE.Vector3(x, 0.475, z), new THREE.Vector3(0.25, 0.475, 0.18)))

    const canvas = this.kiosk.canvas
    canvas.width = 512
    canvas.height = 340
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 8
    this.kiosk.texture = texture
    const tilt = new THREE.Group()
    tilt.position.set(x, 1.12, z + 0.04)
    tilt.rotation.x = -0.45
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.46, 0.05), body)
    tilt.add(bezel)
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62 * (340 / 512)), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }))
    face.position.z = 0.027
    tilt.add(face)
    this.root.add(tilt)
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.2, 0.5), new THREE.MeshBasicMaterial({ visible: false }))
    proxy.position.set(x, 0.7, z)
    tag(proxy, { kind: 'terminal' })
    this.root.add(proxy)
    const sign = makeSign('TERMINAL', 0.6, 0.16, '#0f172a', '#fbbf24')
    sign.position.set(x, 1.6, z + 0.08)
    this.root.add(sign)
  }

  private drawKiosk(game: GameManager): void {
    const stored = game.terminalEntries().length
    const free = game.robotLockersFree()
    const inbound = game.conveyor.inbound().length
    const returning = game.conveyor.returning().length
    const queued = game.conveyor.parcels.filter((p) => p.phase === 'queued' || p.phase === 'waitingForArm' || p.phase === 'transitIn' || p.phase === 'transitOut').length
    const jobs = game.conveyor.armJobs()
    const first = jobs[0]
    const jammed = game.conveyor.jammedZones().length > 0
    const doing = jammed ? 'ARM JAMMED' : first ? `${first.kind === 'store' ? 'STORING' : 'FETCHING'} ${game.lockers.get(first.lockerId).number}${jobs.length > 1 ? ` +${jobs.length - 1}` : ''}` : 'IDLE'
    const signature = [doing, jammed, stored, free, inbound, returning, queued].join('|')
    if (signature === this.kiosk.signature) return
    this.kiosk.signature = signature
    const ctx = this.kiosk.canvas.getContext('2d')
    if (!ctx || !this.kiosk.texture) return
    this.kiosk.texture.needsUpdate = true
    ctx.fillStyle = '#0b1220'
    ctx.fillRect(0, 0, 512, 340)
    ctx.fillStyle = '#fbbf24'
    ctx.font = '800 38px system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.fillText('ROBOT ARM', 28, 44)
    ctx.fillStyle = jammed ? '#ef4444' : first ? '#f59e0b' : '#22c55e'
    ctx.font = '800 54px system-ui, sans-serif'
    ctx.fillText(doing, 28, 112)
    ctx.fillStyle = '#e2e8f0'
    ctx.font = '600 32px system-ui, sans-serif'
    ctx.fillText(`Free lockers: ${free}`, 28, 178)
    ctx.fillText(`Stored bags: ${stored}`, 28, 220)
    ctx.fillText(`On the belts: ${inbound + returning}   Queue: ${queued}`, 28, 262)
    ctx.fillStyle = '#94a3b8'
    ctx.font = '600 26px system-ui, sans-serif'
    ctx.fillText('Press E to fetch a bag', 28, 308)
  }
}
