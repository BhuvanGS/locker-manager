import { CONFIG, type ArrivalStage } from './config'
import type { CustomerId } from './types'

/**
 * Decides when new customers arrive, how long until deposited customers return, and when the shop
 * moves on to the next traffic stage. It never touches the clock: it returns delays and the
 * GameManager schedules them.
 */
export class CustomerScheduler {
  private readonly stages: readonly ArrivalStage[]
  private readonly rand: () => number
  private stageIndex = 0
  /** Customers arrive this many times faster (grows with player level). */
  pace = 1
  private readonly introduced: CustomerId[] = []
  private readonly finished = new Set<CustomerId>()

  constructor(stages: readonly ArrivalStage[], rand: () => number) {
    this.stages = stages
    this.rand = rand
  }

  get stage(): ArrivalStage {
    const stage = this.stages[this.stageIndex]
    if (!stage) throw new Error('No stages configured')
    return stage
  }

  get stageNumber(): number {
    return this.stageIndex + 1
  }

  /** Delay before the next new customer, or null when this stage has introduced everyone. */
  nextArrivalDelay(): number | null {
    const stage = this.stage
    if (stage.customers !== null && this.introduced.length >= stage.customers) return null
    if (this.introduced.length === 0) return stage.firstArrivalDelay
    // Mostly an ordinary random gap, sometimes a quick burst so arrivals never feel evenly spaced.
    if (stage.burstGap && this.rand() < (stage.burstChance ?? 0)) return this.between(stage.burstGap) / this.pace
    return this.between(stage.arrivalGap) / this.pace
  }

  /** Record that a customer was created for this stage. */
  introduce(id: CustomerId): void {
    this.introduced.push(id)
  }

  belongsToStage(id: CustomerId): boolean {
    return this.introduced.includes(id)
  }

  /** Jump straight to the next traffic stage (mod menu). Returns false when already on the last one. */
  skipStage(): boolean {
    if (this.stageIndex >= this.stages.length - 1) return false
    this.stageIndex += 1
    this.introduced.length = 0
    this.finished.clear()
    return true
  }

  /**
   * Seconds until a customer who just deposited returns. `pending` holds the absolute return times of
   * customers already stored: half the time the new customer is slotted in just ahead of one of them, so
   * people do not simply come back in the order they left. Always stays inside the stage's window.
   */
  returnDelay(now = 0, pending: readonly number[] = []): number {
    const [min, max] = this.stage.returnAfter
    if (max <= min) return min
    // Only return times far enough away that we can undercut one without going below the minimum wait.
    const candidates = pending.filter((at) => at - now > min + CONFIG.returns.undercut[0])
    if (candidates.length > 0 && this.rand() < CONFIG.returns.overtakeChance) {
      const target = candidates[Math.floor(this.rand() * candidates.length)] ?? now + max
      const delay = target - now - this.between(CONFIG.returns.undercut)
      return Math.min(max, Math.max(min, delay))
    }
    return this.between([min, max])
  }

  /**
   * Note a finished customer. Returns true if that completed the stage and the next one started.
   * Open-ended stages never complete.
   */
  finish(id: CustomerId): boolean {
    if (!this.belongsToStage(id)) return false
    this.finished.add(id)
    const stage = this.stage
    if (stage.customers === null || this.introduced.length < stage.customers) return false
    if (!this.introduced.every((c) => this.finished.has(c))) return false
    if (this.stageIndex >= this.stages.length - 1) return false
    this.stageIndex += 1
    this.introduced.length = 0
    this.finished.clear()
    return true
  }

  private between([min, max]: readonly [number, number]): number {
    return min + (max - min) * this.rand()
  }
}
