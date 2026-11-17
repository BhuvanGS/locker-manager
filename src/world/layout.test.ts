import { describe, expect, it } from 'vitest'
import {
  ADJACENT_ZONES,
  BAY,
  CONSOLES,
  CONVEYOR,
  FLOOR_HEIGHT,
  LOCKER,
  LOCKER_BANKS,
  lockerSlot,
  PARTITION,
  ROOM,
  SLOPE_LIMITS,
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
    expect(rows).toHaveLength(3) // floor 1 uses all three, the other halls the first two
    const depth = LOCKER.depth + 0.02
    expect(rows[0]! - depth - rows[1]!).toBeGreaterThanOrEqual(2) // aisle between the rows
    expect(rows[1]! - depth - rows[2]!).toBeGreaterThanOrEqual(2)
    expect(rows[2]! - depth - SOUTH.minZ).toBeGreaterThanOrEqual(1.5) // behind the last row
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

  it('both stairwells fit inside the hall, do not overlap, and have a landing at the top and room to approach at the bottom', () => {
    const a = stairHole(0)
    const b = stairHole(1)
    for (const hole of [a, b]) {
      expect(hole.x1).toBeCloseTo(SOUTH.maxX) // the steps touch the east wall: no gap
      expect(hole.x1 - hole.x0).toBeCloseTo(STAIRS.width)
      expect(SOUTH.maxZ - hole.z1).toBeGreaterThanOrEqual(1.5) // a landing to step off onto at the top
      expect(hole.z0 - SOUTH.minZ).toBeGreaterThanOrEqual(1.5) // room to walk up to the first step
    }
    expect(b.z1).toBeLessThanOrEqual(a.z0 + 1e-6) // flight 2 is entirely south of flight 1
  })

  it('the stairs are gentle enough for the character controller to climb, and well short of where it would slide', () => {
    const angle = (Math.atan2(STAIRS.steps * STAIRS.rise, STAIRS.steps * STAIRS.tread) * 180) / Math.PI
    expect(angle).toBeLessThan(SLOPE_LIMITS.maxClimbDeg - 5)
    expect(SLOPE_LIMITS.minSlideDeg).toBeGreaterThan(SLOPE_LIMITS.maxClimbDeg)
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
      for (const other of neighbours) expect(ADJACENT_ZONES[other as keyof typeof ADJACENT_ZONES]).toContain(zone)
    }
  })

  it('from anywhere in the tower you see the whole tower (the floor of floor 1 is the ceiling of the south hall)', () => {
    // Regression: from floor 2 the south hall was hidden, so floor 1 had no floor and the grass showed through the stairwell.
    for (const zone of ['south', 'floor1', 'floor2'] as const) {
      const visible = new Set([zone, ...ADJACENT_ZONES[zone]])
      for (const part of ['south', 'floor1', 'floor2'] as const) expect(visible.has(part)).toBe(true)
    }
  })
})

describe('Conveyor layout', () => {
  it('the belts fit in the staff area and the storage room, and pass through the partition hatch', () => {
    for (const x of [CONVEYOR.inX, CONVEYOR.outX]) {
      expect(x - CONVEYOR.width / 2).toBeGreaterThanOrEqual(CONVEYOR.hatch.minX)
      expect(x + CONVEYOR.width / 2).toBeLessThanOrEqual(CONVEYOR.hatch.maxX)
    }
    expect(CONVEYOR.startZ).toBeGreaterThan(PARTITION.z)
    expect(CONVEYOR.endZ).toBeLessThan(PARTITION.z)
    expect(CONVEYOR.hatch.height).toBeGreaterThan(CONVEYOR.topY + 0.3) // a bag fits through
    expect(CONVEYOR.hatch.minX).toBeGreaterThan(ROOM.minX + 0.3)
  })

  it('the belt leaves the aisle in front of the lockers clear, and the arm rail is above head height', () => {
    expect(CONVEYOR.endZ).toBeGreaterThan(LOCKER.frontZ + 1.2) // room for the door swing and the player
    expect(CONVEYOR.rail.y).toBeGreaterThan(2.4)
    expect(CONVEYOR.rail.y).toBeLessThan(ROOM.height)
    expect(CONVEYOR.rail.z).toBeGreaterThan(LOCKER.frontZ + 0.5)
  })

  it('the arm can reach every locker of the storage-room banks along its rail', () => {
    for (let bank = 0; bank < 3; bank++) {
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 3; col++) {
          const slot = lockerSlot(bank, row, col)
          expect(slot.x).toBeGreaterThan(CONVEYOR.rail.minX)
          expect(slot.x).toBeLessThan(CONVEYOR.rail.maxX)
          expect(CONVEYOR.rail.z - slot.z).toBeLessThan(1.6) // a reach of well under two metres
        }
      }
    }
  })
})

describe('The bay and the consoles in the tall halls', () => {
  it('the bay belts stop well short of the stairs, so you can walk to the foot of every flight', () => {
    const gap = STAIRS.guardX - 0.04 - BAY.maxX // the corridor beside the end of the belts
    expect(gap).toBeGreaterThanOrEqual(0.95) // the player is 0.76 m wide
    // The flight's approach pocket (south of its first step) is reached down that corridor.
    expect(STAIRS.flights[1].startZ - SOUTH.minZ).toBeGreaterThanOrEqual(1.5)
  })

  it('the bay fits behind the last row of floor 1, and the arms pick up over the belts', () => {
    const depth = LOCKER.depth + 0.02
    const lastRowBack = SOUTH.rowFrontZ[2]! - depth
    expect(BAY.inZ + CONVEYOR.width / 2 + 0.05).toBeLessThan(lastRowBack) // the first belt clears the third row
    expect(BAY.outZ - CONVEYOR.width / 2 - 0.05).toBeGreaterThan(SOUTH.minZ) // the second belt is inside the far wall
    for (const x of BAY.spotX) {
      expect(x).toBeGreaterThan(BAY.minX)
      expect(x).toBeLessThan(BAY.maxX)
    }
    for (const x of BAY.laneX) expect(x).toBeGreaterThan(BANK_HALF + SOUTH.bankX[2]!) // the runways run beside the banks, not over them
  })

  it('the hall console is in an aisle, clear of the corridor, the stairs and the lockers', () => {
    const c = CONSOLES.hall
    expect(c.x).toBeLessThan(SOUTH.bankX[0]! - BANK_HALF + 0.5) // at the west end of the aisle
    const aisleTop = SOUTH.rowFrontZ[0]! - LOCKER.depth - 0.02 // the back of the first row
    const aisleBottom = SOUTH.rowFrontZ[1]! // the front of the second row
    expect(c.z).toBeLessThan(aisleTop - 0.5)
    expect(c.z).toBeGreaterThan(aisleBottom + 0.5)
  })
})
