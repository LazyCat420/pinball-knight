# Status board

The living broken / fixed / working record. **Update this page in the same PR
as the change it records.** Newest entries first within each section.

## Working

- **2026-08-12 — THE INTRO CAMERA WAS FRAMED 1.714× TOO CLOSE, AND THE TITLE
  PHASE COULD NOT SEE IT. Plus B2, the frame-time instrument.**
  `pixel-pass.ts syncCameraFrustum` is called from `render()` — scene-agnostic —
  and re-frames the ortho half-extents to `renderW/(2·PPU) × renderH/(2·PPU)`
  on every frame: **34.29 × 19.29** world units at 1920×1080 and PPU 56. The
  port's intro pinned `ScalingMode::FixedVertical { VIEW_H }` with
  `VIEW_H = 11.25`, the `engineConfig.camera.viewH` **default**.
  - **This is the SAME defect `drive_scene_camera` fixed for the dungeon on
    08-11, and that fix is what left it standing.** It was written as a `match`
    over `AppState` whose `_ => None` arm excluded the intro BY NAME, reasoning
    that the intro owns its own projection. The intro owns its *zoom*. Owning a
    zoom is not owning a frustum. A per-scene copy of an engine-wide rule is a
    copy free to drift, and both drifts framed every screenshot of their scene.
  - **Why three days of A/B sheets did not report it.** `fit_zoom`'s margins
    (`+1.5`, `+2.2`) are world-unit constants in the DENOMINATOR, so scaling
    both half-extents by k scales `fit` by exactly k — and the visible height,
    `frustum / zoom`, is k-invariant at `sweep_u = 1` where `zoom == fit`. The
    two frustums cancel **to the last bit** at the title. At `sweep_u = 0` the
    zoom is the absolute constant `ZOOM_FROM = 2.3`, nothing cancels, and the
    error is the full k, decaying as `k^(1-u)`. That is exactly the shape of the
    A/B table — title 13.3 (correct), sweep 25.3, shatter 60.7, **ranked by how
    little of the interpolation each phase had run.** Plan v3 filed the shatter
    size, the sweep framing and the knight scale as three separate items; they
    are one line. ⚠️ **A defect that vanishes at one end of an interpolation
    reads as a small defect and is not one.**
  - `the_title_zoom_cancels_the_frustum_and_the_shatter_zoom_cannot` pins the
    cancellation itself in pk-core, with no Bevy, so it survives whatever the
    shell does to its camera next. `PixelSizing::frustum(zoom)` is now the one
    derivation for all three scenes, and `drive_scene_camera`'s `match` **lost
    its `_` arm** — a scene added later cannot inherit a framing decision by
    falling through; it is a compile error until someone states which frustum
    it wants.
  - ⚠️ **THE A/B MEAN COULD NOT ADJUDICATE ITS OWN FIX, AND SAYING SO IS THE
    RESULT.** Measured after: shatter **60.7 → 55.0**, over32 79.2% → 68.3%;
    sweep **25.3 → 26.6**; title 13.3 → 13.4; run/bonk unmoved (they are a 2D
    canvas and never touched the 3D camera). The rig's own stated precision on
    the fast phases is ±4-5 at N=1 (I-3), so *none* of those deltas is
    resolvable — including the one that went the "wrong" way. Correctness here
    rests on the source arithmetic, which is exact, and on the sheets, which
    show the knight going from filling the frame to a small sprite. **The sweep
    mean rose because the board MOVED into pixels that were previously black:
    a diff mean is not monotone in correctness when geometry moves.**
  - ⚠️ **A scale probe was built and CUT rather than shipped half-working.**
    Bounding-box extent cannot answer "same zoom?" — at the wrong scale both
    sides clip and both extents are lower bounds that look alike. Tile-pitch by
    autocorrelation resolved the port side (46.08 → 24.70 px) and returned NO
    SIGNAL on the oracle, on the dungeon sheet, on both sides. The cause is
    worth keeping: **averaging rows before autocorrelating cancels a DIAGONAL
    lattice** — at yaw 45° the tile phase shifts row to row. The next attempt
    must sample along the lattice axis, or read the frustum off both probes
    directly, which is exact and cheaper than inferring it from pixels.
  - **B2 SHIPPED** (`pk-game/src/perf.rs`): a per-frame `PerfWindow`
    accumulator — p50/p95/p99/max/min/mean over 240 frames — plus a
    `SceneCensus` (entities, meshes, lights, materials, UI nodes), published on
    `__pk.perf`. **It accumulates every frame and publishes on a cadence, never
    the other way round**; a sampled frame time misses exactly the excursions a
    budget is about, and a 5-frame sampler sees 48 of 240 frames. The window
    resets on a scene change, because a p95 that straddles a descend describes
    neither room. `PK_PERF_LOG=<secs>` gives the **native/Windows exe a capture
    path**, which B3 named as its one piece of new work — a windowed exe on the
    host desktop is not reachable over CDP and an on-screen readout pasted into
    a chat window is not a measurement.
  - **[The route to 1:1](one-to-one-route.md)** is the new front page for the
    remainder: 24.0% converted, **61,852 lines across 210 files not started**,
    reconciled per directory, with what a player sees missing beside it.
  - Gates: `cargo test --workspace` **876 passed, 0 failed, exit 0** (867 + 9),
    `cargo fmt --check` clean, per-crate clippy at deny clean, full intro A/B
    re-run in real host Chrome.

- **2026-08-12 — Two more intro defects, both found by LOOKING at the run sheet
  after the camera landed. One of them is a layer error, not a paint error.**
  Filed as 2-5 and 2-6 in [the route to 1:1](one-to-one-route.md).
  - **The intro HUD is in the wrong LAYER.** The oracle paints `WORLD 1-1`,
    `COIN x00` and `ANY KEY — SKIP` *into the 2D overworld canvas*
    (`intro/index.ts:662-680`) — 10 px / 8 px `PIXEL_FONT_LABEL`, white fill
    with a **3 px `#1c2a38` stroke**. The port spawns them as Bevy `Text` UI
    entities in `default_font`, unoutlined. The cosmetic half is visible on
    `ab-intro-run`; **the behavioural half is what makes it a defect**:
    `beginShatter` snapshots that canvas, so the oracle's HUD text breaks into
    shards with the rest of the world and the port's structurally cannot. The
    letters `COI` are legible among the oracle's shards. A layer error and a
    font error look identical in a still frame — the SHATTER is what separates
    them, and only because the two were photographed side by side.
  - ⚠️ The oracle's string is `ANY KEY — SKIP` with U+2014, the port's a
    hyphen. Same class as the U+2212 minus sign already pinned: **a glyph the
    atlas lacks draws nothing, silently**, and `measure` still returns the
    monospace advance for it.
  - **The intro knight is the wrong sprite and too large.** Everything else in
    that frame lands — sky gradient, clouds, hills, brick ground, the `?` block
    — which is what makes the knight's rung/scale the whole of the run phase's
    17.2. A frame that matches everywhere except its subject is a *cast* list
    problem, not a renderer problem.
  - ⚠️ **A worktree that `ExitWorktree` reported as KEPT was reaped anyway**,
    taking a finished 5m46s release build with it. The commit survived because
    it had already been merged `--ff-only` into `main` and pushed. Merge and
    push before trusting a worktree to still be there — see
    [[worktree-ownership-and-auto-reap]].

