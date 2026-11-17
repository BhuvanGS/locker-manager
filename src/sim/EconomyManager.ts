/** Money, XP and reputation. XP levels are a simple curve: level n needs 100·n XP from the previous one. */
export class EconomyManager {
  money: number
  xp = 0
  reputation: number
  served = 0
  mistakes = 0

  constructor(startingMoney: number, startingReputation: number) {
    this.money = startingMoney
    this.reputation = startingReputation
  }

  earn(amount: number): void {
    this.money += amount
  }

  spend(amount: number): void {
    this.money -= amount
  }

  /** Add XP. Returns the new level if this crossed into one (possibly skipping levels), else null. */
  addXp(amount: number): number | null {
    const before = this.level.level
    this.xp += amount
    const after = this.level.level
    return after > before ? after : null
  }

  adjustReputation(delta: number): void {
    this.reputation = Math.max(0, Math.min(100, this.reputation + delta))
  }

  get level(): { level: number; into: number; needed: number } {
    let level = 1
    let remaining = this.xp
    while (remaining >= level * 100) {
      remaining -= level * 100
      level += 1
    }
    return { level, into: remaining, needed: level * 100 }
  }
}
