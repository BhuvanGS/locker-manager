---
name: playtest
description: Run Locker Manager in the browser and verify a change in the real game — facility visuals, crosshair interactions, customer conversations, the deposit/return cycle, lockers, keys, HUD. Use after any change under src/ that is visible or affects gameplay.
---

# Play-test Locker Manager

## 1. Static checks

```bash
npm run typecheck && npm run lint && npm test
```

## 2. Launch

- Use the `dev` preview from `.claude/launch.json` (port 5173), reusing it if it's already running.
- Open `http://localhost:5173/?debug=1&seed=7`. The seed makes customers and items repeatable. Debug exposes `window.__game`.
- Start a game from JS: `document.querySelector('.btn-primary').click()`.

**The browser pane is often hidden, and hidden tabs pause `requestAnimationFrame`.** Don't wait with
timeouts. Drive time with `__game.advance(seconds)`, which runs real engine frames synchronously.
Screenshots still work.

Pointer lock usually fails under automation. That's fine: use `__game.face` / `__game.look` to aim, and
`__game.interact()` to press E. Real key presses (`1`–`6`, `e`) via the browser's key action also work.

## 3. Full Milestone 1 cycle (the regression script)

The positions below assume the default layout (`src/world/layout.ts`). Locker-6 is the top-right locker.

```js
document.querySelector('.btn-primary').click()
await new Promise(r => setTimeout(r, 100))
const g = () => __game.sim()
const log = []
const step = (label) => { const r = __game.interact(); __game.advance(0.5); log.push([label, r.aim?.action ?? r.aim?.hint ?? null, r.result?.message ?? null]) }

__game.advance(15)                                         // Maya walks in (arrives at t≈4 s, walks ≈8 s)
__game.teleport(0, 0.3); __game.advance(0.3); __game.face(0, 2.05); __game.advance(0.05); step('talk')
g().choose('greet'); g().choose('askName'); g().choose('accept'); g().closeDialogue()

__game.teleport(0.95, -7.2); __game.advance(0.3); __game.face(0.95, -9); __game.look(0, -0.12); __game.advance(0.05)
step('open door'); step('store item')
__game.face(0.38, -7.94); __game.advance(0.05); step('close door')        // the open door swings to the left
__game.face(1.31, -8.4); __game.look(0, 0); __game.advance(0.05); step('take key')

__game.teleport(-2.6, -1.3); __game.advance(0.3); __game.face(-2.44, -2.4); __game.look(0, -0.05); __game.advance(0.05); step('hang key')
__game.teleport(0, 0.3); __game.advance(0.3); __game.face(0, 2.05); __game.advance(0.05); step('talk')
g().choose('confirmStored'); __game.advance(12)            // she walks out

__game.skip(120); __game.advance(10)                       // exactly 2 minutes later she is back at the counter
__game.teleport(-2.6, -1.3); __game.advance(0.3); __game.face(-2.44, -2.4); __game.look(0, -0.05); __game.advance(0.05); step('take key')
__game.teleport(0.95, -7.2); __game.advance(0.3); __game.face(0.95, -9); __game.look(0, -0.12); __game.advance(0.05)
step('unlock'); step('take item')
__game.teleport(0, 0.3); __game.advance(0.3); __game.face(0, 2.05); __game.advance(0.05); step('talk')
g().choose('handOver'); __game.advance(12)
log.push(['done', g().tutorialComplete, g().economy.money, g().objective()])
JSON.stringify(log, null, 1)
```

Expected: every step has an action and an ok message. At the end, `tutorialComplete === true`, cash has gone
up from $50, and the HUD shows the "Milestone 1 complete" card. Take a screenshot at the key moments
(dialogue panel, open locker, key board, completion card).

## 4. Spot checks

- **Wrong key:** lock a second empty locker (close it and take its key), hang it, then try it on the occupied
  locker. You should see the red toast "That key doesn't fit" and a short fumble (`g().busyUntil`).
- **Dialogue rules:** "Accept" is disabled until greeted. "Tell them it is stored" is disabled until the item is in a locker.
- **Walking away** more than about 3.8 m from the customer closes the dialogue.
- **Pause:** the `Esc` key stops `g().now`.

## 5. Report

Say which steps you ran, and include screenshots of what changed. Name anything you couldn't verify
(for example real mouse-look feel).
