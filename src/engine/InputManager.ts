export type InputSnapshot = {
  forward: number
  right: number
  sprint: boolean
  crouch: boolean
  /** E or left click (while the mouse is captured). */
  interactPressed: boolean
  /** Number key 1–6 pressed this frame (dialogue choice), or null. */
  choice: number | null
  pausePressed: boolean
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
  'ShiftLeft',
  'ShiftRight',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Escape',
  'Digit1',
  'Digit2',
  'Digit3',
  'Digit4',
  'Digit5',
  'Digit6',
])

/** Keyboard + pointer-lock mouse. Presses are latched so a tap between frames is never lost. */
export class InputManager {
  private readonly keys = new Set<string>()
  private readonly pressed = new Set<string>()
  private mouseDeltaX = 0
  private mouseDeltaY = 0
  private clicks = 0
  private element: HTMLElement | null = null
  private pointerLocked = false

  attach(element: HTMLElement): void {
    if (this.element) return
    this.element = element
    window.addEventListener('keydown', this.onKeyDown, true)
    window.addEventListener('keyup', this.onKeyUp, true)
    window.addEventListener('mousemove', this.onMouseMove, true)
    window.addEventListener('mousedown', this.onMouseDown, true)
    window.addEventListener('blur', this.onBlur)
    document.addEventListener('pointerlockchange', this.onPointerLockChange)
    element.addEventListener('click', this.requestPointerLock)
  }

  detach(): void {
    if (!this.element) return
    window.removeEventListener('keydown', this.onKeyDown, true)
    window.removeEventListener('keyup', this.onKeyUp, true)
    window.removeEventListener('mousemove', this.onMouseMove, true)
    window.removeEventListener('mousedown', this.onMouseDown, true)
    window.removeEventListener('blur', this.onBlur)
    document.removeEventListener('pointerlockchange', this.onPointerLockChange)
    this.element.removeEventListener('click', this.requestPointerLock)
    if (document.pointerLockElement === this.element) document.exitPointerLock()
    this.element = null
  }

  /** Read and clear this frame's input. */
  snapshot(): InputSnapshot {
    const down = (code: string) => this.keys.has(code)
    const hit = (code: string) => this.pressed.has(code)
    let choice: number | null = null
    for (let n = 1; n <= 6; n++) if (hit(`Digit${n}`)) choice = n
    const snap: InputSnapshot = {
      forward: (down('KeyW') || down('ArrowUp') ? 1 : 0) - (down('KeyS') || down('ArrowDown') ? 1 : 0),
      right: (down('KeyD') || down('ArrowRight') ? 1 : 0) - (down('KeyA') || down('ArrowLeft') ? 1 : 0),
      sprint: down('ShiftLeft') || down('ShiftRight'),
      crouch: down('KeyC'),
      interactPressed: hit('KeyE') || this.clicks > 0,
      choice,
      pausePressed: hit('Escape'),
      mouseDeltaX: this.mouseDeltaX,
      mouseDeltaY: this.mouseDeltaY,
    }
    this.pressed.clear()
    this.clicks = 0
    this.mouseDeltaX = 0
    this.mouseDeltaY = 0
    return snap
  }

  isPointerLocked(): boolean {
    return this.pointerLocked
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (GAME_KEYS.has(e.code)) e.preventDefault()
    if (e.repeat) return
    this.keys.add(e.code)
    this.pressed.add(e.code)
  }

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code)
  }

  private readonly onBlur = (): void => {
    this.keys.clear()
  }

  private readonly onMouseMove = (e: MouseEvent): void => {
    if (!this.pointerLocked) return
    this.mouseDeltaX += e.movementX
    this.mouseDeltaY += e.movementY
  }

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (e.button === 0 && this.pointerLocked) this.clicks += 1
  }

  private readonly onPointerLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.element
  }

  private readonly requestPointerLock = (): void => {
    if (!this.element || document.pointerLockElement === this.element) return
    this.element.requestPointerLock()?.catch(() => {
      /* pointer lock can be refused (e.g. automation); the game still works with the keyboard */
    })
  }
}
