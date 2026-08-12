# The route to 1:1 — what is left, in what order, and how each piece is known to be done

**2026-08-12 · baseline `main` @ `cd08d8e` · every number below was produced
today by a named command on this box.** This page is the standing answer to
*"what do we still have to do to convert Pinball Knight from
`braindeadbot-client` to this repo, 1:1?"* — [plan v3](port-plan-v3.md) is the
same queue with its full working shown; this page is the map above it and the
one to read first.

---

## 0. Every gate, re-run at this baseline

Re-measured end to end on 2026-08-12 against `cd08d8e`, on a quiet box
(load 0.48), release `web/dist`. This is the section to distrust first when a
later page disagrees with reality.

| Gate | Command | Result |
|---|---|---|
| the ledger | `cargo xtask coverage` | **24.0% converted** — 61,852 lines / 210 files not started, unchanged since `9344537` (the four commits since are fixes and docs) |
| workspace tests | `cargo test --workspace` | **877 passed, 0 failed, exit 0** |
| browser parity (**release** wasm) | `node scripts/pk-check.mjs --no-build` | **2 of 3 runs ALL GATES PASSED; 1 run failed one gate** — see I-8 |
| oracle drift | `bash scripts/pk-drift.sh ../braindeadbot-client` | clean — *over `src/` only*, I-2 still open |
| dungeon A/B | `pk-ab-dungeon --no-build --level 3 --seed 1` | mean **30.2**, p95 77, over32 **33.7%** — reproduces 30.2 / 33.8 |
| intro A/B | `pk-ab-intro --no-build` | run 15.4 · bonk 19.4 · **shatter 56.7** · sweep 25.9 · title 13.3 |
| tavern A/B | `pk-ab-tavern --no-build` | **1 numeric check FAILED** — highlight clipping **2.83×** (was 2.79×) |
| sim benchmark (B1) | `cargo run --release -p pk-core --example perf_suite` | reproduces every row within spread; worst tick **315 ns** |
| **cost head-to-head (B3)** | `node scripts/pk-perf-ab.mjs --no-build --rounds 3` | **NEW — built today.** tavern **5.93×**, dungeon **2.69×** the oracle. §6 |

**Nothing regressed and nothing silently improved.** Every A/B number
reproduces its record within that rig's stated precision, which is the result
that makes the rest of this page usable: the instruments still agree with
themselves across a day.

**The one thing the sheets say that the numbers do not.** The dungeon
heatmap (`.checks/ab-dungeon-L3-s1-diff.png`) puts the floor structure — walls,
arcs, the dais, the tile lattice — in near-black on both sides: **the geometry
overlays.** Every bright region on it is *content*: the entire HUD strip, the
monsters, the props, the torch flames. So the 30.2 mean is not a framing or a
generator disagreement; it is §2's table, and §2's table is the deliverable
list. That also settles by inspection what I-5 says is unasserted — on this
seed, today, both sides really are photographing the same place.

---

## 1. The number

```
$ cargo xtask coverage

TIER 1 — legacy/src/game/pinball-knight (the 1:1 surface)
  legacy PK tree    104309 lines, 296 files
  excluded           15997 lines, 34 files  (decisions, see EXCLUSIONS)
  1:1 TARGET         88312 lines
    ported           22062 lines, 50 files
    partial           5245 lines, 4 files
    NOT STARTED      61005 lines, 208 files
    converted        25.0%

TIER 2 — the rest of legacy/src (the game loads it too)
  sibling tree       15430 lines, 57 files
  deferred            1014 lines, 8 files  (decisions, see DEFERRED)
    legacy/src/net/            594 lines, 4 files — multiplayer/co-op is P8
    legacy/src/services/       420 lines, 4 files — leaderboard is P8
  TIER 2 TARGET      14416 lines
    ported            7145 lines, 22 files
    partial            906 lines, 1 files
    NOT STARTED       6365 lines, 26 files
    converted        49.6%

CUTOVER CONDITION: tier 1 = 100.0% AND tier 2 = 100.0% (of target − deferred),
with the deferred list above reviewed. Today: 25.0% / 49.6%, 73521 lines to write.
```

