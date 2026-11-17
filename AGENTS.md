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
   │                    CustomerManager (customers + items), LockerManager, KeyManager, EconomyManager, UpgradeManager
   │
   ├──▶ src/world views read sim state every frame (LockerWall per bank, KeyRack per rack, CustomerAgents, HeldView)
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
| `CustomerScheduler` | Traffic stages (`CONFIG.stages`): when new customers arrive, return delays, and advancing to the next stage once everyone in the current one has finished |
| `CustomerFactory` | Seeded names, appearances, personalities, items. `tutorialCustomer()` is fixed |
| `CustomerManager` | Customer and item records, plus the **state machine** (`TRANSITIONS` table; illegal transitions throw) |
| `LockerManager` | Lockers in banks (`bank`, `row`, `col`): `state`, `doorOpen`, `locked`, `itemId`, `keyId`. `addBank()` for storage upgrades. `findAvailable()` |
| `KeyManager` | Keys: each belongs to one locker and is in exactly one place (`inLock`, `hook n`, `player`). `hookCount` grows with key racks (`addHooks`, `addKey`) |
| `EconomyManager` | Money, XP and levels, reputation, served, mistakes |
| `UpgradeManager` | Catalogue definitions (`CONFIG.upgrades`), what is owned, and whether something can be bought (`state()` → owned / available / tooExpensive / locked with a reason). `GameManager.buyUpgrade` applies the effect |
| `config.ts` | Every tunable number, including customer stages |
| `types.ts` | All record types |

Rules:
- **Actions validate and return `ActionResult`** (`{ ok, message }`). They never throw for player mistakes.
  The managers *do* throw on impossible states. That means a bug, so fix the caller.
- **Data stays consistent:** item status, `item.lockerId`, `customer.lockerId`, `locker.itemId` and the key
  location change together inside one action. Add a test when you add an action.
- **No hardcoded per-customer timers.** Arrival and return timing comes from `CONFIG.stages` through the scheduler
  and clock (`nextArrival` / `customerReturn` events). A stage's `maxActive` caps customers with business here.
- **Anti-boredom** (`GameManager.updateIdleGuard`): a stage's `maxIdle` pulls the earliest pending event forward when nobody has
  been inside for that long. Arrival gaps mix ordinary random gaps with quick bursts (`burstChance`, `burstGap`). Tests can pass their
  own stages: `new GameManager(seed, stages)`.
- **Return order** (`CustomerScheduler.returnDelay(now, pending)`): each customer's return time comes from the stage window, and
  `CONFIG.returns.overtakeChance` of the time it is set to land just before someone already stored, so people do not come back
  first-in-first-out. It always stays inside the window; the tutorial window is a single fixed value.
- **Wrong package** (`GameManager.wrongPackage`): per-visit `customer.visit.wrongAttempts` drives the escalating script, the
  penalties in `CONFIG.wrongItem`, a half-fee when furious, and the mood face above the customer (`CustomerAgents.updateMood`).
- **Locking up** (`GameManager.storedBlocker`): "Tell them it is stored" needs the bag in a locker whose door is shut and whose key is
  out of the lock (that is what locks it). Do not weaken this: it is what makes the key something to remember.
- **Labels** (`game.hasLabels`): numbers on locker doors (`LockerWall.addLabels`), tags on keys (`setKeyLabel` in `models.ts`, driven
  by `KeyRack.update`, the lock view and `HeldView`), and numbers in prompts (`InteractionManager.describe`). The views read
  `game.hasLabels` each frame, so no event is needed. Locker `n` always has key `key-n`.
- **Register board** (`game.registerEntries()`, `world/RegisterBoard.ts`): every bag in a locker, oldest first; the board redraws a canvas
  texture only when the entries change (1, 2 or 3 columns for up to 42). It hangs in the storage room, on the partition, facing the lockers.
  It needs the labels first (`requires`), and the Engine builds it on `upgradeBought`. **Names**: an entry has `name: null` unless
  `customer.nameTaken`, which `askName` sets only on the deposit visit.
- **Building expansion / annexes** (`kind: 'annex'` in `CONFIG.upgrades`, `world/Annex.ts`): buying one adds 2 banks and 2 racks in the sim
  (`GameManager.buyUpgrade`) and emits `upgradeBought` with `side`, `banks[]`, `racks[]`. The Engine then calls `facility.setAnnexOpen(side, true)`
  (removes the doorway's wall panel and collider, hides the neighbour's back half, adds a door frame), builds an `Annex` (the hall) and fits
  `LockerWall`s at `ANNEX[side].bankX` and `KeyRack`s at `ANNEX[side].rackX` (hall front wall, `ANNEX_RACK`). A new game undoes all of it
  (`removeBuiltFurniture`). Positions live in `world/layout.ts` (`ANNEX_DOOR`, `ANNEX`, `LOCKER_BANKS`, `KEY_RACKS`).
