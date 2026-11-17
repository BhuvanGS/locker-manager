# Roadmap

Milestones from the [design brief](design-brief.md) §18. Rule from the brief: finish and test each
milestone before starting the next, and keep the game playable throughout.

## ✅ Milestone 1: Core prototype (done)

- [x] Small 3D facility: street, glass entrance, lobby, service counter, staff area, key board, storage room
- [x] First-person movement (Rapier character controller)
- [x] One scripted tutorial customer (Maya Okafor, blue suitcase)
- [x] Counter conversation: greet, ask name, accept item, confirm stored; on return: greet, hand over
- [x] Manual locker assignment: open any free locker, store, close, take the key (locks it)
- [x] Key board with 8 identical, unlabelled hooks. The player chooses the hook and has to remember it
- [x] Return exactly 120 s after the deposit is confirmed (`CONFIG.stages[0].returnAfter`)
- [x] Retrieval: right key → unlock → take item → hand over → payment + tip + XP
- [x] Wrong key = 1.2 s fumble + mistake. Wrong item = refused, −reputation, −satisfaction
- [x] HUD: cash, free lockers, deposits, queue, served, level/XP, objective, prompts, toasts
- [x] Unit tests for the full cycle and the rules (`npm test`)

Systems in place for later milestones: `SimulationClock` (heap-based event queue), `CustomerScheduler`
(stage config), the full customer state machine including `leftWithoutService`, patience fields,
`LockerManager.findAvailable()` (for automated allocation), and `EconomyManager` levels.

## Milestone 2: Customer scaling (next)

- [ ] Stage 2+ entries in `CONFIG.stages`: a second customer, then more, with random `arrivalGap` and `returnAfter`
- [ ] Advance stages when the tutorial completes (`CustomerScheduler.advanceStage()`)
- [ ] Patience drains while waiting at the counter. At 0 → `leftWithoutService` (their item stays until collected later, or is forfeited, to be decided)
- [ ] Queue: several counter spots plus a waiting line, served in order. Satisfaction drops while queued
- [ ] Overlapping deposit/collection visits
- [ ] HUD: patience indicator over waiting customers

## Milestone 3: Manual management

- [ ] Customers don't say their item on return. The player must recall it
- [ ] Wrong-locker retrieval consequences, beyond the wrong-item refusal that already exists
- [ ] More item variety and names across stages

## Milestone 4: Progression

- [ ] `UpgradeManager` and upgrade tree UI (unlocked, not shown before)
- [ ] Key labels (numbers on hooks and keys), locker numbering, a physical notebook/register
- [ ] Storage expansion: a second locker wall that is built and becomes visible
- [ ] Stage chip advances to "Stage 2 · Organisation"

## Milestone 5: Digitalisation

- [ ] Computer terminal at the counter, a searchable customer database, digital inventory, a barcode scanner

## Milestone 6: Automation

- [ ] Conveyor, automated allocation (`findAvailable`), robotic retrieval, facility expansion

## Milestone 7: Polish

- [ ] `SaveManager` (versioned localStorage save of the sim state)
- [ ] Audio, animations, GLB models, performance benchmarks per milestone
