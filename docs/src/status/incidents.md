# Incidents

Diagnoses that outlive their patches. Write the reasoning, not just the fix.

## 2026-08-11 — A partial transform restore lets the pixel snap move the
## knight's Y — real, bounded, and NOT the disappearance it was hunted for

**Status: the defect below is fixed and measured. The player-reported bug it
was chased for is still OPEN — see the correction at the end.** This entry is
kept in full because the wrong turn in it is more instructive than the fix.

The report was *"my sprite for pinball knight will just disappear sometimes"*,
narrowed by the player to: **tavern only, only while WALKING, permanent** —
gone until a restart or a trip to the maze.

**What was found.** `post/snap.rs::snap_sprites` rounds a `PixelSnapped`
entity onto the render lattice along the *camera's* right/up basis, not world
axes — the whole point of the module, since under a 45° yaw a world-axis snap
misses the lattice (`snapping_world_axes_would_not_land_on_the_lattice`).
Under the 38°/45° iso rig the camera's up vector is `(-0.435, 0.788, -0.435)`,
so **rounding the "up" component moves the entity in world Y.**

`snap.rs`'s header already stated the contract: this is idempotent only
because every driver ASSIGNS the translation rather than accumulating into it,
so the correction has a fixed point. `sync_tavern_knight` wrote `.x` and `.z`
and never `.y` — not accumulation, but it defeats the fixed point just the
same, because each frame hands the snap a fresh x/z carrying last frame's
already-corrected y.

**Fixed** by assigning all three components (and likewise the contact blob,
which is independently `PixelSnapped`). The keepers at `tavern.rs:1723`/`:1749`
already assigned all three; the knight was the only violator.

**Measured in real Chrome, both ways.** Twice, because the first measurement
was wrong — see "the second correction" below.

| | worst \|y − 0.575\| | of a 1.15 quad |
|---|---|---|
| partial restore (the defect) | **0.1606** | 14.0% |
| full assignment (the fix) | **0.0090** | 0.8% |

Over ~90 s of scripted reversing (every key pair, a 120 ms flutter, and
diagonals), 1,634 and 1,484 frames watched respectively. The fix cuts the
wobble **18×**. It does not eliminate it — a snapped sprite is allowed to move
a sub-texel as the camera eases, which is the tradeoff the module documents.

### The SECOND correction: a sampled probe is not a maximum

The table above replaces an earlier one reading **0.0217** for the defect,
which I used to argue the drift was "1.9% of a quad, far too small to be the
reported disappearance" and to file the player's bug as still open.

That 0.0217 came from a Playwright loop polling `__pk` every ~50 ms — **one
frame in three at 60 fps**. It reported a *sample*, not a peak, and the true
per-frame maximum is 7.4× larger. The fix is now measured by `SnapPeak`, a
resource updated in `PostUpdate` immediately after `snap_sprites`, which only
ever widens its min/max. Instrument the engine, not the poll: an external
sampler cannot see an excursion narrower than its own interval.

Whether 14% of a quad is what the player was seeing is still not proven —
0.16 world units against a frustum half-height of 5.6 does not put the knight
off screen, and the mechanism for a full disappearance remains unidentified.
The player reports it has stopped since this shipped. That is evidence, not
proof, and the two other commits in the same window touched neither the tavern
nor the knight, so this is the only candidate.

### The FIRST correction, which is the point of this entry

The diagnosis originally claimed a RUNAWAY: y climbing 0.575 → 1.394 over 600
walking frames, off the top of the frustum. That came from a simulation with
**the camera parked at the origin**, so the knight's offset from it grew
without bound and the rounding residual grew with it.

The tavern camera does not do that. `tavern_camera` eases toward the player
every frame (`ease_camera`, `tavern.rs:2355`), so `d = knight − camera` stays
roughly constant while walking. Re-simulated with a following camera the drift
is **bounded** — it wanders to ~0.13 and comes back — and the live browser
measurement agrees at 0.0217. A ratcheting model produced a ratcheting answer;
the code has a servo in it.

The symptom match that made the story so convincing (tavern-only, walking-only,
permanent) is genuinely a property of this defect — `PixelSnapped` is attached
nowhere outside `tavern.rs`, identical x/z reaches the fixed point at rest, and
only a scene rebuild resets y. **A mechanism can explain every qualitative
symptom and still be the wrong magnitude.** The check that caught it was
restoring the bug and measuring, rather than treating the fix's green run as
proof; a one-sided pass would have shipped a false diagnosis with a real patch
stapled to it.

