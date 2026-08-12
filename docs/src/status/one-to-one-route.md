# The route to 1:1 — what is left, in what order, and how each piece is known to be done

**2026-08-12 · baseline `main` @ `9344537` · every number below was produced
today by a named command on this box.** This page is the standing answer to
*"what do we still have to do to convert Pinball Knight from
`braindeadbot-client` to this repo, 1:1?"* — [plan v3](port-plan-v3.md) is the
same queue with its full working shown; this page is the map above it and the
one to read first.

---

## 1. The number

```
$ cargo xtask coverage

legacy PK tree      104309 lines, 296 files
excluded             15997 lines, 34 files   (decisions, see EXCLUSIONS)
1:1 TARGET           88312 lines

  ported             21215 lines, 48 files
  partial              5245 lines, 4 files
  NOT STARTED         61852 lines, 210 files

  converted        24.0%
```

**24.0%.** Not an estimate: the ledger reads `//! PORTS:` declarations out of
all 105 Rust modules and a citation naming no legacy file is a hard failure. It
replaced `scripts/pk-coverage.sh`, a two-signal heuristic that scored
`maze/decorate.ts` — 3,169 lines, zero written — as *done* off a prose comment.
CI prints both, because resolving that gap silently would always resolve it
toward the flattering number.

The remainder, by legacy directory. The sixteen rows reconcile exactly to
61,852:

| Legacy dir | Lines | Files | The headline files |
|---|---:|---:|---|
| `maze/` | 12,014 | 25 | `decorate` 3,169 · `prefabs` 702 · `arc-sweeps` 694 · `doorway-funnels` 687 |
| root | 9,523 | 38 | `hud-face` 1,330 · `abilities` 916 · `boss` 772 · `core` 593 |
| `entities/` | 9,425 | 13 | `player` 2,445 · `zombie` 1,217 · `combat` 1,204 · `marble` 1,005 |
| `engine/` | 5,907 | 19 | `render/sprite` 1,697 · `render/figure` 575 · `tile-shape` 529 |
| `dev/` | 5,298 | 17 | `window-hooks` 1,054 (`__lab()`) · `pattern-census` 991 |
| `gui/` | 4,523 | 18 | `screens/menu` 809 · `screens/debug` 717 · `screens/hud` 404 |
| `render/` | 3,913 | 17 | `card-styles` 640 · `card-glyphs` 538 |
| `fx/` | 3,639 | 22 | `system` 540 + the element families |
| `constants/` | 1,797 | 8 | `render` 671 |
| `boot/` | 1,336 | 7 | `sheets` 586 |
| `spawn/` | 1,192 | 4 | `factory` 525 · `floor-populate` 363 |
| `run/` | 1,036 | 8 | `descend` 308 · `death` 251 |
| `economy/` | 885 | 5 | the DUNGEON economy; the tavern's is ported |
| `sfx/` | 712 | 6 | `ambience` 222 · `bus` 161 |
| `sim/` | 528 | 2 | `loop` 506 |
| `input/` | 124 | 1 | `keymap` |
| | **61,852** | **210** | |

Plus four PARTIAL files the ledger prints the missing half of: `maze/build.ts`
1,898 · `render/pinball-parts.ts` 1,611 · `state.ts` 1,556 ·
`sim/simulate.ts` 180.

And, outside the target, **228 vitest suites / 41,877 lines** to port
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
| 2-6 | **The intro knight is the wrong sprite and too large.** On `ab-intro-run` the rest of the frame matches almost exactly — sky gradient, clouds, hills, brick ground, the `?` block all land — and the knight does not: the oracle's is a brown/tan armoured figure with the sword raised, the port's a grey/silver one, hunched and noticeably bigger. Rung/sheet selection, which is the same question the dungeon sheet's last row asks | the two run frames' knights match in rung and in height |
| 2-2 | Characterise the rig on the fast phases: three runs per side, publish the spread. `bonk` moved +5.1 and `shatter` +4.0 across a day with neither side's art touched, so at N=1 a 4-point claim is indistinguishable from noise | a stated ± on `bonk` and `shatter` |
| 2-3 | Torches, banners and decor on the title maze (the V-4 slice the intro needs) — the oracle's top wall carries lit sconces and doors, ours carries none | `ab-intro-title` mean below 13.3 with the sconces lit |

### Stage 3 — the tavern

| # | Item | Acceptance |
|---|---|---|
| 3-1 | **Highlight clipping 2.79×** — rust clips 0.349% of pixels out of range against the oracle's 0.091%, on matched room area, allowance 2.5×. Clipping is what "blown out" is and mean luma cannot see it. Suspects in order: emissive keeper sprites, the hearth light's intensity, the cel grade's shoulder | the tavern rig's ten checks all green |
| 3-2 | Warm spill 6.71% vs the oracle's 23.20% (reported, not gated) | a fix, or the check promoted to gated with a stated allowance |

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

Three layers. **B1 is built and baselined; B2 and B3 are specified.**

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

**B3 — head-to-head against the oracle.** 1:1 includes cost. Same scene, seed
and viewport, both sides in host Chrome, **interleaved A/B/A/B** — a loaded
shared box drifts over minutes and a sequential comparison measures the drift.
The play target is the Windows exe, so the number that decides "does it feel
right" is the release exe's frame time; that capture path does not exist yet and
is the one piece of B2 that is new work rather than wiring.

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
| I-6 | Both rigs report ~17 failed sprite requests on the *oracle* side. They are its own optional facings (`boot/sheets.ts`: "W is drawn as a flipped E") and neither tree ships `-N` sheets — noise that will cost someone an investigation | open — allowlist the optional facings |
| ~~I-7~~ | ~~`pk-check` has only ever been run against a DEBUG build~~ — **CLOSED 2026-08-12: the release build passes 27 gates, 0 failures.** It failed THREE when first pointed at it, and **all three were in the harness**: the sim-rate gate measured a fixed-timestep catch-up drain (77 Hz) because the settle its own twin documents was written inline in the other gate; and the two handoff gates were one race, a single sample taken the instant the intro state ended, before the lazily-built `TavernRes` existed. Same `web/dist` before and after; only the script changed | **closed** — and the standing rule it leaves: *a repair written inline is a repair applied to one call site* |

**RISK — the release build is ungated.** Every green `pk-check` in this
project's history is a debug-build green. The shipped artefact has never passed
the gate.

---

## 8. How "done" is decided

- **Sim** — bit-exact against exported fixtures, and every pass sabotage-swept.
  Green at a boundary is not green at a pass: `carve-track` shipped with 6 of 10
  injected defects surviving, including *compiling in the wrong trig library*.
- **Content and art** — graded visually on the A/B rigs, in real host Chrome on
  the host GPU. SwiftShader cannot run this app at all.
- **Cost** — B1/B2/B3, release builds only for judgement.
- **The ledger reads 100%** — declarations, not substrings.
