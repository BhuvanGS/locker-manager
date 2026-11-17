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

### Add a second locker wall (storage expansion, Milestone 4)

Make `LockerWall` take a placement (origin, facing, rows/cols, locker id range) so it can be instantiated per wall.
Add the new lockers in the sim first (`LockerManager` needs an `addWall(...)`, and keys and hooks to match), then
construct a second `LockerWall` in `Engine.init` and add its root to the interaction targets list.
Make it *appear* when purchased (brief §12): build it hidden or under construction, and reveal it on the upgrade.

### Add a room

Extend `ROOM` / add a new bounds constant in `layout.ts`. Cut a doorway in the right wall (split it into `solid()`
segments around the gap, as `buildStaffArea()` does), add floor, ceiling and light, and update the layout diagram comment.

### New item category or model

Add it to `ItemCategory` (sim) and `ITEM_NAMES` in `CustomerFactory`, then add a `case` in `makeItemMesh`. Keep the
origin at the bottom centre and the size under about 0.8 m, or rely on `fitInto`.

## Verify

`npm run typecheck && npm run lint`, then the `playtest` skill: screenshot the changed area and run the full-cycle
script to make sure reach and paths still work.
