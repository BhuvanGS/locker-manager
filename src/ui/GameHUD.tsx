import { useGameStore } from '../store/gameStore'
import type { CopState } from '../npcs/types'

export function GameHUD() {
  const locationLabel = useGameStore((s) => s.locationLabel)
  const interactionPrompt = useGameStore((s) => s.interactionPrompt)
  const fps = useGameStore((s) => s.fps)
  const pointerLocked = useGameStore((s) => s.pointerLocked)
  const objective = useGameStore((s) => s.objective)
  const timeOfDay = useGameStore((s) => s.timeOfDay)
  const gravelStoneCount = useGameStore((s) => s.gravelStoneCount)
  const rocksInspected = useGameStore((s) => s.rocksInspected)
  const rocksPickedUp = useGameStore((s) => s.rocksPickedUp)
  const heldRockTitle = useGameStore((s) => s.heldRockTitle)
  const heldRockDetail = useGameStore((s) => s.heldRockDetail)
  const heldRockMass = useGameStore((s) => s.heldRockMass)
  const peekRockTitle = useGameStore((s) => s.peekRockTitle)
  const peekRockDetail = useGameStore((s) => s.peekRockDetail)
  const peekRockMass = useGameStore((s) => s.peekRockMass)
  const inspectLabel = useGameStore((s) => s.inspectLabel)
  const hasKey = useGameStore((s) => s.hasKey)
  const statusLine = useGameStore((s) => s.statusLine)
  const dialogue = useGameStore((s) => s.dialogue)
  const copState = useGameStore((s) => s.copState)
  const copTimer = useGameStore((s) => s.copTimer)
  const suspicion = useGameStore((s) => s.suspicion)
  const alertName = useGameStore((s) => s.alertName)
  const copsCalled = useGameStore((s) => s.copsCalled)

  const showHeld = Boolean(heldRockTitle)
  const title = showHeld ? heldRockTitle : peekRockTitle
  const detail = showHeld ? heldRockDetail : peekRockDetail
  const mass = showHeld ? heldRockMass : peekRockMass
  const label = showHeld ? 'In hand' : (inspectLabel ?? null)
  const showInspect = Boolean(title && label)
  const onTarget = Boolean(peekRockTitle) && !showHeld

  return (
    <div className="hud">
      <div className={`crosshair${onTarget ? ' on-target' : ''}${showHeld ? ' holding' : ''}`} aria-hidden="true">
        <span className="crosshair-dot" />
      </div>
      <div className="hud-top">
        <div className="hud-location">
          <span className="label">Where</span>
          <strong>{locationLabel}</strong>
          <span className="divider">·</span>
          <span className="label">Time</span>
          <strong>{timeOfDay}</strong>
        </div>
        <span className="metric">{fps} FPS</span>
      </div>

      <div className="objective-card">
        <p className="objective-title">Objective</p>
        <p className="objective-text">{objective}</p>
        <p className="objective-meta">
          {gravelStoneCount.toLocaleString()} stones · picked up {rocksPickedUp.toLocaleString()} ·
          undersides checked {rocksInspected.toLocaleString()}
          {hasKey ? ' · key in pocket' : ''}
        </p>
        {statusLine && <p className="status-line">{statusLine}</p>}
      </div>

      {suspicion >= 1 && alertName && !dialogue && !copsCalled && (
        <div className="suspect-marker">
          <span className="suspect-bang">!</span>
          <span>
            {alertName} remembers · {Math.round(suspicion)}
            <span className="suspect-bar">
              <span style={{ width: `${Math.min(100, Math.round((suspicion / 40) * 100))}%` }} />
            </span>
          </span>
        </div>
      )}

      {copsCalled && (
        <div className={`suspect-marker police${copState === 'waiting' ? ' timer' : ''}`}>
          <span className="suspect-bang">{copState === 'waiting' ? copTimer : '!'}</span>
          <span>{policeStatus(copState)}</span>
        </div>
      )}

      {dialogue && (
        <div className={`dialogue-box ${dialogue.tone}`} role="dialog" aria-label={`Talking to ${dialogue.speaker}`}>
          <p className="dialogue-name">{dialogue.speaker}</p>
          <ul className="dialogue-lines">
            {dialogue.lines.map((line, index) => (
              <li
                key={`${index}-${line.text}`}
                className={line.who === 'You' ? 'from-you' : 'from-them'}
              >
                <span className="dialogue-who">{line.who}</span>
                <span className="dialogue-said">{line.text}</span>
              </li>
            ))}
          </ul>
          {dialogue.options.length > 0 && (
            <div className="dialogue-options">
              {dialogue.options.map((option) => (
                <span key={option.key} className="dialogue-option">
                  <kbd>{option.key}</kbd> {option.label}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {showInspect && (
        <div className="inspect-card">
          <p className="inspect-title">
            {label} — {title}
          </p>
          <p className="inspect-mass">{mass}</p>
          <p className="inspect-detail">{detail}</p>
        </div>
      )}

      {!pointerLocked && !dialogue && (
        <p className="hud-hint center">Click the view to capture mouse</p>
      )}

      {interactionPrompt && !dialogue && (
        <div className="hud-prompt">
          <span>{interactionPrompt}</span>
        </div>
      )}

      <div className="hud-footer">
        <span>
          Click once to capture mouse · <kbd>LMB</kbd> pick up · <kbd>RMB</kbd> flip · <kbd>F</kbd> open · <kbd>C</kbd> crouch
          · <kbd>G</kbd> greet · <kbd>X</kbd> explain · <kbd>I</kbd> phone
        </span>
      </div>
    </div>
  )
}
function policeStatus(state: CopState): string {
  switch (state) {
    case 'driving':
      return 'Police are on the way'
    case 'approaching':
      return 'The officer is walking over to you'
    case 'questioning':
      return 'Answer the officer — press X'
    case 'waiting':
      return 'seconds to open the front door'
    case 'chasing':
      return 'The officer is chasing you'
    case 'arresting':
      return 'You are being arrested'
    default:
      return 'Police are on the way'
  }
}