Not an estimate: the ledger reads `//! PORTS:` declarations out of every Rust
module and a citation naming no legacy file is a hard failure. It replaced
`scripts/pk-coverage.sh`, a two-signal heuristic that scored `maze/decorate.ts`
— 3,169 lines, zero written — as *done* off a prose comment. CI prints both,
because resolving that gap silently would always resolve it toward the
flattering number.

### 2026-08-12 — three defects IN THE LEDGER, and a second tier

The headline moved 24.0% → 25.0% without a line of game code being written, and
that is not good news; it is the measurement being wrong in three places at once.

**(a) A typo inside a real prefix was exempt from the typo check.** The dangling
check ended with `.filter(|p| !p.starts_with("legacy/") && !p.starts_with("src/"))`
— an exemption written for genuine citations outside the PK tree, back when
there was no second tier to resolve them against. But a *misspelling* of a real
path starts with `legacy/` too. `pk-core/src/{surfaces,tile_shape}.rs` cited
`legacy/.../engine/…` with a literal `...` ellipsis; both files are ported and
tested, and **847 lines sat in NOT STARTED for the ledger's entire existence
with no warning printed.** Fixed at the spelling *and* at the check: a path must
now resolve in some tier, be excluded, or be deferred. Nothing gets a pass for
its prefix.

**(b) The denominator excluded most of the game.** `scan_legacy` walked
`legacy/src/game/pinball-knight` and nothing else — but the game does not boot
on that tree alone. `utils/audio-manager.ts` (845), `pixel/` (591), the tavern
scene glue, the gambler's art and audio, `net/`, `services/`: **15,430 non-test
lines, of which ~7,500 were in NO bucket at all** — not ported, not excluded,
not even NOT STARTED. Since *"the ledger reads 100%"* is the cutover condition,
a file in no bucket is a hole in the finish line. Tier 2 now counts them, and
`DEFERRED` is a third bucket kept deliberately separate from `EXCLUSIONS`,
because *"post-parity, by decision"* and *"nobody has looked"* must not print
the same.

Tier 2 is kept as a **separate percentage rather than merged** into one: merging
would silently move the headline and make every figure recorded before today
incomparable with every figure after it.

**(c) Two modules claimed a 906-line file whole while porting ten lines of it.**
Only visible once tier 2 was scored. `tavern/camera.rs` ports `core.ts`'s
CAM_LEAN/CAM_LERP aim math and `fx/tavern_fx.rs` ports its `:467-476` emitter
cadence — both said `PORTS`, so `openTavernScene`'s whole lifecycle counted as
converted. Both are `PORTS-PARTIAL` now, with the remainder stated, which is why
tier 2 reads 49.6% and not 55.8%. **The honest number went down.** A third
citation, `legacy/src/scenes/tavern/camera.ts`, names a file that has never
existed — the module is `camera.rs`, and the `.ts` name was assumed from it.

Sabotage sweep on the repaired gate: **4 injected, 4 caught, 0 survived** —
re-introduce the ellipsis (red, and the % falls back to 24.6), cite a
nonexistent tier-2 file (red), delete the sibling-spelling normaliser (red),
let tier 2 swallow the PK tree (red). Positive control on the clean tree: green,
exit 0. Workspace **882 tests**, 0 failed.

### The remainder, by legacy directory

Nineteen rows, reconciling exactly to 67,370 — the two tiers' NOT STARTED
together (61,005 + 6,365). The three new rows at the bottom of the tier-1 block
(`scenes`, `utils`, `pixel`) are the ones tier 2 made visible.

