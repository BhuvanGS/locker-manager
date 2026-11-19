# Models

All from [Poly Haven](https://polyhaven.com/models), CC0 (public domain). Downloaded as 1K glTF; textures shrunk to 512 px.

| Folder | Used for |
| --- | --- |
| `potted_plant_02` | plants in the lobby and the office |
| `cardboard_box_01` | boxes on the storage room shelves |
| `korean_fire_extinguisher_01` | extinguishers by the storage doorway and the warehouse door |
| `modern_arm_chair_01` | the visitor's armchair in the deal office |
| `industrial_storage_cart` | the parts cart in the warehouse |
| `power_box_01` | electrical boxes in the storage room, the halls and the warehouse |

| `metal_office_desk` | the warehouse supervisor's desk |
| `desk_lamp_arm_01` | the lamp on that desk |
| `plastic_monobloc_chair_01` | the chair at that desk |
| `fire_hydrant` | hydrants along the main street |
| `metal_trash_can` | bins beside the street benches |
| `painted_wooden_bench` | benches on both pavements (passers-by sit on them) |
| `wooden_picnic_table` | picnic tables on the grass by the beach |
| `ocean_buoy` | buoys out at sea |

Placed with `prop()` in `src/world/props.ts`.

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
