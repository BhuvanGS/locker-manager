import { useGameStore } from './store/gameStore'
import { GameCanvas } from './ui/GameCanvas'
import { HUD } from './ui/HUD'
import { MainMenu } from './ui/MainMenu'
import { PauseMenu } from './ui/PauseMenu'
import './styles/app.css'

function App() {
  const phase = useGameStore((s) => s.phase)
  return (
    <div className="app-shell">
      <GameCanvas />
      {phase === 'playing' && <HUD />}
      {phase === 'menu' && <MainMenu />}
      {phase === 'paused' && <PauseMenu />}
    </div>
  )
}

export default App