| Legacy dir | Lines | Files | The headline files |
|---|---:|---:|---|
| `maze/` | 12,014 | 25 | `decorate` 3,169 · `prefabs` 702 · `arc-sweeps` 694 · `doorway-funnels` 687 |
| root | 9,523 | 38 | `hud-face` 1,330 · `abilities` 916 · `boss` 772 · `core` 593 |
| `entities/` | 9,425 | 13 | `player` 2,445 · `zombie` 1,217 · `combat` 1,204 · `marble` 1,005 |
| `dev/` | 5,298 | 17 | `window-hooks` 1,054 (`__lab()`) · `pattern-census` 991 |
| `engine/` | 5,060 | 17 | `render/sprite` 1,697 · `render/figure` 575 — **−847, (a) above** |
| `scenes/` | 4,598 | 18 | **tier 2** — gambler art/audio + the tavern glue |
| `gui/` | 4,523 | 18 | `screens/menu` 809 · `screens/debug` 717 · `screens/hud` 404 |
| `render/` | 4,138 | 18 | `card-styles` 640 · `card-glyphs` 538 · **+ tier 2's `backend.ts` 225** |
| `fx/` | 3,639 | 22 | `system` 540 + the element families |
| `constants/` | 1,797 | 8 | `render` 671 |
| `boot/` | 1,336 | 7 | `sheets` 586 |
| `spawn/` | 1,192 | 4 | `factory` 525 · `floor-populate` 363 |
| `run/` | 1,036 | 8 | `descend` 308 · `death` 251 |
| `utils/` | 951 | 3 | **tier 2** — `audio-manager` 845 |
| `economy/` | 885 | 5 | the DUNGEON economy; the tavern's is ported |
| `sfx/` | 712 | 6 | `ambience` 222 · `bus` 161 |
| `pixel/` | 591 | 4 | **tier 2** — the pixel/font canvas layer |
| `sim/` | 528 | 2 | `loop` 506 |
| `input/` | 124 | 1 | `keymap` |
| | **67,370** | **222** | |

Plus five PARTIAL files the ledger prints the missing half of: `maze/build.ts`
1,898 · `render/pinball-parts.ts` 1,611 · `state.ts` 1,556 ·
`scenes/tavern/core.ts` 906 · `sim/simulate.ts` 180.

And, outside both targets, **228 vitest suites / 41,877 lines** to port
selectively as each subsystem lands (Stage 5).

---

## 2. What a player actually sees missing

The ledger counts lines. This counts what is on the screen, off
`.checks/ab-dungeon-L3-s1.png` — both sides on the authored L3 seed 1, both
cameras on the same start tile:

| In the oracle's frame | In the port's frame | Owner |
|---|---|---|
| the whole HUD — portrait, health, depth/kills/rage, belt, skills, weapon, minimap | **nothing at all** | `hud-face.ts` 1,330 + `gui/screens/hud.ts` 404 |
| six monsters closing on the knight | one billboard at the frame edge | `entities/` 9,425 — the horde stands, it does not live |
| dropped weapons, barrels, chests, corpses, skulls | coloured discs and cylinders | `spawn/factory.ts` 525 + the part/prop art |
| bumpers with lit caps, boost chevrons, glowing rollovers | flat quads and plain cylinders | `render/pinball-parts.ts` (1,611 missing) |
| torch flames with warm pools | orange rectangles, correctly placed | V-4 |
| the knight in gold armour, sword up | a small dark figure | sheet/rung selection |

Every row has a file and a line count in §1. **That table is the deliverable
list**; the percentage is how it is tracked.

---

## 3. The order

Set by the user on 2026-08-11 and unchanged: **by scene — intro → tavern →
maze** — each finished 1:1 (art, UI and behaviour) and signed off on an A/B
sheet before the next starts. It is not the cheapest order by line count. It is
the order that finds the coupling early, and it has already paid twice: the
intro's title maze is built through the real `buildMaze`, which put the whole
texture bake on the *first* scene's critical path, and the same rig found the
camera defect in §4.

---

## 4. The defect this session found, and why it hid

**The intro camera was framed 1.714× too close in every phase but the last.**

`pixel-pass.ts syncCameraFrustum` is called from `render()` — scene-agnostic —
and sets the ortho half-extents to `renderW/(2·PPU) × renderH/(2·PPU)` on every
frame. At 1920×1080 and PPU 56 that is **34.29 × 19.29** world units. The port's
intro pinned `ScalingMode::FixedVertical { VIEW_H }` with `VIEW_H = 11.25` — the
`engineConfig.camera.viewH` *default*, i.e. 20 × 11.25.

