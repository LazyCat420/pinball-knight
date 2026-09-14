# Map generation scaling — 2026-09-13

Connectivity repair repeatedly flooded the growing connected component, allocated
full-grid search buffers, and scanned every tile for each disconnected pocket.
A hard limit of 400 repairs also silently stranded larger floors. A 65×65
fixture with 1,024 isolated tiles leaves 623 tiles unreachable on main 11ba7ede.
The repaired algorithm connects them all and preserves the outer wall.

`maze/connectivity.ts` now labels the initial components once and incrementally
extends reachability across new corridors. A monotonic target scan preserves the
old row-major pocket selection. A reusable typed queue, parent array and visited
stamps replace array shifting and per-search allocation. It retains shortest-path
neighbour order, largest-component tie-breaking and the protected-wall fallback.
The floods are linear in grid area; shortest-path wall searches can still revisit
space, so the complete generator is not claimed to be linear.

The original `track-carve` export remains compatible. One hundred seeded masked
and unmasked fixtures match the old tiles byte for byte, as do all five existing
full-author fingerprints, including population RNG. Floors that reached the old 400-repair limit intentionally change as their
remaining pockets join. The ordinary level-size table is unchanged.

The complete suite identified one such floor in the existing census: L25/seed 1,
a 193×145 grid. A baseline-code probe still had 1,423 unreached tiles immediately
before its last permitted repair. Isolating the changes confirms the horde-field
rewrite preserves this fixture; uncapped connectivity changes it. The new finished
floor has zero unreachable tiles, zero piece violations, the same endpoints and
201-tile stairs route. Its ordinary floor count rises from 12,292 to 12,521;
99 arc tiles remain, and decoration changes from 333 to 331 parts. Only this
fixture's JSON/SVG was refreshed after the geometry gates passed. All twelve
census cases then passed. This is a reviewed layout correction, not a weakened
constraint or an unexplained snapshot reset.

## Measured generation time

Level 5, seed 777, shipped density. Node 26.1.0 on Linux/WSL, Ryzen 9 5900X.
One warmup per version followed by five alternating before/after runs; medians.
Raw observations are in `maze-scaling-benchmark.json`. These are local CPU
measurements, not browser frame-rate or GPU-memory measurements.

| Tiles | Dimension scale | Before | After | Reduction |
| ---: | ---: | ---: | ---: | ---: |
| 6,693 | 1× | 137 ms | 91 ms | 33% |
| 26,441 | 2× | 573 ms | 324 ms | 43% |
| 59,245 | 3× | 1,823 ms | 792 ms | 57% |
| 105,105 | 4× | 3,099 ms | 1,500 ms | 52% |

The 105,105-tile floor contains 46,133 walkable tiles and 1,004 pinball parts;
every walkable tile and the stairs are reachable. Generation includes full live
authoring, decoration, lamps and density repair. The benchmark also reports typed
grid-array bytes, explicitly excluding JS objects, renderer resources and GPU
allocations. Generation at this size does not certify smooth rendered gameplay.

## Gameplay pathfinding allocation

The horde previously copied a full-map distance array every update despite its
shared traversal scratch. `bfsDistancesOwned` now fills private storage directly;
`simulate` passes the previous owned field back to `hordeFlowField`. It reallocates
on a size change and never adopts the current shared scratch distance array.
Unrelated generation/path queries cannot overwrite the retained horde field.
At 105,105 tiles this avoids a 420,420-byte distance allocation each update
(about 1.68 MB/s at four updates per second). The BFS still visits the full
reachable map; regional activation is a future step, not part of this change.

Regression tests cover moving and wall-snapped seeds, map size changes, changed
walls, empty fields, reuse identity and intervening scratch queries.

## Continue growing maps

Run from `ThreeJS` with the repository's Linux Node/pnpm environment:

```sh
pnpm maze:scale
pnpm maze:scale --scales=1,2,4,6 --samples=3 --level=5 --seed=777
```

Scale multiplies each dimension: 2× dimensions is approximately 4× area.
The default sweep also includes approximately 2× area. Every output row includes
connectivity and stairs checks; the command fails if generation declines or a
floor is disconnected. It uses a temporary bundle and removes it on completion.
Permanent full-floor tests cover 1×, 2× and 4× dimensions with seed 777.

Next gates before increasing playable floor sizes: expand the multi-archetype,
multi-seed oversized corpus; profile browser build/upload and visible-frame cost;
then add regional renderer/physics/AI activation if those measurements require
it. Keep the authoring path and the deterministic corridor checks shared.

## Release status

This batch is for primary-branch publication. The existing deployment hold is
still in force, so no NAS release is included.