- **Mod menu** (`sim/mods.ts`, `ui/ModMenu.tsx`): M / ` toggles it (Engine tick), it releases the mouse, and Esc closes it instead of pausing.
  The buttons push `ModRequest`s onto `store.modRequests`; the Engine runs each through `applyMod(game, request)` (pure and tested in
  `Mods.test.ts`) and toasts the result. Everything goes through normal `GameManager` code (`grantXp`, `grantUpgrade` which shares
  `applyUpgrade` with `buyUpgrade`, `spawnExtraCustomer`, `skipStage`, `callBackStoredCustomers`, `mods.noPatienceLoss`), so level-ups,
  banners and the 3D furniture behave exactly as in normal play. Mod-spawned customers are not part of the stage plan. A new mod action
  = a `ModRequest` variant, a case in `applyMod`, a button, and a test. `CONFIG.modMenu.enabled = false` removes it.
- **South expansion and floors** (`kind: 'hall'` in `CONFIG.upgrades`, `world/Hall.ts`, `world/Stairs.ts`): the south hall is behind the storage
  room's back wall (doorway `SOUTH.door`, cut by `Facility.setSouthOpen`), with lockers in rows (`SOUTH.rowFrontZ`, `SOUTH.bankX`) and key racks along
  the old back wall (`SOUTH.rackX`). Floors 1 and 2 are the same `Hall` at `level × FLOOR_HEIGHT`; a hall's ceiling slab is the floor above and has a
  stairwell hole closed by a hatch (`Hall.openHatch`) until the next floor is bought, when the Engine adds `Stairs` (14 steps of 0.25 m, guard wall,
  rail on the floor above). `LockerWall` takes a `BankPlacement` (`centerX`, `frontZ`, `floorY`) and `KeyRack` an optional `y`. Everything in a hall is
  positioned relative to the hall's floor (`root.position.y`) so it can rise in place, while colliders use world y.
- **Zones** (`zoneAt`, `ADJACENT_ZONES` in `layout.ts`, `Engine.applyZoneVisibility`): every locker bank, rack, annex, hall and stairs has
  `root.userData.zone`; only the player's zone and its neighbours are visible. Do not hide PointLights this way (toggling lights recompiles
  materials); the halls use emissive fixtures and no point lights.
- **Levels and upgrades** (`GameManager.gainXp`, `buyUpgrade`): level-ups pay a bonus and emit `levelUp`; `upgradeBought` makes the
  Engine build a new `LockerWall` / `KeyRack` that animates in. New banks and racks must have a position in `world/layout.ts`
  (`LOCKER_BANKS`, `KEY_RACKS`). The catalogue is a menu mode like dialogue: `game.catalogueOpen`, movement frozen,
  `Engine.handleCatalogueInput`. More lockers raise `stage.maxActive`, and level raises arrival pace (`scheduler.pace`).
- **Dialogue** (`GameManager.dialogueOptions`): option slots are stable for a visit (done steps stay, disabled with "Done") and
  exactly one enabled option is `recommended` (first enabled step of `FLOW`). The Engine highlights it, E/Enter/click confirm,
  W/S/arrows/wheel move (`nextEnabled`), 1–6 pick by slot, Q = goodbye, and movement is frozen during a conversation.
- **Patience** (`GameManager.updatePatience`) drains only for customers waiting to be served, and is paused while
  you talk to them. Only customers still holding their bag can walk out. The tutorial customer never runs out.
- **The objective is derived from state** (`GameManager.objective()`), never stored, so it can't drift.
- Seeded randomness only (`mulberry32` from `lib/random.ts`, seed from `?seed=`). Ids come from the factory instance.

### 3D world (`src/world`)

- `layout.ts` has the floor plan (metres, y up, street at +z). Read its diagram first.
  Lobby `z 1.6…6`, counter at `z≈1.2`, staff area, partition at `z=-2.4` (key board at `x=-2.6`), storage
  room down to `z=-9` with the locker wall on the back wall.
- `Facility` is the static building. `solid()` = rendered + Rapier collider + reach blocker. `deco()` = visual only.
- `LockerWall` (one per bank) and `KeyRack` (one per rack, in `KeyBoard.ts`) build their meshes from sim records once, then `update()` mirrors state (door
  angle, key in lock, item inside, keys on hooks).
- `CustomerAgents` gives one agent per customer *in the building*. It walks `CUSTOMER_PATH` and calls
  `game.customerReachedCounter()` / `game.customerExited()`. Stored customers have no agent (scales to
  thousands of records). Agents take a counter spot, or the next `lineSpots` place. The front of the line moves up
  when a counter spot frees (`promoteLine`). Patience bars are billboards in `agents.bars`.
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
- Keep `CONFIG.stages[0]` as one endlessly patient customer returning after a fixed wait of **under 30 s** (25 s now). The brief
  said 2 minutes; the owner asked for a short tutorial. It's tested.
- Vite hot reload restarts the game, so after editing code, reload the page before a scripted play-test.

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