This is the same defect `drive_scene_camera` fixed for the dungeon on 08-11.
That fix was written as a `match` over `AppState` whose `_ => None` arm excluded
the intro **by name**, on the reasoning that the intro owns its own projection.
The intro owns its *zoom*. Owning a zoom is not owning a frustum.

**Why three days of A/B sheets did not report it.** `fit_zoom`'s margins (`+1.5`,
`+2.2`) are world-unit constants in the *denominator*, so scaling both
half-extents by k scales `fit` by exactly k — and the visible world height,
`frustum / zoom`, is therefore k-invariant at `sweep_u = 1`, where `zoom == fit`.
The two frustums cancel to the last bit at the title. At `sweep_u = 0` the zoom
is the absolute constant `ZOOM_FROM = 2.3`, nothing cancels, and the error is the
full k, decaying as `k^(1-u)` across the sweep.

That is precisely the shape of the intro A/B table — `title` 13.3 (correct),
`sweep` 25.3, `shatter` 60.7, ranked by how little of the interpolation each
phase had run. **A defect that vanishes at one end of an interpolation reads as
a small defect and is not one.** Plan v3 filed the shatter size, the sweep
framing and the knight scale as three separate items (2-1, 2-4, and a question);
they are one line of code.

The repair is not a second copy of the rule: `PixelSizing::frustum(zoom)` is now
the one derivation and all three scenes call it, and
`drive_scene_camera`'s `match` lost its `_` arm so a scene added later cannot
inherit a framing decision by falling through — it is a compile error until
someone states which frustum it wants.

---

## 5. The queue

### Stage 2 — the intro *(smallest scene, gate exists)*

| # | Item | Acceptance |
|---|---|---|
| 2-1 | ~~Shatter too slow and too big~~ · ~~2-4 sweep framing~~ — **one defect, §4** | the A/B numbers below, at N=3 |
| 2-5 | **The intro HUD is drawn in the wrong LAYER, and the shatter is what proves it.** The oracle paints `WORLD 1-1`, `COIN x00` and `ANY KEY — SKIP` *into the 2D overworld canvas* (`intro/index.ts:662-680`): 10 px and 8 px `PIXEL_FONT_LABEL`, white fill with a **3 px `#1c2a38` stroke**, at canvas coords `(16,24)`, `(BW-110,24)`, `(16,BH-14)`, the last at `globalAlpha` 0.75. The port spawns them as Bevy `Text` UI entities (`hud_es`) in `default_font`, unoutlined, positioned in window space. Two consequences, one cosmetic and one behavioural — **and the behavioural one is the reason this is filed as a defect rather than a paint job**: `beginShatter` snapshots that canvas, so in the oracle the HUD text **breaks into shards with the rest of the world**, and in the port it structurally cannot. The letters `COI` are legible among the oracle's shards on `ab-intro-shatter`. ⚠️ The em-dash is real: the oracle's string is `ANY KEY — SKIP` (U+2014), the port's a hyphen — the same class as the U+2212 minus sign already pinned, and **a glyph the atlas lacks draws nothing, silently**. Needs the pk-gui font atlas blitting into the `Overworld` RGBA buffer | the three strings paint into the canvas, outlined, and appear as SHARDS in `ab-intro-shatter` |
| 2-6 | **The knight is the wrong sprite in EVERY scene — one cast problem, filed three times.** This session's sheets put the symptom side by side in all three: on `ab-intro-run` the oracle's knight is brown/tan armour with the sword raised and the port's is grey/silver and hunched; on `ab-tavern-sbs` the oracle's is the same brown/tan figure and the port's the same grey one; and §2's dungeon row already reads *"the knight in gold armour, sword up"* against *"a small dark figure"*. **Three scenes, one rung/sheet selection.** That is the shape of the camera defect exactly — symptoms filed per scene, cause shared — and it is the argument for fixing it as sheet selection rather than as three art items. *(Original 2-6 text follows, and the rest of its frame still lands:)* **The intro knight is the wrong sprite and too large.** On `ab-intro-run` the rest of the frame matches almost exactly — sky gradient, clouds, hills, brick ground, the `?` block all land — and the knight does not: the oracle's is a brown/tan armoured figure with the sword raised, the port's a grey/silver one, hunched and noticeably bigger. Rung/sheet selection, which is the same question the dungeon sheet's last row asks | the two run frames' knights match in rung and in height |
| 2-2 | Characterise the rig on the fast phases: three runs per side, publish the spread. `bonk` moved +5.1 and `shatter` +4.0 across a day with neither side's art touched, so at N=1 a 4-point claim is indistinguishable from noise | a stated ± on `bonk` and `shatter` |
| 2-3 | Torches, banners and decor on the title maze (the V-4 slice the intro needs) — the oracle's top wall carries lit sconces and doors, ours carries none | `ab-intro-title` mean below 13.3 with the sconces lit |

