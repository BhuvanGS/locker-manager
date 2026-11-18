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
  kind: 'lockerBank' | 'keyRack' | 'labels' | 'register' | 'digital' | 'conveyor' | 'office' | 'warehouse' | 'annex' | 'hall'
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

/** The parts of the building a robot arm can serve. `main` is the storage room, the rest are the halls built later. */
export type AutoZone = 'main' | 'east' | 'south' | 'floor1' | 'floor2'
export const AUTO_ZONES: readonly AutoZone[] = ['main', 'east', 'south', 'floor1', 'floor2']
export const ZONE_TITLES: Record<AutoZone, string> = {
  main: 'Storage room',
  east: 'East annex',
  south: 'South hall',
  floor1: 'Floor 1',
  floor2: 'Floor 2',
}
/** Rows of lockers in every zone (a hall's arms ride to all of them). */
export const ZONE_ROWS: Record<AutoZone, number> = { main: 1, east: 1, south: 2, floor1: 3, floor2: 2 }

/**
 * Upgrades for the conveyor system. They are not sold from the supplier catalogue: you buy each one at a console in the part of
 * the building it affects. `hub` is the control console in the staff area (it extends the belts to more halls); every zone has its
 * own console for its robot arms (speed levels 1–3 and a second arm).
 */
export interface AutomationUpgradeDef {
  id: string
  /** Which console sells it. */
  scope: 'hub' | AutoZone
  kind: 'line' | 'speed' | 'arms' | 'counter'
  zone: AutoZone
  /** Speed level reached (1–3); 0 for the others. */
  tier: number
  title: string
  description: string
  cost: number
  /** Player level needed. */
  level: number
  /** Another automation upgrade that must be owned first. */
  requires?: string
  /** A catalogue upgrade that must be owned first (the hall the belts extend to). */
  needs?: string
}

const LINE_NEEDS: Record<Exclude<AutoZone, 'main'>, { needs: string; cost: number; level: number; requires?: string }> = {
  east: { needs: 'annexEast', cost: 700, level: 5 },
  south: { needs: 'southExpansion', cost: 1000, level: 6, requires: 'line-east' },
  floor1: { needs: 'floor1', cost: 1400, level: 7, requires: 'line-south' },
  floor2: { needs: 'floor2', cost: 1800, level: 8, requires: 'line-floor1' },
}

function buildAutomationUpgrades(): AutomationUpgradeDef[] {
  const out: AutomationUpgradeDef[] = []
  for (const zone of AUTO_ZONES) {
    if (zone === 'main') continue
    const info = LINE_NEEDS[zone]
    out.push({
      id: `line-${zone}`,
      scope: 'hub',
      kind: 'line',
      zone,
      tier: 0,
      title: `Belt to the ${ZONE_TITLES[zone]}`,
      description: `Extend the conveyor to the ${ZONE_TITLES[zone]}: its own robot arm${ZONE_ROWS[zone] > 1 ? ` on each of its ${ZONE_ROWS[zone]} rows` : ''}, fed through a service duct`,
      cost: info.cost,
      level: info.level,
      requires: info.requires,
      needs: info.needs,
    })
  }
  out.push({
    id: 'counter-arm',
    scope: 'hub',
    kind: 'counter',
    zone: 'main',
    tier: 0,
    title: 'Counter arm',
    description:
      "A robot arm over the counter takes each customer's bag onto the belt and hands it back when they return: no more carrying bags or handing them over. It does not ask names, and you can still talk to a customer yourself before it gets to them",
    cost: 1800,
    level: 8,
    requires: 'arms-main',
  })
  out.push(
    {
      id: 'counter-speed-1',
      scope: 'hub',
      kind: 'counter',
      zone: 'main',
      tier: 1,
      title: 'Faster counter arm',
      description: 'The counter arm moves faster: a bag in or out in 4.5 s instead of 6 s',
      cost: 1400,
      level: 9,
      requires: 'counter-arm',
    },
    {
      id: 'counter-arm-2',
      scope: 'hub',
      kind: 'counter',
      zone: 'main',
      tier: 0,
      title: 'Second counter arm',
      description: 'A second arm on its own rail behind the first: two customers are served at once',
      cost: 3200,
      level: 10,
      requires: 'counter-arm',
    },
    {
      id: 'counter-speed-2',
      scope: 'hub',
      kind: 'counter',
      zone: 'main',
      tier: 2,
      title: 'Fastest counter arms',
      description: 'Both counter arms move faster still: 3 s a bag',
      cost: 2600,
      level: 11,
      requires: 'counter-speed-1',
    },
  )
  for (const zone of AUTO_ZONES) {
    const rows = ZONE_ROWS[zone]
    for (let tier = 1; tier <= 3; tier++) {
      out.push({
        id: `speed-${zone}-${tier}`,
        scope: zone,
        kind: 'speed',
        zone,
        tier,
        title: `Arm motors, level ${tier}`,
        description: `The arms in the ${ZONE_TITLES[zone]} work ${CONFIG.automation.speedMult[tier]}× as fast`,
        cost: 250 * tier * rows,
        level: 4 + tier,
        requires: tier > 1 ? `speed-${zone}-${tier - 1}` : undefined,
      })
    }
    out.push({
      id: `arms-${zone}`,
      scope: zone,
      kind: 'arms',
      zone,
      tier: 0,
      title: 'Second arm',
      description: `A second arm for the ${ZONE_TITLES[zone]}${rows > 1 ? ` (it rides to all ${rows} rows)` : ''}: two bags at once`,
      cost: 500 * rows,
      level: 6,
      requires: `speed-${zone}-1`,
    })
  }
  return out
}

