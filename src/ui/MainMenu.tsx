import { useGameStore } from '../store/gameStore'

export function MainMenu() {
  const setPhase = useGameStore((s) => s.setPhase)

  const start = () => {
    setPhase('playing')
    document.getElementById('game-canvas')?.focus()
  }

  return (
    <div className="menu-overlay">
      <div className="menu-card">
        <p className="eyebrow">The neighbours are watching</p>
        <h1>Which One&apos;s My Key?</h1>
        <p className="lede">
          Jay called. One drink turned into a night you barely remember. You hid the house key
          in a fake rock, took a picture so you would not forget, and passed out. The picture
          is on your phone. It does not help.
        </p>
        <button type="button" className="btn-primary" onClick={start}>
          Start searching
        </button>
        <ul className="control-list">
          <li>
            <kbd>WASD</kbd> move · <kbd>Shift</kbd> sprint · <kbd>C</kbd> crouch · <kbd>Mouse</kbd> look
          </li>
          <li>
            Click the view once, then <kbd>left click</kbd> a rock. <kbd>Right mouse</kbd> flips it. <kbd>F</kbd> tries to open it.
          </li>
          <li>
            Do not hold Control while clicking — on a Mac that turns left-click into a right-click, so pickup never fires.
          </li>
          <li>
            <kbd>I</kbd> pulls up your phone. Gallery has last night&apos;s picture of the rock.
          </li>
          <li>
            Walk up to a neighbour. <kbd>G</kbd> greets them once. <kbd>X</kbd> explains the lost key once.
            Saying either again makes that neighbour much more suspicious. They remember after you leave their sight.
          </li>
        </ul>
        <p className="debug-hint">
          Troubleshoot pickup: add <code>?debug=1</code> to the URL for a step log and orange
          wireframe on held rocks.
        </p>
      </div>
    </div>
  )
}