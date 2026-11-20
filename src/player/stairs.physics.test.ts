import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { InputSnapshot } from '../engine/InputManager'
import { PhysicsWorld } from '../engine/PhysicsWorld'
import { FLOOR_HEIGHT, STAIRS, stairHole } from '../world/layout'
import { Stairs } from '../world/Stairs'
import { PlayerController } from './PlayerController'

/**
 * These run the real Rapier physics and the real PlayerController, because "the stairs are buggy to climb" can only be
 * checked by actually walking up them.
 */
const idle: InputSnapshot = {
  forward: 0,
  right: 0,
  sprint: false,
  crouch: false,
  interactPressed: false,
  choice: null,
  menuMove: 0,
  confirmPressed: false,
  cancelPressed: false,
  pausePressed: false,
  modPressed: false,
  jumpPressed: false,
  mouseDeltaX: 0,
  mouseDeltaY: 0,
}

// With yaw = π: forward walks north (+z), right walks west (−x).
const YAW = Math.PI
const DT = 1 / 60
const HALF_HEIGHT = 0.875

async function setup(opts: { flight?: 0 | 1; slabAt?: number } = {}) {
  const physics = new PhysicsWorld()
  await physics.init()
  physics.addStaticBox(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(60, 0.5, 60)) // the ground (top at y = 0)
  if (opts.slabAt !== undefined) {
    // A floor slab (e.g. floor 1) under the second flight.
    physics.addStaticBox(new THREE.Vector3(0, opts.slabAt - 0.15, -15), new THREE.Vector3(6.2, 0.15, 6.2))
  }
  if (opts.flight !== undefined) new Stairs(opts.flight, physics)
  return physics
}

function spawn(physics: PhysicsWorld, x: number, feetY: number, z: number) {
  const player = new PlayerController(physics, new THREE.Vector3(x, 0, z))
  player.buildPhysics()
  player.teleport(x, z, feetY)
  return player
}

function feetY(player: PlayerController) {
  return player.getPosition().y - HALF_HEIGHT
}

/** Walk with `input` until `done()` or `maxSeconds`, recording the path. */
function walk(
  physics: PhysicsWorld,
  player: PlayerController,
  input: Partial<InputSnapshot>,
  maxSeconds: number,
  done: () => boolean = () => false,
) {
  const path: { y: number; z: number; x: number }[] = []
  for (let t = 0; t < maxSeconds; t += DT) {
    player.update({ ...idle, ...input }, YAW, DT)
    physics.step(DT)
    player.syncFromPhysics()
    const p = player.getPosition()
    path.push({ x: p.x, y: p.y - HALF_HEIGHT, z: p.z })
    if (done()) break
  }
  return path
}

const settle = (physics: PhysicsWorld, player: PlayerController) => walk(physics, player, {}, 0.5)

