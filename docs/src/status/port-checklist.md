# Port checklist — every subsystem, by phase

The complete inventory of what must move from `legacy/` (TypeScript/Three.js)
to Rust/WebGPU, sized from measured line counts. **A box is checked only when
the item is ported AND verified** — verification method listed per phase.
What the user still sees missing (ESC menu, backtick debug panel, HUD, run
flow) is listed here as unported scope, not bugs. The intro and the tavern have
since landed; the boot flow is intro → tavern → DESCEND → dungeon floor.

Status legend: `[x]` ported+verified · `[~]` partial · `[ ]` not started.
`[~]` covers two different things — "ported, some of the item is still open"
and "written but not yet signed off". Where it means the latter, the item says
so in words. Nothing enters the *Ported so far (verified)* table at the bottom
until a gate or a fixture has actually run against it.

## P0 — Port infrastructure (the checker) — ACTIVE

The harness that gates every later phase. Nothing ships unverified.

- [x] Fixture pattern: legacy vitest exports golden JSON → Rust replays
      bit-equal (`legacy/.../port-fixtures.test.ts` → `assets/fixtures/` →
      `pk-core` integration test). First fixture: 600-tick movement trace
      through the demo floor.
- [x] `window.__pk` debug surface in the wasm build (tick/pos/facing/moving —
      the seed of the `__lab()` equivalent).
- [x] `scripts/pk-check.mjs`: drives the wasm build in **real host Chrome**
      (CDP): console-error gate, sim-tick advance gate, scripted-input
      movement gate, FPS measurement, the intro gates (phases, title card,
      hand-off, click-skip) and the tavern gates (boot, movement, station
      focus, panel open/close, walk to the DESCEND board, descend hand-off),
      screenshots to `.checks/`.
- [x] Windows-native build (`x86_64-pc-windows-gnullvm` + llvm-mingw,
      `scripts/pk-win.sh`) — the play/dev target. Verified: exe launched on
      the Windows desktop via interop, demo floor rendering (screenshot).
- [ ] CI: fmt/clippy/`cargo test` + legacy vitest + wasm build + pk-check +
      wasm-size budget + windows-gnullvm build.
- [ ] Perf baseline page in docs: record FPS/frame-time from pk-check per
      commit (the benchmarking log).

## P1 — Pinball physics: full collision vocabulary (~4k src + tests)

The game's identity. The slice has square walls only.

- [x] `engine/tile-shape.ts`: slants, rounds, ARC features,
      `resolve_circle_shape`, `resolve_arc_feature`, kick bands, lane bands +
      `lane_tangent`. Verified: ported test suite + shaped-trace fixture.
- [x] `engine/collision.ts` shaped paths: `resolve_shaped` corrective pass,
      `resolve_shape_or_arc`, `LaneHit` identity, `compute_arc_corners`.
      Verified: ported lane/slant/corner tests + bit-exact shaped trace.
- [x] `engine/surfaces.ts`: tables + materials + mixes ported; identity rule
      and one-draw pick pinned. (Physics CONSUMPTION lands with the player
      pinball port below.)
- [~] `updatePinball` (player.ts) sim core + `pinball-collide.ts` physics
      kinds + `rail.ts` + `combo-curve.ts`: reflections w/ surface
      restitution, kicks/lanes, rails, pocket guard, 12 part kinds
      (bumper/spring/booster family/deflector/oil/spinpad/sling/flipper/
      mirror/magstrip). Verified: 26 ported unit tests + booster-corner-sim
      end-to-end (4) + bit-exact 600-tick momentum trace (⚠ found V8-vs-libm
      hypot divergence → `jsmath::js_hypot`, see board). STILL OPEN: ramp/
      jumppad hops, trapdoor, pits, targets/rollovers/lamps, plunger,
      `marble.ts` materials, `multiball.ts`, `ricochet-form.ts`, shell input
      wiring for launch verbs.
- [ ] Player verbs on top: sprint charge, wall-kick (`wallContact` consumer),
      pounce (`entities/player.ts`, 916+ lines root `abilities.ts`).
- Verify: port `collision.test.ts` remaining cases, `tile-shape.test.ts`,
  `arc-sweeps` moveCircle cases, `booster-corner-sim.test.ts`; new trace
  fixtures at pinball speeds (sub-stepping exercised); pk-check drive test.

## P2 — Maze generation (19.7k src, 7.3k tests)

