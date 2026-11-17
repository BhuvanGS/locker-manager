import * as THREE from 'three'
import type RAPIER from '@dimforge/rapier3d-compat'
import type { PhysicsWorld } from '../engine/PhysicsWorld'
import { AUTO_ZONES, ZONE_TITLES, type AutoZone } from '../sim/config'
import type { GameManager } from '../sim/GameManager'
import { markBlocker, tag } from './interactables'
import { makeSign, mat } from './models'

const W = 512
const H = 340

export type ConsoleScope = 'hub' | AutoZone

/**
 * An upgrade console: a pedestal with a screen, standing in the part of the building it controls. The hub console (staff
 * area) extends the belts to more halls; each zone's console upgrades that zone's robot arms. The screen shows the current
 * level, and pressing E opens the console's upgrade menu. You go to the area to upgrade it.
 */
export class AutomationConsole {
  readonly root = new THREE.Group()
  readonly scope: ConsoleScope
  private readonly canvas = document.createElement('canvas')
  private readonly texture: THREE.CanvasTexture
  private readonly body: RAPIER.RigidBody
  private readonly physics: PhysicsWorld
  private signature = ''

  /** `floorY` is the height of the floor it stands on. */
  constructor(scope: ConsoleScope, x: number, floorY: number, z: number, zone: AutoZone | 'main', physics: PhysicsWorld) {
    this.scope = scope
    this.physics = physics
    this.root.userData.zone = zone
    this.root.position.set(x, floorY, z)
    const steel = mat(0x1f2937, 0.5, 0.4)
    const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.95, 0.34), steel)
    pedestal.position.y = 0.475
    pedestal.castShadow = true
    markBlocker(pedestal)
    this.root.add(pedestal)
    this.body = physics.addStaticBox(new THREE.Vector3(x, floorY + 0.475, z), new THREE.Vector3(0.23, 0.475, 0.17))

    this.canvas.width = W
    this.canvas.height = H
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.anisotropy = 8
    const tilt = new THREE.Group()
    tilt.position.set(0, 1.12, 0.04)
    tilt.rotation.x = -0.45
    tilt.add(new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.46, 0.05), steel))
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62 * (H / W)), new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false }))
    face.position.z = 0.027
    tilt.add(face)
    this.root.add(tilt)
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.2, 0.5), new THREE.MeshBasicMaterial({ visible: false }))
    proxy.position.y = 0.7
    tag(proxy, { kind: 'console', scope })
    this.root.add(proxy)
    const sign = makeSign(scope === 'hub' ? 'CONTROL HUB' : 'ARM CONSOLE', 0.7, 0.16, '#0f172a', '#fbbf24')
    sign.position.set(0, 1.6, 0.08)
    this.root.add(sign)
  }

  dispose(): void {
    this.physics.removeBody(this.body)
    this.texture.dispose()
  }

  update(game: GameManager): void {
    const zones = AUTO_ZONES.filter((z) => game.conveyor.isCovered(z))
    const signature =
      this.scope === 'hub'
        ? `hub|${zones.join(',')}`
        : `${this.scope}|${game.conveyor.speedLevel(this.scope)}|${game.conveyor.armCount(this.scope)}`
    if (signature === this.signature) return
    this.signature = signature
    this.draw(game, zones)
  }

  private draw(game: GameManager, zones: AutoZone[]): void {
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return
    this.texture.needsUpdate = true
    ctx.fillStyle = '#0b1220'
    ctx.fillRect(0, 0, W, H)
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.fillStyle = '#fbbf24'
    ctx.font = '800 38px system-ui, sans-serif'
    if (this.scope === 'hub') {
      ctx.fillText('CONTROL HUB', 28, 44)
      ctx.fillStyle = '#e2e8f0'
      ctx.font = '600 28px system-ui, sans-serif'
      ctx.fillText('Belts reach:', 28, 100)
      AUTO_ZONES.forEach((z, i) => {
        const on = zones.includes(z)
        ctx.fillStyle = on ? '#22c55e' : '#475569'
        ctx.fillText(`${on ? '●' : '○'}  ${ZONE_TITLES[z]}`, 28, 146 + i * 36)
      })
    } else {
      const speed = game.conveyor.speedLevel(this.scope)
      const arms = game.conveyor.armCount(this.scope)
      ctx.fillText(`ARMS · ${ZONE_TITLES[this.scope].toUpperCase()}`, 28, 44)
      ctx.fillStyle = '#e2e8f0'
      ctx.font = '700 44px system-ui, sans-serif'
      ctx.fillText(`Speed level ${speed}/3`, 28, 124)
      ctx.fillText(`Arms per row: ${arms}`, 28, 188)
      ctx.fillStyle = '#94a3b8'
      ctx.font = '600 26px system-ui, sans-serif'
      ctx.fillText('Faster motors, a second arm', 28, 246)
    }
    ctx.fillStyle = '#94a3b8'
    ctx.font = '600 26px system-ui, sans-serif'
    ctx.fillText('Press E to upgrade', 28, 306)
  }
}
