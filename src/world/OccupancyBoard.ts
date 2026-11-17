import * as THREE from 'three'
import type { GameManager } from '../sim/GameManager'
import { ZONE_TITLES, type AutoZone } from '../sim/config'
import { OCCUPANCY_BOARD } from './layout'
import { mat } from './models'

const POP_SECONDS = 0.6
const W = 1024
const H = 576
const HEADER = 96
const FREE = '#16a34a'
const TAKEN = '#dc2626'
const RESERVED = '#d97706'

/**
 * A wall board for one hall: every locker as a coloured cell (green free, red occupied, amber reserved by a robot arm),
 * laid out like the hall itself (each row of three banks across, the row nearest the wall at the top). It hangs on the hall's
 * north wall beside the arm console, so you can see at a glance where there is room. It redraws only when something changes.
 */
export class OccupancyBoard {
  readonly root = new THREE.Group()
  readonly zone: AutoZone
  private readonly canvas = document.createElement('canvas')
  private readonly ctx: CanvasRenderingContext2D | null
  private readonly texture: THREE.CanvasTexture
  private signature = ''
  private pop = 1

  /** `floorY` is the height of the hall's floor. */
  constructor(zone: AutoZone, floorY: number) {
    this.zone = zone
    this.root.userData.zone = zone
    const { x, y, z, width } = OCCUPANCY_BOARD
    const height = width * (H / W)
    this.root.position.set(x, floorY + y, z)
    this.root.rotation.y = Math.PI // faces into the hall (−z)

    this.canvas.width = W
    this.canvas.height = H
    this.ctx = this.canvas.getContext('2d')
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.anisotropy = 8

    const frame = new THREE.Mesh(new THREE.BoxGeometry(width + 0.1, height + 0.1, 0.05), mat(0x1f2937, 0.5, 0.4))
    frame.position.z = -0.02
    this.root.add(frame)
    const face = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false }))
    face.position.z = 0.006
    this.root.add(face)
  }

  /** Start the "pop onto the wall" animation (a freshly installed board). */
  appear(): void {
    this.pop = 0
    this.root.scale.setScalar(0.001)
  }

  dispose(): void {
    this.texture.dispose()
  }

  update(dt: number, game: GameManager): void {
    if (this.pop < 1) {
      this.pop = Math.min(1, this.pop + dt / POP_SECONDS)
      const t = this.pop - 1
      this.root.scale.setScalar(Math.max(0.001, 1 + 2.2 * t ** 3 + 1.2 * t ** 2))
    }
    // Every locker of this hall: its number, which row of banks and which bank in that row, and its place in the bank.
    const lockers = game.lockers.all().filter((l) => game.zoneOf(l.id) === this.zone)
    const banks = [...new Set(lockers.map((l) => l.bank))].sort((a, b) => a - b)
    const cells = lockers.map((l) => {
      const row = game.rowOf(l.id)
      const inRow = banks.filter((b) => game.rowOf(lockers.find((o) => o.bank === b)!.id) === row)
      return [l.number, row, inRow.indexOf(l.bank), l.row, l.col, l.state === 'reserved' ? 'r' : l.state === 'available' ? 'f' : 'o'] as const
    })
    const signature = JSON.stringify(cells)
    if (signature === this.signature) return
    this.signature = signature
    this.draw(cells)
  }

  private draw(cells: readonly (readonly [number, number, number, number, number, string])[]): void {
    const ctx = this.ctx
    if (!ctx || cells.length === 0) return
    this.texture.needsUpdate = true
    ctx.fillStyle = '#0b1220'
    ctx.fillRect(0, 0, W, H)
    const free = cells.filter((c) => c[5] === 'f').length
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.fillStyle = '#fbbf24'
    ctx.font = '800 48px system-ui, sans-serif'
    ctx.fillText(`${ZONE_TITLES[this.zone].toUpperCase()} · OCCUPANCY`, 32, 48)
    ctx.textAlign = 'right'
    ctx.fillStyle = '#e2e8f0'
    ctx.font = '700 44px system-ui, sans-serif'
    ctx.fillText(`${free} of ${cells.length} free`, W - 32, 48)

    const bankRows = Math.max(...cells.map((c) => c[1])) + 1
    const bankCols = Math.max(...cells.map((c) => c[2])) + 1
    const gap = 22
    const left = 32
    const top = HEADER
    const bw = (W - left * 2 - gap * (bankCols - 1)) / bankCols
    const bh = (H - top - 24 - gap * (bankRows - 1)) / bankRows
    for (const [number, row, col, lockerRow, lockerCol, state] of cells) {
      const bx = left + col * (bw + gap)
      const by = top + row * (bh + gap)
      const cw = (bw - 8) / 3
      const ch = (bh - 4) / 2
      const x = bx + lockerCol * cw
      const y = by + (1 - lockerRow) * ch // the top shelf of the bank is drawn on top
      ctx.fillStyle = state === 'f' ? FREE : state === 'r' ? RESERVED : TAKEN
      ctx.beginPath()
      ctx.roundRect(x + 2, y + 2, cw - 4, ch - 4, 8)
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'center'
      ctx.font = `800 ${Math.round(Math.min(cw, ch) * 0.46)}px system-ui, sans-serif`
      ctx.fillText(String(number), x + cw / 2, y + ch / 2 + 2)
    }
  }
}