### Stage 3 — the tavern

| # | Item | Acceptance |
|---|---|---|
| 3-1 | **Highlight clipping 2.83×** (re-measured 2026-08-12; was 2.79×) — rust clips 0.353% of pixels out of range against the oracle's 0.091%, on matched room area, allowance 2.5×. Clipping is what "blown out" is and mean luma cannot see it — the same run passes exposure at Δ0.3% and mid-tones at Δ0.0%. Suspects in order: emissive keeper sprites, the hearth light's intensity, the cel grade's shoulder | the tavern rig's ten checks all green |
| 3-2 | Warm spill 7.34% vs the oracle's 23.02% (reported, not gated) | a fix, or the check promoted to gated with a stated allowance |
| 3-3 | **NEW — the tavern is the port's most expensive scene, and it is 5.93× the oracle's.** 16.00 ms against 2.70 ms (§6), in a room with a fraction of the dungeon's geometry, while the port's *dungeon* costs 7.00 ms. Two suspects are already named by this project's own history and cost nothing to test: the immediate-mode GUI upload (a 756×482 clear plus a 1.4 MB texture write per repaint, which once took this room 36 fps → 14, and `pk-check` reports 40% of driven frames repainting), and the hearth light rig that 3-1 is also about. Price them before touching the dungeon | the tavern's rust p50 under 8 ms, i.e. inside its own dungeon's cost, at 3 interleaved rounds |

### Stage 4 — the maze *(55k of the 61.8k)*

Ordered so each block's gate exists before the block starts.

| # | Block | Lines | Gate |
|---|---|---:|---|
| 4-C1 | maze passes 10–23 in `PASS_ORDER` | ~4.3k | 10/10 corpus floors bit-exact per boundary + a sabotage sweep each; re-run the two `connect_all` sabotages at pass 13 |
| 4-C2 | **the `onPass` seam inside `decorateMaze`, before a line of it is ported** | — | digest certified on its own vectors, 10-floor fixtures, both sides sabotage-verified |
| 4-C3 | `decorate.ts` in its fourteen sections | 3,169 | per-section fixture boundary |
| 4-C4 | `spawn/` — factory, floor-populate, tide, reaper | 1,192 | `AuthoredFloor`-level digest, seed → finished plan |
| 4-E1 | the thirteen enemy registries as enums + `EnumMap` | part of 1,797 | exhaustive `match` + a test standing in for the four `tsc` cannot see |
| 4-E2 | `combat`, `zombie`, `projectiles`, `boss`, per-kind behaviours | ~6k | trace fixtures + ported suites + a scripted fight on a fixed seed |
| 4-E3 | `entities/player.ts` 2,445 + `abilities.ts` 916 + P1's unwired remainder (marble, multiball, ricochet, plunger, ramps, trapdoors, pits, targets/rollovers/lamps) | ~4.4k | new trace fixtures **at pinball speeds** (sub-stepping) + input driven from pk-check |
| 4-D1 | `dev/window-hooks.ts` — the `__lab()` surface | 1,054 | spawn one of every kind on demand, in the running build |
| 4-V1 | `engine/render/sprite.ts` 1,697 + `figure.ts` 575 + `boot/sheets.ts` 586 + a real `xtask bake` (`assets/sprites/` is **empty**; bare `xtask bake` returns FAILURE) | ~3k | per-rung atlases loaded, monsters drawn from them, A/B per rung |
| 4-V2 | `fx/` — element families, puffs, decals, screenshake | 3,639 | A/B per family |
| 4-F1 | HUD: `hud-face.ts` 1,330 + `gui/screens/hud.ts` + minimap + toasts | ~2k | the dungeon sheet's HUD row goes from *nothing* to matched |
| 4-F2 | run flow + persistence: `run/` 1,036, menu/game-over/haul/character-select/shop, saves | ~3k | a full descend→death→ledger loop driven headless |
| 4-G1 | `economy/` dungeon side — pickups, coins, loot, ground items | 885 | ported suites |
| 4-G2 | `sfx/` remainder behind **a spectral-diff rig that does not exist** | 712 + the rig | build the rig first, then sign off |

