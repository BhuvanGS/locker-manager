import { useGameStore, type CatalogueView } from '../store/gameStore'

/**
 * The supplier catalogue: where you spend cash on more storage and key racks.
 * The shop keeps running while you browse. W/S or scroll to choose, E to buy, Q to close.
 */
export function CataloguePanel({ catalogue }: { catalogue: CatalogueView }) {
  const patch = useGameStore((s) => s.patch)
  const selected = useGameStore((s) => s.catalogueIndex)

  return (
    <div className="catalogue" role="dialog" aria-label="Supplier catalogue">
      <div className="catalogue-head">
        <p className="catalogue-title">Supplier catalogue</p>
        <p className="catalogue-wallet">
          <span>Cash</span> <strong>${catalogue.money}</strong>
          <span className="sep">·</span>
          <span>Level</span> <strong>{catalogue.level}</strong>
        </p>
      </div>
      <ol className="catalogue-items" role="listbox" aria-label="Upgrades">
        {catalogue.items.map((item, i) => (
          <li key={item.id}>
            <button
              type="button"
              role="option"
              aria-selected={i === selected}
              ref={(el) => {
                // Keep the highlighted row on screen when the list is longer than the window.
                if (i === selected && el) el.scrollIntoView({ block: 'nearest' })
              }}
              className={`catalogue-row ${item.state}${i === selected ? ' selected' : ''}`}
              onClick={() => patch({ pendingBuy: item.id })}
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
        <kbd>S</kbd> or scroll to choose · <kbd>1</kbd>–<kbd>{Math.min(9, catalogue.items.length)}</kbd> jump · <kbd>Q</kbd> close
      </p>
    </div>
  )
}
