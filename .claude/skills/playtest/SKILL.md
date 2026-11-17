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
Screenshots still work. React may not flush HUD updates in a hidden tab, so before reading the DOM or taking a
screenshot of the HUD, do `__game.advance(0.2); await new Promise(r => setTimeout(r, 300))`.
Editing code triggers a Vite reload that restarts the game, so navigate again before scripting.

Pointer lock usually fails under automation. That's fine: use `__game.face` / `__game.look` to aim, and
`__game.interact()` to press E. Real key presses (`e`, `w`/`s`, `1`–`6`, `q`) via the browser's key action also work; call `__game.advance(0.1)` after each so the engine processes it.

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

__game.skip(25); __game.advance(10)                        // the tutorial wait is 25 s (CONFIG.stages[0].returnAfter), then she is back
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

## 4. Milestone 2: traffic, queue, patience

After the cycle above, the stage is `warmup` (banner "Word is getting around", 3 customers).

```js
const g = __game.sim(), e = __game.engine
const snap = () => g.customers.all().map(c => `${c.name}:${c.state}:${Math.round(c.patience)}`).join(', ')
__game.advance(60); snap()                               // three customers arrive at random, different times
for (let i = 0; i < 3; i++) g.onNextArrival()            // force extra arrivals to build a line
__game.advance(16)
;[...e.agents.agents.values()].map(a => `${g.customers.get(a.id).name}@${a.slot?.kind}${a.slot?.index}`)
```

- 3 at the counter, the rest in `line0`, `line1`, and so on. Freeing a counter spot (serve or `turnAway`) moves `line0` up.
- Screenshot from behind the counter (`__game.teleport(0.5, 0.2); __game.face(-3, 3.6)`): patience bars over heads.
- `__game.advance(200)` with nobody served: customers walk out, toasts read "…got tired of waiting and left.",
  reputation drops 3 each, and the stage advances when the whole stage is done.

## 4a. Skipping the grind: the mod menu

Press `m` (real key press) to open the mod menu, then click buttons or use `__game.sim()` with `applyMod` semantics. In the menu:
**Unlock everything** builds all upgrades and both annexes; **Level 8** / **+$10,000** cover cash and level; **Spawn 5** adds customers;
**Next stage** and **Skip 2 min** move the plan on. `Esc` or `m` closes it. The debug handle's `__game.grant(xp, money)` still works too.

## 4b. Conversation controls

Open a conversation (`__game.interact()` while facing a customer), then use real key presses:
- The first option is highlighted with a "next" tag. `e` ×3 should greet, ask the name, and accept the bag.
- `s` / `w` moves the highlight (skipping greyed-out options). `1`–`6` picks by slot. Slots never shift: done steps
  stay greyed with "Done". `q` steps away.
- While talking, the player must not move (check `__game.engine.player.getPosition()` after holding `w`).
- With the bag in hand, "Step away" is the recommended step (go and store it first).

## 4c. Wrong package, levels and the catalogue

**Wrong package.** Get two customers stored, then take the *other* customer's bag and hand it over repeatedly:

```js
document.querySelector('.btn-primary').click(); await new Promise(r => setTimeout(r, 200)); __game.advance(0.1) // the click restarts the game next frame: grab `g` AFTER this
const g = __game.sim(); g.onNextArrival(); __game.advance(16)       // a second customer, both at the counter
const [a, b] = g.customers.all()
const dep = (c, locker, hook) => { g.talkTo(c.id); g.choose('greet'); g.choose('accept'); g.openLocker(locker); g.putItem(locker); g.closeLocker(locker); g.takeKeyFromLock(locker); g.hangKey(hook); g.talkTo(c.id); g.choose('confirmStored') }
dep(a, 'locker-1', 0); dep(b, 'locker-2', 1); __game.advance(40)    // both are back (tutorial wait is 25 s)
g.takeKeyFromHook(1); g.useKeyOn('locker-2'); g.takeItem('locker-2') // now holding b's bag
// stand at a's spot, open the dialogue (__game.interact()), then real key presses: e (greet), e (name), e (hand over) ×3
```
Expect "Um… this isn't my package", then escalating lines, toasts "Wrong again (2)… getting angry" / "(3)… furious!",
reputation 50 → 42, a 🤬 face above the customer, and the dialogue staying open for retries.

**Levels and the catalogue.**
```js
__game.grant(300, 500)                                    // debug: XP and cash
__game.teleport(4.6, -0.5); __game.face(4.75, -1.9); __game.look(0, -0.55); __game.advance(0.2)
__game.interact()                                         // opens the catalogue (the desk is at the back-right of the staff area)
```
Then real keys: `e` buys the highlighted item, `s` moves down, `q` closes. Check `g.lockers.total` / `g.keys.hookCount`, the cash drop, and
screenshot the storage room (`__game.teleport(0, -4.6); __game.face(-1.2, -9)`) for the new bank and the partition
(`__game.teleport(-3.6, -0.6); __game.face(-3.6, -2.4)`) for the new rack. `g.gainXp(20)` shows the "Level up" banner.
`__game.engine.newGame()` must leave one bank, one rack and `interactionTargets.length === 4`.

## 4d. Locking up, labels and the register board