### Stage 5 — sweep and cutover

Port the remaining vitest logic suites (228 files, 41,877 lines) selectively as
each subsystem lands; rebuild the playtest bot against the Rust build;
`xtask dist` under a size budget; deploy; then demote `legacy/` from oracle to
reference. **The ledger reads 100% or the cutover does not happen.**

### Stage 6 — the art-style upgrade *(queued last, deliberately)*

A G-buffer outline / cel / ordered-dither pass over the finished renderer:
depth+normal prepass bound through a **custom render-graph node** (Bevy 0.17's
`ViewPrepassTextures` are render-world views, not `Handle<Image>` fields), ping-
pong raw/outlined colour targets, a four-cardinal edge mask on **linear view
depth**, tinted outlines *before* the palette quantisation, then a cel material
spike, then palette-aware ordered Bayer dither that picks between the two
nearest palette entries rather than perturbing RGB per channel. Phase 0 is a
frozen baseline; no timing claim ships without timestamp-query data. It is last
because it restyles a renderer that does not yet draw the HUD, the monsters or
the props — restyling those before they exist is restyling nothing.

---

## 6. The benchmark and performance suite

Three layers, and as of **2026-08-12 all three are built**: B1 the sim, B2 the
port's own frames, B3 the port against the oracle. B3 was the last one
specified-but-absent, and its first run changed which scene the render work is
owed to.

**B1 — the sim, headless and deterministic.**
`cargo run --release -p pk-core --example perf_suite`. Median/min/max/spread
over N reps, because on a shared box a single number is not a measurement.

| case | median | what it says |
|---|---:|---|
| `simulate_idle` / `simulate_walk` | 9.6 ns / 44.9 ns | |
| `simulate_pinball` | **299.2 ns** | the ride costs 6.7× the walk — `move_circle`'s sub-stepping |
| `build_floor_L1/L3/L5` | 3.31 / 4.20 / 5.28 ms | nine of twenty-three passes; the loading-screen budget's first number |
| `bfs_distances` / `flow_step_x1000` | 16.5 µs / 7.6 µs | 72 monsters steering at 60 Hz is 33 µs/s — the horde's AI is free |
| `js_pow` vs `std_powf` | 36.8 vs 8.7 ns | **the price of determinism, 4.2×** — worth paying, now a number |
| `js_hypot` vs `std_hypot` | 2.7 vs 3.9 ns | the other twin is *faster* than std |

**The finding that reorders everything below it: the sim is not where the frame
goes.** A frame at the measured 32 fps is 31 ms; the worst tick in the game is
0.0003 ms of it, about one part in 100,000.

**And then B2 measured the other 31 ms, and it was not a cost at all.** Release
Windows exe, tavern, RTX 3090 Ti: **p50 31.23 ms with vsync on, 17.04 ms with
`--no-vsync`.** The real render cost is 17 ms; the frame overruns a ~15.6 ms
present interval by roughly **1.4 ms** and is charged a whole extra one for it.
Getting under that interval **doubles the frame rate**, which makes 1.4 ms the
most valuable millisecond in the project.