**Status of the player's bug: reported gone since this shipped, cause not
proven.** The player's repro was "walk one direction then the opposite", which
is what the 90 s A/B above scripts, and the defect is 18× smaller now. But
0.16 world units is not a disappearance on a frustum 11.25 tall, so either the
wobble was compounding with something unidentified, or the cure is
coincidental. Do not close this as understood.

Ruled out with evidence, so nobody re-hunts them: NaN (every division in
`step_tavern_movement` guards its denominator; `move_in_room` is pure clamps),
a teleport out of the room (clamped twice), a missing animation frame (all
three sheets carry idle *and* walk cells, and the empty-clip path early-returns
*before* touching the material, so it would freeze a frame, not blank it), and
`facing_from_velocity` (total, every branch returns, no gap at the reversal).
If it returns, look at: the masked material clones and their
`AlphaMode::Mask(0.5)` cutoff, the billboard's `scale.x = -1.0` mirror for
facing W (the keepers carry an explicit `|scale_x| >= 0.06` clamp with a
comment that a zero-determinant matrix "NaNs the normals and the sprite
disappears for good" — the knight has no such guard, though its scale is a
hard ±1.0), and anything that can leave `MeshMaterial3d` pointing at a handle
whose image was dropped.

### What this proved about the harness

`pk-check` passed identically with and without the defect — verified by
restoring it and running the whole gate to a green `ALL GATES PASSED`. Its
longest key-hold is 1.1 s. A screenshot gate cannot see a sub-quad positional
error at all, and cannot see a disappearance until the subject is already
missing from the photograph.

So the probe gained `__pk.tavern.spriteY`: the knight's RENDERED y, after the
snap. It is not derivable from `TavernRes` — the sim pose has no y — and that
gap is exactly why this went unmeasured. Emitted as `null` rather than `NaN`
when the entity is absent, since `NaN` is not JSON and would break the parse
for every other field in the probe.

**The general shape worth keeping:** a per-frame correction is idempotent only
against a FULL assignment. "Don't use `+=`" is the wrong rule; the rule is
*assign every component you do not want the corrector to own*. The dungeon's
`sync_knight` (`main.rs:1153`) has the identical partial write and is harmless
only because nothing there is snapped — latent, not live.

## 2026-08-10 — A pass boundary that pinned a COUNT, on the one pass whose
## draw counter cannot say anything

Pass 2 of the maze pipeline, `track-path`, was gated by a fixture that could
not have failed for the mistakes a port of it makes.

Every boundary in `maze-pass-digests.json` pins seven grid digests, six counts,
the cumulative rng draw count and the pass's own scalars — and at `track-path`
all seven grid digests are the all-wall grid (the first two passes write
nothing to tiles), the graph digests are pass 1's output unchanged, and the
scalars are `{ legs: 28 }`. So the entire claim the fixture made about pass 2's
output was a leg count.

Normally the draw counter covers that gap: it is what splits "this pass drew a
different number of values" from "it drew the same ones and did different
arithmetic". `build_track_path` draws NOTHING. It is pure geometry over pass
1's graph, so its boundary count equals `grow-track`'s on both sides *by
construction*, on a correct port and a broken one alike.

Concretely, all of these passed the old gate: every leg pulled back by the
wrong setback, every leg emitted in a different order, every fillet centred on
the wrong side, `arcHalf` off by the lane scale. Only the number of surviving
legs was checked, and the leg count is a coarse function of the geometry — it
changes only when a leg crosses the `sa + sb >= len − 0.5` threshold.

Fixed by widening the exporter: `pathLegs` (endpoints, node ids and lane width,
in emission order), `pathArcs` (the same fold `grid.arcs` uses) and
`pathArcHalf`. Both sides now assert the digests exist at exactly one boundary,
so deleting them fails loudly rather than silently restoring the old gate.

**The general shape, which is the part worth keeping:** a probe that reports
`{ thing: things.length }` reads like instrumentation and is a *count*. Ask
what a wrong implementation would have to do to change it — if the answer is
"cross a threshold", the boundary is not gated. And when a pass consumes no
rng, the harness's cheapest localiser is silent there, so that pass needs MORE
pinned state than its neighbours, not the same amount.

