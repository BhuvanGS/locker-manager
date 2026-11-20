import type { ModInfo, ModRequest } from '../sim/mods'
import { useGameStore } from '../store/gameStore'

/**
 * The mod menu: cheats so testing and tinkering does not mean grinding. Open it with M (or `), close it with M or Esc.
 * It opens with the mouse free and, by default, freezes the shop while you click around. Switch it off for a
 * release with `CONFIG.modMenu.enabled = false`.
 */
export function ModMenu({ info }: { info: ModInfo }) {
  const request = useGameStore((s) => s.requestMod)
  const patch = useGameStore((s) => s.patch)
  const pause = useGameStore((s) => s.modPause)

  const button = (label: string, req: ModRequest, title?: string) => (
    <button type="button" className="mod-btn" title={title} onClick={() => request(req)}>
      {label}
    </button>
  )
  const owned = info.upgrades.filter((u) => u.owned).length

  return (
    <aside className="modmenu" aria-label="Mod menu">
      <header className="modmenu-head">
        <div>
          <p className="modmenu-title">Mod menu</p>
          <p className="modmenu-sub">
            ${info.money} · level {info.level} · {info.stageTitle}
          </p>
        </div>
        <button type="button" className="mod-close" onClick={() => patch({ modOpen: false })} aria-label="Close">
          ✕ <kbd>M</kbd>
        </button>
      </header>

      <section>
        <h3>Cash</h3>
        <div className="mod-row">
          {button('+$100', { type: 'money', amount: 100 })}
          {button('+$1,000', { type: 'money', amount: 1000 })}
          {button('+$10,000', { type: 'money', amount: 10000 })}
        </div>
      </section>

      <section>
        <h3>Level</h3>
        <div className="mod-row">
          {button('Level +1', { type: 'level', level: info.level + 1 })}
          {button('+100 XP', { type: 'xp', amount: 100 })}
          {button('Level 4', { type: 'level', level: 4 }, 'Unlocks the first annex')}
          {button('Level 8', { type: 'level', level: 8 })}
        </div>
      </section>

      <section>
        <h3>
          Upgrades <span className="mod-count">{owned}/{info.upgrades.length}</span>
        </h3>
        <ul className="mod-upgrades">
          {info.upgrades.map((u) => (
            <li key={u.id}>
              <span>{u.title}</span>
              {u.owned ? (
                <em>Owned ✓</em>
              ) : (
                <button type="button" className="mod-btn small" onClick={() => request({ type: 'unlock', id: u.id })}>
                  Unlock
                </button>
              )}
            </li>
          ))}
        </ul>
        {button('Unlock everything', { type: 'unlockAll' }, 'Free, including the annexes (builds the new rooms)')}
      </section>

      <section>
        <h3>
          Customers <span className="mod-count">{info.inside} inside · {info.stored} stored</span>
        </h3>
        <div className="mod-row">
          {button('Spawn 1', { type: 'spawn', count: 1 })}
          {button('Spawn 5', { type: 'spawn', count: 5 })}
          {button('Next stage', { type: 'nextStage' }, 'Jump to the next traffic stage')}
          {button('Bring stored back', { type: 'returnAll' }, 'Every stored customer returns in a second')}
        </div>
        <div className="mod-row">
          {button('Skip 30 s', { type: 'skip', seconds: 30 })}
          {button('Skip 2 min', { type: 'skip', seconds: 120 })}
          {button('Meteor', { type: 'meteor' }, 'Start the meteor countdown, or (if it is counting down) make it strike in 15 s')}
        </div>
      </section>

      <section>
        <h3>Options</h3>
        <label className="mod-check">
          <input
            type="checkbox"
            checked={info.patienceOff}
            onChange={(e) => request({ type: 'patience', on: e.target.checked })}
          />
          Customers never lose patience
        </label>
        <label className="mod-check">
          <input type="checkbox" checked={pause} onChange={(e) => patch({ modPause: e.target.checked })} />
          Freeze the shop while this menu is open
        </label>
      </section>

      <footer className="modmenu-foot">
        <button type="button" className="mod-btn danger" onClick={() => patch({ newGameRequested: true, modOpen: false })}>
          New game
        </button>
      </footer>
    </aside>
  )
}
