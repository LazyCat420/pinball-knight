# Handoff — 2026-08-11, mid Stage 1

Read [build-out](build-out.md) first: it is the queue and the reasoning. This
page is the state of the baton — what is done, what is half-done, and the
facts that cost time to learn and are not visible in the code.

## The diagnosis this all turns on

The port spent a day getting nine of twenty-three generator passes bit-exact and
the screen never changed, because **the generator is the half nobody can see**.
Everything a player looks at is in the other half: `maze/build.ts` (1,834 lines
of Canvas2D painters), `maze/decorate.ts` (3,169 lines of content),
`gui/screens/tavern.ts` (607) and ~2.5k of economy tables.

Two decisions were taken with the user on 2026-08-11 and they order everything:

1. **Bit-exact is for the SIM only.** Digest harnesses and sabotage sweeps stay
   on physics/rng/generator, where a 1-ulp drift breaks replay. Content and art
   are verified visually against a rig.
2. **The TS game is a DATA SOURCE, not just an oracle.** Export finished floors;
   render them in Rust now; port the generator behind that later.

## Done and on `main`

| What | Where |
|---|---|
| Dungeon A/B rig | `scripts/pk-ab-dungeon.mjs` |
| Dungeon camera framing fix | `crates/pk-game/src/post/sizing.rs` |
| Authored-floor exporter + 3 floors | `legacy/src/game/pinball-knight/port-floor-export.test.ts`, `assets/floors/` |
| GUI shell + tavern menus (chrome only) | `crates/pk-game/src/gui.rs` |
| Generated floors by default, floor progression | `crates/pk-game/src/real_floor.rs` |

## THE NEXT THING TO BUILD — `crates/pk-game/src/authored_floor.rs`

The exports exist and nothing reads them yet. This is the whole of the visible
win and it is a day's work at most.

1. Add `serde = { workspace = true }` to `crates/pk-game/Cargo.toml` (the
   workspace already has it with `derive`; pk-game only has `serde_json`).
2. Deserialize `assets/floors/L{level}-s{seed}.json`. **`include_str!` them** —
   three files, ~180 KB total — so wasm and native load identically and a
   missing bake is a build error, exactly like `tavern_art.rs` does it.
3. Build a `pk_core::grid::Grid` from `grid`, and hand
   `floor_loading::prepare_floor` a `PreparedFloor`. Run
   `validate_runtime_floor` on it — an export that is not standable must fail
   the same way a generated floor does.
4. Make it the DEFAULT source in `real_floor::FloorPlan`, with `--rust-floor`
   for the self-generated one, and **put the source in the banner** so no
   screenshot is ever ambiguous.

### Facts about the payload, measured

- **Tile ids** in `grid.t`: `0` wall, `1` floor, `2` stairs, `3` cracked — the
  same constants as `pk_core::grid`.
- **Shape ids** in `grid.shapes` on L3 s1: 0 (5,059), 9 (156), 8 (26), 6 (20),
  7 (12), 5 (10), 1 (8), 2 (7). Shaped tiles are real and the renderer's
  slant/round buckets will fire immediately.
- **`grid.arcs` is populated** (40 features on L3 s1) and the field names match
  `pk_core::tile_shape::ArcFeature` except for case: `solidOut` → `solid_out`.
  Two mismatches to handle: Rust's `owner` is `Option<&'static str>` and the
  JSON carries an owned `String`; and Rust has `kicks`/`lanes` which the export
  does not carry (default them empty). **Pass 10 `publish-arcs` is what makes
  the renderer's arc bucket non-empty** — an authored floor gets there first.
- **`plan.parts[].kind`** on L3 s1: `boostcorner`, `boostcurve`, `booster`,
  `bumper`, `deflector`, `electric`, `firevent`, `jumppad`, `lamp`, `magstrip`,
  `pit`, `ramp`, `rollover`, `spinpad`, `target`, `trapdoor`. Each carries
  `i, j, dirI, dirJ, dir2I, dir2J` and sometimes `bank`/`seq`/`vault`/`circuit`.
- **`plan.props[].kind`**: `bones`, `rubble`, `skull` — keys into `PROP_PAINTS`.
- **`plan.torches`** are `{i, j, di, dj}` where `(di, dj)` points from the floor
  tile at the wall it mounts on.
- **`plan.items`** are `{kind: weapon|gear|potion, id, i, j, rarity}`.

### Render it in this order — biggest visible change first

Torches are the single largest one: the legacy dungeon is LIT BY THEM, and ours
has flat ambient. A sconce quad, a flame quad and a pooled `PointLight` per
torch changes the whole frame before a single texture is baked.

Then parts (the "boosters" in every report), then props, then items. Placeholder
geometry per kind is fine and correct at this stage — the A/B rig grades
POSITION and DENSITY now, and the baked art replaces the placeholders in Stage 2
without moving a call site.

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
