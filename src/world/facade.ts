import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

/**
 * The shopfront's look, after the Locker Manager facade sheet: dark wall panels with seams, a backlit sign with the red locker
 * logo, warm downlights with pools of light on the pavement, bollards with yellow bands, block bushes, and hazard stripes.
 * Textures are drawn on canvases (no files).
 */
function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')
  if (g) draw(g)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

let panelMat: THREE.MeshStandardMaterial | null = null
/** Dark composite wall panels, 1.2 m square, with lighter seams and a faint grain (for faces with UVs in metres). */
export function wallPanelDark(): THREE.MeshStandardMaterial {
  if (panelMat) return panelMat
  const tex = canvas(256, 256, (g) => {
    g.fillStyle = '#2c3037'
    g.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(255,255,255,${(Math.random() * 0.025).toFixed(3)})`
      g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2)
    }
    g.fillStyle = '#1b1e23'
    g.fillRect(0, 0, 256, 4)
    g.fillRect(0, 0, 4, 256)
    g.fillStyle = '#3a3f47'
    g.fillRect(0, 4, 256, 2)
    g.fillRect(4, 0, 2, 256)
  })
  if (tex) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(1 / 1.2, 1 / 1.2)
  }
  panelMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, roughness: 0.7, metalness: 0.15 })
  return panelMat
}

let stripeTex: THREE.CanvasTexture | null = null
/** Yellow and black hazard stripes (0.25 m bands on faces with UVs in metres). */
export function hazardStripes(): THREE.MeshStandardMaterial {
  stripeTex ??= canvas(128, 128, (g) => {
    g.fillStyle = '#16171a'
    g.fillRect(0, 0, 128, 128)
    g.fillStyle = '#f2b51d'
    for (let k = -2; k < 4; k++) {
      g.beginPath()
      g.moveTo(k * 64, 128)
      g.lineTo(k * 64 + 32, 128)
      g.lineTo(k * 64 + 160, 0)
      g.lineTo(k * 64 + 128, 0)
      g.closePath()
      g.fill()
    }
  })
  if (stripeTex) {
    stripeTex.wrapS = stripeTex.wrapT = THREE.RepeatWrapping
    stripeTex.repeat.set(2, 2)
  }
  return new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.7 })
}

/** Draw the logo: a red rounded square with a white locker (two doors, vents, handles). */
function drawLogo(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  g.fillStyle = '#e02b2b'
  g.beginPath()
  g.roundRect(x, y, s, s, s * 0.16)
  g.fill()
  g.strokeStyle = '#ffffff'
  g.lineWidth = s * 0.07
  g.beginPath()
  g.roundRect(x + s * 0.2, y + s * 0.18, s * 0.6, s * 0.64, s * 0.06)
  g.stroke()
  g.beginPath()
  g.moveTo(x + s * 0.5, y + s * 0.18)
  g.lineTo(x + s * 0.5, y + s * 0.82)
  g.stroke()
  g.lineWidth = s * 0.04
  for (const cx of [0.35, 0.65]) {
    for (const vy of [0.3, 0.38]) {
      g.beginPath()
      g.moveTo(x + s * (cx - 0.08), y + s * vy)
      g.lineTo(x + s * (cx + 0.08), y + s * vy)
      g.stroke()
    }
  }
  g.fillStyle = '#ffffff'
  g.fillRect(x + s * 0.42, y + s * 0.5, s * 0.04, s * 0.1)
  g.fillRect(x + s * 0.54, y + s * 0.5, s * 0.04, s * 0.1)
}

/** The backlit shop sign: dark panel, red logo, white lettering; it glows a little. Facing +z. */
export function shopSign(w: number, h: number, text: string): THREE.Mesh {
  const tex = canvas(2048, Math.round((2048 * h) / w), (g) => {
    const H = g.canvas.height
    g.fillStyle = '#17191d'
    g.beginPath()
    g.roundRect(0, 0, 2048, H, H * 0.1)
    g.fill()
    g.strokeStyle = '#3b4048'
    g.lineWidth = 10
    g.stroke()
    drawLogo(g, H * 0.14, H * 0.14, H * 0.72)
    g.fillStyle = '#f8fafc'
    g.font = `800 ${Math.round(H * 0.56)}px system-ui, sans-serif`
    g.textBaseline = 'middle'
    g.fillText(text, H * 1.05, H * 0.54)
  })
  const mat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.55, roughness: 0.5 })
  const sign = new THREE.Mesh(new RoundedBoxGeometry(w, h, 0.12, 2, 0.04), [
    new THREE.MeshStandardMaterial({ color: 0x17191d }),
    new THREE.MeshStandardMaterial({ color: 0x17191d }),
    new THREE.MeshStandardMaterial({ color: 0x17191d }),
    new THREE.MeshStandardMaterial({ color: 0x17191d }),
    mat,
    new THREE.MeshStandardMaterial({ color: 0x17191d }),
  ])
  sign.castShadow = true
  return sign
}

let poolTex: THREE.CanvasTexture | null = null
/** A warm downlight (a glowing square under the canopy) and the pool of light it throws on the ground below. */
export function downlight(x: number, y: number, z: number, groundY = 0.045): THREE.Group {
  const g = new THREE.Group()
  const lens = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.34), new THREE.MeshStandardMaterial({ color: 0xfff4dc, emissive: 0xffd99a, emissiveIntensity: 2.2 }))
  lens.position.set(x, y, z)
  poolTex ??= canvas(128, 128, (c) => {
    const grad = c.createRadialGradient(64, 64, 0, 64, 64, 64)
    grad.addColorStop(0, 'rgba(255,214,150,0.55)')
    grad.addColorStop(0.5, 'rgba(255,200,130,0.18)')
    grad.addColorStop(1, 'rgba(255,200,130,0)')
    c.fillStyle = grad
    c.fillRect(0, 0, 128, 128)
  })
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 2.6).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.7 }),
  )
  pool.position.set(x, groundY, z)
  pool.renderOrder = 2
  g.add(lens, pool)
  return g
}

/** A black bollard with two yellow bands. */
export function bollard(x: number, z: number): THREE.Group {
  const g = new THREE.Group()
  const black = new THREE.MeshStandardMaterial({ color: 0x1d1f23, roughness: 0.6, metalness: 0.3 })
  const yellow = new THREE.MeshStandardMaterial({ color: 0xf2b51d, roughness: 0.6 })
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.9, 16), black)
  post.position.set(x, 0.45, z)
  post.castShadow = true
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), black)
  cap.position.set(x, 0.9, z)
  g.add(post, cap)
  for (const y of [0.62, 0.74]) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.06, 16), yellow)
    band.position.set(x, y, z)
    g.add(band)
  }
  return g
}

/** A bush of soft green blocks (sits on y). */
export function blockBush(x: number, y: number, z: number, w = 0.8, seed = 1): THREE.Group {
  const g = new THREE.Group()
  const greens = [0x5f9e3a, 0x4f8a31, 0x6fb046]
  const r = (k: number) => (Math.abs(Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453) % 1)
  for (let k = 0; k < 7; k++) {
    const s = w * (0.38 + r(k) * 0.22)
    const leaf = new THREE.Mesh(new RoundedBoxGeometry(s, s * 0.85, s, 2, s * 0.18), new THREE.MeshStandardMaterial({ color: greens[k % 3], roughness: 0.85 }))
    leaf.position.set(x + (r(k + 10) - 0.5) * w * 0.7, y + s * 0.4 + r(k + 20) * w * 0.25, z + (r(k + 30) - 0.5) * w * 0.4)
    leaf.rotation.y = r(k + 40) * 0.6
    leaf.castShadow = true
    g.add(leaf)
  }
  return g
}
