# Handoff — 2026-08-11, Stage 2 (INTRO), V-0/V-1/V-3 landed

## THE BAKE WAS NEVER SLOW — READ THIS FIRST

The ">13 minute" maze bake, blocker of V-0 and therefore of the intro, **was a
browser defect and not a painting cost.** Playwright's bundled Chromium on this
box hangs on the FIRST raster op of any canvas:

```
evaluate 1+1          2         (4 ms)     ← the renderer is alive
createElement canvas  {w:64}    (3 ms)
getContext("2d")      {ok:true} (1 ms)
ONE fillRect          TIMEOUT              ← and here it stops, forever
```

No crash, no page error, no renderer CPU. It reproduces with
`--use-gl=swiftshader`, with no `--use-gl` flag, with `--disable-gpu`, with
`willReadFrequently: true`, and on `OffscreenCanvas`. All three suspects this
page listed — `fillStyle` re-parsed in a 262k loop, `toDataURL` on software GL,
a canvas scale ≠ 1 — were wrong, and the same 262k-`fillRect` loop runs on the
HOST's Chrome in **60 ms**.

`card-harness.open()` now runs on host Chrome, which fixes the bake and the
other **thirteen** canvas harnesses that were dead the same way.
`PK_HARNESS_BROWSER=bundled` forces the old path.

| | |
|---|---|
| whole 4-biome bake | **5.1 s**, 36 PNGs → `assets/maze/` |
| one biome, per surface | 95.6 ms (`legacy/scripts/bake-profile.mjs`) |
| determinism | two full bakes, `sha256sum` over all 36 identical |

**V-1 shipped on top of it**: `crate::maze_art` embeds the bake and
`dungeon_render` paints with it — floor, four wall variants, dressed caps, plus
the height-field normal maps. **V-3 with it**: `SURFACE_ALBEDO_LUMA` is
re-derived from the baked pixels (0.055 → 0.0674) by a test that prints the
table and fails if a re-bake moves it.

Second defect found on the way: `open()` waited for `window.__ready` and the
bake raises `window.__out`, so it could not have completed even with a working
browser. `ready`/`timeout` are options now, defaulted to the old values.

---

# Handoff — 2026-08-11, Stage 2 (INTRO) under way

Read [build-out](build-out.md) first: it is the queue and the reasoning, and
[the 1:1 plan](one-to-one.md) for what "converted" means and how far off it is.
This page is the state of the baton.

## THE ORDER IS BY SCENE NOW — INTRO → TAVERN → MAZE

Set by the user on 2026-08-11 and it overrides the track order the 1:1 plan
had derived: *"in order finish the intro > finish the tavern > then work on
the maze last… we should have finished making the intro accurate with the
textures first so we know what order of operations of how to build 1:1 for
the rest."* Each scene is finished 1:1 — art, UI and behaviour — and signed
off by an A/B sheet before the next one starts. See
[one-to-one](one-to-one.md) §5.6-5.7.

**It has already paid for itself.** Finishing the smallest scene first turned
up four defects that were all invisible from the track view, and one coupling
that changes the schedule: the intro's title maze is built through the REAL
`buildMaze`, so **the intro is blocked on the same texture bake as the
dungeon** (V-0). The bake is not a late-stage art item; it is on the critical
path of the FIRST scene.

## Stage 2 — the intro, so far

| | |
|---|---|
| the gate | `scripts/pk-ab-intro.mjs` — did not exist; one frame per phase per side, frozen |
| light rig | `dungeon_light::install_intro` — the intro spawned NO lights at all |
| chrome | `pk_gui::screens::intro` — the title was three Bevy `Text` nodes and there was no SKIP button |
| fonts | `Fonts::derive_missing_zoom_sizes` — size 32 at zoom 3 wants a 96px atlas that was never baked, and missing-atlas text draws NOTHING, silently |

**Frozen A/B, both sides** (`node scripts/pk-ab-intro.mjs --no-build`):

⚠️ **THE RIG WAS FIXED AFTER V-1, SO DO NOT COMPARE ACROSS THE LINE BELOW.**
Every number taken before the fix was partly describing the harness.

**The current baseline — fixed rig, both sides genuinely frozen:**

| phase | diff mean | p95 | over32 | median luma L/R |
|---|---:|---:|---:|---|
| run | 17.2 | 150 | 12.0% | 166 / 163 |
| bonk | 16.9 | 141 | 13.7% | 171 / 165 |
| **shatter** | **56.7** | 118 | 71.3% | **10 / 51** ← the largest real gap in the intro |
| sweep | 25.0 | 73 | 39.7% | 40 / 41 |
| title | **13.5** | 37 | 14.7% | 10 / 11 |

### What the rig fix was, and why the old numbers were fiction

The virtual clock advances one 1/60 s step per REAL rAF callback, and
`shootPhase` waited a fixed 1.2 s and then photographed whatever was on screen.
On a loaded box the clock had not reached its target offset by then, so **the
oracle was shot EARLIER in the phase than the port** — while both captions said
"frozen". That is the shutter-outlives-the-phase failure the freeze seam exists
to remove, reintroduced one level up.

Two consecutive pre-fix runs gave shatter 88.9 then 58.4, with the oracle's
median luma 119 then 10. `sweep` moved too, 23 → 40 on the oracle side, which
means its pre-fix 19.2 was also partly an artefact.

`shootPhase` now POLLS `__abFrozen()` until it is true (30 s budget) and
**throws rather than shooting** if it never is. A refused run costs a re-run; a
shot one costs a number that gets written into a status page.

