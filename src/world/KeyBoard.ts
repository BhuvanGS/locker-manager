import * as THREE from 'three'
import type { GameManager } from '../sim/GameManager'
import { tag } from './interactables'
import { KEY_BOARD } from './layout'
import { makeKeyMesh, mat } from './models'

/**
 * The key board on the partition wall: a row of identical hooks. Stage 1 has no labels, so the
 * player must remember which hook holds which locker's key.
 */
export class KeyBoard {
  readonly root = new THREE.Group()
  private readonly keyMeshes: THREE.Object3D[] = []

  constructor(hookCount: number) {
    const { center, width, height, cols } = KEY_BOARD
    const board = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.04), mat(0x8a5a3b, 0.75))
    board.position.copy(center)
    this.root.add(board)
    const frame = new THREE.Mesh(new THREE.BoxGeometry(width + 0.06, height + 0.06, 0.03), mat(0x5b3a24, 0.75))
    frame.position.copy(center).add(new THREE.Vector3(0, 0, -0.01))
    this.root.add(frame)

    const rows = Math.ceil(hookCount / cols)
    const brass = mat(0xb8b8b8, 0.3, 0.9)
    for (let i = 0; i < hookCount; i++) {
      const col = i % cols
      const row = Math.floor(i / cols)
      const x = center.x - width / 2 + (width / cols) * (col + 0.5)
      const y = center.y + height / 2 - (height / rows) * (row + 0.5) + 0.08
      const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.07, 6), brass)
      hook.rotation.x = Math.PI / 2
      hook.position.set(x, y, center.z + 0.05)
      this.root.add(hook)

      const key = makeKeyMesh()
      key.position.set(x, y - 0.025, center.z + 0.075)
      key.visible = false
      this.root.add(key)
      this.keyMeshes.push(key)

      const proxy = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.14), new THREE.MeshBasicMaterial({ visible: false }))
      proxy.position.set(x, y - 0.05, center.z + 0.07)
      tag(proxy, { kind: 'hook', hook: i })
      this.root.add(proxy)
    }
  }

  update(game: GameManager): void {
    this.keyMeshes.forEach((mesh, hook) => {
      mesh.visible = game.keys.onHook(hook) !== null
    })
  }
}
