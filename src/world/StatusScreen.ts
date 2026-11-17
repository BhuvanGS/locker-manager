import * as THREE from 'three'
import type { GameManager } from '../sim/GameManager'
import { LOCKER } from './layout'
import { mat } from './models'

const POP_SECONDS = 0.6
const W = 1024
const H = 256
const SCREEN_W = 2.2
const SCREEN_H = SCREEN_W * (H / W)

const FREE = '#16a34a'
const TAKEN = '#dc2626'
const RESERVED = '#d97706'

/**
 * A status screen for one bank of lockers: it replaces the key racks once the lockers go digital. Every locker is a cell
 * laid out like the bank itself (top row on top), green when free and red when occupied (amber while the robot arm has it
 * reserved). It stands on top of its bank and redraws only when something changes.
 */
export class StatusScreen {
  readonly root = new THREE.Group()
  readonly bank: number
  private readonly canvas = document.createElement('canvas')
  private readonly ctx: CanvasRenderingContext2D | null
  private readonly texture: THREE.CanvasTexture
  private signature = ''
  private pop = 1

  /** `top` is the height of the bank's top; the screen stands on it, facing +z, at `z` (the front of the bank). */
  constructor(bank: number, placement: { centerX: number; floorY: number; frontZ: number }, rows: number) {
    this.bank = bank
    const top = LOCKER.baseY + rows * (LOCKER.height + LOCKER.gap) + 0.04
    this.root.position.set(placement.centerX, placement.floorY + top, placement.frontZ - 0.1)

    this.canvas.width = W
    this.canvas.height = H
    this.ctx = this.canvas.getContext('2d')
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.anisotropy = 8

    const steel = mat(0x1f2937, 0.5, 0.4)
    // Two little feet and a bezel, so it reads as a monitor standing on the lockers.
    for (const dx of [-0.8, 0.8]) {
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.1), steel)
      foot.position.set(dx, 0.06, -0.04)
      this.root.add(foot)
    }
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(SCREEN_W + 0.1, SCREEN_H + 0.1, 0.06), steel)
    bezel.position.set(0, 0.12 + SCREEN_H / 2, -0.03)
    this.root.add(bezel)
    const face = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H), new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false }))
    face.position.set(0, 0.12 + SCREEN_H / 2, 0.005)
    this.root.add(face)
  }

  /** Start the "pop in" animation (a freshly installed screen). */
  appear(): void {
    this.pop = 0
    this.root.scale.setScalar(0.001)
  }

  update(dt: number, game: GameManager): void {
    if (this.pop < 1) {
      this.pop = Math.min(1, this.pop + dt / POP_SECONDS)
      const t = this.pop - 1
      this.root.scale.setScalar(Math.max(0.001, 1 + 2.2 * t ** 3 + 1.2 * t ** 2))
    }
    const lockers = game.lockers.all().filter((l) => l.bank === this.bank)
    const cells = lockers.map((l) => [l.number, l.row, l.col, l.state === 'reserved' ? 'r' : l.state === 'available' ? 'f' : 'o'] as const)
    const signature = JSON.stringify(cells)
    if (signature === this.signature) return
    this.signature = signature
    this.draw(cells)
  }

  private draw(cells: readonly (readonly [number, number, number, string])[]): void {
    const ctx = this.ctx
    if (!ctx) return
    this.texture.needsUpdate = true
    ctx.fillStyle = '#0b1220'
    ctx.fillRect(0, 0, W, H)
    const numbers = cells.map((c) => c[0])
    const free = cells.filter((c) => c[3] === 'f').length
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.fillStyle = '#fbbf24'
    ctx.font = '800 54px system-ui, sans-serif'
    ctx.fillText(`LOCKERS ${Math.min(...numbers)}–${Math.max(...numbers)}`, 36, 70)
    ctx.fillStyle = '#e2e8f0'
    ctx.font = '600 44px system-ui, sans-serif'
    ctx.fillText(`${free} of ${cells.length} free`, 36, 138)
    // Legend.
    ctx.font = '600 28px system-ui, sans-serif'
    let lx = 36
    for (const [color, label] of [
      [FREE, 'free'],
      [TAKEN, 'occupied'],
    ] as const) {
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(lx + 12, 208, 12, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#94a3b8'
      ctx.fillText(label, lx + 32, 209)
      lx += 32 + ctx.measureText(label).width + 36
    }

    // The bank itself: three columns, the top row on top.
    const cols = Math.max(...cells.map((c) => c[2])) + 1
    const rows = Math.max(...cells.map((c) => c[1])) + 1
    const gridX = 520
    const gap = 10
    const cw = (W - gridX - 36 - gap * (cols - 1)) / cols
    const ch = (H - 36 - gap * (rows - 1)) / rows
    for (const [number, row, col, state] of cells) {
      const x = gridX + col * (cw + gap)
      const y = 18 + (rows - 1 - row) * (ch + gap)
      ctx.fillStyle = state === 'f' ? FREE : state === 'r' ? RESERVED : TAKEN
      ctx.beginPath()
      ctx.roundRect(x, y, cw, ch, 14)
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'center'
      ctx.font = '800 56px system-ui, sans-serif'
      ctx.fillText(String(number), x + cw / 2, y + ch / 2 - 10)
      ctx.font = '600 26px system-ui, sans-serif'
      ctx.fillText(state === 'f' ? 'OPEN' : state === 'r' ? 'ROBOT' : 'IN USE', x + cw / 2, y + ch / 2 + 34)
    }
  }
}