/** What a crate holds. `illegal` is contraband; a contraband load is *declared* as something harmless, so you cannot tell by looking. */
export type CargoType = 'general' | 'food' | 'cold' | 'metals' | 'illegal'
export const CARGO_TYPES: readonly CargoType[] = ['general', 'food', 'cold', 'metals', 'illegal']

/** Where in the warehouse crates are kept: the shelves, the cold room, the vault, the hidden compartments. */
export type Section = 'shelves' | 'cold' | 'vault' | 'hidden'
export const SECTIONS: readonly Section[] = ['shelves', 'cold', 'vault', 'hidden']

/** An upgrade for the warehouse, bought at the warehouse console inside it. */
export interface WarehouseUpgradeDef {
  id: string
  title: string
  description: string
  cost: number
  /** Player level needed. */
  level: number
  requires?: string
  /** A second upgrade it needs (where it has to go). */
  needs?: string
}

export const WAREHOUSE_UPGRADES: readonly WarehouseUpgradeDef[] = [
  { id: 'wh-cap-1', title: 'Extra rack', description: '+12 shelf slots on a fifth rack, by the south aisle', cost: 900, level: 8 },
  { id: 'wh-cap-2', title: 'Sixth rack', description: '+12 more shelf slots on a sixth rack by the south aisle', cost: 1400, level: 8, requires: 'wh-cap-1' },
  { id: 'wh-expand-1', title: 'Warehouse level 3', description: 'A new hall built onto the south of the warehouse: four racks, +48 shelf slots, and the robots drive through to it', cost: 6000, level: 11, requires: 'wh-cap-2' },
  { id: 'wh-expand-2', title: 'Warehouse level 4', description: 'A second new hall further south: four more racks, +48 shelf slots', cost: 9000, level: 12, requires: 'wh-expand-1' },
  { id: 'wh-cold', title: 'Cold racks', description: 'Racks under cooling units with 12 slots: cold-chain loads keep fresh there, and spoil in 90 s anywhere else', cost: 1800, level: 8 },
  { id: 'wh-vault', title: 'Vault cage', description: 'A locked wire cage with 8 slots for special metals, which get stolen from the open shelves', cost: 2200, level: 9 },
  { id: 'wh-permit', title: 'Special goods licence', description: 'Special metals become fully legal: no fine when the police check', cost: 1500, level: 9 },
  { id: 'wh-scanner', title: 'Scanner arch', description: 'Every load that arrives shows what is really in it (and what it was declared as)', cost: 1200, level: 9 },
  { id: 'wh-hidden-1', title: 'Underground vault', description: 'A secret room under the warehouse floor: a sliding hatch under a mat, a ladder down, 8 slots that only you can fill (the robots never go there). The police find what is down there 40 % of the time; anywhere else, always', cost: 2000, level: 10 },
  { id: 'wh-hidden-2', title: 'Deeper vault', description: '+4 slots in the underground vault (12 in all), and the police find what is down there only 20 % of the time', cost: 3000, level: 11, requires: 'wh-hidden-1' },
  { id: 'wh-auto-1', title: 'Receiving robots', description: 'A warehouse robot with a big clamp carries crates for you: off parked trucks to where they look like they belong, and out to collection trucks (20 s a crate)', cost: 2500, level: 10, requires: 'wh-cap-1' },
  { id: 'wh-auto-2', title: 'Second robot', description: 'A second robot, and both work faster (14 s a crate). They never touch contraband', cost: 3500, level: 11, requires: 'wh-auto-1' },
  { id: 'wh-auto-3', title: 'Third robot', description: 'A third warehouse robot (charging in the level 3 hall), and all of them faster: 12 s a crate', cost: 5000, level: 12, requires: 'wh-auto-2', needs: 'wh-expand-1' },
  { id: 'wh-auto-4', title: 'Fourth robot', description: 'A fourth warehouse robot, and all of them faster again: 10 s a crate', cost: 7000, level: 13, requires: 'wh-auto-3' },
]

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
    // The deal office: a glass office off the lobby where big names come to make storage deals (the road to the warehouse).
    {
      id: 'office',
      kind: 'office',
      title: 'Deal office',
      description: 'A glass office off the lobby. VIPs with a good name to protect come to make storage deals with you: retainers now, crates for the warehouse later',
      cost: 1200,
      level: 6,
      requires: 'conveyor',
    },
    // The warehouse: a door in the south hall onto a service road, where trucks bring crates to a small warehouse.
    {
      id: 'warehouse',
      kind: 'warehouse',
      title: 'Warehouse',
      description: 'A door in the south hall opens onto a loading road and a small warehouse: kei truckers drop off crates, and your VIP deals are delivered there',
      cost: 2500,
      level: 8,
      requires: 'southExpansion',
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
    /** Satisfaction every waiting customer loses when you pull out a bag that is not for any of them. */
    rummageSatisfaction: -4,
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
    /** Seconds a bag spends in the service duct between the hub and a hall (each way). The storage room has no duct. */
    transit: { main: 0, east: 4, south: 6, floor1: 8, floor2: 10 },
    /** How much faster the arms of a hall work at speed level 0, 1, 2, 3. */
    speedMult: [1, 1.4, 1.8, 2.3],
    /** Arms per part of the building: one, or two with the extra-arm upgrade. */
    maxArms: 2,
    /** How long a job takes in each zone, relative to the storage room (the arm rides to the bay and along to the row), plus `rowTravel` per row. */
    travelFactor: { main: 1, east: 1, south: 1.5, floor1: 1.5, floor2: 1.5 },
    rowTravel: 0.1,
    /** Seconds the counter arm takes to serve one customer (fetch the bag, carry it, hand it over or put it on the belt). */
    counterSeconds: 6,
    /** The counter arm's seconds per bag with each speed upgrade (counter-speed-1, -2). */
    counterSpeedSeconds: [6, 4.5, 3] as number[],
    /**
     * Routine maintenance. Every arm wears a little with each job (faster motors wear it faster). A worn arm is slower, and a failing
     * one can jam when it starts a job: it then stops until it is repaired at its zone's arm console. A service puts every arm back
     * to 100 %; a repair frees a jammed arm but leaves it only half-fit, so it still needs servicing.
     */
    maintenance: {
      wearPerJob: 3,
      /** Extra wear per speed level (0.2 = 20 % more per level). */
      speedWear: 0.2,
      wornBelow: 60,
      failingBelow: 25,
      wornSlowdown: 1.25,
      failingSlowdown: 1.5,
      /** Chance a job start jams an arm at condition 0 (it is 100 % at exactly 0); it falls to 0 at `failingBelow`. */
      jamChance: 0.5,
      serviceCostPerArm: 30,
      repairCostPerArm: 80,
      repairedCondition: 40,
    },
  },
  /**
   * VIP deals (the deal office). Offers start once your reputation reaches `minReputation`; one VIP at a time waits `expiresAfter` seconds.
   * Parody names, on purpose.
   */
  deals: {
    minReputation: 55,
    firstOfferDelay: 15,
    /** Seconds from the VIP's car turning up in the street to them standing at the desk (they can be dealt with only then). */
    /** Seconds from the offer to the VIP sitting at the desk: the car drives up and parks, and they walk in through the lobby. */
    arrivalSeconds: 24,
    gap: [70, 150] as [number, number],
    expiresAfter: 150,
    crates: [12, 60] as [number, number],
    retainerPerCrate: [18, 30] as [number, number],
    signingXp: 80,
    signingReputation: 3,
    /** Haggling: the retainer goes up by this much, or the VIP walks out with this chance (and you lose a little reputation). */
    haggleBonus: 0.25,
    haggleWalkChance: 0.4,
    haggleWalkReputation: -2,
    vips: [
      {
        name: 'Beff Jezoz',
        title: 'Founder, Amazin',
        cargo: 'online-shop parcels',
        type: 'general' as const,
        look: { skin: 0xe0ac69, hair: 0x1f1a17, hairStyle: 'bald', shirt: 0x1e293b, trousers: 0x0f172a, height: 1.0 },
      },
      {
        name: 'Elan Husk',
        title: 'CEO, Tezla & SpaceZ',
        cargo: 'rocket parts and battery cells',
        type: 'metals' as const,
        look: { skin: 0xf1c9a5, hair: 0x4a2f1b, hairStyle: 'short', shirt: 0x111827, trousers: 0x1f2937, height: 1.04 },
      },
      {
        name: 'Marc Zuckerburger',
        title: 'Founder, Facebok',
        cargo: 'VR headsets',
        type: 'general' as const,
        look: { skin: 0xf1c9a5, hair: 0x8b5a2b, hairStyle: 'short', shirt: 0x9ca3af, trousers: 0x374151, height: 0.98 },
      },
      {
        name: 'Bill Gaytes',
        title: 'Chair, Microsoftly',
        cargo: 'charity vaccines',
        type: 'cold' as const,
        look: { skin: 0xffdbac, hair: 0x9a9a9a, hairStyle: 'short', shirt: 0x3b82f6, trousers: 0x374151, height: 1.0 },
      },
      {
        name: 'Tim Cookie',
        title: 'CEO, Pear',
        cargo: 'phones nobody has seen yet',
        type: 'general' as const,
        look: { skin: 0xf1c9a5, hair: 0x9a9a9a, hairStyle: 'short', shirt: 0x1f2937, trousers: 0x111827, height: 1.02 },
      },
      {
        name: 'Oprah Windfree',
        title: 'Media mogul',
        cargo: 'hampers of gourmet food for the show',
        type: 'food' as const,
        look: { skin: 0x8d5524, hair: 0x1f1a17, hairStyle: 'long', shirt: 0xa3392b, trousers: 0x1e293b, height: 0.98 },
      },
    ],
  },
  /**
   * The warehouse (shelf room for `capacity` crates, one loading bay). Kei truckers turn up at random with a few crates and collect them
   * later, paying per crate; VIP deals are delivered in box-truck loads and collected after `vipStay`. A load that does not fit is turned away.
   */
  warehouse: {
    capacity: 24,
    firstKeiDelay: 12,
    keiGap: [35, 80] as [number, number],
    keiCrates: [2, 5] as [number, number],
    keiStay: [70, 160] as [number, number],
    boxCrates: 10,
    firstDeliveryDelay: 10,
    deliveryGap: 30,
    vipStay: 240,
    /** Seconds a truck takes to drive in and park, and to pull out and drive away. */
    arriveSeconds: 16,
    leaveSeconds: 14,
    turnedAwayReputation: -1,
    /** Seconds a parked delivery truck waits to be unloaded before its driver gives up and drives off with what is still on board (so ignored trucks never block the parking for good). */
    parkedPatience: 180,
    vipTurnedAwayReputation: -2,
    /** What a crate of each kind earns per crate when the owner collects (a VIP's load earns `vipFeeFactor` of it, on top of the retainer). */
    cargo: {
      general: { label: 'General goods', fee: 14 },
      food: { label: 'Food', fee: 16 },
      cold: { label: 'Cold chain', fee: 26 },
      metals: { label: 'Special metals', fee: 55 },
      illegal: { label: 'Contraband', fee: 110 },
    },
    vipFeeFactor: 0.7,
    /** What a kei trucker's load is, at random (metals only ever come from VIP deals; contraband only from the contact). */
    keiMix: { general: 0.55, food: 0.27, cold: 0.18 },
    /**
     * The contact: a man who walks in through the warehouse door now and then with a few crates of contraband and asks you to keep them,
     * no questions asked. He waits `askPatience` s for an answer and `handPatience` s for you to take his crates; he comes back for them
     * after `stay` s and pays the contraband fee per crate when you hand them all back. Only you handle his crates (the robots never do),
     * and you can put them anywhere: the police always find contraband, except in the underground vault.
     */
    contact: {
      firstDelay: 150,
      gap: [240, 420] as [number, number],
      crates: [2, 4] as [number, number],
      stay: [180, 300] as [number, number],
      walkSeconds: 4,
      askPatience: 60,
      handPatience: 150,
      names: ['Vex', 'Moss', 'Rook', 'Sly', 'Dace', 'Nico'],
    },
    /** Parking spots beside the shed: trucks park there while their crates are carried in or out; with all spots taken, the next truck waits in the road. */
    parkingSpots: 4,
    /** Food spoils this long after it arrives; cold-chain goods spoil this soon anywhere but in the cold room (the dock counts). */
    foodShelfLife: 240,
    coldSpoilSeconds: 90,
    /** Special metals on the open shelves: now and then a crate or two walk off. */
    theft: { every: 30, chance: 0.08, crates: [1, 3] as [number, number], reputation: -2 },
    /** Opening a load to see what is in it takes this long. */
    inspectSeconds: 6,
    /** Shelf slots at the start; the other sections start with none and come with upgrades. */
    startShelves: 48,
    /** Seconds between loads for the receiving robots, by level (0 = none). */
    /**
     * The warehouse robots (bought with wh-auto-1 / wh-auto-2): how many there are and the seconds each takes per crate. A robot job carries
     * ONE crate: it drives to the truck (or rack), picks the crate up at `grabAt` of the job, and puts it down at the end.
     */
    robots: { count: [0, 1, 2, 3, 4] as number[], seconds: [0, 20, 14, 12, 10] as number[], grabAt: 0.45, stagger: 0.4 },
    /**
     * The police. They only start to check once the warehouse holds `minCrates` crates (you have grown big), and then rarely.
     * Contraband in the open is always found; hidden contraband is found with the `hiddenFind` chance by hidden level (0, 1, 2).
     * Special metals without the licence are fined once per visit.
     */
    police: {
      minCrates: 16,
      gap: [300, 600] as [number, number],
      arriveSeconds: 8,
      inspectSeconds: 12,
      leaveSeconds: 8,
      illegalFinePerCrate: 150,
      metalsFine: 300,
      illegalReputation: -6,
      metalsReputation: -2,
      cleanReputation: 1,
      hiddenFind: [1, 0.4, 0.2] as number[],
    },
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
  /**
   * The late game: once every upgrade is bought, a `countdownSeconds` countdown (30 game minutes) to a meteor strike west of the shop;
   * its crater fills with water over `fillSeconds`. Then the lake's road and dock are sold at the control hub (`LAKE_UPGRADES`).
   */
  meteor: { countdownSeconds: 1800, fillSeconds: 150 },
} as const

export const AUTOMATION_UPGRADES: readonly AutomationUpgradeDef[] = buildAutomationUpgrades()

/** The lake's upgrades, sold at the control hub once the crater has filled. */
export const LAKE_UPGRADES: readonly WarehouseUpgradeDef[] = [
  { id: 'lake-road', title: 'Road to the lake', description: 'Pave a road from the main street down to the new lake, with a hard-standing on its shore', cost: 8000, level: 12 },
  { id: 'lake-dock', title: 'Small dock', description: 'A timber pier out into the lake, with bollards, lamps and a harbour office: ready for boats', cost: 15000, level: 13, requires: 'lake-road' },
]

