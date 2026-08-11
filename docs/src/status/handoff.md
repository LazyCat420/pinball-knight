# Handoff — 2026-08-11, Stage 1b shipped

Read [build-out](build-out.md) first: it is the queue and the reasoning, and
[the 1:1 plan](one-to-one.md) for what "converted" means and how far off it is.
This page is the state of the baton.

## What just landed — the authored floor IS the dungeon

`crates/pk-game/src/authored_floor.rs` loads the oracle's exported floors and
they are now the DEFAULT source of a descend. The dungeon has torches, boosters,
bumpers, props, items and real stairs on it, in the tiles `decorateMaze` chose,
lit by a light rig that did not exist this morning.

| | |
|---|---|
| loader | `crates/pk-game/src/authored_floor.rs` (17 tests) |
| contents | `crates/pk-game/src/authored_render.rs` — torches, the 6-light pool, parts/props/items |
| light rig | `crates/pk-game/src/dungeon_light.rs` — port of `boot/lighting.ts` |
| unit conversions | `crates/pk-game/src/units.rs` — `PL`, `EXPOSURE_RECIP`, `c()`, `billboard()`, moved out of `tavern.rs` so both scenes share one derivation |
| the flag | authored by default; `--rust-floor` / `?rust-floor=1` selects the generator |
| the evidence | `pk-ab-dungeon` diff mean 43.1 → 33.1, over32 58.3% → 39.1%, our median luma 23.2 → 40.6 against the oracle's 40.7 |

**Read [one-to-one](one-to-one.md) §5 Stage 1b for the five findings** — the
`unlit: true` materials that would have made the torches a no-op, the three
payload fields whose shape was wrong, and why the floor being too dark was an
ALBEDO error and not a lighting one.

## THE NEXT THING TO BUILD

1. **V1 textures** (`maze/build.ts:356-670`). The stone is now the right FAMILY
   (the biome remap is ported); it is still one flat colour per bucket where the
   oracle has flagstone, moss, cracks and a normal map. This is the largest
   remaining visible gap and the A/B rig grades it directly. It is blocked on
   the maze-texture bake, which is the half-done item below.
2. ~~**`surface-paint.ts`**~~ ✅ **DONE 2026-08-11.** `grid.surfaces` is
   exported, loaded and washed (`dungeon_render::spawn_surface_wash`), and it
   was a PHYSICS gap as well as a visual one — `pk_core::pinball` reads
   `surface_at` for friction and steering, so before this every tile answered
   "stone" and a ball crossing the oracle's sand kept stone friction. L3-s1
   carries 624 sand, 440 steel and 462 flowstone floor tiles plus 455 mud
   walls. diff mean 33.1 → 32.0, over32 39.1% → 36.2%.
   ⚠️ **Two vocabularies share the byte**: a walkable tile carries a `FLOOR_*`
   id and a solid one a `WALL_*` id, so `wash_buckets` branches on walkability
   before reading it. What is still unported: the WALL wash (legacy tints wall
   instances with their surface colour) and the four grain textures — the flat
   quad here is what the oracle's own painter header calls "a spilled bucket of
   blue", and the grain lands with the V1 bake.
3. ~~**Monsters**~~ ⚠️ **THEY STAND, THEY DO NOT LIVE** (2026-08-11). One
   zombie billboard per `plan.spawns` tile, 52-105 a floor, as ONE merged mesh
   (`authored_render::spawn_standing_horde`). No AI, no flow-field, no combat,
   no death — P4 is `entities/` + `spawn/factory.ts` + the nine
   `Record<EnemyKind, X>` registries and none of it is ported.
   **A finding for whoever does port it:** the A/B sheet cannot match on
   monsters until they MOVE. The oracle's zombies have walked off their spawn
   tiles by the time the shutter fires 4.5 s after load — that is why legacy's
   frame shows monsters beside the knight while ours shows none there, with the
   nearest spawn 21 BFS steps away on L3. Shoot L5 (`--level 5`) to see the
   horde: its spawns are dense enough to land in frame.
4. **The WALL wash.** `grid.surfaces` carries 455 mud, 89 brass and 74 rubber
   WALLS on L3 and only the floor half is painted. Legacy tints wall instances
   with `instanceColor`; here it wants the bucket key extended by surface id so
   each (shape, surface) pair gets its own tinted material.
5. **`SURFACE_ALBEDO_LUMA` is calibrated on placeholder albedos** and must be
   re-derived when V1 lands — `dungeon_light.rs` says so at the constant.

## Half-done, with a measurement attached


**The maze texture bake does not complete.** `legacy/scripts/bake-maze-textures.mjs`
and the `bakeMazeSurfaces()` / `__bakeParts` seams in `maze/build.ts` are
written and correct in shape. One biome exceeds **thirteen minutes** in the
harness browser, under `--use-gl=swiftshader` and `--disable-gpu` alike.

What is already ruled out: the import (115 ms, bisected against
`render/palette`, `engine/config`, `engine/collision` and `maze/generator`, all
~13 ms). So the cost is inside the painting, where the arithmetic says seconds:
the floor is 512×512 with a per-pixel `fillRect(x, y, 1, 1)`, ~262k draw calls,
plus a moss pass adding at most 230k.

Next step is a PROFILE with per-surface timings inside the page — `__bakeParts`
exists for exactly that. Suspects in order: `fillStyle` re-parsed from a CSS
string inside a 262k-iteration loop; `toDataURL` readback on a software-GL
surface; a canvas scale that is not 1 at this rung.

**Do not "fix" this by transcribing the painters into Rust.** They are ~700
lines of Skia-dependent Canvas2D and a second implementation is a permanent
parity liability — see `docs/src/art/bake.md`. The bake is the right shape; the
cost is what is unexplained.

## Traps this session paid for

- **A test can pin a defect.** `the_scene_camera_ends_up_pointed_at_the_lattice`
  asserted `FixedVertical` under the sentence "the dungeon keeps its own
  framing". It was describing the bug in language that sounded like a decision,
  and the dungeon was framed 1.7× too close for the life of the port.
- **The instrument outruns the renderer.** The A/B rig's first sheet was
  legacy's own loading card, because `state.level` is assigned before the floor
  is built. Any legacy readiness gate needs `floor-loading` off the GUI stack
  (`__gui().open`) as well.
- **`ResMut` marks changed on the DEREF.** A scene assigning an identical view
  every frame pins the dirty flag on forever; `gui::set_view` compares first.
  This cost half the tavern's frame rate and surfaced three files away as a
  browser gate walking into a wall.
- **A global layer must be closed by the scene that opened it.** The GUI stack
  outlives `TavernScene`, so `teardown_tavern` clears it — otherwise the tavern
  prompt renders over the dungeon.
- **Compare JSON to JSON.** A live object against a parsed file fails on
  `undefined`-vs-absent and reads as a non-deterministic generator.
- **The user plays the WINDOWS EXE.** `scripts/pk-win.sh build` after every
  merge, or the report you get back is against a stale binary. This happened
  twice in one day.

## How to see anything

```
node scripts/pk-ab-dungeon.mjs --no-build --level 3 --seed 1   # the gate for all visual work
node scripts/pk-check.mjs --no-build                            # the flow gates
node scripts/pk-check.mjs --no-build --real-floor               # the generated-floor gates
cd legacy && npm run dev                                        # :5174, the oracle the rig needs
RUN_EXPORT=1 npx vitest run src/game/pinball-knight/port-floor-export.test.ts
```

The A/B sheet lands at `.checks/ab-dungeon-L3-s1.png`. **Look at it.** It is the
only honest answer to "does the dungeon look right", and until this week the
project did not have one.
