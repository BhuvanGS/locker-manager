import type { ItemId, Locker, LockerId } from './types'

/** Owns locker records: layout, door/lock state and what is inside. */
export class LockerManager {
  private readonly lockers = new Map<LockerId, Locker>()
  private readonly order: LockerId[] = []

  /** Builds a rows × cols wall. Locker `n` gets key `key-n`. */
  constructor(rows: number, cols: number) {
    let n = 0
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        n += 1
        const id = `locker-${n}`
        this.lockers.set(id, {
          id,
          number: n,
          row,
          col,
          capacity: 1,
          state: 'available',
          itemId: null,
          doorOpen: false,
          locked: false,
          keyId: `key-${n}`,
        })
        this.order.push(id)
      }
    }
  }

  get(id: LockerId): Locker {
    const locker = this.lockers.get(id)
    if (!locker) throw new Error(`Unknown locker ${id}`)
    return locker
  }

  all(): Locker[] {
    return this.order.map((id) => this.get(id))
  }

  get total(): number {
    return this.order.length
  }

  get availableCount(): number {
    let n = 0
    for (const locker of this.lockers.values()) if (locker.state === 'available') n++
    return n
  }

  /** First available locker (used by automated allocation, a later upgrade). */
  findAvailable(): Locker | null {
    for (const id of this.order) {
      const locker = this.get(id)
      if (locker.state === 'available') return locker
    }
    return null
  }

  open(id: LockerId): void {
    const locker = this.get(id)
    if (locker.locked) throw new Error(`${id} is locked`)
    locker.doorOpen = true
  }

  close(id: LockerId): void {
    this.get(id).doorOpen = false
  }

  put(id: LockerId, itemId: ItemId): void {
    const locker = this.get(id)
    if (!locker.doorOpen) throw new Error(`${id} door is shut`)
    if (locker.itemId) throw new Error(`${id} is already occupied`)
    locker.itemId = itemId
    locker.state = 'occupied'
  }

  take(id: LockerId): ItemId {
    const locker = this.get(id)
    if (!locker.doorOpen) throw new Error(`${id} door is shut`)
    const itemId = locker.itemId
    if (!itemId) throw new Error(`${id} is empty`)
    locker.itemId = null
    locker.state = 'available'
    return itemId
  }

  setLocked(id: LockerId, locked: boolean): void {
    const locker = this.get(id)
    if (locked && locker.doorOpen) throw new Error(`${id} cannot lock while open`)
    locker.locked = locked
  }
}
