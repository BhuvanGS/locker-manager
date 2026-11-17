# AGENTS.md

Guide for AI coding agents (and people) working on **Which One's My Key?**, a first-person Three.js
game where you search a gravel lawn for the fake rock holding your house key while neighbours watch.
Player-facing docs are in [README.md](README.md).

## Commands

```bash
npm install          # once
npm run dev          # http://localhost:5173 (also used by .claude/launch.json → preview "dev")
npm run typecheck    # tsc -b, strict, noUnusedLocals: unused vars fail the check
npm run lint         # oxlint
npm run build        # typecheck + vite build
```

Before you call a change done, run `npm run typecheck && npm run lint`. If it touches anything visible,
play-test it in the browser (see the `playtest` skill).

## Stack

- **three** 0.187: rendering. Everything is procedural (boxes, extrusions, canvas textures); there are no model files.
- **@dimforge/rapier3d-compat**: physics. WASM init is async (`PhysicsWorld.init()`), so `Engine.init()` must be awaited before `start()`.
- **React 19**: only for the HUD and menus. React never touches the Three.js scene.
- **zustand**: the one bridge between the engine and React.
- **Vite 8**, **TypeScript 7** (`tsc -b`), **oxlint**.

## Architecture

```
ui/GameCanvas.tsx ──creates──▶ engine/Engine.ts ──owns──▶ PhysicsWorld, InputManager, FirstPersonCamera
                                     │                    PlayerController, GravelInteraction
                                     ▼
                              world/Neighbourhood.ts ──owns──▶ sky.ts, GravelField, NeighbourDirector
                                     │
            each frame: Engine.tick() writes results into store/gameStore.ts
                                     ▼
                     ui/GameHUD.tsx and other React components read the store with selectors
```

The frame order in `Engine.tick()` is: input → camera look → `player.update` → `physics.step` → sync player →
`world.update` (clouds) → `gravel.update` (aim, pick, inspect) → key/door logic → `world.updateNeighbours`
(NPCs and police) → store setters → debug panel.

Game phases are `menu | playing | paused | won | caught` (`store/gameStore.ts`). `App.tsx` picks which
screen to show for each. The engine only ticks gameplay while the phase is `playing`. Going from `menu` to `playing`
resets the neighbours and police.

### Modules

| Path | Responsibility |
| --- | --- |
| `engine/Engine.ts` | Renderer, scene, main loop, wiring between systems, writing to the store |
| `engine/InputManager.ts` | Keyboard/mouse state and one-shot presses (`greetPressed`, `explainPressed`, …) |
| `engine/PhysicsWorld.ts` | Rapier world; `addStaticBox(center, halfExtents)` for static colliders |
| `engine/debug.ts` | `?debug=1` detection, step log, debug snapshot |
| `world/Neighbourhood.ts` | Builds the street, houses, props, trees and hills; location labels; door; owns the NPC director |
| `world/sky.ts` | Sky dome shader, visible sun, clouds, sun and hemisphere lights (`SUN_DIR`) |
| `gravel/GravelField.ts` | 5,200 instanced stones, fake rock (`fakeStoneId`, pink) |
| `gravel/GravelInteraction.ts` | Crosshair aiming (raycast, then a small screen-space tolerance), aim ring, holding, flipping, opening |
| `gravel/stone.ts`, `openStone.ts` | `StoneRecord`, HUD text for a stone, open/flip rules |
| `npcs/NeighbourDirector.ts` | Neighbour routines, suspicion memory, conversations, police state machine |
| `npcs/types.ts` | `DialogueView`, `CopState`, `PlayerReport`, `NeighbourObservation`, `Occluder` |
| `npcs/HeadBubble.ts` | One-line, depth-tested speech bubble sprite above a head |
| `npcs/models.ts` | Procedural meshes for residents, officer and cruiser |
| `npcs/occlusion.ts` | Segment-vs-box test used for line of sight |
| `player/` | Kinematic character controller (walk 4.2, sprint 6.2, crouch 2.1 m/s), first-person camera |
| `ui/` | HUD (crosshair, dialogue box, police chip, inspect card), menus, phone, results |

## World coordinates (metres, y up)

- Player house: centre `(0, -6)`, 11 × 8, faces **+z**. The door is at about `(0, 1.45, -2.35)` (`Neighbourhood.door`).
- Gravel lawn: centre `(0, 4)`, 17 × 13. The player spawns at `(0, 5)`.
- Player lot (used by the police "stay on the property" rule): `|x| < 9.5`, `-11 < z < 13.5`. Side fences at `x = ±9`.
- Near sidewalk around `z = 11.5`. Road along x at `z = 18`, 7 m wide. Far sidewalk around `z = 22.6`.
- Across the street: houses face **−z** at `z ≈ 27` (first row) and `z ≈ 38` (second row). Our row: `z = -4` at `x = ±21, ±36`.
- Residents' home, mail and garden points are in the `NeighbourDirector` constructor. Keep them on walkable,
  unoccupied ground if you move houses.

## Conventions and gotchas

- **Seeded randomness for anything in the world layout.** Use `mulberry32` from `lib/random.ts`
  (seed from `?seed=`). `Math.random` is only acceptable for NPC timing jitter.
- **Anything that should block an NPC's view must be an `Occluder`.** In `Neighbourhood`, `buildHouse()` adds one
  automatically. Fences push theirs by hand. Things that should block the player also need
  `physics.addStaticBox`.
- **Share materials** through `Neighbourhood.mat(key, params)`. `dispose()` deduplicates materials and textures.
- **Store writes happen every frame.** Only write primitives, or objects that keep the same reference
  while unchanged. Otherwise the whole HUD re-renders 60×/s. `NeighbourDirector.observe()` caches the
  `DialogueView` by a JSON signature for exactly this reason.
- **No React StrictMode** (`main.tsx`): a double-mounted effect would build two engines and two WebGL contexts.
- **The HUD is `pointer-events: none`**, and the crosshair is a fixed DOM element at screen centre. Picking always
  aims from the camera centre (`ndcCenter`), so the two line up.
- Dialogue: the HUD box shows the active conversation (resident or officer). Head bubbles show only
  the latest line of anyone else, and hide while that person is in the HUD box.
- Police flow (`CopState`): `driving → approaching → questioning → waiting → arresting`. `chasing` starts
  if you walk away while being questioned or leave the lot while waiting. `busted` turns true `ARREST_DELAY`
  seconds after the arrest line, so the player can read it. `Engine` then sets the phase to `caught` and stores `caughtReason`.
- Camera far plane is 600, and fog runs from 60 to 300. The sky dome (r = 480) follows the camera. Keep big scenery inside 450.
- `tsconfig` has `noUnusedLocals` and `noUnusedParameters`, so delete dead code instead of leaving it.

## Testing in the browser

There is no automated test suite. Verify by playing. Pointer lock is usually unavailable in automated browsers, so
use the debug handle (only exists with `?debug=1`):

```js
__game.teleport(x, z)          // move the player
__game.look(yawRad, pitchRad)  // turn the camera relative to now (positive pitch looks up)
__game.engine                  // Engine internals: .world, .player, .gravelInteract, ...
__game.engine.world.neighbours // NeighbourDirector (callCops(resident), copState, copLines, ...)
```

See `.claude/skills/playtest/SKILL.md` for step-by-step recipes.

## Skills

Project skills in `.claude/skills/`:

- `playtest`: run the game and check a change in the browser.
- `world-building`: add or move houses, props, trees and scenery, and keep collision and line of sight right.
- `npc-dialogue`: add or change neighbour lines, suspicion rules, or the police state machine.
