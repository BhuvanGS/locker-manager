import * as THREE from 'three'
import type { PhysicsWorld } from '../engine/PhysicsWorld'
import type { GameManager } from '../sim/GameManager'
import type { ItemId, LockerId } from '../sim/types'
import { markBlocker, tag } from './interactables'
import { LOCKER } from './layout'
import { fitInto, makeItemMesh, makeKeyMesh, mat } from './models'

type LockerView = {
  id: LockerId
  hinge: THREE.Group
  /** Current door angle in radians (0 = shut). */
  angle: number
  keyInLock: THREE.Object3D
  interior: THREE.Mesh
  itemSlot: THREE.Group
  shownItem: ItemId | null
}

const OPEN_ANGLE = -1.85

/** Renders the lockers from simulation state: door swing, key in lock, and the item inside. */
export class LockerWall {
  readonly root = new THREE.Group()
  private readonly views = new Map<LockerId, LockerView>()

  constructor(game: GameManager, physics: PhysicsWorld) {
    const { width, height, depth, gap, frontZ, baseY, centerX } = LOCKER
    const lockers = game.lockers.all()
    const cols = Math.max(...lockers.map((l) => l.col)) + 1
    const rows = Math.max(...lockers.map((l) => l.row)) + 1
    const pitchX = width + gap
    const pitchY = height + gap
    const totalW = cols * pitchX
    const totalH = rows * pitchY
    const leftX = centerX - totalW / 2

    const steel = mat(0x8d99a6, 0.45, 0.55)
    const inner = mat(0x4b5563, 0.7, 0.2)
    const doorMat = mat(0x9aa5b1, 0.4, 0.55)
    const slot = mat(0x374151, 0.6, 0.3)

    // Carcass: a hollow steel frame (back panel, shelves, dividers) so open compartments show inside.
    // The player collides with one solid box; reach rays are only blocked by the back panel.
    const midY = baseY + totalH / 2
    const midZ = frontZ - depth / 2
    const back = new THREE.Mesh(new THREE.BoxGeometry(totalW + 0.08, totalH + 0.08, 0.03), steel)
    back.position.set(centerX, midY, frontZ - depth - 0.015)
    markBlocker(back)
    this.root.add(back)
    for (let r = 0; r <= rows; r++) {
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(totalW + 0.08, gap, depth), steel)
      shelf.position.set(centerX, baseY + r * pitchY, midZ)
      this.root.add(shelf)
    }
    for (let c = 0; c <= cols; c++) {
      const divider = new THREE.Mesh(new THREE.BoxGeometry(gap, totalH + 0.08, depth), steel)
      divider.position.set(leftX + c * pitchX, midY, midZ)
      this.root.add(divider)
    }
    physics.addStaticBox(new THREE.Vector3(centerX, midY, midZ - 0.02), new THREE.Vector3((totalW + 0.08) / 2, (totalH + 0.08) / 2, depth / 2 + 0.03))
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(totalW + 0.08, baseY, depth), mat(0x374151, 0.6))
    plinth.position.set(centerX, baseY / 2, frontZ - depth / 2 - 0.02)
    this.root.add(plinth)

    for (const locker of lockers) {
      const x0 = leftX + locker.col * pitchX + gap / 2
      const y0 = baseY + locker.row * pitchY + gap / 2
      const cx = x0 + width / 2
      const cy = y0 + height / 2

      // Recess (visible when the door is open).
      const recess = new THREE.Mesh(new THREE.BoxGeometry(width - 0.04, height - 0.04, 0.02), inner)
      recess.position.set(cx, cy, frontZ - depth + 0.06)
      this.root.add(recess)
      const interior = new THREE.Mesh(
        new THREE.BoxGeometry(width - 0.08, height - 0.08, depth - 0.1),
        new THREE.MeshBasicMaterial({ visible: false }),
      )
      interior.position.set(cx, cy, frontZ - depth / 2)
      tag(interior, { kind: 'lockerInterior', lockerId: locker.id })
      this.root.add(interior)
      const shelfLip = new THREE.Mesh(new THREE.BoxGeometry(width - 0.04, 0.02, depth - 0.06), inner)
      shelfLip.position.set(cx, y0 + 0.02, frontZ - depth / 2 + 0.02)
      this.root.add(shelfLip)

      const itemSlot = new THREE.Group()
      itemSlot.position.set(cx, y0 + 0.04, frontZ - depth / 2 + 0.02)
      this.root.add(itemSlot)

      // Door hinged on its left edge.
      const hinge = new THREE.Group()
      hinge.position.set(x0, cy, frontZ + 0.015)
      const door = new THREE.Mesh(new THREE.BoxGeometry(width - 0.01, height - 0.01, 0.025), doorMat)
      door.position.set(width / 2, 0, 0)
      door.castShadow = true
      tag(door, { kind: 'lockerDoor', lockerId: locker.id })
      hinge.add(door)
      for (let i = 0; i < 4; i++) {
        const vent = new THREE.Mesh(new THREE.BoxGeometry(width * 0.5, 0.018, 0.005), slot)
        vent.position.set(width / 2, height * 0.32 - i * 0.045, 0.014)
        hinge.add(vent)
      }
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.16, 0.035), mat(0x1f2937, 0.4, 0.6))
      handle.position.set(width - 0.09, -0.04, 0.03)
      hinge.add(handle)
      const lock = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 12), mat(0xc0c7cf, 0.25, 0.9))
      lock.rotation.x = Math.PI / 2
      lock.position.set(width - 0.09, 0.08, 0.022)
      hinge.add(lock)

      const keyInLock = makeKeyMesh()
      keyInLock.position.set(width - 0.09, 0.08, 0.05)
      keyInLock.rotation.z = Math.PI / 2
      const keyProxy = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.12), new THREE.MeshBasicMaterial({ visible: false }))
      keyProxy.position.set(width - 0.09, 0.08, 0.06)
      keyProxy.scale.setScalar(1)
      const keyGroup = new THREE.Group()
      keyGroup.add(keyInLock, keyProxy)
      tag(keyGroup, { kind: 'lockerKey', lockerId: locker.id })
      hinge.add(keyGroup)

      this.root.add(hinge)
      this.views.set(locker.id, { id: locker.id, hinge, angle: 0, keyInLock: keyGroup, interior, itemSlot, shownItem: null })
    }
  }

  update(dt: number, game: GameManager): void {
    for (const locker of game.lockers.all()) {
      const view = this.views.get(locker.id)
      if (!view) continue
      const target = locker.doorOpen ? OPEN_ANGLE : 0
      view.angle += (target - view.angle) * Math.min(1, dt * 9)
      view.hinge.rotation.y = view.angle

      const key = game.keys.get(locker.keyId)
      view.keyInLock.visible = key.location.kind === 'inLock'

      if (view.shownItem !== locker.itemId) {
        view.itemSlot.clear()
        view.shownItem = locker.itemId
        if (locker.itemId) {
          const item = game.customers.item(locker.itemId)
          const mesh = makeItemMesh(item.category, item.color)
          fitInto(mesh, LOCKER.width - 0.14, LOCKER.height - 0.14, LOCKER.depth - 0.16)
          view.itemSlot.add(mesh)
        }
      }
    }
  }
}
