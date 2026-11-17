import type { Appearance, Customer, HairStyle, Item, ItemCategory, Personality } from './types'

const FIRST = ['Maya', 'Tomas', 'Priya', 'Jonah', 'Aiko', 'Lucas', 'Fatima', 'Dmitri', 'Grace', 'Omar', 'Ingrid', 'Kwame', 'Sofia', 'Ravi', 'Elena', 'Theo']
const LAST = ['Okafor', 'Lindqvist', 'Raman', 'Becker', 'Tanaka', 'Moreau', 'Haddad', 'Volkov', 'Nakamura', 'Ellis', 'Costa', 'Mensah', 'Rossi', 'Iyer', 'Novak', 'Walsh']

const SKIN = [0xf1c9a5, 0xe0ac69, 0xc68642, 0x8d5524, 0x5c3a21, 0xffdbac]
const HAIR = [0x1f1a17, 0x4a2f1b, 0x8b5a2b, 0xd8b06a, 0x9a9a9a, 0xa3392b]
const SHIRT = [0x2563eb, 0xdc2626, 0x16a34a, 0xf59e0b, 0x7c3aed, 0x0d9488, 0xdb2777, 0x475569]
const TROUSERS = [0x1e293b, 0x374151, 0x3f3f46, 0x1e3a8a, 0x57534e]
const HAIR_STYLES: HairStyle[] = ['short', 'long', 'bun', 'bald', 'cap']

const COLOURS: [string, number][] = [
  ['blue', 0x2563eb],
  ['red', 0xb91c1c],
  ['green', 0x15803d],
  ['black', 0x1f2937],
  ['tan', 0xb08a5a],
  ['yellow', 0xeab308],
  ['purple', 0x6d28d9],
  ['grey', 0x6b7280],
  ['orange', 0xea580c],
  ['white', 0xe5e7eb],
  ['pink', 0xdb2777],
]

const ITEM_NAMES: Record<ItemCategory, string> = {
  handbag: 'handbag',
  suitcase: 'suitcase',
  backpack: 'backpack',
  laptopBag: 'laptop bag',
  shoppingBag: 'shopping bag',
  instrument: 'guitar case',
  box: 'box',
  accessory: 'camera pouch',
}

const PERSONALITIES: Personality[] = [
  {
    hello: 'Hi! Could you look after something for me for a bit?',
    helloAgain: "Hi again! I'm back for my things.",
    handOver: "Here you go. I'll be back in a little while.",
    thanks: 'Perfect, that is mine. Thank you!',
  },
  {
    hello: 'Morning. I need to drop this off — I have a meeting.',
    helloAgain: 'Meeting done. I need my stuff back, please.',
    handOver: 'Careful with it. I will not be long.',
    thanks: 'Right, that is it. Thanks.',
  },
  {
    hello: 'Oh good, you are open! Can I leave this here?',
    helloAgain: 'Hello hello! Collection time.',
    handOver: 'Thank you so much, back soon!',
    thanks: 'Yes! Thank you, you are a star.',
  },
  {
    hello: 'Hey. Storage, yeah?',
    helloAgain: 'Hey. Picking up.',
    handOver: 'Cheers. Later.',
    thanks: 'Yep, mine. Cheers.',
  },
]

function pick<T>(rand: () => number, list: readonly T[]): T {
  const value = list[Math.floor(rand() * list.length)]
  if (value === undefined) throw new Error('pick from empty list')
  return value
}

/** Creates customers and their items with unique ids. One per game, seeded for repeatable runs. */
export class CustomerFactory {
  private readonly rand: () => number
  private customerSeq = 0
  private itemSeq = 0
  /** Full names and first names already used this game, so customers are easy to tell apart. */
  private readonly usedNames = new Set<string>()
  private readonly usedFirst = new Set<string>()

  constructor(rand: () => number) {
    this.rand = rand
  }

  appearance(): Appearance {
    const rand = this.rand
    return {
      skin: pick(rand, SKIN),
      hair: pick(rand, HAIR),
      hairStyle: pick(rand, HAIR_STYLES),
      shirt: pick(rand, SHIRT),
      trousers: pick(rand, TROUSERS),
      height: 0.92 + rand() * 0.16,
    }
  }

  /**
   * A new item. `avoid` holds the labels of the bags already around: a new one never looks like one of those, so a customer can
   * always tell which bag is theirs (two identical blue suitcases would make "wrong package" unfair).
   */
  item(customerId: string, category?: ItemCategory, avoid: ReadonlySet<string> = new Set()): Item {
    let cat = category ?? pick(this.rand, Object.keys(ITEM_NAMES) as ItemCategory[])
    let [colourName, color] = pick(this.rand, COLOURS)
    for (let tries = 0; tries < 30 && avoid.has(`${colourName} ${ITEM_NAMES[cat]}`); tries++) {
      if (!category) cat = pick(this.rand, Object.keys(ITEM_NAMES) as ItemCategory[])
      ;[colourName, color] = pick(this.rand, COLOURS)
    }
    return {
      id: `item-${++this.itemSeq}`,
      category: cat,
      label: `${colourName} ${ITEM_NAMES[cat]}`,
      color,
      customerId,
      lockerId: null,
      depositedAt: null,
      status: 'withCustomer',
    }
  }

  customer(opts: { patience: number | null; fee: number; satisfaction: number; name?: string; avoid?: ReadonlySet<string> }): { customer: Customer; item: Item } {
    const id = `cust-${++this.customerSeq}`
    const name = opts.name ?? this.freshName()
    this.usedNames.add(name)
    this.usedFirst.add(name.split(' ')[0] ?? name)
    const item = this.item(id, undefined, opts.avoid)
    const customer: Customer = {
      id,
      name,
      appearance: this.appearance(),
      personality: pick(this.rand, PERSONALITIES),
      itemId: item.id,
      lockerId: null,
      depositedAt: null,
      expectedReturnAt: null,
      fee: opts.fee,
      patience: opts.patience ?? 0,
      maxPatience: opts.patience ?? 0,
      patienceDrains: opts.patience !== null,
      satisfaction: opts.satisfaction,
      state: 'arriving',
      visit: { greeted: false, askedName: false, wrongAttempts: 0 },
      nameTaken: false,
    }
    return { customer, item }
  }

  /** Prefer an unused first name (people are remembered by first name), then any unused full name. */
  private freshName(): string {
    let fallback = ''
    for (let i = 0; i < 40; i++) {
      const first = pick(this.rand, FIRST)
      const name = `${first} ${pick(this.rand, LAST)}`
      if (this.usedNames.has(name)) continue
      if (!this.usedFirst.has(first)) return name
      fallback ||= name
    }
    return fallback || `${pick(this.rand, FIRST)} ${pick(this.rand, LAST)}`
  }

  /** The scripted first customer: always the same so the tutorial reads the same every time. */
  tutorialCustomer(opts: { patience: number | null; fee: number; satisfaction: number }): { customer: Customer; item: Item } {
    const { customer, item } = this.customer({ ...opts, name: 'Maya Okafor' })
    const first = PERSONALITIES[0]
    if (first) customer.personality = first
    customer.appearance = {
      skin: 0xc68642,
      hair: 0x1f1a17,
      hairStyle: 'bun',
      shirt: 0x0d9488,
      trousers: 0x1e293b,
      height: 1,
    }
    item.category = 'suitcase'
    item.label = 'blue suitcase'
    item.color = 0x2563eb
    return { customer, item }
  }
}
