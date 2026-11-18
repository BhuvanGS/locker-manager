import * as THREE from 'three'

/**
 * Facility floor plan in metres (y up). The front of the building faces +z (the street).
 *
 *   z = 12  street                         ─────────────────────
 *   z =  6  front wall, entrance x∈[-1,1]  ███████  door  ███████
 *           lobby (customers)               bench           plant
 *   z ≈1.2  service counter x∈[-4.5,3.5]   ═════════════════  gap
 *           staff area (player spawns here)
 *   z = -2.4 partition, doorway x∈[-0.8,0.8]  key board at x=-2.6
 *           storage room
 *   z = -9  back wall, locker wall (3 × 2) centred on x = 0
 */
export const FLOOR_Y = 0
export const ROOM = { minX: -6, maxX: 6, minZ: -9, maxZ: 6, height: 3.2 }
export const ENTRANCE = { halfWidth: 1, height: 2.5 }
export const COUNTER = { minX: -4.5, maxX: 3.5, z: 1.2, depth: 0.6, height: 1.05 }
export const PARTITION = { z: -2.4, doorHalfWidth: 0.8 }

export const PLAYER_SPAWN = new THREE.Vector3(0, FLOOR_Y, -0.6)

/** Customers walk: street → entrance → counter, and back out. */
export const CUSTOMER_PATH = {
  street: new THREE.Vector3(0, 0, 13),
  outsideDoor: new THREE.Vector3(0, 0, 7.5),
  insideDoor: new THREE.Vector3(0, 0, 4.6),
  /** Counter service spots, centre first; the first free one is used. */
  counterSpots: [new THREE.Vector3(0, 0, 2.05), new THREE.Vector3(-1.6, 0, 2.05), new THREE.Vector3(1.6, 0, 2.05)],
  /**
   * Waiting line when every counter spot is taken: along the left of the lobby, front of the line
   * first, kept clear of the entrance walkway (x ≈ 0) and the bench (x ≈ -5.6).
   */
  lineSpots: [
    new THREE.Vector3(-3.1, 0, 2.9),
    new THREE.Vector3(-3.1, 0, 3.8),
    new THREE.Vector3(-3.1, 0, 4.7),
    new THREE.Vector3(-2.0, 0, 5.3),
    new THREE.Vector3(2.6, 0, 3.4),
    new THREE.Vector3(2.6, 0, 4.4),
    new THREE.Vector3(3.6, 0, 5.2),
    // A busy shop: second columns on both sides, and a third on the right (still clear of the entrance walkway and the bench).
    new THREE.Vector3(-4.1, 0, 2.9),
    new THREE.Vector3(-4.1, 0, 3.8),
    new THREE.Vector3(-4.1, 0, 4.7),
    new THREE.Vector3(4.6, 0, 3.8),
    new THREE.Vector3(4.6, 0, 4.7),
    new THREE.Vector3(5.3, 0, 4.4),
    new THREE.Vector3(5.3, 0, 5.3),
  ],
}

export const LOCKER = {
  width: 0.9,
  height: 0.9,
  depth: 0.6,
  gap: 0.04,
  /** Front face of the locker wall. */
  frontZ: ROOM.minZ + 0.62,
  baseY: 0.12,
}

/**
 * Where each wall of lockers stands along the back wall of the storage room. Bank 0 is the original; banks
 * 1 and 2 are the "Locker bank B / C" upgrades, left and right of it (each is 2.82 m wide). The gaps between them are 1.4 m, so
 * the south expansion's doorway fits in the one on the left (x = −2.15).
 */
export const LOCKER_BANKS = [{ centerX: 0 }, { centerX: -4.3 }, { centerX: 4.3 }]

export const KEY_BOARD = {
  center: new THREE.Vector3(-2.6, 1.45, PARTITION.z + 0.12),
  width: 1.3,
  height: 0.62,
  cols: 4,
}

/**
 * Key racks on the staff side of the partition (x of each rack's centre). Rack 0 is the original board;
 * racks 1 and 2 are the "Key rack #2 / #3" upgrades.
 */
export const KEY_RACKS = [{ x: -2.6 }, { x: -4.45 }, { x: 2.6 }]

/**
 * The deposit register board: in the storage room, on the storage side of the partition, facing the lockers (−z).
 * (x, y, z) is the centre of the board; `rotY` turns it to face −z.
 */
