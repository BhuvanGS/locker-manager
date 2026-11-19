import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useGameStore, type Banner, type Toast } from '../store/gameStore'
import { CataloguePanel } from './CataloguePanel'
import { ConsolePanel } from './ConsolePanel'
import { DealPanel } from './DealPanel'
import { DialoguePanel } from './DialoguePanel'
import { ReceivingPanel } from './ReceivingPanel'
import { TerminalPanel } from './TerminalPanel'

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
      bigEvent: st.bigEvent,
      objective: st.objective,
      aimPerson: st.aimPerson,
      reminders: st.reminders,
      prompt: st.prompt,
      promptHint: st.promptHint,
      holding: st.holding,
      dialogue: st.dialogue,
      catalogue: st.catalogue,
      terminal: st.terminal,
      console: st.console,
      deal: st.deal,
      receiving: st.receiving,
      banner: st.banner,
      pointerLocked: st.pointerLocked,
    })),
  )

  return (
    <div className="hud">
      <div className="hud-top">
        <div className="stat-bar">
          <Ticket no="001" label="Cash" value={`$${s.money}`} icon="coin" />
          <Ticket no="002" label="Lockers free" value={`${s.lockersFree}/${s.lockersTotal}`} icon="locker" />
          <Ticket no="003" label="Deposits" value={String(s.activeDeposits)} icon="bag" />
          <Ticket no="004" label="Queue" value={String(s.queue)} icon="queue" />
          <Ticket no="005" label="Served" value={String(s.served)} icon="check" />
          <LevelTag level={s.level} fraction={s.xpInto / Math.max(1, s.xpNeeded)} />
        </div>
        <span className="stage-chip">
          <span>{s.stageLabel}</span>
        </span>
        {s.bigEvent && (
          <span className="event-chip">
            <span>{s.bigEvent}</span>
          </span>
        )}
      </div>

      <div className="objective">
        <span className="objective-clip" aria-hidden="true" />
        <span className="objective-label">Work order</span>
        <span className="objective-text">{s.objective}</span>
        {s.reminders && (
          <ul className="reminders">
            {s.reminders.split('\n').map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
      </div>

      {!s.aimPerson && <div className={`crosshair${s.prompt ? ' active' : ''}`} aria-hidden="true" />}

      {(s.prompt || s.promptHint) && !s.dialogue && !s.catalogue && !s.terminal && !s.console && !s.deal && !s.receiving && (
        <div className={`prompt${s.prompt ? '' : ' hint'}`}>
          {s.prompt ? (
            <>
              <kbd className="key-cap">E</kbd> <span>{s.prompt}</span>
            </>
          ) : (
            s.promptHint
          )}
        </div>
      )}

      {s.holding && (
        <div className="holding">
          <span className="holding-label">In hand</span>
          <span className="holding-item">{s.holding}</span>
        </div>
      )}

      {s.dialogue && <DialoguePanel dialogue={s.dialogue} />}
      {s.catalogue && <CataloguePanel catalogue={s.catalogue} />}
      {s.terminal && <TerminalPanel terminal={s.terminal} />}
      {s.console && <ConsolePanel console={s.console} />}
      {s.deal && <DealPanel deal={s.deal} />}
      {s.receiving && <ReceivingPanel view={s.receiving} />}

      <Toasts />

      {s.banner && <BannerCard banner={s.banner} />}

      {!s.pointerLocked && !s.dialogue && !s.catalogue && !s.terminal && !s.console && !s.deal && !s.receiving && !s.banner && <p className="click-hint">Click to look around</p>}

      <div className="controls">
        <kbd>WASD</kbd> move · <kbd>Space</kbd> jump · <kbd>Mouse</kbd> look · <kbd>E</kbd>/<kbd>Click</kbd> use · <kbd>Scroll</kbd>/<kbd>1-6</kbd> talk ·{' '}
        <kbd>Esc</kbd> pause
      </div>
    </div>
  )
}

type IconName = 'coin' | 'locker' | 'bag' | 'queue' | 'check'

/** One stat as a cloakroom ticket: a serial number, the label, the figure, and a perforated stub with an icon. */
function Ticket({ no, label, value, icon }: { no: string; label: string; value: string; icon: IconName }) {
  return (
    <div className="ticket">
      <div className="ticket-body">
        <span className="ticket-no">No. {no}</span>
        <span className="ticket-label">{label}</span>
        <span className="ticket-value">{value}</span>
      </div>
      <span className="ticket-stub" aria-hidden="true">
        <TicketIcon name={icon} />
      </span>
    </div>
  )
}

/** The level as a luggage tag on a string: the number, and the XP as a row of stamped squares. */
function LevelTag({ level, fraction }: { level: number; fraction: number }) {
  const filled = Math.round(Math.max(0, Math.min(1, fraction)) * 10)
  return (
    <div className="level-tag">
      <span className="level-eyelet" aria-hidden="true" />
      <span className="level-word">Level</span>
      <span className="level-number">{level}</span>
      <span className="level-xp" aria-label={`${Math.round(fraction * 100)}% to the next level`}>
        {Array.from({ length: 10 }, (_, i) => (
          <i key={i} className={i < filled ? 'on' : undefined} />
        ))}
      </span>
    </div>
  )
}

function TicketIcon({ name }: { name: IconName }) {
  const common = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'coin':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M14.8 9.2c-.6-.9-1.6-1.4-2.8-1.4-1.6 0-2.8.8-2.8 2 0 2.9 5.8 1.5 5.8 4.4 0 1.2-1.3 2-2.9 2-1.3 0-2.4-.6-3-1.5M12 6.3v1.5M12 16.2v1.5" />
        </svg>
      )
    case 'locker':
      return (
        <svg {...common}>
          <rect x="5" y="3.5" width="14" height="17" rx="1.5" />
          <path d="M12 3.5v17M8 8h1.5M14.5 8H16M9.5 13v2M14.5 13v2" />
        </svg>
      )
    case 'bag':
      return (
        <svg {...common}>
          <rect x="4" y="8" width="16" height="12" rx="2" />
          <path d="M9 8V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V8M4 13h16" />
        </svg>
      )
    case 'queue':
      return (
        <svg {...common}>
          <circle cx="7" cy="8" r="2.5" />
          <circle cx="17" cy="8" r="2.5" />
          <path d="M3 19c0-2.8 1.8-4.6 4-4.6s4 1.8 4 4.6M13 19c0-2.8 1.8-4.6 4-4.6s4 1.8 4 4.6" />
        </svg>
      )
    case 'check':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="m8 12.3 2.7 2.7L16.2 9.3" />
        </svg>
      )
  }
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
  return (
    <div className={`toast ${toast.tone}`}>
      <span className="toast-mark" aria-hidden="true">
        {toast.tone === 'good' ? '✓' : toast.tone === 'bad' ? '!' : '•'}
      </span>
      <span className="toast-text">{toast.text}</span>
    </div>
  )
}

function BannerCard({ banner }: { banner: Banner }) {
  const patch = useGameStore((s) => s.patch)
  useEffect(() => {
    const timer = window.setTimeout(() => patch({ banner: null }), 6500)
    return () => window.clearTimeout(timer)
  }, [banner, patch])
  return (
    <div className="banner" role="status">
      <div className="banner-body">
        <p className="eyebrow">{banner.eyebrow}</p>
        <h2>{banner.title}</h2>
        <p>{banner.text}</p>
      </div>
      <span className="banner-stub" aria-hidden="true">
        <span>Admit one</span>
      </span>
    </div>
  )
}
