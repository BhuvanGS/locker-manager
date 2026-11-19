import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { CONFIG } from '../sim/config'
import { useGameStore, type Banner, type Toast } from '../store/gameStore'
import { CataloguePanel } from './CataloguePanel'
import { ConsolePanel } from './ConsolePanel'
import { DealPanel } from './DealPanel'
import { DialoguePanel } from './DialoguePanel'
import { ModMenu } from './ModMenu'
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
      modOpen: st.modOpen,
      modInfo: st.modInfo,
      banner: st.banner,
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
        {s.bigEvent && <span className="event-chip">{s.bigEvent}</span>}
      </div>

      <div className="objective">
        <span className="objective-label">Objective</span>
        <span className="objective-text">{s.objective}</span>
        {s.reminders && (
          <ul className="reminders">
            {s.reminders.split('\n').map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
      </div>

      <div className={`crosshair${s.prompt ? ' active' : ''}`} aria-hidden="true" />

      {(s.prompt || s.promptHint) && !s.dialogue && !s.catalogue && !s.terminal && !s.console && !s.deal && !s.receiving && (
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
      {s.catalogue && <CataloguePanel catalogue={s.catalogue} />}
      {s.terminal && <TerminalPanel terminal={s.terminal} />}
      {s.console && <ConsolePanel console={s.console} />}
      {s.deal && <DealPanel deal={s.deal} />}
      {s.receiving && <ReceivingPanel view={s.receiving} />}
      {s.modOpen && s.modInfo && <ModMenu info={s.modInfo} />}
      {CONFIG.modMenu.enabled && !s.modOpen && <ModChip />}

      <Toasts />

      {s.banner && <BannerCard banner={s.banner} />}

      {!s.pointerLocked && !s.dialogue && !s.catalogue && !s.terminal && !s.console && !s.deal && !s.receiving && !s.modOpen && !s.banner && <p className="click-hint">Click to look around</p>}

      <div className="controls">
        <kbd>WASD</kbd> move · <kbd>Space</kbd> jump · <kbd>Mouse</kbd> look · <kbd>E</kbd>/<kbd>Click</kbd> use · <kbd>Scroll</kbd>/<kbd>1-6</kbd> talk ·{' '}
        <kbd>M</kbd> mods · <kbd>Esc</kbd> pause
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

function BannerCard({ banner }: { banner: Banner }) {
  const patch = useGameStore((s) => s.patch)
  useEffect(() => {
    const timer = window.setTimeout(() => patch({ banner: null }), 6500)
    return () => window.clearTimeout(timer)
  }, [banner, patch])
  return (
    <div className="banner" role="status">
      <p className="eyebrow">{banner.eyebrow}</p>
      <h2>{banner.title}</h2>
      <p>{banner.text}</p>
    </div>
  )
}

/** Small button for opening the mod menu with the mouse (only clickable while the mouse is free). */
function ModChip() {
  const patch = useGameStore((s) => s.patch)
  return (
    <button type="button" className="mod-chip" onClick={() => patch({ modOpen: true })}>
      Mods <kbd>M</kbd>
    </button>
  )
}