- **2026-08-12 — B1, the sim's benchmark suite: the sim is 1 part in 100,000 of
  a frame, and the RELEASE build fails two pk-check gates.**
  `cargo run --release -p pk-core --example perf_suite`. The worst tick in the
  game — the pinball ride, sub-stepping — is **299 ns**; a frame at the measured
  32 fps is **31 ms**. The obvious objection, *debug is several times slower so
  these are numbers about the build*, was **tested rather than assumed and is
  false**: release wasm measures **32.1 fps against debug's 31.3**. Everything
  that costs anything is render-side and nothing in this project can see inside
  it — that is B2 in [plan v3](port-plan-v3.md) §4.
  - **The price of determinism, measured for the first time**: `js_pow` is
    **4.2×** `std::powf` (36.8 vs 8.7 ns), and `js_hypot` is *faster* than std
    (2.7 vs 3.9). Worth paying; no longer a shrug.
  - **The horde's AI will never be the bottleneck**: `flow_step` is 7.6 ns, so
    72 monsters steering at 60 Hz is 33 µs/s.
  - **A floor build is 3.31 / 4.20 / 5.28 ms** (L1/L3/L5) for nine of
    twenty-three passes — the loading-screen budget's first number.

- **2026-08-12 — the enemy-table drift gate was RED on one byte, and the port
  plan is re-baselined off the ledger ([v3](port-plan-v3.md)).**
  `cargo test --workspace` had **one failing test** at `8cb9415` (867 pass with
  the fix, exit 0):
  `export-enemy-constants.mjs` ends with a trailing blank line, `cargo fmt`
  strips it from the committed `enemies.rs`, and the test compares byte for
  byte — so a generated file that **cannot round-trip through the formatter**
  failed its own drift gate from the commit that created it. The message said
  `committed: (length differs)` / `oracle: (length differs)`, which names
  neither side; it now prints bytes and lines when no line differs. Sabotage:
  `REAPER_SPEED_MAX` 6.2 → 6.3 still fails and now names the constant.
  - **`cargo xtask coverage` grew `--by-dir` and `--all`.** `--todo` printed 40
    of 210 files with no note, which reads as a complete work list. The
    per-directory table reconciles exactly to 61,852 — and it exists so the
    plan pages stop deriving their track tables from `pk-coverage.sh`, the
    upper-bound heuristic the ledger was built to replace.
  - **Three instruments carry stated holes** (v3 §5): `pk-drift.sh` covers
    `src/` only and `public/sprites` already differs by 8 files; `pk-ab-dungeon`
    never checks that both sides photograph the same place; the intro rig's
    precision on `bonk`/`shatter` is unstated and both moved ~4-5 points across
    a day with no art touched.

- **2026-08-12 — P-1: `cargo xtask coverage`, the provenance ledger. The port
  is 22.4% converted, and the number is now defensible.** Every one of the 105
  Rust modules declares `PORTS:` / `PORTS-PARTIAL:` / `PORTS-NOTHING`, the tool
  reads DECLARATIONS rather than substrings, and a citation naming no legacy
  file is a hard failure. **63,242 lines across 212 files are NOT STARTED.**
  - **The heuristic and the ledger disagree by design**: `pk-coverage.sh` says
    50% uncovered, the ledger says 22.4% converted. CI now prints both, because
    resolving the gap silently would always resolve it toward the flattering
    number. `scripts/pk-coverage.sh` counts a legacy file as covered when any
    `.rs` merely mentions it — which scored `maze/decorate.ts` (3,169 lines,
    zero written) as done off a **prose comment** at `track_floor.rs:77`,
    `entities/player.ts` (2,445) off `tavern/player.rs`, and `maze/build.ts`
    off two Cargo **build scripts**. `the_biggest_gaps_are_reported_as_gaps`
    pins all three against the live tree.
  - **Bootstrapping it found two false claims and a self-inflating one.** 85 of
    105 modules already cited their source in prose, so the declarations were
    derived from what was there — and the derivation was wrong twice:
    `tavern/mod.rs` cites five files inside a *"Deliberately NOT here"*
    paragraph, and `state.rs` calls itself "the SEED of the port" (now
    `PORTS-PARTIAL`). Worse, the tool read **its own documentation** — which
    names `decorate.ts` while explaining the bug — and filed it as a port,
    inflating the count by ~7,600 lines. It skips its own source now.
  - **An `include!`d file cannot carry `//!` at all** — rustc rejects it, which
    is why `cards_catalogue.rs` always had `//` comments. The parser reads both
    forms; the first attempt to "fix" that file broke the build.

- **2026-08-12 — 4A-2: the walk is the oracle's walk — accel/friction ramp,
  the floor underfoot, and SPRINT.** The dungeon moved at a flat
  `PLAYER_SPEED`, ignoring both the smoothed `curSpeed` ramp
  (`player.ts:2188-2190`) and the floor's `walkMult` — so sand was not heavy
  underfoot on the walking path even though `surface_at` landed in 1c-1. Shift
  did nothing in the dungeon while the tavern had bound it since P6.
  **The finding that matters is about the fixtures, not the walk:**
  - **Two "movement" fixtures do not pin movement.** `movement-trace-seed7` and
    `shaped-trace-seed7` are exported by a loop that calls `moveCircle` DIRECTLY
    at a constant speed (`port-fixtures.test.ts:142-160`) and never enters
    `updatePlayer`. They pin COLLISION. The Rust side replayed them through
    `simulate()`, which was equivalent only while the walk was flat — so the
    moment the real ramp landed they went red at tick 0 (0.0153 against a wanted
    0.07). **Fixing the port to satisfy them would have deleted a correct
    transcription to please a pin that never measured it.** They now replay
    through `move_circle`, as their own exporter does, and the walk profile got
    its own tests. `pinball-trace-seed7`'s walking branch is the same mirror
    ("same as trace()", `:442-450`) and pre-charges `cur_speed` for the same
    reason — what it gates is the RIDE.
  - **A sabotage that "survives" may never have been applied.** Deleting the
    floor-surface term left all tests green, which looked like a coverage hole
    and was one — the demo floor's spawn tile is plain stone (`walk_mult` 1.0),
    so the multiplier was a no-op and the test could not see it. The replacement
    paints the whole floor sand (0.82) and compares against stone. But the FIRST
    re-run also "passed": `cargo fmt` had reflowed the line so the patch never
    matched. Every sabotage now asserts its own application before it runs.