export const REGISTER_BOARD = { x: 3.4, y: 1.65, z: PARTITION.z - 0.13, rotY: Math.PI, width: 1.7, height: 1.05 }

/**
 * Building expansion: the units next door are knocked through into storage annexes. `ANNEX_DOOR` is the doorway
 * cut in each side wall of the storage room; `ANNEX[side]` is the hall's interior (x), where its two locker banks
 * stand (back wall, facing +z) and where its two key racks hang (on the hall's front wall, facing −z).
 */
export const ANNEX_DOOR = { z: -3.6, halfWidth: 0.8, height: 2.2 }
export const ANNEX_ZONE = { minZ: ROOM.minZ, maxZ: PARTITION.z }
export const ANNEX = {
  west: { minX: -16, maxX: -6.2, bankX: [-9.4, -13.6], rackX: [-9.0, -13.2] },
  east: { minX: 6.2, maxX: 16, bankX: [9.4, 13.6], rackX: [9.0, 13.2] },
} as const
/** Annex racks hang on the inside of the hall's front wall (face z = −2.5), facing −z. */
export const ANNEX_RACK = { z: PARTITION.z - 0.1 - 0.12, rotY: Math.PI }

/**
 * The conveyor system (Conveyor & robot arm upgrade). Two belts run side by side from the staff area, through a hatch in the
 * partition, to the back of the storage room: the IN belt carries bags to the robot arm, the OUT belt carries fetched bags back
 * to a tray you collect from. The arm hangs from a rail along the front of the locker banks (z = `rail.z`) and reaches
 * forward to the pick-up spot at the end of the IN belt and back into the lockers. It serves the storage room's own three banks.
 * `topY` is the belt surface; the staff-side end (`startZ`) is where you load and collect.
 */
export const CONVEYOR = {
  inX: -5.05,
  outX: -4.35,
  width: 0.55,
  topY: 0.85,
  startZ: -0.9,
  endZ: -6.6,
  /** Where fetched bags wait for you on the OUT belt (bags stack back from here). */
  trayZ: -1.25,
  hatch: { minX: -5.45, maxX: -3.95, height: 1.25 },
  rail: { z: -7.45, y: 2.85, minX: -5.95, maxX: 5.95 },
  /** The terminal on the staff side. */
  kiosk: { x: -3.05, z: -1.2 },
} as const

/**
 * Robot arm stations. The storage room's arms hang from a rail along its row of lockers, `railOffset` north of the locker fronts
 * (a second arm rides a parallel rail `secondRail` further out and a little lower). The East annex is fed through two ducts in the gap
 * between its banks (`tubes`, `cradleY`). The tall halls (south hall and floors) share one **bay** at the back: ducts from the
 * ceiling drop bags onto two short belts, and the arms pick up and drop off at the east end of those belts. From there each arm rides an
 * overhead runway along the corridor (x = `BAY.laneX`) to the rail of any row of lockers. Nothing overhead reaches the stairs (x > 4.45).
 */
export const STATION = {
  railHeight: 2.85,
  railOffset: 0.93,
  secondRail: 0.4,
  tubes: { east: [11.25, 11.75] },
  cradleY: 1.95,
  extent: { main: [-5.95, 5.95], east: [6.3, 15.9], hall: [-5.95, 3.9] },
} as const

/**
 * The bay at the back of the south hall, floor 1 and floor 2 (the same place on each). Two belts run along x: IN carries bags from the
 * duct (west) to the arms (east), OUT carries fetched bags back to a duct. `carZ` is where an arm's carriage rides between the belts,
 * `laneX` the runway of each arm, `spotX` where each arm picks up and drops.
 */
export const BAY = {
  inZ: -19.9,
  outZ: -20.55,
  carZ: -20.225,
  minX: -3.2,
  // The belts end well short of the stairs (x = 4.45): the corridor beside them stays wide enough to walk to the foot of the next flight.
  maxX: 3.4,
  ductX: -2.7,
  laneX: [2.85, 3.2],
  spotX: [2.85, 3.2],
  /** Height of the bottom of the ducts above the floor. */
  mouthY: 1.5,
  /** Bags queued at the pick-up end sit this far apart (x). */
  queueStep: 0.5,
  /** Seconds the last/first stretch of a trip through the duct is shown on the belt. */
  slideSeconds: 2,
} as const

