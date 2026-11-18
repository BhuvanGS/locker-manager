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
  stairwell hole closed by a hatch (`Hall.openHatch`) until the next floor is bought, when the Engine adds `Stairs` (14 visible steps of 0.25 m with NO colliders, walked on via one sloped ramp collider so the climb is smooth
  (`SLOPE_LIMITS`), a tall guard collider/rail, and a 1.7 m+ landing at the top). Halls have windows (`Hall.windowedWall`, glass colliders). Tower zones
  (south, floor1, floor2) all see each other, since one floor is the next one's ceiling. Space jumps (`PlayerController`, `JUMP_SPEED`, `GRAVITY`);
  `player/stairs.physics.test.ts` runs real Rapier. `LockerWall` takes a `BankPlacement` (`centerX`, `frontZ`, `floorY`) and `KeyRack` an optional `y`. Everything in a hall is
  positioned relative to the hall's floor (`root.position.y`) so it can rise in place, while colliders use world y.
- **Digital lockers** (`kind: 'digital'`, `game.isDigital`): `goDigital` puts every key back in its lock, clears the player's key, and sets `locked` = bag inside and shut.
  Afterwards `closeLocker` locks a locker holding a bag by itself, `openLocker` unlocks it for staff, key actions fail ("no keys any more"), and
  `storedBlocker` no longer asks for a key. The Engine removes the key racks, hides the KEYS sign, builds one `StatusScreen` per bank (`bankSpots` remembers each
  bank's placement) and the `LockerWall` door LEDs show locker state. Racks bought later are skipped. Key-rack upgrades have `obsoleteBy: 'digital'`.
- **Conveyor and robot arm** (`kind: 'conveyor'`, `sim/ConveyorSystem.ts`, `world/ConveyorBay.ts`, `CONFIG.automation`): the system owns `Parcel`s
  (store: `beltIn → waitingForArm → arm`; fetch: `queued → arm → beltOut → ready`) and ONE arm that takes the oldest ready parcel. `ARM_STEPS` are the moments in the
  arm job when the door opens, the bag moves and the door shuts; **lockers, items and customers are changed there together** (door, lock, `item.status`
  `'onConveyor'`, `locker.state` `'reserved'` while a job holds it). Player actions: `loadConveyor` (picks the lowest free robot locker), `openTerminal` /
  `requestBag(lockerId)`, `takeFromConveyor`. The arm only serves banks `< CONFIG.automation.robotBanks` (the storage room's three). `ConveyorBay` draws it all
  from `game.conveyor` and steers the arm to a pose from `armProgress()` with keyframes that match `ARM_STEPS`; change one, change the other. The belts pass through
  a hatch in the partition (`Facility.setConveyorOpen`) and `CONVEYOR`/`lockerSlot` in `layout.ts` hold the positions (tested in `layout.test.ts`).
  There is **no west annex**: the upgrade was removed and the conveyor takes its place; floor 1 has a third row (`SOUTH.rowFrontZ` has three entries; floors use the rows they need).
- **Conveyor levels, arms and consoles** (`AutoZone` in `config.ts`: `main | east | south | floor1 | floor2`): the sim maps every bank to a zone and row
  (`GameManager.bankInfo`, `zoneOf`, `rowOf`). `ConveyorSystem` keeps which zones are `covered`, each zone's speed level and arm count; a zone's arms (`Parcel.arm`) each take the oldest
  waiting bag and ride to any of its rows (`armDuration(zone, row)` grows with the zone's travel and the row). Halls are fed through ducts (`transitIn` / `transitOut`, `CONFIG.automation.transit`).
  Levels are `AUTOMATION_UPGRADES` (generated in `config.ts`): `line-<zone>` sold at the **hub** console, `speed-<zone>-1..3` and `arms-<zone>` at that zone's
  console, bought with `buyAutomation` (`consoleItems(scope)` gives the menu). `grantUpgrade` (mod menu) also accepts these ids and grants everything they need.
  3D: `ArmRig` (one arm riding overhead rails, keyframes tied to `ARM_STEPS`, pose = x, z, wrist, reach, claw), `StationView` (one per zone: rails, arms, and the
  dock: `belt` for the storage room, `tube` for the annex, `bay` for the tall halls with its belts, ducts and collider), `ConveyorBay` (the hub: belts, kiosk, the
  storage room's station), `AutomationConsole` (pedestal + screen, tag `console`). The Engine builds one station per zone when its `line-*` notice arrives
  (`addLine`) and finds a locker's opening with `lockerSlotWorld`. Positions: `STATION`, `BAY`, `CONSOLES` and `OCCUPANCY_BOARD` in `layout.ts`; `OccupancyBoard` is a wall board per tall hall (digital lockers), built by the Engine in `addOccupancyBoard`. Keep overhead rails west of the stairs (x < 4.45). To add a zone: `AutoZone`, `ZONE_ROWS`,
  `LINE_NEEDS`, tubes/extent in `STATION`, a console spot, and the Engine's `addLine`.
- **Cargo, docked trucks, carrying crates, sections, police** (`sim/WarehouseManager.ts`; `CONFIG.warehouse`, `WAREHOUSE_UPGRADES`, `CargoType`, `Section` in `config.ts`): trucks queue, then take one of
  `parkingSpots` (the docks: `Truck.spot`, `arriving → parked → leaving`). A delivery is a `Load` (`crates`, `taken`, `truckId`) while its crates are on the truck. **A crate is always in exactly one place:** on a truck
  (`truck.onBoard`), in a section (`consignments`, by `loadId` + `section`), in your hands (`WarehouseManager.carrying`, mirrored by `game.hands = { kind: 'crate' }`), or in a robot's clamp (`RobotJob.crate`). Carry actions (`GameManager.takeCrateFromTruck /
  storeCrate / takeCrateFrom / loadCrate` → `takeFromTruck / storeCarried / takeForCollection / loadCarried`) move one crate at a time. An emptied delivery truck leaves; owners come back per load (`collectAt`) once
  none of it is on a truck or in your hands, and `finishCollection` pays when the last crate is loaded. A delivery parked longer than `parkedPatience` gives up (`refused` with `gaveUp`). The desk (`GameManager.receive`)
  only does `inspect` and `refuse` (refuse only while `taken === 0`). `visibleCargo` is what a load looks like (real type only if `inspected` or the scanner); `placeFor(visible, crates)` says where it belongs. The robots
  (`robots: (RobotJob | null)[]`, `updateRobots`, `CONFIG.warehouse.robots`) each carry ONE crate per job: a job reserves room in its section from the start (`sectionFree` counts it), the crate leaves the truck or
  section at `grabAt` of the job (`robotGrab`; the job is dropped if it has gone) and arrives at the end (`robotDrop`); collections first; jobs start `stagger` apart. Spoilage (food after `foodShelfLife`, cold chain outside the cold room after `coldSpoilSeconds`), theft (metals outside the vault),
  collection pay `cargo fee × crates` (0 if spoiled), and the police (`updatePolice`, only once `stored ≥ police.minCrates`; `inspectBuilding` fines and seizes). `GameManager.handleWarehouseEvents` turns events into
  money, reputation and toasts. Upgrades: `buyAutomation('wh-…')` (console scope `warehouse`) → `WarehouseManager.applyUpgrade`. **Add to `Fuzz.test.ts` and `check()` when you add a new way for crates to move.**
- **Warehouse view** (`kind: 'warehouse'`, `world/Warehouse.ts`, `WAREHOUSE` in `layout.ts`): the shed stands against the south hall's east wall (x = 6.2; the hall's wall closes that side up to its roof, the shed's
  own wall above it) and reaches north to the back of the east annex, so there is no gap. Two roots, `root` (the shed, zone `warehouse`) and `yard` (road, truck yard, trucks, police car); BOTH are interaction targets.
  Racks run along x (`rackAlongX`; `WAREHOUSE.shelves` in buying order, the rooms' racks along the south wall), each with an invisible proxy tagged `{ kind: 'section', section }`; every section has crate `slots` that fill in
  order, each with an `approach` spot on a robot lane. Trucks: one view per `Truck`, tagged `{ kind: 'truck', truckId }`, driven along a `Route` (`world/paths.ts`: rounded polylines, heading from the direction of travel,
  reverse legs): down `road.laneX`, into the yard at `yard.inZ`, down `yard.aisleX`, backing into the dock in an arc (`yard.turn`); out the same way to `yard.outZ`. NEVER move a vehicle sideways: give it a route. Dock
  doors roll up onto a drum (scaled, never through the roof) for a docked truck or the player nearby, and their colliders come and go. Robots (`world/WarehouseRobot.ts`): `LaneGraph` builds a graph from the painted lane
  segments (`laneSegments()`, `WAREHOUSE.lanes`) plus every approach spot, and routes with Dijkstra; `WarehouseRobot` drives it by the sim job's progress (arrive, reach, grab at `grabAt`, carry, place) with a telescoping
  boom and a big clamp. The roof and room ceilings cast shadows, so the inside uses faintly glowing materials (`lit()`) rather than lights. The yard (east of the east annex, south of the office) is zone `warehouse` too.
- **Sun shadow** (`Facility.followSun`, called by the Engine every frame): the directional light's shadow box (±`SHADOW_HALF` m) is centred on the player, snapped to texel steps, so far rooms get proper shadows without
  shimmering. Anything with a roof must cast shadows (`castShadow`) or the sun shines through it.
- **VIP cars** (`world/VipCar.ts`): follows `game.deals.offer`. When the car parks, the VIP walks `WALK` (pavement → front door → lobby → office door → chair), timed to arrive at `readyAt` (`CONFIG.deals.arrivalSeconds`); the office draws them seated from then on; when the offer ends they walk back and the car leaves. `nearDoor()` opens the front door for them. **Names:** `CustomerAgents` keeps a name sprite per agent.
- **Counter arm** (`upgrade id 'counter-arm'`, `GameManager.updateCounterArm`): one `CounterJob` at a time (take or give); an item is `withArm` from the grab (progress 0.4 / 0.35) until the job ends; the take job
  reserves its locker up front and loads the belt at the end, the give job removes the ready bag from the tray at the grab and pays through `finishReturn`. A job is dropped (before the grab) if you start talking
  to the customer or they leave. The view (`CounterArm`) is keyframes over `counterJobView().progress`.
- **Deal office and VIP deals** (`kind: 'office'`, `sim/DealManager.ts`, `world/Office.ts`, `ui/DealPanel.tsx`): after the office is bought `deals.update` (called from `GameManager.update`) makes one
  `Offer` at a time once reputation allows; the player sits at the desk (`openDeal`, `dealOpen`, tag `dealDesk`) and `chooseDeal`s accept / haggle / decline. `deals.signed` is the list of contracts
  the future warehouse will use. The Engine builds the room in `addOffice` (the doorway is a second removable panel in the east wall, `Facility.setOfficeOpen`, which also shrinks the neighbour block);
  zone `office` (`zoneAt`, `ADJACENT_ZONES`). Positions: `OFFICE`, `OFFICE_DOOR` in `layout.ts`. VIP names and looks live in `CONFIG.deals.vips`.
- **Deposit and return rules** (`GameManager`): `finishDeposit(c)` is the single "it is stored" step (telling them, loading the belt, or a customer's patience running out while
  their bag is in a locker). A deposit visit has `giveBack`. `takeItem` applies the rummaging penalty. A locker with `state: 'reserved'` belongs to the arm: `openLocker`, `closeLocker`,
  `putItem` and `takeItem` refuse it, and `ConveyorSystem` keeps it reserved from the moment a job takes it until the job is done. `CustomerFactory.item(..., avoid)` keeps bag descriptions unique.
  **`Fuzz.test.ts` is the safety net:** when you add an action or a state, add it to the random player and to `check()`.
- **Maintenance** (`CONFIG.automation.maintenance`, `ConveyorSystem.armHealth`): each arm has `condition` 0–100 and `jammed`. A finished job wears it (`wear`), the job duration
  is scaled by `slowdown(condition)` (`jobDuration`), and `rollJam` runs when a job starts using the host's seeded `random()`. A jammed arm's job does not advance (`update` skips it).
  `service` / `repair` are bought through `buyAutomation` with the ids `service-<zone>` / `repair-<zone>`, shown first in a zone console by `maintenanceItems`. The `jam` notice
  becomes a red toast; `objective()` points at a jam before anything else. The arm lamp (`ArmRig.update(..., jammed)`), the console screen and the terminal show the state.
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
- **Textures** (`world/textures.ts`, files in `public/textures/<name>/` with `CREDITS.md`): `textured(name, surface)` caches image materials
  like `mat()`; `wallMat(colour)` (plaster), `glassMat(opacity)` (smudged, reflects the room via `setGlassEnvironment`), `lightPanel()`, and `tileFloor` / `concreteFloor` / `carpetFloor` / `woodMat` / `leatherMat`, which divide out the texture's measured average colour
  (`average`) so a surface keeps its old flat colour. Scripts that call `__game.advance` block image loading: wait a moment before a screenshot.
  Box faces stretch a texture, so boxes with tiled textures use `metreUVs(geometry)` (the buildings' `solid()`/`deco()` already do).
  Never put a texture on a material from `mat()`'s cache: it is shared by everything of that colour.
- **3D props** (`world/props.ts`, `public/models/<name>/model.gltf`, `CREDITS.md`): `prop(name, { x, y, z, rotY, height, glow })` returns a group
  that fills with a clone once the glTF loads (stands on `y`, scaled to `height`). Decoration only: add a collider yourself, and keep props out of
  `CUSTOMER_PATH` spots, staff gaps and robot lanes. `glow` is for the warehouse. Props are drawn opaque and double-sided.
- **Cables** (`world/cables.ts`): `festoon` (looped cable along a gantry rail), `cable` (smooth rubber cable through points) and `conduit`
  (straight pipe ending in a ceiling junction box). Rails, the counter arm, consoles, the kiosk and the electrical boxes (`power_box_01`) use them. A new model = download, shrink textures, add it to `PropName`.
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
