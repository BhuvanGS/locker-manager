import * as THREE from 'three'
import { Quality } from './Quality'
import { dezfight } from '../world/coplanar'
import { RoofBlast } from '../world/RoofBlast'
import { setStreetLampsNight, Town } from '../world/Town'
import { Sky } from '../world/Sky'
import { FirstPersonCamera } from '../player/FirstPersonCamera'
import { PlayerController } from '../player/PlayerController'
import { GameManager } from '../sim/GameManager'
import type { ActionResult, DialogueOptionId, SimNotice } from '../sim/types'
import { CONFIG, ZONE_TITLES, type AutoZone } from '../sim/config'
import { applyMod } from '../sim/mods'
import { useGameStore, type CatalogueView, type ConsoleView, type DealView, type DialogueView, type ReceivingView, type TerminalView } from '../store/gameStore'
import { AutomationConsole } from '../world/AutomationConsole'
import { ConveyorBay } from '../world/ConveyorBay'
import { CounterArm } from '../world/CounterArm'
import { Lake } from '../world/Lake'
import { CustomerAgents } from '../world/CustomerAgents'
import { Annex, type AnnexSide } from '../world/Annex'
import { Facility } from '../world/Facility'
import { Hall, HALL_LEVEL, type HallKind } from '../world/Hall'
import { HeldView } from '../world/HeldView'
import { InteractionManager } from '../world/InteractionManager'
import { KeyRack } from '../world/KeyBoard'
import { LockerWall, type BankPlacement } from '../world/LockerWall'
import { RegisterBoard } from '../world/RegisterBoard'
import { Office } from '../world/Office'
import { VipCar } from '../world/VipCar'
import { Warehouse } from '../world/Warehouse'
import { OccupancyBoard } from '../world/OccupancyBoard'
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
  UNDERGROUND,
} from '../world/layout'
import { isDebugEnabled } from './debug'
import { AUTOSAVE_SECONDS, readSave, writeSave } from './saveGame'
import { InputManager, type InputSnapshot } from './InputManager'
import { PhysicsWorld } from './PhysicsWorld'
import { setGlassEnvironment } from '../world/textures'

/**
 * Owns the renderer and the main loop, and wires the simulation (src/sim) to the 3D views (src/world)
 * and the HUD (store). Frame order: input → player → physics → sim → views → interaction → HUD.
 */
/** Seconds to climb the vault ladder from one end to the other. */
const CLIMB_SECONDS = 2.2
/** Half the player's capsule height: the player's position is its middle, a save keeps where the feet are. */
const PLAYER_HALF_HEIGHT = 1.75 / 2