### The gap this uncovered — `shatter` is genuinely wrong

With both sides truly at t+0.45 s the sheet is unambiguous, and it is not a
lighting or texture difference. **The oracle's 2D world has already collapsed
into a thin horizontal band on a black screen; ours is still very nearly
intact**, filling the frame with shards. Our shatter progresses far too slowly,
and the knight plus its echo trail is drawn much larger than the oracle's.

That is the next intro item, and it is now measurable. It also subsumes the
"ball scale" note below: the oracle's actor at this instant is small and single,
ours is large and triple.

### What is still open on the intro, in order of pixel impact

1. ~~**The maze textures**~~ ✅ **DONE 2026-08-11 (V-0 + V-1).** The title maze
   is built through the real `buildMaze`, so the bake unblocked it. Still
   missing on it: torches, banners and decor (V-4) — the oracle's title maze
   has lit sconces along the top wall and ours has none, which is most of the
   remaining brightness gap.
2. **The ball.** The oracle draws a small sprite with a white ricochet ring;
   the port draws a large knight and no ring. `SPRITE_UNITS = 1.5` against the
   port's `quad_h = 1.15` — but the port's reads BIGGER on the sheet, so this
   is not simply the quad and wants measuring, not adjusting.
3. **Camera framing during shatter/sweep.** The two frustums agree at 16:9
   (both 20 × 11.25) and the port's `1/zoom` is right, yet our maze renders
   ~22% taller at the same width — which is a tilt or a geometry-height
   difference, NOT a zoom one. Measure before touching.

⚠️ **The rig freezes the sequence, and that is what makes it a measurement.**
A CDP screenshot takes 0.6-1.3 s and `bonk` lasts 0.35 s. Shooting "when the
phase appears" gave a `run` diff of 14.5, then 21.7, then 37.0 across three
runs with that phase's art untouched. The port freezes on
`?intro-freeze=<phase>:<t>`; the ORACLE is frozen from the harness by a
virtual rAF clock, so `legacy/` needs no seam — which also means the gate
works before a merge instead of after one.

## Stage 1b — the authored floor IS the dungeon

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

1. ~~**V1 textures**~~ ✅ **DONE 2026-08-11.** `crate::maze_art` embeds the bake;
   `dungeon_render` paints the floor, the four wall variants and the dressed
   caps with it, plus the height-field normal maps. `pk-ab-dungeon --level 3
   --seed 1`: diff mean 32.0 → **30.2**, over32 36.2% → **33.8%**.
   ⚠️ **The face split is the part to know about.** The oracle gives every wall
   box six materials (`[face, face, cap, cap, face, face]`, `build.ts:1425`) and
   a merged bucket carries one, so `split_faces` partitions each bucket's
   triangles BY NORMAL and every bucket spawns two entities. `batched_entities()`
   doubled with it, and the demo floor's batching-worth assertion went 20× → 10×
   — the same claim against a new denominator, not a weakened one.
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
5. ~~**`SURFACE_ALBEDO_LUMA` is calibrated on placeholder albedos**~~ ✅ **DONE
   2026-08-11 (V-3).** Re-derived from the baked pixels: **0.055 → 0.0674**,
   measured by `maze_art::mean_linear_luma` over all four biomes, and a test now
   prints the table and fails if a re-bake moves it. It caught the stale value
   on its first run, which is the argument for it not being a comment.
   **The real art inverts the placeholder's relationship** — the greys had the
   wall seven times brighter than the floor; the bake has the FLOOR brighter in
   every biome, because flagstone catches the light and coursed masonry is
   mostly mortar shadow. Two guesses would not have converged on that.

## ~~Half-done, with a measurement attached~~ ✅ CLOSED — see the top of this page

**The maze texture bake completes in 5.1 seconds.** It was never slow; the
harness browser could not rasterise. The full account, the three wrong
suspects, and the numbers are at the top of this page.

The standing rule survives intact and is worth restating because the pressure
to break it was the whole point of the investigation: **do not "fix" anything
here by transcribing the painters into Rust.** They are ~700 lines of
Skia-dependent Canvas2D and a second implementation is a permanent parity
liability (`docs/src/art/bake.md`). Two handed-in blueprints proposed exactly
that as the fix for this "performance problem", and the performance problem did
not exist.

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
node scripts/pk-ab-intro.mjs --no-build                        # the INTRO's gate (Stage 2)
node scripts/pk-ab-dungeon.mjs --no-build --level 3 --seed 1   # the gate for all visual work
node scripts/pk-check.mjs --no-build                            # the flow gates
node scripts/pk-check.mjs --no-build --real-floor               # the generated-floor gates
cd legacy && npm run dev                                        # :5174, the oracle the rig needs
RUN_EXPORT=1 npx vitest run src/game/pinball-knight/port-floor-export.test.ts

bash scripts/pk-drift.sh ../braindeadbot-client   # D-1: has the ORACLE rotted?
bash scripts/pk-coverage.sh                       # C-1: how much of legacy has no counterpart
cd legacy && node scripts/bake-maze-textures.mjs --sheet /tmp/m.png   # re-bake the stone (5 s)
cd legacy && node scripts/bake-profile.mjs                            # per-surface bake timings
```

⚠️ Every browser-driven line above wants a core slot on this shared box —
prefix it with `legacy/scripts/ops/pk-run.sh --class webgpu --` rather than
running it bare.

The A/B sheet lands at `.checks/ab-dungeon-L3-s1.png`. **Look at it.** It is the
only honest answer to "does the dungeon look right", and until this week the
project did not have one.