**The shipping path is `maze/track-floor.ts buildTrackFloor`, not
`generateMaze`.** `TRACK_FIRST` has been on since the track rework; measured
over 400 floors, `buildTrackFloor` declined 0 times, so the growing-tree maze
below it is a genuine fallback that runs on no floor a player sees. Port the
track pipeline first and the fallback last — and read
`spawn/floor-authoring.ts`'s header before either, because the pre-track draws
(`rollModifier`, `windinessFor`) shift the stream the whole floor is built from.

- [x] **PARITY HARNESS (P2's P0).** 23 named pass boundaries, each with 7
      digests + 6 exact counts + the cumulative rng draw count, exported from
      the live legacy pipeline through an `onPass` seam
      (`port-maze-fixtures.test.ts` → `assets/fixtures/maze-pass-digests.json`
      → `crates/pk-core/tests/maze_pass_digests.rs`). The digest is certified
      on its own vectors before it is pointed at a floor. Verified by
      sabotage on both sides — an extra rng draw and a no-rng geometry change
      each localise to the right pass; a dropped length fold and a big-endian
      f64 each fail the self-test with the cause named. See
      `pk_core::maze` for why a whole-floor comparison cannot debug this port.
- [x] **DATA TABLES.** `maze/archetypes.ts` (track half — the five
      `TrackProfile`s, `windinessFor`, `trackNodeCounts`), `maze/modifiers.ts`
      (the ROLL and the pool; the multipliers land with `decorate`),
      `levelConfig`'s cell ramp. Verified two ways: the fixture pins each
      corpus floor's resolved profile VERBATIM, and the pre-track stream is
      reproduced bit-exactly (`drawsBeforeTrack` and `density`, an f64 compared
      for equality). `maze-constants.json` pins what ten floors provably cannot
      — measured, `MODIFIER_CHANCE` 0.45 vs 0.5 changes no corpus floor, and
      `cellsW/H` cap at L23/L24 where the corpus stops at 13.
      ⚠️ Trap found here: a JS object with integer-like keys iterates in
      ASCENDING NUMERIC order, not literal order, so two `BandPaint` mixes
      transcribe backwards if you read them off the page.
- [x] **PASS 1 `grow-track`** (`pk_core::maze::track_grow`): the physarum
      circuit — layouts (scatter/spine/ring/hub), `mesh_neighbours`,
      Gauss–Seidel `solve_pressures`, `grow_network`, `prune_to_circuit`,
      `prune_leaves`. **10 of 10 corpus floors bit-exact** (node positions, tube
      conductivities and lengths, draw count) as of 2026-08-10, when
      `js_cos`/`js_sin` landed and the two pinned floors joined the rest. Traps
      pinned in the port: two rng draws per placement attempt INCLUDING rejected
      ones; `js_hypot` in the K-nearest sort; and a JS `Set` re-insertion moving
      an edge to the END of the survivor order.
- [x] **PASS 2 `track-path`** (`pk_core::maze::track_path`): the graph turned
      into rideable geometry — bearing-sorted adjacency, the per-junction
      radius search over `TRACK_RADII`, the two-pass setback settlement, the
      leg list and the fillet `ArcFeature`s. **10 of 10 corpus floors bit-exact**
      on the first run, 2026-08-10.
      ⚠️ **The fixture could not gate this pass and had to be widened first.**
      `track-path` pinned `extra: { legs: N }` — a COUNT — plus the graph
      digests, which at that boundary are pass 1's output unchanged. And it is
      the one pass that draws NOTHING from the rng, so the draw counter, the
      localiser every other pass leans on, is identical on both sides by
      construction. The exporter gained `pathLegs`, `pathArcs` and
      `pathArcHalf`; nothing existing was weakened.
      Traps pinned in the port: `Math.tan` and `Math.atan2` are `libm`'s and NOT
      std's; the JS `Map` adjacency iterates in first-touch order and that order
      is the arc AUTHORING order; and two things the corpus provably cannot see
      (below).
- [x] `jsmath::tan` / `atan2` — swept for the first time when pass 2 reached
      them. `libm` matches the runtime and std does NOT, on all four `tan`
      ranges and both `atan2` lattices, with the maze corpus separating them
      independently. The expectation going in was the opposite: `tan` shares
      `cos`/`sin`'s argument reduction and its kernel is the one FreeBSD
      rewrote after 1993, so it looked like the next twin. There is no
      family-level rule here, only the sweep.
- [x] `jsmath::js_cos` / `js_sin` — Sun's 1993 fdlibm, verbatim (`s_sin`,
      `s_cos`, `k_sin`, `k_cos`, `e_rem_pio2`, `k_rem_pio2`). V8 keeps that
      evaluation order; musl and glibc both took FreeBSD's rewrite, so both
      Rust candidates disagree with the runtime. Verified: ten whole-curve
      digests from real node, crossing all four reduction branches, with `libm`
      and std pinned as still-wrong per range. See Incidents.