/**
 * Where the upgrade consoles stand. `hub` is the control console in the staff area (belt extensions); each zone has an arm
 * console near its robot arms. They face +z.
 */
export const CONSOLES = {
  hub: { x: -2.35, z: -1.2, rotY: 0 },
  main: { x: -3.35, z: -6.1, rotY: 0 },
  east: { x: 11.5, z: -5.8, rotY: 0 },
  /** In the north-west corner of every tall hall, by the west window, angled out into the room (clear of the stairs, the corridor and the bay). */
  hall: { x: -5.5, z: -9.9, rotY: (3 * Math.PI) / 4 },
  /** Inside the warehouse, by the west door, facing east into the shed. */
  warehouse: { x: 7.0, z: -11.2, rotY: Math.PI / 2 },
} as const

/**
 * Power for the robot consoles: each one's cable bundle runs along the floor (`route`, x z from beside the console) to its room's
 * electrical box and climbs the wall into it (`riser`: the box body's x z, `top`: the box's bottom edge above the floor). The halls
 * share one plan (each floor is the same). The hub console keeps its ceiling conduit.
 */
export const POWER_FEEDS: Record<'main' | 'east' | 'hall' | 'warehouse', { route: readonly (readonly [number, number])[]; riser: { x: number; z: number; top: number } }> = {
  main: { route: [[-3.35, -6.1], [-3.05, -6.1], [-3.05, -2.62], [4.6, -2.62]], riser: { x: 4.88, z: -2.74, top: 1.0 } },
  east: { route: [[11.5, -5.8], [15.7, -5.8]], riser: { x: 15.8, z: -5.68, top: 1.0 } },
  // The halls' locker rows are solid from the west wall to x = 2.7, so cables go round them: the north aisle, the corridor beside the
  // stairs, then the aisle in front of the bay to the box on the far wall.
  hall: { route: [[-5.5, -9.9], [-4.9, -10.75], [3.3, -10.75], [3.4, -19.3], [-4.7, -19.3], [-4.9, -20.5]], riser: { x: -4.98, z: -20.8, top: 1.0 } },
  warehouse: { route: [[7.0, -11.2], [6.72, -9.72], [9.05, -9.72]], riser: { x: 9.28, z: -9.6, top: 1.0 } },
}

/** The front of locker `col`, `row` of a storage-room bank: x, the height of the middle of its opening, and the z of the item. */
export function lockerSlot(bank: number, row: number, col: number): { x: number; y: number; z: number } {
  const pitch = LOCKER.width + LOCKER.gap
  const cx = LOCKER_BANKS[bank]?.centerX ?? 0
  return {
    x: cx + (col - 1) * pitch,
    y: LOCKER.baseY + row * pitch + LOCKER.height / 2,
    z: LOCKER.frontZ - LOCKER.depth / 2,
  }
}

/**
 * The deal office: a glass-fronted room east of the lobby, in the unit next door (its front half is rebuilt as the office). `OFFICE_DOOR` is
 * the doorway cut in the lobby's east wall. The VIP stands behind the desk and faces the door (−x); you stand on the lobby side.
 */
export const OFFICE_DOOR = { z: 2.4, halfWidth: 0.8, height: 2.2 }
export const OFFICE = {
  minX: 6.3,
  maxX: 12.4,
  minZ: -0.8,
  maxZ: 5.6,
  desk: { x: 10.2, z: 2.4, width: 0.9, length: 2.4, height: 0.78 },
  vip: { x: 11.2, z: 2.4 },
}

/**
 * The warehouse extension, south-east of the shop. The shed is built right against the south hall's east wall (no gap: the hall's door at
 * `door` opens straight into it) and reaches north to the back of the east annex. Inside: a cross aisle from the hall door to the docks, four
 * pallet racks along it (two at first, one more per capacity upgrade), the cold racks and the vault cage along the south wall (the underground vault below),
 * each with its own rack, and painted lanes the warehouse robots follow. Three loading docks in the east wall open onto the truck yard: a
 * private yard with its own way in and out from the service road, so trucks turn in, drive down the yard, back into a dock, and leave by the
 * yard's south exit. The service road joins the main street (z = 10).
 */
