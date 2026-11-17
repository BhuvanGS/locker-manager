---
name: sim-systems
description: Add or change Locker Manager's simulation — customer stages and pacing, the customer state machine, patience/satisfaction, economy, new player actions, dialogue options, objectives, and upgrades/automation (UpgradeManager, AutomationManager, SaveManager). Use for any change under src/sim or any new gameplay rule.
---

# Simulation systems

`src/sim` is pure TypeScript. It's the single source of truth, unit-tested, and doesn't import Three.js or React.
Read `AGENTS.md` → "Simulation" for module ownership, and check `docs/design-brief.md` for the section you're implementing.

## Golden rules

1. **One owner per record.** Customers and items live in `CustomerManager`, lockers in `LockerManager`, keys in
   `KeyManager`, money/XP/reputation in `EconomyManager`. `GameManager` coordinates them. Don't stash copies.
2. **Actions on `GameManager` validate, then mutate, then return `ActionResult`.** Player mistakes return
   `fail('…')` with a message the HUD toasts. Managers throw only on impossible states.
3. **Keep cross-references consistent in the same action:** `item.status/lockerId`, `customer.lockerId`,
   `locker.itemId/state`, key location, `hands`. The brief says a customer must never receive someone else's item.
4. **Timing comes from config.** Add or adjust `CONFIG.stages` entries. Never put a timer on a single customer.
   Schedule through `this.clock`.
5. **State changes go through `customers.transition()`.** To add a state or edge, update `CustomerState` in `types.ts`
   *and* the `TRANSITIONS` table.
6. **Objective and dialogue options are derived from state** (`objective()`, `dialogueOptions()`), not stored.
7. **Seeded randomness only**, through the `rand` passed into the factory and scheduler.
8. **Write the test first or alongside**, in `src/sim/*.test.ts`. `GameManager.test.ts` has helpers:
   `gameWithCustomerAtCounter()` and `deposit()`.

## Recipes

### Add or tune a traffic stage

Edit `CONFIG.stages` (see `ArrivalStage` in `config.ts`): `customers` (null = endless), `firstArrivalDelay`,
`arrivalGap`, `returnAfter`, `patience` (null = never drains), optional `maxActive`, and the banner `title`/`intro`.
`CustomerScheduler.finish()` advances once everyone the stage introduced has finished. `GameManager.customerExited`
then emits `stageStarted` and schedules the next arrival. Tests: `Milestone2.test.ts` has a `Driver` class that plays
the 3D layer's role (instant walking) with `deposit()`, `collect()` and `finishTutorial()` helpers.

### Patience and satisfaction

All in `GameManager.updatePatience` and `walkout`, with numbers in `CONFIG.customer` / `CONFIG.economy`.
Keep early-game punishment gentle (brief §9): only customers still holding their bag can walk out.

### Add a player action

1. Add a method on `GameManager` returning `ActionResult`, and a test.
2. If it's triggered in 3D, add an `Interactable` kind in `world/interactables.ts`, tag a mesh, and handle it in
   `InteractionManager.describe()` and `perform()`.
3. If it changes what the player should do next, extend `objective()`.

### Add a dialogue option

Add the id to `DialogueOptionId`, offer it in `dialogueOptions()` (with a `disabled` reason when it can't be
used yet) and handle it in `choose()`. Number keys map to the option order, so put the likely choice first.

### Add a catalogue upgrade (locker banks, key racks)

1. Add an entry to `CONFIG.upgrades` (`id`, `kind`, `title`, `description`, `cost`, `level`, optional `requires`).
2. For a bank, add its `centerX` to `LOCKER_BANKS`; for a rack, its `x` to `KEY_RACKS` (both in `world/layout.ts`).
   Check there is room (banks are 2.82 m wide; racks are 1.3 m).
3. `GameManager.buyUpgrade` already applies `lockerBank` / `keyRack`. A new `kind` needs a branch there, a matching
   `upgradeBought` handler in `Engine.tick`, and tests in `Progression.test.ts`.
4. Level-ups list what they unlock from `unlockedAt(level)`, so the banner updates itself.

### Labels and the register board

`labels` and `register` are catalogue upgrades with no new sim records: the views check `game.hasLabels` / `game.registerEntries()`.
Anything that tells the player which key opens which locker, or who left what, should be gated behind an upgrade; keep the
early game manual (brief §7–8). The register needs `labels` first because its rows are locker numbers.

### Deposit rules

Confirming a deposit is guarded by `storedBlocker`: bag in a locker, door shut, key out (locked). Add a test in
`Progression.test.ts` ("Bug fix: you cannot skip locking up") for any new way to bypass the memory challenge.

### Customer return order

**Automation** (`sim/ConveyorSystem.ts`): a bag is a `Parcel` in a phase; one arm does one job at a time and mutates lockers, items and customers together at the `ARM_STEPS`
moments. Reserve the locker (`state: 'reserved'`) when a job is created and guard the manual actions (`openLocker`, `putItem`, `takeItem`) against it. Tests step the
sim in small `dt` (a single big `dt` skips whole jobs). Keep the 3D arm keyframes in `ConveyorBay.targetPose` in line with `ARM_STEPS`.

`CustomerScheduler.returnDelay(now, pending)`: the return window per stage plus `CONFIG.returns` overtaking. Keep a test that
measures first-in-first-out among customers stored at the same time (`Progression.test.ts`); plain random waits give ~80 %.

### Mistakes and anger

`GameManager.wrongPackage` (per-visit `wrongAttempts`, lines in `wrongPackageLine`, numbers in `CONFIG.wrongItem`). New
mistake types should follow the same pattern: escalate with a per-visit counter, return `fail(message)`, emit a `mistake` notice.

### Upgrades and automation (Milestones 4–6)

Create `UpgradeManager` (owned upgrade ids, costs from config, `buy(id)` → ActionResult). Each upgrade must
**change a rule or remove a manual task** (brief §10–11), for example:
- *Key labels*: the world shows numbers on hooks and keys (`KeyBoard` reads `upgrades.has('keyLabels')`).
- *Notebook*: a new UI screen backed by sim records the player writes.
- *Automated allocation*: `accept` reserves `lockers.findAvailable()` for the customer.
Gate the UI so it only appears once the upgrade is bought.

### Save system (Milestone 7)

`SaveManager.serialize(game)` → `{ version, clock, customers, items, lockers, keys, economy, upgrades }` as JSON in
localStorage, plus a `migrate(version)` step. Agents (3D) are rebuilt from records on load.

## Verify

`npm test && npm run typecheck && npm run lint`, then the `playtest` skill's full-cycle script. Update `docs/ROADMAP.md` checkboxes.
