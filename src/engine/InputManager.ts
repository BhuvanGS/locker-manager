import { useGameStore } from '../store/gameStore'

export type InputSnapshot = {
  forward: number
  right: number
  sprint: boolean
  crouch: boolean
  interact: boolean
  interactPressed: boolean
  greetPressed: boolean
  explainPressed: boolean
  phonePressed: boolean
  primaryPressed: boolean
  secondaryHeld: boolean
  pause: boolean
  pausePressed: boolean
}

export type InputSnapshotWithMouse = InputSnapshot & {
  mouseDeltaX: number
  mouseDeltaY: number
}

const GAME_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyC',
  'KeyE',
  'KeyF',
  'KeyG',
  'KeyX',
  'KeyI',
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Escape',
])

export class InputManager {
  private keys = new Set<string>()
  private prevKeys = new Set<string>()
  private mouseDeltaX = 0
  private mouseDeltaY = 0
  private element: HTMLElement | null = null
  private pointerLocked = false
  private bound = false
  private secondaryDown = false
  /** Clicks that arrived while the pointer was already locked. Consumed by snapshot. */
  private lockedClicks = 0
  private lastRaw = 'none'
  private oneShots = new Set<string>()

  attach(element: HTMLElement): void {
    if (this.bound) return
    this.element = element
    this.bound = true
    window.addEventListener('keydown', this.onKeyDown, true)
    window.addEventListener('keyup', this.onKeyUp, true)
    window.addEventListener('mousemove', this.onMouseMove, true)
    window.addEventListener('mousedown', this.onMouseDown, true)
    window.addEventListener('mouseup', this.onMouseUp, true)
    document.addEventListener('pointerlockchange', this.onPointerLockChange)
    element.addEventListener('click', this.requestPointerLock)
    element.addEventListener('contextmenu', this.blockMenu)
  }

  detach(): void {
    if (!this.bound) return
    window.removeEventListener('keydown', this.onKeyDown, true)
    window.removeEventListener('keyup', this.onKeyUp, true)
    window.removeEventListener('mousemove', this.onMouseMove, true)
    window.removeEventListener('mousedown', this.onMouseDown, true)
    window.removeEventListener('mouseup', this.onMouseUp, true)
    document.removeEventListener('pointerlockchange', this.onPointerLockChange)
    this.element?.removeEventListener('click', this.requestPointerLock)
    this.element?.removeEventListener('contextmenu', this.blockMenu)
    if (document.pointerLockElement === this.element) {
      document.exitPointerLock()
    }
    this.bound = false
    this.element = null
  }

  beginFrame(): void {
    this.prevKeys = new Set(this.keys)
  }

  snapshot(): InputSnapshotWithMouse {
    const forward =
      (this.isDown('KeyW') || this.isDown('ArrowUp') ? 1 : 0) +
      (this.isDown('KeyS') || this.isDown('ArrowDown') ? -1 : 0)
    const right =
      (this.isDown('KeyD') || this.isDown('ArrowRight') ? 1 : 0) +
      (this.isDown('KeyA') || this.isDown('ArrowLeft') ? -1 : 0)

    const mouse = this.consumeMouseDelta()
    const primaryPressed = this.lockedClicks > 0
    this.lockedClicks = 0

    const greetPressed = this.oneShots.has('KeyG') || this.wasPressed('KeyG')
    const explainPressed = this.oneShots.has('KeyX') || this.wasPressed('KeyX')
    const phonePressed = this.oneShots.has('KeyI') || this.wasPressed('KeyI')
    this.oneShots.delete('KeyG')
    this.oneShots.delete('KeyX')
    this.oneShots.delete('KeyI')

    return {
      forward,
      right,
      sprint: this.isDown('ShiftLeft') || this.isDown('ShiftRight'),
      crouch:
        this.isDown('KeyC') ||
        this.isDown('ControlLeft') ||
        this.isDown('ControlRight'),
      interact: this.isDown('KeyF') || this.isDown('KeyE'),
      interactPressed: this.wasPressed('KeyF') || this.wasPressed('KeyE'),
      greetPressed,
      explainPressed,
      phonePressed,
      primaryPressed,
      secondaryHeld: this.secondaryDown,
      pause: this.isDown('Escape'),
      pausePressed: this.wasPressed('Escape'),
      mouseDeltaX: mouse.mouseDeltaX,
      mouseDeltaY: mouse.mouseDeltaY,
    }
  }

  lastRawInput(): string {
    return this.lastRaw
  }

  consumeMouseDelta(): { mouseDeltaX: number; mouseDeltaY: number } {
    const dx = this.mouseDeltaX
    const dy = this.mouseDeltaY
    this.mouseDeltaX = 0
    this.mouseDeltaY = 0
    return { mouseDeltaX: dx, mouseDeltaY: dy }
  }

  isPointerLocked(): boolean {
    return this.pointerLocked
  }

  private isDown(code: string): boolean {
    return this.keys.has(code)
  }

  private wasPressed(code: string): boolean {
    return this.keys.has(code) && !this.prevKeys.has(code)
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return
    this.keys.add(e.code)
    this.lastRaw = `key ${e.code}`
    if (e.code === 'KeyG' || e.code === 'KeyX' || e.code === 'KeyI') this.oneShots.add(e.code)
    if (GAME_KEYS.has(e.code)) {
      e.preventDefault()
    }
  }

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code)
  }

  private readonly onMouseMove = (e: MouseEvent): void => {
    if (!this.pointerLocked) return
    this.mouseDeltaX += e.movementX
    this.mouseDeltaY += e.movementY
  }

  private readonly onPointerLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.element
    this.lastRaw = this.pointerLocked ? 'pointer locked' : 'pointer unlocked'
  }

  private readonly requestPointerLock = (): void => {
    if (useGameStore.getState().phoneOpen) return
    if (!this.element || document.pointerLockElement === this.element) return
    void this.element.requestPointerLock()
  }

  private readonly blockMenu = (e: Event): void => {
    e.preventDefault()
  }

  private readonly onMouseDown = (e: MouseEvent): void => {
    const locked = document.pointerLockElement === this.element
    this.lastRaw = `mouse btn ${e.button} locked=${locked} ctrl=${e.ctrlKey}`
    if (e.button === 0 && locked) this.lockedClicks += 1
    if (e.button === 2) this.secondaryDown = true
  }

  private readonly onMouseUp = (e: MouseEvent): void => {
    if (e.button === 2) this.secondaryDown = false
  }
}
