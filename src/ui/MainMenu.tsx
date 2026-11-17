import { useGameStore } from '../store/gameStore'

export function MainMenu() {
  const patch = useGameStore((s) => s.patch)

  const start = () => {
    patch({ phase: 'playing', newGameRequested: true })
    const canvas = document.getElementById('game-canvas')
    canvas?.focus()
    canvas?.requestPointerLock()?.catch(() => {})
  }

  return (
    <div className="overlay">
      <div className="menu-card">
        <p className="eyebrow">From memory to automation</p>
        <h1>Locker Manager</h1>
        <p className="lede">
          You just opened a tiny bag-storage shop: one counter, six identical lockers, and a board of
          identical keys. No computer, no labels, no notebook. Customers leave their things with you
          and come back later. Remember who left what, where you put it, and which key opens it.
        </p>
        <button type="button" className="btn-primary" onClick={start}>
          Open the shop
        </button>
        <ul className="control-list">
          <li>
            <kbd>WASD</kbd> move · <kbd>Shift</kbd> walk faster · <kbd>Mouse</kbd> look
          </li>
          <li>
            <kbd>E</kbd> or <kbd>Click</kbd> uses whatever is under the crosshair: customers, locker doors,
            keys, the key board.
          </li>
          <li>
            Talking: the next step is pre-selected, so just press <kbd>E</kbd>. Scroll or <kbd>W</kbd>/<kbd>S</kbd> to choose
            something else, <kbd>1</kbd>–<kbd>6</kbd> to jump to an answer, <kbd>Q</kbd> to step away. You stand still while
            talking. <kbd>Esc</kbd> pauses. <kbd>M</kbd> opens the mod menu (free cash, levels and upgrades, so you don't have to grind).
          </li>
        </ul>
      </div>
    </div>
  )
}
