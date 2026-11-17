import * as THREE from 'three'
import type { GameManager } from '../sim/GameManager'
import { fitInto, makeItemMesh, makeKeyMesh, setKeyLabel } from './models'

/** Shows whatever the player is holding in the lower-right of the view. */
export class HeldView {
  readonly root = new THREE.Group()
  private readonly anchor = new THREE.Group()
  private shown = ''
  private bob = 0

  constructor() {
    this.root.add(this.anchor)
  }

  update(dt: number, camera: THREE.Camera, game: GameManager, moving: boolean): void {
    this.root.position.copy(camera.position)
    this.root.quaternion.copy(camera.quaternion)
    this.bob += dt * (moving ? 9 : 2)
    const amp = moving ? 0.012 : 0.004
    this.anchor.position.set(0.36, -0.36 + Math.sin(this.bob) * amp, -0.75)

    const hands = game.hands
    const labels = game.hasLabels
    const sig = hands ? `${hands.kind}:${hands.kind === 'item' ? hands.itemId : hands.keyId}:${labels}` : ''
    if (sig === this.shown) return
    this.shown = sig
    this.anchor.clear()
    if (!hands) return
    if (hands.kind === 'key') {
      const key = makeKeyMesh()
      key.scale.setScalar(1.6)
      setKeyLabel(key, labels ? game.lockers.get(game.keys.get(hands.keyId).lockerId).number : null)
      key.rotation.set(0.3, -0.5, 0.4)
      this.anchor.add(key)
      return
    }
    const item = game.customers.item(hands.itemId)
    const mesh = makeItemMesh(item.category, item.color)
    fitInto(mesh, 0.24, 0.26, 0.2)
    mesh.position.y = -0.13
    mesh.rotation.y = -0.5
    this.anchor.add(mesh)
  }
}
