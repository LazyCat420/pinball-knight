# Incidents

Diagnoses that outlive their patches. Write the reasoning, not just the fix.

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

**Still open:** the call sites. `combo.rs` (`comboSpeedCeil`'s `log`, and the
restitution/add/window `exp`s), `intro.rs`'s camera zoom. `combo`'s `log(1+k·n)`
for small `n` lands INSIDE the divergent band, so switching it needs
`pinball-trace-seed7` and `booster_corner_sim` re-verified; `intro.rs`'s camera
pose is not covered by any fixture at all and needs one written first. `Math.log10`
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