- [x] `jsmath::js_exp` / `js_log` — written and bit-exact (exp over 8 ranges,
      log over 5, crossing the overflow/underflow thresholds, the subnormal
      tail, both `ln2` split points and the `k == 0` band). `js_log` is verbatim
      `e_log.c`; `js_exp` is verbatim `e_exp.c` plus one guard, because
      `libm::exp` already IS fdlibm and misses the runtime on exactly ONE input
      in ~400,000 — `x == 1`, where V8 answers `Math.E`.
- [~] **Switch the call sites** — `combo.rs` done, `intro.rs` blocked on a
      fixture that does not exist yet:
      - [x] `combo.rs` — all five switched. Every trace stayed bit-exact, so
        it was A/B'd directly: the raw `log(1 + 0.15·n)` differs on 2 of the
        first 201 combo depths, `combo_speed_ceil` on NONE (the division eats
        the ulp), and the `exp` arguments `-λ·n ≤ 0` cannot reach `x == 1`,
        which is `libm::exp`'s only divergence. Correct-by-construction, no
        behaviour change, and no test can distinguish the two versions —
        written down in the module header rather than left as a silent green.
      - `intro.rs:458` (camera zoom, std `ln`/`exp`) → the twins. **No fixture
        covers this**: `intro_trace.rs` replays the ball, not the camera pose.
        A fixture has to be written before the switch can be verified.
      - `combo-curve.ts:154-155` (damage multiplier, `Math.log`) is not ported
        yet — it must use `js_log` when it is.
      - `gambler::darts`'s `libm::log10` needs NO twin: there is no
        `Math.log10` anywhere in the legacy TS, so it is Rust-original with no
        runtime answer to reproduce. (V8 does compute `Math.log10`
        independently rather than as `log(x)/LN10` — they differ 1–2 ulp — so a
        future mirrored call site WILL need one.)
- [x] **Run the oracle on the SHIPPED targets — done, and it found a live
      defect.** `js_pow` was `f64::powf`, certified natively and nowhere else.
      Measured 2026-08-10:
      - **wasm** (`node scripts/jsmath-wasm-check.mjs`, which runs the sweeps
        inside a real `wasm32-unknown-unknown` module): `powf` diverged on
        19,904 / 200,001 (x^1.35), 9,730 / 100,001 (x^2.5), 5,043 / 50,001
        (x^7), digests equal to `libm::pow`'s — the compiler-builtins lowering,
        named rather than inferred.
      - **windows-gnullvm**, the PLAY target (`cargo test --target
        x86_64-pc-windows-gnullvm -p pk-core --test jsmath_oracle`): mingw's
        `pow` is a THIRD implementation — 201 / 200,001 off the runtime and not
        fdlibm either. "wasm is the odd one out" was the wrong model.
      Fixed by carrying the routine instead of asking the target:
      `jsmath::pow_arm` transcribes ARM's optimized-routines `pow` (the one
      glibc ships and the runtime matches), tables generated mechanically by
      `scripts/transcribe-pow-tables.py`. ⚠️ The transcription alone was NOT
      enough — glibc builds it with `-mfma` and GCC's `-ffp-contract=fast`
      fuses `a*b + c` invisibly, worth 153 / 200,001 on its own. The `mul_add`
      calls mirror `-fdump-tree-optimized`, and
      `the_gcc_fusions_are_load_bearing` pins them. All three targets green.
      `js_cos`/`js_sin`/`js_exp`/`js_log` were immune as expected (transcribed
      constants, no platform call) and `tan`/`atan`/`atan2` go through the
      `libm` crate, which is the same pure Rust everywhere.
