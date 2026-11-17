import type { ArrivalStage } from './config'

/**
 * Decides when new customers arrive and when deposited customers come back, from the stage config.
 * It never touches the clock directly: it returns times and the GameManager schedules them.
 */
export class CustomerScheduler {
  private readonly stages: readonly ArrivalStage[]
  private readonly rand: () => number
  private stageIndex = 0
  private introducedInStage = 0

  constructor(stages: readonly ArrivalStage[], rand: () => number) {
    this.stages = stages
    this.rand = rand
  }

  get stage(): ArrivalStage | null {
    return this.stages[this.stageIndex] ?? null
  }

  /** Delay before the next new customer, or null when the current stage has introduced everyone. */
  nextArrivalDelay(): number | null {
    const stage = this.stage
    if (!stage || this.introducedInStage >= stage.customers) return null
    const delay = this.introducedInStage === 0 ? stage.firstArrivalDelay : this.between(stage.arrivalGap)
    this.introducedInStage += 1
    return delay
  }

  /** Seconds until a customer who just deposited returns. */
  returnDelay(): number {
    const stage = this.stage
    return stage ? this.between(stage.returnAfter) : 120
  }

  /** Move on to the next stage (driven by progression in later milestones). */
  advanceStage(): boolean {
    if (this.stageIndex >= this.stages.length - 1) return false
    this.stageIndex += 1
    this.introducedInStage = 0
    return true
  }

  private between([min, max]: readonly [number, number]): number {
    return min + (max - min) * this.rand()
  }
}
