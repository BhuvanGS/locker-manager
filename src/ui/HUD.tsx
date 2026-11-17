import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useGameStore, type Toast } from '../store/gameStore'
import { DialoguePanel } from './DialoguePanel'

/** In-game overlay. Only shows what Stage 1 has: no database, no labels, no upgrade tree yet. */
export function HUD() {
  // Shallow-compare the fields we show: the Engine patches the store every frame.
  const s = useGameStore(
    useShallow((st) => ({
      money: st.money,
      lockersFree: st.lockersFree,
      lockersTotal: st.lockersTotal,
      activeDeposits: st.activeDeposits,
      queue: st.queue,
      served: st.served,
      level: st.level,
      xpInto: st.xpInto,
      xpNeeded: st.xpNeeded,
      reputation: st.reputation,
      mistakes: st.mistakes,
      stageLabel: st.stageLabel,
      objective: st.objective,
      prompt: st.prompt,
      promptHint: st.promptHint,
      holding: st.holding,
      dialogue: st.dialogue,
      tutorialComplete: st.tutorialComplete,
      pointerLocked: st.pointerLocked,
    })),
  )

  return (
    <div className="hud">
      <div className="hud-top">
        <div className="stat-bar">
          <Stat label="Cash" value={`$${s.money}`} />
          <Stat label="Lockers free" value={`${s.lockersFree}/${s.lockersTotal}`} />
          <Stat label="Deposits" value={String(s.activeDeposits)} />
          <Stat label="Queue" value={String(s.queue)} />
          <Stat label="Served" value={String(s.served)} />
          <div className="stat level">
            <span className="stat-label">Level {s.level}</span>
            <span className="xp-bar">
              <span style={{ width: `${Math.round((s.xpInto / s.xpNeeded) * 100)}%` }} />
            </span>
          </div>
        </div>
        <span className="stage-chip">{s.stageLabel}</span>
      </div>

      <div className="objective">
        <span className="objective-label">Objective</span>
        <span className="objective-text">{s.objective}</span>
      </div>

      <div className={`crosshair${s.prompt ? ' active' : ''}`} aria-hidden="true" />

      {(s.prompt || s.promptHint) && !s.dialogue && (
        <div className={`prompt${s.prompt ? '' : ' hint'}`}>
          {s.prompt ? (
            <>
              <kbd>E</kbd> {s.prompt}
            </>
          ) : (
            s.promptHint
          )}
        </div>
      )}

      {s.holding && (
        <div className="holding">
          <span className="stat-label">Holding</span> {s.holding}
        </div>
      )}

      {s.dialogue && <DialoguePanel dialogue={s.dialogue} />}

      <Toasts />

      {s.tutorialComplete && (
        <div className="milestone-card">
          <p className="eyebrow">Milestone 1 complete</p>
          <h2>First customer served</h2>
          <p>
            You took a bag, stored it, kept track of the key and handed it back to the right person.
          </p>
          <p>
            Cash <strong>${s.money}</strong> · reputation {s.reputation} · {s.mistakes} mistake
            {s.mistakes === 1 ? '' : 's'}
          </p>
          <p className="muted">More customers, random arrivals and queues arrive in Milestone 2.</p>
        </div>
      )}

      {!s.pointerLocked && !s.dialogue && !s.tutorialComplete && <p className="click-hint">Click to look around</p>}

      <div className="controls">
        <kbd>WASD</kbd> move · <kbd>Mouse</kbd> look · <kbd>E</kbd>/<kbd>Click</kbd> use · <kbd>1-6</kbd> answer ·{' '}
        <kbd>Esc</kbd> pause
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  )
}

function Toasts() {
  const toasts = useGameStore((s) => s.toasts)
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  )
}

function ToastItem({ toast }: { toast: Toast }) {
  const dropToast = useGameStore((s) => s.dropToast)
  useEffect(() => {
    const timer = window.setTimeout(() => dropToast(toast.id), toast.tone === 'bad' ? 3500 : 2600)
    return () => window.clearTimeout(timer)
  }, [toast, dropToast])
  return <div className={`toast ${toast.tone}`}>{toast.text}</div>
}
