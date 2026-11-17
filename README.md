# Locker Manager

**From memory to automation.** A first-person 3D management game in the browser. You run a tiny
bag-storage shop. Customers leave their belongings with you and come back later. At first there's no
computer, no labels and no notebook, only six identical lockers and a board of identical keys, so you
have to remember who left what, where you put it, and which key opens it.

The long-term arc (see [docs/design-brief.md](docs/design-brief.md)): manual labour → organisation →
digitalisation → mechanisation → automation, growing from one suitcase to thousands of records.

**Status: Milestones 1 and 2 are complete.** A short tutorial customer (back in 25 seconds) walks you through a
full deposit → wait → retrieval cycle, then three, five, six and finally an endless stream of customers arrive at
random times. Progress is tracked in [docs/ROADMAP.md](docs/ROADMAP.md).

Built with **Three.js** (3D), **Rapier** (player physics), **React** + **Zustand** (HUD and menus),
**Vite** and **TypeScript**. Unit tests use **Vitest**.

## Play

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173, press **Open the shop**, and click the view to capture the mouse.

### Controls

| Key | Action |
| --- | --- |
| `W A S D` / arrows | Move (`Shift` to walk faster) |
| Mouse | Look |
| `E` / left click | Use whatever is under the crosshair: talk to a customer, open or close a locker door, store or take an item, take a key out of a lock, hang or take a key on the key board, try a key on a locked locker |
| `E` / `Enter` / click (in a conversation) | Confirm the highlighted answer. The natural next step is pre-highlighted, so mashing `E` walks you through |
| `W` `S` / arrows / mouse wheel (in a conversation) | Move the highlight |
| `1`–`6` | Jump straight to an answer. Each number keeps the same meaning for the whole visit; finished steps stay greyed out |
| `Q` / `Backspace` | Step away from the conversation |
| `M` or `` ` `` | **Mod menu** (see below) |
| `Esc` | Pause. The shop clock stops while paused (or closes the mod menu if it is open) |

### How a customer works

1. A customer walks in and waits at the counter. Talk to them, greet them, ask their name, and accept their item.
2. Take it to the storage room, open an empty locker, put it in, and close the door.
3. Close the locker door, then take the key out of the lock (this locks the locker) and hang it on any hook of the key board. **Remember which.**
4. Go back and tell them it's stored. (You can't until the locker is shut and locked, so you can't skip it.) They leave and come back later (the first customer returns after just 25 seconds; later ones take longer and in a random order).
5. When they return, take the right key, unlock their locker, take their item and hand it over. They pay the fee plus a tip.

The wrong key won't turn (you lose a moment fumbling). Hand someone the wrong bag and they'll say it isn't theirs.
You can try again, but every try makes them angrier (😕 → 😠 → 🤬): you lose reputation, and a furious customer
pays only half price and doesn't tip.

### Mod menu (skip the grind)

Press `M` (or `` ` ``, or click the small "Mods" button) to open the mod menu. It gives you the mouse and, by default, freezes
the shop while you click around:

- **Cash:** +$100 / +$1,000 / +$10,000
- **Level:** +1 level, +100 XP, or jump to level 4 or 8 (with the normal level-up bonus and banner)
- **Upgrades:** unlock any single upgrade for free (it also unlocks what it needs first), or **unlock everything**, including
  the annexes. They appear in the shop exactly as if you had bought them
- **Customers:** spawn 1 or 5, jump to the next traffic stage, bring every stored customer back, skip 30 s or 2 min
- **Options:** customers never lose patience; freeze the shop while the menu is open; start a new game

It's meant for testing and tinkering. To remove it from a release build, set `modMenu.enabled` to `false` in
`src/sim/config.ts`.

### Growing the shop

Serving customers earns XP. Each level pays a cash bonus, unlocks things in the **supplier catalogue** (the desk in the
back-right corner of the staff area) and makes customers arrive a little faster. In the catalogue, `W`/`S` choose,
`E` buys, `Q` closes (the shop keeps running while you browse). You can buy:

| Upgrade | Level | Cost | What you get |
| --- | --- | --- | --- |
| Locker & key labels | 2 | $60 | Numbers on every locker door and a matching number tag on every key |
| Deposit register board | 2 | $150 | A board in the storage room listing every stored bag: locker, item and the name you took (needs the labels first) |
| Key rack #2 | 2 | $40 | +8 key hooks |
| Locker bank B | 2 | $90 | +6 lockers (left of the storage room) |
| Key rack #3 | 3 | $70 | +8 key hooks |
| Locker bank C | 3 | $160 | +6 lockers (right of the storage room) |
| Storage annex (west) | 4 | $450 | **Building expansion:** knock through into the unit next door: a new hall with +12 lockers and +16 key hooks (needs bank C) |
| Storage annex (east) | 5 | $600 | The same on the other side, for 42 lockers in total (needs the west annex) |
| **South expansion** | 6 | $900 | Extend the storage room **backwards**: a doorway through the back wall into a big hall with lockers in **rows** (2 rows of 3 banks, +36 lockers, +40 key hooks). Needs the east annex |
| **Floor 1** | 7 | $1,500 | A staircase up from the south hall to a new storage floor: another 36 lockers and 40 hooks |
| **Floor 2** | 8 | $2,200 | Another staircase and storage floor on top: another 36 lockers and 40 hooks (150 lockers in total) |

New lockers, racks, labels and the board all appear in the shop. More lockers mean more customers can be inside at once.

**The labels** are the first step from memory to organisation: you no longer have to remember which key opens which
locker. **The register board** (in the storage room, on the wall facing the lockers) is the first piece of automation: it updates
itself as you store and collect bags, so you no longer have to remember who is where. But it only knows what you told it:
**if you didn't ask a customer's name when you took their bag, the board shows "name not taken"** (asking on the way back
doesn't fill it in).

**The south expansion and the floors** are the next phase of the building. The annexes spread the lockers sideways in banks along
the walls; the south hall grows the shop **backwards** with the lockers in rows (aisles between them), through a new doorway in the back
wall of the storage room, beside the first locker bank. Floors 1 and 2 are the same hall stacked on top, reached by two flights of
stairs along the east wall of the south hall (walk up from the south end and step off to the west at the top). The deposit register
flips through pages when it holds more than 42 bags.

**The annexes** are the first building expansion. Buying one knocks a doorway through the side wall of the storage room into
the neighbouring unit, and a new storage hall rises out of the ground with its own locker banks and key racks.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload (port 5173) |
| `npm test` | Simulation unit tests (Vitest) |
| `npm run typecheck` | `tsc -b` |
| `npm run lint` | Oxlint |
| `npm run build` | Type-check and production build into `dist/` |
| `npm run preview` | Serve the production build |

URL options: `?seed=123` gives repeatable customers and items. `?debug=1` exposes `window.__game` for testing
(see [AGENTS.md](AGENTS.md)).

## Project layout

```
src/
  sim/       Pure TypeScript simulation, no Three.js or React. GameManager (actions, dialogue,
             objectives), SimulationClock, CustomerScheduler, CustomerFactory, CustomerManager,
             LockerManager, KeyManager, EconomyManager, config, types, unit tests
  world/     Three.js views of the sim: Facility (building), LockerWall, KeyBoard, CustomerAgents,
             HeldView, InteractionManager (crosshair → action), procedural models, layout constants
  engine/    Engine (renderer, main loop, wiring), InputManager, PhysicsWorld (Rapier), debug flag
  player/    First-person character controller and camera
  store/     Zustand store: the HUD's read-only view of the game
  ui/        React HUD, dialogue panel, menus
  styles/    CSS
docs/        Design brief and roadmap
```

For architecture, conventions and how to work on the code (for people and AI agents), see
[AGENTS.md](AGENTS.md). Task guides live in [.claude/skills](.claude/skills).

The previous prototype in this repository ("Which One's My Key?") is preserved at the git tag
`which-ones-my-key`.