- **2026-08-12 — 4A-1: the parts the dungeon DRAWS are now the parts the ball
  HITS.** `pk_core::pinball` — 1,027 lines, fixture-gated, ticked every frame
  since 08-09 — was running against `parts: Vec::new()` on every floor. Nothing
  in pk-game ever wrote `sim.parts` (`grep -rn "pinball::" crates/pk-game/src/*.rs`
  returned **zero hits**), while `authored_render` drew all 102 of L3-s1's
  bumpers and boosters. The floor was a diorama: `touch_pinball_parts` returned
  at its first line, every frame, and **160 pk-game tests plus five bit-exact
  fixture suites were green throughout.** Four things worth keeping:
  - **The oracle's conversion is `createPinballParts` (`render/pinball-parts.ts:892-955`)
    and it is a transcription, not a design**: `tileCenter(g,i,j)` gives `x`/`z`
    and `dirX`/`dirZ` are `dirI`/`dirJ` **verbatim**. The repair that suggests
    itself — round the direction — points a `boostcurve` at a cardinal the ball
    is not thrown along.
  - **`part.i` is the TILE `i`, not an index.** It seeds
    `spin_pad_phase(elapsed, i)`, which the deflection in `touch_pinball_parts`
    AND the rotor's rotation (`pinball-parts.ts:1260`) both read — so an index
    there desynchronises every spinpad from its own art, silently.
  - **Ten of the seventeen exported kinds are INERT** (`target`, `rollover`,
    `jumppad`, `trapdoor`, `pit`, `firevent`, `electric`, `lamp`, `ramp`,
    `glove`) — they wait on P1's remaining verbs. They are named in
    `INERT_PART_KINDS` and counted in the install log rather than dropped, and
    the `_ => None` arm is kept SEPARATE from that list purely so an eighteenth
    kind from the oracle fails a test instead of joining them.
  - **`bumper_total` is the jackpot's denominator and `pinball-collide.ts:373`
    reads `bumperTotal || JACKPOT_BUMPERS`** — so a total left at 0 does not
    disable the jackpot, it silently retargets it at the constant.

  Sabotage sweep, **4 injected, 4 caught**: index-for-tile-`i` → the coord test;
  rounded direction → the unit-vector test; bumpers silently dropped → three
  tests including the accounting one; an unknown 18th kind → the `_` arm's test,
  by name. The acceptance test drives a ball onto a bumper and asserts it kicks,
  **paired with one that asserts an EMPTY parts list stays inert** — without the
  pair, the first proves nothing about the wiring. 820 workspace tests green.

- **2026-08-11 — The tavern is 1:1: all seven stations do what the old game
  does there.** The dealer (rules + a 100-PNG card-face bake + a three-tab
  screen) and the gambler's cabinet (four games over the 4,123 lines of rules
  that were already ported) were the last two counters, and the run summary's
  `gear`/`purse` em-dashes became real numbers. Three findings worth keeping:
  - **A copied gate can be inert.** The card bake's palette check came from the
    icon bake and could not fire — `monsterPortrait()` installs the palette
    itself. Removing both installs greys 76 of 100 faces and the copied gate
    passed on every one; so did three replacement statistics, because the
    fallback collapses portraits toward BLACK (spread ≈ 0, weight ≈ 0) rather
    than to mid-grey. The shipped gate counts lit pixels on the SUBJECT box.
  - **A budgeted widget is not a drawn widget.** `body_height` reserved
    `FOOT_H` for a BACK key on all three dealer tabs and nothing drew one — the
    counter had no way out, with eleven tests green.
  - **A glyph the atlas lacks draws NOTHING**, and `measure` returns the
    monospace advance for it, so even measuring looks right. `✦` was caught by
    a test that walks every literal the screen can emit.

- **2026-08-11 — V-2: the wall wash. A wall no longer hits differently than it
  looks.** 618 solid tiles on L3 and 482 on L5 carry a non-stone `WALL_*` id
  that already drove the physics and nothing painted. The bucket key gained a
  `surface` and each bucket takes a material tinted by that surface's hex — the
  merged-mesh equivalent of the oracle's per-instance `setColorAt`. Stone is an
  explicit WHITE (in three.js an unwritten instance colour renders BLACK; here
  the same hazard is a defaulted `base_color`), and the tint MULTIPLIES the bake
  so the courses and the normal map still read. A/B mean 30.2 → 30.1, over32
  33.8% → 33.6%; port-frame diff 21,411 px on wall faces, floor untouched.

