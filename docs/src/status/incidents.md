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

**Open:** `js_cos`/`js_sin` (fdlibm kernels) are not written. Two corpus
floors out of ten are blocked on them, pinned by name in
`pass1_grow_track_replays_the_oracle` so the list must shrink when they land.

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
