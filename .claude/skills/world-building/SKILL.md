---
name: world-building
description: Add, move or restyle anything in the 3D neighbourhood of Which One's My Key? — houses, street props, cars, trees, hills, sky, sun, lighting. Covers collision, NPC line of sight, seeded placement and material reuse so new scenery doesn't break gameplay.
---

# World building

All scenery is procedural Three.js in `src/world/`:

- `Neighbourhood.ts` builds the ground, street, houses (`buildHouse`), props (`buildStreetProps`, `makeCar`), trees (`buildTrees`) and hills (`buildHills`).
- `sky.ts` builds the gradient sky dome, visible sun (`SUN_DIR`), clouds and the directional and hemisphere lights.
- `constants.ts` holds ground height values shared with the player.

The coordinate map is in AGENTS.md under "World coordinates". The player's lot is `|x| < 9.5, -11 < z < 13.5`.
The road runs along x at `z = 18`.

## Rules every addition must follow

1. **Collision.** If the player shouldn't walk through it, add `physics.addStaticBox(center, halfExtents)`
   (world space, half sizes). Small decorations (lamps, mailboxes, pickets) usually skip this.
2. **Line of sight.** If neighbours shouldn't see through it, push an `Occluder` (`{ center, half }`) to
   `this.occluderList` before `new NeighbourDirector(...)` runs in the constructor. `buildHouse()` does this for you.
3. **Seeded placement.** Use `mulberry32(seed ^ something)` from `src/lib/random.ts`, never `Math.random()`, so
   `?seed=` gives the same world every time.
4. **Shared materials.** Use `this.mat('key', { color, roughness, ... })`. The same key returns the same material.
   One-off textures (signs, canvas sprites) are disposed by `dispose()`.
5. **Shadows.** Set `castShadow` on things that stand up, and `receiveShadow` on ground-like surfaces. The sun's
   shadow camera covers ±34 m around `(0, 0, 6)`, so things further out won't get shadows.
6. **Keep gameplay space clear.** Don't put anything on the gravel lawn, the porch/door area, the residents'
   walk/mail/garden points (`NeighbourDirector` constructor) or the police route
   (`COP_PATH`: `(20,18) → (0,18) → (0,13.1)`, then on foot toward the player).
7. **Distance limits.** Camera far = 600, fog runs 60 → 300, sky dome radius 480. Keep scenery within about 450 m.

## Adding a house

Add a `HouseSpec` to the `homes` array in `buildNeighbourHouses()`:

```ts
{ x: 46, z: 27, w: 7.6, d: 6.4, h: 4.4, facing: -1, wall: 0xd8d0c0, roof: 0x4a3f3a, label: '1447', chimney: true }
```

- `facing: 1` means the front is at +z (our side of the street). `-1` means the front is at −z (across the street).
- Across-street houses start at `z ≥ 27` so their porch stays behind the far sidewalk.
- `buildHouse()` adds the gable roof, windows, door, house-number sign, collision and occluder. The porch and walkway are
  added by the loop.
- Make sure the ground covers it: the walkable ground box is 150 × 120 centred on `(0, 8)`. Past that there's only the
  visual far field (no collision, so the player would fall through).

## Trees

`buildTrees()` places street trees by hand, scatters around 70 using `blocked(x, z)` (which avoids the road band, our lot and
any occluder plus 1.8 m), then adds a far ring. If you add a new no-tree area, extend `blocked`.

## Sky, sun and light

Change `SUN_DIR` in `sky.ts` to move the visible sun and the light direction together. Keep the sun's elevation
above about 25° and to the side, so the player house doesn't shade the gravel. Sky colours are shader
uniforms. The fog colour in `engine/Engine.ts` should match the `horizon` uniform, or distant hills show a seam.

## Verify

1. `npm run typecheck && npm run lint`
2. Run the `playtest` skill. Screenshot from the spawn (`__game.teleport(0,5)`), from the street
   (`__game.teleport(0,20)`), and wherever you changed something. Check that NPCs still walk their routes and that the
   cop can still reach the lawn after calling them with `callCops`.
