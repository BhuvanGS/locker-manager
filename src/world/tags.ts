import * as THREE from 'three'

/**
 * Name labels over people and vehicles, drawn as paper luggage tags (to match the HUD): a cream tag with clipped corners on the left,
 * a brass-ringed eyelet with its string, and the text in Bungee. `tone` colours the tag: 'paper' for customers, 'brass' for VIPs and
 * owners, 'red' for anyone shady. The canvas is redrawn once the font has loaded (the first draw may fall back to a system font).
 * Width and height are in canvas pixels; scale a sprite to the same aspect.
 */
export type TagTone = 'paper' | 'brass' | 'red'

const FONT = 'Bungee'
const TONES: Record<TagTone, { fill: string; edge: string; ink: string; band: string }> = {
  paper: { fill: '#f3e9d2', edge: '#b9a57a', ink: '#1f1b14', band: '#1f6f78' },
  brass: { fill: '#f1bc3d', edge: '#a87612', ink: '#1f1b14', band: '#1f1b14' },
  red: { fill: '#c63b2d', edge: '#7c1f16', ink: '#f3e9d2', band: '#1f1b14' },
}

const cache = new Map<string, THREE.CanvasTexture>()
const pending: (() => void)[] = []
let fontReady = typeof document === 'undefined' || !document.fonts ? true : document.fonts.check(`40px ${FONT}`)
if (!fontReady && typeof document !== 'undefined' && document.fonts) {
  void document.fonts.load(`40px ${FONT}`).then(() => {
    fontReady = true
    for (const redraw of pending.splice(0)) redraw()
  })
}

export const TAG_W = 512
export const TAG_H = 128

/** A luggage-tag texture for `text` (cached per text and tone). */
export function tagTexture(text: string, tone: TagTone = 'paper', width = TAG_W): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const key = `${tone}|${width}|${text}`
  let texture = cache.get(key)
  if (texture) return texture
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = TAG_H
  const draw = () => drawTag(canvas, text, TONES[tone])
  draw()
  texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  cache.set(key, texture)
  if (!fontReady) {
    const t = texture
    pending.push(() => {
      draw()
      t.needsUpdate = true
    })
  }
  return texture
}

function drawTag(canvas: HTMLCanvasElement, text: string, c: (typeof TONES)[TagTone]): void {
  const g = canvas.getContext('2d')
  if (!g) return
  const W = canvas.width
  const H = canvas.height
  g.clearRect(0, 0, W, H)
  // Fit the text first, then size the tag round it (centred), so short names get short tags.
  let size = 44
  g.font = `${size}px ${FONT}, 'Arial Black', sans-serif`
  while (g.measureText(text).width > W - 150 && size > 20) {
    size -= 2
    g.font = `${size}px ${FONT}, 'Arial Black', sans-serif`
  }
  const tw = g.measureText(text).width
  const w = Math.min(W - 12, tw + 120)
  const x0 = (W - w) / 2
  const y0 = 18
  const h = H - 36
  const cut = 26
  // A soft shadow, then the tag.
  g.save()
  g.shadowColor = 'rgba(0, 0, 0, 0.35)'
  g.shadowBlur = 10
  g.shadowOffsetY = 4
  g.beginPath()
  g.moveTo(x0 + cut, y0)
  g.lineTo(x0 + w - 8, y0)
  g.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + 8)
  g.lineTo(x0 + w, y0 + h - 8)
  g.quadraticCurveTo(x0 + w, y0 + h, x0 + w - 8, y0 + h)
  g.lineTo(x0 + cut, y0 + h)
  g.lineTo(x0, y0 + h - cut)
  g.lineTo(x0, y0 + cut)
  g.closePath()
  g.fillStyle = c.fill
  g.fill()
  g.restore()
  g.lineWidth = 3
  g.strokeStyle = c.edge
  g.stroke()
  // A band of colour down the eyelet end, and a dashed perforation.
  g.save()
  g.clip()
  g.fillStyle = c.band
  g.globalAlpha = 0.9
  g.fillRect(x0, y0, 52, h)
  g.restore()
  g.setLineDash([6, 6])
  g.strokeStyle = c.edge
  g.lineWidth = 2
  g.beginPath()
  g.moveTo(x0 + 54, y0 + 8)
  g.lineTo(x0 + 54, y0 + h - 8)
  g.stroke()
  g.setLineDash([])
  // The eyelet: a brass ring with a hole, and the string going up out of it.
  const ex = x0 + 26
  const ey = y0 + h / 2
  g.beginPath()
  g.arc(ex, ey, 12, 0, Math.PI * 2)
  g.fillStyle = '#e3a92b'
  g.fill()
  g.beginPath()
  g.arc(ex, ey, 6, 0, Math.PI * 2)
  g.globalCompositeOperation = 'destination-out'
  g.fill()
  g.globalCompositeOperation = 'source-over'
  g.strokeStyle = '#efe6cf'
  g.lineWidth = 3
  g.beginPath()
  g.moveTo(ex, ey - 6)
  g.bezierCurveTo(ex - 10, ey - 30, ex + 14, ey - 40, ex + 4, 0)
  g.stroke()
  // The name.
  g.fillStyle = c.ink
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, x0 + 54 + (w - 54) / 2, ey + 3)
}
