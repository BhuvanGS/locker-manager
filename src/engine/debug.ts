import { useGameStore } from '../store/gameStore'

export type DebugSnapshot = {
  holding: boolean
  heldStoneId: number | null
  holdRootInScene: boolean
  heldMeshAttached: boolean
  aimedStoneId: number | null
  pickMethod: string | null
  holdWorldPos: string | null
  holdAnchorChildCount: number
  fakeRockLabel: string
}

const MAX_LINES = 16

export function isGameDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  if (params.has('debug')) {
    const v = params.get('debug')
    if (v === null || v === '' || v === '1' || v === 'true') return true
  }
  try {
    return localStorage.getItem('wmk-debug') === '1'
  } catch {
    return false
  }
}

export function setGameDebugPersistence(on: boolean): void {
  try {
    if (on) localStorage.setItem('wmk-debug', '1')
    else localStorage.removeItem('wmk-debug')
  } catch {
    /* ignore */
  }
}

export function debugStep(message: string): void {
  if (!isGameDebugEnabled()) return
  const line = `${new Date().toISOString().slice(11, 23)} ${message}`
  console.info('%c[WMK debug]', 'color:#fbbf24;font-weight:bold', message)
  useGameStore.getState().appendDebugLine(line)
}

export function syncDebugPanel(snapshot: DebugSnapshot): void {
  if (!isGameDebugEnabled()) return
  useGameStore.getState().setDebugSnapshot(snapshot)
}

export function clearDebugLines(): void {
  useGameStore.getState().clearDebugLines()
}

export { MAX_LINES }