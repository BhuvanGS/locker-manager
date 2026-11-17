import * as THREE from 'three'
import { InputManager, type InputSnapshotWithMouse } from './InputManager'
import { PhysicsWorld } from './PhysicsWorld'
import { Neighbourhood } from '../world/Neighbourhood'
import { PlayerController } from '../player/PlayerController'
import { FirstPersonCamera } from '../player/FirstPersonCamera'
import { GravelInteraction } from '../gravel/GravelInteraction'
import { useGameStore } from '../store/gameStore'
import { debugStep, isGameDebugEnabled, syncDebugPanel } from './debug'

export class Engine {
  private readonly canvas: HTMLCanvasElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly input = new InputManager()
  private readonly physics = new PhysicsWorld()
  private readonly cameraRig: FirstPersonCamera
  private player: PlayerController | null = null
  private world: Neighbourhood | null = null
  private gravelInteract: GravelInteraction | null = null
  private running = false
  private raf = 0
  private lastTime = 0
  private fpsAccum = 0
  private fpsFrames = 0
  private paused = false
  private lastLoggedRaw = ''
  private readonly worldSeed: number
  private readonly lastPos = new THREE.Vector3()
  private haveLastPos = false
  private prevPhase: 'menu' | 'playing' | 'paused' | 'won' | 'caught' = 'menu'
  private lastPicked = -1

