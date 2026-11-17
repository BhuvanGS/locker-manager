import { useGameStore, type ConsoleView } from '../store/gameStore'

/**
 * An automation console's upgrade menu (the control hub, or a zone's robot-arm console). It looks and works like the supplier
 * catalogue, but it only sells what belongs to the place you are standing in. W/S or scroll to choose, E to buy, Q to close.
 */
export function ConsolePanel({ console: view }: { console: ConsoleView }) {
  const patch = useGameStore((s) => s.patch)
  const selected = useGameStore((s) => s.consoleIndex)

  return (
    <div className="catalogue" role="dialog" aria-label={view.title}>
      <div className="catalogue-head">
        <p className="catalogue-title">{view.title}</p>
        <p className="catalogue-wallet">
          <span>Cash</span> <strong>${view.money}</strong>
          <span className="sep">·</span>
          <span>Level</span> <strong>{view.level}</strong>
        </p>
      </div>
      <ol className="catalogue-items" role="listbox" aria-label="Upgrades">
        {view.items.map((item, i) => (
          <li key={item.id}>
            <button
              type="button"
              role="option"
              aria-selected={i === selected}
              ref={(el) => {
                if (i === selected && el) el.scrollIntoView({ block: 'nearest' })
              }}
              className={`catalogue-row ${item.state}${i === selected ? ' selected' : ''}`}
              onClick={() => patch({ pendingConsoleBuy: item.id })}
            >
              <kbd>{i + 1}</kbd>
              <span className="catalogue-name">
                <strong>{item.title}</strong>
                <span>{item.description}</span>
              </span>
              <span className="catalogue-price">
                {item.state === 'owned' ? <em>Owned</em> : <>${item.cost}</>}
                {item.state !== 'owned' && item.note && <em>{item.note}</em>}
                {item.state === 'available' && i === selected && <em className="buy">E to buy</em>}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <p className="dialogue-keys">
        <kbd>E</kbd> buy · <kbd>W</kbd>
        <kbd>S</kbd> or scroll to choose · <kbd>1</kbd>–<kbd>{Math.max(1, Math.min(9, view.items.length))}</kbd> jump · <kbd>Q</kbd> close
      </p>
    </div>
  )
}
