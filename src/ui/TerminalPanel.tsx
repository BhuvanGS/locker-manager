import { useGameStore, type TerminalView } from '../store/gameStore'

/**
 * The conveyor terminal: pick a stored bag and the robot arm fetches it to the return tray. It lists every bag in the
 * lockers the arm can reach (locker, item and the name you took, if you asked). The shop keeps running while it is open.
 */
export function TerminalPanel({ terminal }: { terminal: TerminalView }) {
  const patch = useGameStore((s) => s.patch)
  const selected = useGameStore((s) => s.terminalIndex)

  return (
    <div className="catalogue" role="dialog" aria-label="Conveyor terminal">
      <div className="catalogue-head">
        <p className="catalogue-title">Robot arm · fetch a bag</p>
        <p className="catalogue-wallet">
          <span>Free lockers</span> <strong>{terminal.free}</strong>
          <span className="sep">·</span>
          <span>Stored</span> <strong>{terminal.entries.length}</strong>
        </p>
      </div>
      {terminal.entries.length === 0 ? (
        <p className="terminal-empty">Nothing is stored in the robot lockers yet.</p>
      ) : (
        <ol className="catalogue-items" role="listbox" aria-label="Stored bags">
          {terminal.entries.map((entry, i) => (
            <li key={entry.lockerId}>
              <button
                type="button"
                role="option"
                aria-selected={i === selected}
                ref={(el) => {
                  if (i === selected && el) el.scrollIntoView({ block: 'nearest' })
                }}
                className={`catalogue-row ${entry.fetching ? 'locked' : 'available'}${i === selected ? ' selected' : ''}`}
                onClick={() => patch({ pendingFetch: entry.lockerId })}
              >
                <kbd>{i + 1}</kbd>
                <span className="catalogue-name">
                  <strong>
                    Locker {entry.lockerNumber} · {entry.itemLabel}
                  </strong>
                  <span>{entry.name ?? 'name not taken'}</span>
                </span>
                <span className="catalogue-price">
                  {entry.fetching ? <em>Robot is on it</em> : i === selected && <em className="buy">E to fetch</em>}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
      <p className="dialogue-keys">
        <kbd>E</kbd> fetch · <kbd>W</kbd>
        <kbd>S</kbd> or scroll to choose · <kbd>1</kbd>–<kbd>{Math.max(1, Math.min(9, terminal.entries.length))}</kbd> jump · <kbd>Q</kbd> close
      </p>
    </div>
  )
}
