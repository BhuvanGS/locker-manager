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
  rowFrontZ: [-12.4, -15.4],
  bankX: [-4.5, -1.6, 1.3],
  /** Five key racks along the old back wall (they avoid the doorway). */
  rackX: [-4.7, -0.55, 0.85, 2.25, 3.65],
  rackZ: ROOM.minZ - 0.2 - 0.12,
} as const

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
export type Zone = 'main' | 'west' | 'east' | 'south' | 'floor1' | 'floor2'

/** Which zone a player is in, from their position (`feetY` = height of their feet above the ground floor). */
export function zoneAt(x: number, z: number, feetY: number): Zone {
  if (feetY > 2 * FLOOR_HEIGHT - 0.9) return 'floor2'
  if (feetY > FLOOR_HEIGHT - 0.9) return 'floor1'
  if (z < ROOM.minZ - 0.2 && x > ROOM.minX - 0.2 && x < ROOM.maxX + 0.2) return 'south'
  if (x < ROOM.minX - 0.2) return 'west'
  if (x > ROOM.maxX + 0.2) return 'east'
  return 'main'
}

/** Zones you can see into from each zone (through doorways and stairwells). */
export const ADJACENT_ZONES: Record<Zone, readonly Zone[]> = {
  main: ['west', 'east', 'south'],
  west: ['main'],
  east: ['main'],
  // The three halls are one tower: the floor of floor 1 is the ceiling slab of the south hall, and you look down stairwells
  // to the floors below, so anywhere in the tower you must be able to see all of it.
  south: ['main', 'floor1', 'floor2'],
  floor1: ['south', 'floor2'],
  floor2: ['floor1', 'south'],
}