**Also measured, on the same pass:** two primitives it calls are provably
invisible to the ten-floor corpus. `js_hypot` differs from `libm::hypot` on
34% of the calls this pass makes and changes no digest, because hypot only
feeds inequalities here. `js_cos`/`js_sin` differ from `libm`'s on 8 of 790
leg bearings and the swap survives five corpus floors before one catches it —
a 1-ulp error scaled by a ≤7-tile setback rounds away against the ulp of the
30-tile coordinate it is added to. Green floors are evidence about the inputs
the floors reach, never about the call being right.

## 2026-08-09 — V8's math library is a third implementation, and the port's
## determinism rule pointed at the wrong one

The maze harness's first real use found this on its first run. `grow_track`
came out with the LAYOUT bit-identical — same 43 nodes, same positions, same
draw count — and the conductivities wrong in the last two digits. Same node
count, same edge count, same topology; different roads.

The cause was `Math.pow`. `track_grow`'s physarum step raises a normalised
flow to a fixed 1.35 power, 140 times per floor, and the result decides lane
WIDTH. Measured over 200,001 values of x^1.35:

| implementation | differs from the JS runtime |
|---|---|
| Rust `libm` crate (`e_pow.c`, Sun/fdlibm) | 19,904 of 200,001, always 1 ulp |
| Rust std `f64::powf` (the platform pow) | 0 |

The workspace determinism rule says transcendentals go through `libm`, never
std — written for `sin`/`cos`, where std differs across platforms. For `pow`
it points at the implementation that is *wrong for this oracle*.

**Then the next one.** With `js_pow` in, pass 1 diverged again three levels
later: one node of L3's 44, one ulp of x, out of the `hub` layout's
`Math.cos`. Sweeping the whole family against the runtime:

| fn | `libm` | std | verdict |
|---|---|---|---|
| `sqrt` | ✅ | ✅ | IEEE-exact, no twin needed |
| `atan` | ✅ | ❌ | `libm` |
| `pow` | ❌ | ✅ | std, plus V8's ±0.5→`sqrt` fast path |
| `cos` `sin` `exp` `log` | ❌ | ❌ | **neither** |

`cos(0.1)` is `0x3fefd712f9a817c0` in the runtime and `…c1` in both Rust
candidates — they agree with each other and disagree with the oracle. The
reason is evaluation ORDER, not constants: V8 keeps the original Sun
`__kernel_cos`/`__kernel_sin` (the `qx` trick, Horner all the way down) while
musl and glibc both took FreeBSD's rewritten split-polynomial form. C1..C6 and
S1..S6 are identical in all three.

**Rules.**

1. There is no blanket answer for "which math library". Every primitive the
   port touches gets swept against the runtime BEFORE it is used, and the
   sweep is a digest of a whole curve — 1 ulp on one input in ten is invisible
   in spot values, which is exactly how it was nearly missed.
   `assets/fixtures/jsmath-oracle.json` is that gate.
2. A twin's rationale must be re-testable. `jsmath_oracle.rs` asserts that
   `libm::pow` still DISAGREES, so if a future `libm` fixes its pow the test
   fails and says the comment is stale, rather than quietly agreeing.
3. This is per-target. `wasm32-unknown-unknown` has no system libm, so std's
   `powf` lowers back to the `libm` crate — the wasm build is expected to
   diverge here and has not been measured. Tracked in the checklist.
   → **Measured, and it was worse than rule 3 predicted. See below.**

### `js_pow` was three different functions (2026-08-10)

Rule 3 above said the wasm build "is expected to diverge". It did — and so did
the Windows build, for an entirely different reason, which is the part rule 3
got wrong. Both non-native targets were generating floors no fixture describes:

| target | `f64::powf` vs the runtime, x^1.35 over 200,001 | what it actually is |
|---|---:|---|
| `x86_64-unknown-linux-gnu` (the gated one) | 0 | glibc ≥2.28 = ARM optimized-routines |
| `wasm32-unknown-unknown` | 19,904 | `compiler_builtins` → the `libm` crate → Sun's `e_pow.c` |
| `x86_64-pc-windows-gnullvm` (**the play target**) | 201 | mingw's own — not fdlibm either |

The Windows row is the one to remember. "wasm falls back to fdlibm" was a
correct, specific, *insufficient* theory: it predicted one target and there
were two, and the second was the one people actually play. A rule that
enumerates targets loses a race against the next target; the fix is for the
primitive to not ask.

**So `js_pow` carries the routine.** `jsmath::pow_arm` is ARM's
optimized-routines `pow` — what glibc ships and what the runtime matches —
with tables generated by `scripts/transcribe-pow-tables.py` rather than copied
by hand (128 four-double rows and 256 u64s is a table that is right in 383
places).

