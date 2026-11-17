import * as THREE from 'three'
import type { GravelField } from './GravelField'
import type { InputSnapshotWithMouse } from '../engine/InputManager'
import { createHeldRockMesh, describeStone, type StoneRecord } from './stone'
import { evaluateOpen, type OpenOutcome } from './openStone'
import { debugStep, isGameDebugEnabled, type DebugSnapshot } from '../engine/debug'

export type GravelHudState = {
  prompt: string | null
  held: ReturnType<typeof describeStone> | null
  peek: ReturnType<typeof describeStone> | null
  focus: ReturnType<typeof describeStone> | null
  rocksInspected: number
  rocksPickedUp: number
  keyDiscovered: boolean
}

const PICK_RANGE = 3.25
const HELD_VISUAL_SCALE = 6

export class GravelInteraction {
  private readonly field: GravelField
  private readonly scene: THREE.Scene
  private readonly raycaster = new THREE.Raycaster()
  private readonly holdRoot = new THREE.Group()
  private readonly holdAnchor = new THREE.Object3D()
  private readonly ndcCenter = new THREE.Vector2(0, 0)
  private readonly projectScratch = new THREE.Vector3()
  private heldMesh: THREE.Mesh | null = null
  private heldRecord: StoneRecord | null = null
  private peekRecord: StoneRecord | null = null
  private peekTimer = 0
  private readonly inspectSpin = new THREE.Euler()
  private rocksInspected = 0
  private rocksPickedUp = 0
  private disturbCooldown = 0
  private readonly disturbScratch = new THREE.Vector3()
  private lastPickMethod: string | null = null
  private lastAimedId: number | null = null
  private keyFound = false
  private readonly holdWorldPos = new THREE.Vector3()
  private readonly aimRing: THREE.Mesh
  private aimPulse = 0