- [~] `maze/track-floor.ts` — the 23-pass pipeline itself, pass by pass
      against `PASS_ORDER`. **8 of 23 land, all ten corpus floors bit-exact:**
      ~~grow-track~~ → ~~track-path~~ → ~~carve-track~~ → ~~plaza~~ →
      ~~launch-chute~~ → ~~grow-maze~~ → ~~endpoints-early~~ → ~~repair-1~~ →
      plan-doorways →
      publish-arcs → orbit-island → arc-sweeps → repair-2 → endpoints-final →
      boss-chamber → artery-banks → reseal-chute → carve-doorways →
      funnels-relays → compact-fixed-point → stairs → arc-rails → done.
      ⚠️ Green at a boundary is not green at a pass — sabotage each one and
      record what survives. `carve-track` let SIX of ten injected defects
      through, the wrong trig library among them; passes 7-8 let SIXTEEN of
      twenty-six through against four positive controls that all caught. Running
      totals so far: the wrong math library survives every maze boundary tried
      (its guarantees live in `jsmath_oracle.rs`, not in the corpus), and no two
      candidates in the ten-floor corpus score exactly equal, so **every
      tie-break and scan order in the generator is unverified** — three
      consecutive passes have reported it.
- [x] `maze/track-socket.ts` — the plumbing repair, gated at `repair-1`. Ported:
      `uncarveDeadEnds`, `removeWallStubs`, `healRoadTerminations`, `nearSealed`,
      `findRoadTerminations`. NOT ported and deliberately so: `socketAt` /
      `compatible` / `findSocketViolations` (the acceptance scan — belongs with
      `floor-rules`) and `clearRun` / `aimLauncher` (parts placement, half B).
      ⚠️ `connect_all` carves 0 tiles behind this pass on 10/10 floors and
      provably cannot carve any (uncarve only fills leaves), so the boundary
      gates uncarve + de-stub and nothing else of the four.
- [x] `engine/flow-field.ts bfsDistances` → `pk_core::flow_field`. The ruler the
      generator measures with; pk-core had no BFS at all before pass 7. The
      shared-scratch-buffer half is deliberately not ported (see the module
      header) — the per-frame field wants a caller-supplied buffer, which is P4.
- [ ] `maze/generator.ts` (the growing-tree fallback — runs on no floor a
      player sees; `buildTrackFloor` declined 0 times in 400. Port last.)
      **`build.ts` is NOT here** — 1,834 lines of three.js renderer, P3.
- [ ] `maze/archetypes.ts`, `assembly*.ts`, `prefabs.ts` (+ biome tables).
- [~] Track systems: `track-grow` ✅, `track-carve` ✅ except `publishArcs`
      (pass 10), `track-launch` ✅ except `resealChute`'s wiring (pass 17),
      `arc-sweeps`, `arc-lanes`, `conic-fit` (authors the P1 arc features).
- [x] `jssort::js_sort_by` — V8's `Array.prototype.sort` as a DRAW SOURCE.
      The maze's direction shuffle spends one draw per comparison and V8 makes
      4 or 5 for four elements, so the sort is part of the random stream. All 24
      four-element traces pinned; verified n=2..7 against node and REFUSES n>=8,
      where TimSort's run detection changes the count.
- [ ] `doorways`, `flow-loops`, `circuit`, `relay-chambers`, `lamp-puzzle`.
- [ ] `decorate.ts`, `surface-paint.ts` (paints P1 surfaces).
- [ ] `floor-rules/metrics/density/seed`.
- Verify: the pass-digest harness above — a floor is ported when every one of
  its 23 boundaries is bit-identical to the oracle's, not when the finished
  grid looks right. Property tests (connectivity, reachability) are ported too
  but they are NOT the gate: "connected", "solvable" and "has an exit" are all
  true of the wrong floor, which is exactly what a mis-ordered draw produces.

## P3 — Rendering proper (15.2k render/ + engine/render)

- [~] Per-rung atlas bake (`cargo xtask bake` real implementation) —
      replaces the embedded ÷4 sheets. The `--tavern` leg is real
      (`xtask` → `legacy/scripts/bake-tavern.mjs` → `assets/tavern/`: five
      84×84 keepers, the 1024×220 ENTER MAZE sign, `bake.json` provenance);
      bare `cargo xtask bake` is still the stub and the per-rung
      knight/monster atlases are still embedded-and-÷4.
- [ ] `engine/render/animator.ts`: real clip timing/looping (slice guesses
      8/4 fps), tell-clips.
