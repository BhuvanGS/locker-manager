import { GameCanvas } from './ui/GameCanvas'
import { GameHUD } from './ui/GameHUD'
import { DebugOverlay } from './ui/DebugOverlay'
import { MainMenu } from './ui/MainMenu'
import { PauseMenu } from './ui/PauseMenu'
import { Phone } from './ui/Phone'
import { ResultsScreen } from './ui/ResultsScreen'
import { useGameStore } from './store/gameStore'
import './styles/app.css'

function App() {
  const phase = useGameStore((s) => s.phase)

  return (
    <div className="app-shell">
      <GameCanvas />
      {phase === 'playing' && <GameHUD />}
      {phase === 'playing' && <Phone />}
      {phase === 'playing' && <DebugOverlay />}
      {phase === 'menu' && <MainMenu />}
      {phase === 'paused' && <PauseMenu />}
      {phase === 'won' && <ResultsScreen />}
      {phase === 'caught' && <ResultsScreen />}
    </div>
  )
}

export default App