  constructor(canvas: HTMLCanvasElement, worldSeed?: number) {
    this.canvas = canvas
    this.worldSeed = worldSeed ?? hashSeedFromUrl()
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    })
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0xcfe6f5)
    this.scene.fog = new THREE.Fog(0xcfe6f5, 60, 300)

    const aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1)
    this.cameraRig = new FirstPersonCamera(aspect)

    this.onResize = this.onResize.bind(this)
    window.addEventListener('resize', this.onResize)
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  async init(): Promise<void> {
    await this.physics.init()
    this.world = new Neighbourhood(this.scene, this.physics, this.worldSeed)
    this.player = new PlayerController(this.physics, this.world.playerSpawn)
    this.player.buildPhysics()
    this.cameraRig.lookToward(0, -6)
    this.gravelInteract = new GravelInteraction(this.world.gravel, this.scene)

    useGameStore.getState().setWorldMeta({
      gravelStoneCount: this.world.gravel.stoneCount,
    })
    if (isGameDebugEnabled()) {
      useGameStore.setState({ debugEnabled: true })
      debugStep('Engine.init — open with ?debug=1')
      // Debug-only handle for driving the game from the browser console or automation.
      ;(window as unknown as { __game?: unknown }).__game = {
        engine: this,
        look: (yaw: number, pitch: number) => this.cameraRig.handleMouseDelta(-yaw / 0.0022, -pitch / 0.0022),
        teleport: (x: number, z: number) => this.player?.teleport(x, z),
      }
    }
    this.onResize()
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.input.attach(this.canvas)
    this.lastTime = performance.now()
    this.raf = requestAnimationFrame(this.loop)
  }

  stop(): void {
    this.running = false
    cancelAnimationFrame(this.raf)
    this.input.detach()
  }

  dispose(): void {
    this.stop()
    window.removeEventListener('resize', this.onResize)
    this.gravelInteract?.dispose()
    this.player?.dispose(this.physics)
    this.world?.dispose()
    this.renderer.dispose()
    this.physics.dispose()
    this.player = null
    this.world = null
    this.gravelInteract = null
  }

  setPaused(value: boolean): void {
    this.paused = value
  }

  private readonly loop = (time: number): void => {
    if (!this.running) return
    this.raf = requestAnimationFrame(this.loop)
    const dt = Math.min((time - this.lastTime) / 1000, 0.05)
    this.lastTime = time

    if (!this.paused) {
      this.tick(dt)
    }

    this.renderer.render(this.scene, this.cameraRig.camera)
  }

  private tick(dt: number): void {
    const store = useGameStore.getState()
    this.input.beginFrame()
    const cameFromMenu = store.phase === 'playing' && this.prevPhase === 'menu'
    this.prevPhase = store.phase
    if (store.phase !== 'playing') return
    if (cameFromMenu && this.world) {
      this.world.resetWitness()
      this.haveLastPos = false
      this.lastPicked = -1
      store.setSuspicion(0, null)
      store.setPolice(false, 'none', null)
      store.setCaughtReason(null)
      store.setDialogue(null)
    }
    const input = this.input.snapshot() as InputSnapshotWithMouse

    if (input.pausePressed) {
      store.setPhoneOpen(false)
      store.setPhase('paused')
      void document.exitPointerLock()
      return
    }

    let phoneOpen = store.phoneOpen
    if (input.phonePressed) {
      phoneOpen = !phoneOpen
      store.setPhoneOpen(phoneOpen)
      if (phoneOpen) void document.exitPointerLock()
    }
    if (phoneOpen) return

    store.setPointerLocked(this.input.isPointerLocked())

    const player = this.player
    const world = this.world
    const gravel = this.gravelInteract
    if (!player || !world || !gravel) return

    const inspectTurn = gravel.isHoldingRock() && input.secondaryHeld
    if (this.input.isPointerLocked() && !inspectTurn) {
      this.cameraRig.handleMouseDelta(input.mouseDeltaX, input.mouseDeltaY)
    }

    player.update(input, this.cameraRig.getYaw(), dt, 0)

    this.physics.step(dt)
    player.syncFromPhysics()

    const pos = player.getPosition()
    world.update(dt)
    const eye = player.getEyePosition()
    this.cameraRig.update(eye)

    const onGravel = world.isOnGravel(pos)
    const atDoor = world.isAtDoor(pos)
    const gravelHud = gravel.update(
      dt,
      input,
      this.cameraRig.camera,
      pos,
      onGravel,
      player.isCrouching(),
      atDoor,
    )

    if (gravelHud.keyDiscovered) {
      store.setHasKey(true)
      store.setObjective('TAKE THE KEY TO THE FRONT DOOR')
      store.setStatusLine('The underside opened. The house key is yours.')
    }

    if (input.interactPressed && gravel.isHoldingRock() && !gravel.hasKey()) {
      const opened = gravel.tryOpenHeld()
      if (opened.kind === 'found-key') {
        store.setHasKey(true)
        store.setObjective('TAKE THE KEY TO THE FRONT DOOR')
        store.setStatusLine('The seam popped. A house key was inside.')
      } else if (opened.kind === 'solid') {
        store.setStatusLine('Solid stone. No compartment.')
      } else if (opened.kind === 'need-flip') {
        store.setStatusLine('Flip it with the right mouse until the underside shows.')
      }
    }

    if (atDoor && (input.primaryPressed || input.interactPressed)) {
      if (gravel.hasKey()) {
        world.unlockDoor()
        store.setStatusLine('The lock turns. You are in.')
        store.setObjective('INSIDE')
        store.setPhase('won')
        void document.exitPointerLock()
      } else {
        store.setStatusLine(
          gravel.isHoldingRock()
            ? 'Still locked. Flip the pink rock until it gives you the key, then click the door.'
            : 'Still locked. The key is inside the pink rock — pick it up and check the underside.',
        )
      }
    }

    store.setSearchStats({
      rocksInspected: gravelHud.rocksInspected,
      rocksPickedUp: gravelHud.rocksPickedUp,
      heldRockTitle: gravelHud.held?.title ?? null,
      heldRockDetail: gravelHud.held?.detail ?? null,
      heldRockMass: gravelHud.held?.massLabel ?? null,
      peekRockTitle: gravelHud.peek?.title ?? gravelHud.focus?.title ?? null,
      peekRockDetail: gravelHud.peek?.detail ?? gravelHud.focus?.detail ?? null,
      peekRockMass: gravelHud.peek?.massLabel ?? gravelHud.focus?.massLabel ?? null,
      inspectLabel: gravelHud.held
        ? 'In hand'
        : gravelHud.peek
          ? 'Inspecting'
          : gravelHud.focus
            ? 'Aimed at'
            : null,
    })

    let prompt = gravelHud.prompt
    if (atDoor && !gravel.isHoldingRock()) {
      prompt = gravel.hasKey()
        ? '[Left click] Unlock the front door'
        : '[Left click] Front door — locked'
    } else if (!onGravel && !gravelHud.held && !atDoor) {
      prompt = 'Walk onto the gravel lawn to search'
    }

    const speed = this.haveLastPos ? pos.distanceTo(this.lastPos) / Math.max(dt, 0.001) : 0
    this.lastPos.copy(pos)
    this.haveLastPos = true
    if (this.lastPicked < 0) this.lastPicked = gravelHud.rocksPickedUp
    const pickedRock = gravelHud.rocksPickedUp > this.lastPicked
    this.lastPicked = gravelHud.rocksPickedUp
    const notice = world.updateNeighbours(dt, {
      position: pos,
      crouching: player.isCrouching(),
      holdingRock: gravel.isHoldingRock(),
      onGravel,
      speed,
      pickedRock,
      greet: input.greetPressed,
      explain: input.explainPressed,
      hasKey: gravel.hasKey(),
    })
    if (notice.talkPrompt && !atDoor) prompt = notice.talkPrompt
    store.setLocation(world.locationLabel(pos))
    store.setInteractionPrompt(prompt)
    store.setDialogue(notice.dialogue)
    store.setSuspicion(notice.suspicion, notice.alertName)
    if (notice.copsCalled && !store.copsCalled) {
      store.setStatusLine('A neighbour called the police. Talk to the officer when they arrive.')
    }
    store.setPolice(notice.copsCalled, notice.copState, notice.copTimer)
    if (notice.busted && store.phase === 'playing') {
      store.setCaughtReason(notice.bustReason)
      store.setStatusLine('The officer arrested you.')
      store.setPhase('caught')
      void document.exitPointerLock()
    }

    if (isGameDebugEnabled()) {
      syncDebugPanel(gravel.getDebugSnapshot())
      const raw = this.input.lastRawInput()
      if (raw !== this.lastLoggedRaw && raw !== 'none') {
        this.lastLoggedRaw = raw
        debugStep(`raw input: ${raw}`)
      }
    }

    this.fpsFrames++
    this.fpsAccum += dt
    if (this.fpsAccum >= 0.5) {
      store.setFps(Math.round(this.fpsFrames / this.fpsAccum))
      this.fpsFrames = 0
      this.fpsAccum = 0
    }
  }

  private onResize(): void {
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    if (w === 0 || h === 0) return
    this.renderer.setSize(w, h, false)
    this.cameraRig.resize(w / h)
  }
}

function hashSeedFromUrl(): number {
  const param = new URLSearchParams(window.location.search).get('seed')
  if (param) {
    const n = Number.parseInt(param, 10)
    if (Number.isFinite(n)) return n >>> 0
  }
  return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0
}