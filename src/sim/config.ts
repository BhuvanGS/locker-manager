/**
 * Tunable numbers in one place. Customer pacing is data-driven: stages live here, never as timers in
 * code. Difficulty grows through overlap and decisions, not through faster walking or harsh timers.
 */

export interface ArrivalStage {
  id: string
  /** Shown in the banner when the stage starts (not shown for the first stage). */
  title: string
  intro: string
  /** New customers introduced by this stage; null = keeps going (open trading). */
  customers: number | null
  /** Seconds after the stage starts before the first arrival. */
  firstArrivalDelay: number
  /** Seconds between further arrivals [min, max]. */
  arrivalGap: [number, number]
  /** Chance (0–1) that an arrival comes in a quick burst after the previous one, using `burstGap`. */
  burstChance?: number
  burstGap?: [number, number]
  /**
   * Seconds between finishing a deposit and the customer coming back [min, max]. Each customer draws their
   * own time from this window, and it is kept wide so people come back in a different order from the one
   * they left in.
   */
  returnAfter: [number, number]
  /** Seconds a customer will wait to be served; null = endlessly patient (tutorial). */
  patience: number | null
  /**
   * Anti-boredom: if the shop has been completely empty (nobody inside) for this many seconds, the next
   * scheduled arrival or return is pulled forward so you are never left idle. Omit to disable.
   */
  maxIdle?: number
  /**
   * Most customers with business here at once (in the building or with an item stored). New arrivals
   * wait outside until there is room. Defaults to unlimited.
   */
  maxActive?: number
}

export interface UpgradeDef {
  id: string
  /**
   * lockerBank / keyRack add storage; labels numbers the lockers and tags the keys; register adds the wall
   * board listing who left what.
   */
  kind: 'lockerBank' | 'keyRack' | 'labels' | 'register' | 'digital' | 'conveyor' | 'annex' | 'hall'
  title: string
  description: string
  cost: number
  /** Level needed before it can be bought. */
  level: number
  /** Another upgrade that must be owned first. */
  requires?: string
  /** Owning this makes the upgrade pointless (key racks once the keys are gone), so it can no longer be bought. */
  obsoleteBy?: string
  /** Annex only: which neighbouring unit the building grows into. */
  side?: 'west' | 'east'
  /** Annex and hall: how many locker banks and key racks the new hall comes with. */
  banks?: number
  racks?: number
  /** Hall only: the south expansion behind the storage room, or a floor above it. */
  hall?: 'south' | 'floor1' | 'floor2'
}