export const WAREHOUSE = {
  door: { z: -18.2, halfWidth: 0.8, height: 2.2 },
  minX: 6.2,
  maxX: 24.0,
  minZ: -31,
  maxZ: -9.4,
  height: 7.0,
  /** Loading docks in the east wall: a roller door each, which opens for a docked truck or when you walk up. */
  docks: { z: [-12.0, -16.8, -21.6, -26.4], halfWidth: 1.6, height: 3.6 },
  /**
   * The truck yard east of the docks. Trucks come down the road, turn in at `inZ`, drive south down `aisleX`, back into their dock in an arc
   * of radius `turn`, and leave by driving out and down to `outZ`, back onto the road.
   */
  yard: { minX: 24.2, maxX: 42, minZ: -40, maxZ: -2.5, aisleX: 36.1, inZ: -6, outZ: -36.5, turn: 7 },
  /** The service road: southbound lane `laneX` (the trucks), the other lane for the police. */
  road: { minX: 42, maxX: 48, minZ: -90, maxZ: 10.2, laneX: 43.5, upLaneX: 46.5 },
  /**
   * Racks run along x (4 bays of `pitch`, 3 shelves): the shelves' racks in the order they are bought (3 to start with, then 1 per
   * capacity upgrade). `lane` is the robot lane their crates are reached from.
   */
  rack: { bays: 4, pitch: 1.2, levels: [0.12, 1.02, 1.92] },
  shelves: [
    { z: -16.0, x0: 9.0, lane: -18.2 },
    { z: -20.4, x0: 9.0, lane: -18.2 },
    { z: -20.4, x0: 14.4, lane: -18.2 },
    { z: -16.0, x0: 14.4, lane: -18.2 },
    { z: -22.8, x0: 9.0, lane: -25.0 },
    { z: -22.8, x0: 14.4, lane: -25.0 },
    // Warehouse level 3 (the first new hall), then level 4.
    { z: -34.0, x0: 9.0, lane: -36.2 },
    { z: -38.4, x0: 9.0, lane: -36.2 },
    { z: -34.0, x0: 14.4, lane: -36.2 },
    { z: -38.4, x0: 14.4, lane: -36.2 },
    { z: -46.0, x0: 9.0, lane: -48.2 },
    { z: -50.4, x0: 9.0, lane: -48.2 },
    { z: -46.0, x0: 14.4, lane: -48.2 },
    { z: -50.4, x0: 14.4, lane: -48.2 },
  ],
  /** How many of `shelves` there are at the start, and after each upgrade that adds racks. */
  startRacks: 4,
  /**
   * The new halls (warehouse levels 3 and 4) built onto the south, one after the other: their interiors (same width as the shed), the robot
   * lane down the middle, and the doorway into each (in the wall to its north), which the west lane runs through.
   */
  halls: [
    { minZ: -42.8, maxZ: -31.2, lane: -36.2 },
    { minZ: -54.6, maxZ: -43.0, lane: -48.2 },
  ],
  hallDoor: { minX: 6.6, maxX: 8.2, height: 2.8 },
  /** The rooms along the south wall (interiors); each has a door in its north wall and a rack along its south wall. */
  cold: { minX: 10.8, maxX: 15.6, minZ: -31, maxZ: -26.6, pitch: 1.0 },
  vault: { minX: 16.2, maxX: 20.4, minZ: -31, maxZ: -26.6, pitch: 0.9 },
  /** Robot lanes (painted on the floor): the cross aisle, the south aisle, the dock lane, a west link, and the lane inside each room. */
  lanes: { cross: -18.2, south: -25.0, dock: 22.0, west: 7.4, room: -28.4, north: -11.0 },
  /** Where the robots wait and charge. */
  /** Where the robots wait and charge: two by the south wall, robots 3 and 4 at the east end of the level 3 hall. */
  robotHomes: [
    [21.2, -29.8],
    [23, -29.8],
    [21.4, -36.2],
    [22.9, -36.2],
  ] as [number, number][],
  /** The receiving desk, by the docks. */
  desk: { x: 19.8, z: -11.4 },
}

/**
 * The underground vault (the `hidden` section): a small concrete room under the warehouse's south-west corner, reached through a sliding
 * hatch in the floor (`hatch`, covered by a mat the colour of the floor) and a ladder down its north side. Its rack is along the south wall;
 * a small storage room opens off its east side. Only the player goes down there.
 */
