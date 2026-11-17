/**
 * Game-time clock with a scheduled-event queue (binary min-heap, O(log n) per event), so thousands of
 * pending arrivals/returns cost nothing until they are due.
 */
export class SimulationClock<E> {
  private nowSeconds = 0
  private seq = 0
  private readonly heap: { at: number; seq: number; event: E }[] = []

  get now(): number {
    return this.nowSeconds
  }

  get pending(): number {
    return this.heap.length
  }

  /** Schedule `event` to fire at absolute game time `at` (seconds). Ties fire in scheduling order. */
  schedule(at: number, event: E): void {
    this.heap.push({ at, seq: this.seq++, event })
    this.siftUp(this.heap.length - 1)
  }

  scheduleIn(delay: number, event: E): void {
    this.schedule(this.nowSeconds + delay, event)
  }

  /** Advance time by `dt` and return every event that became due, in time order. */
  advance(dt: number): E[] {
    this.nowSeconds += Math.max(0, dt)
    const due: E[] = []
    while (this.heap.length > 0 && (this.heap[0]?.at ?? Infinity) <= this.nowSeconds) {
      due.push(this.pop().event)
    }
    return due
  }

  /** Remove every pending event matching `match`. Returns how many were removed. */
  removeWhere(match: (event: E) => boolean): number {
    const all = this.heap.splice(0)
    let removed = 0
    for (const entry of all) {
      if (match(entry.event)) {
        removed += 1
        continue
      }
      this.heap.push(entry)
      this.siftUp(this.heap.length - 1)
    }
    return removed
  }

  /** Move every pending event matching `match` to time `at`. Returns how many were moved. */
  retimeWhere(match: (event: E) => boolean, at: number): number {
    const all = this.heap.splice(0)
    let moved = 0
    for (const entry of all) {
      if (match(entry.event)) {
        entry.at = at
        moved += 1
      }
      this.heap.push(entry)
      this.siftUp(this.heap.length - 1)
    }
    return moved
  }

  /** The next event due (without removing it), or null. */
  peekEarliest(): { at: number; event: E } | null {
    const top = this.heap[0]
    return top ? { at: top.at, event: top.event } : null
  }

  /** Move the earliest pending event to `at` (e.g. to pull it forward). Returns it, or null if none. */
  retimeEarliest(at: number): E | null {
    if (this.heap.length === 0) return null
    const { event } = this.pop()
    this.schedule(at, event)
    return event
  }

  /** Earliest pending time for events matching `match`, or null. O(n): for HUD/debug use. */
  nextAt(match: (event: E) => boolean): number | null {
    let best: number | null = null
    for (const entry of this.heap) {
      if (match(entry.event) && (best === null || entry.at < best)) best = entry.at
    }
    return best
  }

  private pop(): { at: number; seq: number; event: E } {
    const top = this.heap[0]
    const last = this.heap.pop()
    if (!top || !last) throw new Error('SimulationClock: pop on empty queue')
    if (this.heap.length > 0) {
      this.heap[0] = last
      this.siftDown(0)
    }
    return top
  }

  private less(a: number, b: number): boolean {
    const x = this.heap[a]
    const y = this.heap[b]
    if (!x || !y) return false
    return x.at < y.at || (x.at === y.at && x.seq < y.seq)
  }

  private swap(a: number, b: number): void {
    const x = this.heap[a]
    const y = this.heap[b]
    if (!x || !y) return
    this.heap[a] = y
    this.heap[b] = x
  }

  private siftUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (!this.less(i, parent)) return
      this.swap(i, parent)
      i = parent
    }
  }

  private siftDown(i: number): void {
    const n = this.heap.length
    for (;;) {
      const l = i * 2 + 1
      const r = l + 1
      let smallest = i
      if (l < n && this.less(l, smallest)) smallest = l
      if (r < n && this.less(r, smallest)) smallest = r
      if (smallest === i) return
      this.swap(i, smallest)
      i = smallest
    }
  }
}
