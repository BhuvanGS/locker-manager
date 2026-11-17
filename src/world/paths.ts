/**
 * Paths for vehicles and robots on the ground plane: polylines with rounded corners, walked by distance, with a heading that follows the
 * direction of travel (reversed for legs driven backwards). Models face −z, so `yaw` is the rotation.y that points a model's nose along it.
 */

export type Pose = { x: number; z: number; yaw: number }
type Pt = { x: number; z: number }

/** One stretch driven in one direction: forwards, or backwards (`reverse`). */
export class Leg {
  readonly pts: Pt[]
  private readonly s: number[]
  readonly length: number
  readonly reverse: boolean

  constructor(points: Pt[], reverse = false) {
    this.reverse = reverse
    this.pts = points.length > 1 ? points : [points[0]!, points[0]!]
    this.s = [0]
    for (let i = 1; i < this.pts.length; i++) this.s.push(this.s[i - 1]! + Math.hypot(this.pts[i]!.x - this.pts[i - 1]!.x, this.pts[i]!.z - this.pts[i - 1]!.z))
    this.length = this.s[this.s.length - 1]!
  }

  /** The pose `u` (0…1) of the way along. */
  at(u: number): Pose {
    const d = Math.min(1, Math.max(0, u)) * this.length
    let i = 1
    while (i < this.pts.length - 1 && this.s[i]! < d) i++
    const a = this.pts[i - 1]!
    const b = this.pts[i]!
    const span = this.s[i]! - this.s[i - 1]! || 1
    const f = Math.min(1, Math.max(0, (d - this.s[i - 1]!) / span))
    let dx = b.x - a.x
    let dz = b.z - a.z
    if (Math.hypot(dx, dz) < 1e-6) {
      dx = 0
      dz = -1
    }
    if (this.reverse) {
      dx = -dx
      dz = -dz
    }
    return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, yaw: Math.atan2(-dx, -dz) }
  }
}

/** A polyline through `corners` with each inner corner rounded off (radius `radius`, or less if a side is too short). */
export function rounded(corners: readonly (readonly [number, number])[], radius: number, reverse = false): Leg {
  const out: Pt[] = [{ x: corners[0]![0], z: corners[0]![1] }]
  for (let i = 1; i < corners.length - 1; i++) {
    const [px, pz] = corners[i - 1]!
    const [cx, cz] = corners[i]!
    const [nx, nz] = corners[i + 1]!
    const l0 = Math.hypot(cx - px, cz - pz)
    const l1 = Math.hypot(nx - cx, nz - cz)
    const r = Math.min(radius, l0, l1)
    const t0 = { x: cx - ((cx - px) / l0) * r, z: cz - ((cz - pz) / l0) * r }
    const t1 = { x: cx + ((nx - cx) / l1) * r, z: cz + ((nz - cz) / l1) * r }
    out.push(t0)
    // A quadratic curve through the corner is close enough to a circular arc for a 90° turn.
    for (let k = 1; k <= 12; k++) {
      const t = k / 12
      const m = 1 - t
      out.push({ x: m * m * t0.x + 2 * m * t * cx + t * t * t1.x, z: m * m * t0.z + 2 * m * t * cz + t * t * t1.z })
    }
  }
  const last = corners[corners.length - 1]!
  out.push({ x: last[0], z: last[1] })
  return new Leg(out, reverse)
}

const smooth = (u: number): number => u * u * (3 - 2 * u)

/**
 * Several legs driven one after the other in a fixed time: each leg gets a share of the time by its length (reversing is slower), and
 * the vehicle eases in and out of each leg, so it stops where it changes direction.
 */
export class Route {
  private readonly weights: number[]
  private readonly total: number
  readonly legs: Leg[]

  constructor(legs: Leg[]) {
    this.legs = legs
    this.weights = legs.map((l) => Math.max(0.01, l.length * (l.reverse ? 1.7 : 1)))
    this.total = this.weights.reduce((a, b) => a + b, 0)
  }

  at(p: number): Pose {
    let acc = 0
    for (let i = 0; i < this.legs.length; i++) {
      const share = this.weights[i]! / this.total
      if (p <= acc + share || i === this.legs.length - 1) return this.legs[i]!.at(smooth(Math.min(1, Math.max(0, (p - acc) / share))))
      acc += share
    }
    return this.legs[0]!.at(0)
  }
}
