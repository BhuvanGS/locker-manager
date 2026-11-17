import { create } from 'zustand'
import type { DialogueOptionId } from '../sim/types'
import type { ModInfo, ModRequest } from '../sim/mods'
import type { TerminalEntry } from '../sim/GameManager'
import type { CatalogueItem } from '../sim/UpgradeManager'

export type GamePhase = 'menu' | 'playing' | 'paused'

export type DialogueView = {
  speaker: string
  lines: { who: string; text: string }[]
  options: { id: DialogueOptionId; label: string; disabled: string | null; recommended: boolean }[]
}

export type Toast = { id: number; text: string; tone: 'good' | 'bad' | 'info' }

export type Banner = { id: number; eyebrow: string; title: string; text: string }

/** The supplier catalogue as the HUD shows it. */
export type CatalogueView = { money: number; level: number; items: CatalogueItem[] }

/** The conveyor terminal as the HUD shows it: the bags the robot arm can fetch. */
export type TerminalView = { entries: TerminalEntry[]; free: number }

/**
 * The HUD's view of the game. The Engine writes it every frame (only primitives or objects that keep
 * their identity while unchanged, so React only re-renders on real changes). React never writes to the
 * simulation directly — it queues requests (e.g. a dialogue choice) that the Engine consumes.
 */
export type GameStoreState = {
  phase: GamePhase
  pointerLocked: boolean
  fps: number

  money: number
  level: number
  xpInto: number
  xpNeeded: number
  reputation: number
  served: number
  mistakes: number
  lockersFree: number
  lockersTotal: number
  activeDeposits: number
  queue: number
  stageLabel: string
  objective: string
  /** Big announcement (e.g. a new traffic stage); the HUD hides it after a few seconds. */
  banner: Banner | null

  prompt: string | null
  promptHint: string | null
  holding: string | null
  dialogue: DialogueView | null
  /** Which dialogue option is highlighted (Enter / E confirms it). */
  dialogueIndex: number
  catalogue: CatalogueView | null
  /** Which catalogue row is highlighted (E / Enter buys it). */
  catalogueIndex: number
  terminal: TerminalView | null
  /** Which terminal row is highlighted (E / Enter fetches it). */
  terminalIndex: number
  toasts: Toast[]

  /** Dialogue choice clicked in the UI, consumed by the Engine. */
  pendingChoice: DialogueOptionId | null
  /** Catalogue row clicked in the UI, consumed by the Engine. */
  pendingBuy: string | null
  /** Locker id of a terminal row clicked in the UI, consumed by the Engine. */
  pendingFetch: string | null

  /** Mod menu (cheats for testing; see sim/mods.ts). */
  modOpen: boolean
  /** Freeze the shop while the mod menu is open. */
  modPause: boolean
  modInfo: ModInfo | null
  /** Requests from the menu's buttons, consumed by the Engine. */
  modRequests: ModRequest[]
  /** Set by the menu to ask the Engine for a fresh game. */
  newGameRequested: boolean

  setPhase: (phase: GamePhase) => void
  patch: (data: Partial<GameStoreState>) => void
  pushToast: (text: string, tone: Toast['tone']) => void
  dropToast: (id: number) => void
  showBanner: (title: string, text: string, eyebrow?: string) => void
  requestMod: (request: ModRequest) => void
}

let toastSeq = 0

export const useGameStore = create<GameStoreState>((set) => ({
  phase: 'menu',
  pointerLocked: false,
  fps: 0,
  money: 0,
  level: 1,
  xpInto: 0,
  xpNeeded: 100,
  reputation: 50,
  served: 0,
  mistakes: 0,
  lockersFree: 0,
  lockersTotal: 0,
  activeDeposits: 0,
  queue: 0,
  stageLabel: 'Basic facility · Opening day',
  objective: '',
  banner: null,
  prompt: null,
  promptHint: null,
  holding: null,
  dialogue: null,
  dialogueIndex: 0,
  catalogue: null,
  catalogueIndex: 0,
  terminal: null,
  terminalIndex: 0,
  toasts: [],
  pendingChoice: null,
  pendingBuy: null,
  pendingFetch: null,
  modOpen: false,
  modPause: true,
  modInfo: null,
  modRequests: [],
  newGameRequested: false,
  setPhase: (phase) => set({ phase }),
  patch: (data) => set(data),
  pushToast: (text, tone) =>
    set((s) => ({ toasts: [...s.toasts, { id: ++toastSeq, text, tone }].slice(-4) })),
  dropToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  requestMod: (request) => set((s) => ({ modRequests: [...s.modRequests, request] })),
  showBanner: (title, text, eyebrow = 'New stage') => set({ banner: { id: ++toastSeq, eyebrow, title, text } }),
}))
