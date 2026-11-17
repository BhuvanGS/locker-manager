import { useGameStore } from '../store/gameStore'

export function PauseMenu() {
  const setPhase = useGameStore((s) => s.setPhase)

  const resume = () => {
    setPhase('playing')
    const canvas = document.getElementById('game-canvas')
    void canvas?.requestPointerLock()
  }

  const toMenu = () => {
    setPhase('menu')
    void document.exitPointerLock()
  }

  return (
    <div className="pause-overlay">
      <div className="menu-card compact">
        <h2>Paused</h2>
        <div className="btn-row">
          <button type="button" className="btn-primary" onClick={resume}>
            Resume
          </button>
          <button type="button" className="btn-ghost" onClick={toMenu}>
            Main menu
          </button>
        </div>
      </div>
    </div>
  )
}