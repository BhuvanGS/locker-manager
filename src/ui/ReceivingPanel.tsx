import { CONFIG, type CargoType, type Section } from '../sim/config'
import { useGameStore, type ReceivingView } from '../store/gameStore'

const SECTION_NAME: Record<Section, string> = { shelves: 'Shelves', cold: 'Cold room', vault: 'Vault', hidden: 'Underground' }
const label = (c: CargoType) => CONFIG.warehouse.cargo[c].label

/**
 * The receiving desk: every load parked beside the warehouse. Pick one with W/S, then press 1 to open a crate and see what is really inside
 * (it takes a few seconds), or 2 to send the load back (only before you have unloaded any of it). You carry the crates in yourself.
 * What a load LOOKS like is what the driver says it is: contraband is declared as something harmless until you open it (or buy a scanner).
 */
export function ReceivingPanel({ view }: { view: ReceivingView }) {
  const patch = useGameStore((s) => s.patch)
  const selected = useGameStore((s) => s.receivingIndex)

  return (
    <div className="catalogue" role="dialog" aria-label="Receiving desk">
      <div className="catalogue-head">
        <p className="catalogue-title">Receiving desk · parked loads</p>
        <p className="catalogue-wallet">
          {view.autoLevel > 0 && <span>Robots {view.autoLevel} on duty ·</span>} {view.scanner && <span>Scanner ·</span>}
          {view.sections.map((s) => (
            <span key={s.section}>
              {' '}
              {SECTION_NAME[s.section]} <strong>{s.stored}/{s.capacity}</strong>
            </span>
          ))}
        </p>
      </div>
      {view.loads.length === 0 ? (
        <p className="terminal-empty">No trucks parked. They come now and then and park outside the shutter.</p>
      ) : (
        <ol className="catalogue-items" role="listbox" aria-label="Parked loads">
          {view.loads.map((load, i) => {
            const lie = load.known && load.declared !== load.looksLike
            return (
              <li key={load.id}>
                <div className={`catalogue-row available${i === selected ? ' selected' : ''}`}>
                  <kbd>{i + 1}</kbd>
                  <span className="catalogue-name">
                    <strong>
                      {load.owner} · {load.onTruck} of {load.crates} crates on the truck · {label(load.looksLike)}
                    </strong>
                    <span>
                      {load.opening
                        ? 'Opening the crates…'
                        : lie
                          ? `Declared as ${label(load.declared).toLowerCase()}, but it is ${label(load.looksLike).toLowerCase()}!`
                          : load.known
                            ? 'You know what is in it.'
                            : 'As declared by the driver (not checked).'}
                      {load.spoiled ? ' · SPOILED' : ''}
                      {load.vip ? ' · VIP deal' : ''}
                      {' · '}
                      {load.goesTo ? `belongs in: ${SECTION_NAME[load.goesTo].toLowerCase()}` : 'no room!'}
                    </span>
                  </span>
                  <span className="receiving-actions">
                    {(['inspect', 'refuse'] as const).map((action, n) => (
                      <button
                        key={action}
                        type="button"
                        onClick={() => patch({ pendingReceive: { id: load.id, action } })}
                        disabled={load.opening || (action === 'inspect' ? load.known : load.onTruck < load.crates)}
                      >
                        <kbd>{n + 1}</kbd> {action === 'inspect' ? 'Open a crate' : 'Send it back'}
                      </button>
                    ))}
                  </span>
                </div>
              </li>
            )
          })}
        </ol>
      )}
      <p className="dialogue-keys">
        <kbd>W</kbd>
        <kbd>S</kbd> or scroll to pick a load · <kbd>1</kbd> open a crate · <kbd>2</kbd> send it back · <kbd>Q</kbd> close · carry the crates in from the truck
      </p>
    </div>
  )
}
