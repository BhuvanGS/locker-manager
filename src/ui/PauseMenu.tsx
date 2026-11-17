import { useGameStore } from '../store/gameStore'

export function PauseMenu() {
  const setPhase = useGameStore((s) => s.setPhase)

  const resume = () => {
    setPhase('playing')
    document.getElementById('game-canvas')?.requestPointerLock()?.catch(() => {})
  }

  return (
    <div className="overlay">
      <div className="menu-card compact">
        <h2>Paused</h2>
        <p className="muted">The shop clock is stopped while paused.</p>
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