- **2026-08-11 — A screen can now animate: `dt` reaches the frame, and a
  quiet frame is no longer skipped out from under it.**
  Groundwork for the gambler cabinet, whose four games are ticked state
  machines (`BlackjackTable`, `ThrowMachine`) and a time-sampled ball
  (`frame_at(&spin, t)`). Two things blocked it and both are now done.
  - `paint_gui` short-circuits before `paint_stack` on any quiet frame over an
    unchanged stack — worth a measured 36→14 fps when it regressed, so it
    stays. A screen that moves opts out instead: `ScreenEntry::animating()`,
    `UiStack::animates()` (ANY open screen, not just the top — an animation
    under a modal keeps running, as the oracle's single RAF does), and a fourth
    term in the skip, now named `GuiLayer::may_skip` so the rule is stated once.
  - `dt` is a `paint_stack` PARAMETER, not a clock and not a field on
    `UiInput`: `pk-gui` has no Bevy and must stay headless-deterministic, so
    the shell owns the time and a test advances it in exact steps. On
    `UiInput` it would have reached every non-top screen as `empty_ui_input()`
    — a frozen `dt = 0`. `begin_ui` leaves it at 0.0, which is what a still
    frame is, so the thirteen screen tests that build a frame directly are
    unchanged. The shell clamps to 0.05 s, the value `gambler/index.ts:288`
    clamps to.
  - Seven tests, each shown to fail under sabotage. The load-bearing one drives
    ten frames of a screen painting from an accumulated clock and asserts ten
    DIFFERENT pictures; with `f.dt` forced to zero it collapses to one, which
    is the frozen-cabinet bug it exists to catch.

- **2026-08-11 — The oracle's minus sign is not in the font, so it is
  substituted at draw time rather than baked.**
  `cards.ts`'s `pct()` prints every negative stat with U+2212 MINUS SIGN, and
  a glyph this atlas lacks draws NOTHING, silently — a card would have read
  "12% durability" for a penalty. Adding it to the bake was tried and
  reverted: Press Start 2P has no such glyph, so the harness browser
  substituted a PROPORTIONAL face at advance 4.51 against a monospace 8, which
  breaks the arithmetic every screen budgets by and desynced the cell packing
  enough that the raster bled into its neighbour.
  - The oracle has the identical hole (it draws in Press Start 2P too), so its
    minus signs have always come from a fallback face. Copying the bytes
    faithfully would import a browser's forgiveness into a UI that has none.
  - `pk_core` keeps the oracle's exact string; `font::substitute` maps the
    character in the one lookup measure and draw already share. The bake script
    now says why, where the next reader will look for the omission.

- **2026-08-11 — Fixed: the tavern knight's Y was not pinned, so the pixel
  snap could move him. Real, bounded, and NOT the reported disappearance.**
  `PixelSnapped` rounds along the CAMERA basis, whose up vector is
  `(-0.435, 0.788, -0.435)` under the iso rig, so a snap moves the entity in
  world Y — and `sync_tavern_knight` restored only `.x`/`.z`, defeating the
  fixed point `snap.rs`'s header depends on. Fixed by assigning all three.
  - Measured in real Chrome over ~90 s of scripted REVERSING (the player's own
    repro), peak tracked in-engine every frame: **0.1606 worst deviation with
    the defect, 0.0090 with the fix — an 18× reduction.**
  - ⚠️ An earlier reading of **0.0217** was a Playwright poll every ~50 ms —
    one frame in three, so a *sample*, not a maximum, and 7.4× low. It is why
    this was first written off as "too small to matter". `SnapPeak` now tracks
    min/max in `PostUpdate` right after the snap. Instrument the engine, not
    the poll.
  - ⚠️ **The first diagnosis claimed a runaway off the top of the screen and
    was WRONG** — it simulated a camera parked at the origin, but
    `tavern_camera` eases toward the player, so the offset the snap rounds
    stays bounded. Caught by restoring the bug and measuring rather than
    accepting the fix's green run. A mechanism can match every qualitative
    symptom (tavern-only, walking-only, permanent) and still be off by two
    orders of magnitude on the one that matters.
  - So the probe gained `__pk.tavern.spriteY`, the RENDERED y after the snap —
    not derivable from `TavernRes`, which has no y at all.
  - **`pk-check` passed identically with and without the defect**, confirmed by
    running it both ways. A screenshot gate cannot see a sub-quad positional
    error, nor a disappearance until the subject is already out of frame.
  - Reasoning in [incidents](incidents.md). The general rule: a per-frame
    correction is idempotent only against a FULL assignment. Not "don't use
    `+=`" — *assign every component you do not want the corrector to own*.

- **2026-08-11 — `pk-ab-dungeon`: the measurement device the dungeon never had,
  and the defect it found in its first hour.**
  The tavern has had an A/B rig since it was ported; the dungeon had nothing, so
  "does the dungeon look right" was answered by screenshots pasted into a chat
  window by hand. That is not a gate, and the consequence was structural: effort
  flowed to the part of the port that HAD a number attached — the bit-exact
  generator digests — while the part a player looks at had no instrument and
  therefore no schedule pressure. Nine of twenty-three passes are bit-exact and
  the screen had not changed once.
  - Both sides are booted on the same level and seed in real host Chrome at the
    one matched regime (1920x1080), and it leaves two frames, a captioned
    side-by-side and a difference heatmap. Legacy is pinned with `?seed=` plus
    the dev floor lock in localStorage, both written at DOCUMENT START because
    both are read during boot.
  - ⚠️ **Its first sheet was a loading screen.** Waiting on
    `__dungeonBoss().level` alone photographed legacy's own "FORGING THE MACHINE
    / 90%" card, because `state.level` is assigned before the floor is built.
    The gate now also requires `floor-loading` to be off the GUI stack and a
    live player to exist. The 28.5% diff it reported first time was a number
    computed over a loading screen.
  - ⚠️ **THE DUNGEON CAMERA WAS FRAMED 1.7x TOO CLOSE, ALWAYS.** `main.rs`
    pinned `FixedVertical { VIEW_H }` with `VIEW_H = 11.25` — which is
    `engineConfig.camera.viewH`, the config DEFAULT that legacy overwrites on
    every frame: `pixel-pass.ts syncCameraFrustum` sets the half-extents from
    `renderW/(2*PPU)` and `renderH/(2*PPU)`, with a comment saying PPU stays
    pinned and the FRUSTUM is what moves. At 1920x1080 and PPU 56 that is
    34.3 x 19.29 world units against the port's 11.25 — so every dungeon
    screenshot this port has ever produced was framed wrong, including all of
    yesterday's sign-offs. The dungeon now flexes with the lattice at zoom 1;
    the tavern keeps `fitZoom`, which is the only difference between them.
  - **A test was pinning the defect.** `the_scene_camera_ends_up_pointed_at_the
    _lattice` asserted `FixedVertical` under the sentence "the dungeon keeps its
    own framing" — a test can only say what the code does, and this one said it
    in a sentence that sounded like a decision. It now asserts the flex, and
    `the_dungeon_does_not_ride_the_tavern_zoom` pins the one real difference.

- **2026-08-11 — Two regressions the GUI layer shipped with, both found by
  looking at the game rather than at a gate.**
  - ⚠️ **The tavern's `[E] DESCEND` prompt followed the player into the
    dungeon.** The prompt and the panels used to be `Text` nodes tagged
    `TavernScene`, so despawning the room took them with it. As SCREENS they sit
    on a stack that every scene shares and nothing was closing it —
    `teardown_tavern` does now. A layer shared by every scene has to be closed
    by the scene that opened it, because the systems that could close it are
    gated on the state that just ended. Gated in `pk-check`: `gui.open === 0`
    after DESCEND.
  - ⚠️ **Repainting every frame cost more than half the frame rate, and it
    surfaced three files away.** Immediate mode rebuilds the WIDGETS each pass;
    it must not rebuild the PIXELS. A 756×482 clear plus a 1.4 MB texture write
    at 60 Hz — to redraw a caption that had not changed — took the tavern from
    36 fps to 14. What actually failed was the browser gate's walk to the
    DESCEND board: `publish_stats` samples every 5 frames, so at 14 fps each
    check read a pose 357 ms old, the north leg overshot its lane by 1.4 units,
    and every later leg was inside the wall behind the board. It reads as "the
    room changed", not as "the renderer got slower".
    - The skip needed TWO fixes, and the first alone would have looked like it
      worked: `ResMut` marks a resource changed on the DEREF, so a scene
      assigning an identical view every frame kept the dirty flag set forever
      (`set_view` compares first), and `pointer_moved` was set whenever a cursor
      was over the window rather than when it MOVED. Now 41-45% of driven
      frames repaint, the tavern is back at 33 fps, and `pk-check` gates the
      ratio — a repaint fraction near 1.0 means the skip is dead again.
  - The harness's walk got the tolerance it always needed: 140 ms legs instead
    of 260, and a correction leg south, because the corridor east of the board
    is a BAND and an overshot leg lands in the wall behind it.

- **2026-08-10 — The game generates its floors, and the tavern has a real menu.**
  Two reports, one cause each, and both causes were a switch left in the wrong
  position rather than missing work.
  - **The maze did not render because the flag that rendered it was off.**
    `--real-floor` shipped the nine landed passes on 08-10 and the game
    everybody plays passes no flags, so every descend still built
    `demo_floor(7)` — the 25×25 pillar arena. The default is now the generated
    floor; `--demo-floor` / `?demo-floor=1` / `PK_DEMO_FLOOR=1` asks for the
    arena by name. The refusal path is unchanged and still does not fall back.
  - ⚠️ **`requested()` could not stay the boot gate.** It answered "is a
    generated floor planned", which the inversion makes always true — using it
    to choose the start state would have booted every run straight past the
    intro and the hub onto a floor. `FloorPlan` splits the two questions:
    `next` is what a descend builds, `boot_into_floor` is whether a flag asked
    to open on one. Pinned by `asking_for_nothing_generates_a_floor`.
  - **Floors are PLURAL now.** `descend_at_exit` takes the run one level deeper
    when the knight stands on the provisional exit, and `FloorPlan::restart`
    puts it back to `--level`'s value when the run leaves for the tavern — so a
    flag survives a hub round trip instead of quietly meaning floor 1. The
    marker is still not stairs (pass 21 authors those); the RULE is what is not
    provisional.
  - **`pk-gui` reached a screen.** The toolkit merged on 824ee0d is byte-exact
    against the browser that authored its goldens and had no way to display
    itself; `pk-game/src/gui.rs` is the upload, the input feed and the schedule
    it names in its own header. The tavern's station prompt and panels are now
    screens on that stack — sheet, rivets, 16px arcane heading, ruled rows, a
    focused CLOSE button — instead of `Text` nodes with hand-rolled chrome, and
    three `Query`s left `tavern_frame`'s parameter list.
  - ⚠️ **The prompt updated one frame before the panel that hides it.** `frozen`
    is read at the top of `tavern_frame`, so on the frame a sheet OPENS it still
    says "nothing is open" and the prompt survived underneath its own panel for
    exactly one frame. The browser gate read stack depth 2 on one run and 1 on
    the next and disagreed with itself. The prompt block moved BELOW the panel
    block; it now answers this frame's question.
  - ⚠️ **A background tab throttles rAF and the dwell is wall clock.** The
    loading-card capture polls for `painted >= 10`; in a background tab that
    poll costs more than the whole 2.5 s hold, so the state ended and the
    screenshot landed on the dungeon — passing on one seed and failing on the
    next depending on which tab the host Chrome had in front. `bringToFront`
    moved BEFORE the poll (it was between the poll and the shutter, one step too
    late), the hold is 6 s, and the gate now re-reads the state AFTER the
    capture so the failure names its cause instead of printing a byte count.
  - **`routeToExit`: the whole shortest path, published.** The BFS field was
    already swept for `pathDistance`; walking it down turns "the exit is
    reachable" into a route something can be driven along, and
    `the_route_to_the_exit_is_a_walkable_path_that_arrives` replays every step
    on ten levels. ⚠️ **The DRIVEN descend is not a gate yet.** A CDP walker
    arrived on L1 seed 163 (runLevel 2, a different `floorSeed`, the same
    `runSeed`) and failed the next run on the same seed: the knight carries
    momentum, an overshooting leg leaves the next one a row off its corridor,
    and it walks into a wall. Parked deliberately rather than shipped flaky —
    `floor_ascii --scan 300` names L1 seed 163 (30 tiles, 3 turns) as the
    cheapest floor for whoever finishes it.
  - Gates: `cargo test --workspace` (22 suites), fmt, per-crate clippy at deny,
    the full default `pk-check` and `pk-check --real-floor` on two seeds.

- **2026-08-10 — `Tavern -> FloorLoading -> Dungeon`: one door into a floor, and
  a loading screen that is provably on screen.** Two places used to build a
  floor — the boot gate and the DESCEND board — and both did it inside the frame
  that had just been asked to draw something else, so a descend was a stall with
  nothing on it. `Dungeon` no longer builds anything; it INSTALLS a
  `PreparedFloor`, and `FloorLoading` is the only thing that makes one (stated
  as a run condition, not a comment).
  - **The number the screen exists for, measured before anything was designed
    around it.** Native release, min of 5: generation 3.3 ms at L1 to 18.0 ms at
    the L23 cap; validation and `SimState::new` are 0.0-0.2 ms. In the debug wasm
    build the browser reports **prepare 106 ms, install 13 ms** — so generation
    dominates, the mesh build and GPU upload are the small half, and at pass 9 a
    descend costs ~120 ms. `MIN_DWELL_MS` is therefore labelled in the source as
    what it is: theatre, 300 ms, a floor and never an addition.
  - ⚠️ **`painted` counted `Update` runs, not presented frames — and the whole
    paint-before-build design rested on it.** On a cold wasm boot Bevy's first
    two `Update`s are ~2.5 s apart while shaders compile, and nothing has been
    presented in that window. A dwell clocked from state ENTRY was therefore
    fully spent before the renderer drew anything: the probe reported
    `painted: 2`, the browser gate believed it and went green, and the
    screenshot taken at that exact moment showed the DUNGEON. The dwell now
    starts at `ready_ms` — when the floor is built — so the beat is served on a
    renderer that is awake.
  - ⚠️ **A transient state was invisible to its own instrument.** `publish_stats`
    samples every 5 frames; `FloorLoading` lives ~300 ms and the first five
    frames of a cold boot take longer than that, so the state was entered,
    painted and left without the probe publishing once. It now publishes EVERY
    frame in that state. A state must not be unobservable because of the
    sampling rate of the only thing that can see it.
  - **`?loading-hold-ms=N` exists because the screen was otherwise
    unphotographable.** At the debug build's frame rate the card lives about
    three frames; by the time a poll observes the state and asks for a picture
    the state is over. The gate holds it, waits for `painted >= 10` so the
    renderer is demonstrably producing frames, then captures — and asserts the
    PNG is card-sized (~11 kB) and not maze-sized (~32 kB), with `floor === null`
    proving there is no dungeon behind the curtain.
  - The ASCII guard written after the `87x61` tofu box earned its keep the same
    afternoon: the loading card's first draft used `U+00B7` separators and the
    unit test caught it before a screenshot had to.
  - Gates: `cargo test --workspace`, fmt, per-crate clippy at deny, wasm32 +
    windows-gnullvm, `pk-check --real-floor` (24 gates) and the full default
    `pk-check` run for the DESCEND path this change rewires.

- **2026-08-10 — The game stands on the generated floor: `--real-floor`.**
  `setup_dungeon` built `demo_floor(7)` — a 25x25 pillar arena — on every
  descent, which is why the dungeon looked like a pad arena no matter how many
  maze passes landed. Behind `--real-floor` / `?real-floor=1` /
  `PK_REAL_FLOOR=1` it now boots the nine landed passes: L3 seed 1 is an 87x61
  Great Hall, spawn on the pass-7 start tile, provisional exit marked, banner
  naming the floor on screen.
  - **The derivation stopped being two copies.** `maze_pass_digests.rs` had
    reproduced `authorFloor`'s pre-track stream by hand since pass 1; the shell
    needs the same three lines with no fixture to read `cellsW`/`density` out
    of. `pk_core::maze::floor_spec::derive_floor_spec` is now the one
    derivation and the harness calls it — with the hand-written stream KEPT in
    `archetype_tables_match_the_oracles_profiles` as a differential second
    opinion, so the two are asserted equal rather than merged and hoped for.
  - **The fixture cannot launder a regression.** `real-floor-l3s1-p9.json` is
    written by the port about itself, so nine of its fields (`floorSeed`,
    `cellsW/H`, `w/h`, `density`, `draws`, `tileDigest`, `walkableTiles`,
    `start`, `provisionalExit`) are cross-checked against
    `maze-pass-digests.json`, which came out of the legacy TypeScript
    generator. A re-export taken after a regression fails that comparison.
  - **The wall probe: a collision claim a browser can replay.** pk-core derives
    a scripted move from the spawn toward the nearest square wall and an
    ANALYTIC clamp (tile face + body radius) — arithmetic the sim never
    performs, so it is an oracle rather than the collider agreeing with itself.
    Both halves are checked: the body must REACH the wall (a frozen sim fails)
    and must not pass it. In host Chrome it stopped at z=2.1999 against a 2.2
    face.
  - ⚠️ **The first probe derivation was measured wrong and would have shipped
    dead.** It only looked at the four tiles touching the spawn — and 39 of 40
    floors open at a launch chute's park tile, whose four neighbours are all
    floor. **1 of 40 floors produced a probe.** The browser collision gate would
    have silently done nothing on 97% of floors. Walking up to six tiles fixed
    it; the test now asserts 40 of 40 rather than "it works on the pinned one".
  - ⚠️ **Two defects only the SCREENSHOT found**, both green on every automated
    gate including the one asserting the banner string: the banner drew on top
    of the centred frame-time readout ("start=20.21ms (49 fps)"), and the `x` in
    `87x61` was `U+00D7`, which Bevy's `default_font` renders as a tofu box. The
    banner test now asserts `is_ascii()` — the property that was violated, not
    the character that violated it.
  - ⚠️ **The obvious canvas-liveness probe fails green-adjacent.** Reading the
    WebGPU canvas back with `drawImage` + `getImageData` returns a blank buffer,
    so the gate reported "1 distinct colour" over a screenshot plainly showing a
    maze. Replaced by a property of the PNG Playwright actually composited:
    ~32 kB for this frame against ~1.8 kB for a solid-colour frame of the same
    dimensions (measured by building one).
  - **No silent fallback, and it is driven, not asserted.** A refused request
    paints a red card and builds NOTHING — `?level=banana` is a gate that checks
    `floor === null` and that no sim was installed, with its own screenshot.
  - Gates: `cargo test --workspace` (19 suites), fmt, per-crate clippy at deny,
    wasm32 + windows-gnullvm builds, jsmath wasm parity (40 comparisons), and
    `node scripts/pk-check.mjs --real-floor --level 3 --seed 1` — 20 gates, all
    green, in real Windows host Chrome.
  - ⚠️ Still nine passes of twenty-three. No `T_STAIRS` (pass 21), no published
    arcs (pass 10), no boss chamber (pass 15), and the exit is the PROVISIONAL
    pass-7 pick that `endpoints-final` re-picks at pass 14. `--real-floor` stays
    a flag until pass 21.

- **2026-08-10 — P2 passes 7 and 8, both bit-exact on the first run, and the
  sabotage sweep that says what those two green boundaries are worth.** 8 of 23
  land, all ten corpus floors bit-exact. `pk_core::maze::track_socket` (the
  plumbing repair) + `pick_track_endpoints` + `crate::flow_field` (the BFS the
  generator measures with — pk-core had none).
  - **26 injected defects, 10 caught, 16 shipped green.** Four positive controls
    were all caught, so the gate is alive and the leak is what ten floors cannot
    discriminate. Full table in `maze::track_floor`'s header. Five survivors are
    branches the corpus never enters (measured: the sight-line relaxation ladder
    fires on **0/10** floors, `start_band` on **1/10**, the heal's join half is
    unreachable at `reach = 0`, no `T_CRACKED` tile exists before `decorate`);
    four are TIE-BREAKS with no tie to break, which is the third pass in a row to
    report that hole.
  - **`connect_all` carves NOTHING at `repair-1`** — 0 tiles on 10/10 floors, and
    provably so rather than by luck: `uncarve_dead_ends` only fills tiles with
    ≤1 open neighbour, and removing a leaf from a 4-connected component cannot
    disconnect it. So the legacy comment's ordering rationale ("uncarve first,
    which is fine only because connectAll runs after it") is a true statement
    about the wrong pass — the order earns its keep at `repair-2`, behind the
    curve passes that fill corner pockets with no degree constraint. Two
    sabotages ride on this (moving `connect_all` after the de-stub; withholding
    its 36-92-tile keep-out mask) and both become real defects at pass 13.
    `repair_1_stands_on_a_floor_that_is_already_connected` pins the premise so
    the explanation fails loudly when it stops holding.
  - **The uncarve budget never binds.** 81-244 tiles filled against budgets of
    296-1,044, so the `0.12` fraction — and the 1.5%-of-grid unravelling the
    legacy comment justifies it with — is untested here. Disabling the pass
    outright IS caught, so the gate sees the pass; it just cannot see the cap.
  - **The endpoints' protection list is redundant at this pass**: both ends are
    lane tiles and the uncarve already refuses every lane tile. Asserted, not
    assumed.
  - **A harness defect, found by being the first boundary with two `extra`
    keys.** `assert_record` compares each pass's scalars positionally and its
    comment claims "an order change is a change" — but `serde_json`'s default
    `Map` is a `BTreeMap`, so the fixture's key order was destroyed at parse time
    and the comparison was silently alphabetical. It failed on `start`/`stairs`
    (alphabetically `stairs` first) the moment a boundary had two keys to
    reorder. Fixed with the `preserve_order` feature, which makes the documented
    contract true; the six single-key boundaries before this one could not have
    noticed.
  - **A defect in the original, pinned rather than fixed.**
    `healRoadTerminations`' rejoin scan takes the nearest lane tile in any
    cardinal — and for a stub at the end of a run that is the tile two steps BACK
    ALONG ITS OWN RUN. So it reports a join, carves over floor that is already
    floor, and leaves the stub. That is the mechanism behind the legacy comment's
    own *"joined fired 8-24× per floor while the count never moved"*. The
    shipping pipeline is immune (`reach = 0`), which is why it is pinned as
    behaviour: a fix would change no floor and would desynchronise the port.

- **2026-08-10 — P2 passes 5 and 6, and the two things that make `grow-maze`
  the hardest pass in the pipeline.** 6 of 23 land, all ten corpus floors
  bit-exact.
  - **`Array.prototype.sort` is an RNG SOURCE here.** `growMazeAround` shuffles
    its four directions with `[...dirs].sort(() => rng() - 0.5)` — the classic
    broken shuffle — and every comparator call spends a draw. Measured against
    node: V8 makes **4 comparisons for eight of the 24 outcomes and 5 for the
    other sixteen**, so the count is data, not overhead. `pk_core::jssort`
    reproduces V8's binary insertion sort trace-for-trace (all 24 traces pinned,
    argument order included). ⚠️ The model was swept across lengths and **breaks
    at eight** — TimSort's run detection takes over, costing 7 comparisons where
    binary insertion costs 17 — so `js_sort_by` PANICS above 7 rather than
    returning a plausible order with the wrong draw count behind it.
  - **`density` is not a default, it is the windiness draw.** Pass 6 came out
    548 draws long on L1 s1 with the walkable count only 2 tiles out — a floor
    that looks almost right and shares no random stream with the oracle. Cause:
    `spawn/floor-authoring.ts:159` passes
    `density: Math.max(0.35, Math.min(0.85, windiness))` into `buildTrackFloor`,
    and the port was treating the windiness draw as bookkeeping and letting
    `growMazeAround`'s own `?? 0.62` apply. The harness now derives it and
    asserts it against the `density` the fixture pins per floor.
  - **The draw count is what found it**, in one read. Counts were within 2 and
    every digest was wrong; draws were 5657 against 5109. That is the localiser
    working exactly as the harness's header says it should, after three passes
    (2–4) where it was silent by construction.
  - Pass 5 `launch-chute` sabotage table and its two coverage holes are in the
    commit and in `maze::track_launch`'s header: four of eleven defects survive
    as TIE-BREAKS (no two sites in this corpus score exactly equal, so both sort
    stabilities and both scan orders are unverified), and the corpus's
    `perimeterBias` values leave the `>= 0.5` compliance threshold in an empty
    gap between 0.15 and 0.7.

