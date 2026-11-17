import { describe, expect, it } from 'vitest'
import {
  ADJACENT_ZONES,
  FLOOR_HEIGHT,
  LOCKER,
  LOCKER_BANKS,
  ROOM,
  SOUTH,
  STAIRS,
  stairHole,
  zoneAt,
} from './layout'

/** Half-width of a bank's collider (3 lockers across plus a little frame). */
const BANK_HALF = (3 * (LOCKER.width + LOCKER.gap) + 0.08) / 2

/**
 * These check the numbers the 3D building relies on (rows fit inside the hall, the doorway fits between banks, the stairs
 * rise one floor and fit), because they cannot be seen without playing.
 */
describe('South expansion layout', () => {
  it('the doorway in the back wall fits exactly in the gap between locker banks 1 and 0', () => {
    const left = LOCKER_BANKS[1]!.centerX + BANK_HALF // right edge of bank 1
    const right = LOCKER_BANKS[0]!.centerX - BANK_HALF // left edge of bank 0
    const door = SOUTH.door
    expect(door.x - door.halfWidth).toBeGreaterThanOrEqual(left - 1e-6)
    expect(door.x + door.halfWidth).toBeLessThanOrEqual(right + 1e-6)
    expect(door.halfWidth * 2).toBeGreaterThanOrEqual(1.3) // the player is 0.76 m wide
  })

  it('banks 1 and 2 fit inside the storage room', () => {
    for (const bank of LOCKER_BANKS) {
      expect(bank.centerX - BANK_HALF).toBeGreaterThanOrEqual(ROOM.minX)
      expect(bank.centerX + BANK_HALF).toBeLessThanOrEqual(ROOM.maxX)
    }
  })

  it('each row of three banks fits in the hall and the banks touch (a row, not separate columns)', () => {
    const xs = SOUTH.bankX
    expect(xs).toHaveLength(3)
    expect(xs[0]! - BANK_HALF).toBeGreaterThanOrEqual(SOUTH.minX)
    for (let i = 1; i < 3; i++) {
      const gap = xs[i]! - BANK_HALF - (xs[i - 1]! + BANK_HALF)
      expect(gap).toBeGreaterThanOrEqual(-0.01)
      expect(gap).toBeLessThanOrEqual(0.1)
    }
  })

  it('there is room to walk: aisles between rows, behind the last row, and round the end of each row to the stairs', () => {
    const rows = SOUTH.rowFrontZ
    expect(rows).toHaveLength(2)
    const depth = LOCKER.depth + 0.02
    expect(rows[0]! - depth - rows[1]!).toBeGreaterThanOrEqual(2) // aisle between the rows
    expect(rows[1]! - depth - SOUTH.minZ).toBeGreaterThanOrEqual(1.5) // behind the last row
    expect(SOUTH.maxZ - rows[0]!).toBeGreaterThanOrEqual(2) // lobby between the doorway and the first row
    const rowEnd = SOUTH.bankX[2]! + BANK_HALF
    expect(STAIRS.guardX - 0.04 - rowEnd).toBeGreaterThanOrEqual(1) // corridor between the rows and the stairs
  })

  it('key racks stay clear of the doorway and inside the hall', () => {
    for (const x of SOUTH.rackX) {
      expect(Math.abs(x - SOUTH.door.x)).toBeGreaterThan(SOUTH.door.halfWidth + 0.65 + 0.1)
      expect(x - 0.65).toBeGreaterThanOrEqual(SOUTH.minX)
      expect(x + 0.65).toBeLessThanOrEqual(STAIRS.x - STAIRS.width / 2 + 0.01)
    }
    for (let i = 1; i < SOUTH.rackX.length; i++) expect(SOUTH.rackX[i]! - SOUTH.rackX[i - 1]!).toBeGreaterThanOrEqual(1.3) // racks are 1.3 m wide
  })
})

describe('Stairs', () => {
  it('each flight climbs exactly one floor, in steps the player can climb', () => {
    expect(STAIRS.steps * STAIRS.rise).toBeCloseTo(FLOOR_HEIGHT)
    expect(STAIRS.rise).toBeLessThanOrEqual(0.38) // the character controller auto-steps 0.38 m
    expect(STAIRS.tread).toBeGreaterThanOrEqual(0.2)
    expect(STAIRS.flights[1].baseY - STAIRS.flights[0].baseY).toBeCloseTo(FLOOR_HEIGHT)
  })

  it('both stairwells fit inside the hall, do not overlap, and leave a landing between them', () => {
    const a = stairHole(0)
    const b = stairHole(1)
    for (const hole of [a, b]) {
      expect(hole.z0).toBeGreaterThanOrEqual(SOUTH.minZ + 1)
      expect(hole.z1).toBeLessThanOrEqual(SOUTH.maxZ)
      expect(hole.x1).toBeLessThanOrEqual(SOUTH.maxX)
      expect(hole.x1 - hole.x0).toBeCloseTo(STAIRS.width)
    }
    expect(b.z1).toBeLessThan(a.z0) // flight 2 is entirely south of flight 1
    expect(a.z0 - b.z1).toBeGreaterThanOrEqual(0.3) // a landing between them
    expect(a.z1).toBeLessThan(SOUTH.maxZ - 0.3) // room for the top landing before the north wall
  })

  it('the top of each flight is level with the floor it arrives on', () => {
    for (const flight of STAIRS.flights) expect(flight.baseY + STAIRS.steps * STAIRS.rise).toBeCloseTo(flight.baseY + FLOOR_HEIGHT)
  })
})

describe('Zones', () => {
  it('works out where the player is', () => {
    expect(zoneAt(0, 2, 0)).toBe('main')
    expect(zoneAt(0, -5, 0)).toBe('main')
    expect(zoneAt(-10, -5, 0)).toBe('west')
    expect(zoneAt(10, -5, 0)).toBe('east')
    expect(zoneAt(0, -15, 0)).toBe('south')
    expect(zoneAt(-2.15, -9.5, 0)).toBe('south')
    expect(zoneAt(5, -12, 3.5)).toBe('floor1')
    expect(zoneAt(0, -15, 7)).toBe('floor2')
    expect(zoneAt(5, -12, 2.0)).toBe('south') // halfway up the first flight
  })

  it('every zone can see itself and its neighbours, and the neighbours are mutual', () => {
    for (const [zone, neighbours] of Object.entries(ADJACENT_ZONES)) {
      for (const other of neighbours) expect(ADJACENT_ZONES[other]).toContain(zone)
    }
  })
})
