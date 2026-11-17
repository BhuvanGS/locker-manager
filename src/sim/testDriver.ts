import { expect } from 'vitest'
import { GameManager } from './GameManager'
import type { CustomerId, SimNotice } from './types'

/**
 * Test driver standing in for the 3D layer: customers "walk" instantly, so every spawned customer is
 * at the counter right away and every leaving customer exits right away.
 */
export class Driver {
  readonly game: GameManager
  readonly notices: SimNotice[] = []

  constructor(seed = 3) {
    this.game = new GameManager(seed)
  }

  tick(seconds: number, step = 0.5): void {
    for (let t = 0; t < seconds; t += step) {
      this.game.update(step)
      // Handling a notice can raise more (e.g. an exit starts the next stage), so drain until empty.
      for (let batch = this.game.drainNotices(); batch.length > 0; batch = this.game.drainNotices()) {
        for (const n of batch) {
          this.notices.push(n)
          if (n.type === 'customerSpawned') this.game.customerReachedCounter(n.customerId)
          if (n.type === 'customerLeaving') this.game.customerExited(n.customerId)
        }
      }
    }
  }

  /** Run game time until `predicate` holds (or fail after `limit` seconds). */
  until(predicate: () => boolean, limit = 600): void {
    for (let t = 0; t < limit; t += 0.5) {
      if (predicate()) return
      this.tick(0.5)
    }
    throw new Error('condition never became true')
  }

  waiting(): CustomerId[] {
    return this.game.customers.all().filter((c) => c.state === 'waiting').map((c) => c.id)
  }

  /** Full deposit for a customer at the counter, into the first free locker, key on the first free hook. */
  deposit(id: CustomerId, opts: { askName?: boolean } = {}): string {
    const g = this.game
    const locker = g.lockers.findAvailable()
    if (!locker) throw new Error('no free locker')
    const hook = [...Array(g.keys.hookCount).keys()].find((h) => !g.keys.onHook(h))
    if (hook === undefined) throw new Error('no free hook')
    expect(g.talkTo(id).ok).toBe(true)
    expect(g.choose('greet').ok).toBe(true)
    if (opts.askName !== false) expect(g.choose('askName').ok).toBe(true)
    expect(g.choose('accept').ok).toBe(true)
    expect(g.openLocker(locker.id).ok).toBe(true)
    expect(g.putItem(locker.id).ok).toBe(true)
    expect(g.closeLocker(locker.id).ok).toBe(true)
    expect(g.takeKeyFromLock(locker.id).ok).toBe(true)
    expect(g.hangKey(hook).ok).toBe(true)
    expect(g.talkTo(id).ok).toBe(true)
    expect(g.choose('confirmStored').ok).toBe(true)
    return locker.id
  }

  /** Full collection for a customer back at the counter. */
  collect(id: CustomerId): void {
    const g = this.game
    const lockerId = g.customers.get(id).lockerId
    if (!lockerId) throw new Error('customer has no locker')
    const key = g.keys.get(g.lockers.get(lockerId).keyId)
    if (key.location.kind !== 'hook') throw new Error('key not on a hook')
    expect(g.takeKeyFromHook(key.location.hook).ok).toBe(true)
    expect(g.useKeyOn(lockerId).ok).toBe(true)
    expect(g.takeItem(lockerId).ok).toBe(true)
    expect(g.closeLocker(lockerId).ok).toBe(true)
    expect(g.talkTo(id).ok).toBe(true)
    expect(g.choose('handOver').ok).toBe(true)
  }

  /** Play the tutorial customer start to finish. */
  finishTutorial(): void {
    this.until(() => this.waiting().length === 1)
    const id = this.waiting()[0]!
    this.deposit(id)
    this.until(() => this.game.customers.get(id).state === 'waitingForCollection')
    this.collect(id)
    this.tick(0.5)
  }
}
