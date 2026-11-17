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
| `Space` | Jump (about 0.9 m) |
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
| **Digital lockers** | 4 | $450 | **Digitalisation:** the keys go. Every locker locks itself electronically when you shut the door, an LED shows free/occupied, and the key racks become status screens (green free, red occupied). Needs the register |
| Storage annex (east) | 5 | $600 | **Building expansion:** knock through into the unit next door: a new hall with +12 lockers and +16 key hooks (needs bank C) |
| **Conveyor & robot arm** | 5 | $900 | **Automation, level 1:** replaces the west annex (there is no west storage annex). Belts run from the staff area through the partition to the storage room, and a robot arm files bags for you. Needs the digital lockers. Further levels are bought at consoles (see below) |
| **South expansion** | 6 | $900 | Extend the storage room **backwards**: a doorway through the back wall into a big hall with lockers in **rows** (2 rows of 3 banks, +36 lockers, +40 key hooks). Needs the east annex |
| **Floor 1** | 7 | $1,500 | A staircase up from the south hall to a new storage floor with **three rows** (+54 lockers, +40 hooks): it makes up for the west annex |
| **Floor 2** | 8 | $2,200 | Another staircase and storage floor on top: another 36 lockers and 40 hooks (156 lockers in total) |

New lockers, racks, labels and the board all appear in the shop. More lockers mean more customers can be inside at once.

