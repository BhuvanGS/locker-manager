import { CONFIG, type CargoType, type Section } from '../sim/config'
import { useGameStore, type ReceivingView } from '../store/gameStore'

const SECTION_NAME: Record<Section, string> = { shelves: 'Shelves', cold: 'Cold room', vault: 'Vault', hidden: 'Hidden' }
const label = (c: CargoType) => CONFIG.warehouse.cargo[c].label

/**
 * The receiving desk: every load that has been unloaded at the dock and is waiting for a decision. Pick one with W/S, then press 1 to store
 * it where it looks like it belongs, 2 to open the crates and see what is really inside (it takes a few seconds), or 3 to send it back.
 * What a load LOOKS like is what the driver says it is: contraband is declared as something harmless until you open it (or buy a scanner).
 */
export function ReceivingPanel({ view }: { view: ReceivingView }) {
  const patch = useGameStore((s) => s.patch)
  const selected = useGameStore((s) => s.receivingIndex)

  return (
    <div className="catalogue" role="dialog" aria-label="Receiving desk">
      <div className="catalogue-head">
        <p className="catalogue-title">Receiving desk · the dock</p>
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
        <p className="terminal-empty">Nothing on the dock. Trucks bring loads now and then.</p>
      ) : (
        <ol className="catalogue-items" role="listbox" aria-label="Loads on the dock">
          {view.loads.map((load, i) => {
            const lie = load.known && load.declared !== load.looksLike
            return (
              <li key={load.id}>
                <div className={`catalogue-row available${i === selected ? ' selected' : ''}`}>
                  <kbd>{i + 1}</kbd>
                  <span className="catalogue-name">
                    <strong>
                      {load.owner} · {load.crates} crates · {label(load.looksLike)}
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
                      {load.goesTo ? `goes: ${SECTION_NAME[load.goesTo].toLowerCase()}` : 'no room!'}
                    </span>
                  </span>
                  <span className="receiving-actions">
                    {(['store', 'inspect', 'refuse'] as const).map((action, n) => (
                      <button key={action} type="button" onClick={() => patch({ pendingReceive: { id: load.id, action } })} disabled={load.opening}>
                        <kbd>{n + 1}</kbd> {action === 'store' ? 'Store' : action === 'inspect' ? 'Open' : 'Refuse'}
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
        <kbd>S</kbd> or scroll to pick a load · <kbd>1</kbd> store · <kbd>2</kbd> open the crates · <kbd>3</kbd> send it back · <kbd>Q</kbd> close
      </p>
    </div>
  )
}
