# Locker Manager

**From memory to automation.** A first-person 3D management game in the browser. You run a tiny
bag-storage shop. Customers leave their belongings with you and come back later. At first there's no
computer, no labels and no notebook, only six identical lockers and a board of identical keys, so you
have to remember who left what, where you put it, and which key opens it.

The long-term arc (see [docs/design-brief.md](docs/design-brief.md)): manual labour → organisation →
digitalisation → mechanisation → automation, growing from one suitcase to thousands of records.

**Status: Milestone 1 (core prototype) is complete.** One tutorial customer walks you through a full
deposit → two-minute wait → retrieval cycle. Progress is tracked in [docs/ROADMAP.md](docs/ROADMAP.md).

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
| `1`–`6` | Choose a dialogue option (or click it) |
| `Esc` | Pause. The shop clock stops while paused |

### How a customer works

1. A customer walks in and waits at the counter. Talk to them, greet them, ask their name, and accept their item.
2. Take it to the storage room, open an empty locker, put it in, and close the door.
3. Take the key out of the lock (this locks the locker) and hang it on any hook of the key board. **Remember which.**
4. Go back and tell them it's stored. They leave and come back later (the first customer: exactly two minutes).
5. When they return, take the right key, unlock their locker, take their item and hand it over. They pay the fee plus a tip.

The wrong key won't turn (you lose a moment fumbling). Handing someone the wrong item costs reputation.

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