**The labels** are the first step from memory to organisation: you no longer have to remember which key opens which
locker. **The register board** (in the storage room, on the wall facing the lockers) is the first piece of automation: it updates
itself as you store and collect bags, so you no longer have to remember who is where. But it only knows what you told it:
**if you didn't ask a customer's name when you took their bag, the board shows "name not taken"** (asking on the way back
doesn't fill it in).

**The south expansion and the floors** are the next phase of the building. The annexes spread the lockers sideways in banks along
the walls; the south hall grows the shop **backwards** with the lockers in rows (aisles between them), through a new doorway in the back
wall of the storage room, beside the first locker bank. Floors 1 and 2 are the same hall stacked on top, reached by two flights of
stairs along the east wall of the south hall (walk up from the south end and step straight off onto a landing at the top; the halls have windows). The deposit register
flips through pages when it holds more than 42 bags. Floor 1 has an extra (third) row of lockers.

**Digital lockers** end the key game: shut a locker's door and it locks itself; staff open any locker with `E`, so the thing to
remember is now *which locker*, and that is what the register board and the screens are for. Each status screen sits on top of its
bank, laid out like the bank (top row on top), and every door has an LED (green free, red occupied, amber reserved by the robot).

**The conveyor and robot arm** change your job from carrying to feeding and fetching. Take the bag from the customer, walk to the
**LOAD** belt (staff area, left of the counter) and press `E`: the belt carries it through the partition, and the single robot arm
picks it up, rides its gantry rail to the lowest free locker, opens the door, places the bag and shuts it (about 10 s in all, so a
busy shop makes bags queue). When the customer is back, use the **terminal** next to the belts, pick the bag from the list (locker,
item, and the name if you asked), and the arm fetches it onto the return belt; take it from the **COLLECT** tray and hand it over.
You still have to choose the right bag: hand over the wrong one and it is a wrong package. The arm serves the three storage-room
banks (18 lockers); the other halls are still filled by hand (the lockers work the same, just without keys).

**Conveyor levels and arm upgrades are bought where they happen, not in the catalogue.** Walk up to the **control hub** console in the staff
area (next to the terminal) to extend the belts to the **East annex** ($700), **South hall** ($1,000), **Floor 1** ($1,400) and **Floor 2**
($1,800), in that order and once you own the hall. A bag for a hall rides the belt to the end and goes through a service duct (4 to 10 s). In the tall halls (South hall, Floors 1 and 2) the ducts
drop it onto the belts of a **bay** at the back of the hall; the hall's arm picks it up there and rides an overhead runway along the corridor to
the rail of whichever row the locker is in (rows further in take a little longer). The East annex has two ducts in the gap between its banks. Each
part of the building has an **arm console** (in the halls, in the north-west corner by the window, next to a wall **occupancy board** that shows every locker of the hall as green or red), where you buy **arm motors** (levels 1–3,
up to 2.3× faster) and a **second arm** for the whole hall (two bags at once). Bags are
filed in the lowest free locker the belts reach, so the storage room fills first. The terminal lists every stored bag with where it is.

**Names, cars, warehouse, counter arm.** Every customer has their **name floating over their head**. When a VIP offer appears, the VIP's **black car pulls up** in the
street outside the office (with a VIP plate over it), the VIP gets out and **walks in** through the shop and the lobby to the deal office, and sits down at the desk; when the meeting
is over they walk back out to the car and it drives off.
The **Warehouse** (level 8, $2,500, needs the south expansion) is a big steel shed built right against the **east wall of the south hall** (the hall's door opens straight into it): two long pallet racks along
a wide cross aisle (24 crate slots), a notice board, and **three loading docks** in the east wall. Trucks have their **own truck yard**: they come down the service road, turn in, drive down the yard and **back into a
dock**, and leave by the yard's exit; the dock's roller door rolls up for them (and when you walk up to it). **Kei truckers** come now and then with 2 to 5 crates; **VIP deals** you signed are delivered in box-truck
loads of up to 10 crates. While a truck is at its dock, **you carry the crates in by hand**, one at a time: press E on the truck to take a crate, then E on a rack (or in the right room) to put it there. When the owner
comes back, their truck docks again and you carry their crates out to it: E on the rack to take one of theirs, E on their truck to load it; with the last crate they pay and drive off. With every dock taken the next
truck waits on the road, and a driver nobody unloads gives up after three minutes and leaves with what is still on board (a little reputation lost). The **counter arm** (hub console, $1,800, level 8, needs the second arm in the storage room) is the last step of automation: a robot arm on a rail
over the counter takes each customer's bag from their hand onto the belt, and when they come back fetches their bag and hands it over, paying you, with no help from you. It serves one customer at a time,
oldest first, and leaves you alone if you start talking to the customer first. What is left for you: upgrades, maintenance, the VIPs and the warehouse.

**The warehouse game.** The warehouse is where the real management begins. Every load is one of five **cargo types**: *general goods*, *food*, *cold chain*, *special metals* or
*contraband*. At the **receiving desk** you see every parked load: pick one and press **1** to open a crate and see what is
really inside (a few seconds), or **2** to send the load back (only before you have unloaded any of it). Each load says where it belongs. What a load *looks like* is what the driver
declares, and contraband is always declared as general goods, so you cannot tell by looking: open it, or buy the scanner. Where things go matters. **Food** goes off after four minutes. **Cold-chain**
goods spoil in 90 seconds anywhere but the **cold room**. **Special metals** are stolen from the open shelves unless they are in the **vault**. **Contraband** pays $110 a crate, but the **police** come
now and then once the warehouse holds 16 or more crates (rarely: every five to ten minutes) and they always find contraband in the open, fine you $150 a crate and seize it. In the **hidden
compartments** (the hidden room) it is found only 40 % of the time (20 % with deeper hiding), and special metals without the **special goods licence** earn a $300 fine. Spoiled goods earn nothing, a load that does not fit is
sent back, and crates are paid by what is in them when their owner collects: general $14, food $16, cold $26, special metals $55, contraband $110 a crate (a VIP's load earns 70 % of that, on top of the retainer).
All the **warehouse upgrades** are bought at the **warehouse office console** inside the shed, by the west door: two **rack rows** (+12 shelf slots each), the **cold room** (12 slots on its own racks), the
**vault** (8), the **special goods licence**, the **scanner arch**, the **hidden room** (8 slots, 12 with deeper hiding), and the **warehouse robots**: yellow wheeled robots with a telescoping arm and a big
clamp that drive the painted yellow lanes from their charging spots to the docks and the racks, one crate at a time (20 s a crate; the second upgrade adds a second robot and makes both faster). They carry deliveries in,
collections out, finish loads you started, and with the scanner they send contraband back, or hide it if there is room; you can still carry crates yourself alongside them. Which is the game: the manual desk first, then the robots, and every shortcut has a risk.

**The deal office** (level 6, $1,200, needs the conveyor) is the road to the warehouse. It is a glass office east of the lobby. Once your reputation is
55 or more, a **VIP** (parody names: Beff Jezoz, Elan Husk, Marc Zuckerburger, Bill Gaytes, Tim Cookie, Oprah Windfree) turns up and waits at the desk for a couple of
minutes with an offer: so many crates of something, and a retainer paid when you sign. Aim at the desk and press `E`: **sign** (retainer, XP and a little reputation),
**push for more money** (the retainer goes up 25 %, or they walk out and you lose a little reputation) or **decline**. Better reputations bring bigger deals. A wall board counts
the deals you have signed. The crates themselves arrive when the warehouse opens (next phase), so for now a deal is a retainer and a promise.

**Customers and bags (the rules that keep the shop honest).** Every bag in the shop looks different, so a customer can always tell which is theirs. Load a
bag on the belt and the customer **leaves at once** (the belt does the "it is stored" step for you); with hand-stored bags you still tell them, and one who
has waited too long for that leaves on their own, annoyed. If something goes wrong in a deposit you can **give their bag back** (they go, and you lose a little
reputation). **Rummaging costs:** pulling a bag out of a locker that nobody waiting is here for makes every waiting customer less happy, so know which locker
is theirs (or use the register and terminal). The robot arm owns a locker while it works on it: you cannot open, shut, fill or empty it. A big queue spreads out
across the lobby (up to 19 people) instead of piling up on one spot.

**Routine maintenance.** Robot arms wear out. Every job costs an arm 3 % (more with faster motors); below 60 % it works 25 % slower, and below 25 % it
can **jam** as it starts a job and stops until you fix it (a warning appears and your objective points at it). At the zone's arm console, **Routine
service** puts every arm back to 100 % (cheap, by how worn they are) and **Repair** frees a jammed arm ($80 each) but leaves it half-fit, so service it
soon. Waiting for a jam to happen costs far more in stuck customers than a service does. The console screen and the arm's lamp (green at rest, amber at
work, red when jammed) show the state.

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
