import * as THREE from 'three'

/** Length of one tile of belt texture, in metres. */
export const TEXTURE_TILE = 0.45

/** A belt surface texture: a grey belt with lighter cross bars, tiled along its length (`alongX` for belts that run along x). */
export function beltTexture(alongX = false): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (ctx) {
    if (alongX) {
      ctx.translate(64, 0)
      ctx.rotate(Math.PI / 2)
    }
    ctx.fillStyle = '#3b424d'
    ctx.fillRect(0, 0, 64, 64)
    ctx.fillStyle = '#566170'
    ctx.fillRect(0, 0, 64, 8)
    ctx.fillStyle = '#2a2f37'
    ctx.fillRect(0, 36, 64, 3)
    ctx.strokeStyle = '#6b7788'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(10, 52)
    ctx.lineTo(32, 42)
    ctx.lineTo(54, 52)
    ctx.stroke()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}