export const CONFIG = {
  facility: {
    /** Each locker bank is a wall of rows × cols lockers; the shop starts with one bank. */
    lockerRows: 2,
    lockerCols: 3,
    /** Each key rack is a board of this many hooks; the shop starts with one rack. */
    hooksPerRack: 8,
  },
  /**
   * What the supplier catalogue sells. Bank and rack numbers are in order: bank B before bank C, rack 2
   * before rack 3, the register board needs the labels, digital lockers need the register, the conveyor needs digital lockers, and the south expansion,
   * floor 1 and floor 2 each need the one before (`requires`). Positions are in `world/layout.ts` (LOCKER_BANKS, KEY_RACKS).
   */
  upgrades: [
    {
      id: 'labels',
      kind: 'labels',
      title: 'Locker & key labels',
      description: 'Numbers on every locker door and a matching tag on every key',
      cost: 60,
      level: 2,
    },
    {
      id: 'register',
      kind: 'register',
      title: 'Deposit register board',
      description: 'A board in the storage room listing every stored bag: locker, item and the name you took (so ask!)',
      cost: 150,
      level: 2,
      requires: 'labels',
    },
    {
      id: 'rack2',
      kind: 'keyRack',
      title: 'Key rack #2',
      description: '+8 hooks for keys',
      cost: 40,
      level: 2,
      obsoleteBy: 'digital',
    },
    {
      id: 'bank2',
      kind: 'lockerBank',
      title: 'Locker bank B',
      description: '+6 lockers on the left of the storage room',
      cost: 90,
      level: 2,
    },
    {
      id: 'rack3',
      kind: 'keyRack',
      title: 'Key rack #3',
      description: '+8 hooks for keys',
      cost: 70,
      level: 3,
      requires: 'rack2',
      obsoleteBy: 'digital',
    },
    {
      id: 'bank3',
      kind: 'lockerBank',
      title: 'Locker bank C',
      description: '+6 lockers on the right of the storage room',
      cost: 160,
      level: 3,
      requires: 'bank2',
    },
    // Digitalisation: the keys go. Every locker gets an electronic lock and the key racks become status screens.
    {
      id: 'digital',
      kind: 'digital',
      title: 'Digital lockers',
      description: 'Scrap the keys: electronic locks engage when you shut a door, and the key racks become screens (green free, red occupied)',
      cost: 450,
      level: 4,
      requires: 'register',
    },
    // Building expansion: the shop grows into the unit next door (east). The west unit is taken by the conveyor below.
    {
      id: 'annexEast',
      kind: 'annex',
      side: 'east',
      title: 'Storage annex (east)',
      description: 'Knock through into the unit next door: a new hall with +12 lockers and +16 key hooks',
      cost: 600,
      level: 5,
      requires: 'bank3',
      banks: 2,
      racks: 2,
    },
    // Mechanisation: a conveyor belt and a robot arm. It takes over the west unit (so there is no west storage annex), and you
    // get a loading tray, a pick-up tray and a terminal instead of carrying bags to lockers.
    {
      id: 'conveyor',
      kind: 'conveyor',
      title: 'Conveyor & robot arm',
      description:
        'Replaces the west annex. Load bags on the belt and a robot arm files them in the storage-room lockers; ask the terminal for a bag and it comes back on the return belt',
      cost: 900,
      level: 5,
      requires: 'digital',
    },
    // The next phase of the building: grow backwards (south) with lockers in rows, then upwards.
    // Each hall has two rows of three locker banks (+36 lockers) and five key racks (+40 hooks).
    {
      id: 'southExpansion',
      kind: 'hall',
      hall: 'south',
      title: 'South expansion',
      description: 'Extend the storage room backwards: a big hall behind the lockers with lockers in rows (+36 lockers, +40 hooks)',
      cost: 900,
      level: 6,
      requires: 'annexEast',
      banks: 6,
      racks: 5,
    },
    {
      id: 'floor1',
      kind: 'hall',
      hall: 'floor1',
      title: 'Floor 1',
      description: 'A staircase from the south hall up to a new storage floor with three rows (+54 lockers, +40 hooks): makes up for the west annex',
      cost: 1500,
      level: 7,
      requires: 'southExpansion',
      banks: 9,
      racks: 5,
    },
    {
      id: 'floor2',
      kind: 'hall',
      hall: 'floor2',
      title: 'Floor 2',
      description: 'Another staircase and another storage floor on top (+36 lockers, +40 hooks)',
      cost: 2200,
      level: 8,
      requires: 'floor1',
      banks: 6,
      racks: 5,
    },
  ] satisfies UpgradeDef[],
  /**
   * Traffic stages. Difficulty grows through overlap and decisions, not faster walking or harsh timers:
   * more customers, shorter gaps with random bursts, and more bags to keep track of at once.
   * A stage advances once every customer it introduced has finished (served, turned away or left).
   */
  stages: [
    {
      // The tutorial: one endlessly patient customer, back in 25 s so the whole lesson stays short.
      id: 'tutorial',
      title: 'Opening day',
      intro: 'Your first customer is on the way.',
      customers: 1,
      firstArrivalDelay: 3,
      arrivalGap: [0, 0],
      returnAfter: [25, 25],
      patience: null,
    },
    {
      id: 'warmup',
      title: 'Word is getting around',
      intro: 'Three customers this time, and their visits will overlap. Keep track of who left what.',
      customers: 3,
      firstArrivalDelay: 4,
      arrivalGap: [8, 22],
      burstChance: 0.25,
      burstGap: [2, 5],
      returnAfter: [35, 150],
      patience: 150,
      maxIdle: 12,
    },
    {
      id: 'busy',
      title: 'Getting busy',
      intro: 'Five customers, arriving at unpredictable times. Several bags will be stored at once.',
      customers: 5,
      firstArrivalDelay: 3,
      arrivalGap: [6, 18],
      burstChance: 0.3,
      burstGap: [2, 5],
      returnAfter: [35, 170],
      patience: 130,
      maxIdle: 10,
    },
    {
      id: 'rush',
      title: 'Lunchtime rush',
      intro: 'Six customers, often arriving together. People will queue, and lose patience.',
      customers: 6,
      firstArrivalDelay: 3,
      arrivalGap: [4, 14],
      burstChance: 0.35,
      burstGap: [1.5, 4],
      returnAfter: [40, 190],
      patience: 100,
      maxIdle: 8,
    },
    {
      id: 'open',
      title: 'Open for business',
      intro: 'Customers now come and go all day. Watch your free lockers.',
      customers: null,
      firstArrivalDelay: 5,
      arrivalGap: [5, 20],
      burstChance: 0.3,
      burstGap: [2, 5],
      returnAfter: [40, 200],
      patience: 100,
      maxIdle: 10,
      maxActive: 8,
    },
  ] satisfies ArrivalStage[],
  economy: {
    startingMoney: 50,
    depositFee: 15,
    /** Extra tip at 100 satisfaction, scaled down linearly. */
    maxTip: 5,
    startingReputation: 50,
    xp: { deposit: 20, correctReturn: 30 },
    /** Reputation change when a customer walks out unserved / is politely turned away. */
    walkoutReputation: -3,
    turnAwayReputation: -1,
  },
  /**
   * Handing a customer someone else's package. They say "this isn't my package" and you can retry as
   * often as you like, but every wrong try makes them angrier.
   */
  wrongItem: {
    satisfaction: -20,
    /** Reputation change for the 1st, 2nd, 3rd… wrong try with the same customer (the last value repeats). */
    reputation: [-4, -2, -2],
    /** Fraction of their full patience each wrong try uses up. */
    patienceFraction: 0.2,
    /** From this many wrong tries they are furious and demand a discount on the fee. */
    furiousAt: 3,
    furiousDiscount: 0.5,
  },
  /** Levels, and what levelling up gives. Level n needs 100·n XP. */
  progression: {
    /** Cash bonus on reaching a level: this × the new level. */
    levelUpBonus: 20,
    /** Each level above 1 makes customers arrive this much faster (0.1 = 10 % more often). */
    paceBonusPerLevel: 0.1,
  },
  customer: {
    startingSatisfaction: 70,
    /** Satisfaction lost per second once patience has run out (customers holding no item stay). */
    impatientSatisfactionPerSecond: 0.6,
    /** Patience drains at this fraction while you are serving them (item taken, fetching it). */
    servingDrainFactor: 0.4,
    /** Patience refilled by a friendly greeting. */
    greetingPatience: 10,
  },
  /**
   * The conveyor and robot arm. A bag rides the belt for `beltSeconds`, then the single arm takes `armSeconds` to pick it up,
   * carry it to its locker, open the door, place it and shut it again (a fetch does the same in reverse, then rides back).
   */
  automation: {
    beltSeconds: 4.5,
    armSeconds: 6,
    /** Bags allowed on the way in at once, and the least time between two loads. */
    beltCapacity: 4,
    loadGap: 1.4,
    /** Bags that can wait on the return belt. */
    readyCapacity: 3,
    /** The robot arm serves the storage room's locker banks (bank numbers below this). */
    robotBanks: 3,
  },
  /** Seconds you fumble after trying the wrong key. */
  wrongKeyDelay: 1.2,
  /**
   * Return order. A customer who left earlier has already used up part of their wait, so with plain random
   * waits people mostly came back in the order they left (~80 %). To break that, a new return time is
   * sometimes set to land just before someone who is already stored.
   */
  returns: {
    /** Chance that a new return time undercuts one of the customers already stored (when there is one). */
    overtakeChance: 0.8,
    /** How many seconds before that customer they come back [min, max]. */
    undercut: [4, 25],
  },
  /** When a stage's active-customer cap is reached, check again after this many seconds. */
  arrivalRetry: 8,
  /** When the idle guard pulls an event forward, it fires this many seconds from now [min, max]. */
  idlePullIn: [2, 5],
  /**
   * The mod menu (press M): free cash, levels and upgrades, extra customers, time skips. It exists so testing
   * and tinkering does not mean grinding. Set `enabled: false` to remove it from a release build.
   */
  modMenu: { enabled: true },
} as const
