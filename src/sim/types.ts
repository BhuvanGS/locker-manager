/**
 * Logical game data. Nothing in `src/sim` imports Three.js or React: the simulation is the source of
 * truth, and the 3D world and the HUD only read it. This keeps it testable and lets the record count
 * grow far beyond what is rendered.
 */

export type CustomerId = string
export type ItemId = string
export type LockerId = string
export type KeyId = string

// ------------------------------------------------------------------ customers

export type CustomerState =
  | 'arriving' // walking in from the street
  | 'waiting' // at the counter, not yet served (deposit visit)
  | 'depositing' // talking / handing over / waiting for the item to be stored
  | 'stored' // left the building; their item is in a locker
  | 'returning' // walking back in to collect
  | 'waitingForCollection' // at the counter on the return visit
  | 'collecting' // being served on the return visit
  | 'completed' // got the right item back and paid; walking out
  | 'leftWithoutService' // gave up waiting; walking out

export type HairStyle = 'short' | 'long' | 'bun' | 'bald' | 'cap'

export interface Appearance {
  skin: number
  hair: number
  hairStyle: HairStyle
  shirt: number
  trousers: number
  /** Body height multiplier, ~0.92–1.08. */
  height: number
}

export interface Personality {
  /** Opening line on the deposit visit. */
  hello: string
  /** Opening line on the return visit. */
  helloAgain: string
  /** Said when they hand over the item. */
  handOver: string
  /** Said on receiving the right item back. */
  thanks: string
}

export interface Customer {
  id: CustomerId
  name: string
  appearance: Appearance
  personality: Personality
  itemId: ItemId | null
  lockerId: LockerId | null
  depositedAt: number | null
  expectedReturnAt: number | null
  /** Price agreed at deposit, paid on collection. */
  fee: number
  /** Seconds of waiting they will tolerate; refills each visit. */
  patience: number
  maxPatience: number
  /** 0–100. */
  satisfaction: number
  state: CustomerState
  /** Per-visit conversation flags (reset when a visit starts). */
  visit: { greeted: boolean; askedName: boolean }
}

// ------------------------------------------------------------------ items

export type ItemCategory =
  | 'handbag'
  | 'suitcase'
  | 'backpack'
  | 'laptopBag'
  | 'shoppingBag'
  | 'instrument'
  | 'box'
  | 'accessory'

export type ItemStatus = 'withCustomer' | 'heldByPlayer' | 'inLocker' | 'returned'

export interface Item {
  id: ItemId
  category: ItemCategory
  /** Short description, e.g. "blue suitcase". */
  label: string
  color: number
  customerId: CustomerId
  lockerId: LockerId | null
  depositedAt: number | null
  status: ItemStatus
}

// ------------------------------------------------------------------ lockers & keys

export type LockerState = 'available' | 'occupied' | 'reserved' | 'unavailable' | 'maintenance'

export interface Locker {
  id: LockerId
  /** Display number (only shown once locker labels are unlocked). */
  number: number
  row: number
  col: number
  capacity: number
  state: LockerState
  itemId: ItemId | null
  doorOpen: boolean
  /** Locked when the door is shut and its key has been taken out. */
  locked: boolean
  keyId: KeyId
}

export type KeyLocation =
  | { kind: 'inLock' }
  | { kind: 'hook'; hook: number }
  | { kind: 'player' }

export interface Key {
  id: KeyId
  lockerId: LockerId
  location: KeyLocation
}

// ------------------------------------------------------------------ player & interaction

export type Hands = { kind: 'item'; itemId: ItemId } | { kind: 'key'; keyId: KeyId } | null

export interface DialogueLine {
  who: string
  text: string
}

export type DialogueOptionId = 'greet' | 'askName' | 'accept' | 'confirmStored' | 'handOver' | 'goodbye'

export interface DialogueOption {
  id: DialogueOptionId
  label: string
}

export interface Dialogue {
  customerId: CustomerId
  lines: DialogueLine[]
}

/** Result of a player action, shown as a short status message. */
export interface ActionResult {
  ok: boolean
  message: string | null
}

// ------------------------------------------------------------------ events

export type SimEvent =
  | { type: 'customerArrive'; customerId: CustomerId }
  | { type: 'customerReturn'; customerId: CustomerId }

/** Things that just happened, for the 3D world, HUD toasts and (later) audio. Drained each frame. */
export type SimNotice =
  | { type: 'customerSpawned'; customerId: CustomerId }
  | { type: 'customerLeaving'; customerId: CustomerId }
  | { type: 'payment'; amount: number }
  | { type: 'xp'; amount: number }
  | { type: 'mistake'; kind: 'wrongKey' | 'wrongItem'; message: string }
  | { type: 'message'; text: string }
