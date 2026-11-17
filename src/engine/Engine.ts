import * as THREE from 'three'
import { FirstPersonCamera } from '../player/FirstPersonCamera'
import { PlayerController } from '../player/PlayerController'
import { GameManager } from '../sim/GameManager'
import type { ActionResult, DialogueOptionId } from '../sim/types'
import { CONFIG, ZONE_TITLES, type AutoZone } from '../sim/config'
import { applyMod, modInfo } from '../sim/mods'
import { useGameStore, type CatalogueView, type ConsoleView, type DialogueView, type TerminalView } from '../store/gameStore'
import { AutomationConsole } from '../world/AutomationConsole'
import { ConveyorBay } from '../world/ConveyorBay'
import { CustomerAgents } from '../world/CustomerAgents'
import { Annex, type AnnexSide } from '../world/Annex'
import { Facility } from '../world/Facility'
import { Hall, HALL_LEVEL, type HallKind } from '../world/Hall'
import { HeldView } from '../world/HeldView'
import { InteractionManager } from '../world/InteractionManager'
import { KeyRack } from '../world/KeyBoard'
import { LockerWall, type BankPlacement } from '../world/LockerWall'
import { RegisterBoard } from '../world/RegisterBoard'
import { Stairs } from '../world/Stairs'
import { StationView } from '../world/StationView'
import { StatusScreen } from '../world/StatusScreen'
import {
  ADJACENT_ZONES,
  ANNEX,
  ANNEX_RACK,
  CONSOLES,
  FLOOR_HEIGHT,
  LOCKER,
  LOCKER_BANKS,
  PLAYER_SPAWN,
  REACH,
  SOUTH,
  STATION,
  zoneAt,
  type Zone,
} from '../world/layout'
import { isDebugEnabled } from './debug'
import { InputManager, type InputSnapshot } from './InputManager'
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
  /** One wall per locker bank (bank 0 at the start, more as storage upgrades are bought). */
  private lockerWalls: LockerWall[] = []
  /** One rack per set of key hooks. */
  private keyRacks: KeyRack[] = []
  /** Storage annexes built into the units next door (building expansion). */
  private annexes: Annex[] = []
  /** The south expansion and the floors above it, and the stairs between them. */
  private halls: Hall[] = []
  private stairs: Stairs[] = []
  /** The deposit register board, once bought. */
  private registerBoard: RegisterBoard | null = null
  /** Digital lockers: one status screen per bank (they replace the key racks). */
  private statusScreens = new Map<number, StatusScreen>()
  /** Where each bank stands and which part of the building it is in, so a screen can be added to it later. */
  private readonly bankSpots = new Map<number, { placement: BankPlacement; zone: Zone }>()
  /** The conveyor belts, robot arm and terminal, once bought. */
  private conveyorBay: ConveyorBay | null = null
  /** The robot-arm stations of the halls the belts have been extended to (the storage room's is inside the bay). */
  private stations: StationView[] = []
  /** Upgrade consoles by scope (`hub`, or a zone). */
  private consoles = new Map<string, AutomationConsole>()
  /** Everything the crosshair can hit; extended when upgrades add walls and racks. */
  private readonly interactionTargets: THREE.Object3D[] = []
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
  /** Highlighted dialogue option; reset to the recommended one whenever the conversation changes. */
  private dialogueIndex = 0
  private catalogueSig = ''
  private catalogueView: CatalogueView | null = null
  private catalogueIndex = 0
  private consoleSig = ''
  private consoleView: ConsoleView | null = null
  private consoleIndex = 0
  private terminalSig = ''
  private terminalView: TerminalView | null = null
  private terminalIndex = 0
  private modSig = ''
  private modView: ReturnType<typeof modInfo> | null = null
  /** Whether the mod menu was open last frame (to release / regain the mouse on the change). */
  private modWasOpen = false
  /** Debug only: forced walking input, so automation can walk through doors. */
  private debugWalk: { forward: number; right: number } | null = null

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
    this.scene.add(this.facility.root, this.agents.root, this.held.root)
    this.interactionTargets.push(this.facility.root, this.agents.root)
    this.buildStartingFurniture()
    this.interaction = new InteractionManager(this.interactionTargets)
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

  /** The locker bank and key rack every game starts with. */
  private buildStartingFurniture(): void {
    this.addLockerBank(0, false)
    this.addKeyRack(0, false)
  }

  private addLockerBank(
    bank: number,
    animate: boolean,
    placement: BankPlacement = { centerX: LOCKER_BANKS[bank]?.centerX ?? 0, frontZ: LOCKER.frontZ, floorY: 0 },
    zone: Zone = 'main',
  ): void {
    const wall = new LockerWall(this.game, this.physics, bank, placement)
    wall.root.userData.zone = zone
    if (animate) wall.appear()
    this.lockerWalls.push(wall)
    this.scene.add(wall.root)
    this.interactionTargets.push(wall.root)
    this.bankSpots.set(bank, { placement, zone })
    if (this.game.isDigital) this.addStatusScreen(bank, animate)
  }

  /** A status screen on top of a bank (digital lockers). One per bank. */
  private addStatusScreen(bank: number, animate: boolean): void {
    const spot = this.bankSpots.get(bank)
    if (!spot || this.statusScreens.has(bank)) return
    const rows = Math.max(...this.game.lockers.all().filter((l) => l.bank === bank).map((l) => l.row)) + 1
    const screen = new StatusScreen(bank, spot.placement, rows)
    screen.root.userData.zone = spot.zone
    if (animate) screen.appear()
    this.statusScreens.set(bank, screen)
    this.scene.add(screen.root)
  }

  /** The keys are gone: take the key racks down (and the sign) and put a status screen on every bank. */
  private goDigital(): void {
    for (const rack of this.keyRacks) this.discard(rack.root)
    this.keyRacks = []
    this.facility?.setKeysSignVisible(false)
    for (const bank of this.bankSpots.keys()) this.addStatusScreen(bank, true)
  }

  /** Cut the hatch through the partition and install the belts, the robot arm and the terminal. */
  private addConveyor(animate: boolean): void {
    if (this.conveyorBay) return
    this.facility?.setConveyorOpen(true)
    const bay = new ConveyorBay(this.physics, (id) => this.lockerSlotWorld(id))
    if (animate) bay.appear()
    this.conveyorBay = bay
    this.scene.add(bay.root)
    this.interactionTargets.push(bay.root)
    this.addConsole('hub', CONSOLES.hub.x, 0, CONSOLES.hub.z, 'main')
    this.addConsole('main', CONSOLES.main.x, 0, CONSOLES.main.z, 'main')
  }

  /** The world position of the opening of a locker: x, the middle of the opening, and where a bag sits. */
  private lockerSlotWorld(lockerId: string): { x: number; y: number; z: number } {
    const locker = this.game.lockers.get(lockerId)
    const spot = this.bankSpots.get(locker.bank)
    const pitch = LOCKER.width + LOCKER.gap
    const { centerX, frontZ, floorY } = spot?.placement ?? { centerX: 0, frontZ: LOCKER.frontZ, floorY: 0 }
    return {
      x: centerX + (locker.col - 1) * pitch,
      y: floorY + LOCKER.baseY + locker.row * pitch + LOCKER.height / 2,
      z: frontZ - LOCKER.depth / 2,
    }
  }

  private addConsole(scope: 'hub' | AutoZone, x: number, floorY: number, z: number, zone: AutoZone): void {
    if (this.consoles.has(scope)) return
    const console = new AutomationConsole(scope, x, floorY, z, zone, this.physics)
    this.consoles.set(scope, console)
    this.scene.add(console.root)
    this.interactionTargets.push(console.root)
  }

  /** Extend the belts to a hall: its arms (with the bay and ducts in the tall halls) and its console. */
  private addLine(zone: AutoZone): void {
    if (zone === 'main' || this.stations.some((s) => s.opts.zone === zone)) return
    // The rows of lockers in this zone: its banks grouped by the row their lockers are in.
    const rows = new Map<number, { row: number; frontZ: number; floorY: number }>()
    for (const [bank, spot] of this.bankSpots) {
      if (spot.zone !== zone) continue
      const first = this.game.lockers.all().find((l) => l.bank === bank)
      if (!first) continue
      const row = this.game.rowOf(first.id)
      if (!rows.has(row)) rows.set(row, { row, frontZ: spot.placement.frontZ, floorY: spot.placement.floorY })
    }
    const list = [...rows.values()].sort((a, b) => a.row - b.row)
    const east = zone === 'east'
    const floorY = list[0]?.floorY ?? 0
    const station = new StationView({
      zone,
      floorY,
      rows: list.map(({ row, frontZ }) => ({ row, frontZ })),
      minX: east ? STATION.extent.east[0] : STATION.extent.hall[0],
      maxX: east ? STATION.extent.east[1] : STATION.extent.hall[1],
      dock: east ? 'tube' : 'bay',
      tubeX: east ? STATION.tubes.east : undefined,
      locate: (id) => this.lockerSlotWorld(id),
      physics: this.physics,
    })
    this.stations.push(station)
    this.scene.add(station.root)
    this.interactionTargets.push(station.root)
    const spot = east ? CONSOLES.east : CONSOLES.hall
    this.addConsole(zone, spot.x, floorY, spot.z, zone)
  }

  private addRegisterBoard(animate: boolean): void {
    if (this.registerBoard) return
    const board = new RegisterBoard()
    if (animate) board.appear()
    this.registerBoard = board
    this.scene.add(board.root)
  }

  /** Knock through into the next unit: open the doorway, raise the hall, and fit its banks and racks. */
  private addAnnex(side: AnnexSide, banks: number[], racks: number[]): void {
    this.facility?.setAnnexOpen(side, true)
    const annex = new Annex(side, this.physics)
    annex.appear()
    this.annexes.push(annex)
    this.scene.add(annex.root)
    this.interactionTargets.push(annex.root)
    annex.root.userData.zone = side
    banks.forEach((bank, i) => this.addLockerBank(bank, true, { centerX: ANNEX[side].bankX[i] ?? 0, frontZ: LOCKER.frontZ, floorY: 0 }, side))
    racks.forEach((rack, i) => this.addKeyRack(rack, true, { x: ANNEX[side].rackX[i] ?? 0, z: ANNEX_RACK.z, rotY: ANNEX_RACK.rotY }, side))
  }

  /**
   * Build the south expansion or a floor above it. The south hall is entered through a doorway cut in the old back wall;
   * a floor is reached by stairs through a hatch in the ceiling of the hall below. Lockers stand in rows (two rows of three
   * banks) and the key racks hang along the north wall.
   */
  private addHall(kind: HallKind, banks: number[], racks: number[]): void {
    const level = HALL_LEVEL[kind]
    const floorY = level * FLOOR_HEIGHT
    if (kind === 'south') {
      this.facility?.setSouthOpen(true)
    } else {
      this.halls.find((h) => h.level === level - 1)?.openHatch()
      const stairs = new Stairs((level - 1) as 0 | 1, this.physics)
      stairs.appear()
      this.stairs.push(stairs)
      this.scene.add(stairs.root)
      this.interactionTargets.push(stairs.root)
    }
    const hall = new Hall(kind, this.physics)
    hall.appear()
    this.halls.push(hall)
    this.scene.add(hall.root)
    this.interactionTargets.push(hall.root)
    banks.forEach((bank, i) => {
      const placement = { centerX: SOUTH.bankX[i % 3] ?? 0, frontZ: SOUTH.rowFrontZ[Math.floor(i / 3)] ?? LOCKER.frontZ, floorY }
      this.addLockerBank(bank, true, placement, kind)
    })
    racks.forEach((rack, i) => {
      this.addKeyRack(rack, true, { x: SOUTH.rackX[i] ?? 0, y: floorY + 1.45, z: SOUTH.rackZ, rotY: Math.PI }, kind)
    })
  }

  /**
   * Only draw the part of the building you are in and the parts you can see into (through doorways and stairwells).
   * Locker banks are hundreds of small meshes, so hiding the rest keeps the frame rate up in a big building.
   */
  private applyZoneVisibility(playerPos: THREE.Vector3): void {
    const zone = zoneAt(playerPos.x, playerPos.z, playerPos.y - 0.9)
    const visible = new Set<Zone>([zone, ...ADJACENT_ZONES[zone]])
    const show = (root: THREE.Object3D) => {
      const z = root.userData.zone as Zone | undefined
      root.visible = z === undefined || visible.has(z)
    }
    for (const wall of this.lockerWalls) show(wall.root)
    for (const rack of this.keyRacks) show(rack.root)
    for (const screen of this.statusScreens.values()) show(screen.root)
    if (this.conveyorBay) show(this.conveyorBay.root)
    for (const station of this.stations) show(station.root)
    for (const console of this.consoles.values()) show(console.root)
    for (const annex of this.annexes) show(annex.root)
    for (const hall of this.halls) show(hall.root)
    for (const flight of this.stairs) show(flight.root)
  }

  private addKeyRack(
    index: number,
    animate: boolean,
    placement?: { x: number; y?: number; z: number; rotY: number },
    zone: Zone = 'main',
  ): void {
    if (this.game.isDigital) return // no keys any more: nothing to hang on a rack
    const rack = new KeyRack(index, CONFIG.facility.hooksPerRack, placement)
    rack.root.userData.zone = zone
    if (animate) rack.appear()
    this.keyRacks.push(rack)
    this.scene.add(rack.root)
    this.interactionTargets.push(rack.root)
  }

  /** Remove every locker bank and key rack (a new game starts from one of each). */
  private removeBuiltFurniture(): void {
    for (const wall of this.lockerWalls) {
      this.discard(wall.root)
      wall.dispose(this.physics)
    }
    for (const rack of this.keyRacks) this.discard(rack.root)
    for (const screen of this.statusScreens.values()) this.discard(screen.root)
    this.statusScreens.clear()
    this.bankSpots.clear()
    if (this.conveyorBay) {
      this.discard(this.conveyorBay.root)
      this.conveyorBay.dispose()
      this.conveyorBay = null
    }
    for (const station of this.stations) {
      this.discard(station.root)
      station.dispose()
    }
    this.stations = []
    for (const console of this.consoles.values()) {
      this.discard(console.root)
      console.dispose()
    }
    this.consoles.clear()
    this.facility?.setConveyorOpen(false)
    this.facility?.setKeysSignVisible(true)
    if (this.registerBoard) {
      this.discard(this.registerBoard.root)
      this.registerBoard = null
    }
    for (const annex of this.annexes) {
      this.discard(annex.root)
      annex.dispose()
      this.facility?.setAnnexOpen(annex.side, false)
    }
    this.annexes = []
    for (const hall of this.halls) {
      this.discard(hall.root)
      hall.dispose()
    }
    for (const flight of this.stairs) {
      this.discard(flight.root)
      flight.dispose()
    }
    this.halls = []
    this.stairs = []
    this.facility?.setSouthOpen(false)
    this.lockerWalls = []
    this.keyRacks = []
  }

  private discard(root: THREE.Object3D): void {
    this.scene.remove(root)
    const at = this.interactionTargets.indexOf(root)
    if (at >= 0) this.interactionTargets.splice(at, 1)
    root.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) (o as THREE.Mesh).geometry?.dispose()
    })
  }

  /** Throw away the simulation and start over (the static building is reused). */
  newGame(): void {
    this.removeBuiltFurniture()
    this.game = new GameManager(seedFromUrl())
    this.buildStartingFurniture()
    this.agents.clear()
    this.player?.teleport(PLAYER_SPAWN.x, PLAYER_SPAWN.z)
    this.cameraRig.lookToward(0, 6, PLAYER_SPAWN.x, PLAYER_SPAWN.z)
    this.dialogueSig = ''
    this.catalogueSig = ''
    this.catalogueView = null
    this.terminalSig = ''
    this.terminalView = null
    this.consoleSig = ''
    this.consoleView = null
    this.modSig = ''
    this.modView = null
    useGameStore.setState({ toasts: [], dialogue: null, catalogue: null, terminal: null, console: null, banner: null, modOpen: false, modInfo: null, modRequests: [] })
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
    if (this.debugWalk) {
      input.forward = this.debugWalk.forward
      input.right = this.debugWalk.right
    }
    const player = this.player
    if (!player || !this.facility || !this.interaction) return

    // Mod menu: M (or `) toggles it, Esc closes it instead of pausing, and it hands the mouse back while open.
    const modsOn = CONFIG.modMenu.enabled
    let modOpen = modsOn && store.modOpen && store.phase === 'playing'
    let pausePressed = input.pausePressed
    if (modsOn && store.phase === 'playing') {
      if (input.modPressed) modOpen = !modOpen
      else if (modOpen && pausePressed) {
        modOpen = false
        pausePressed = false
      }
    }
    if (modOpen !== store.modOpen) store.patch({ modOpen })
    if (modOpen !== this.modWasOpen) {
      this.modWasOpen = modOpen
      if (modOpen) {
        if (document.pointerLockElement) document.exitPointerLock()
      } else {
        this.canvas.requestPointerLock()?.catch(() => {})
      }
    }
    if (modsOn && store.modRequests.length > 0) {
      const requests = store.modRequests
      store.patch({ modRequests: [] })
      for (const request of requests) this.report(applyMod(this.game, request))
    }
    // While the menu is open the shop can be frozen so there is time to click around.
    const playing = store.phase === 'playing' && !(modOpen && store.modPause)

    if (playing && pausePressed) {
      store.setPhase('paused')
      if (document.pointerLockElement) document.exitPointerLock()
      return
    }

    // Player and camera. While you are talking or browsing the catalogue you stand still
    // (W/S/arrows choose answers instead).
    const talking = this.game.dialogue !== null || this.game.catalogueOpen || this.game.terminalOpen || this.game.consoleScope !== null || modOpen
    if (playing) {
      this.cameraRig.handleMouseDelta(input.mouseDeltaX, input.mouseDeltaY)
      player.update(talking ? { ...input, forward: 0, right: 0, sprint: false, jumpPressed: false } : input, this.cameraRig.getYaw(), dt)
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
      // Mistakes are already toasted from the action's own result message, so only walk-outs need one here.
      else if (notice.type === 'mistake') continue
      else if (notice.type === 'walkout') store.pushToast(notice.message, 'bad')
      else if (notice.type === 'stageStarted') store.showBanner(notice.title, notice.text)
      else if (notice.type === 'levelUp') {
        const unlocked = notice.unlocked.length > 0 ? `New in the catalogue: ${notice.unlocked.join(', ')}.` : 'Customers will arrive a little faster.'
        store.showBanner(`Level ${notice.level}`, `+$${notice.bonus} bonus. ${unlocked}`, 'Level up')
      } else if (notice.type === 'upgradeBought') {
        if (notice.kind === 'lockerBank') this.addLockerBank(notice.index, true)
        else if (notice.kind === 'keyRack') this.addKeyRack(notice.index, true)
        else if (notice.kind === 'register') this.addRegisterBoard(true)
        else if (notice.kind === 'digital') this.goDigital()
        else if (notice.kind === 'conveyor') this.addConveyor(true)
        else if (notice.kind === 'automation' && notice.id.startsWith('line-') && notice.zone) this.addLine(notice.zone)
        else if (notice.kind === 'annex' && notice.side) this.addAnnex(notice.side, notice.banks ?? [], notice.racks ?? [])
        else if (notice.kind === 'hall' && notice.hall) this.addHall(notice.hall, notice.banks ?? [], notice.racks ?? [])
        // 'labels' needs no new objects: the lockers, racks and held key notice `game.hasLabels` themselves.
      } else store.pushToast(notice.text, 'info')
    }

    // Views.
    this.agents.update(playing ? dt : 0, this.game, playerPos, camera)
    this.facility.update(dt, this.agents.nearDoor() || (Math.abs(playerPos.x) < 1.8 && Math.abs(playerPos.z - 6.1) < 2))
    for (const wall of this.lockerWalls) wall.update(dt, this.game)
    for (const rack of this.keyRacks) rack.update(dt, this.game)
    for (const screen of this.statusScreens.values()) screen.update(dt, this.game)
    this.conveyorBay?.update(dt, this.game)
    for (const station of this.stations) station.update(dt, this.game)
    for (const console of this.consoles.values()) console.update(this.game)
    this.registerBoard?.update(dt, this.game)
    for (const annex of this.annexes) annex.update(dt)
    for (const hall of this.halls) hall.update(dt)
    for (const flight of this.stairs) flight.update(dt)
    this.applyZoneVisibility(playerPos)
    this.held.update(dt, camera, this.game, !talking && (input.forward !== 0 || input.right !== 0))

    // Interaction.
    let aim = null
    if (playing && !modOpen) {
      aim = this.interaction.aim(camera, this.game)
      if (this.game.dialogue) {
        // In a conversation, E / click / Enter answer instead of poking whatever is under the crosshair.
        this.handleDialogueInput(input, playerPos)
      } else if (this.game.catalogueOpen) {
        this.handleCatalogueInput(input)
      } else if (this.game.terminalOpen) {
        this.handleTerminalInput(input)
      } else if (this.game.consoleScope !== null) {
        this.handleConsoleInput(input)
      } else {
        if (store.pendingChoice) store.patch({ pendingChoice: null })
        if (input.interactPressed && aim) this.report(this.interaction.perform(aim, this.game))
      }
    }

    this.syncHud(dt, aim)
  }

  /**
   * Conversation controls: W/S, arrows or the mouse wheel move the highlight; E, Enter, Space or a click
   * confirm it; 1–6 pick an option directly; Q or Backspace steps away.
   */
  private handleDialogueInput(input: InputSnapshot, playerPos: THREE.Vector3): void {
    const store = useGameStore.getState()
    const d = this.game.dialogue
    if (!d) return
    // Walking away (or the customer leaving) ends the conversation.
    const at = this.agents.position(d.customerId)
    if (!at || Math.hypot(at.x - playerPos.x, at.z - playerPos.z) > REACH.customer + 0.6) {
      this.game.closeDialogue()
      return
    }
    const options = this.game.dialogueOptions()

    if (input.menuMove !== 0) this.dialogueIndex = nextEnabled(options, this.dialogueIndex, input.menuMove)

    let pick: string | null = null
    if (store.pendingChoice) {
      pick = store.pendingChoice
      store.patch({ pendingChoice: null })
    } else if (input.choice !== null) {
      pick = options[input.choice - 1]?.id ?? null
    } else if (input.cancelPressed) {
      pick = 'goodbye'
    } else if (input.interactPressed || input.confirmPressed) {
      pick = options[this.dialogueIndex]?.id ?? null
    }
    if (pick) this.report(this.game.choose(pick as DialogueOptionId))
  }

  /**
   * Catalogue controls: W/S, arrows or the wheel move the highlight, 1–9 jump to a row, E / Enter / Space /
   * a click buys the highlighted upgrade, Q or Backspace closes the catalogue.
   */
  private handleCatalogueInput(input: InputSnapshot): void {
    const store = useGameStore.getState()
    const items = this.game.catalogueItems()
    const n = items.length
    if (input.menuMove !== 0) this.catalogueIndex = (this.catalogueIndex + input.menuMove + n) % n
    if (input.choice !== null && input.choice <= n) this.catalogueIndex = input.choice - 1
    let buy: string | null = null
    if (store.pendingBuy) {
      buy = store.pendingBuy
      store.patch({ pendingBuy: null })
    } else if (input.cancelPressed) {
      this.game.closeCatalogue()
      return
    } else if (input.interactPressed || input.confirmPressed) {
      buy = items[this.catalogueIndex]?.id ?? null
    }
    if (buy) this.report(this.game.buyUpgrade(buy))
  }

  /** Console controls, like the catalogue's: W/S or the wheel choose, 1–9 jump, E / Enter / a click buy, Q closes. */
  private handleConsoleInput(input: InputSnapshot): void {
    const scope = this.game.consoleScope
    if (scope === null) return
    const store = useGameStore.getState()
    const items = this.game.consoleItems(scope)
    const n = items.length
    if (n > 0) {
      if (input.menuMove !== 0) this.consoleIndex = (this.consoleIndex + input.menuMove + n) % n
      if (input.choice !== null && input.choice <= n) this.consoleIndex = input.choice - 1
      this.consoleIndex = Math.min(this.consoleIndex, n - 1)
    }
    let buy: string | null = null
    if (store.pendingConsoleBuy) {
      buy = store.pendingConsoleBuy
      store.patch({ pendingConsoleBuy: null })
    } else if (input.cancelPressed) {
      this.game.closeConsole()
      return
    } else if (input.interactPressed || input.confirmPressed) {
      buy = items[this.consoleIndex]?.id ?? null
    }
    if (buy) this.report(this.game.buyAutomation(buy))
  }

  /**
   * Terminal controls: W/S, arrows or the wheel move the highlight, 1–9 jump to a row, E / Enter / Space / a click asks the
   * robot arm to fetch the highlighted bag, Q or Backspace closes it.
   */
  private handleTerminalInput(input: InputSnapshot): void {
    const store = useGameStore.getState()
    const entries = this.game.terminalEntries()
    const n = entries.length
    if (n > 0) {
      if (input.menuMove !== 0) this.terminalIndex = (this.terminalIndex + input.menuMove + n) % n
      if (input.choice !== null && input.choice <= n) this.terminalIndex = input.choice - 1
      this.terminalIndex = Math.min(this.terminalIndex, n - 1)
    }
    let fetch: string | null = null
    if (store.pendingFetch) {
      fetch = store.pendingFetch
      store.patch({ pendingFetch: null })
    } else if (input.cancelPressed) {
      this.game.closeTerminal()
      return
    } else if (input.interactPressed || input.confirmPressed) {
      fetch = entries[this.terminalIndex]?.lockerId ?? null
    }
    if (!fetch) return
    const result = this.game.requestBag(fetch)
    this.report(result)
    if (result.ok) this.game.closeTerminal()
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
        options: game.dialogueOptions().map((o) => ({ id: o.id, label: o.label, disabled: o.disabled, recommended: o.recommended })),
      }
    }
    const sig = dialogue ? JSON.stringify(dialogue) : ''
    if (sig !== this.dialogueSig) {
      this.dialogueSig = sig
      this.dialogueView = dialogue ? structuredClone(dialogue) : null
      // The conversation moved on: highlight the natural next step again.
      this.dialogueIndex = Math.max(0, dialogue?.options.findIndex((o) => o.recommended) ?? 0)
    }

    // Mod menu view, cached the same way.
    const modOpen = CONFIG.modMenu.enabled && useGameStore.getState().modOpen
    const mod = modOpen ? modInfo(game) : null
    const modSig = mod ? JSON.stringify(mod) : ''
    if (modSig !== this.modSig) {
      this.modSig = modSig
      this.modView = mod
    }

    // Catalogue view, cached the same way.
    let catalogue: CatalogueView | null = null
    if (game.catalogueOpen) {
      catalogue = { money: game.economy.money, level: level.level, items: game.catalogueItems() }
    }
    const catalogueSig = catalogue ? JSON.stringify(catalogue) : ''
    if (catalogueSig !== this.catalogueSig) {
      this.catalogueSig = catalogueSig
      this.catalogueView = catalogue
    }

    // Console view, cached the same way.
    let consoleView: ConsoleView | null = null
    if (game.consoleScope !== null) {
      const scope = game.consoleScope
      consoleView = {
        title: scope === 'hub' ? 'Control hub · extend the belts' : `Robot arms · ${ZONE_TITLES[scope]}`,
        money: game.economy.money,
        level: level.level,
        items: game.consoleItems(scope),
      }
    }
    const consoleSig = consoleView ? JSON.stringify(consoleView) : ''
    if (consoleSig !== this.consoleSig) {
      this.consoleSig = consoleSig
      this.consoleView = consoleView
    }

    // Terminal view, cached the same way.
    let terminal: TerminalView | null = null
    if (game.terminalOpen) terminal = { entries: game.terminalEntries(), free: game.robotLockersFree() }
    const terminalSig = terminal ? JSON.stringify(terminal) : ''
    if (terminalSig !== this.terminalSig) {
      this.terminalSig = terminalSig
      this.terminalView = terminal
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
      stageLabel: `${game.facilityLabel()} · ${game.scheduler.stage.title}`,
      prompt: game.dialogue || game.catalogueOpen || game.terminalOpen || game.consoleScope !== null ? null : (aim?.action ?? null),
      promptHint: game.dialogue || game.catalogueOpen || game.terminalOpen || game.consoleScope !== null ? null : (aim?.hint ?? null),
      holding,
      dialogue: this.dialogueView,
      dialogueIndex: this.dialogueIndex,
      catalogue: this.catalogueView,
      catalogueIndex: this.catalogueIndex,
      console: this.consoleView,
      consoleIndex: this.consoleIndex,
      terminal: this.terminalView,
      terminalIndex: this.terminalIndex,
      modInfo: this.modView,
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
      teleport: (x: number, z: number, feetY?: number) => this.player?.teleport(x, z, feetY),
      look: (yaw: number, pitch: number) => this.cameraRig.turn(yaw, pitch),
      face: (x: number, z: number) => {
        const p = this.player?.getPosition()
        if (p) this.cameraRig.lookToward(x, z, p.x, p.z)
      },
      /** Walk (forward, right in −1…1) for `seconds` of game time, e.g. through a doorway. Debug only. */
      walk: (forward: number, right: number, seconds: number) => {
        this.debugWalk = { forward, right }
        const steps = Math.max(1, Math.round(seconds * 30))
        for (let i = 0; i < steps; i++) this.tick(1 / 30)
        this.debugWalk = null
        this.renderer.render(this.scene, this.cameraRig.camera)
        return this.player?.getPosition().toArray()
      },
      /** Give yourself XP and cash to try upgrades quickly. */
      grant: (xp: number, money: number) => {
        this.game.economy.xp += xp
        this.game.economy.money += money
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

/** Next option in `dir` (+1/−1, wrapping) that can be chosen; stays put if nothing else can. */
function nextEnabled(options: { disabled: string | null }[], from: number, dir: number): number {
  const n = options.length
  for (let step = 1; step <= n; step++) {
    const i = (((from + dir * step) % n) + n) % n
    if (!options[i]?.disabled) return i
  }
  return from
}
