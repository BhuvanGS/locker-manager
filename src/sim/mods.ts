import { AUTOMATION_UPGRADES, CONFIG, WAREHOUSE_UPGRADES } from './config'
import type { GameManager } from './GameManager'
import type { ActionResult } from './types'

/**
 * The mod menu's actions, as plain data and a pure function, so they are testable and the UI never touches the
 * simulation directly. Everything here goes through the same GameManager code as normal play (level-up bonuses,
 * banners, upgrades appearing in the shop), it just skips the cost, the level and the waiting.
 */
export type ModRequest =
  | { type: 'money'; amount: number }
  | { type: 'xp'; amount: number }
  /** Raise to at least this level. */
  | { type: 'level'; level: number }
  | { type: 'unlock'; id: string }
  | { type: 'unlockAll' }
  | { type: 'spawn'; count: number }
  | { type: 'nextStage' }
  | { type: 'returnAll' }
  | { type: 'skip'; seconds: number }
  | { type: 'patience'; on: boolean }
  /** The meteor: start the countdown, or (counting down) bring it in 15 s from now. */
  | { type: 'meteor' }

/** What the menu shows about the game. */
export interface ModInfo {
  money: number
  level: number
  stageTitle: string
  /** Customers in the building (at the counter, walking in or out). */
  inside: number
  /** Customers whose bag is stored. */
  stored: number
  /** Customers never lose patience. */
  patienceOff: boolean
  upgrades: { id: string; title: string; owned: boolean }[]
}

const ok = (message: string): ActionResult => ({ ok: true, message })
const fail = (message: string): ActionResult => ({ ok: false, message })

/** XP needed in total to reach `level` (level n needs 100·n from the previous one). */
export function xpForLevel(level: number): number {
  return 50 * level * (level - 1)
}

export function modInfo(game: GameManager): ModInfo {
  const all = game.customers.all()
  return {
    money: game.economy.money,
    level: game.economy.level.level,
    stageTitle: game.scheduler.stage.title,
    inside: all.filter((c) => c.state !== 'stored' && c.state !== 'completed' && c.state !== 'leftWithoutService').length,
    stored: all.filter((c) => c.state === 'stored').length,
    patienceOff: game.mods.noPatienceLoss,
    upgrades: CONFIG.upgrades.map((def) => ({ id: def.id, title: def.title, owned: game.upgrades.has(def.id) })),
  }
}

export function applyMod(game: GameManager, request: ModRequest): ActionResult {
  switch (request.type) {
    case 'money':
      game.economy.earn(request.amount)
      return ok(`+$${request.amount}`)
    case 'xp':
      game.grantXp(request.amount)
      return ok(`+${request.amount} XP`)
    case 'level': {
      const needed = xpForLevel(request.level)
      if (game.economy.xp >= needed) return fail(`You are already level ${game.economy.level.level}.`)
      game.grantXp(needed - game.economy.xp)
      return ok(`Level ${game.economy.level.level}`)
    }
    case 'unlock':
      return game.grantUpgrade(request.id)
    case 'unlockAll': {
      let n = 0
      for (const def of [...CONFIG.upgrades, ...AUTOMATION_UPGRADES, ...WAREHOUSE_UPGRADES]) {
        if (!game.upgrades.has(def.id) && game.grantUpgrade(def.id).ok) n += 1
      }
      return n > 0 ? ok(`Unlocked ${n} upgrade${n === 1 ? '' : 's'}.`) : fail('Everything is already unlocked.')
    }
    case 'spawn': {
      const count = Math.max(1, Math.min(20, Math.round(request.count)))
      for (let i = 0; i < count; i++) game.spawnExtraCustomer()
      return ok(`${count} customer${count === 1 ? '' : 's'} on the way.`)
    }
    case 'nextStage':
      return game.skipStage() ? ok(`Stage: ${game.scheduler.stage.title}`) : fail('Already on the last traffic stage.')
    case 'returnAll': {
      const n = game.callBackStoredCustomers()
      return n > 0 ? ok(`${n} customer${n === 1 ? '' : 's'} coming back.`) : fail('Nobody is stored.')
    }
    case 'skip': {
      const seconds = Math.max(1, Math.min(600, request.seconds))
      for (let t = 0; t < seconds; t += 0.5) game.update(0.5)
      return ok(`Skipped ${seconds} s.`)
    }
    case 'meteor': {
      const m = game.meteor
      if (m.phase === 'waiting') {
        m.start(game.now)
        return ok('Something big is coming… (the countdown has started)')
      }
      if (m.hurry(game.now, 15)) return ok('The meteor strikes in 15 s. Look west!')
      return fail(m.phase === 'countdown' ? 'It is almost here already.' : 'The meteor has already struck.')
    }
    case 'patience':
      game.mods.noPatienceLoss = request.on
      return ok(request.on ? 'Customers never lose patience.' : 'Customers lose patience again.')
  }
}
