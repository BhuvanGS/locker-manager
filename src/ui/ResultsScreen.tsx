import { useGameStore } from '../store/gameStore'

export function ResultsScreen() {
  const phase = useGameStore((s) => s.phase)
  const rocksPickedUp = useGameStore((s) => s.rocksPickedUp)
  const rocksInspected = useGameStore((s) => s.rocksInspected)
  const setPhase = useGameStore((s) => s.setPhase)
  const caughtReason = useGameStore((s) => s.caughtReason)
  const caught = phase === 'caught'

  return (
    <div className="pause-overlay">
      <div className="menu-card">
        <p className="eyebrow">{caught ? 'They called it in' : 'You found it'}</p>
        <h1>{caught ? 'You were arrested.' : 'The door is open.'}</h1>
        <p className="lede">
          {caught
            ? `${caughtReason ?? 'A neighbour called the police.'} Next time, explain yourself once — then find that key fast.`
            : 'One fake rock, one key, and a lawn full of ordinary stones. The neighbours can relax.'}
        </p>
        <p className="objective-meta">
          Picked up {rocksPickedUp.toLocaleString()} · undersides checked{' '}
          {rocksInspected.toLocaleString()}
        </p>
        <button type="button" className="btn-primary" onClick={() => setPhase('menu')}>
          Back to menu
        </button>
      </div>
    </div>
  )
}
