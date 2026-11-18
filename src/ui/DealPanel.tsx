import { useGameStore, type DealView } from '../store/gameStore'

/**
 * The deal desk: a VIP's offer and what you can say to them. It looks and works like the catalogue (W/S or scroll to choose, E to confirm,
 * Q to step away) and the shop keeps running, so the VIP's patience is ticking.
 */
export function DealPanel({ deal }: { deal: DealView }) {
  const patch = useGameStore((s) => s.patch)
  const selected = useGameStore((s) => s.dealIndex)

  return (
    <div className="catalogue" role="dialog" aria-label={`Offer from ${deal.name}`}>
      <div className="catalogue-head">
        <p className="catalogue-title">
          {deal.name} <span className="deal-title">· {deal.title}</span>
        </p>
        <p className="catalogue-wallet">
          <span>Waits</span> <strong>{deal.waitLeft}s</strong>
        </p>
      </div>
      {deal.pitch ? (
        <p className="deal-offer">
          {deal.pitch} Retainer: <strong>${deal.retainer}</strong>, paid on signing.
        </p>
      ) : (
        <p className="deal-offer">
          Wants to store <strong>{deal.crates} crates</strong> of {deal.cargo} with you. Retainer: <strong>${deal.retainer}</strong>, paid on signing. The crates
          arrive when you open a warehouse.
        </p>
      )}
      <ol className="catalogue-items" role="listbox" aria-label="Your answer">
        {deal.options.map((option, i) => (
          <li key={option.id}>
            <button
              type="button"
              role="option"
              aria-selected={i === selected}
              className={`catalogue-row ${option.disabled ? 'locked' : 'available'}${i === selected ? ' selected' : ''}`}
              onClick={() => patch({ pendingDeal: option.id })}
            >
              <kbd>{i + 1}</kbd>
              <span className="catalogue-name">
                <strong>{option.label}</strong>
              </span>
              <span className="catalogue-price">{option.disabled ? <em>{option.disabled}</em> : i === selected && <em className="buy">E</em>}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="dialogue-keys">
        You have signed {deal.signed} deal{deal.signed === 1 ? '' : 's'} ({deal.signedCrates} crates) · <kbd>E</kbd> choose · <kbd>W</kbd>
        <kbd>S</kbd> or scroll · <kbd>1</kbd>–<kbd>3</kbd> pick · <kbd>Q</kbd> step away
      </p>
    </div>
  )
}
