/**
 * Saving and loading the whole simulation. `encode` walks the object graph (class instances, plain records, arrays, Maps and Sets),
 * keeps shared references as references (`{ $r: id }`) and skips functions. `hydrate` writes that back into a freshly built object of
 * the same shape: class instances and objects holding callbacks are filled in place, so their prototypes and the closures wired up in
 * constructors survive; everything else is created anew.
 */
type Encoded = null | boolean | number | string | { $r: number } | { $n: string } | { $id: number; $arr: Encoded[] } | { $id: number; $map: [Encoded, Encoded][] } | { $id: number; $set: Encoded[] } | { $id: number; $obj: Record<string, Encoded> }

const SKIP = Symbol('skip')

export function encode(root: object): Encoded {
  const ids = new Map<object, number>()
  const walk = (v: unknown): Encoded | typeof SKIP => {
    if (v === undefined || typeof v === 'function' || typeof v === 'symbol') return SKIP
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return v
    if (typeof v === 'number') return Number.isFinite(v) ? v : { $n: String(v) }
    if (typeof v === 'bigint') throw new Error('Cannot save a bigint')
    const o = v as object
    const seen = ids.get(o)
    if (seen !== undefined) return { $r: seen }
    const $id = ids.size
    ids.set(o, $id)
    if (Array.isArray(o)) return { $id, $arr: o.map((x) => { const e = walk(x); return e === SKIP ? null : e }) }
    if (o instanceof Map) {
      const $map: [Encoded, Encoded][] = []
      for (const [k, x] of o) {
        const ek = walk(k)
        const ex = walk(x)
        if (ek !== SKIP && ex !== SKIP) $map.push([ek, ex])
      }
      return { $id, $map }
    }
    if (o instanceof Set) return { $id, $set: [...o].map(walk).filter((x): x is Encoded => x !== SKIP) }
    const $obj: Record<string, Encoded> = {}
    for (const key of Object.keys(o)) {
      const e = walk((o as Record<string, unknown>)[key])
      if (e !== SKIP) $obj[key] = e
    }
    return { $id, $obj }
  }
  const out = walk(root)
  if (out === SKIP) throw new Error('Nothing to save')
  return out
}

/** Worth filling in place rather than replacing: a class instance, or an object carrying callbacks. */
function keepInPlace(o: unknown): o is Record<string, unknown> {
  if (o === null || typeof o !== 'object' || Array.isArray(o) || o instanceof Map || o instanceof Set) return false
  if (Object.getPrototypeOf(o) !== Object.prototype) return true
  return Object.values(o).some((x) => typeof x === 'function')
}

/** Write `data` (from `encode`) into `target`, an object built the same way as the one that was saved. */
export function hydrate(target: object, data: Encoded): void {
  const refs = new Map<number, unknown>()
  const used = new Set<object>()
  const revive = (e: Encoded, existing: unknown): unknown => {
    if (e === null || typeof e !== 'object') return e
    if ('$r' in e) {
      if (!refs.has(e.$r)) throw new Error(`Save file refers to #${e.$r} before it is defined`)
      return refs.get(e.$r)
    }
    if ('$n' in e) return Number(e.$n)
    if ('$arr' in e) {
      const arr: unknown[] = []
      refs.set(e.$id, arr)
      const old = Array.isArray(existing) ? existing : []
      e.$arr.forEach((x, i) => arr.push(revive(x, old[i])))
      return arr
    }
    if ('$map' in e) {
      const map = new Map()
      refs.set(e.$id, map)
      const old = existing instanceof Map ? existing : null
      for (const [k, x] of e.$map) {
        const key = revive(k, undefined)
        map.set(key, revive(x, old?.get(key)))
      }
      return map
    }
    if ('$set' in e) {
      const set = new Set()
      refs.set(e.$id, set)
      for (const x of e.$set) set.add(revive(x, undefined))
      return set
    }
    const into = keepInPlace(existing) && !used.has(existing) ? existing : ({} as Record<string, unknown>)
    used.add(into)
    refs.set(e.$id, into)
    fill(into, e.$obj)
    return into
  }
  const fill = (into: Record<string, unknown>, fields: Record<string, Encoded>): void => {
    for (const key of Object.keys(into)) if (!(key in fields) && typeof into[key] !== 'function') delete into[key]
    for (const [key, x] of Object.entries(fields)) into[key] = revive(x, into[key])
  }
  if (data === null || typeof data !== 'object' || !('$obj' in data)) throw new Error('Not a saved object')
  used.add(target)
  refs.set(data.$id, target)
  fill(target as Record<string, unknown>, data.$obj)
}
