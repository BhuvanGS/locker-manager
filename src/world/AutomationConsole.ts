import * as THREE from 'three'
import { conduit } from './cables'
import { WAREHOUSE } from './layout'
import type RAPIER from '@dimforge/rapier3d-compat'
import type { PhysicsWorld } from '../engine/PhysicsWorld'
import { AUTO_ZONES, ZONE_TITLES, type AutoZone } from '../sim/config'
import type { GameManager } from '../sim/GameManager'
import { markBlocker, tag } from './interactables'
import { makeSign } from './models'
import { consoleSteel } from './textures'

const W = 512
const H = 340

export type ConsoleScope = 'hub' | 'warehouse' | AutoZone

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
  constructor(scope: ConsoleScope, x: number, floorY: number, z: number, rotY: number, zone: AutoZone | 'warehouse', physics: PhysicsWorld) {
    this.scope = scope
    this.physics = physics
    this.root.userData.zone = zone
    this.root.position.set(x, floorY, z)
    this.root.rotation.y = rotY // 0 faces +z; a quarter turn faces along x
    const steel = consoleSteel()
    const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.95, 0.34), steel)
    pedestal.position.y = 0.475
    pedestal.castShadow = true
    markBlocker(pedestal)
    this.root.add(pedestal)
    // Wired up: conduit from the back of the pedestal into a junction box on the ceiling.
    const ceiling = zone === 'warehouse' ? WAREHOUSE.height : 3.2
    this.root.add(conduit([new THREE.Vector3(0, 0.25, -0.2), new THREE.Vector3(0, ceiling - 0.05, -0.2)]))
    const sideways = Math.abs(Math.sin(rotY)) > 0.5
    this.body = physics.addStaticBox(new THREE.Vector3(x, floorY + 0.475, z), new THREE.Vector3(sideways ? 0.17 : 0.23, 0.475, sideways ? 0.23 : 0.17))

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
    const sign = makeSign(scope === 'hub' ? 'CONTROL HUB' : scope === 'warehouse' ? 'WAREHOUSE OFFICE' : 'ARM CONSOLE', 0.5, 0.12, '#0f172a', '#fbbf24')
    sign.position.set(0, 1.55, 0.08)
    this.root.add(sign)
  }

  dispose(): void {
    this.physics.removeBody(this.body)
    this.texture.dispose()
  }

  update(game: GameManager): void {
    const zones = AUTO_ZONES.filter((z) => game.conveyor.isCovered(z))
    const wh = game.warehouse
    const signature =
      this.scope === 'warehouse'
        ? `wh|${wh.capacity}|${wh.coldCapacity}|${wh.vaultCapacity}|${wh.hiddenLevel}|${wh.permit}|${wh.scanner}|${wh.autoLevel}`
        : this.scope === 'hub'
        ? `hub|${zones.join(',')}`
        : `${this.scope}|${game.conveyor.speedLevel(this.scope)}|${game.conveyor.armCount(this.scope)}|${Math.round(game.conveyor.zoneCondition(this.scope))}|${game.conveyor.jammedCount(this.scope)}`
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
    if (this.scope === 'warehouse') {
      const wh = game.warehouse
      ctx.fillText('WAREHOUSE', 28, 44)
      ctx.fillStyle = '#e2e8f0'
      ctx.font = '600 28px system-ui, sans-serif'
      const lines: [string, boolean][] = [
        [`Shelves: ${wh.capacity} slots`, true],
        [`Cold room: ${wh.coldCapacity > 0 ? `${wh.coldCapacity} slots` : 'none'}`, wh.coldCapacity > 0],
        [`Vault: ${wh.vaultCapacity > 0 ? `${wh.vaultCapacity} slots` : 'none'}`, wh.vaultCapacity > 0],
        [`Hidden: ${wh.hiddenLevel > 0 ? `level ${wh.hiddenLevel}` : 'none'}`, wh.hiddenLevel > 0],
        [`Licence ${wh.permit ? '✓' : '✗'}  Scanner ${wh.scanner ? '✓' : '✗'}  Robots ${wh.autoLevel}`, wh.permit || wh.scanner || wh.autoLevel > 0],
      ]
      lines.forEach(([text, on], i) => {
        ctx.fillStyle = on ? '#22c55e' : '#64748b'
        ctx.fillText(text, 28, 96 + i * 40)
      })
    } else if (this.scope === 'hub') {
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
      const condition = Math.round(game.conveyor.zoneCondition(this.scope))
      const jammed = game.conveyor.jammedCount(this.scope) > 0
      ctx.font = '700 34px system-ui, sans-serif'
      ctx.fillStyle = jammed ? '#ef4444' : condition < 25 ? '#ef4444' : condition < 60 ? '#f59e0b' : '#22c55e'
      ctx.fillText(jammed ? 'JAMMED: repair needed' : `Condition ${condition} %${condition < 60 ? '  · service!' : ''}`, 28, 248)
    }
    ctx.fillStyle = '#94a3b8'
    ctx.font = '600 26px system-ui, sans-serif'
    ctx.fillText('Press E to upgrade', 28, 306)
  }
}
