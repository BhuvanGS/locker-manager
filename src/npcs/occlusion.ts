import type { Occluder } from './types'

/** True when the segment A→B passes through any occluder box (houses, fences). */
export function segmentHitsOccluder(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  occluders: Occluder[],
): boolean {
  const dx = bx - ax
  const dy = by - ay
  const dz = bz - az
  const len = Math.hypot(dx, dy, dz)
  if (len < 0.001) return false
  const inv = 1 / len
  const dirX = dx * inv
  const dirY = dy * inv
  const dirZ = dz * inv
  const reach = len * 0.92
  for (const box of occluders) {
    if (rayHitsAabb(ax, ay, az, dirX, dirY, dirZ, reach, box)) return true
  }
  return false
}

function rayHitsAabb(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  reach: number,
  box: Occluder,
): boolean {
  let tmin = 0
  let tmax = reach
  const origin = [ox, oy, oz]
  const dir = [dx, dy, dz]
  const center = [box.center.x, box.center.y, box.center.z]
  const half = [box.half.x, box.half.y, box.half.z]
  for (let i = 0; i < 3; i++) {
    const o = origin[i] ?? 0
    const d = dir[i] ?? 0
    const min = (center[i] ?? 0) - (half[i] ?? 0)
    const max = (center[i] ?? 0) + (half[i] ?? 0)
    if (Math.abs(d) < 1e-8) {
      if (o < min || o > max) return false
      continue
    }
    let t1 = (min - o) / d
    let t2 = (max - o) / d
    if (t1 > t2) {
      const swap = t1
      t1 = t2
      t2 = swap
    }
    tmin = Math.max(tmin, t1)
    tmax = Math.min(tmax, t2)
    if (tmin > tmax) return false
  }
  return tmax > 0
}
