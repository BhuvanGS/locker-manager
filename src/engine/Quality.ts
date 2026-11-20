import type * as THREE from 'three'

/**
 * Graphics quality, so the game stays smooth on slower laptops. Three levels change what costs the most: the render resolution, the
 * sun's shadow map (its size, and how often it is redrawn) and the view distance. On 'auto' the game starts on high and steps down a
 * level whenever the frame rate stays under `TARGET_FPS` for a few seconds (it never steps back up by itself, so it does not flicker
 * between levels). The player can also pick a level in the pause menu; the choice is remembered.
 */
export type QualityLevel = 'high' | 'medium' | 'low'
export type QualitySetting = 'auto' | QualityLevel

const LEVELS: Record<QualityLevel, { scale: number; shadow: number; shadowEvery: number; far: number }> = {
  // scale: the most device pixels per CSS pixel (high-DPI screens are expensive to fill).
  high: { scale: 1.5, shadow: 2048, shadowEvery: 1, far: 250 },
  medium: { scale: 1, shadow: 2048, shadowEvery: 2, far: 200 },
  low: { scale: 0.8, shadow: 1024, shadowEvery: 3, far: 150 },
}
const ORDER: QualityLevel[] = ['high', 'medium', 'low']
const TARGET_FPS = 48
const WINDOW = 2 // seconds per measurement
const STORAGE_KEY = 'locker-manager-quality'

export function savedQuality(): QualitySetting {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    if (v === 'auto' || v === 'high' || v === 'medium' || v === 'low') return v
  } catch {
    // Storage can be blocked: fall back to auto.
  }
  return 'auto'
}

export function saveQuality(setting: QualitySetting): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, setting)
  } catch {
    // Not remembered, but still applied.
  }
}

export class Quality {
  setting: QualitySetting
  level: QualityLevel
  private frames = 0
  private time = 0
  private slowWindows = 0
  private tickCount = 0
  private readonly renderer: THREE.WebGLRenderer
  private readonly camera: THREE.PerspectiveCamera
  private readonly setShadowSize: (size: number) => void
  private readonly onResize: () => void

  constructor(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, setShadowSize: (size: number) => void, onResize: () => void) {
    this.renderer = renderer
    this.camera = camera
    this.setShadowSize = setShadowSize
    this.onResize = onResize
    this.setting = savedQuality()
    this.level = this.setting === 'auto' ? 'high' : this.setting
    renderer.shadowMap.autoUpdate = false
    this.apply()
  }

  /** Choose a setting (from the pause menu). */
  choose(setting: QualitySetting): void {
    this.setting = setting
    saveQuality(setting)
    this.level = setting === 'auto' ? 'high' : setting
    this.slowWindows = 0
    this.apply()
  }

  /** Filming or tests: full quality, shadows every frame, whatever the setting. */
  force(level: QualityLevel): void {
    this.level = level
    this.apply()
  }

  private apply(): void {
    const L = LEVELS[this.level]
    // High: up to 1.5 device pixels per CSS pixel; medium: no more than 1; low: 80 % of that (the image is scaled up).
    const dpr = window.devicePixelRatio || 1
    this.renderer.setPixelRatio(this.level === 'high' ? Math.min(dpr, L.scale) : Math.min(dpr, 1) * (this.level === 'low' ? L.scale : 1))
    this.setShadowSize(L.shadow)
    this.camera.far = L.far
    this.camera.updateProjectionMatrix()
    this.renderer.shadowMap.needsUpdate = true
    this.onResize()
  }

  /** Every engine frame: redraw the shadow map as often as the level allows. */
  beforeRender(): void {
    this.tickCount++
    if (this.tickCount % LEVELS[this.level].shadowEvery === 0) this.renderer.shadowMap.needsUpdate = true
  }

  /** Every real (browser) frame, with its real duration: on 'auto', step down while the game is too slow. */
  measure(dt: number, playing: boolean): void {
    if (this.setting !== 'auto' || !playing || dt <= 0 || dt > 0.5) return
    this.frames++
    this.time += dt
    if (this.time < WINDOW) return
    const fps = this.frames / this.time
    this.frames = 0
    this.time = 0
    this.slowWindows = fps < TARGET_FPS ? this.slowWindows + 1 : 0
    const at = ORDER.indexOf(this.level)
    if (this.slowWindows >= 2 && at < ORDER.length - 1) {
      this.level = ORDER[at + 1]!
      this.slowWindows = 0
      this.apply()
    }
  }
}