export const UNDERGROUND = {
  minX: 6.6,
  maxX: 10.6,
  minZ: -31,
  maxZ: -26.4,
  floorY: -3.2,
  ceilingY: -1.0,
  hatch: { minX: 8.8, maxX: 10.0, minZ: -27.6, maxZ: -26.4 },
  ladder: { x: 9.4, z: -26.55 },
  /** Where you stand after climbing: at the foot of the ladder, and on the warehouse floor beside the hatch. */
  bottom: { x: 9.4, z: -27.05 },
  top: { x: 9.4, z: -28.15 },
  rack: { z: -30.25, x0: 6.8, bays: 4, pitch: 0.9, levels: [0.1, 0.8, 1.5] },
  closet: { minX: 10.6, maxX: 12.8, minZ: -29.8, maxZ: -26.4, doorZ: [-28.3, -27.3] as [number, number] },
} as const

/** Where the contact stands while he waits: just inside the warehouse door from the south hall, clear of the robot lanes. */
export const CONTACT_SPOT = { x: 6.95, z: -16.5 }

/**
 * The meteor's lake, west of the shop: a round crater (centre `x`, `z`, radius `r`, `depth` deep) that fills with water. The road
 * (`road`) runs from the main street's west end down to a hard-standing (`apron`) on its north shore, and the pier (`pier`) goes out
 * from there into the water.
 */
export const LAKE = {
  x: -36,
  z: -24,
  r: 13,
  depth: 3.2,
  /** How far below the ground the water settles once full. */
  waterDrop: 0.28,
  road: { minX: -31, maxX: -25, minZ: -6, maxZ: 10.25 },
  apron: { minX: -42, maxX: -25, minZ: -10.6, maxZ: -4 },
  pier: { x: -36, halfWidth: 1.5, fromZ: -10.6, toZ: -20 },
} as const

/** The supplier catalogue desk, in the back-right corner of the staff area. */
export const CATALOGUE_DESK = { x: 4.75, z: -1.9, width: 1.3, depth: 0.7, height: 0.78 }

/** How far you can reach to use something. */
export const REACH = { default: 2.4, customer: 3.2 }

/**
 * Building expansion, phase 2: grow backwards (south). The south hall lies behind the storage room's back wall, entered
 * through a doorway in the gap between the first two locker banks. Its lockers stand in ROWS (two rows of three banks side
 * by side, doors facing the entrance, with an aisle between the rows) and its key racks hang on the old back wall.
 * Floors 1 and 2 are the same hall stacked on top, reached by two flights of stairs along the east wall.
 *
 *    z = -9.2   ── old back wall (doorway at x = -2.15, key racks on its south face) ──────────
 *    z = -12.4  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  row 1 (lockers face north)                     stairs →  ▲
 *    z = -15.4  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  row 2                                          (x 4.5–6.0)
 *    z = -21    ── far wall ────────────────────────────────────────────────────────────────
 */
export const FLOOR_HEIGHT = 3.5 // a 3.2 m room plus a 0.3 m slab
export const SLAB = FLOOR_HEIGHT - ROOM.height
export const SOUTH = {
  minX: ROOM.minX,
  maxX: ROOM.maxX,
  /** Interior, from the far wall to the south face of the old back wall. */
  minZ: -21,
  maxZ: ROOM.minZ - 0.2,
  /** The doorway cut in the old back wall (between locker banks 1 and 0). */
  door: { x: -2.15, halfWidth: 0.7, height: 2.2 },
  /** Fronts (door faces) of the two rows; each row is three banks side by side. */
  // Floor 1 uses all three rows (it makes up for the west annex that the conveyor replaced); the others use the first two.
  rowFrontZ: [-12.4, -15.4, -18.4],
  bankX: [-4.5, -1.6, 1.3],
  /** Five key racks along the old back wall (they avoid the doorway). */
  rackX: [-4.7, -0.55, 0.85, 2.25, 3.65],
  rackZ: ROOM.minZ - 0.2 - 0.12,
} as const

/**
 * The occupancy board in each tall hall: on the north wall (the old back wall on the ground), beside the arm console, clear of
 * the doorway into the storage room (x = -2.15). (x, y, z) is the centre; it faces into the hall.
 */
