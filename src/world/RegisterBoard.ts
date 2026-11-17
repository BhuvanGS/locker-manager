import * as THREE from 'three'
import type { GameManager } from '../sim/GameManager'
import type { RegisterEntry } from '../sim/types'
import { REGISTER_BOARD } from './layout'
import { mat } from './models'

const POP_SECONDS = 0.6
const W = 1024
const H = 640
const HEADER = 76

/**
 * The deposit register board: a whiteboard on the staff-area wall that lists every bag currently stored
 * (customer, locker number, item). It redraws itself whenever a bag goes in or comes out, so the player no
 * longer has to remember who is where. Built when the upgrade is bought and pops onto the wall.
 */
export class RegisterBoard {
  readonly root = new THREE.Group()
  private readonly canvas = document.createElement('canvas')
  private readonly ctx: CanvasRenderingContext2D | null
  private readonly texture: THREE.CanvasTexture
  private signature = ''
  private pop = 1

  constructor() {
    const { x, y, z, rotY, width, height } = REGISTER_BOARD
    this.root.position.set(x, y, z)
    this.root.rotation.y = rotY // faces into the storage room (−z)

    this.canvas.width = W
    this.canvas.height = H
    this.ctx = this.canvas.getContext('2d')
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.anisotropy = 8

    const frame = new THREE.Mesh(new THREE.BoxGeometry(width + 0.1, height + 0.1, 0.05), mat(0x475569, 0.5, 0.5))
    frame.position.z = -0.02
    this.root.add(frame)
    const face = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false }))
    face.position.z = 0.006
    this.root.add(face)
    // Marker tray.
    const tray = new THREE.Mesh(new THREE.BoxGeometry(width * 0.6, 0.03, 0.08), mat(0x475569, 0.5, 0.5))
    tray.position.set(0, -height / 2 - 0.07, 0.03)
    this.root.add(tray)
    for (const [i, color] of [0x2563eb, 0xdc2626, 0x16a34a].entries()) {
      const marker = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.13, 8), mat(color, 0.6))
      marker.rotation.z = Math.PI / 2
      marker.position.set(-0.2 + i * 0.2, -height / 2 - 0.045, 0.04)
      this.root.add(marker)
    }
    this.draw([])
  }

  /** Start the "pop onto the wall" animation (a freshly bought board). */
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
    const entries = game.registerEntries()
    const signature = JSON.stringify(entries)
    if (signature === this.signature) return
    this.signature = signature
    this.draw(entries)
  }

  private draw(entries: RegisterEntry[]): void {
    const ctx = this.ctx
    if (!ctx) return
    this.texture.needsUpdate = true // drawn synchronously below, uploaded on the next render
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#f5f3ea'
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(0, 0, W, HEADER)
    ctx.fillStyle = '#fbbf24'
    ctx.font = '800 44px system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText('DEPOSIT REGISTER', 28, HEADER / 2 + 2)
    ctx.fillStyle = '#e2e8f0'
    ctx.font = '600 32px system-ui, sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText(`${entries.length} stored`, W - 28, HEADER / 2 + 2)

    if (entries.length === 0) {
      ctx.fillStyle = '#94a3b8'
      ctx.font = '600 40px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('No bags stored', W / 2, HEADER + (H - HEADER) / 2)
      return
    }

    // One, two or three columns as the shop fills up (up to 42 lockers once both annexes are built).
    const n = entries.length
    const perColumn = n <= 18 ? 9 : 14
    const columns = Math.ceil(n / perColumn) // 1: ≤9, 2: ≤18 (9 rows) or ≤28 (14 rows), 3: ≤42
    const shown = entries.slice(0, perColumn * 3)
    const colW = W / columns
    const rows = Math.min(perColumn, shown.length)
    // A few entries get bigger text so they can be read from across the room; a crowded board gets compact rows.
    const roomy = columns === 1 && rows <= 6
    const rowH = Math.min(roomy ? 88 : 66, (H - HEADER - 16) / rows)
    const scale = columns === 3 ? 0.6 : columns === 2 ? 0.78 : roomy ? 1.3 : 1
    shown.forEach((entry, i) => {
      const col = Math.floor(i / perColumn)
      const row = i % perColumn
      const x0 = col * colW
      const y0 = HEADER + 10 + row * rowH
      const cy = y0 + rowH / 2

      if (row % 2 === 0) {
        ctx.fillStyle = 'rgba(15, 23, 42, 0.05)'
        ctx.fillRect(x0 + 8, y0, colW - 16, rowH)
      }
      // Locker number badge.
      const badgeW = 78 * scale
      const badgeH = Math.min(50 * Math.max(1, scale), rowH - 8)
      ctx.fillStyle = '#0f172a'
      ctx.beginPath()
      ctx.roundRect(x0 + 22, cy - badgeH / 2, badgeW, badgeH, 8)
      ctx.fill()
      ctx.fillStyle = '#f8fafc'
      ctx.font = `800 ${Math.round(badgeH * 0.74)}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.fillText(String(entry.lockerNumber), x0 + 22 + badgeW / 2, cy + 2)

      // Customer name (or a note that none was taken), then the item on the right (truncated to fit).
      const nameX = x0 + 22 + badgeW + 18
      const itemRight = x0 + colW - 22
      const itemFont = `500 ${Math.round(28 * scale)}px system-ui, sans-serif`
      ctx.font = itemFont
      const itemWidth = Math.min(ctx.measureText(entry.itemLabel).width, colW * 0.4)
      ctx.textAlign = 'left'
      if (entry.name) {
        ctx.fillStyle = '#0f172a'
        ctx.font = `700 ${Math.round(34 * scale)}px system-ui, sans-serif`
        ctx.fillText(fit(ctx, entry.name, itemRight - itemWidth - nameX - 14), nameX, cy + 2)
      } else {
        // The player never asked for the name when taking the bag, so the board cannot show it.
        ctx.fillStyle = '#94a3b8'
        ctx.font = `italic 500 ${Math.round(30 * scale)}px system-ui, sans-serif`
        ctx.fillText(fit(ctx, 'name not taken', itemRight - itemWidth - nameX - 14), nameX, cy + 2)
      }
      ctx.fillStyle = '#475569'
      ctx.font = itemFont
      ctx.textAlign = 'right'
      ctx.fillText(fit(ctx, entry.itemLabel, itemWidth), itemRight, cy + 2)
    })
  }
}

/** Truncate `text` with an ellipsis so it fits in `width` pixels with the current font. */
function fit(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text
  let cut = text
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1)
  return `${cut}…`
}
