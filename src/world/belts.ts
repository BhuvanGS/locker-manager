import * as THREE from 'three'
import { withImage } from './textures'

/** Length of one tile of belt texture, in metres. */
export const TEXTURE_TILE = 0.45
const SIZE = 128

/** Rubber (once its image has loaded), then a cross bar and a chevron showing the direction of travel. */
function drawBelt(ctx: CanvasRenderingContext2D, alongX: boolean, rubber: HTMLImageElement | null): void {
  ctx.save()
  if (alongX) {
    ctx.translate(SIZE, 0)
    ctx.rotate(Math.PI / 2)
  }
  ctx.fillStyle = '#3b424d'
  ctx.fillRect(0, 0, SIZE, SIZE)
  if (rubber) {
    ctx.drawImage(rubber, 0, 0, SIZE, SIZE)
    // Lift the near-black rubber to the belt's grey so it reads under the shop lights.
    ctx.globalCompositeOperation = 'screen'
    ctx.fillStyle = '#2c323b'
    ctx.fillRect(0, 0, SIZE, SIZE)
    ctx.globalCompositeOperation = 'source-over'
  }
  const k = SIZE / 64
  ctx.fillStyle = 'rgba(110, 122, 138, 0.55)'
  ctx.fillRect(0, 0, SIZE, 8 * k)
  ctx.fillStyle = 'rgba(20, 23, 28, 0.6)'
  ctx.fillRect(0, 36 * k, SIZE, 3 * k)
  ctx.strokeStyle = 'rgba(140, 152, 168, 0.75)'
  ctx.lineWidth = 3 * k
  ctx.beginPath()
  ctx.moveTo(10 * k, 52 * k)
  ctx.lineTo(32 * k, 42 * k)
  ctx.lineTo(54 * k, 52 * k)
  ctx.stroke()
  ctx.restore()
}

/** A belt surface texture, tiled along its length (`alongX` for belts that run along x); scroll it with `offset`. */
export function beltTexture(alongX = false): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  if (ctx) {
    drawBelt(ctx, alongX, null)
    withImage('belt-rubber', (img) => {
      drawBelt(ctx, alongX, img)
      texture.needsUpdate = true
    })
  }
  return texture
}
