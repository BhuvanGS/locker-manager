import type RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import type { PhysicsWorld } from '../engine/PhysicsWorld'
import { CONFIG } from '../sim/config'
import type { Parcel } from '../sim/ConveyorSystem'
import type { GameManager } from '../sim/GameManager'
import { markBlocker, tag } from './interactables'
import { CONVEYOR, lockerSlot, PARTITION, ROOM } from './layout'
import { fitInto, makeItemMesh, makeSign, mat } from './models'

const RISE_SECONDS = 1.5
const BAG = { w: 0.38, h: 0.3, d: 0.3 }
/** Bags wait on the belts this far apart. */
const SPACING = 0.5
/** The arm picks up from, and drops at, this z (a little before the end of the belts). */
const PICKUP_Z = CONVEYOR.endZ + 0.15
const REACH_TO_PICKUP = PICKUP_Z - CONVEYOR.rail.z
/** From the wrist to the base of a bag in the gripper. */
const HANG = 0.4
const WRIST_HOME = 2.25
const WRIST_BELT = CONVEYOR.topY + HANG
const BELT_LENGTH = CONVEYOR.startZ - CONVEYOR.endZ
const TEXTURE_TILE = 0.45

type Pose = { x: number; wrist: number; reach: number; claw: number }
type Key = [p: number, x: number, wrist: number, reach: number, claw: number]

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
  private readonly bodies: RAPIER.RigidBody[] = []
  private readonly physics: PhysicsWorld
  private readonly beltTextures: { texture: THREE.CanvasTexture; direction: number }[] = []
  private readonly carriage = new THREE.Group()
  private readonly column: THREE.Mesh
  private readonly bar: THREE.Mesh
  private readonly gripper = new THREE.Group()
  private readonly fingers: THREE.Mesh[] = []
  private readonly anchor = new THREE.Group()
  private readonly parcels = new Map<number, { group: THREE.Group; z: number; x: number }>()
  private readonly pose: Pose = { x: CONVEYOR.inX, wrist: WRIST_HOME, reach: 0, claw: 0 }
  private readonly kiosk = { canvas: document.createElement('canvas'), texture: null as THREE.CanvasTexture | null, signature: '' }
  private readonly status = new THREE.MeshBasicMaterial({ color: 0x22c55e })
  private rise = 1

  constructor(physics: PhysicsWorld) {
    this.physics = physics
    this.root.userData.zone = 'main'
    this.buildBelts()
    this.buildSigns()
    this.buildKiosk()

    // The gantry rail, hung from the ceiling.
    const { z, y, minX, maxX } = CONVEYOR.rail
    const yellow = mat(0xe5a50a, 0.55, 0.2)
    const dark = mat(0x1f2937, 0.5, 0.4)
    const beam = new THREE.Mesh(new THREE.BoxGeometry(maxX - minX, 0.14, 0.16), yellow)
    beam.position.set((minX + maxX) / 2, y + 0.12, z)
    this.root.add(beam)
    for (const x of [-4.5, -1.5, 1.5, 4.5]) {
      const hanger = new THREE.Mesh(new THREE.BoxGeometry(0.06, ROOM.height - y - 0.05, 0.06), dark)
      hanger.position.set(x, (ROOM.height + y + 0.05) / 2, z)
      this.root.add(hanger)
    }

    // The carriage rides the rail; a column drops from it, a horizontal bar reaches out at the wrist, and the gripper hangs
    // at the end of the bar.
    this.carriage.position.set(this.pose.x, y, z)
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.4), dark)
    body.position.y = 0.0
    this.carriage.add(body)
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.06), this.status)
    lamp.position.set(0, 0.14, 0.2)
    this.carriage.add(lamp)
    this.column = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1, 0.12), yellow)
    this.carriage.add(this.column)
    this.bar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 1), yellow)
    this.carriage.add(this.bar)
    this.carriage.add(this.gripper)
    const wrist = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.2), dark)
    this.gripper.add(wrist)
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.22), dark)
    palm.position.y = -0.14
    this.gripper.add(palm)
    for (const side of [-1, 1]) {
      const finger = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22, 0.2), yellow)
      finger.position.set(side * 0.24, -0.25, 0)
      this.gripper.add(finger)
      this.fingers.push(finger)
    }
    this.anchor.position.y = -HANG
    this.gripper.add(this.anchor)
    this.root.add(this.carriage)
    this.place()
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

    const job = game.conveyor.armJob()
    const target = job ? this.targetPose(job, game) : { x: CONVEYOR.inX, wrist: WRIST_HOME, reach: 0, claw: 0 }
    const k = 1 - Math.exp(-7 * dt)
    this.pose.x += (target.x - this.pose.x) * k
    this.pose.wrist += (target.wrist - this.pose.wrist) * k
    this.pose.reach += (target.reach - this.pose.reach) * k
    this.pose.claw += (target.claw - this.pose.claw) * (1 - Math.exp(-14 * dt))
    this.place()
    this.status.color.setHex(job ? 0xf59e0b : 0x22c55e)

    this.syncParcels(dt, game)
    this.drawKiosk(game, job)
  }

  // ------------------------------------------------------------------ the arm

  /** Where the arm should be, given how far through its current job the simulation is. */
  private targetPose(job: Parcel, game: GameManager): Pose {
    const progress = game.conveyor.armProgress() ?? 0
    const locker = game.lockers.get(job.lockerId)
    const slot = lockerSlot(locker.bank, locker.row, locker.col)
    const lockX = slot.x
    const lockWrist = slot.y - 0.03
    const lockReach = slot.z - CONVEYOR.rail.z
    const inX = CONVEYOR.inX
    const outX = CONVEYOR.outX
    const keys: Key[] =
      job.kind === 'store'
        ? [
            [0, inX, WRIST_BELT, REACH_TO_PICKUP, 0],
            [0.1, inX, WRIST_BELT, REACH_TO_PICKUP, 0],
            [0.18, inX, WRIST_BELT, REACH_TO_PICKUP, 1],
            [0.3, inX, WRIST_HOME, 0, 1],
            [0.42, lockX, WRIST_HOME, 0, 1],
            [0.5, lockX, lockWrist, 0, 1],
            [0.62, lockX, lockWrist, lockReach, 1],
            [0.68, lockX, lockWrist, lockReach, 0],
            [0.78, lockX, lockWrist, 0, 0],
            [0.86, lockX, WRIST_HOME, 0, 0],
            [1, inX, WRIST_HOME, 0, 0],
          ]
        : [
            [0, lockX, WRIST_HOME, 0, 0],
            [0.2, lockX, lockWrist, 0, 0],
            [0.36, lockX, lockWrist, 0, 0],
            [0.5, lockX, lockWrist, lockReach, 0],
            [0.56, lockX, lockWrist, lockReach, 1],
            [0.66, lockX, lockWrist, 0, 1],
            [0.74, lockX, WRIST_HOME, 0, 1],
            [0.84, outX, WRIST_HOME, 0, 1],
            [0.92, outX, WRIST_BELT, REACH_TO_PICKUP, 1],
            [0.97, outX, WRIST_BELT, REACH_TO_PICKUP, 0],
            [1, outX, WRIST_BELT, REACH_TO_PICKUP, 0],
          ]
    return sample(keys, progress)
  }

  private place(): void {
    const { rail } = CONVEYOR
    const { x, wrist, reach, claw } = this.pose
    this.carriage.position.x = x
    const down = rail.y - wrist // how far the wrist hangs below the rail
    this.column.scale.y = Math.max(0.01, down)
    this.column.position.y = -down / 2
    this.bar.scale.z = Math.max(0.01, Math.abs(reach))
    this.bar.position.set(0, -down, reach / 2)
    this.gripper.position.set(0, -down, reach)
    const open = 0.24 - claw * 0.09
    this.fingers[0]?.position.setX(-open)
    this.fingers[1]?.position.setX(open)
  }

  // ------------------------------------------------------------------ bags

  private syncParcels(dt: number, game: GameManager): void {
    const live = new Set<number>()
    const inbound = game.conveyor.inbound()
    const returning = game.conveyor.returning()
    const { beltSeconds } = CONFIG.automation
    const progress = game.conveyor.armProgress() ?? 0
    const smooth = 1 - Math.exp(-9 * dt)

    for (const parcel of game.conveyor.parcels) {
      // Where is it, and is the arm holding it?
      let x = parcel.kind === 'store' ? CONVEYOR.inX : CONVEYOR.outX
      let z = PICKUP_Z
      let carried = false
      let visible = true
      if (parcel.phase === 'beltIn' || parcel.phase === 'waitingForArm') {
        const rank = inbound.indexOf(parcel)
        const travelled = parcel.phase === 'beltIn' ? parcel.t / beltSeconds : 1
        z = Math.max(CONVEYOR.startZ + (CONVEYOR.endZ - CONVEYOR.startZ) * travelled, PICKUP_Z + rank * SPACING)
      } else if (parcel.phase === 'arm') {
        const grabbed = parcel.kind === 'store' ? progress >= 0.18 && parcel.step < 2 : parcel.step >= 2
        carried = grabbed
        visible = parcel.kind === 'store' ? parcel.step < 2 : parcel.step >= 2
      } else if (parcel.phase === 'beltOut' || parcel.phase === 'ready') {
        const rank = returning.indexOf(parcel)
        const travelled = parcel.phase === 'beltOut' ? parcel.t / beltSeconds : 1
        z = Math.min(PICKUP_Z + (CONVEYOR.trayZ - PICKUP_Z) * travelled, CONVEYOR.trayZ - rank * SPACING)
      } else {
        visible = false // queued: still in its locker
      }
      if (!visible) continue
      live.add(parcel.id)

      let view = this.parcels.get(parcel.id)
      if (!view) {
        const item = game.customers.item(parcel.itemId)
        const mesh = makeItemMesh(item.category, item.color)
        fitInto(mesh, BAG.w, BAG.h, BAG.d)
        const group = new THREE.Group()
        group.add(mesh)
        view = { group, z, x }
        this.parcels.set(parcel.id, view)
        this.root.add(group)
      }
      if (carried) {
        if (view.group.parent !== this.anchor) this.anchor.add(view.group)
        view.group.position.set(0, 0, 0)
        view.group.rotation.set(0, 0, 0)
        view.x = this.pose.x
        view.z = PICKUP_Z
      } else {
        if (view.group.parent !== this.root) {
          this.root.add(view.group)
          // Dropped from the gripper: carry on from where the arm let go.
          view.x = x
          view.z = PICKUP_Z
        }
        view.z += (z - view.z) * smooth
        view.group.position.set(x, CONVEYOR.topY + 0.02, view.z)
      }
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

  private drawKiosk(game: GameManager, job: Parcel | null): void {
    const stored = game.terminalEntries().length
    const free = game.robotLockersFree()
    const inbound = game.conveyor.inbound().length
    const returning = game.conveyor.returning().length
    const queued = game.conveyor.parcels.filter((p) => p.phase === 'queued' || p.phase === 'waitingForArm').length
    const doing = job ? `${job.kind === 'store' ? 'STORING' : 'FETCHING'} ${game.lockers.get(job.lockerId).number}` : 'IDLE'
    const signature = [doing, stored, free, inbound, returning, queued].join('|')
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
    ctx.fillStyle = job ? '#f59e0b' : '#22c55e'
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

/** A dark belt with lighter cross bars, tiled along its length. */
function beltTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#3b424d'
    ctx.fillRect(0, 0, 64, 64)
    ctx.fillStyle = '#566170'
    ctx.fillRect(0, 0, 64, 8)
    ctx.fillStyle = '#2a2f37'
    ctx.fillRect(0, 36, 64, 3)
    ctx.strokeStyle = '#6b7788'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(10, 52)
    ctx.lineTo(32, 42)
    ctx.lineTo(54, 52)
    ctx.stroke()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** Linear interpolation through keyframes `[progress, x, wrist, reach, claw]` (progress ascending). */
function sample(keys: Key[], p: number): Pose {
  const first = keys[0]!
  if (p <= first[0]) return { x: first[1], wrist: first[2], reach: first[3], claw: first[4] }
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1]!
    const b = keys[i]!
    if (p > b[0]) continue
    const t = b[0] === a[0] ? 1 : (p - a[0]) / (b[0] - a[0])
    const s = t * t * (3 - 2 * t) // ease in and out
    return {
      x: a[1] + (b[1] - a[1]) * s,
      wrist: a[2] + (b[2] - a[2]) * s,
      reach: a[3] + (b[3] - a[3]) * s,
      claw: a[4] + (b[4] - a[4]) * s,
    }
  }
  const last = keys[keys.length - 1]!
  return { x: last[1], wrist: last[2], reach: last[3], claw: last[4] }
}
