/**
 * The saved game in localStorage: the whole simulation (`GameManager.toSave`), where the player stood, and a short summary for the
 * main menu. One slot; the Engine writes it every `AUTOSAVE_SECONDS` of play, on pausing, when the tab is hidden, and from the pause menu.
 */
export const AUTOSAVE_SECONDS = 30
const KEY = 'locker-manager-save'
const VERSION = 1

export interface SaveSummary {
  savedAt: number
  level: number
  money: number
  lockers: number
}

export interface SaveFile {
  version: number
  summary: SaveSummary
  player: { x: number; feetY: number; z: number; yaw: number; pitch: number }
  sim: unknown
}

export function writeSave(file: Omit<SaveFile, 'version'>): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: VERSION, ...file }))
    return true
  } catch {
    return false // storage full or blocked (private window): the game carries on unsaved
  }
}

export function readSave(): SaveFile | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const file = JSON.parse(raw) as SaveFile
    return file.version === VERSION && file.sim ? file : null
  } catch {
    return null
  }
}

export function saveSummary(): SaveSummary | null {
  return readSave()?.summary ?? null
}
