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
- [x] Tutorial customer returns after a fixed, short wait: **25 s** (`CONFIG.stages[0].returnAfter`). The design brief says two
      minutes, but playtesting showed that was too long for a tutorial, so it was cut to under 30 s
- [x] Retrieval: right key → unlock → take item → hand over → payment + tip + XP
- [x] Wrong key = 1.2 s fumble + mistake. Wrong item = refused, −reputation, −satisfaction
- [x] HUD: cash, free lockers, deposits, queue, served, level/XP, objective, prompts, toasts
- [x] Unit tests for the full cycle and the rules (`npm test`)

Systems in place for later milestones: `SimulationClock` (heap-based event queue), `CustomerScheduler`
(stage config), the full customer state machine including `leftWithoutService`, patience fields,
`LockerManager.findAvailable()` (for automated allocation), and `EconomyManager` levels.

## ✅ Milestone 2: Customer scaling (done)

- [x] Traffic stages in `CONFIG.stages`: tutorial (1) → **Word is getting around** (3 customers, overlapping) →
      **Getting busy** (5) → **Lunchtime rush** (6, faster arrivals, shorter patience) → **Open for business**
      (endless, at most 8 active customers so the 6 lockers can fill up)
- [x] Random arrival gaps and independent, random return times per customer, all from config. Arrivals also come
      in random **bursts** (`burstChance` / `burstGap`) so they never feel evenly spaced
- [x] **Anti-boredom guard** (`maxIdle`): if the shop sits empty for 8–12 s, the next scheduled arrival or return is pulled
      forward. With a perfect player, the longest wait between "something to do" moments is ~17 s in stages 2–4
      (average ~10 s)
- [x] A stage advances when everyone it introduced has finished (served or left), with a banner
- [x] Patience drains while waiting to be served (slower while you're serving them, paused while talking,
      topped up by a greeting). Out of patience: if they still hold their bag they **walk out** (−3 reputation).
      If you have their bag they stay but lose satisfaction (smaller tip, worse reputation on collection)
- [x] Reputation on collection now depends on satisfaction (+2 / 0 / −2)
- [x] "Sorry, we can't take it" (or "we're full") turn-away option (−1 reputation)
- [x] Queue: 3 counter spots plus a waiting line in the lobby, first come first served. The front moves up
      when a spot frees
- [x] Patience bars over waiting customers (green → amber → red)
- [x] Objectives after the tutorial guide without giving away what you have to remember
- [x] Unique first names per game while possible
- [x] Conversation controls: the natural next step is pre-highlighted (`recommended`), E / Enter / click confirm,
      W/S/arrows/wheel move, 1–6 jump, Q steps away. Number slots are stable for the whole visit (finished steps stay
      greyed out). The player stands still while talking, and E no longer pokes things under the crosshair
- [x] Tests: `src/sim/Milestone2.test.ts` (stage progression, overlap, walk-out, patience rules, turn-away, cap)

Open questions for later: should ignoring a whole stage still advance it? (Today: yes. Later, reputation and
satisfaction should gate traffic, per brief §3 "Later stages".)

## Interim work between Milestone 2 and 3 (done)

Requested after playtesting Milestone 2.

- [x] **Return order is random, not first-in-first-out.** With plain random waits, 81–86 % of customers stored at the same
      time came back in the order they left (the earlier one has already used up part of its wait). Return windows are wider
      and a new return time is set to land just before an already-stored customer 80 % of the time
      (`CONFIG.returns`, `CustomerScheduler.returnDelay(now, pending)`). Now ~60 %, close to a coin flip (50 %)
- [x] **Wrong package escalates.** Handing someone else's bag gives "Um… this isn't my package", then "still not mine", then
      "the wrong one again, mine is the {item}", then angrier lines. You can retry as often as you like, and every try
      costs satisfaction, reputation (first −4, then −2 each) and 20 % of their patience. A face over their head goes
      😕 → 😠 → 🤬. From the third wrong try they are furious: half the fee and no tip when you finally get it right
      (`CONFIG.wrongItem`, `GameManager.wrongPackage`)
- [x] **Levels**: Level n needs 100·n XP. Levelling up gives a cash bonus (20 × level), a banner naming what it unlocks,
      and customers arrive 10 % faster per level above 1
- [x] **Supplier catalogue** (a desk in the staff area; E opens a menu, W/S choose, E buys, Q closes; the shop keeps running):
      Key rack #2 ($40, level 2), Locker bank B ($90, level 2), Key rack #3 ($70, level 3), Locker bank C ($160, level 3).
      Bank B/C and rack #3 need the previous one first. Each adds real things: +6 lockers and 6 keys per bank, +8 hooks
      per rack. They appear in the 3D shop (banks rise out of the floor, racks pop onto the wall). More lockers also raise
      the cap on customers at once in open trading