- **2026-08-10 — P2 pass 3 `carve-track`: 10 of 10 bit-exact, and a boundary
  that gates structure and not arithmetic.** `pk_core::maze::track_carve` — the
  first pass that writes a tile. Legs and fillets swept as discs; the
  [`TrackMask`] every later pass reads is born here. Bit-exact on the whole
  corpus on the first run.
  - **Sabotage-measured, and six of ten injected defects SURVIVED.** Caught, all
    ten floors: the leg step 0.35→0.36, the fillet sweep width hardcoded to 2,
    the legs not carved at all. Caught on one floor: the arc step floor
    `max(2)`→`max(1)`. **Not caught at all:** `libm::hypot` for `js_hypot`,
    `libm`'s `cos`/`sin` for the twins, `d > r` relaxed to `d >= r`, the `i1`
    clamp widened from `w-2` to `w-1`, and `(span*s)/steps` rewritten as
    `span*(s/steps)`. Everything this pass does is a threshold test or a rounded
    step count, and a last-bit difference almost never flips one — so the trig
    and hypot guarantees for pass 3 rest ENTIRELY on `tests/jsmath_oracle.rs`.
    Ten green floors here would be ten green floors with the wrong trig library
    compiled in. Same shape as pass 2's finding, now with a number on it.
  - **One claim retracted before it shipped.** The port's `disc` carried a
    comment calling the `Float32Array` compare-in-f64/store-in-f32 split a trap.
    The sabotage says otherwise, and then the algebra explains why: when
    `d as f32 == dist[k]` but `d < dist[k]` in double, the store writes the
    value already there. The two forms cannot disagree. Transcribed the TS way
    because it is the TS way, not because it defends anything.
  - **A real gap the corpus has:** no disc on any of the ten floors reaches the
    last column, so widening the `w-2` clamp changes nothing and a lane pressed
    against the border is untested.
  - **`prefix_through_path`** now factors the shared pipeline prefix. Twenty
    more passes are coming and each needs every pass before it re-run against
    the same rng stream; twenty hand-copied prefixes is twenty chances for one
    to drift into testing a pipeline the oracle never ran.

