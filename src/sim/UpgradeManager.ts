import type { UpgradeDef } from './config'

export type UpgradeState = 'owned' | 'available' | 'tooExpensive' | 'locked'

/** One catalogue line as the player sees it. */
export interface CatalogueItem {
  id: string
  title: string
  description: string
  cost: number
  level: number
  state: UpgradeState
  /** Why it can't be bought right now (or "Owned"), shown next to the item. */
  note: string | null
}

/**
 * Owns the upgrade definitions and which ones are bought. It only decides *whether* something can be
 * bought; applying the effect (more lockers, more hooks) is the GameManager's job so that every record
 * stays consistent.
 */
export class UpgradeManager {
  private readonly defs: readonly UpgradeDef[]
  private readonly owned = new Set<string>()

  constructor(defs: readonly UpgradeDef[]) {
    this.defs = defs
  }

  has(id: string): boolean {
    return this.owned.has(id)
  }

  def(id: string): UpgradeDef | undefined {
    return this.defs.find((d) => d.id === id)
  }

  markOwned(id: string): void {
    this.owned.add(id)
  }

  /** Whether `id` can be bought now, and if not, why. */
  state(def: UpgradeDef, level: number, money: number): { state: UpgradeState; note: string | null } {
    if (this.owned.has(def.id)) return { state: 'owned', note: 'Owned' }
    if (level < def.level) return { state: 'locked', note: `Needs level ${def.level}` }
    if (def.requires && !this.owned.has(def.requires)) {
      const first = this.def(def.requires)
      return { state: 'locked', note: `Buy ${first?.title ?? def.requires} first` }
    }
    if (money < def.cost) return { state: 'tooExpensive', note: `Costs $${def.cost}, you have $${money}` }
    return { state: 'available', note: null }
  }

  items(level: number, money: number): CatalogueItem[] {
    return this.defs.map((def) => ({
      id: def.id,
      title: def.title,
      description: def.description,
      cost: def.cost,
      level: def.level,
      ...this.state(def, level, money),
    }))
  }

  /** Upgrades whose level requirement is exactly `level` (shown when you reach it). */
  unlockedAt(level: number): UpgradeDef[] {
    return this.defs.filter((d) => d.level === level)
  }
}