**⚠️ And the transcription alone was not enough, which is the finding.** Every
operation exactly as the C spells it, both `HAVE_FAST_FMA` arms tried, still
differed on **153 of 200,001** — 130× better than fdlibm and still not parity.
The missing arithmetic is not in the source at all: glibc compiles its
`e_pow-fma` ifunc variant with `-mfma`, and GCC's default
`-ffp-contract=fast` then fuses `a*b + c` into single `fma`s that the C never
writes. Five builds of the same file settle it — `-mfma` gives 0 divergences,
`-mfma -ffp-contract=off` gives exactly 153, plain `-O2` gives 153 — and under
contraction the two `HAVE_FAST_FMA` arms converge, so the arm never mattered.
`scripts/pow-contraction-probe.c` is that experiment, kept.

Which expressions get fused was read off `-fdump-tree-optimized`, not guessed;
each `mul_add` in `pow_arm.rs` is one line of that dump, including the two
places GCC *declines* to fuse because `ar2` has other readers. Rust never
contracts on its own, which is exactly why the result is portable.

**Rules this adds.**

4. **A transcription is of a BUILD, not a file.** Optimisation flags are part
   of the algorithm when the algorithm is bit-exact arithmetic. Before
   concluding a faithful port is faithful, compile the original both ways.
5. **"More accurate" is not the goal and can be the bug.** Against a 60-digit
   reference, the *unfused* form is the correctly-rounded answer at
   x = 0.00944 and the runtime's is not. Both are legal ≤0.54 ulp results. The
   requirement is the runtime's bits; a better `pow` fails this gate.
6. **The oracle now has a hardware precondition.** These fixtures were exported
   on a CPU with FMA, so node used glibc's FMA ifunc variant. A machine without
   it would export different bytes from the same node build.
7. Two gates, both cheap, both CI-able (no GPU): `node
   scripts/jsmath-wasm-check.mjs` and `cargo test --target
   x86_64-pc-windows-gnullvm -p pk-core --test jsmath_oracle`. Run them when a
   primitive lands, not when a floor looks wrong.

**Closed 2026-08-10 — `js_cos`/`js_sin` landed, and the corpus is whole.**
Sun's 1993 `s_sin.c`/`s_cos.c`/`k_sin.c`/`k_cos.c`/`e_rem_pio2.c`/
`k_rem_pio2.c`, transcribed verbatim into `jsmath/fdlibm.rs`. All ten corpus
floors are bit-exact at the pass-1 boundary and the by-name exclusion list is
deleted rather than shrunk. Over the oracle's ten trig sweeps the twins match
every one; `libm` differs on 918–2,024 inputs per sweep and std on
1,604–6,815.

Three things came out of doing it that are worth more than the twins:

- **The `js_pow` gate had never executed.** It read
  `assets/fixtures/jsmath-pow-oracle.json`; the exporter has always written
  `jsmath-oracle.json`. So the test failed at the file read with *"fixture
  missing — run the exporter"*, which reads as an unconfigured checkout, not
  as a broken gate. The parity gate written to catch 1-ulp drift had been
  reporting a setup problem since the day it landed. A missing-fixture panic
  is a claim about a PATH; check the name before you believe it.
- **The sweep list did not cover what its comment claimed.** The comment said
  the ranges reached "the multi-word reduction where implementations differ
  most". They did not: the reduction switches to the 2/π table at
  2^20·(π/2) ≈ 1.647e6, and the largest sweep stopped at 1e6. Three ranges
  added (1e8, 1e15, 1e300). The twins match all three, so `k_rem_pio2` is
  measured rather than assumed — but for a while a whole branch was covered
  only by a sentence.
- **`exp` and `log` have no agreeing implementation, and are already called.**
  Same story as `cos` — V8 keeps fdlibm's `e_exp.c`/`e_log.c`, everyone else
  moved to the table-driven ARM optimized-routines versions.
  `pk_core::combo` calls `libm::exp`/`libm::log` for the corner-restitution,
  corner-add and combo-window curves that feed pinball physics;
  `gambler::darts` calls `libm::log10`; `intro.rs` uses std `ln`/`exp`. The
  600-tick momentum fixture is bit-exact today, which is a fact about the
  inputs those traces happen to take and NOT about the primitives being safe.
  Pinned as a named gap test that fails when a twin lands.