- **2026-08-10 — `js_pow` was three different functions, one per target.**
  The wasm measurement Stage A asked for, and it found a live defect on BOTH
  non-native targets. `f64::powf` matched the oracle on linux-gnu, was fdlibm on
  wasm (19,904 / 200,001 on x^1.35), and on **windows-gnullvm — the play
  target — was a third implementation again** (201 / 200,001, and not fdlibm).
  Two unrelated causes, which is why "wasm falls back to fdlibm" was a correct
  theory that still missed the target people actually play on.
  `jsmath::pow_arm` now carries ARM's optimized-routines `pow`.
  - **The transcription alone was not enough.** Faithful to the C, both
    `HAVE_FAST_FMA` arms tried, still 153 / 200,001 out. The missing arithmetic
    is in the BUILD: glibc compiles that file with `-mfma` and GCC's
    `-ffp-contract=fast` fuses `a*b + c` into single `fma`s the source never
    writes. Five builds settle it — with contraction 0, without it exactly 153 —
    and `-fdump-tree-optimized` names each fusion, including the two GCC
    declines. See Incidents for the rules this adds.
  - CI now exists at all (`.github/workflows/`), including both target-parity
    gates. It cannot run pk-check; that stays manual on the host GPU.

- **2026-08-10 — P2 pass 2 `track-path`: 10 of 10 floors bit-exact, and the
  fixture that could not have told.** `pk_core::maze::track_path` — the grown
  graph turned into legs and fillets. Bit-exact on the whole corpus on the
  first run, which is a fact about pass 1 as much as pass 2.
  - **The gate had to be built before the port could be believed.** The
    `track-path` boundary pinned `extra: { legs: N }` and the two graph digests
    — and the graph there is pass 1's output, unchanged. So the ONLY thing the
    fixture said about pass 2's own output was a leg COUNT. Worse, this is the
    one pass in the pipeline that draws NOTHING from the rng, so the cumulative
    draw count — the localiser every other pass leans on to split "wrong
    sequence" from "wrong arithmetic" — is identical on both sides by
    construction. A port that pulled every leg back by the wrong setback would
    have matched. `pathLegs` / `pathArcs` / `pathArcHalf` added to the exporter;
    nothing existing weakened.
  - **`Math.tan` and `Math.atan2` are `libm`'s, and std's are wrong** — swept
    for the first time here (4 `tan` ranges, 2 `atan2` lattices), with std
    pinned as still-wrong per range and the maze corpus separating them
    independently: `f64::tan` moves L3 s1's legs, `f64::atan2` moves L1 s1's.
    The expectation going in was that `tan` would need a twin like `cos`/`sin`
    — it shares their argument reduction and its kernel is the one FreeBSD
    rewrote after 1993. It does not. There is no family rule, only the sweep.
  - **Two things ten green floors provably do NOT prove**, measured by
    swapping the call and re-running:
    · `js_hypot` vs `libm::hypot` differ on 266 of the 790 hypot calls this
      pass makes (34%) and change NO pinned digest — hypot only feeds two
      inequalities here (`budget`, `sa + sb >= len − 0.5`) and a 1-ulp shift
      flipped neither. The twin is still what is called.
    · `js_cos`/`js_sin` differ from `libm`'s on 8 of 790 leg bearings and the
      swap survives FIVE corpus floors before L8 s1 catches it: a 1-ulp error
      scaled by a ≤7-tile setback is ~8e-16 against a ~3.6e-15 ulp on the
      coordinate it lands in, so it usually rounds away. A corpus that stopped
      at L5 would have certified `libm::cos`.
  - **Found in the original:** the `radii[0]` clamp and the one-setback-per-
    junction rule cannot both hold at a junction whose pairs turn through
    different angles, so a non-maximal pair's fillet is NOT tangent to its
    legs. Measured 1.81 tiles on a three-leg fixture — past the 1.2 the legacy
    tangency test calls a floating fragment; that test survives because it is
    statistical (allows 6%). Authored behaviour, pinned as its own test so the
    port is not blamed for it later.
  - **Measured:** `cargo test -p pk-core --release` green (353 lib + 20
    integration); fmt and clippy clean; both fixtures re-exported from real
    node with every previously pinned value unchanged.