/** The lobby's middle (where the meteor's shockwave is timed for its roof). */
const LOBBY_CENTRE = { x: 0, z: 3.6 }

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
  /** Digital lockers: an occupancy board on the wall of each tall hall (by hall name). */
  private occupancyBoards = new Map<string, OccupancyBoard>()
  /** Where each bank stands and which part of the building it is in, so a screen can be added to it later. */
  private readonly bankSpots = new Map<number, { placement: BankPlacement; zone: Zone }>()
  /** The conveyor belts, robot arm and terminal, once bought. */
  private conveyorBay: ConveyorBay | null = null
  /** The deal office off the lobby, once bought. */
  private office: Office | null = null
  /** The counter arm (late automation), over the counter. */
  private counterArm: CounterArm | null = null
  /** The meteor's crater and lake (built at start; it draws itself from `game.meteor`). */
  private lake: Lake | null = null
  private roofBlast: RoofBlast | null = null
  /** Graphics quality (resolution, shadows, view distance): auto steps down on slow machines. */
  private quality: Quality | null = null
  /** A game has been started or loaded (before that the menu shows an idle shop, which is not saved). */
  private started = false
  /** Rebuilding a loaded game's rooms: they are put up at once instead of rising. */
  private replaying = false
  private autosaveIn = AUTOSAVE_SECONDS
  /** Seconds until the next z-fighting pass (`dezfight`): soon after start, and after each upgrade once its rooms have risen. */
  private dezfightIn = 1.5
  /**
   * A free camera for filming (debug handle only, `__game.cinema`): replaces the first-person view, shows every zone, keeps the sun's
   * shadows round the camera and hides the held item. `quake` from the meteor still shakes it.
   */
  private cinematic: { pos: THREE.Vector3; look: THREE.Vector3; fov: number } | null = null
  /** The VIP's car in the street (turns up with each offer). */
  private vipCar: VipCar | null = null
  private town: Town | null = null
  readonly sky = new Sky()
  /** The warehouse, its road and its trucks, once bought. */
  private warehouse: Warehouse | null = null
  /** The robot-arm stations of the halls the belts have been extended to (the storage room's is inside the bay). */
  private stations: StationView[] = []
  /** Climbing the vault ladder: from one end to the other over `CLIMB_SECONDS`, the player moved along it each frame. */
  private climb: { from: THREE.Vector3; to: THREE.Vector3; t: number } | null = null
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
  private receivingSig = ''
  private receivingView: ReceivingView | null = null
  private receivingIndex = 0
  private dealSig = ''
  private dealView: DealView | null = null
  private dealIndex = 0
  private consoleSig = ''
  private consoleView: ConsoleView | null = null
  private consoleIndex = 0
  private terminalSig = ''
  private terminalView: TerminalView | null = null
  private terminalIndex = 0
  /** Debug only: forced walking input, so automation can walk through doors. */
  private debugWalk: { forward: number; right: number; sprint?: boolean } | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    setGlassEnvironment(this.renderer)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.scene.background = new THREE.Color(0xa9cde8)
    this.scene.fog = new THREE.Fog(0xa9cde8, 30, 90)
    this.cameraRig = new FirstPersonCamera(canvas.clientWidth / Math.max(canvas.clientHeight, 1))
    window.addEventListener('resize', this.onResize)
    window.addEventListener('pagehide', this.onLeave)
    document.addEventListener('visibilitychange', this.onLeave)
  }

  /** Closing or hiding the tab saves the game (only while one is being played: the menu's idle shop is not a game). */
  private readonly onLeave = (): void => {
    if (document.visibilityState === 'hidden' && useGameStore.getState().phase !== 'menu') this.saveGame()
  }

  async init(): Promise<void> {
    await this.physics.init()
    this.facility = new Facility(this.physics)
    const facility = this.facility
    this.quality = new Quality(this.renderer, this.cameraRig.camera, (size) => facility.setShadowSize(size), () => this.onResize())
    this.scene.add(this.facility.root, this.agents.root, this.held.root)
    this.lake = new Lake(this.physics)
    this.roofBlast = new RoofBlast(this.facility.lobbyRoof, this.facility.lobbyScars)
    this.scene.add(this.lake.root)
    this.town = new Town(this.physics)
    this.scene.add(this.town.root, this.sky.root)
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
    window.removeEventListener('pagehide', this.onLeave)
    document.removeEventListener('visibilitychange', this.onLeave)
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
    if (animate && !this.replaying) wall.appear()
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
    if (animate && !this.replaying) screen.appear()
    this.statusScreens.set(bank, screen)
    this.scene.add(screen.root)
  }

  /** The occupancy board on a tall hall's north wall (digital lockers only). */
  private addOccupancyBoard(kind: HallKind, animate: boolean): void {
    if (!this.game.isDigital || this.occupancyBoards.has(kind)) return
    const board = new OccupancyBoard(kind, HALL_LEVEL[kind] * FLOOR_HEIGHT)
    if (animate && !this.replaying) board.appear()
    this.occupancyBoards.set(kind, board)
    this.scene.add(board.root)
  }

  /** The keys are gone: take the key racks down (and the sign) and put a status screen on every bank. */
  private goDigital(): void {
    for (const rack of this.keyRacks) this.discard(rack.root)
    this.keyRacks = []
    this.facility?.setKeysSignVisible(false)
    for (const bank of this.bankSpots.keys()) this.addStatusScreen(bank, true)
    for (const hall of this.halls) this.addOccupancyBoard(hall.kind, true)
  }

  /** Cut the door in the south hall and build the walkway, the warehouse and the road with its trucks. */
  private addWarehouse(animate: boolean): void {
    if (this.warehouse) return
    this.halls.find((h) => h.kind === 'south')?.openWarehouseDoor()
    const warehouse = new Warehouse(this.physics)
    if (animate && !this.replaying) warehouse.appear()
    this.warehouse = warehouse
    this.scene.add(warehouse.root, warehouse.yard)
    this.town?.setJunctionOpen(true)
    this.interactionTargets.push(warehouse.root, warehouse.yard)
    this.addConsole('warehouse', CONSOLES.warehouse.x, 0, CONSOLES.warehouse.z, CONSOLES.warehouse.rotY, 'warehouse')
  }

  /** Hang the counter arm over the counter. */
  private addCounterArm(): void {
    if (this.counterArm) return
    this.counterArm = new CounterArm()
    this.scene.add(this.counterArm.root)
  }

  /** Knock through into the unit next door and build the deal office. */
  private addOffice(animate: boolean): void {
    if (this.office) return
    this.facility?.setOfficeOpen(true)
    const office = new Office(this.physics)
    if (animate && !this.replaying) office.appear()
    this.office = office
    this.scene.add(office.root)
    this.interactionTargets.push(office.root)
    this.vipCar = new VipCar()
    this.scene.add(this.vipCar.root)
  }

  /** Cut the hatch through the partition and install the belts, the robot arm and the terminal. */
  private addConveyor(animate: boolean): void {
    if (this.conveyorBay) return
    this.facility?.setConveyorOpen(true)
    const bay = new ConveyorBay(this.physics, (id) => this.lockerSlotWorld(id))
    if (animate && !this.replaying) bay.appear()
    this.conveyorBay = bay
    this.scene.add(bay.root)
    this.interactionTargets.push(bay.root)
    this.addConsole('hub', CONSOLES.hub.x, 0, CONSOLES.hub.z, CONSOLES.hub.rotY, 'main')
    this.addConsole('main', CONSOLES.main.x, 0, CONSOLES.main.z, CONSOLES.main.rotY, 'main')
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

  private addConsole(scope: 'hub' | 'warehouse' | AutoZone, x: number, floorY: number, z: number, rotY: number, zone: AutoZone | 'warehouse'): void {
    if (this.consoles.has(scope)) return
    const console = new AutomationConsole(scope, x, floorY, z, rotY, zone, this.physics)
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
    this.addConsole(zone, spot.x, floorY, spot.z, spot.rotY, zone)
  }

  private addRegisterBoard(animate: boolean): void {
    if (this.registerBoard) return
    const board = new RegisterBoard()
    if (animate && !this.replaying) board.appear()
    this.registerBoard = board
    this.scene.add(board.root)
  }

  /** Knock through into the next unit: open the doorway, raise the hall, and fit its banks and racks. */
  private addAnnex(side: AnnexSide, banks: number[], racks: number[]): void {
    this.facility?.setAnnexOpen(side, true)
    const annex = new Annex(side, this.physics)
    if (!this.replaying) annex.appear()
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
      if (!this.replaying) stairs.appear()
      this.stairs.push(stairs)
      this.scene.add(stairs.root)
      this.interactionTargets.push(stairs.root)
    }
    const hall = new Hall(kind, this.physics)
    if (!this.replaying) hall.appear()
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
    this.addOccupancyBoard(kind, true)
  }

  /**
   * Only draw the part of the building you are in and the parts you can see into (through doorways and stairwells).
   * Locker banks are hundreds of small meshes, so hiding the rest keeps the frame rate up in a big building.
   */
  /** Filming: everything visible, wherever the camera is. */
  private showAllZones(): void {
    const roots: THREE.Object3D[] = [
      ...this.lockerWalls.map((w) => w.root),
      ...this.keyRacks.map((r) => r.root),
      ...[...this.statusScreens.values()].map((s) => s.root),
      ...[...this.occupancyBoards.values()].map((b) => b.root),
      ...this.stations.map((s) => s.root),
      ...[...this.consoles.values()].map((c) => c.root),
      ...this.annexes.map((a) => a.root),
      ...this.halls.map((h) => h.root),
      ...this.stairs.map((f) => f.root),
    ]
    for (const o of [this.conveyorBay, this.office, this.counterArm, this.warehouse]) if (o) roots.push(o.root)
    for (const r of roots) r.visible = true
  }

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
    for (const board of this.occupancyBoards.values()) show(board.root)
    if (this.conveyorBay) show(this.conveyorBay.root)
    if (this.office) show(this.office.root)
    if (this.counterArm) show(this.counterArm.root)
    if (this.warehouse) show(this.warehouse.root)
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
    if (animate && !this.replaying) rack.appear()
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
    for (const board of this.occupancyBoards.values()) {
      this.discard(board.root)
      board.dispose()
    }
    this.occupancyBoards.clear()
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
    if (this.counterArm) {
      this.discard(this.counterArm.root)
      this.counterArm.dispose()
      this.counterArm = null
    }
    if (this.warehouse) {
      this.discard(this.warehouse.root)
      this.discard(this.warehouse.yard)
      this.warehouse.dispose()
      this.warehouse = null
      this.town?.setJunctionOpen(false)
    }
    if (this.vipCar) {
      this.vipCar.dispose()
      this.discard(this.vipCar.root)
      this.vipCar = null
    }
    if (this.office) {
      this.discard(this.office.root)
      this.office.dispose()
      this.office = null
    }
    this.facility?.setOfficeOpen(false)
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
    this.resetWorld(new GameManager(seedFromUrl()))
    this.player?.teleport(PLAYER_SPAWN.x, PLAYER_SPAWN.z)
    this.cameraRig.lookToward(0, 6, PLAYER_SPAWN.x, PLAYER_SPAWN.z)
  }

  /** Carry on the saved game: rebuild every room it had bought (at once), and put the player back where they stood. */
  loadGame(): boolean {
    const file = readSave()
    if (!file) return false
    let game: GameManager
    try {
      game = GameManager.fromSave(file.sim)
    } catch (err) {
      console.error('Could not load the saved game', err)
      return false
    }
    this.resetWorld(game)
    this.replaying = true
    try {
      for (const notice of game.drainNotices()) this.handleNotice(notice)
    } finally {
      this.replaying = false
    }
    const p = file.player
    this.player?.teleport(p.x, p.z, p.feetY)
    this.cameraRig.setAngles(p.yaw, p.pitch)
    return true
  }

  /** Write the game to this browser's storage (see `saveGame.ts`). */
  saveGame(): boolean {
    if (!this.started || !this.player) return false
    const pos = this.player.getPosition()
    const ok = writeSave({
      summary: { savedAt: Date.now(), level: this.game.economy.level.level, money: Math.round(this.game.economy.money), lockers: this.game.lockers.total },
      player: { x: pos.x, feetY: pos.y - PLAYER_HALF_HEIGHT, z: pos.z, yaw: this.cameraRig.getYaw(), pitch: this.cameraRig.getPitch() },
      sim: this.game.toSave(),
    })
    this.autosaveIn = AUTOSAVE_SECONDS
    if (ok) useGameStore.setState({ save: readSave()?.summary ?? null })
    return ok
  }

  private resetWorld(game: GameManager): void {
    this.removeBuiltFurniture()
    this.dezfightIn = 1.5
    this.game = game
    this.started = true
    this.autosaveIn = AUTOSAVE_SECONDS
    this.climb = null
    this.buildStartingFurniture()
    this.agents.clear()
    this.dialogueSig = ''
    this.catalogueSig = ''
    this.catalogueView = null
    this.terminalSig = ''
    this.terminalView = null
    this.consoleSig = ''
    this.consoleView = null
    this.dealSig = ''
    this.dealView = null
    this.receivingSig = ''
    this.receivingView = null
    useGameStore.setState({ toasts: [], dialogue: null, catalogue: null, terminal: null, console: null, deal: null, receiving: null, banner: null })
  }

  private readonly loop = (time: number): void => {
    if (!this.running) return
    this.raf = requestAnimationFrame(this.loop)
    const dt = Math.min((time - this.lastTime) / 1000, 0.05)
    this.lastTime = time
    this.quality?.measure(dt, useGameStore.getState().phase === 'playing')
    this.tick(dt)
    this.renderer.render(this.scene, this.cameraRig.camera)
  }

  private tick(dt: number): void {
    const store = useGameStore.getState()
    if (store.newGameRequested) {
      this.newGame()
      store.patch({ newGameRequested: false })
    }
    if (store.continueRequested) {
      store.patch({ continueRequested: false })
      if (!this.loadGame()) {
        store.pushToast('The saved game could not be loaded. Starting a new one.', 'bad')
        this.newGame()
      }
    }
    if (store.saveRequested) {
      store.patch({ saveRequested: false })
      // Success shows in the pause menu ("Saved at …"); a failure needs saying.
      if (!this.saveGame()) store.pushToast('Could not save: this browser is not letting the game store anything.', 'bad')
    }
    const input = this.input.snapshot()
    if (this.debugWalk) {
      input.forward = this.debugWalk.forward
      input.right = this.debugWalk.right
      if (this.debugWalk.sprint) input.sprint = true
    }
    const player = this.player
    if (!player || !this.facility || !this.interaction) return

    const pausePressed = input.pausePressed
    const playing = store.phase === 'playing'

    if (playing) {
      this.autosaveIn -= dt
      if (this.autosaveIn <= 0) this.saveGame()
    }
    if (playing && pausePressed) {
      this.saveGame()
      store.setPhase('paused')
      if (document.pointerLockElement) document.exitPointerLock()
      return
    }

    // Player and camera. While you are talking or browsing the catalogue you stand still
    // (W/S/arrows choose answers instead).
    const talking = this.game.dialogue !== null || this.game.catalogueOpen || this.game.terminalOpen || this.game.consoleScope !== null || this.game.dealOpen || this.game.receivingOpen
    if (playing) {
      this.cameraRig.handleMouseDelta(input.mouseDeltaX, input.mouseDeltaY)
      player.update(talking ? { ...input, forward: 0, right: 0, sprint: false, jumpPressed: false } : input, this.cameraRig.getYaw(), dt)
      this.physics.step(dt)
      player.syncFromPhysics()
    }
    this.cameraRig.quake = this.lake ? Math.min(1, this.lake.shake(this.game, player.getEyePosition())) : 0
    this.roofBlast?.update(dt, this.lake ? this.lake.blastSince(this.game, LOBBY_CENTRE) : null)
    this.cameraRig.update(player.getEyePosition(), playing ? dt : 0, player.isGrounded(), playing && !talking && input.sprint)
    const camera = this.cameraRig.camera
    const playerPos = player.getPosition()
    const cine = this.cinematic
    if (cine) {
      const q = this.cameraRig.quake * 0.35
      camera.position.copy(cine.pos).add(new THREE.Vector3((Math.random() - 0.5) * q, (Math.random() - 0.5) * q, (Math.random() - 0.5) * q))
      camera.lookAt(cine.look)
      if (Math.abs(camera.fov - cine.fov) > 0.01) {
        camera.fov = cine.fov
        camera.updateProjectionMatrix()
      }
    }

    // Simulation only advances while playing (pausing stops the clock).
    if (playing) this.game.update(dt)
    for (const notice of this.game.drainNotices()) this.handleNotice(notice)

    // Graphics quality: apply a new choice from the pause menu, report the level in use, and schedule the shadow redraw.
    if (this.quality) {
      if (store.qualitySetting !== this.quality.setting) this.quality.choose(store.qualitySetting)
      if (store.qualityLevel !== this.quality.level) store.patch({ qualityLevel: this.quality.level })
      this.quality.beforeRender()
    }
    if (this.dezfightIn > 0) {
      this.dezfightIn -= dt
      if (this.dezfightIn <= 0) dezfight(this.scene)
    }
    // Views.
    this.agents.update(playing ? dt : 0, this.game, playerPos, camera)
    this.facility.setVaultOpen(this.game.hasWarehouse && this.game.warehouse.sectionCapacity('hidden') > 0)
    this.updateClimb(dt)
    // The time of day: sky, sun or moon, ambient light, fog and the street lamps.
    const daylight = this.sky.update(this.game.now, camera.position)
    this.facility.setDaylight(daylight)
    ;(this.scene.fog as THREE.Fog).color.copy(daylight.fog)
    ;(this.scene.background as THREE.Color).copy(daylight.fog)
    setStreetLampsNight(daylight.night)
    if (cine) this.facility.followSun(cine.pos.x, Math.max(0, cine.pos.y - 1.6), cine.pos.z)
    else this.facility.followSun(playerPos.x, playerPos.y - 0.9, playerPos.z)
    this.facility.update(dt, this.agents.nearDoor() || !!this.vipCar?.nearDoor() || (Math.abs(playerPos.x) < 1.8 && Math.abs(playerPos.z - 6.1) < 2))
    for (const wall of this.lockerWalls) wall.update(dt, this.game)
    for (const rack of this.keyRacks) rack.update(dt, this.game)
    for (const screen of this.statusScreens.values()) screen.update(dt, this.game)
    for (const board of this.occupancyBoards.values()) board.update(dt, this.game)
    this.conveyorBay?.update(dt, this.game)
    this.office?.update(dt, this.game)
    this.counterArm?.update(dt, this.game, (id) => this.agents.position(id)?.x ?? null)
    this.vipCar?.update(dt, this.game)
    this.warehouse?.update(dt, this.game, playerPos)
    this.lake?.update(dt, this.game)
    this.town?.update(dt, playerPos, [...this.agents.positions(), ...(this.vipCar?.obstacles() ?? []), ...(this.warehouse?.vehicles() ?? [])])
    for (const station of this.stations) station.update(dt, this.game)
    for (const console of this.consoles.values()) console.update(this.game)
    this.registerBoard?.update(dt, this.game)
    for (const annex of this.annexes) annex.update(dt)
    for (const hall of this.halls) hall.update(dt)
    for (const flight of this.stairs) flight.update(dt)
    if (cine) this.showAllZones()
    else this.applyZoneVisibility(playerPos)
    this.held.root.visible = !cine
    this.held.update(dt, camera, this.game, !talking && (input.forward !== 0 || input.right !== 0))

    // Interaction.
    let aim = null
    if (playing) {
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
      } else if (this.game.dealOpen) {
        this.handleDealInput(input)
      } else if (this.game.receivingOpen) {
        this.handleReceivingInput(input)
      } else {
        if (store.pendingChoice) store.patch({ pendingChoice: null })
        if (input.interactPressed && aim) {
          if (aim.target.kind === 'ladder' && aim.action && !this.climb) this.startClimb(aim.target.to)
          else this.report(this.interaction.perform(aim, this.game))
        }
      }
    }

    this.syncHud(dt, aim)
  }

  /** React to one thing the simulation reports: agents, toasts and banners, and the rooms and machines an upgrade builds. */
  private handleNotice(notice: SimNotice): void {
    if (this.replaying && notice.type !== 'upgradeBought' && notice.type !== 'customerSpawned') return
    if (notice.type === 'customerSpawned') this.agents.spawn(this.game, notice.customerId)
    else if (notice.type === 'customerLeaving') this.agents.leave(notice.customerId)
    else if (notice.type === 'payment') useGameStore.getState().pushToast(`+$${notice.amount}`, 'good')
    else if (notice.type === 'xp') useGameStore.getState().pushToast(`+${notice.amount} XP`, 'info')
    // Mistakes are already toasted from the action's own result message, so only walk-outs need one here.
    else if (notice.type === 'mistake') return
    else if (notice.type === 'walkout') useGameStore.getState().pushToast(notice.message, 'bad')
    else if (notice.type === 'jam') useGameStore.getState().pushToast(notice.text, 'bad')
    else if (notice.type === 'alert') useGameStore.getState().pushToast(notice.text, 'bad')
    else if (notice.type === 'stageStarted') useGameStore.getState().showBanner(notice.title, notice.text)
    else if (notice.type === 'levelUp') {
      const unlocked = notice.unlocked.length > 0 ? `New in the catalogue: ${notice.unlocked.join(', ')}.` : 'Customers will arrive a little faster.'
      useGameStore.getState().showBanner(`Level ${notice.level}`, `+$${notice.bonus} bonus. ${unlocked}`, 'Level up')
    } else if (notice.type === 'upgradeBought') {
      this.dezfightIn = this.replaying ? 1.5 : 6
      if (notice.kind === 'lockerBank') this.addLockerBank(notice.index, true)
      else if (notice.kind === 'keyRack') this.addKeyRack(notice.index, true)
      else if (notice.kind === 'register') this.addRegisterBoard(true)
      else if (notice.kind === 'digital') this.goDigital()
      else if (notice.kind === 'conveyor') this.addConveyor(true)
      else if (notice.kind === 'office') this.addOffice(true)
      else if (notice.kind === 'warehouse') this.addWarehouse(true)
      else if (notice.kind === 'automation' && notice.id.startsWith('line-') && notice.zone) this.addLine(notice.zone)
      else if (notice.kind === 'automation' && notice.id === 'counter-arm') this.addCounterArm()
      else if (notice.kind === 'annex' && notice.side) this.addAnnex(notice.side, notice.banks ?? [], notice.racks ?? [])
      else if (notice.kind === 'hall' && notice.hall) this.addHall(notice.hall, notice.banks ?? [], notice.racks ?? [])
      // 'labels' needs no new objects: the lockers, racks and held key notice `game.hasLabels` themselves.
    } else useGameStore.getState().pushToast(notice.text, 'info')
      }

  private startClimb(to: 'down' | 'up'): void {
    if (to === 'up' && !this.game.vaultHatchOpen) this.game.toggleVaultHatch()
    const U = UNDERGROUND
    const top = new THREE.Vector3(U.top.x, 0.04, U.top.z)
    const bottom = new THREE.Vector3(U.bottom.x, U.floorY, U.bottom.z)
    this.climb = to === 'down' ? { from: top, to: bottom, t: 0 } : { from: bottom, to: top, t: 0 }
  }

  /** Moves the player along the ladder: over to it, up or down it, then off it. */
  private updateClimb(dt: number): void {
    const c = this.climb
    if (!c || !this.player) return
    c.t = Math.min(1, c.t + dt / CLIMB_SECONDS)
    const u = c.t * c.t * (3 - 2 * c.t)
    const ladder = UNDERGROUND.ladder
    // Close in on the ladder, climb it, step off: the horizontal part happens at the start (going down) or the end (going up).
    const going = c.to.y < c.from.y ? 'down' : 'up'
    const k = going === 'down' ? Math.min(1, u * 4) : Math.max(0, u * 4 - 3)
    const end = going === 'down' ? c.to : c.from
    const off = going === 'down' ? c.from : c.to
    const near = new THREE.Vector3(ladder.x, 0, end.z)
    const xz = going === 'down' ? off.clone().lerp(near, k) : near.clone().lerp(off, k)
    const y = c.from.y + (c.to.y - c.from.y) * u
    this.player.teleport(xz.x, xz.z, y)
    if (c.t >= 1) {
      this.player.teleport(c.to.x, c.to.z, c.to.y)
      this.climb = null
    }
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

  /** Receiving desk controls: W/S or the wheel pick a load, 1 stores it, 2 opens it, 3 sends it back, Q closes. */
  private handleReceivingInput(input: InputSnapshot): void {
    const store = useGameStore.getState()
    const loads = this.game.receivingLoads()
    const n = loads.length
    if (n > 0) {
      if (input.menuMove !== 0) this.receivingIndex = (this.receivingIndex + input.menuMove + n) % n
      this.receivingIndex = Math.min(this.receivingIndex, n - 1)
    }
    const actions = ['inspect', 'refuse'] as const
    let act: { id: number; action: (typeof actions)[number] } | null = null
    if (store.pendingReceive) {
      act = store.pendingReceive
      store.patch({ pendingReceive: null })
    } else if (input.cancelPressed) {
      this.game.closeReceiving()
      return
    } else if (input.choice !== null && input.choice <= 2) {
      const load = loads[this.receivingIndex]
      if (load) act = { id: load.id, action: actions[input.choice - 1]! }
    }
    if (act) this.report(this.game.receive(act.id, act.action))
  }

  /** Deal desk controls: W/S or the wheel choose, 1–3 pick, E / Enter / a click confirm, Q closes. */
  private handleDealInput(input: InputSnapshot): void {
    const store = useGameStore.getState()
    const options = this.game.dealOptions()
    const n = options.length
    if (input.menuMove !== 0) this.dealIndex = (this.dealIndex + input.menuMove + n) % n
    if (input.choice !== null && input.choice <= n) this.dealIndex = input.choice - 1
    let pick: 'accept' | 'haggle' | 'decline' | null = null
    if (store.pendingDeal) {
      pick = store.pendingDeal
      store.patch({ pendingDeal: null })
    } else if (input.cancelPressed) {
      this.game.closeDeal()
      return
    } else if (input.interactPressed || input.confirmPressed) {
      pick = options[this.dealIndex]?.id ?? null
    }
    if (pick) this.report(this.game.chooseDeal(pick))
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

  private syncHud(dt: number, aim: { action: string | null; hint: string | null; target?: { kind: string } } | null = null): void {
    const game = this.game
    const level = game.economy.level
    const hands = game.hands
    const holding = !hands
      ? null
      : hands.kind === 'key'
        ? 'A locker key'
        : hands.kind === 'crate'
          ? (game.carryingLabel() ?? 'A crate')
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

    // Receiving desk view, cached the same way.
    let receiving: ReceivingView | null = null
    if (game.receivingOpen) {
      const wh = game.warehouse
      receiving = {
        loads: game.receivingLoads(),
        sections: wh.sections().map((section) => ({ section, stored: wh.sectionStored(section), capacity: wh.sectionCapacity(section) })),
        scanner: wh.scanner,
        autoLevel: wh.autoLevel,
      }
    }
    const receivingSig = receiving ? JSON.stringify(receiving) : ''
    if (receivingSig !== this.receivingSig) {
      this.receivingSig = receivingSig
      this.receivingView = receiving
    }

    // Deal desk view, cached the same way.
    let deal: DealView | null = null
    if (game.dealOpen && game.deals.offer) {
      const o = game.deals.offer
      deal = {
        name: o.name,
        title: o.title,
        cargo: o.cargo,
        crates: o.crates,
        pitch: o.pitch ?? null,
        retainer: o.retainer,
        waitLeft: Math.max(0, Math.ceil(o.expiresAt - game.now)),
        haggled: o.haggled,
        signed: game.deals.signed.length,
        signedCrates: game.deals.crates,
        options: game.dealOptions(),
      }
    }
    const dealSig = deal ? JSON.stringify(deal) : ''
    if (dealSig !== this.dealSig) {
      this.dealSig = dealSig
      this.dealView = deal
    }

    // Console view, cached the same way.
    let consoleView: ConsoleView | null = null
    if (game.consoleScope !== null) {
      const scope = game.consoleScope
      consoleView = {
        title: scope === 'hub' ? 'Control hub · extend the belts' : scope === 'warehouse' ? 'Warehouse office · upgrades' : `Robot arms · ${ZONE_TITLES[scope]}`,
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
      aimPerson: aim?.target?.kind === 'customer' || aim?.target?.kind === 'contact',
      reminders: game.reminders().join('\n'),
      stageLabel: `${game.facilityLabel()} · ${game.scheduler.stage.title}`,
      bigEvent: game.meteorStatus(),
      prompt: game.dialogue || game.catalogueOpen || game.terminalOpen || game.consoleScope !== null || game.dealOpen || game.receivingOpen ? null : (aim?.action ?? null),
      promptHint: game.dialogue || game.catalogueOpen || game.terminalOpen || game.consoleScope !== null || game.dealOpen || game.receivingOpen ? null : (aim?.hint ?? null),
      holding,
      dialogue: this.dialogueView,
      dialogueIndex: this.dialogueIndex,
      catalogue: this.catalogueView,
      catalogueIndex: this.catalogueIndex,
      receiving: this.receivingView,
      receivingIndex: this.receivingIndex,
      deal: this.dealView,
      dealIndex: this.dealIndex,
      console: this.consoleView,
      consoleIndex: this.consoleIndex,
      terminal: this.terminalView,
      terminalIndex: this.terminalIndex,
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
      /** Filming in first person: hold the movement keys (relative to the view) until called again (0, 0 lets go). */
      drive: (forward: number, right: number, sprint = false) => {
        this.debugWalk = forward || right ? { forward, right, sprint } : null
      },
      /** Filming: set the view's yaw and pitch outright; `angles()` reads them back. */
      aim: (yaw: number, pitch: number) => this.cameraRig.setAngles(yaw, pitch),
      angles: () => [this.cameraRig.getYaw(), this.cameraRig.getPitch()],
      /** Filming: climb the vault ladder ('down' from the hatch, 'up' from below). */
      climb: (to: 'down' | 'up') => this.startClimb(to),
      /** Run a mod-menu request directly (`{ type: 'unlockAll' }`, `{ type: 'meteor' }`, …). */
      mod: (request: Parameters<typeof applyMod>[1]) => applyMod(this.game, request),
      /** Filming: a free camera at `pos` looking at `look` (null: back to first person). */
      cinema: (pos: [number, number, number] | null, look?: [number, number, number], fov = 55) => {
        this.cinematic = pos && look ? { pos: new THREE.Vector3(...pos), look: new THREE.Vector3(...look), fov } : null
        if (!this.cinematic) this.cameraRig.resize(this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight))
      },
      /**
       * Filming: render at a fixed size (e.g. 1920 × 1080), whatever the window, and stop the real-time loop so only `frame()` moves
       * time (otherwise the browser's own frames run in between and time races ahead of the recording).
       */
      filmSize: (w: number, h: number) => {
        this.running = false
        cancelAnimationFrame(this.raf)
        this.quality?.force('high')
        this.renderer.setPixelRatio(1)
        this.renderer.setSize(w, h, false)
        this.cameraRig.resize(w / h)
      },
      /** Filming: run one frame of `dt` seconds and return it as a JPEG data URL. */
      frame: (dt = 1 / 30, quality = 0.9) => {
        this.tick(dt)
        this.renderer.render(this.scene, this.cameraRig.camera)
        return this.canvas.toDataURL('image/jpeg', quality)
      },
      interact: () => {
        const aim = this.interaction?.aim(this.cameraRig.camera, this.game)
        if (aim?.target.kind === 'ladder' && aim.action && !this.climb) {
          this.startClimb(aim.target.to)
          return { aim, result: null }
        }
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