describe('Climbing the stairs', () => {
  it('walks up the first flight to the level of floor 1 without getting stuck', async () => {
    const physics = await setup({ flight: 0 })
    const { startZ } = STAIRS.flights[0]
    const player = spawn(physics, STAIRS.x, 0, startZ - 1.2)
    settle(physics, player)
    const top = stairHole(0).z1
    const path = walk(physics, player, { forward: 1 }, 8, () => player.getPosition().z > top - 0.35)
    expect(player.getPosition().z).toBeGreaterThan(top - 0.4) // it got to the top
    expect(feetY(player)).toBeGreaterThan(FLOOR_HEIGHT - 0.4)
    expect(feetY(player)).toBeLessThan(FLOOR_HEIGHT + 0.2)
    expect(path.length * DT).toBeLessThan(5) // 5 m of stairs in a few seconds, not stalled
  })

  it('climbs smoothly: no sudden jumps up, and steady forward progress', async () => {
    const physics = await setup({ flight: 0 })
    const { startZ } = STAIRS.flights[0]
    const player = spawn(physics, STAIRS.x, 0, startZ - 1.2)
    settle(physics, player)
    const top = stairHole(0).z1
    const path = walk(physics, player, { forward: 1 }, 8, () => player.getPosition().z > top - 0.35)
    let biggestStep = 0
    for (let i = 1; i < path.length; i++) biggestStep = Math.max(biggestStep, Math.abs(path[i]!.y - path[i - 1]!.y))
    expect(biggestStep).toBeLessThan(0.1) // glides: never a 0.25 m step-up in one frame
    const onStairs = path.filter((p) => p.z > startZ && p.z < top)
    expect(onStairs.length).toBeGreaterThan(30)
    const seconds = onStairs.length * DT
    expect(top - startZ - 0.7).toBeGreaterThan(0)
    expect((top - startZ) / seconds).toBeGreaterThan(1.8) // metres of stairs per second
    // The height rises steadily with distance along the stairs (no flat stalls or dips).
    for (let i = 10; i < onStairs.length; i++) expect(onStairs[i]!.y).toBeGreaterThanOrEqual(onStairs[i - 10]!.y - 0.02)
  })

  it('climbs the second flight from floor 1 to floor 2', async () => {
    const physics = await setup({ flight: 1, slabAt: FLOOR_HEIGHT })
    const { startZ } = STAIRS.flights[1]
    const player = spawn(physics, STAIRS.x, FLOOR_HEIGHT, startZ - 1.2)
    settle(physics, player)
    expect(feetY(player)).toBeCloseTo(FLOOR_HEIGHT, 0)
    const top = stairHole(1).z1
    walk(physics, player, { forward: 1 }, 8, () => player.getPosition().z > top - 0.35)
    expect(player.getPosition().z).toBeGreaterThan(top - 0.4)
    expect(feetY(player)).toBeGreaterThan(2 * FLOOR_HEIGHT - 0.4)
  })

  it('walks back down smoothly and stays on the ground afterwards (no falling or bouncing)', async () => {
    const physics = await setup({ flight: 0 })
    const top = stairHole(0).z1
    const player = spawn(physics, STAIRS.x, FLOOR_HEIGHT - 0.2, top - 0.5)
    settle(physics, player)
    expect(feetY(player)).toBeGreaterThan(2.5) // standing on the upper end of the ramp
    const startZ = STAIRS.flights[0].startZ
    const path = walk(physics, player, { forward: -1 }, 8, () => player.getPosition().z < startZ - 0.8)
    expect(feetY(player)).toBeLessThan(0.15)
    let biggestDrop = 0
    for (let i = 1; i < path.length; i++) biggestDrop = Math.max(biggestDrop, path[i - 1]!.y - path[i]!.y)
    expect(biggestDrop).toBeLessThan(0.12) // snaps to the ramp instead of free-falling
  })

  it('cannot step off the west side of the stairs (guard wall), nor into the east wall side', async () => {
    const physics = await setup({ flight: 0 })
    physics.addStaticBox(new THREE.Vector3(6.1, 2, -15), new THREE.Vector3(0.1, 2, 8)) // the hall's east wall (inner face x = 6.0)
    const { startZ } = STAIRS.flights[0]
    const player = spawn(physics, STAIRS.x, 1.6, startZ + 2.0)
    settle(physics, player)
    const path = walk(physics, player, { right: 1 }, 2) // walk west
    expect(Math.min(...path.map((p) => p.x))).toBeGreaterThan(STAIRS.guardX + 0.04 + 0.3)
    const east = walk(physics, player, { right: -1 }, 2) // walk east
    expect(Math.max(...east.map((p) => p.x))).toBeLessThan(6.0)
  })
})

describe('The top of the stairs', () => {
  it('you walk straight off the top onto the floor above and stay on it', async () => {
    const physics = await setup({ flight: 0 })
    const hole = stairHole(0)
    // The floor above north of the stairwell: a slab whose top is at floor 1 level.
    physics.addStaticBox(new THREE.Vector3(5.25, FLOOR_HEIGHT - 0.15, (hole.z1 + -9.0) / 2), new THREE.Vector3(0.75, 0.15, (-9.0 - hole.z1) / 2))
    const player = spawn(physics, STAIRS.x, 0, STAIRS.flights[0].startZ - 1.2)
    settle(physics, player)
    walk(physics, player, { forward: 1 }, 10, () => player.getPosition().z > hole.z1 + 0.9)
    expect(player.getPosition().z).toBeGreaterThan(hole.z1 + 0.5) // it is on the landing, past the last step
    expect(feetY(player)).toBeGreaterThan(FLOOR_HEIGHT - 0.2)
    expect(feetY(player)).toBeLessThan(FLOOR_HEIGHT + 0.2)
  })
})

describe('Jumping', () => {
  it('a jump rises about 0.85 m and lands again', async () => {
    const physics = await setup()
    const player = spawn(physics, 0, 0, 0)
    settle(physics, player)
    expect(feetY(player)).toBeLessThan(0.1)
    player.update({ ...idle, jumpPressed: true }, YAW, DT)
    physics.step(DT)
    player.syncFromPhysics()
    const path = walk(physics, player, {}, 2)
    const peak = Math.max(...path.map((p) => p.y))
    expect(peak).toBeGreaterThan(0.6)
    expect(peak).toBeLessThan(1.05)
    expect(feetY(player)).toBeLessThan(0.1) // back on the floor
  })

  it('you cannot jump again in mid-air', async () => {
    const physics = await setup()
    const player = spawn(physics, 0, 0, 0)
    settle(physics, player)
    const heights: number[] = []
    for (let i = 0; i < 90; i++) {
      // Hammer the jump key every frame: only the first (on the ground) should count.
      player.update({ ...idle, jumpPressed: true }, YAW, DT)
      physics.step(DT)
      player.syncFromPhysics()
      heights.push(feetY(player))
    }
    expect(Math.max(...heights)).toBeLessThan(1.05)
  })

  it('walking and jumping together moves you forward', async () => {
    const physics = await setup()
    const player = spawn(physics, 0, 0, 0)
    settle(physics, player)
    const before = player.getPosition().z
    player.update({ ...idle, forward: 1, jumpPressed: true }, YAW, DT)
    physics.step(DT)
    player.syncFromPhysics()
    walk(physics, player, { forward: 1 }, 0.6)
    expect(player.getPosition().z - before).toBeGreaterThan(1.5)
  })
})
