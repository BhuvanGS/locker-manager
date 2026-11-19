import * as THREE from 'three'
import { LAKE } from './layout'

/**
 * The meteor's shockwave punches a hole in the lobby's roof: when it reaches the shop, the chunks over the middle of the lobby (ceiling
 * and roof deck) rattle, then are flung up and away from the crater, tumbling, and fall out of sight far off, leaving a ragged hole with
 * charred edges (`scars`) open to the sky. View only, driven by `Lake.blastSince`; a new game (no strike) puts it all back. A game
 * loaded long after the strike just shows the hole.
 */
type Piece = {
  o: THREE.Object3D
  home: THREE.Vector3
  rot: THREE.Euler
  v: THREE.Vector3
  spin: THREE.Vector3
  delay: number
}

const GRAVITY = 9.8

export class RoofBlast {
  private readonly pieces: Piece[]
  private readonly scars: readonly THREE.Object3D[]
  private state: 'intact' | 'flying' | 'gone' = 'intact'
  private t = 0

  constructor(objects: readonly THREE.Object3D[], scars: readonly THREE.Object3D[]) {
    this.pieces = objects.map((o) => ({ o, home: o.position.clone(), rot: o.rotation.clone(), v: new THREE.Vector3(), spin: new THREE.Vector3(), delay: 0 }))
    this.scars = scars
  }

  /** `since`: seconds since the shockwave reached the shop (negative before, null with no strike). */
  update(dt: number, since: number | null): void {
    if (since === null || since < 0) {
      if (this.state !== 'intact') this.restore()
      return
    }
    if (this.state === 'intact') {
      if (since > 6) {
        this.hideAll()
        return
      }
      this.launch()
    }
    if (this.state !== 'flying') return
    this.t += dt
    let flying = 0
    for (const p of this.pieces) {
      if (!p.o.visible) continue
      const t = this.t - p.delay
      if (t < 0) {
        // Rattling in place for a moment before it goes.
        p.o.position.set(p.home.x + (Math.random() - 0.5) * 0.06, p.home.y + Math.random() * 0.05, p.home.z + (Math.random() - 0.5) * 0.06)
        flying++
        continue
      }
      p.o.position.set(p.home.x + p.v.x * t, p.home.y + p.v.y * t - 0.5 * GRAVITY * t * t, p.home.z + p.v.z * t)
      p.o.rotation.set(p.rot.x + p.spin.x * t, p.rot.y + p.spin.y * t, p.rot.z + p.spin.z * t)
      if (p.o.position.y < -4 || t > 9) p.o.visible = false
      else flying++
    }
    if (flying === 0) this.state = 'gone'
  }

  private launch(): void {
    this.state = 'flying'
    this.t = 0
    for (const s of this.scars) s.visible = true
    for (const p of this.pieces) {
      // Away from the crater, up hard; the front edge (nearest the street) a little later than the back.
      const dx = p.home.x - LAKE.x
      const dz = p.home.z - LAKE.z
      const d = Math.hypot(dx, dz) || 1
      const along = 6 + Math.random() * 9
      const side = (Math.random() - 0.5) * 5
      p.v.set((dx / d) * along - (dz / d) * side, 12 + Math.random() * 9, (dz / d) * along + (dx / d) * side)
      p.spin.set((Math.random() - 0.5) * 7, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 7)
      p.delay = Math.random() * 0.35
    }
  }

  private hideAll(): void {
    this.state = 'gone'
    for (const s of this.scars) s.visible = true
    for (const p of this.pieces) p.o.visible = false
  }

  private restore(): void {
    this.state = 'intact'
    for (const s of this.scars) s.visible = false
    for (const p of this.pieces) {
      p.o.position.copy(p.home)
      p.o.rotation.copy(p.rot)
      p.o.visible = true
    }
  }
}
