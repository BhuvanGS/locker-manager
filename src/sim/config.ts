/**
 * Tunable numbers in one place. Customer pacing is data-driven: later milestones add stages here
 * rather than hardcoding timers in code.
 */

export interface ArrivalStage {
  id: string
  /** Total customers introduced by this stage. */
  customers: number
  /** Seconds after the stage starts before the first arrival. */
  firstArrivalDelay: number
  /** Seconds between further arrivals [min, max]. */
  arrivalGap: [number, number]
  /** Seconds between finishing a deposit and the customer coming back [min, max]. */
  returnAfter: [number, number]
}

export const CONFIG = {
  facility: {
    lockerRows: 2,
    lockerCols: 3,
    keyHooks: 8,
  },
  /** Milestone 1: one tutorial customer who returns exactly two minutes after depositing. */
  stages: [
    {
      id: 'tutorial',
      customers: 1,
      firstArrivalDelay: 4,
      arrivalGap: [0, 0],
      returnAfter: [120, 120],
    },
  ] satisfies ArrivalStage[],
  economy: {
    startingMoney: 50,
    depositFee: 15,
    /** Extra tip at 100 satisfaction, scaled down linearly. */
    maxTip: 5,
    startingReputation: 50,
    xp: { deposit: 20, correctReturn: 30 },
    wrongItemReputation: -8,
    wrongItemSatisfaction: -25,
  },
  customer: {
    /** Seconds a customer will wait at the counter (patience only drains from Milestone 2). */
    patience: 180,
  },
  /** Seconds you fumble after trying the wrong key. */
  wrongKeyDelay: 1.2,
} as const