⚠️ **This retracts the reasoning that stood here before**: *"release wasm
measures 32.1 fps against debug's 31.3, so the frame rate is not build-bound."*
That comparison was made entirely on the plateau — anything whose work lands
between 15.6 and 31.2 ms reports the same 31-32 ms, so it could not have
distinguished the two builds even if one were twice the other. Three readings
across two backends, two GPUs and three build profiles all agreeing was never
evidence of a shared cost; it was three readings of the same quantiser. What
gave it away was the **spread**, not the median: p95 − p50 = 0.6 ms on a
3090 Ti drawing 171 meshes. Work does not have variance that tight.

**B2 — the frame-time series, measured in-engine.** `__pk.perf`: a per-frame
accumulator (p50/p95/max/count over a window), **not** a sampled probe — the
probe already learned this once, publishing every 5 frames while a transient
state vanished between samples. Alongside the timings, the counts that explain
them: entities, merged meshes, lights, materials, draw calls. Its first row must
split CPU extract/queue from GPU, and the first suspect to price is the post
chain at 1920×1080 — the one pass that costs the same whether the dungeon has
102 parts on it or none. A scene-count sweep (empty floor vs L5's 121 parts)
separates *the room is expensive* from *the chain is*.

**B3 — head-to-head against the oracle. ✅ BUILT 2026-08-12**
(`node scripts/pk-perf-ab.mjs`). Release wasm against the TypeScript oracle,
host Chrome, RTX 3090 Ti, 1920×1080, three interleaved rounds, vsync off:

| scene | legacy p50 | rust p50 | ratio | round-to-round wander |
|---|---:|---:|---:|---:|
| tavern | 2.70 ms | **16.00 ms** | **5.93×** | 4% |
| dungeon | 2.60 ms | **7.00 ms** | **2.69×** | 23% |

**The finding that reorders the render work: the port's TAVERN is its expensive
scene, not its dungeon** — 16.0 ms against 7.0 ms, on a room with a fraction of
the geometry. B2's exe capture (17.04 ms uncapped) was a *tavern* reading and
was being carried as the game's frame cost. Whatever costs 9 ms more in a
smaller room is the first thing to price, and it is not the dungeon's 102 parts.

**The design decision, and the control that justifies it.** Both sides get the
*same* instrument — one rAF delta accumulator installed at document start,
accumulating every frame and read once — because reading `__pk.perf` for the
port and something else for legacy would compare two instruments. The port's own
accumulator is read anyway as a *cross-check on the probe*: over the same frames
they agree to 0.1 ms (rAF 7.00/8.50 against `__pk.perf` 7.10/8.70).

And `--vsync` is not a convenience flag, it is the rig's positive control:

| | legacy p50 | rust p50 | ratio |
|---|---:|---:|---:|
| vsync **off** | 2.70 | 16.00 | **5.93×** |
| vsync **on** | 31.30 | 31.20 | **1.00×** |

**A head-to-head built the obvious way reports the port at parity with the
oracle, to two decimal places, for a port that costs 5.9×.** Both vsync rows
trip the rig's CADENCE-BOUND check, which reads the *spread* (p95 − p50 of 0.30
and 0.40 ms) because the spread is what identified the plateau in the first
place. Chrome is therefore launched with `--disable-gpu-vsync
--disable-frame-rate-limit`, and `connectRealGpu` enforces them **on the reuse
path too** — a switch honoured only on a cold launch does nothing on a warm one,
and this harness reuses warm browsers by design.

⚠️ **What B3 does not establish.** A rAF delta is frame cadence, not a CPU/GPU
split. The comparison is fair in the way that matters — one browser, one
compositor, both subjects measured by the same relationship to it — and the
control shows legacy tracks presentation rather than free-running. But *"the
Rust renderer does 5.9× the work"* is not licensed until timestamp queries exist
on both sides. The ratio is a cadence claim; the attribution is B2's next job.

Still outstanding from B3's original spec: the **release exe** capture path is
wired (`--perf-log`) but has not been driven head-to-head, because the oracle
does not run as an exe. The exe stays the play-feel target; the browser is where
the two sides can be compared at all.

