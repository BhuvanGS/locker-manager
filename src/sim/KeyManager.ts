import type { Key, KeyId, KeyLocation, LockerId } from './types'

/**
 * Owns key records. Every key belongs to exactly one locker and is always in exactly one place:
 * in its locker's lock, on a hook of the key board, or in the player's hand.
 */
export class KeyManager {
  private readonly keys = new Map<KeyId, Key>()
  /** Total hooks across all racks. */
  hookCount: number

  constructor(lockerIds: { lockerId: LockerId; keyId: KeyId }[], hookCount: number) {
    this.hookCount = hookCount
    for (const { lockerId, keyId } of lockerIds) {
      this.keys.set(keyId, { id: keyId, lockerId, location: { kind: 'inLock' } })
    }
  }

  /** A new locker brings a new key, which starts in its lock. */
  addKey(lockerId: LockerId, keyId: KeyId): void {
    this.keys.set(keyId, { id: keyId, lockerId, location: { kind: 'inLock' } })
  }

  /** A new key rack (a key-rack upgrade) adds hooks. */
  addHooks(count: number): void {
    this.hookCount += count
  }

  get(id: KeyId): Key {
    const key = this.keys.get(id)
    if (!key) throw new Error(`Unknown key ${id}`)
    return key
  }

  all(): Key[] {
    return [...this.keys.values()]
  }

  /** Key hanging on `hook`, if any. */
  onHook(hook: number): Key | null {
    for (const key of this.keys.values()) {
      if (key.location.kind === 'hook' && key.location.hook === hook) return key
    }
    return null
  }

  move(id: KeyId, location: KeyLocation): void {
    if (location.kind === 'hook') {
      if (location.hook < 0 || location.hook >= this.hookCount) throw new Error(`No hook ${location.hook}`)
      const there = this.onHook(location.hook)
      if (there && there.id !== id) throw new Error(`Hook ${location.hook} is taken`)
    }
    this.get(id).location = location
  }

  fits(keyId: KeyId, lockerId: LockerId): boolean {
    return this.get(keyId).lockerId === lockerId
  }
}
