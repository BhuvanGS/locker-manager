# Which One's My Key?

A small first-person browser game. You come home after a long night, locked out. Last night you hid
the house key inside a fake rock somewhere in your front gravel lawn, and took a photo of it to help.
The photo doesn't help much: there are 5,200 stones, and they all look alike.

Find the pink fake rock, flip it over to get the key, and open the front door. Do it before the
neighbours get suspicious enough to call the police.

Built with **Three.js** (rendering), **Rapier** (physics), **React** (HUD and menus) and **Zustand** (state),
bundled with **Vite**.

## Play

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173 and press **Start searching**. Click the view once to capture the mouse.

### Controls

| Key | Action |
| --- | --- |
| `W A S D` / arrows | Move |
| `Shift` | Sprint |
| `C` | Crouch |
| Mouse | Look (the centre crosshair and a ground ring show which rock you are aiming at) |
| Left click | Pick up a rock / drop it / use the front door |
| Right mouse drag | Turn the held rock to check its underside |
| `F` / `E` | Try to open the held rock |
| `G` | Greet the neighbour or officer you are facing |
| `X` | Explain that you are locked out |
| `I` | Phone (the gallery has last night's photo of the rock) |
| `Esc` | Pause |

### Neighbours and police

- Neighbours notice what they can see: walking on the gravel, picking up rocks, crawling around, and
  hanging around their property. Houses and fences block their view.
- Walk up to someone (about 4.5 m away) to talk. The dialogue box shows the conversation and what
  `G` and `X` will say. Explaining once calms people down. Repeating yourself makes them more suspicious.
- If someone gets suspicious enough, they call the police. The officer walks over and asks if this is
  your house. Press `X` to explain, and you get 60 seconds to open the front door (25 if you already
  have the key). If you dodge the question, ignore it, or leave the property, you get arrested.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload on port 5173 |
| `npm run build` | Type-check (`tsc -b`) and production build into `dist/` |
| `npm run typecheck` | Type-check only |
| `npm run lint` | Oxlint |
| `npm run preview` | Serve the production build |

### URL options

- `?seed=1234` gives the same gravel layout, fake-rock position and tree placement every time.
- `?debug=1` turns on the debug panel and exposes `window.__game` (teleport, look, engine internals) for
  testing. You can also turn it on with `localStorage.setItem('wmk-debug', '1')`.

## Project layout

```
src/
  main.tsx, App.tsx    React entry and which screen to show for each game phase
  engine/              Game loop (Engine), input, Rapier physics wrapper, debug helpers
  world/               The neighbourhood: ground, street, houses, props, trees (Neighbourhood.ts),
                       sky, sun, clouds and lights (sky.ts), shared constants
  gravel/              The 5,200-stone lawn (instanced), picking and inspecting rocks, stone data
  npcs/                Neighbours and police: NeighbourDirector (behaviour, dialogue, police flow),
                       shared types, speech bubbles, 3D models, line-of-sight checks
  player/              Character controller and first-person camera
  store/               Zustand store: the bridge between the engine and the React HUD
  ui/                  HUD, menus, phone, results screen, debug overlay
  lib/                 Small shared helpers (seeded random)
  styles/              Global and app CSS
```

For how the code is put together and how to work on it (for people and AI agents), see
[AGENTS.md](AGENTS.md). Task-specific guides live in [.claude/skills](.claude/skills).
