import { CONFIG } from './config'

/**
 * The late-game event. Once every upgrade is bought a countdown starts ("something big is coming"); when it runs out a meteor strikes
 * west of the shop, its crater fills with water over `fillSeconds`, and the lake can then be reached by a road and given a small dock
 * (both bought at the control hub). Pure state on game time: the 3D view draws it from `phase`, `impactAt` and `waterLevel`.
 */
export type MeteorPhase = 'waiting' | 'countdown' | 'filling' | 'lake'

export class MeteorEvent {
  phase: MeteorPhase = 'waiting'
  startedAt: number | null = null
  impactAt: number | null = null
  filledAt: number | null = null
  road = false
  dock = false

  /** Start the countdown (all upgrades bought, or the mod menu). */
  start(now: number, seconds = CONFIG.meteor.countdownSeconds): void {
    if (this.phase !== 'waiting') return
    this.phase = 'countdown'
    this.startedAt = now
    this.impactAt = now + seconds
  }

  /** Bring the impact forward to `seconds` from now (mod menu). */
  hurry(now: number, seconds: number): boolean {
    if (this.phase !== 'countdown' || this.impactAt === null || this.impactAt - now <= seconds) return false
    this.impactAt = now + seconds
    return true
  }

  /** Seconds until impact, while counting down. */
  timeLeft(now: number): number | null {
    return this.phase === 'countdown' && this.impactAt !== null ? Math.max(0, this.impactAt - now) : null
  }

  /** How full the crater is, 0 (just hit) to 1 (a lake); 0 before the impact. */
  waterLevel(now: number): number {
    if (this.phase === 'lake') return 1
    if (this.phase !== 'filling' || this.impactAt === null) return 0
    return Math.min(1, Math.max(0, (now - this.impactAt) / CONFIG.meteor.fillSeconds))
  }

  /** The crater exists (the meteor has hit). */
  get struck(): boolean {
    return this.phase === 'filling' || this.phase === 'lake'
  }

  /** Advance on game time; returns what just happened. */
  update(now: number): 'impact' | 'filled' | null {
    if (this.phase === 'countdown' && this.impactAt !== null && now >= this.impactAt) {
      this.phase = 'filling'
      this.filledAt = this.impactAt + CONFIG.meteor.fillSeconds
      return 'impact'
    }
    if (this.phase === 'filling' && this.filledAt !== null && now >= this.filledAt) {
      this.phase = 'lake'
      return 'filled'
    }
    return null
  }

  /** Skip straight to the finished lake (mod menu grants). */
  forceLake(now: number): void {
    if (this.phase === 'lake') return
    this.startedAt ??= now
    this.impactAt ??= now
    this.filledAt = now
    this.phase = 'lake'
  }
}
