import * as THREE from 'three'
import type { GameManager } from '../sim/GameManager'
import { tag } from './interactables'
import { KEY_BOARD, KEY_RACKS } from './layout'
import { makeKeyMesh, makeSign, mat, setKeyLabel } from './models'

const POP_SECONDS = 0.5

/**
 * One key rack on the partition wall: a board of identical hooks. Stage 1 has no labels, so the player
 * must remember which hook holds which locker's key. Rack `n` owns hooks `n·hooksPerRack …`. Racks bought
 * later pop onto the wall.
 */
export class KeyRack {
  readonly root = new THREE.Group()
  readonly index: number
  private readonly firstHook: number
  private readonly keyMeshes: THREE.Object3D[] = []
  private pop = 1

  /** `placement` overrides the default spot on the partition (annex racks hang on the hall's own wall). */
  constructor(index: number, hooksPerRack: number, placement?: { x: number; y?: number; z: number; rotY: number }) {
    this.index = index
    this.firstHook = index * hooksPerRack
    const { width, height, cols } = KEY_BOARD
    const x = placement?.x ?? KEY_RACKS[index]?.x ?? KEY_BOARD.center.x
    // Everything is positioned relative to the rack centre so the whole rack can scale in place.
    this.root.position.set(x, placement?.y ?? KEY_BOARD.center.y, placement?.z ?? KEY_BOARD.center.z)
    this.root.rotation.y = placement?.rotY ?? 0

    const board = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.04), mat(0x8a5a3b, 0.75))
    this.root.add(board)
    const frame = new THREE.Mesh(new THREE.BoxGeometry(width + 0.06, height + 0.06, 0.03), mat(0x5b3a24, 0.75))
    frame.position.z = -0.01
    this.root.add(frame)
    if (index > 0) {
      const label = makeSign(`KEYS ${index + 1}`, 0.7, 0.16, '#0f172a', '#fbbf24')
      label.position.set(0, height / 2 + 0.16, 0)
      this.root.add(label)
    }

    const rows = Math.ceil(hooksPerRack / cols)
    const brass = mat(0xb8b8b8, 0.3, 0.9)
    for (let i = 0; i < hooksPerRack; i++) {
      const col = i % cols
      const row = Math.floor(i / cols)
      const hx = -width / 2 + (width / cols) * (col + 0.5)
      const hy = height / 2 - (height / rows) * (row + 0.5) + 0.08
      const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.07, 6), brass)
      hook.rotation.x = Math.PI / 2
      hook.position.set(hx, hy, 0.05)
      this.root.add(hook)

      const key = makeKeyMesh()
      key.position.set(hx, hy - 0.025, 0.075)
      key.visible = false
      this.root.add(key)
      this.keyMeshes.push(key)

      const proxy = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.14), new THREE.MeshBasicMaterial({ visible: false }))
      proxy.position.set(hx, hy - 0.05, 0.07)
      tag(proxy, { kind: 'hook', hook: this.firstHook + i })
      this.root.add(proxy)
    }
  }

  /** Start the "pop onto the wall" animation (a freshly bought rack). */
  appear(): void {
    this.pop = 0
    this.root.scale.setScalar(0.001)
  }

  update(dt: number, game: GameManager): void {
    if (this.pop < 1) {
      this.pop = Math.min(1, this.pop + dt / POP_SECONDS)
      // Ease out with a slight overshoot so it feels like it snaps into place.
      const t = this.pop - 1
      this.root.scale.setScalar(Math.max(0.001, 1 + 2.2 * t ** 3 + 1.2 * t ** 2))
    }
    const labels = game.hasLabels
    this.keyMeshes.forEach((mesh, i) => {
      const key = game.keys.onHook(this.firstHook + i)
      mesh.visible = key !== null
      // With the labels upgrade, each key's tag shows the number of the locker it opens.
      setKeyLabel(mesh, labels && key ? game.lockers.get(key.lockerId).number : null)
    })
  }
}
