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

### Add a customer stage (Milestone 2+)

```ts
// config.ts → CONFIG.stages
{ id: 'two-customers', customers: 2, firstArrivalDelay: 10, arrivalGap: [20, 60], returnAfter: [100, 200] }
```
Then decide when to call `scheduler.advanceStage()` and `scheduleNextArrival()`. For example, when the tutorial
completes (in `customerExited`). Test that arrivals and returns are independent and not in a fixed order.

### Patience (Milestone 2)

In `GameManager.update(dt)`, drain `patience` for customers in `waiting` / `waitingForCollection` (not while
`dialogue.customerId` is them, if you want talking to pause it). At 0 → `transition(id, 'leftWithoutService')`,
lower satisfaction and reputation, and notify `customerLeaving`. Decide what happens to a stored item when its
owner leaves. Keep early-game punishment gentle (brief §9).

### Add a player action

1. Add a method on `GameManager` returning `ActionResult`, and a test.
2. If it's triggered in 3D, add an `Interactable` kind in `world/interactables.ts`, tag a mesh, and handle it in
   `InteractionManager.describe()` and `perform()`.
3. If it changes what the player should do next, extend `objective()`.

### Add a dialogue option

Add the id to `DialogueOptionId`, offer it in `dialogueOptions()` (with a `disabled` reason when it can't be
used yet) and handle it in `choose()`. Number keys map to the option order, so put the likely choice first.

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
