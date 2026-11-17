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
 * 1 and 2 are the "Locker bank B / C" upgrades, left and right of it (each is 2.82 m wide).
 */
export const LOCKER_BANKS = [{ centerX: 0 }, { centerX: -3.9 }, { centerX: 3.9 }]

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
