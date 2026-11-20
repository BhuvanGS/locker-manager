import { useState } from 'react'
import { CONFIG } from '../sim/config'
import { useGameStore } from '../store/gameStore'

/** "5 min ago", "yesterday 18:40": when the save was made. */
function when(savedAt: number): string {
  const s = (Date.now() - savedAt) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  const d = new Date(savedAt)
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return s < 86400 ? `today ${time}` : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`
}

export function MainMenu() {
  const patch = useGameStore((s) => s.patch)
  const save = useGameStore((s) => s.save)
  const [confirmNew, setConfirmNew] = useState(false)

  const go = (request: { newGameRequested: true } | { continueRequested: true }) => {
    patch({ phase: 'playing', ...request })
    const canvas = document.getElementById('game-canvas')
    canvas?.focus()
    canvas?.requestPointerLock()?.catch(() => {})
  }
  const start = () => (save && !confirmNew ? setConfirmNew(true) : go({ newGameRequested: true }))

  return (
    <div className="overlay">
      <div className="menu-card">
        <p className="eyebrow">From memory to automation</p>
        <h1>Locker Manager</h1>
        <p className="lede">
          You just opened a tiny bag-storage shop: one counter, six identical lockers, and a board of
          identical keys. No computer, no labels, no notebook. Customers leave their things with you
          and come back later. Remember who left what, where you put it, and which key opens it.
        </p>
        {save ? (
          <div className="save-slot">
            <button type="button" className="btn-primary" onClick={() => go({ continueRequested: true })}>
              Continue
            </button>
            <p className="save-meta">
              Level {save.level} · ${save.money.toLocaleString()} · {save.lockers} lockers · saved {when(save.savedAt)}
            </p>
            {confirmNew ? (
              <div className="save-confirm">
                <span>A new game replaces this save.</span>
                <button type="button" className="btn-danger" onClick={start}>
                  Start over
                </button>
                <button type="button" className="btn-ghost" onClick={() => setConfirmNew(false)}>
                  Keep it
                </button>
              </div>
            ) : (
              <button type="button" className="btn-ghost" onClick={start}>
                New game
              </button>
            )}
          </div>
        ) : (
          <button type="button" className="btn-primary" onClick={start}>
            Open the shop
          </button>
        )}
        <ul className="control-list">
          <li>
            <kbd>WASD</kbd> move · <kbd>Space</kbd> jump · <kbd>Shift</kbd> walk faster · <kbd>Mouse</kbd> look
          </li>
          <li>
            <kbd>E</kbd> or <kbd>Click</kbd> uses whatever is under the crosshair: customers, locker doors,
            keys, the key board.
          </li>
          <li>
            Talking: the next step is pre-selected, so just press <kbd>E</kbd>. Scroll or <kbd>W</kbd>/<kbd>S</kbd> to choose
            something else, <kbd>1</kbd>–<kbd>6</kbd> to jump to an answer, <kbd>Q</kbd> to step away. You stand still while
            talking. <kbd>Esc</kbd> pauses.
            {CONFIG.modMenu.enabled && (
              <>
                {' '}
                <kbd>M</kbd> opens the mod menu (free cash, levels and upgrades, so you don't have to grind).
              </>
            )}
          </li>
        </ul>
      </div>
    </div>
  )
}