**Rule 4, learned here.** A gate that cannot fail is not a gate, and the
failure modes are quieter than "it went green": a path typo that reads as a
missing fixture, a comment that asserts coverage the numbers do not provide,
and a primitive nobody swept because nobody noticed it was being called. All
three passed review as recently as the commit that introduced them.

**Closed the same day — `js_exp`/`js_log`, and a lesson about reading a
digest.** The survey printed the same four words for both rows,
`NOTHING MATCHES`, and the two rows had nothing to do with each other.

- `log` IS the `cos` story. `libm::log` is musl's table-driven
  optimized-routines version; V8 kept fdlibm 5.3. Verbatim `e_log.c`
  reproduces the runtime. The divergence is confined to the `k == 0` band
  (√2/2 … √2) where `k·ln2` stops dominating the sum — 2,013 of 50,001 inputs
  there, and **zero** at 1e300 and zero in the subnormals.
- `exp` is NOT. `libm::exp` already **is** fdlibm's `e_exp` — the Rust crate
  never took the rewrite. Across eight ranges and ~400,000 inputs it misses the
  runtime on exactly one: `x == 1`, where V8 answers `Math.E`. It shows in the
  raw dump as a break in monotonicity (`…768, …769, …769, …76b` — `76a`
  skipped). `js_exp` is `e_exp.c` plus one guard.

**Rule 5.** A digest is a verdict, not a diagnosis. "This curve is wrong" over
200,001 points and "this curve is wrong at one point" produce the identical
failure, and acting on the verdict alone would have justified a 200-line
transcription on evidence that supported a one-line guard. Dump the raw f64s
and diff them per input — `legacy/scripts/dump-trig-sweep.mjs` against
`cargo run -p pk-core --example dump_unary` — BEFORE deciding what the fix is.
It named the input on the first run.

Consequence for the negative controls: they can no longer be one blanket
"`libm` disagrees", because for five of the new sweeps `libm` agrees exactly
and asserting otherwise would pin a falsehood. They are now per-range, with
`libm::exp`'s divergence pinned at *exactly one* swept range — so adding a
sweep that contains 1.0, or a `libm` that stops being fdlibm, both fail loudly.

**What the sabotage pass found — the gates hold, with three named holes.**
Seventeen sabotages, each reverted, all re-run under a private target dir.

- **The three huge sweeps are not decoration.** Disabling the multi-word
  reduction (medium-size bound raised so `k_rem_pio2` is never called) turns
  exactly the six 1e8/1e15/1e300 ranges red and leaves the four small ones
  green. Those ranges were added on suspicion; they are the only thing that
  catches it.
- **Three of the prescribed sabotages were NO-OPS, and that is a result.**
  Perturbing C6's last digit produces the *same f64* (below the parse floor,
  not the rounding floor). `trunc(a + 0.5)` vs `round(a)` are arithmetically
  identical over this branch's reachable domain. Reverting `track_grow:326` to
  `libm` changes nothing because Spine's theta is one of {0, π/4, π/2, 3π/4},
  where every implementation agrees bit-for-bit. A sabotage that does not
  reproduce a defect proves nothing about the gate — it has to be replaced,
  not scored.
- **Hole 1: the readable unit test did not catch the mistake it documents.**
  `cos(0.1)` stayed green under a FreeBSD-ised `kernel_cos`, a FreeBSD-ised
  `kernel_sin`, AND deleting the `qx` branch — all three of which turn all ten
  sweeps red. At one input the two polynomial forms usually round the same; what
  differs at `cos(0.1)` is the shape of the final sum. Now spread across all
  three `kernel_cos` branches and both `kernel_sin` tail modes, with a header
  that says plainly it is not the gate.
- **Hole 2: both gates halted on the first divergence and threw away the
  shape.** One red range means a branch bug; ten red ranges mean the kernel.
  One moved floor means a value on a rounding boundary; three mean the
  algorithm — and deleting `qx` moves three while the old abort reported one.
  Both now collect and report the whole set.
- **Hole 3: two things are untestable here and now say so in the code.** The
  third Cody–Waite iteration (`if i > 49`) is reached **zero** times across
  every sweep and every corpus floor while the second fires 192,436 times —
  deleting it is undetectable. And only about the first EIGHT significant
  digits of the trailing coefficients are load-bearing: a genuine 1-ulp change
  to C6 is invisible to everything.
