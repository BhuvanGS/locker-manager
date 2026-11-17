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
      **Storage annex (west)** (level 4, $450, needs locker bank C) and **Storage annex (east)** (level 5, $600, needs the west one).
      Each adds a real room: a doorway is cut through the storage room's side wall (the collider goes too), the neighbour's back half
      is replaced by a new hall that rises out of the ground (own walls, floor, ceiling, lights, signs), with **2 locker banks
      (+12 lockers)** and **2 key racks (+16 hooks)**. Both together make 42 lockers. More lockers raise the cap on customers at
      once. The header says "Expanded facility". The register board uses up to three columns for 42 bags
- [x] Tests: `Progression.test.ts` ("The register only shows names you asked for", "Building expansion: annexes")

Not done yet from the brief's expansion list: more locker rows, multiple floors, specialised compartments, warehouse sections.

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

- [ ] Conveyor, automated allocation (`findAvailable`), robotic retrieval, facility expansion

## Milestone 7: Polish

- [ ] `SaveManager` (versioned localStorage save of the sim state)
- [ ] Audio, animations, GLB models, performance benchmarks per milestone