- [x] Tests: `Progression.test.ts` (return order, wrong package, levels, upgrades)

## Interim work: labels and the register board (done)

- [x] **Bug fix: you can no longer skip locking up.** You could leave a locker open with its key still in the lock and
      still tell the customer "it's stored", which removed the whole point of remembering a key. "Tell them it is stored"
      is now disabled until the bag is in a locker whose door is shut and whose key is out of the lock (the reason is shown
      next to the option, in the toast and in the objective)
- [x] **Locker & key labels** (catalogue, level 2, $60): a number plate on every locker door and a matching yellow number tag
      on every key, whether it hangs on a rack, sits in a lock or is in your hand. Prompts say "Open locker 4", "Take key 4"
- [x] **Deposit register board** (catalogue, level 2, $150, needs labels): a whiteboard on the staff-area wall that lists every bag
      in a locker: customer, locker number, item, oldest first. It updates itself as you store and collect (the first
      piece of automation: it takes over remembering who is where). Two columns when crowded (up to 18)
- [x] The header says "Organised facility" once you have either upgrade (brief: Stage 2 · Organisation)
- [x] Tests: `Progression.test.ts` (locking up, labels, register)

## Interim work: names on the board, and building expansion (done)

- [x] **The register only shows names you asked for.** `Customer.nameTaken` is set only when you ask for the name when taking the
      bag (asking on the return visit does not count). Otherwise the board shows the locker and item with "name not taken".
      Asking now matters even though the dialogue keeps it optional
- [x] **The register board moved into the storage room**, onto the storage side of the partition, facing the lockers
- [x] **Building expansion** (Stage 4 of the brief starts here: "larger storage rooms"). Two catalogue upgrades knock the shop
      through into the units next door:
      **Storage annex (west)** and **Storage annex (east)**. (The west one was later replaced by the conveyor: see "digital lockers, conveyor and robot arm" below.)
      Each adds a real room: a doorway is cut through the storage room's side wall (the collider goes too), the neighbour's back half
      is replaced by a new hall that rises out of the ground (own walls, floor, ceiling, lights, signs), with **2 locker banks
      (+12 lockers)** and **2 key racks (+16 hooks)**. Both together make 42 lockers. More lockers raise the cap on customers at
      once. The header says "Expanded facility". The register board uses up to three columns for 42 bags
- [x] Tests: `Progression.test.ts` ("The register only shows names you asked for", "Building expansion: annexes")

## Interim work: south expansion and floors (done, not yet play-tested)

- [x] **South expansion** (level 6, $900, needs the east annex): the building grows **backwards**, with lockers in a **row configuration**.
      A doorway is cut through the back wall (in the gap between locker banks 1 and 0, which moved to ±4.3 to make it 1.4 m wide) into
      a 12 × 11.8 m hall with **two rows of three banks** (+36 lockers; doors face the entrance, 2.4 m aisle between the rows) and
      **five key racks** along the old back wall (+40 hooks)
- [x] **Floor 1** (level 7, $1,500) and **Floor 2** (level 8, $2,200), each needing the one before: the same hall stacked on top
      (3.5 m floor to floor), each with the same two rows and five racks (+36 lockers, +40 hooks). Buying one removes the hatch in the
      ceiling below and builds a flight of 14 steps (0.25 m high) with a guard wall; the stairs are along the east wall, climbing towards
      the north wall (walk up from the south end, step off to the west at the top). Everything together: 150 lockers
- [x] Only the part of the building you are in, and the parts you can see into, is drawn (`zoneAt`, `ADJACENT_ZONES`), so the
      hundreds of locker meshes do not slow the game down
- [x] The deposit register flips through pages (42 bags per page, every 7 s) when there are more bags than that
- [x] Layout tests (`world/layout.test.ts`) check the geometry: rows fit, the doorway fits, aisles, racks clear of the door, stair rise
- [x] Fixes after play-testing: smooth ramp-based stairs, jump (Space), straight-off landings with "↓" signs, windows in the halls, brighter lockers,
      and the floor-1 "gap" (zone culling hid the floor below; the tower zones now see each other, with a regression test)
- **Earlier note (before the fixes above):** the 3D side of this (doorway, hall, stairs, floors, culling) was only type-checked and
  checked by the layout tests. Play-test it: walk through the new doorway, up both flights of stairs, and look for gaps or overlaps

Not done yet from the brief's expansion list: specialised compartments, warehouse sections, mechanisation.

## Interim work: digital lockers, conveyor and robot arm (done)

Requested as "the next major upgrade: automation".

