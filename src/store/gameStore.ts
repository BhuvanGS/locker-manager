import { create } from 'zustand'
import type { DialogueOptionId } from '../sim/types'

export type GamePhase = 'menu' | 'playing' | 'paused'

export type DialogueView = {
  speaker: string
  lines: { who: string; text: string }[]
  options: { id: DialogueOptionId; label: string; disabled: string | null }[]
}

export type Toast = { id: number; text: string; tone: 'good' | 'bad' | 'info' }

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
  tutorialComplete: boolean

  prompt: string | null
  promptHint: string | null
  holding: string | null
  dialogue: DialogueView | null
  toasts: Toast[]

  /** Dialogue choice clicked in the UI, consumed by the Engine. */
  pendingChoice: DialogueOptionId | null
  /** Set by the menu to ask the Engine for a fresh game. */
  newGameRequested: boolean

  setPhase: (phase: GamePhase) => void
  patch: (data: Partial<GameStoreState>) => void
  pushToast: (text: string, tone: Toast['tone']) => void
  dropToast: (id: number) => void
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
  stageLabel: 'Stage 1 · Basic facility',
  objective: '',
  tutorialComplete: false,
  prompt: null,
  promptHint: null,
  holding: null,
  dialogue: null,
  toasts: [],
  pendingChoice: null,
  newGameRequested: false,
  setPhase: (phase) => set({ phase }),
  patch: (data) => set(data),
  pushToast: (text, tone) =>
    set((s) => ({ toasts: [...s.toasts, { id: ++toastSeq, text, tone }].slice(-4) })),
  dropToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))
