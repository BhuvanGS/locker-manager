import * as THREE from 'three'
import { FirstPersonCamera } from '../player/FirstPersonCamera'
import { PlayerController } from '../player/PlayerController'
import { GameManager } from '../sim/GameManager'
import type { ActionResult } from '../sim/types'
import { useGameStore, type DialogueView } from '../store/gameStore'
import { CustomerAgents } from '../world/CustomerAgents'
import { Facility } from '../world/Facility'
import { HeldView } from '../world/HeldView'
import { InteractionManager } from '../world/InteractionManager'
import { KeyBoard } from '../world/KeyBoard'
import { LockerWall } from '../world/LockerWall'
import { PLAYER_SPAWN, REACH } from '../world/layout'
import { isDebugEnabled } from './debug'
import { InputManager } from './InputManager'
import { PhysicsWorld } from './PhysicsWorld'

/**
 * Owns the renderer and the main loop, and wires the simulation (src/sim) to the 3D views (src/world)
 * and the HUD (store). Frame order: input → player → physics → sim → views → interaction → HUD.
 */
export class Engine {
  private readonly canvas: HTMLCanvasElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly input = new InputManager()
  private readonly physics = new PhysicsWorld()
  private readonly cameraRig: FirstPersonCamera
  private game = new GameManager(seedFromUrl())
  private player: PlayerController | null = null
  private facility: Facility | null = null
  private lockerWall: LockerWall | null = null
  private keyBoard: KeyBoard | null = null
  private readonly agents = new CustomerAgents()
  private readonly held = new HeldView()
  private interaction: InteractionManager | null = null
  private running = false
  private raf = 0
  private lastTime = 0
  private fpsTime = 0
  private fpsFrames = 0
  private dialogueSig = ''
  private dialogueView: DialogueView | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.scene.background = new THREE.Color(0xa9cde8)
    this.scene.fog = new THREE.Fog(0xa9cde8, 30, 90)
    this.cameraRig = new FirstPersonCamera(canvas.clientWidth / Math.max(canvas.clientHeight, 1))
    window.addEventListener('resize', this.onResize)
  }

  async init(): Promise<void> {
    await this.physics.init()
    this.facility = new Facility(this.physics)
    this.lockerWall = new LockerWall(this.game, this.physics)
    this.keyBoard = new KeyBoard(this.game.keys.hookCount)
    this.scene.add(this.facility.root, this.lockerWall.root, this.keyBoard.root, this.agents.root, this.held.root)
    this.interaction = new InteractionManager([this.facility.root, this.lockerWall.root, this.keyBoard.root, this.agents.root])
    this.player = new PlayerController(this.physics, PLAYER_SPAWN)
    this.player.buildPhysics()
    this.cameraRig.lookToward(0, 6, PLAYER_SPAWN.x, PLAYER_SPAWN.z)
    if (isDebugEnabled()) this.exposeDebugHandle()
    this.onResize()
    this.syncHud(0)
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.input.attach(this.canvas)
    this.lastTime = performance.now()
    this.raf = requestAnimationFrame(this.loop)
  }

  dispose(): void {
    this.running = false
    cancelAnimationFrame(this.raf)
    this.input.detach()
    window.removeEventListener('resize', this.onResize)
    this.player?.dispose(this.physics)
    this.renderer.dispose()
    this.physics.dispose()
  }

  /** Throw away the simulation and start over (the static building is reused). */
  newGame(): void {
    this.game = new GameManager(seedFromUrl())
    this.agents.clear()
    this.player?.teleport(PLAYER_SPAWN.x, PLAYER_SPAWN.z)
    this.cameraRig.lookToward(0, 6, PLAYER_SPAWN.x, PLAYER_SPAWN.z)
    this.dialogueSig = ''
    useGameStore.setState({ toasts: [], dialogue: null, tutorialComplete: false })
  }

  private readonly loop = (time: number): void => {
    if (!this.running) return
    this.raf = requestAnimationFrame(this.loop)
    const dt = Math.min((time - this.lastTime) / 1000, 0.05)
    this.lastTime = time
    this.tick(dt)
    this.renderer.render(this.scene, this.cameraRig.camera)
  }

  private tick(dt: number): void {
    const store = useGameStore.getState()
    if (store.newGameRequested) {
      this.newGame()
      store.patch({ newGameRequested: false })
    }
    const input = this.input.snapshot()
    const player = this.player
    if (!player || !this.facility || !this.lockerWall || !this.keyBoard || !this.interaction) return
    const playing = store.phase === 'playing'

    if (playing && input.pausePressed) {
      store.setPhase('paused')
      if (document.pointerLockElement) document.exitPointerLock()
      return
    }

    // Player and camera.
    if (playing) {
      this.cameraRig.handleMouseDelta(input.mouseDeltaX, input.mouseDeltaY)
      player.update(input, this.cameraRig.getYaw(), dt)
      this.physics.step(dt)
      player.syncFromPhysics()
    }
    this.cameraRig.update(player.getEyePosition())
    const camera = this.cameraRig.camera
    const playerPos = player.getPosition()

    // Simulation only advances while playing (pausing stops the clock).
    if (playing) this.game.update(dt)
    for (const notice of this.game.drainNotices()) {
      if (notice.type === 'customerSpawned') this.agents.spawn(this.game, notice.customerId)
      else if (notice.type === 'customerLeaving') this.agents.leave(notice.customerId)
      else if (notice.type === 'payment') store.pushToast(`+$${notice.amount}`, 'good')
      else if (notice.type === 'xp') store.pushToast(`+${notice.amount} XP`, 'info')
      else if (notice.type === 'mistake') store.pushToast(notice.message, 'bad')
      else store.pushToast(notice.text, 'info')
    }

    // Views.
    this.agents.update(playing ? dt : 0, this.game, playerPos)
    this.facility.update(dt, this.agents.nearDoor() || (Math.abs(playerPos.x) < 1.8 && Math.abs(playerPos.z - 6.1) < 2))
    this.lockerWall.update(dt, this.game)
    this.keyBoard.update(this.game)
    this.held.update(dt, camera, this.game, input.forward !== 0 || input.right !== 0)

    // Interaction.
    let aim = null
    if (playing) {
      aim = this.interaction.aim(camera, this.game)
      if (input.interactPressed && aim) this.report(this.interaction.perform(aim, this.game))
      this.handleDialogueInput(input.choice, playerPos)
    }

    this.syncHud(dt, aim)
  }

  private handleDialogueInput(choice: number | null, playerPos: THREE.Vector3): void {
    const store = useGameStore.getState()
    const d = this.game.dialogue
    if (!d) {
      if (store.pendingChoice) store.patch({ pendingChoice: null })
      return
    }
    // Walking away ends the conversation.
    const at = this.agents.position(d.customerId)
    if (!at || Math.hypot(at.x - playerPos.x, at.z - playerPos.z) > REACH.customer + 0.6) {
      this.game.closeDialogue()
      return
    }
    const options = this.game.dialogueOptions()
    let pick = store.pendingChoice
    if (pick) store.patch({ pendingChoice: null })
    if (!pick && choice !== null) pick = options[choice - 1]?.id ?? null
    if (pick) this.report(this.game.choose(pick))
  }

  private report(result: ActionResult | null): void {
    if (!result?.message) return
    useGameStore.getState().pushToast(result.message, result.ok ? 'info' : 'bad')
  }

  private syncHud(dt: number, aim: { action: string | null; hint: string | null } | null = null): void {
    const game = this.game
    const level = game.economy.level
    const hands = game.hands
    const holding = !hands
      ? null
      : hands.kind === 'key'
        ? 'A locker key'
        : game.customers.item(hands.itemId).label

    // Dialogue view: rebuild only when it changes so React does not re-render every frame.
    let dialogue: DialogueView | null = null
    if (game.dialogue) {
      const c = game.customers.get(game.dialogue.customerId)
      dialogue = {
        speaker: c.visit.askedName ? c.name : 'Customer',
        lines: game.dialogue.lines,
        options: game.dialogueOptions().map((o) => ({ id: o.id, label: o.label, disabled: o.disabled })),
      }
    }
    const sig = dialogue ? JSON.stringify(dialogue) : ''
    if (sig !== this.dialogueSig) {
      this.dialogueSig = sig
      this.dialogueView = dialogue ? structuredClone(dialogue) : null
    }

    this.fpsFrames++
    this.fpsTime += dt
    let fps = useGameStore.getState().fps
    if (this.fpsTime >= 0.5) {
      fps = Math.round(this.fpsFrames / this.fpsTime)
      this.fpsFrames = 0
      this.fpsTime = 0
    }

    useGameStore.getState().patch({
      pointerLocked: this.input.isPointerLocked(),
      fps,
      money: game.economy.money,
      level: level.level,
      xpInto: level.into,
      xpNeeded: level.needed,
      reputation: game.economy.reputation,
      served: game.economy.served,
      mistakes: game.economy.mistakes,
      lockersFree: game.lockers.availableCount,
      lockersTotal: game.lockers.total,
      activeDeposits: game.activeDeposits(),
      queue: game.queue().length,
      objective: game.objective(),
      tutorialComplete: game.tutorialComplete,
      prompt: game.dialogue ? null : (aim?.action ?? null),
      promptHint: game.dialogue ? null : (aim?.hint ?? null),
      holding,
      dialogue: this.dialogueView,
    })
  }

  private readonly onResize = (): void => {
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    if (w === 0 || h === 0) return
    this.renderer.setSize(w, h, false)
    this.cameraRig.resize(w / h)
  }

  /** `window.__game` for automation and the console. Only with ?debug=1. */
  private exposeDebugHandle(): void {
    ;(window as unknown as { __game?: unknown }).__game = {
      engine: this,
      /** The live GameManager (replaced on New game, so call it each time). */
      sim: () => this.game,
      teleport: (x: number, z: number) => this.player?.teleport(x, z),
      look: (yaw: number, pitch: number) => this.cameraRig.turn(yaw, pitch),
      face: (x: number, z: number) => {
        const p = this.player?.getPosition()
        if (p) this.cameraRig.lookToward(x, z, p.x, p.z)
      },
      /** Fast-forward game time only (e.g. skip the two-minute wait). Views catch up next frame. */
      skip: (seconds: number) => this.game.update(seconds),
      /**
       * Run real engine frames synchronously at 30 fps for `seconds` (walking, sim, views, HUD) and
       * render once. Works even when the tab is hidden and requestAnimationFrame is paused.
       */
      advance: (seconds: number) => {
        const steps = Math.max(1, Math.round(seconds * 30))
        for (let i = 0; i < steps; i++) this.tick(1 / 30)
        this.renderer.render(this.scene, this.cameraRig.camera)
      },
      interact: () => {
        const aim = this.interaction?.aim(this.cameraRig.camera, this.game)
        const result = aim ? this.interaction?.perform(aim, this.game) : null
        this.report(result ?? null)
        return { aim, result }
      },
    }
  }
}

function seedFromUrl(): number {
  const param = new URLSearchParams(window.location.search).get('seed')
  const n = param ? Number.parseInt(param, 10) : Number.NaN
  return Number.isFinite(n) ? n >>> 0 : (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0
}