- [x] **Digital lockers** (upgrade `digital`, level 4, needs the register): the keys go (`GameManager.goDigital`), doors lock themselves when shut with a
      bag inside, staff open any locker with `E`, key racks are removed and each bank gets a **status screen** (`world/StatusScreen.ts`: green free,
      red occupied, amber reserved) plus a door LED (`LockerWall`). Key rack upgrades become unavailable (`obsoleteBy`).
- [x] **Conveyor and robot arm** (upgrade `conveyor`, level 5, needs digital): `sim/ConveyorSystem.ts` (belt → single arm → locker, and the reverse),
      `GameManager.loadConveyor / requestBag / takeFromConveyor / terminalEntries`, the terminal menu (`ui/TerminalPanel.tsx`), and `world/ConveyorBay.ts`
      (two belts through a partition hatch, a gantry rail along the lockers, the arm, the kiosk). The arm serves the storage room's three banks.
- [x] **The conveyor replaces the west annex** (`annexWest` is gone from the catalogue; the east annex now needs bank C), and **floor 1 got a third row**
      (+54 lockers instead of +36) to make up for it.
- [x] Tests: `sim/Automation.test.ts` (digital, belt, arm, fetch, wrong bag, queueing), layout tests for the belts and rows.
- [x] **Conveyor levels and arm upgrades** (see the next section).
- Not done: belt jams and arm breakdowns (brief §11); automated allocation
  beyond "lowest free locker"; the terminal does not search customers by name.

## Interim work: conveyor levels, arm upgrades and upgrade consoles (done)

- [x] **Coverage levels:** the conveyor reaches one zone at a time: storage room (the catalogue upgrade), then the East annex, South hall, Floor 1 and Floor 2
      (`line-*` upgrades, each needing its hall and the previous belt). A bag for a hall leaves the belt into a service duct (`transitIn`/`transitOut`,
      `CONFIG.automation.transit`) and reaches that hall's arms.
- [x] **One arm station per row of lockers** (`sim/ConveyorSystem.ts`: stations are `zone:row`; `ZONE_ROWS` = 1, 1, 2, 3, 2), drawn by `world/StationView.ts` with `ArmRig`.
- [x] **Arm upgrades per zone:** speed levels 1–3 (`CONFIG.automation.speedMult`) and a second arm on every row of the zone (a parallel rail).
- [x] **Upgrade consoles** (`world/AutomationConsole.ts`, `ui/ConsolePanel.tsx`): the control hub in the staff area sells belt extensions; every zone has its arm
      console next to its arms. These upgrades are `AUTOMATION_UPGRADES` in `config.ts`, bought with `buyAutomation`, and are not in the supplier catalogue.
- [x] Tests: `sim/AutomationLevels.test.ts` (levels, ducts, speed, two arms, rows as stations, consoles, mod menu).
- Next idea: move the other upgrades (lockers, racks, halls) to consoles in their own areas, the same way; arm breakdowns; a duct visible between halls.

## Interim work: mod menu (done)

- [x] **Mod menu** (`M`): free cash, levels (+1, +100 XP, level 4, level 8), unlock any upgrade or everything (annexes included, built
      for real), spawn customers, next traffic stage, bring stored customers back, skip time, customers never lose patience,
      freeze-the-shop option, new game. For testing without grinding. `CONFIG.modMenu.enabled` turns it off for release
- [x] Tests: `Mods.test.ts`

## Milestone 3: Manual management (next)

- [ ] Customers don't say their item on return (the "mine is the {item}" hint after repeated mistakes is the exception).
      The player must recall it
- [ ] Wrong-locker retrieval consequences, beyond the wrong-package escalation that already exists
- [ ] More item variety and names across stages

## Milestone 4: Progression (partly done above)

- [x] Upgrade catalogue, levels, storage expansion (locker banks) and extra key racks (see above)
- [x] Key and locker labels, and a (self-updating) register board (see above)
- [ ] A writable notebook for the early game, before the board
- [ ] More expansion: a taller third row of lockers, a second floor, specialised compartments, a proper upgrade tree UI
- [ ] Stage chip advances to "Stage 2 · Organisation"

## Milestone 5: Digitalisation

- [ ] Computer terminal at the counter, a searchable customer database, digital inventory, a barcode scanner

## Milestone 6: Automation

- [x] Conveyor, automated allocation (lowest free locker), robotic retrieval (see the interim section above)
- [ ] Jams, breakdowns, upgrades to the arm (speed, a second arm), automated item identification, arms for the other halls

## Milestone 7: Polish

- [ ] `SaveManager` (versioned localStorage save of the sim state)
- [ ] Audio, animations, GLB models, performance benchmarks per milestone