- [ ] Silhouette pass (GreaterDepth "Diablo trick").
- [~] `engine/render/pixel-pass.ts`: the pixel/cel post chain (TSL → WGSL),
      in `pk-game/src/post/`. PORTED: low-res linear render target + integer
      nearest upscale; half-res bloom (threshold 0.7 / strength 0.9 /
      radius 2.2); one composite doing 16-tap depth-ring SSAO (radius 14,
      `light = 1 − ao·0.85`), +bloom, explicit linear→sRGB, vignette 0.32 and
      the cel grade (10 steps, curve 0.5, saturation 1.15). Order is the look;
      every constant is the legacy `engineConfig.post` value. NOT PORTED:
      palette snap/quantize and the albedo MRT it needs, dither, scanlines,
      ink outline, heat haze, chromatic aberration, and compositing the UI
      before the cel grade — all of which are **off in the oracle's config
      too**, so they are parity-neutral today; their uniforms sit pinned at 0.
      **Unverified** — pending pk-check + the screenshot A/B below.
- [ ] Room dressing: wall/floor materials & textures, `boot/lighting.ts`,
      `boot/biomes.ts` looks, torch/window glass looks (or slice-level
      approximations first).
- [ ] `render/pinball-parts.ts`, `arc-kickers/lanes` visuals,
      `part-instancer.ts` → instanced meshes.
- [ ] `render/palette*.ts` palette-swap shader (armor styles, zombie tints).
- [ ] Damage text (`engine/render/damage-text.ts` + pixel fonts).
- Verify: pk-check screenshot A/B against the TS game at matched
  camera/seed; per-frame FPS budget.

## P4 — Entities & combat (11.3k src, 6.2k tests + root files)

- [ ] Nine `Record<EnemyKind,X>` registries → enums + `EnumMap` (bestiary,
      factory, reagents, combat, enemy-rules, stagger, card-styles, portraits,
      state).
- [ ] `entities/movement.ts`, `ai`, `engine/flow-field.ts` pathfinding.
- [ ] `entities/combat.ts`, `projectiles`, `hazards`, `stagger`,
      `wall-erosion`, `floor-fx`, `combo-curve`.
- [ ] Per-kind behaviors (`zombie.ts`, monsters incl. croaker knee-wall hop).
- [ ] `boss.ts` (772), `spawn/{factory,tide,reaper,floor-populate}`.
- [ ] Root gameplay: `state.ts` (1556) fully mirrored, `cards.ts`,
      `abilities.ts`, `skills.ts`, `items.ts`, `secrets.ts` (cracked walls),
      `economy/` (coins, loot, pickups, ground-items).
- Verify: ported entity/spawn vitest suites; combat trace fixtures; pk-check
  scripted fight on a fixed seed.

## P5 — GUI, menus, intro, game flow (7.4k gui + 1.1k intro + run/)

The items reported missing today live here.

- [ ] `Painter2d` immediate-mode layer (rect/atlas-sprite/pixel-font text/
      nine-patch/scissor → 2–3 draw calls).
- [ ] Pixel fonts (`src/pixel/pixel-font.ts` + `map-render` text).
- [ ] **ESC game menu** (`gui/screens/menu.ts`), settings + `settings-save`.
- [ ] **Backtick debug panel** (`gui/screens/debug.ts`, `debug-panel.ts`) +
      `__lab`-equivalent console API (grow `window.__pk`).
- [x] **Intro/title** (`intro/title-grid.ts`, `clock.ts`, `index.ts`
      choreography, intro-chrome) — pulled forward 2026-08-09 (see the
      scene-order decision in milestones). Core in `pk-core/src/intro.rs`
      (17 ported tests + BIT-EXACT `intro-ball-trace.json` fixture), shell
      in `pk-game/src/{intro,overworld}.rs` (CPU-painted overworld gag,
      shatter, camera sweep, skip gates incl. `?autostart=1` for harnesses).
      Verified: pk-check intro gates (phases, title screenshot, handoff,
      click-skip) ALL PASSED in host Chrome — **against the old
      Intro→Dungeon hand-off**; the hand-off now targets Intro→Tavern, so
      those gates need a re-run. Remaining debt (P5/P7): pixel fonts for
      HUD/title text (Bevy default font + a bitmap "?" today), knight painted
      into the 480-wide buffer instead of a display-res layer, and the block's
      "?" pulse-scale. Intro sfx stings landed with P7 (unverified).
