# Models

The props (boxes, power boxes, plants, chairs, desks, benches, bins, hydrants, buoys…) are the game's own blocky models, built in code
(`src/world/blockyProps.ts`, `src/world/streetFurniture.ts`); the Poly Haven models they replaced have been removed.

## Kenney (`kenney/`)

Low-poly kits by [Kenney](https://kenney.nl), CC0 (public domain): each folder holds the kit's `.glb` models and its shared
`Textures/colormap.png`. Loaded with `kenney()` in `src/world/kenney.ts`.

| Folder | Kit | Used for |
| --- | --- | --- |
| `cars` | Car Kit | traffic on the main street, the VIP's SUV, the police car |
| `boats` | Watercraft Kit | rowing boats, sailing boats and motorboats at the harbour |
| `city` | City Kit (Commercial) | the shops and offices across the street, the towers behind them |
| `street` | City Kit (Roads) | the curved street lamps |

People are not downloaded: they are built in code (`src/world/people.ts`).
