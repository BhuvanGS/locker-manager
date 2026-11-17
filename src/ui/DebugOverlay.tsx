import { useGameStore } from '../store/gameStore'

export function DebugOverlay() {
  const enabled = useGameStore((s) => s.debugEnabled)
  const lines = useGameStore((s) => s.debugLines)
  const snapshot = useGameStore((s) => s.debugSnapshot)

  if (!enabled) return null

  return (
    <div className="debug-overlay">
      <p className="debug-overlay-title">Debug · ?debug=1</p>
      <p className="debug-overlay-snapshot">{snapshot || 'waiting…'}</p>
      <ul className="debug-overlay-log">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
        {lines.length === 0 && <li>No steps yet — press E on gravel</li>}
      </ul>
    </div>
  )
}