- [ ] HUD: `hud-face.ts` (1330), meters, minimap (`map-render.ts`),
      floor-map overlay, toasts, pickup-toast.
- [ ] Screens: shop, character-select, haul, game-over, floor-loading.
- [ ] Run flow: `run/{descend,death,ledger,grade,lobby,floor-hold,
      grave-hole}`, corpse-run, best-depth.
- [ ] Saves (`SaveStore`: native file / wasm localStorage).
- Verify: pk-check flow scripts (open menu, navigate, die, descend) +
  screenshot A/B; ported run/ledger tests.

## P6 — Tavern (15.8k) — pulled forward 2026-08-09

The between-runs hub. Core ported and verified; shell live with listed debt.

- [x] Deterministic core → `pk_core::tavern`: layout (stations/obstacles/
      keepers/spawns, `station_at`, `move_in_room`, `is_open`), movement step
      (legacy `stepTavernMovement` extraction — one description for the game,
      the fixture and the port), diorama read, keeper cast + idle-loop beats,
      camera lean/ease, join board. Verified: 66+ ported tests + BIT-EXACT
      `tavern-walk-trace.json` (600 ticks: pose, velocity, facing, focus).
- [x] Gambler core → `pk_core::gambler`: table rules, slots, roulette
      pricing + ball physics (search reconciliation), blackjack rules +
      basic-strategy RTP + the playable table's phase machine, darts board/
      bands/wobble + throw machine, all with their legacy suites ported
      (183 tests incl. the RTP/economy Monte-Carlos).
- [x] Shell → `pk-game/src/tavern.rs`: room + props geometry verbatim
      (build.ts/props.ts numbers), warm/cold light rig with accent breathe +
      focus spotlight, hearth flicker, diorama caps/ball, keeper billboards
      driven by the ported loops, knight billboard, prompt, camera lean,
      DESCEND hand-off (tears down → fresh dungeon floor), `?tavern=1` /
      `--tavern` boot + T from the dungeon (P5 run-flow stand-in). Verified:
      pk-check tavern gates (boot, movement, focus, panel, walk-to-board,
      descend hand-off) in host Chrome, twice, clean console + screenshots.
- [~] Shell debt: cel-painter keeper art, sign lettering and the ember/mote/
      spark VFX + tavern sfx **landed** (baked 84×84 keepers and the 1024×220
      ENTER MAZE sign replace the tinted boxes, contact-shadow blob synthesized
      in Rust, particles and the audio bed live) — pending sign-off. STILL
      OPEN: the rest of the P3 post chain (palette snap, dither, outline),
      vendor counters / cabinet screens over the real GUI stack + economy
      (P4/P5 — placeholder panels today), run-flow entry wiring
      (death/floor-clear/lobby, P5), multiplayer pool + join-board UI (P8).
- Boot flow note: the tavern is now the **default** destination — the intro
      hands off to it and a skipped intro lands there. `--dungeon` /
      `?dungeon=1` / `PK_SCENE=dungeon` is the dev hatch that opens a floor
      directly, and is what pk-check's sim/input gates use.
- Verify (kept): screenshot A/B against the TS tavern at matched camera once
  P3 materials land.

## P7 — FX & audio (3.8k fx + 1.1k sfx)

- [~] `fx/` pools/elements TSL → WGSL storage-buffer particles (fire, frost,
      water, molten, goo, rod, noise; puffs, heat haze, decals). LANDED: the
      ember / mote / spark pools as one storage-buffer instanced material
      (`pk-game/src/fx.rs`) — the tavern's hearth and dust. The rest of the
      element families, puffs, heat haze and decals are untouched.
      (`pk-game/src/fx/` — a CPU ring-buffer pool uploaded to one instanced
      additive material per frame, the port of `fx/pools/particle-pool.ts`.)
- [ ] Juice (`engine/juice.ts` screenshake etc.).
- [~] `pk-audio` backends (web-audio-api native / web-sys wasm) + all `sfx/`
      patches (ambience/combat/monsters/weapons/pinball/world/run), bus,
      gate, mute; gesture unlock on wasm. LANDED: both backends behind the
      `AudioBackend`/`OscillatorNode`/`GainNode`/`AudioParam` traits, the synth
      primitives, and the tavern + intro patches; the Bevy side is
      `pk-game/src/sfx.rs`. OPEN: every other patch family
      (combat/monsters/weapons/pinball/world/run), the bus/gate, the wasm
      gesture unlock, and the master mute (`PK_MUTE=1` / `?mute=1` are
      documented as planned — **no mute gate exists in `crates/` yet**).