- **2026-08-10 — `js_exp`/`js_log`, and the reminder that a digest is a verdict
  and not a diagnosis.** Both twins bit-exact: `js_exp` over 8 ranges (including
  the overflow/underflow thresholds, the subnormal tail and both `ln2` split
  points), `js_log` over 5 (the `k == 0` band, the |f| < 2^-20 neighbourhood of
  1.0, subnormals, and up to `f64::MAX`).
  - The survey said `NOTHING MATCHES` for both, and the two rows had **nothing
    in common**. `log` is the `cos` story — musl's table-driven version vs
    fdlibm 5.3. `libm::exp` already IS fdlibm and misses the runtime on exactly
    ONE input in ~400,000: `x == 1`, where V8 answers `Math.E`.
  - So the fix for one was a 200-line transcription and for the other a
    one-line guard, and the digest could not tell them apart. Dumping raw f64s
    and diffing per input named it on the first run.
  - The negative controls had to become per-range: `libm` now agrees with the
    runtime on five of the new sweeps, so a blanket "libm disagrees" would pin
    a falsehood. `libm::exp`'s divergence is pinned at exactly one range.
  - **Not yet switched:** `combo.rs` and `intro.rs` still call the wrong
    implementations. `combo`'s `log(1 + k·n)` lands inside the divergent band,
    so it needs `pinball-trace-seed7` + `booster_corner_sim` re-verified;
    `intro.rs`'s camera zoom has no fixture covering it at all.
