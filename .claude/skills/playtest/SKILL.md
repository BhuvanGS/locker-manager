---
name: playtest
description: Run Which One's My Key? in the browser and check a change works in the real game — world visuals, crosshair/rock picking, neighbour dialogue, the police flow, win/arrest screens. Use after any change to src/ that is visible or affects gameplay.
---

# Play-test the game

Type-checking proves the code compiles. This skill checks the game actually plays.

## 1. Static checks first

```bash
npm run typecheck && npm run lint
```

Fix any errors before you open the browser. Unused variables fail the type-check.

## 2. Start the game

- Use the preview server named `dev` from `.claude/launch.json` (`npm run dev`, port 5173). Reuse it if it's already running.
- Open `http://localhost:5173/?debug=1&seed=42`.
  - `seed=42` gives a repeatable stone layout, fake-rock position and tree placement.
  - `debug=1` shows the debug panel and exposes `window.__game`.
- Click **Start searching**. The phase changes to `playing`.

If a screenshot looks stale or the page is blank, reload. The page may have opened before Vite was ready.

## 3. Drive the game without a mouse

Pointer lock usually fails in automated browsers, so mouse-look doesn't work. Use the debug handle:

```js
__game.teleport(0, 5)            // back to the gravel lawn spawn
__game.look(0, -0.6)             // look down at the gravel (radians; +pitch is up, +yaw turns left)
__game.engine.player.getPosition()
__game.engine.gravelInteract     // aiming/holding state (lastAimedId, heldRecord, ...)
__game.engine.world.gravel.fakeStoneId
__game.engine.world.neighbours   // NPC director
```

Keyboard input works without pointer lock (key events go to `window`): `w a s d`, `c`, `g`, `x`, `f`, `i`, `Escape`.

## 4. Recipes

**Crosshair and rock aiming**
- `__game.teleport(0, 5); __game.look(0, -0.7)`, then take a screenshot. The crosshair should turn yellow, a yellow
  ring should sit on the aimed pebble, and the inspect card should say "Aimed at — … stone".
- Looking at the horizon (`__game.look(0, 0.7)`) should show a plain white dot and no aimed rock.

**Neighbour conversation**
- `__game.engine.world.neighbours.residents.map(r => [r.name, r.mesh.position.toArray()])`
- Teleport about 3 m in front of one (for example `__game.teleport(-16, 20)` for Mrs. Hale at home), then press `g`.
- Expect: the HUD dialogue box with the speaker's name, the "You" line in yellow, their reply, and option chips for `G`/`X`.
  Walking more than 8.5 m away closes it.

**Police flow**
```js
const d = __game.engine.world.neighbours
__game.teleport(0, 5)
d.callCops(d.residents[0])
```
- The cruiser drives in (about 4 s), and the officer walks over and asks "Is this your house?". The HUD shows a blue Officer box.
- Press `x`: the chip shows a 60-second countdown. Press `g` twice instead: the officer arrests you.
- Leave the lot (`__game.teleport(15, 5)`): `d.copState === 'chasing'`, then an arrest, then the results screen
  shows the reason (read it with get_page_text).
- Check with `[d.copState, d.copLines, d.bustReason]`.

**Win path**
```js
const gi = __game.engine.gravelInteract, f = __game.engine.world.gravel
f.stones[f.fakeStoneId].position   // where the pink rock is
```
Teleport next to it and aim down. Picking up, flipping and opening need mouse buttons. If you can't click, say so
instead of claiming the win path works.

## 5. Report honestly

Say which recipes you ran, and include a screenshot of the main thing you changed. Name anything you couldn't
check, such as real mouse-look or pointer-lock-only behaviour.