- Verify: by ear vs TS + offline render spectral diff on a few stings;
  visual A/B for FX. **Nothing in this phase has been signed off yet** — no
  spectral diff has been run, and the FX A/B is pending.

## P8 — Parity sweep, perf, deploy

- [ ] Port remaining vitest logic suites wholesale; kill remaining gaps.
- [ ] Playtest-bot equivalent driving the Rust build (soak, stuck detection).
- [ ] Multiplayer protocol (net/) — post-parity decision point.
- [ ] Leaderboard client (`/api/scores`, localStorage fallback).
- [ ] wasm release pipeline (`xtask dist`: wasm-opt + brotli), size budget.
- [ ] Docker static container → Synology → Cloudflare; link from
      braindeadbot.com.
- Verify: soak green, size/FPS budgets met, deployed URL loads over WebGPU.

## P9 — Post-parity

Steam (`steamworks`, cargo-xwin), monster-art-system rebuild, forge-lite,
co-op multiplayer.

---

## Ported so far (verified)

| Item | Where | Verified by |
|---|---|---|
| Mulberry32 RNG | `pk-core/src/rng.rs` | bit-exact vs JS oracle, 5 seeds |
| JS math twins: `hypot`, `pow`, `cos`, `sin`, `exp`, `log` | `pk-core/src/jsmath/` | whole-curve digests from real node — 4 pow sweeps + 10 trig ranges crossing all four reduction branches + 13 exp/log ranges, with the rejected candidates pinned as still-wrong PER RANGE (blanket assertions no longer hold: `libm` matches exactly on five of them) |
| JS math CHOICES that needed no twin: `tan`, `atan2` (both `libm`) | `tests/jsmath_oracle.rs` | 4 `tan` sweeps + 2 `atan2` lattices from real node, with std pinned as still-wrong per range — a measured choice, not an assumed one |
| Maze pass 1 `grow-track` (physarum circuit) | `pk-core/src/maze/track_grow.rs` | 10/10 corpus floors bit-exact — node + edge digests, counts, cumulative rng draws |
| Maze pass 2 `track-path` (rideable geometry) | `pk-core/src/maze/track_path.rs` | 10/10 corpus floors bit-exact — leg digest, fillet digest, `arcHalf`, leg count, draws (all three digests added to the exporter for it) |
| Tile grid | `pk-core/src/grid.rs` | ported cases |
| Square-wall collision (sweep, sub-step, surfaces, wall contact) | `pk-core/src/collide.rs` | 8 ported legacy cases + movement-trace fixture |
| Player movement @60 Hz, facing | `pk-core/src/state.rs` | tests + trace fixture + pk-check drive |
| Published-manifest schema | `pk-assets` | parses all 19+ legacy manifests |
| 38°/45° ortho camera, follow | `pk-game` | host-Chrome screenshots |
| Diablo-rule wall heights | `pk-game` | host-Chrome screenshots |
| Knight billboard, S/N/E + mirrored W | `pk-game` | host-Chrome screenshots |
| wasm/WebGPU build (trunk) | `Trunk.toml`, `web/` | pk-check in host Chrome |
| Intro: title-grid maze + ricochet + two-clock + phase machine + skip gate | `pk-core/src/intro.rs` | 17 ported tests + bit-exact `intro-ball-trace.json` |
| Intro shell: Intro→Dungeon states, 2D overworld gag, shatter, sweep, chrome | `pk-game/src/{intro,overworld}.rs` | pk-check intro gates + phase screenshots |
| Tavern core: layout, movement step, diorama, keepers, camera, join board | `pk-core/src/tavern/` | 66+ ported tests + bit-exact `tavern-walk-trace.json` |
| Gambler core: table rules + slots + roulette (pricing & physics) + blackjack (rules & table) + darts (board & throw) | `pk-core/src/gambler/` | 183 ported tests incl. RTP/economy Monte-Carlos |
| Tavern shell: room/props/lights, keepers, prompt, panels, descend hand-off | `pk-game/src/tavern.rs` | pk-check tavern gates + host-Chrome screenshots |
