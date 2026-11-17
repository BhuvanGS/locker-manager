import { create } from 'zustand'
import type { CopState, DialogueView } from '../npcs/types'

export type GamePhase = 'menu' | 'playing' | 'paused' | 'won' | 'caught'

export type GameStoreState = {
  phase: GamePhase
  locationLabel: string
  interactionPrompt: string | null
  statusLine: string | null
  neighbourNote: string | null
  dialogue: DialogueView | null
  suspicion: number
  alertName: string | null
  copsCalled: boolean
  copState: CopState
  copTimer: number | null
  caughtReason: string | null
  hasKey: boolean
  fps: number
  pointerLocked: boolean
  phoneOpen: boolean
  objective: string
  timeOfDay: string
  gravelStoneCount: number
  rocksInspected: number
  rocksPickedUp: number
  heldRockTitle: string | null
  heldRockDetail: string | null
  heldRockMass: string | null
  peekRockTitle: string | null
  peekRockDetail: string | null
  peekRockMass: string | null
  inspectLabel: string | null
  debugEnabled: boolean
  debugLines: string[]
  debugSnapshot: string
  setPhase: (phase: GamePhase) => void
  setLocation: (locationLabel: string) => void
  setInteractionPrompt: (prompt: string | null) => void
  setStatusLine: (statusLine: string | null) => void
  setNeighbourNote: (neighbourNote: string | null) => void
  setDialogue: (dialogue: DialogueView | null) => void
  setSuspicion: (suspicion: number, alertName: string | null) => void
  setPolice: (copsCalled: boolean, copState: CopState, copTimer: number | null) => void
  setCaughtReason: (caughtReason: string | null) => void
  setHasKey: (hasKey: boolean) => void
  setObjective: (objective: string) => void
  setFps: (fps: number) => void
  setPointerLocked: (locked: boolean) => void
  setPhoneOpen: (phoneOpen: boolean) => void
  setWorldMeta: (data: { gravelStoneCount: number }) => void
  setSearchStats: (data: {
    rocksInspected: number
    rocksPickedUp: number
    heldRockTitle: string | null
    heldRockDetail: string | null
    heldRockMass: string | null
    peekRockTitle: string | null
    peekRockDetail: string | null
    peekRockMass: string | null
    inspectLabel: string | null
  }) => void
  appendDebugLine: (line: string) => void
  clearDebugLines: () => void
  setDebugSnapshot: (snapshot: {
    holding: boolean
    heldStoneId: number | null
    holdRootInScene: boolean
    heldMeshAttached: boolean
    aimedStoneId: number | null
    pickMethod: string | null
    holdWorldPos: string | null
    holdAnchorChildCount: number
    fakeRockLabel: string
  }) => void
}

export const useGameStore = create<GameStoreState>((set) => ({
  phase: 'menu',
  locationLabel: 'Your property',
  interactionPrompt: null,
  statusLine: null,
  neighbourNote: null,
  dialogue: null,
  suspicion: 0,
  alertName: null,
  copsCalled: false,
  copState: 'none',
  copTimer: null,
  caughtReason: null,
  hasKey: false,
  fps: 0,
  pointerLocked: false,
  phoneOpen: false,
  objective: 'FIND THE FAKE ROCK · GET THE KEY · GET INSIDE',
  timeOfDay: 'Afternoon',
  gravelStoneCount: 0,
  rocksInspected: 0,
  rocksPickedUp: 0,
  heldRockTitle: null,
  heldRockDetail: null,
  heldRockMass: null,
  peekRockTitle: null,
  peekRockDetail: null,
  peekRockMass: null,
  inspectLabel: null,
  debugEnabled: false,
  debugLines: [] as string[],
  debugSnapshot: '',
  setPhase: (phase) => set({ phase }),
  setLocation: (locationLabel) => set({ locationLabel }),
  setInteractionPrompt: (interactionPrompt) => set({ interactionPrompt }),
  setStatusLine: (statusLine) => set({ statusLine }),
  setNeighbourNote: (neighbourNote) => set({ neighbourNote }),
  setDialogue: (dialogue) => set({ dialogue }),
  setSuspicion: (suspicion, alertName) => set({ suspicion, alertName }),
  setPolice: (copsCalled, copState, copTimer) => set({ copsCalled, copState, copTimer }),
  setCaughtReason: (caughtReason) => set({ caughtReason }),
  setHasKey: (hasKey) => set({ hasKey }),
  setObjective: (objective) => set({ objective }),
  setFps: (fps) => set({ fps }),
  setPointerLocked: (pointerLocked) => set({ pointerLocked }),
  setPhoneOpen: (phoneOpen) => set({ phoneOpen }),
  setWorldMeta: (data) => set(data),
  setSearchStats: (data) => set(data),
  appendDebugLine: (line) =>
    set((s) => ({
      debugLines: [line, ...s.debugLines].slice(0, 16),
    })),
  clearDebugLines: () => set({ debugLines: [] }),
  setDebugSnapshot: (snapshot) =>
    set({
      debugSnapshot: [
        `hold=${snapshot.holding}`,
        snapshot.heldStoneId !== null ? `stone=#${snapshot.heldStoneId + 1}` : 'stone=—',
        `holdRootInScene=${snapshot.holdRootInScene}`,
        `heldMesh=${snapshot.heldMeshAttached}`,
        snapshot.aimedStoneId !== null ? `aim=#${snapshot.aimedStoneId + 1}` : 'aim=—',
        snapshot.pickMethod ? `lastPick=${snapshot.pickMethod}` : '',
        snapshot.holdWorldPos ? `holdPos=${snapshot.holdWorldPos}` : '',
        `holdKids=${snapshot.holdAnchorChildCount}`,
        `FAKE ROCK ${snapshot.fakeRockLabel} (pink)`,
      ]
        .filter(Boolean)
        .join(' · '),
    }),
}))