import * as THREE from 'three'

/** A single short line floating over someone's head. Hidden behind walls (depth tested). */
export class HeadBubble {
  private readonly canvas = document.createElement('canvas')
  private readonly ctx: CanvasRenderingContext2D | null
  private readonly texture: THREE.CanvasTexture
  private readonly sprite: THREE.Sprite
  private readonly accent: string
  private text = ''

  constructor(parent: THREE.Object3D, accent: string) {
    this.accent = accent
    this.ctx = this.canvas.getContext('2d')
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, transparent: true }))
    this.sprite.renderOrder = 10
    this.sprite.visible = false
    parent.add(this.sprite)
  }

  show(text: string): void {
    if (text !== this.text) {
      this.text = text
      this.draw(text)
    }
    this.sprite.visible = true
  }

  hide(): void {
    this.sprite.visible = false
  }

  private draw(text: string): void {
    const ctx = this.ctx
    if (!ctx) return
    const font = '600 30px system-ui, sans-serif'
    ctx.font = font
    const shown = text.length > 42 ? `${text.slice(0, 40)}…` : text
    const width = Math.ceil(Math.max(64, ctx.measureText(shown).width + 44))
    const height = 64
    this.canvas.width = width
    this.canvas.height = height + 14
    ctx.font = font
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)'
    ctx.strokeStyle = this.accent
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.roundRect(3, 3, width - 6, height - 6, 18)
    ctx.fill()
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(width / 2 - 10, height - 4)
    ctx.lineTo(width / 2, height + 10)
    ctx.lineTo(width / 2 + 10, height - 4)
    ctx.fillStyle = this.accent
    ctx.fill()
    ctx.fillStyle = '#f8fafc'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(shown, width / 2, height / 2)
    const scale = 0.0085
    this.sprite.scale.set(this.canvas.width * scale, this.canvas.height * scale, 1)
    this.sprite.position.y = 2.05 + this.sprite.scale.y / 2
    // Canvas size changed: drop the GPU copy so it is re-allocated at the new size.
    this.texture.dispose()
    this.texture.needsUpdate = true
  }
}
