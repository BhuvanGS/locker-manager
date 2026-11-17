---
name: facility-building
description: Change or expand Locker Manager's 3D facility — rooms, walls, counter, locker walls, key board, props, lighting, customer walking paths, held-item view, and procedural models for items and customers. Use for anything under src/world that adds or moves geometry.
---

# Facility building

All 3D lives in `src/world`. It **renders sim state, it never owns it**. Start by reading the floor-plan
diagram at the top of `layout.ts`.

## Building blocks

- `Facility.solid(w, h, d, material, x, y, z)` creates a mesh, a Rapier static collider and a reach blocker. Use it for
  walls, counters and furniture the player shouldn't walk through or reach through.
- `Facility.deco(...)` is visual only: floors, posters, small props.
- `Facility.sign(text, w, h, bg, fg)` makes a canvas-texture sign.
- `RegisterBoard` (storage room, on the partition facing the lockers, `REGISTER_BOARD` in `layout.ts`) draws the deposit register onto a canvas texture.
- `Annex` builds a storage hall next door; `Facility.setAnnexOpen(side, open)` cuts or closes the doorway. Side walls are built by `buildSideWall` with a removable `plug` panel.
- `setKeyLabel(keyMesh, n)` and `numberMaterial(n, 'door' | 'tag')` in `models.ts` draw locker numbers and key tags.
- `Facility.buildCatalogueDesk()` is the supplier catalogue desk (tagged `catalogue`).
- `models.ts` has `mat(color, roughness, metalness)` (cached, so always use it), `makeItemMesh(category, color)`,
  `makeKeyMesh()`, `makePerson(appearance)`, and `fitInto(obj, w, h, d)` to shrink anything to fit a slot.
- `interactables.ts`: `tag(mesh, {kind, ...})` makes something usable. `markBlocker(mesh)` stops reach through it.
  For small targets, tag an invisible proxy box (`new THREE.MeshBasicMaterial({ visible: false })`): raycasts
  still hit it.

## Rules

1. **Never block reach to an interactable with a blocker in front of it.** The first raycast hit wins. (Milestone 1
   bug: a solid locker carcass hid the compartments. Lockers are now hollow frames with only the back panel as a
   blocker.)
2. **Keep the customer path clear:** `CUSTOMER_PATH` street → `outsideDoor` → `insideDoor` → `counterSpots`. Agents
   walk straight lines with no collision.
3. **Staff and customer areas:** customers stay on the lobby side (`z > COUNTER.z`). The player works behind the
   counter and in the storage room.
4. **Reach** is `REACH.default` (2.4 m) for objects and `REACH.customer` (3.2 m) across the counter.
5. **Lighting:** the hemisphere light plus ceiling `PointLight`s (no shadows) inside, and one shadow-casting sun outside.
   Each new room needs a ceiling light and a visible fixture.
6. **Scale:** don't render stored items for lockers you can't see once storage grows. `LockerWall` only builds an
   item mesh when `locker.itemId` changes. For hundreds of lockers, switch doors and frames to `InstancedMesh`
   (one per part) and keep per-locker state in arrays.

## Recipes

### Locker banks and key racks (done)

Banks and racks are views of the sim. `LockerWall(game, physics, bank)` draws one bank at `LOCKER_BANKS[bank].centerX` and only
updates lockers whose `bank` matches. `KeyRack(index, hooksPerRack)` draws one rack at `KEY_RACKS[index].x` and owns hooks
`index·hooksPerRack …`. `Engine` creates them on `upgradeBought` (with `appear()` animations: banks rise out of the floor,
racks pop onto the wall), and adds their roots to the shared `interactionTargets` array so the crosshair can use them.
A new game removes them (`removeBuiltFurniture`: scene, targets, geometry and the physics body via `PhysicsWorld.removeBody`).

### Annexes (building expansion, done)

An annex is: a removable wall panel (`plugs`) + the neighbour's back half (`neighbourBack`) in `Facility`, a hall in `Annex`, and
banks and racks placed by the Engine from `ANNEX[side]` in `layout.ts`. To add another expansion, add a footprint and doorway in
`layout.ts`, make the matching wall panel removable the same way, and add a catalogue entry (`kind: 'annex'`, `side`, `banks`, `racks`).
Racks on a wall that faces −z need `rotY: Math.PI` (see `ANNEX_RACK`). Remember `LockerWall` takes its `centerX` explicitly, and that every
new collider must be removable (`PhysicsWorld.removeBody`) so a new game can wall everything back up.

### South hall and floors

`Hall(kind, physics)` builds one hall (walls, ceiling slab with a hatch, fixtures, signs) at `level × FLOOR_HEIGHT`; `Stairs(flight, physics)` builds a flight and its
guard rails. Constants (`SOUTH`, `STAIRS`, `stairHole`, `FLOOR_HEIGHT`) are in `layout.ts` and checked by `layout.test.ts`: change a number there and run the
tests. Keep these true: steps ≤ 0.38 m (auto-step) with a tread ≥ 0.2 m; the stairs rise exactly one `FLOOR_HEIGHT`; the stairwell hole is covered by the hatch until
the floor above exists; every collider is removable (`PhysicsWorld.removeBody`). Tag anything new in a zone with `root.userData.zone`.

### Add a room

Extend `ROOM` / add a new bounds constant in `layout.ts`. Cut a doorway in the right wall (split it into `solid()`
segments around the gap, as `buildStaffArea()` does), add floor, ceiling and light, and update the layout diagram comment.

### New item category or model

Add it to `ItemCategory` (sim) and `ITEM_NAMES` in `CustomerFactory`, then add a `case` in `makeItemMesh`. Keep the
origin at the bottom centre and the size under about 0.8 m, or rely on `fitInto`.

## Verify

`npm run typecheck && npm run lint`, then the `playtest` skill: screenshot the changed area and run the full-cycle
script to make sure reach and paths still work.