export const OCCUPANCY_BOARD = { x: -3.95, y: 1.7, z: SOUTH.maxZ - 0.03, width: 1.8 } as const

/**
 * Two flights of stairs along the east wall, both climbing towards the north wall (+z), ending at the edge of the stairwell
 * hole so you walk straight off onto the floor above (a landing at least 1.7 m deep). Steps are 0.25 m high and 0.3 m deep
 * (the character controller auto-steps 0.38 m). Flight 0 goes ground → floor 1, flight 1 goes floor 1 → floor 2.
 */
export const STAIRS = {
  // The steps run from x = 4.5 to the east wall at x = 6.0 (no gap between the stairs and the wall).
  x: 5.25,
  width: 1.5,
  steps: 14,
  rise: 0.25,
  tread: 0.3,
  flights: [
    // Each flight ends 1.7 m or more from the north wall, so you step straight off the top onto a landing of the floor above.
    { baseY: 0, startZ: -15.1 },
    { baseY: FLOOR_HEIGHT, startZ: -19.3 },
  ],
  /** The open west side of a flight is closed by a guard wall for this many steps (the last two stay open, the exit is straight ahead). */
  guardX: 4.45,
  guardSteps: 12,
} as const

/**
 * The player's slope limits (degrees). The stairs climb at about 40°, so the character controller must be allowed to climb
 * steeper than its old 38° limit, and must not start sliding until well beyond that.
 */
export const SLOPE_LIMITS = { maxClimbDeg: 50, minSlideDeg: 58 }

/** The stairwell hole in the ceiling above `flight` (x and z extents). */
export function stairHole(flight: number): { x0: number; x1: number; z0: number; z1: number } {
  const f = STAIRS.flights[flight] ?? STAIRS.flights[0]
  return {
    x0: STAIRS.x - STAIRS.width / 2,
    x1: STAIRS.x + STAIRS.width / 2,
    z0: f.startZ,
    z1: f.startZ + STAIRS.steps * STAIRS.tread,
  }
}

/** Parts of the building. Only the zone you are in and its neighbours are drawn (see Engine.applyZoneVisibility). */
export type Zone = 'main' | 'west' | 'east' | 'office' | 'warehouse' | 'south' | 'floor1' | 'floor2'

/** Which zone a player is in, from their position (`feetY` = height of their feet above the ground floor). */
export function zoneAt(x: number, z: number, feetY: number): Zone {
  if (feetY > 2 * FLOOR_HEIGHT - 0.9) return 'floor2'
  if (feetY > FLOOR_HEIGHT - 0.9) return 'floor1'
  if (z < ROOM.minZ - 0.2 && x > ROOM.minX - 0.2 && x < ROOM.maxX + 0.2) return 'south'
  if (x < ROOM.minX - 0.2) return 'west'
  // Outside, east of the east annex: the yard, the road and the parking, which belong to the warehouse.
  if (x > ANNEX.east.maxX + 0.2 && z < OFFICE.minZ - 0.2) return 'warehouse'
  if (x > ROOM.maxX + 0.2) return z > OFFICE.minZ - 0.2 ? 'office' : z < ROOM.minZ - 0.4 ? 'warehouse' : 'east'
  return 'main'
}

/** Zones you can see into from each zone (through doorways and stairwells). */
export const ADJACENT_ZONES: Record<Zone, readonly Zone[]> = {
  main: ['west', 'east', 'south', 'office'],
  office: ['main', 'warehouse'],
  // West of the shop is open ground (and later the lake): from there you see the tower over the roofs.
  west: ['main', 'south', 'floor1', 'floor2'],
  east: ['main', 'warehouse'],
  // The three halls are one tower: the floor of floor 1 is the ceiling slab of the south hall, and you look down stairwells
  // to the floors below, so anywhere in the tower you must be able to see all of it.
  south: ['main', 'floor1', 'floor2', 'warehouse', 'west'],
  // From the shed and its yard you can see the halls (through the door) and the east side of the shop.
  warehouse: ['south', 'east', 'office', 'floor1', 'floor2'],
  // Their east windows look out over the warehouse roof.
  floor1: ['south', 'floor2', 'warehouse', 'west'],
  floor2: ['floor1', 'south', 'warehouse', 'west'],
}