**Locking up (bug fix).** With a customer at the counter: `greet`, `accept`, `openLocker('locker-3')`, `putItem('locker-3')`, then open the
dialogue (`__game.interact()`). "Tell them it is stored" must be greyed with "Close the locker door first."; after
`closeLocker` it says "Take the key out of the lock to lock it."; pressing `3` must toast the reason and leave the customer
`depositing`. It only works after `takeKeyFromLock`.

**Labels and the board.** `__game.grant(100, 400)`, open the catalogue at the desk, `e` buys the highlighted row (labels, then `s` `e` for the board).
- Lockers: `__game.teleport(0, -4.6); __game.face(0, -9)`: numbers 1–6 on the doors (bottom row 1–3, top row 4–6).
- Keys: store a bag, then `__game.teleport(-1.6, -0.6); __game.face(-2, -2.4)`: the hanging key has a yellow tag with its locker's number.
- Board (storage room, on the partition): `__game.teleport(3.4, -5.6); __game.face(3.4, -2.5); __game.look(0, 0.05)`: "DEPOSIT REGISTER" with `number | name | item` rows. A bag taken without asking the name (skip `askName`) shows "name not taken".
  For a crowded board buy everything, call `g.onNextArrival()` 12 times, `__game.advance(30)`, and store them all (two columns).

## 4e. Building expansion (the east annex)

```js
const g = __game.sim(); __game.grant(1200, 4000); ['bank2', 'bank3', 'annexEast'].forEach(id => g.buyUpgrade(id)); __game.advance(2.5)
__game.teleport(3, -3.6); __game.face(8, -3.6); __game.walk(1, 0, 2.5)   // walks through the new doorway: ends at x ≈ +11.5
```
Before buying, the same walk stops at x = +5.6 (the wall). Screenshot the doorway from the storage room (`__game.teleport(1.8, -4.4); __game.face(6.2, -3.6)`:
door frame, "STORAGE ANNEX · EAST" sign) and the hall (`__game.teleport(11.5, -5.2); __game.face(11.5, -9)`: two locker banks). There is no west annex any more
(the conveyor took its unit). Totals after bank B, C and the east annex: 30 lockers. `__game.engine.newGame()` must wall the doorway up again (walk stops at +5.6).

## 4f. South expansion and floors

Use the mod menu (M → "Unlock everything", or unlock one at a time) or `__game.grant(2800, 100000)` and buy `bank2, bank3, annexEast, southExpansion, floor1, floor2` (floor 1 has three rows).
- Doorway: stand in the storage room at about (−2.15, −7) facing the back wall: a 1.4 m opening between the first two locker banks, "SOUTH EXPANSION" sign above.
- South hall: two rows of lockers facing the doorway, an aisle between them, five key racks on the old back wall, "SOUTH EXPANSION" on the far wall.
- Stairs: walk to (5.25, −16.3) in the south hall and walk north (+z): a smooth climb to floor 1, step straight off onto the landing. On floor 1 go to
  (5.25, −20.5) and walk north up flight 2 to floor 2. Space jumps. From floor 2 look down the stairwell: no gap in floor 1. Check for falling through gaps, the guard wall, and the rail round the stairwell.
- Automation: `g=__game.sim(); g.grantUpgrade('conveyor')` (pulls in labels, register and digital), then spawn a customer, `g.customerReachedCounter(id)`, `g.talkTo(id)`,
  `g.choose('greet')`, `g.choose('accept')`, stand at (−5.05, −0.2) facing the LOAD belt (−5.05, −1.5) and `__game.interact()`. To watch the arm mid-move step the sim in
  small slices (`for (...) g.update(0.05)`) then `__game.advance(0.1)` a few times; a single large `update` skips the whole job. The terminal is at (−3.05, −1.2).
- Levels: `g.grantUpgrade('arms-floor2')` pulls in everything below it (hall, belts, speed 1). Consoles: hub at (−2.35, −1.2), storage room (−3.35, −6.1), East annex (11.5, −5.8), halls (3.55, −10.2) at their floor height. Open one with `g.openConsole('east')` or aim and `__game.interact()`; press real keys one at a time with an `__game.advance(0.3)` between them (two keys in one frame lose the second). Fill the storage room (`l.state='unavailable'`) to send bags to a hall.
- `__game.walk(forward, right, seconds)` walks relative to the camera; `__game.teleport(x, z)` keeps the current height.
- Only the current zone and its neighbours are drawn: from floor 2 the ground floor should be hidden, and from the main room floor 1 and 2 hidden.
- The deposit register shows "page 1/2" when more than 42 bags are stored.

## 5. Spot checks

- **Wrong key:** lock a second empty locker (close it and take its key), hang it, then try it on the occupied
  locker. You should see the red toast "That key doesn't fit" and a short fumble (`g().busyUntil`).
- **Dialogue rules:** "Accept" is disabled until greeted. "Tell them it is stored" is disabled until the item is in a locker.
- **Walking away** more than about 3.8 m from the customer closes the dialogue.
- **Pause:** the `Esc` key stops `g().now`.

## 6. Report

Say which steps you ran, and include screenshots of what changed. Name anything you couldn't verify
(for example real mouse-look feel).