- **2026-08-10 — `js_cos`/`js_sin`: V8's trig is Sun's 1993 fdlibm, and P2 pass
  1 is now 10 of 10 floors bit-exact.** `jsmath/fdlibm.rs` — `s_sin`/`s_cos`,
  `k_sin`/`k_cos`, `e_rem_pio2` and `k_rem_pio2`, transcribed verbatim. The
  cause was evaluation ORDER, not constants: musl and glibc both took FreeBSD's
  2002 split-polynomial rewrite and dropped `__kernel_cos`'s `qx` branch; V8
  kept the Horner form. The by-name exclusion list (L3 s1, L13 s1) is DELETED,
  which is what the equality assertion on that list was there to force.
  - **Measured over the oracle's ten trig sweeps:** the twins match every one;
    `libm` differs on 918–2,024 inputs per sweep, std on 1,604–6,815.
  - **The `js_pow` gate had never run.** It read `jsmath-pow-oracle.json`; the
    exporter writes `jsmath-oracle.json`. It failed at the file read with
    "fixture missing — run the exporter", which reads as an unconfigured
    checkout rather than a broken test. A missing-fixture panic is a claim
    about a PATH — check the name before believing it.
  - **The sweeps did not cover what their comment claimed.** The multi-word
    2/π reduction starts at 2^20·(π/2) ≈ 1.647e6 and the largest sweep stopped
    at 1e6, so `k_rem_pio2` was described as covered and was not. Ranges at
    1e8, 1e15 and 1e300 added; the twins match all three.
  - **`exp`/`log` have no agreeing implementation and are ALREADY CALLED** —
    `combo.rs` (corner restitution / add / window, feeding pinball physics),
    `darts.rs` (`log10`), `intro.rs` (std `ln`/`exp`). No divergent input has
    been hit, which is a fact about those traces' inputs, not about the
    primitives. Pinned as a gap test that fails when a twin lands.
  - **Measured:** `cargo test -p pk-core` green incl. 4 oracle tests and the
    6 maze-digest tests; fmt and clippy clean; oracle fixture re-exported from
    real node and its four original digests unchanged.
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
    *(Superseded 2026-08-10: the trig twins landed; exp/log are still open.)*
  - **The gap is pinned by name, not by category.** Two floors of ten diverge
    (L3 s1, L13 s1) — and three OTHER hub floors are bit-exact, so excluding
    "the hub layout" would have quietly stopped testing three floors that
    already pass. The test asserts the divergent set EQUALS that list, so it
    fails when the twins land as well as when a new divergence appears.
    *(It did exactly that on 2026-08-10 — the list emptied and the assertion
    is what reported it.)*
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

- **2026-08-12 — `pk-check` has only ever gated a DEBUG build, and the RELEASE
  build fails two of its gates.** Reproduced twice on `trunk build --release`:
  *intro hands off to the tavern hub* and *tavern probe carries a pose (no
  probe)*. The click-skip path into the tavern passes on the same run, and every
  tavern gate after it passes, so the hub does build — the likely mechanism is
  the **sampling edge**: the loop takes its one reading at the first poll where
  `intro === null`, and on a faster build that instant can land before
  `TavernRes` exists. That is the suspect, not the diagnosis; widen the poll and
  re-run. Same pair of runs: the sim-rate gate reads **66 Hz on debug and 72 Hz
  on release** for a sim that should be fixed-step, which wants its own look.
  Until this is closed, **the shipped artefact has never passed the gate.**

- **The tavern knight sometimes DISAPPEARS while walking.** Player-reported
  2026-08-11; **reported gone since the Y fix shipped, but the cause is NOT
  proven** — do not close this as understood. The player's repro was "walk one
  direction then the opposite", the Y wobble on that exact motion is now 18×
  smaller, and no other commit in the window touched the tavern or the knight.
  But 0.16 world units is not a disappearance on a frustum 11.25 tall, so
  either the wobble compounded with something unidentified or the cure is
  coincidental.
  Ruled out with evidence: NaN in the movement/collision maths, a teleport out
  of the room, a missing animation clip, `facing_from_velocity` (total, no gap
  at the reversal), and the Y drift itself as a sole cause.
  If it returns: the masked material clones and their `AlphaMode::Mask(0.5)`
  cutoff, the `scale.x = -1.0` mirror for facing W (keepers clamp
  `|scale_x| >= 0.06` against a zero-determinant NaN; the knight has no such
  guard), and a `MeshMaterial3d` handle whose image was dropped.
  Instruments now available: `__pk.tavern.sprite` (full rendered transform,
  with a `bad` flag for non-finite or zero scale) and `__pk.tavern.peak`
  (per-frame min/max y, tracked in-engine).
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