  constructor(field: GravelField, scene: THREE.Scene) {
    this.field = field
    this.scene = scene
    this.holdAnchor.position.set(0, -0.08, -2.45)
    this.holdRoot.add(this.holdAnchor)
    this.scene.add(this.holdRoot)

    this.aimRing = new THREE.Mesh(
      new THREE.RingGeometry(0.78, 1, 28),
      new THREE.MeshBasicMaterial({
        color: 0xfde68a,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    )
    this.aimRing.rotation.x = -Math.PI / 2
    this.aimRing.renderOrder = 5
    this.aimRing.visible = false
    this.scene.add(this.aimRing)

    if (isGameDebugEnabled()) {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xff3300, wireframe: true }),
      )
      this.holdAnchor.add(marker)
      debugStep('GravelInteraction: holdRoot added to scene (debug on)')
      debugStep(`target stone #${field.fakeStoneId + 1} is pink`)
    }
  }

  update(
    dt: number,
    input: InputSnapshotWithMouse,
    camera: THREE.PerspectiveCamera,
    playerPos: THREE.Vector3,
    onGravel: boolean,
    crouching: boolean,
    suppressPickup: boolean,
  ): GravelHudState {
    this.syncHoldToCamera(camera)

    if (!this.heldRecord) {
      const aimedNow = this.resolveTargetStone(camera, playerPos, crouching)
      this.lastAimedId = aimedNow?.id ?? null
    } else {
      this.lastAimedId = this.heldRecord.id
    }
    this.updateAimRing(dt)

    if (this.peekTimer > 0) {
      this.peekTimer -= dt
      if (this.peekTimer <= 0) this.peekRecord = null
    }

    if (this.heldMesh && input.secondaryHeld) {
      this.inspectSpin.y += input.mouseDeltaX * 0.004
      this.inspectSpin.x += input.mouseDeltaY * 0.004
      this.inspectSpin.x = THREE.MathUtils.clamp(this.inspectSpin.x, -1.2, 1.2)
      this.heldMesh.rotation.set(
        this.heldRecord!.rotation.x + this.inspectSpin.x,
        this.heldRecord!.rotation.y + this.inspectSpin.y,
        this.heldRecord!.rotation.z,
      )
      if (!this.heldRecord!.inspected && Math.abs(this.inspectSpin.x) > 0.28) {
        this.heldRecord!.inspected = true
        this.rocksInspected++
      }
    }

    const keyDiscovered = this.claimKeyIfReady()

    const wantPickup = input.primaryPressed && !suppressPickup

    if (wantPickup) {
      debugStep(
        `pickup (LMB) crouch=${crouching} aim=${this.lastAimedId ?? 'none'}`,
      )
      if (this.heldRecord) {
        debugStep(`drop stone #${this.heldRecord.id + 1}`)
        this.dropStone(playerPos)
      } else {
        let picked = false
        if (this.lastAimedId !== null) {
          const aimed = this.field.stones[this.lastAimedId]
          if (aimed && !aimed.picked) {
            picked = this.attachHeldRecord(aimed, 'aimed-id')
          }
        }
        if (!picked) {
          picked = this.tryPick(camera, playerPos, crouching)
        }
        if (!picked) {
          debugStep(
            `pick miss aimedId=${this.lastAimedId ?? 'none'} lastMethod=${this.lastPickMethod ?? '—'}`,
          )
        }
      }
    }

    if (onGravel && !this.heldRecord) {
      this.disturbCooldown -= dt
      if (this.disturbCooldown <= 0 && (input.forward !== 0 || input.right !== 0)) {
        this.disturbNear(playerPos)
        this.disturbCooldown = 0.12
      }
    }

    return { ...this.hudState(onGravel), keyDiscovered }
  }

  isHoldingRock(): boolean {
    return this.heldRecord !== null
  }

  hasKey(): boolean {
    return this.keyFound
  }

  private claimKeyIfReady(): boolean {
    const rock = this.heldRecord
    if (!rock || !rock.isFake || !rock.inspected || this.keyFound) return false
    rock.opened = true
    this.keyFound = true
    this.attachKeyVisual()
    debugStep(`key taken from stone #${rock.id + 1}`)
    return true
  }

  tryOpenHeld(): OpenOutcome {
    const outcome = evaluateOpen(this.heldRecord)
    if (outcome.kind === 'found-key' && this.heldRecord) {
      this.heldRecord.opened = true
      this.keyFound = true
      this.attachKeyVisual()
      debugStep('fake rock opened — house key found')
    } else if (outcome.kind === 'solid' && this.heldRecord) {
      this.heldRecord.opened = true
      debugStep(`stone #${this.heldRecord.id + 1} is solid`)
    } else {
      debugStep(`open: ${outcome.kind}`)
    }
    return outcome
  }

  private attachKeyVisual(): void {
    if (!this.heldMesh) return
    const key = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.05, 0.08),
      new THREE.MeshStandardMaterial({
        color: 0xf6e05e,
        metalness: 0.7,
        roughness: 0.25,
        emissive: 0xb7791f,
        emissiveIntensity: 0.45,
        fog: false,
      }),
    )
    key.position.set(0, 0.35, 0)
    this.heldMesh.add(key)
  }

  getDebugSnapshot(): DebugSnapshot {
    this.holdAnchor.getWorldPosition(this.holdWorldPos)
    return {
      holding: this.heldRecord !== null,
      heldStoneId: this.heldRecord?.id ?? null,
      holdRootInScene: this.holdRoot.parent === this.scene,
      heldMeshAttached: this.heldMesh?.parent === this.holdAnchor,
      aimedStoneId: this.lastAimedId,
      pickMethod: this.lastPickMethod,
      holdWorldPos: `${this.holdWorldPos.x.toFixed(2)},${this.holdWorldPos.y.toFixed(2)},${this.holdWorldPos.z.toFixed(2)}`,
      holdAnchorChildCount: this.holdAnchor.children.length,
      fakeRockLabel: `#${this.field.fakeStoneId + 1}`,
    }
  }

  dispose(): void {
    if (this.heldMesh) {
      this.holdAnchor.remove(this.heldMesh)
      this.heldMesh.geometry.dispose()
      const mat = this.heldMesh.material
      if (!Array.isArray(mat)) mat.dispose()
    }
    this.scene.remove(this.holdRoot)
    this.scene.remove(this.aimRing)
    this.aimRing.geometry.dispose()
    ;(this.aimRing.material as THREE.Material).dispose()
  }

  private updateAimRing(dt: number): void {
    const stone =
      !this.heldRecord && this.lastAimedId !== null ? this.field.stones[this.lastAimedId] : undefined
    if (!stone || stone.picked) {
      this.aimRing.visible = false
      return
    }
    this.aimPulse += dt * 5
    const size = Math.max(stone.scale * 1.7, 0.08) * (1 + Math.sin(this.aimPulse) * 0.08)
    this.aimRing.visible = true
    this.aimRing.position.set(stone.position.x, stone.position.y - stone.scale * 0.25 + 0.012, stone.position.z)
    this.aimRing.scale.setScalar(size)
  }

  private syncHoldToCamera(camera: THREE.PerspectiveCamera): void {
    camera.updateMatrixWorld(true)
    this.holdRoot.position.copy(camera.position)
    this.holdRoot.quaternion.copy(camera.quaternion)
  }

  private tryPick(
    camera: THREE.PerspectiveCamera,
    playerPos: THREE.Vector3,
    crouching: boolean,
  ): boolean {
    const target = this.resolveTargetStone(camera, playerPos, crouching)
    if (!target) return false
    return this.attachHeldRecord(target, this.lastPickMethod ?? 'resolve')
  }

  private attachHeldRecord(record: StoneRecord, method: string): boolean {
    if (record.picked) return false

    record.picked = true
    this.rocksPickedUp++
    this.lastPickMethod = method
    this.field.setInstanceHidden(record.id, true)

    this.heldRecord = record
    this.peekRecord = null
    this.peekTimer = 0
    this.inspectSpin.set(0, 0, 0)
    this.heldMesh = createHeldRockMesh(record)
    this.heldMesh.scale.setScalar(record.scale * HELD_VISUAL_SCALE)
    const mat = this.heldMesh.material
    if (mat instanceof THREE.MeshStandardMaterial) {
      mat.fog = false
      if (isGameDebugEnabled()) {
        mat.emissive = new THREE.Color(0x224488)
        mat.emissiveIntensity = 0.35
      }
    }
    this.heldMesh.renderOrder = 999
    this.holdAnchor.add(this.heldMesh)
    if (isGameDebugEnabled()) {
      const wire = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1.08, 0),
        new THREE.MeshBasicMaterial({ color: 0xffaa00, wireframe: true, fog: false }),
      )
      wire.scale.copy(this.heldMesh.scale)
      wire.renderOrder = 1000
      this.heldMesh.add(wire)
    }
    debugStep(
      `pick ok #${record.id + 1} via ${method} holdChildren=${this.holdAnchor.children.length}`,
    )
    return true
  }

  private pickScreenSpace(camera: THREE.PerspectiveCamera, range: number): StoneRecord | null {
    const ndcThreshold = 0.08
    let best: StoneRecord | null = null
    let bestScreen = ndcThreshold

    for (const stone of this.field.stones) {
      if (stone.picked) continue
      this.projectScratch.copy(stone.position)
      this.projectScratch.project(camera)
      if (this.projectScratch.z > 1) continue

      const screenDist = Math.hypot(this.projectScratch.x, this.projectScratch.y)
      if (screenDist > ndcThreshold) continue

      const worldDist = camera.position.distanceTo(stone.position)
      if (worldDist > range) continue

      if (screenDist < bestScreen || (screenDist === bestScreen && worldDist < range)) {
        bestScreen = screenDist
        best = stone
      }
    }

    return best
  }

  private raycastAimedStone(camera: THREE.PerspectiveCamera): StoneRecord | null {
    this.field.instancedMesh.updateMatrixWorld(true)
    this.raycaster.setFromCamera(this.ndcCenter, camera)
    this.raycaster.far = PICK_RANGE
    this.raycaster.near = 0.05
    const hits = this.raycaster.intersectObject(this.field.instancedMesh, false)

    for (const hit of hits) {
      if (hit.instanceId === undefined) continue
      const record = this.field.stones[hit.instanceId]
      if (!record || record.picked) continue
      return record
    }
    return null
  }

  private resolveTargetStone(
    camera: THREE.PerspectiveCamera,
    playerPos: THREE.Vector3,
    crouching: boolean,
  ): StoneRecord | null {
    const range = crouching ? PICK_RANGE + 0.35 : PICK_RANGE
    void playerPos

    // The rock directly under the crosshair wins.
    const ray = this.raycastAimedStone(camera)
    if (ray) {
      this.lastPickMethod = 'raycast'
      return ray
    }

    // Small tolerance so tiny pebbles right next to the crosshair still count.
    const screen = this.pickScreenSpace(camera, range)
    if (screen) {
      this.lastPickMethod = 'screen'
      return screen
    }
    return null
  }

  private dropStone(playerPos: THREE.Vector3): void {
    if (!this.heldRecord || !this.heldMesh) return

    const record = this.heldRecord
    record.picked = false
    record.position.set(
      playerPos.x + (Math.random() - 0.5) * 0.35,
      record.position.y,
      playerPos.z + (Math.random() - 0.5) * 0.35,
    )

    this.holdAnchor.remove(this.heldMesh)
    this.heldMesh.geometry.dispose()
    const mat = this.heldMesh.material
    if (!Array.isArray(mat)) mat.dispose()
    this.heldMesh = null
    this.heldRecord = null

    this.field.setInstanceHidden(record.id, false)
  }

  private disturbNear(playerPos: THREE.Vector3): void {
    const r2 = 1.1 * 1.1
    let nudged = 0
    for (const stone of this.field.stones) {
      if (stone.picked) continue
      const dx = stone.position.x - playerPos.x
      const dz = stone.position.z - playerPos.z
      if (dx * dx + dz * dz > r2) continue
      this.disturbScratch.set(
        (Math.random() - 0.5) * 0.018,
        -0.004 - Math.random() * 0.01,
        (Math.random() - 0.5) * 0.018,
      )
      this.field.nudgeInstance(stone.id, this.disturbScratch)
      nudged++
      if (nudged > 28) break
    }
  }

  private hudState(onGravel: boolean): GravelHudState {
    const aimed =
      !this.heldRecord && this.lastAimedId !== null
        ? (this.field.stones[this.lastAimedId] ?? null)
        : null

    let prompt: string | null = null
    if (this.heldRecord) {
      prompt = this.keyFound
        ? 'Key in hand. Left-click the front door — you can still be holding the rock.'
        : '[RMB drag] check the underside · the fake rock gives up the key when you flip it'
    } else if (onGravel || aimed) {
      prompt = aimed
        ? `[Left click] Pick up · ${describeStone(aimed).title}`
        : 'Aim at a pebble, then left-click (click once first to capture the mouse)'
    }

    const peek =
      !this.heldRecord && this.peekRecord && this.peekTimer > 0
        ? describeStone(this.peekRecord)
        : null

    const focus = !this.heldRecord && !peek && aimed ? describeStone(aimed) : null

    return {
      prompt,
      held: this.heldRecord ? describeStone(this.heldRecord) : null,
      peek,
      focus,
      rocksInspected: this.rocksInspected,
      rocksPickedUp: this.rocksPickedUp,
      keyDiscovered: false,
    }
  }
}