- **The maze corpus is a much weaker trig gate than it looks.** Across the five
  hub floors, 153 trig calls, 3 differ between `js_*` and `libm`, and exactly
  ONE moves a node into a different cell. The maze side of this rests on a
  single sample; the sweeps carry the weight. The corpus also cannot see the
  `sin` half at all — FreeBSD-ising `kernel_sin` leaves 10 of 10 floors green.

**The call sites: `combo.rs` switched, and the switch changes nothing.** All
five (`comboSpeedCeil`'s `log`, the restitution/add/window `exp`s) now call the
twins, and every trace stayed bit-exact — which is exactly the situation the
repo's own rule warns about, so it was measured rather than assumed. The raw
`log(1 + 0.15·n)` really does differ from `libm`'s on 2 of the first 201 combo
depths; `combo_speed_ceil` does not differ on any of them, because `num / den`
divides the ulp away. The `exp` sites are safe for a different reason:
`libm::exp` already IS fdlibm and its only divergence is at `x == 1`, which
`-λ·n ≤ 0` cannot reach.

So the switch is correct-by-construction, not a bug fixed, and **no test can
tell the two versions apart today** — recorded in `combo.rs`'s header rather
than left as an unexplained green. It is still right: `bounce_combo` is integral
only because `comboTicks` is 0/1/2 with a one-draw pick and no blending, and
`COMBO_CEIL_K` is a tuning constant. Move either and the divergence becomes
reachable as a physics desync nobody would trace back to a logarithm.

**Still open:** `intro.rs`'s camera zoom still uses std `ln`/`exp`, and it is
not covered by any fixture — `intro_trace.rs` replays the ball, not the camera
pose. A fixture has to exist before that switch can be verified, so it is
deliberately not made. `Math.log10`
is computed independently by V8 (not `log(x)/LN10` — they differ 1–2 ulp) and
`libm::log10` misses on 3,827 of 100,001, but no `Math.log10` exists anywhere in
the legacy TS, so `darts.rs`'s use of it is Rust-original with no runtime answer
to reproduce and needs no twin today.

## 2026-08-09 — serde_json silently mangles the parity fixtures

The very first bit-exact fixture replay failed at tick 12:
`0.9100000000000037` (fixture, confirmed in the raw JSON and by Python)
read back as `…36` in Rust. The sim was bit-perfect — **serde_json's default
float parsing is fast but up to 1 ulp lossy**. The `float_roundtrip` feature
makes it correctly rounded; it is now enabled in the workspace with a
LOAD-BEARING comment.

**Rule:** the harness must be held to the same bit-exactness as the sim.
Any new fixture reader (another format, another crate) gets a
known-hard-decimal round-trip test before it is trusted. Also proof the
harness works: it caught a real 1-ulp bug on its first run — just in its own
parser rather than the port.

## 2026-08-09 — SwiftShader WebGPU fails 4-byte mapped buffers

Headless WSL Chrome with `--use-webgpu-adapter=swiftshader` panics the wasm
build in `createBuffer`: *"size (4) is too large for the implementation when
mappedAtCreation == true"*. Instrumenting every `createBuffer` showed only
3.3 MB total allocated, 0.1 MB of it mapped, before a **4-byte** mapped
allocation failed — and the same call succeeds on a fresh device. Not memory
pressure, not our textures (reproduced with ÷8 sheets): a SwiftShader defect
in mapped-buffer allocation after ~35 buffers of Bevy device setup.

**Rule:** SwiftShader cannot smoke-test this Bevy app at all — it isn't just
wrong-perf, it's wrong-correctness. All wasm verification goes through real
Windows host Chrome over CDP (`legacy/scripts/lib/host-chrome.mjs`, same infra
the TS playtest used). That path verified the slice end-to-end the same day.

## Inherited from the TS era (so the port doesn't relive them)

- **2026-08-08 — "A port that deletes ships green."** A sub-phase 6/7 "native
  WebGPU" conversion in braindeadbot-client deleted the renderer and room art
  it claimed to port; new tests certified the stubs; it shipped live and was
  reverted (`7937bfe`). Lesson for THIS port: parity fixtures against the
  legacy oracle, in the same PR as the ported code — a green suite over stubs
  proves nothing unless the suite is the oracle's.
- **Inbox sidecar vs published manifest.** Two JSON shapes; conflating them
  fails silently (loader falls back to the painter with no error). `pk-assets`
  now owns both shapes in the type system.
- **WSL GPU mirages.** SwiftShader (headless) and WSLg/llvmpipe render
  wrong-perf truth; every GPU timing must come from Windows host Chrome or a
  host-native build.

*(new incidents go above this line, newest first)*
