# Status board

The living broken / fixed / working record. **Update this page in the same PR
as the change it records.** Newest entries first within each section.

## Working

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

- `cargo xtask bake` — stub. M0's real exit criterion (baked knight frame on
  screen) is open.
- `cargo xtask dist` — stub (wasm-bindgen/wasm-opt/brotli pipeline not built;
  trunk not yet installed on the box).
- The slice embeds the knight sheets in the binary and downsamples ÷4 at load
  — a stand-in for the per-rung bake, not the destination.
- `wayland` Bevy feature is off (WSL box lacks libwayland-dev); X11 via WSLg.
- Slice clip timing is guessed (8 fps walk / 4 fps idle); real timing ports
  with the animator in M2.
- CI (GitHub Actions) not set up: fmt/clippy/test + wasm build + size check +
  legacy vitest job all pending.
- Legacy `/forge` UI + `next dev` not yet smoke-tested from the new location
  (vitest suite is green; the dev-server path needs one manual run).

## Fixed

*(nothing yet — entries move here from Broken with the commit that fixed them)*

## Known environment facts (not bugs)

- The legacy suite must run from `legacy/` (paths resolve relative to it).
- Test/browser runs are metered — the box is shared. See
  [Dev environment](../reference/dev-env.md).
