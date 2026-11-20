import type { QualitySetting } from '../engine/Quality'
import { useGameStore } from '../store/gameStore'

const QUALITY: { id: QualitySetting; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' },
]

export function PauseMenu() {
  const setPhase = useGameStore((s) => s.setPhase)
  const setting = useGameStore((s) => s.qualitySetting)
  const level = useGameStore((s) => s.qualityLevel)
  const patch = useGameStore((s) => s.patch)

  const resume = () => {
    setPhase('playing')
    document.getElementById('game-canvas')?.requestPointerLock()?.catch(() => {})
  }

  return (
    <div className="overlay">
      <div className="menu-card compact">
        <h2>Paused</h2>
        <p className="muted">The shop clock is stopped while paused.</p>
        <p className="quality-label">
          Graphics <span className="muted">· {setting === 'auto' ? `auto (${level})` : level}</span>
        </p>
        <div className="quality-row" role="radiogroup" aria-label="Graphics quality">
          {QUALITY.map((q) => (
            <button key={q.id} type="button" role="radio" aria-checked={setting === q.id} className={`quality-btn${setting === q.id ? ' on' : ''}`} onClick={() => patch({ qualitySetting: q.id })}>
              {q.label}
            </button>
          ))}
        </div>
        <div className="btn-row">
          <button type="button" className="btn-primary" onClick={resume}>
            Resume
          </button>
          <button type="button" className="btn-ghost" onClick={() => setPhase('menu')}>
            Main menu
          </button>
        </div>
      </div>
    </div>
  )
}