**The traps this suite must not walk into.** A budget is not a wish — every
budget derives from a recorded baseline. The box is shared, so anything timed
says how many cores it held. Debug ≠ release ≠ wasm ≠ exe: four builds, four
cost profiles, every row carries its target. And a profile that indicts the code
someone was already lobbying to rewrite deserves one measurement first — the
">13 minute" maze bake was a *browser* defect, and all three suspects were
inside the painters two blueprints wanted transcribed.

---

## 7. Instruments that need repair

A gate with a hole is worse than no gate, because it is believed.

| ID | Finding | Status |
|---|---|---|
| I-2 | **`pk-drift.sh` covers `src/` only**, and `public/sprites` already differs — `legacy/` carries `goblin-S`, `reaper-S`, `slime-S`, `spider-S` that `braindeadbot-client` does not. Art is oracle state; the A/B rigs photograph it | open — extend the diff, same legacy-ahead allowlist |
| I-3 | **The intro rig's precision is unstated on the fast phases** — `bonk` +5.1 and `shatter` +4.0 across a day with no art touched | open — Stage 2-2 |
| I-5 | **`pk-ab-dungeon` never checks that the two sides photograph the same place.** They do agree today, verified by eye, so 30.2 is a real number; nothing keeps it that way | open — assert pose equality and **throw rather than shoot** |
| I-6 | Both rigs report ~17 failed sprite requests on the *oracle* side. **Checked against the tree on 2026-08-12 and the characterisation holds**: `legacy/public/sprites` ships 46 files, and every 404 (`zombie-S`, `spider-E`, `brute-E`, `jester-E`, `goblin-N`, …) names a facing *neither* tree ships, reused from the one that loaded. Confirmed noise — but noise that will still cost someone an investigation | open — allowlist the optional facings |
| I-8 | **`pk-check` still has one single-sample gate, and it failed 1 run in 3 today.** `the prompt comes back when the sheet closes` polls until the panel is gone, then takes **one** reading of `gui.open` — read 0, wanted 1; runs 2 and 3 both read 1. This is the *fourth* instance of the shape `cd08d8e` fixed for the walk and `3bc7220` for the intro handoff: **poll for condition A, then sample condition B once, and B is set on a later frame.** Stated as the likely mechanism, not a diagnosis | **open — new**, and the fix is known: wait for a fresh publish, as `freshPose()` does |
| ~~I-7~~ | ~~`pk-check` has only ever been run against a DEBUG build~~ — **CLOSED 2026-08-12: the release build passes 27 gates, 0 failures.** It failed THREE when first pointed at it, and **all three were in the harness**: the sim-rate gate measured a fixed-timestep catch-up drain (77 Hz) because the settle its own twin documents was written inline in the other gate; and the two handoff gates were one race, a single sample taken the instant the intro state ended, before the lazily-built `TavernRes` existed. Same `web/dist` before and after; only the script changed | **closed** — and the standing rule it leaves: *a repair written inline is a repair applied to one call site* |

**RISK — the release gate is not yet reliable, though the release build is.**
`3bc7220` and `cd08d8e` closed I-7: the shipped artefact does pass. What is not
settled is the *harness* — three consecutive commits have now each found one
more gate that samples where it should wait, and today's re-run found a fourth
(I-8). **Until `pk-check` runs green three times consecutively on one unchanged
`web/dist`, a red run is not evidence about the port.** That is the cheapest
open item on this page and it blocks the meaning of every future green.

---

## 8. How "done" is decided

- **Sim** — bit-exact against exported fixtures, and every pass sabotage-swept.
  Green at a boundary is not green at a pass: `carve-track` shipped with 6 of 10
  injected defects surviving, including *compiling in the wrong trig library*.
- **Content and art** — graded visually on the A/B rigs, in real host Chrome on
  the host GPU. SwiftShader cannot run this app at all.
- **Cost** — B1/B2/B3, release builds only for judgement.
- **The ledger reads 100%** — declarations, not substrings.
