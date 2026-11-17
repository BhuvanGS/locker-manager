# AGENTS.md

Guide for AI coding agents (and people) working on **Locker Manager**, a first-person 3D management
game about running a bag-storage shop that grows from manual memory to full automation.

- Player docs: [README.md](README.md)
- The spec: [docs/design-brief.md](docs/design-brief.md). Read the relevant sections before building a feature.
- Where we are: [docs/ROADMAP.md](docs/ROADMAP.md). Work milestone by milestone, and tick boxes as you finish.

## Commands

```bash
npm install
npm run dev          # http://localhost:5173 (.claude/launch.json → preview "dev")
npm test             # vitest: simulation unit tests
npm run typecheck    # tsc -b (strict, noUnusedLocals/Parameters)
npm run lint         # oxlint
npm run build        # typecheck + vite build
```

A change is done when `npm run typecheck && npm run lint && npm test` pass, and any change you can see or
play has been play-tested (`playtest` skill).

## Architecture

The core rule: **the simulation is the source of truth and knows nothing about rendering.**

```
src/sim (pure TS)  ◀── actions ──  src/world/InteractionManager  ◀── crosshair + E
   │  GameManager owns: SimulationClock, CustomerScheduler, CustomerFactory,
   │                    CustomerManager (customers + items), LockerManager, KeyManager, EconomyManager
   │
   ├──▶ src/world views read sim state every frame (LockerWall, KeyBoard, CustomerAgents, HeldView)
   ├──▶ SimNotices (drained each frame) → spawn/leave agents, toasts (later: audio)
   └──▶ engine/Engine.syncHud() → store/gameStore → React HUD (ui/)
```

Frame order (`Engine.tick`): input → player and physics → `game.update(dt)` (only while `playing`) →
notices → views → interaction raycast and action → dialogue keys → HUD sync.

### Simulation (`src/sim`)

| Module | Owns |
| --- | --- |
| `GameManager` | The facade. Player actions (`talkTo`, `choose`, `openLocker`, `putItem`, `takeItem`, `takeKeyFromLock`, `useKeyOn`, `hangKey`, `takeKeyFromHook`), `hands`, `dialogue`, `objective()`, notices |
| `SimulationClock` | Game time and a min-heap event queue (`customerArrive`, `customerReturn`) |
| `CustomerScheduler` | When customers arrive and how long until they return, from `CONFIG.stages` |
| `CustomerFactory` | Seeded names, appearances, personalities, items. `tutorialCustomer()` is fixed |
| `CustomerManager` | Customer and item records, plus the **state machine** (`TRANSITIONS` table; illegal transitions throw) |
| `LockerManager` | Lockers: `state`, `doorOpen`, `locked`, `itemId`, `keyId`. `findAvailable()` |
| `KeyManager` | Keys: each belongs to one locker and is in exactly one place (`inLock`, `hook n`, `player`) |
| `EconomyManager` | Money, XP and levels, reputation, served, mistakes |
| `config.ts` | Every tunable number, including customer stages |
| `types.ts` | All record types |

Rules:
- **Actions validate and return `ActionResult`** (`{ ok, message }`). They never throw for player mistakes.
  The managers *do* throw on impossible states. That means a bug, so fix the caller.
- **Data stays consistent:** item status, `item.lockerId`, `customer.lockerId`, `locker.itemId` and the key
  location change together inside one action. Add a test when you add an action.
- **No hardcoded per-customer timers.** Arrival and return timing comes from `CONFIG.stages` through the scheduler
  and clock.
- **The objective is derived from state** (`GameManager.objective()`), never stored, so it can't drift.
- Seeded randomness only (`mulberry32` from `lib/random.ts`, seed from `?seed=`). Ids come from the factory instance.

### 3D world (`src/world`)

- `layout.ts` has the floor plan (metres, y up, street at +z). Read its diagram first.
  Lobby `z 1.6…6`, counter at `z≈1.2`, staff area, partition at `z=-2.4` (key board at `x=-2.6`), storage
  room down to `z=-9` with the locker wall on the back wall.
- `Facility` is the static building. `solid()` = rendered + Rapier collider + reach blocker. `deco()` = visual only.
- `LockerWall` and `KeyBoard` build their meshes from sim records once, then `update()` mirrors state (door
  angle, key in lock, item inside, keys on hooks).
- `CustomerAgents` gives one agent per customer *in the building*. It walks `CUSTOMER_PATH` and calls
  `game.customerReachedCounter()` / `game.customerExited()`. Stored customers have no agent (scales to
  thousands of records).
- `InteractionManager` raycasts from the screen centre against tagged objects (`interactables.ts`:
  `tag()` / `markBlocker()`). `describe()` gives the prompt and `perform()` calls the sim. Invisible proxy meshes
  (`MeshBasicMaterial({ visible: false })`) make small things like keys and hooks easy to aim at.
- `models.ts` has procedural meshes (items, keys, people) with cached materials. Swap them for GLB later behind
  the same functions.

### UI (`src/ui`, `src/store`)

- React only reads the store. The Engine `patch()`es it every frame with primitives, or objects that keep their
  identity while unchanged (the dialogue view is cached by signature). Components must select fields with
  `useShallow` or single selectors, never `useGameStore()` with no selector.
- UI → game requests go through store fields the Engine consumes (`pendingChoice`, `newGameRequested`).
- Stage 1 shows only what Stage 1 has. Don't show databases, labels or upgrade UI before they're unlocked (brief §13).

## Conventions and gotchas

- No React StrictMode: a double-mounted effect would create two engines and two WebGL contexts.
- `FirstPersonCamera.lookToward(x, z, fromX, fromZ)` faces a point (the camera looks down −z).
- Pointer lock can be refused (automation, iframes), so everything must still work from the keyboard.
- Browsers pause `requestAnimationFrame` in hidden tabs. Use `__game.advance(seconds)` in tests.
- Keep `CONFIG.stages[0]` as one customer returning after exactly 120 s. That's the brief's Milestone 1 contract,
  and it's tested.

## Debug handle (`?debug=1`)

```js
__game.sim()              // the live GameManager (new object after "Open the shop")
__game.advance(s)         // run real engine frames for s seconds (works in hidden tabs)
__game.skip(s)            // fast-forward sim time only
__game.teleport(x, z)     // move the player
__game.face(x, z)         // look at a point; __game.look(dYaw, dPitch) turns relative
__game.interact()         // press E on whatever is under the crosshair → { aim, result }
```

## Skills (`.claude/skills/`)

- `playtest`: run the game and verify a change in the browser, including a scripted full customer cycle.
- `sim-systems`: add or change simulation rules, customer stages, actions, states and upgrades, with tests.
- `facility-building`: add rooms, lockers, props and expansion to the 3D facility without breaking reach,
  collision or customer paths.

The previous game in this repo ("Which One's My Key?") is at git tag `which-ones-my-key`.
