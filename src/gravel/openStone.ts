import type { StoneRecord } from './stone'

export type OpenOutcome =
  | { kind: 'not-holding' }
  | { kind: 'need-flip' }
  | { kind: 'solid' }
  | { kind: 'already-open' }
  | { kind: 'found-key' }

/** Only the seeded fake rock, after the underside is checked, yields the key. */
export function evaluateOpen(record: StoneRecord | null): OpenOutcome {
  if (!record) return { kind: 'not-holding' }
  if (record.opened) return record.isFake ? { kind: 'already-open' } : { kind: 'solid' }
  if (!record.inspected) return { kind: 'need-flip' }
  if (!record.isFake) return { kind: 'solid' }
  return { kind: 'found-key' }
}
