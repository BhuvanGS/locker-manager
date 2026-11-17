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
  /** Counter service spots, left to right; the first free one is used. */
  counterSpots: [new THREE.Vector3(0, 0, 2.05), new THREE.Vector3(-1.6, 0, 2.05), new THREE.Vector3(1.6, 0, 2.05)],
}

export const LOCKER = {
  width: 0.9,
  height: 0.9,
  depth: 0.6,
  gap: 0.04,
  /** Front face of the locker wall. */
  frontZ: ROOM.minZ + 0.62,
  baseY: 0.12,
  centerX: 0,
}

export const KEY_BOARD = {
  center: new THREE.Vector3(-2.6, 1.45, PARTITION.z + 0.12),
  width: 1.3,
  height: 0.62,
  cols: 4,
}

/** How far you can reach to use something. */
export const REACH = { default: 2.4, customer: 3.2 }
