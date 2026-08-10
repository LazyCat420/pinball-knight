# Status board

The living broken / fixed / working record. **Update this page in the same PR
as the change it records.** Newest entries first within each section.

## Working

- **2026-08-09 — P2 pass 1 `grow-track`: the physarum circuit, 8 of 10 floors
  bit-exact — and the port's math library turned out to be wrong.**
  `pk_core::maze::track_grow`: node layouts, K-nearest mesh, the Gauss–Seidel
  pressure solve, 140 growth steps, prune-to-circuit and prune-leaves.
  - **The harness paid for itself on its first real use.** The first run came
    back "nodes matched, edges diverged" — the layout right, the solver wrong —
    which is one read instead of a bisect through 1,100 lines. Stage probes then
    put it inside `grow_network`, and a pow sweep put it inside `Math.pow`.
  - **`libm::pow` is not V8's pow.** Over 200,001 values of x^1.35 the Rust
    `libm` crate (Sun's `e_pow.c`) differs from the runtime on 19,904 of them by
    1 ulp; `f64::powf` differs on none. The workspace determinism rule says to
    use `libm` — for `pow` that rule points at the wrong implementation. Applied
    140× per floor, feeding lane WIDTH: same topology, different roads.
  - **Then `Math.cos`, which is neither.** `cos(0.1)` is `0x…c0` in the runtime
    and `…c1` in BOTH Rust candidates. V8 keeps the original Sun kernel
    evaluation order; musl and glibc both took FreeBSD's rewrite. Constants are
    identical in all three — it is the polynomial form that differs.
  - **So the family is swept, not assumed.** `assets/fixtures/jsmath-oracle.json`
    pins whole curves for cos/sin/sqrt/exp/log/atan/pow from the real runtime,
    because 1 ulp on one input in ten is invisible in spot values. Verdict:
    sqrt either, atan `libm`, pow std (plus V8's ±0.5→sqrt fast path), and
    cos/sin/exp/log neither. `js_pow` is in; `js_cos`/`js_sin` are not.
  - **The gap is pinned by name, not by category.** Two floors of ten diverge
    (L3 s1, L13 s1) — and three OTHER hub floors are bit-exact, so excluding
    "the hub layout" would have quietly stopped testing three floors that
    already pass. The test asserts the divergent set EQUALS that list, so it
    fails when the twins land as well as when a new divergence appears.
  - **Measured:** `cargo test -p pk-core` 336 unit + 15 integration green; fmt
    and clippy clean; legacy suite unchanged.
- **2026-08-09 — P2 data tables: the five archetypes, and the stream that runs
  before the generator.** `pk_core::maze::archetypes` + `::modifiers` — the
  track half of the archetype table, `windiness_for`, `track_node_counts`, the
  modifier ROLL, and `levelConfig`'s cell ramp. No pass of the pipeline yet.
  - **Verified against the oracle, not transcribed and hoped.** The parity
    fixture already records each corpus floor's resolved `TrackProfile`
    verbatim, so the table is compared field by field; `deny_unknown_fields` on
    the JSON side means a field ADDED to the legacy profile fails loudly rather
    than being silently unmodelled.
  - **The pre-track stream reproduces bit-exactly.** `authorFloor` draws twice
    before the generator — the modifier roll and the windiness roll, both
    depth-conditional — so `drawsBeforeTrack` is 0/1/2/3 across the corpus.
    Rust now reproduces both counts and `density` (a draw run through a clamp,
    compared as an exact f64). That exercises Mulberry32, `floor_seed`,
    `roll_modifier` and `windiness_for` in one line each, and it is the last
    thing verifiable before `grow_track` lands — otherwise it surfaces as a
    pass-1 digest mismatch and gets blamed on the physarum solver.
  - **A gap the corpus could not cover, found by sabotaging it.** Changing
    `MODIFIER_CHANCE` from 0.45 to 0.5 changed NO floor: separating those two
    needs a modifier draw in [0.45, 0.5) and none of the ten lands there. Same
    for the `cellsW/H` caps, which bind at L23/L24 while the corpus stops at
    13. So `maze-constants.json` exports those constants directly and a
    separate test compares them — kept separate on purpose, so "the digests are
    green" cannot be read as "every number is right".
  - **⚠️ Trap, and it bit:** a JS object with integer-like keys iterates in
    ASCENDING NUMERIC order regardless of how the literal is written.
    `{[MAT_ICE]: 3, [MAT_RUBBER]: 1}` is `{1:1, 2:3}` at runtime — rubber
    first, ice second. Transcribed in reading order, two of the five archetypes
    got a surface mix whose weighted pick walks backwards. The fixture caught
    it on the first run.
  - **Measured:** `cargo test -p pk-core` 332 unit + 14 integration green; the
    legacy exporter's four tests green; fmt and clippy clean.
- **2026-08-09 — P2 opens with its harness: 23 pass boundaries, digested.**
  Nothing of the maze generator is ported yet. What is built is the instrument
  that will debug the port, and it is built first on purpose.
  `buildTrackFloor` is twenty-three ordered passes sharing ONE rng stream, each
  mutating the grid the next one reads — so a whole-floor comparison can only
  ever say "wrong", on 3,975 tiles, with every pass after the real mistake
  wrong too.
  - **The seam.** `maze/track-floor.ts` gained an `onPass` probe (23 calls, no
    rng, no allocation into the floor) and the legacy exporter drives the LIVE
    pipeline through it — not a copy of it. A copy is what
    `floor-pipeline.test.ts`'s own header warns about: it claimed for months to
    run "the exact sequence core.ts uses" and had not since `TRACK_FIRST` went
    on.
  - **What each boundary pins:** 7 digests (tiles, shapes, arcs, arcIdx, lane,
    sealed, dist), 6 exact counts, the cumulative rng draw count, and the
    pass's own scalars verbatim (`{"arcs":68,"lanes":10}` tells you what broke;
    a hash of it tells you only that something did). 10 corpus floors ×
    23 passes, all five archetypes, levels 1-13, two run seeds.
  - **The draw count is the localiser.** At the FIRST divergence every earlier
    pass matched, so the pass entered with a bit-identical grid and the rng at
    the same position — the mistake is in that pass, and the draw DELTA says
    which half: a different number of draws is a wrong draw sequence, the same
    number is wrong arithmetic on the right values.
  - **Certified, not assumed.** The digest is pinned on its own vectors
    (`maze-digest-selftest.json`) including the two JSON cannot carry — `-0`
    and `Infinity` — with the little-endian byte stream pinned separately, so a
    big-endian port is named as endianness rather than reported as "digest
    differs". Sabotage-tested four ways: an extra rng draw before `arc-sweeps`
    and a no-rng change in `boss-chamber` each localise to the right pass on
    every floor; dropping the length fold and flipping f64 to big-endian each
    fail the self-test.
  - **Measured:** legacy suite 2,657 passed / 13 skipped, 0 regressions — and
    "the probe does not perturb the floor" is one of those tests, not an
    assertion in a comment: the same seed is built once through the seam and
    once by the shipping call, and the finished grids are compared. `cargo test
    -p pk-core` 327 unit + 12 integration green; fmt and clippy clean on the
    new files. The exporter runs the whole corpus in 1.2 s.
- **2026-08-09 — The look and the sound land: post chain (P3 partial), baked
  tavern art (P6), audio + particles (P7 partial), hub-first boot.**
  *Status: NOT SIGNED OFF. No pk-check run and no screenshot A/B against the TS
  game has been made on this change. Below, "in the tree" means the file was
  read and says so; everything else is the intent of the change and must be
  re-checked before it is called done. (Why the pedantry: see Incidents — a
  green suite once certified deleted code.)*
  - **P6 art — in the tree.** `cargo xtask bake --tavern` is a REAL bake (it
    was a hard `not implemented yet` stub): `xtask` shells
    `legacy/scripts/bake-tavern.mjs`, which runs the TS painters headless and
    writes `assets/tavern/`. Confirmed on disk: five keepers at **84×84**
    (merchant / witch / magician / frog / tout) and **sign-enter-maze.png at
    1024×220**, plus a `bake.json` provenance stamp (legacy rev, sprite config
    168px / 84 grid / 128 art, vendored Press Start 2P). These replace the
    tinted placeholder boxes; the contact-shadow blob is synthesized in Rust
    (`pk-game/src/tavern_art.rs`).
  - **Boot flow is hub-first — in the tree.** `main.rs` picks the start state:
    the dev hatch (`--dungeon` / `?dungeon=1` / `PK_SCENE=dungeon`) wins,
    otherwise `--tavern`/`?tavern=1` **or a skipped intro** lands in the
    TAVERN, otherwise the intro plays and hands off to the tavern. The intro no
    longer ends on a dungeon floor. pk-check's sim/input gates use the hatch —
    which means its intro gates ("hands off to a live dungeon sim") describe
    the OLD flow and must be re-pointed.
  - **Build-age stamp — in the tree.** `crates/pk-game/build.rs` emits
    `PK_BUILD_EPOCH` at compile time; `main.rs` renders it bottom-right next to
    the frame-time readout ("built 12m ago") so a stale window is obvious. The
    build.rs comment keeps the caveat honest: it refreshes when *pk-game*
    recompiles, not when a pk-core-only edit relinks the exe.
  - **P3, the pixel/cel post chain, TSL → WGSL** (`pk-game/src/post/`): scene →
    low-res linear target → half-res bloom (threshold 0.7 / strength 0.9 /
    radius 2.2) → one composite (16-tap depth-ring SSAO, radius 14,
    `light = 1 − ao·0.85` → +bloom → linear→sRGB → vignette 0.32 → CEL GRADE at
    10 steps / curve 0.5 / saturation 1.15) → integer nearest upscale. **Order
    is the look** and every constant is the legacy `engineConfig.post` value,
    unchanged (checked against `legacy/.../engine/config.ts`). Not ported:
    palette quantize, dither, scanlines, ink outline, heat, chromatic
    aberration — note these are **off in the oracle's own config too**, so this
    is not visual debt against the shipped TS look; their uniforms are pinned
    at 0 so enabling one later is a flip, never a reorder. The albedo MRT that
    palette-snap needs is likewise unbuilt.
  - **P7 (partial):** `pk-audio` carries both backends — native via
    `web-audio-api`, wasm via `web-sys` on the browser's own AudioContext —
    behind the `AudioBackend`/`OscillatorNode`/`GainNode`/`AudioParam` traits,
    with the synth primitives and the tavern + intro patches; the Bevy side is
    `pk-game/src/sfx.rs`. FX: ember / mote / spark pools — a CPU ring buffer
    uploaded to one instanced additive material each frame
    (`pk-game/src/fx/`), the port of legacy `fx/pools/particle-pool.ts`.
    ⚠ **At the time this entry was written the shell wiring was still
    skeletal** — `SfxPlugin::build` and `FxPlugin::build` were empty and
    `PostPlugin` only inserted its sizing resource. Confirm against the
    committed tree before treating any of this bullet as delivered.
- **2026-08-09 — P6 tavern ported: the walkable between-floor hub.** Same
  split as every phase: everything that ticks is `pk_core::tavern` —
  the hand-authored floor plan verbatim (7 stations, 8 obstacle rects,
  5 keeper spots, spawn slots, `station_at` nearest-wins, `move_in_room`
  axis-eject slide), the movement step (extracted in legacy as
  `stepTavernMovement` so `updateTavernPlayer` and the fixture exporter
  drive ONE description; js_hypot in every mirrored hypot), the diorama
  read (`read_diorama` — caps are completed targets, the ball only laps
  after a B-or-better), the keeper cast join + idle loops (hammer 2.1s /
  dart 2.9s work beats with rising-edge latches, greet-once-per-approach,
  the mirror eased through zero and floored at 0.06), the camera lean
  (CAM_LEAN 0.72 / CAM_LERP 3.4) and the join board. The GAMBLER's whole
  deterministic core is ported too (`pk_core::gambler`): table rules
  (6-round visit cap, half-purse/100g stake caps, two-phase bet/settle,
  raise seam), slots (16-stop strip, exact-RTP enumeration ~90%),
  roulette pricing (19 pockets, every bet 18/19) + the full two-body
  ball physics (track/drop/scatter/rattle, launch-speed SEARCH that
  never needs its correction), blackjack rules + basic strategy
  (measured RTP 0.95–1.0 over 200k hands) + the playable table's phase
  machine (cue order, exactly-once resolve, raise-gated double), darts
  (board geometry, fitted payout bands, log-space wobble, throw state
  machine, per-visit economy Monte-Carlos). Verified: 250 ported
  pk-core tests + a FOURTH bit-exact fixture (`tavern-walk-trace.json`,
  600 ticks of pose+velocity+facing+station focus) + six new pk-check
  gates in host Chrome (boot via `?tavern=1`, movement, focus at the
  table, summary panel open/close, walk to the DESCEND board, hand-off
  to a live dungeon sim) — ALL GATES PASSED twice, clean console,
  screenshots. Legacy suite 2654 green; windows-gnullvm checks clean.
  Shell debt (checklist): P3 materials/pixel-pass/sign lettering, P4/P5
  vendor+cabinet panels (placeholders; logic is ported), P7 sfx/VFX,
  P8 multiplayer pool. Probe cadence lesson: `__pk` now publishes every
  5 frames — a 10-frame cadence at a heavy dev-build's frame rate went
  stale enough to flake pk-check's closed-loop walk.
- **2026-08-09 — The title intro plays: 1985 overworld → bonk → shatter →
  the maze that spells the title.** First scene of the player-order plan
  (see milestones' scene-order decision). Split exactly like the physics
  ports: everything that ticks is in `pk-core/src/intro.rs` — the
  letterform title grid, the 120 Hz ricochet against the REAL `move_circle`
  (js_hypot in the normalizer, per the V8-hypot entry below), the two-clock
  split (real time drives choreography, clamped time drives the ball — the
  legacy 22s-intro regression stays fixed by construction), the 5-phase
  sequence with edge-triggered cues, and the skip gate. The Bevy shell
  (`pk-game/src/{intro,overworld}.rs`) paints the side-scroller gag into a
  480-wide CPU buffer (sky/clouds/hills/bricks/particles/question
  block/coin/knight from the E-sheet run+roll cells), snapshots it minus
  the knight and shatters it over the side-on 3D maze, then sweeps
  7°→38° tilt / 0→18° yaw with log-zoom to the fitted title. Verified:
  17 ported pk-core tests + a BIT-EXACT 600-tick `intro-ball-trace.json`
  fixture (legacy exporter in `port-fixtures.test.ts`), and four new
  pk-check gates in host Chrome — phases progress on a plain load, title
  card screenshotted, auto-handoff to a live dungeon sim, click-skip.
  `?autostart=1` is now pk-check's harness entry, same contract as the
  legacy bots. Boot trap pinned: the initial state's OnEnter fires before
  Startup's commands apply, so a `Res` param there panics the wasm —
  scene setups are lazy Update systems gated on resource existence.
  Debt listed in the checklist: pixel fonts, sfx stings (P7), display-res
  knight layer, "?" pulse-scale.
- **2026-08-09 — P1 momentum ride ported: the knight is a pinball.** The sim
  half of `updatePinball` + `pinball-collide.ts` + `rail.ts` + the
  combo-curve math live in Rust (`pinball.rs`, `rail.rs`, `combo.rs`):
  steering with steer locks, wall/slant/corner reflections consuming the
  SURFACES tables, lane glide, the pocket-rattle guard, kicker/lane band
  consumption, banked-rail rides (catch/hold/overspeed/decay), arc-corner
  banking, tempo zones + overcharge, per-topology friction, and the physics
  part handlers (bumper w/ lit+jackpot, spring, booster w/ jam guard,
  corner/curve boosters, deflector grab-throw, oil, spinpad, slingshot,
  flipper, mirror, magstrip cap). Verified three ways: 26 ported rail/combo
  unit tests; the booster-corner-sim END-TO-END suite (4 cases, legacy's own
  thresholds, driving the REAL Rust ride — jam guard stands the pad down,
  steering back in <20 frames, legit chains still carry); and a THIRD golden
  fixture — a 600-tick momentum trace at 18 u/s through slant + round + arc
  lane — replaying BIT-EXACTLY. pk-check ALL GATES PASSED (55 Hz, 62.9 FPS,
  clean console, screenshot). Legacy oracle suite: 2652 green.
- **2026-08-09 — V8's Math.hypot is NOT the C library's hypot.** The pinball
  fixture diverged at tick 391 by 2 ulps of z; the cause was tick 122's steer
  normalize: V8 computes hypot as a max-scaled Neumaier-compensated sum
  (v8/src/builtins/math.tq), which differs from libm's correctly-rounded
  hypot by 1 ulp — on 35% of random inputs (measured: 70,870 of 200,000).
  The 1-ulp momentum error hid below position resolution for 269 ticks, then
  a shaped-tile resolve amplified it. Fix: `jsmath::js_hypot` reproduces
  V8's algorithm exactly (200k/200k match vs real node) and EVERY ported
  `Math.hypot` call site now uses it — `libm::hypot` is banned in mirrored
  code. The prior "libm hypot == V8 empirically" claim was luck of the
  inputs; `Math.sqrt` remains safe (IEEE-correctly-rounded everywhere).
- **P1 still open:** ramp/jumppad hops (airborne arc), trapdoor rides,
  pits/gravepits, targets/rollovers/lamps (scoring layer), plunger, marble
  materials (hooks default to steel/no-material), multiball, ricochet form,
  sprint/wall-kick/pounce verbs, and the shell feeding real momentum input
  (the wasm/native game still only walks — the sim is ready, the shell's
  launch verbs are not wired).
- **2026-08-09 — Windows-native build live; it is now the play/dev target.**
  `scripts/pk-win.sh run` cross-compiles `pk-game.exe`
  (`x86_64-pc-windows-gnullvm`, user-local llvm-mingw via
  `scripts/setup-win-toolchain.sh` — no sudo) and WSL2 interop launches it
  straight onto the Windows desktop on the host GPU. Verified by screenshot:
  the P1 demo floor (knight, slants, round corner, brass arc guide)
  rendering in a native window titled "Pinball Knight (Rust slice)". Zero
  code changes needed — the wasm-only surface was already `cfg`-gated.
  Debug builds link in ~2 min. Two traps pinned in dev-env.md: the exe
  needs `libunwind.dll` beside it (missing = silent exit 53), and
  `rustup target add` must run inside the repo or it lands on the wrong
  toolchain (E0463). The same tarball ships lldb 22, so
  `scripts/pk-win.sh lldb` gives a working `rust-lldb`. The wasm/trunk
  build stays as the parity gate (pk-check) and the braindeadbot.com ship.
- **2026-08-09 — P1 geometry core ported and verified.** Full tile-shape
  vocabulary in Rust: slants (triangle resolve), rounds (quarter-disc),
  multi-tile arc features (convex guides + concave bowls), kick bands,
  booster lanes (grain check + tangent), arc corners, surfaces tables
  (identity rule pinned). 35 pk-core unit tests (ported from tile-shape /
  collision / surfaces suites) + **two bit-exact 600-tick trace fixtures**
  (spiral + a route through slant → round → arc guide) replaying against the
  legacy engine — which also proves libm hypot/atan2 match V8 bit-for-bit on
  these paths. Demo floor now carries a slant court, a round corner and a
  laned arc guide; pk-check ALL GATES PASSED (60 Hz, input drive, clean
  console, 86 FPS debug wasm); screenshots verified in host Chrome.
- **P1 still open:** marble/momentum modes, pinball-collide reflections
  (surface restitution consumption), ricochet/rail riding, kicker/lane
  *behavior* (collision reports them; player physics must consume them),
  sprint/wall-kick/pounce. Shaped-tile RENDERING is approximation debt for
  P3 (wedge boxes / cylinder / arc segments stand in for real meshes).

- **2026-08-09 — Port harness live (P0).** The parity loop runs end to end:
  legacy vitest exports a 600-tick movement trace computed by the REAL TS
  engine (`port-fixtures.test.ts`) → `assets/fixtures/` → Rust replays it
  **bit-exactly** (`pk-core/tests/movement_trace.rs`). `scripts/pk-check.mjs`
  gates the wasm build in real host Chrome: boot, sim ~60 Hz via
  `window.__pk`, input-drives-movement, FPS report, zero console errors,
  screenshot. First run caught a real 1-ulp bug (see Incidents). Perf
  baseline: 32 FPS debug wasm build @1280×720 — a debug-build number, not a
  budget.
- **2026-08-09 — Full port checklist published** — [Port checklist](port-checklist.md),
  phases P0–P9 with per-phase verification methods. Intro, tavern, ESC menu,
  backtick debug panel are unported scope (P5/P6), not regressions.

- **2026-08-09 — Playable vertical slice, native + wasm-WebGPU.** The knight
  walks the demo floor with the ported collision (wall-slide, border clamp),
  camera-follow at the 38°/45° ortho rig, Diablo-rule low walls, animated
  billboard from the real published sheets (embedded, ÷4 at load), facing
  swaps S/N/E with W mirrored. Verified end-to-end in **real Windows host
  Chrome over CDP** (screenshots + scripted key input). Run: `trunk serve`
  → `http://localhost:8787` in host Chrome, or `cargo run -p pk-game` (WSLg).
- **2026-08-09 — Collision port green.** `engine/{grid,collision}.ts` →
  `pk_core::{grid,collide}`: square-wall sweep-and-clamp, sub-stepping,
  surface reporting, wall contact — 8 legacy test cases ported and passing.
  Shaped tiles (slants/arcs/kick bands/lanes) are M2 with tile-shape.

- **2026-08-09 — Extraction complete.** 870 commits filtered from
  braindeadbot-client (paths `src/objects/dungeon-game` → `src/scenes/dungeon`
  → `src/game/pinball-knight`, plus tavern, forge surface, net/services/utils
  deps, scripts, docs) into `legacy/`, pushed as `main`. `git log --follow`
  reaches file births.
- **2026-08-09 — Legacy oracle green standalone.** `cd legacy && npm ci &&
  npm test`: 246 files / 2,649 tests passed (131 s, metered through
  `scripts/ops/pk-run.sh`).
- **2026-08-09 — Workspace scaffold.** pk-core / pk-assets / pk-audio /
  pk-game / xtask compile; `Mulberry32` ported and pinned bit-exact against the
  JS oracle (5 seeds × 5 draws); `pk-assets` parses all 19+ published sprite
  manifests.

## Broken / not started

- `cargo xtask bake` — only the `--tavern` leg exists (this change). The
  per-rung sprite bake, which is M0's real exit criterion (baked knight frame on
  screen), is still open.
- `cargo xtask dist` — stub: the wasm-bindgen/wasm-opt/brotli release pipeline
  is not built. (`trunk` itself IS installed — 0.21.14 at `~/.local/bin/trunk` —
  so `trunk serve` / `trunk build` work; an earlier note here saying otherwise
  was stale.)
- The slice embeds the knight sheets in the binary and downsamples ÷4 at load
  — a stand-in for the per-rung bake, not the destination.
- P3 post chain is partial: no palette snap/quantize (nor the albedo MRT it
  needs), dither, scanlines, ink outline, heat haze or chromatic aberration, and
  the UI is not composited before the cel grade.
- `wayland` Bevy feature is off (WSL box lacks libwayland-dev); X11 via WSLg.
- Slice clip timing is guessed (8 fps walk / 4 fps idle); real timing ports
  with the animator in M2.
- CI (GitHub Actions) not set up: fmt/clippy/test + wasm build + size check +
  legacy vitest job all pending.
- Legacy `/forge` UI + `next dev` not yet smoke-tested from the new location
  (vitest suite is green; the dev-server path needs one manual run).

## Fixed

- **`cargo xtask bake` was a hard stub** (`eprintln!("not implemented yet")` +
  `ExitCode::FAILURE`). The `--tavern` leg now runs the legacy painters for
  real: `xtask bake --tavern` → `node legacy/scripts/bake-tavern.mjs` →
  `assets/tavern/` (five 84×84 keepers, the 1024×220 ENTER MAZE sign, and a
  `bake.json` recording the legacy rev and sprite config). The tavern shell
  consumes that instead of tinted boxes. Kept deliberately behind a flag so a
  working tavern export is never mistaken for "the sprite pipeline works now" —
  the per-rung atlas bake stays on the Broken list.

## Known environment facts (not bugs)

- The legacy suite must run from `legacy/` (paths resolve relative to it).
- Test/browser runs are metered — the box is shared. See
  [Dev environment](../reference/dev-env.md).
