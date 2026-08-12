//! JS-runtime math twins, for the operations where the C library and V8
//! genuinely disagree.
//!
//! `Math.hypot` in V8 is NOT the correctly-rounded C `hypot`: it is a
//! max-scaled, Neumaier-compensated sum of squares followed by `sqrt` — see
//! v8/src/builtins/math.tq (MathHypot). The two differ by 1 ulp on real
//! inputs; the first one this port met was
//! `hypot(1.0392595781598983, 0.12194765320512813)` (pinball trace, tick
//! 122's steer normalize): glibc/libm 0x3ff0be034652fba0 vs V8
//! 0x3ff0be034652fba1. A 1-ulp momentum error is invisible in the positions
//! for hundreds of ticks and then amplified by the next shaped-tile resolve —
//! which is exactly how it was found.
//!
//! Every ported call site that mirrors `Math.hypot` MUST use this, never
//! `libm::hypot`.
//!
//! ## Which primitive needs a twin — the answer is per-primitive
//!
//! There is no blanket "use libm" or "use std" rule, and this module exists
//! because both of the obvious blanket rules are wrong somewhere. Measured
//! against the runtime by whole-curve digest (`tests/jsmath_oracle.rs`):
//!
//! | fn | `libm` | std (platform) | what to call |
//! |---|---|---|---|
//! | `sqrt` | ✅ | ✅ | either — IEEE-exact, no twin |
//! | `atan` `atan2` `tan` | ✅ | ❌ | `libm` (std: atan 2,356/100,001) |
//! | `pow` | ❌ 19,904/200,001 | ✅ *here only* | [`js_pow`] |
//! | `hypot` | ❌ ~35% | ❌ | [`js_hypot`] |
//! | `cos` `sin` | ❌ | ❌ | [`js_cos`] / [`js_sin`] |
//! | `exp` | ❌ **1 input** | ❌ 9,621/100,001 | [`js_exp`] |
//! | `log` | ❌ 196/100,001 | ❌ 1,903/100,001 | [`js_log`] |
//!
//! ⚠️ THE "std ✅" IN THE `pow` ROW IS TARGET-LOCAL, and that turned out to be
//! the trap the whole table was built to avoid. std's `powf` is only the
//! platform's `pow` where there is a platform: on wasm it lowers to
//! compiler-builtins, i.e. straight back to the fdlibm column. Measured, not
//! reasoned — see [`pow_arm`]. Every OTHER row here is safe by construction
//! (transcribed twins, or the `libm` crate, which is the same pure Rust
//! everywhere); `pow` was the one row that deferred to the target, and it is
//! now transcribed too. A "✅" in the std column is a claim about one machine.
//!
//! Each row was a separate measurement, and four of them were surprises. A
//! spot check cannot produce this table: `pow` agrees with `libm` on exponent
//! 0.5 and disagrees on 1.35, and `cos` disagrees on one input in roughly two.
//! Sweep the whole curve, and sweep it before the port uses the primitive —
//! every row here was found by a floor that came out structurally perfect with
//! the wrong numbers in it.
//!
//! ⚠️ The `exp` row is the one to read twice. `libm::exp` IS fdlibm's `e_exp`
//! and reproduces the runtime on every input of eight swept ranges but one:
//! V8 special-cases `Math.exp(1)` to `Math.E`. The digest reported that row the
//! same way it reported `cos` — "NOTHING MATCHES" — and the two findings could
//! hardly be less alike. A failing digest tells you a curve is wrong, never
//! how wrong; `example/dump_unary` and `dump-trig-sweep.mjs --diff` are what
//! turn it into a named input, and here that took one run.
//!
//! ⚠️ THE `tan` ROW IS THE ONE THAT LOOKS WRONG AND IS NOT. `tan` shares its
//! argument reduction with `cos`/`sin`, and its KERNEL is the one that was
//! rewritten after 1993 (FreeBSD's `k_tan.c`, which musl and therefore Rust's
//! `libm` carry) while V8 kept Sun's — so the expectation going in was that it
//! would need the same twin `cos` and `sin` do. It agrees anyway, and std does
//! not. There is no "the trig family behaves like X" rule to be had here;
//! there is only the sweep.
//!
//! PORTS-NOTHING — dispatch to the target-correct implementations below

mod fdlibm;
mod fdlibm_explog;
mod pow_arm;
mod pow_data;
pub use fdlibm::{js_cos, js_sin};
pub use fdlibm_explog::{js_exp, js_log};
/// Exposed for the oracle's negative control only — production code calls
/// [`js_pow`], which adds the ±0.5 routing the runtime does.
pub use pow_arm::arm_pow;

/// V8's `Math.hypot(a, b)`. Argument ORDER matters (the compensated loop is
/// order-sensitive) — pass arguments exactly as the legacy call site does.
pub fn js_hypot(a: f64, b: f64) -> f64 {
    let (aa, ab) = (a.abs(), b.abs());
    let max = aa.max(ab);
    if max == 0.0 {
        return 0.0;
    }
    if max.is_infinite() {
        return f64::INFINITY;
    }
    let mut sum = 0.0_f64;
    let mut compensation = 0.0_f64;
    for v in [aa, ab] {
        let n = v / max;
        let summand = n * n - compensation;
        let preliminary = sum + summand;
        compensation = (preliminary - sum) - summand;
        sum = preliminary;
    }
    sum.sqrt() * max
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_v8_at_the_tick_122_divergence_input() {
        // The input that exposed the libm/V8 disagreement. V8's bits, pinned.
        let h = js_hypot(1.0392595781598983, 0.12194765320512813);
        assert_eq!(h.to_bits(), 0x3ff0be034652fba1);
        // …and libm demonstrably disagrees here, which is why this exists.
        assert_eq!(
            libm::hypot(1.0392595781598983, 0.12194765320512813).to_bits(),
            0x3ff0be034652fba0
        );
    }

    #[test]
    fn matches_the_easy_cases() {
        assert_eq!(js_hypot(3.0, 4.0), 5.0);
        assert_eq!(js_hypot(1.0, 1.0), std::f64::consts::SQRT_2);
        assert_eq!(js_hypot(0.0, 0.0), 0.0);
        assert_eq!(js_hypot(-3.0, 0.0), 3.0);
    }
}

/// `Math.pow` — and the reason this is not `libm::pow`.
///
/// The workspace determinism rule says transcendentals go through `libm`,
/// never std, because std `sin`/`cos` differ across platforms. For `pow` that
/// rule points at the WRONG implementation, and the maze port is what found it:
///
///   · Rust's `libm` crate carries the FreeBSD/Sun `e_pow.c` — classic fdlibm.
///   · V8's `Math.pow` and this platform's `pow` agree with each other and
///     NOT with fdlibm: over 200,001 values of x^1.35, `libm::pow` differs
///     from both on 19,904 of them, always by exactly 1 ulp.
///
/// One ulp, one input in ten. In `track_grow`'s physarum step that is applied
/// 140 times per floor and the result decides lane WIDTH, so the first port of
/// it produced a graph with the identical topology — same nodes, same edges,
/// same counts — and different roads. Nothing structural could see it; the
/// conductivity digest could.
///
/// ## Why the routine is carried rather than borrowed
///
/// ARM's optimized-routines `pow` — what glibc ships as its `e_pow.c` and what
/// the runtime's answers match — needs two 128-entry tables that cannot be
/// re-derived by hand. That was the argument for calling `f64::powf` and
/// verifying it against the oracle, and it held right up until the target
/// changed underneath it. The tables are now transcribed MECHANICALLY (parse
/// the C hex floats, emit bit patterns) into [`pow_data`], which removes the
/// hand-copying risk that made borrowing attractive in the first place.
///
/// Note it is *not* correctly rounded (0.54 ulp worst case). A more accurate
/// pow would fail this gate. The requirement is the runtime's bits.
///
/// ⚠️ ...and that guarantee was per-TARGET, which is the whole problem. Closed
/// 2026-08-10 by measuring it instead of reasoning about it:
/// `scripts/jsmath-wasm-check.mjs` runs the oracle sweeps inside a
/// `wasm32-unknown-unknown` module and `f64::powf` there diverged on 19,904 /
/// 200,001 (x^1.35), 9,730 / 100,001 (x^2.5) and 5,043 / 50,001 (x^7) inputs,
/// with digests equal to `libm::pow`'s — naming the cause as the
/// compiler-builtins lowering rather than leaving it inferred. So `powf` is
/// gone: [`pow_arm::arm_pow`] is a transcription of the routine the runtime
/// actually agrees with, and it computes the same bits on every target.
/// ## The ±0.5 fast path
///
/// V8 routes exponent ±0.5 to `sqrt`, not to `pow`, and the two are not the
/// same function: over 100,001 values of x^0.5 the platform `pow` and `sqrt`
/// disagree, and the runtime's answer is `sqrt`. (This is also why `libm::pow`
/// happens to match on that exponent — fdlibm special-cases it too — and it is
/// a good illustration of why one spot exponent proves nothing.) The other
/// three sweeps in the oracle exist to keep that from being fitted noise.
///
/// The zero and −∞ guards are the ECMAScript numeric contract, which `sqrt`
/// alone does not satisfy: `pow(-0, 0.5)` is `+0` where `sqrt(-0)` is `-0`, and
/// `pow(-Infinity, 0.5)` is `+Infinity` where `sqrt(-Infinity)` is `NaN`. The
/// maze never reaches any of them — its bases are normalised flows in [0, 1] —
/// so they are written from the spec and pinned in a unit test rather than
/// measured against a sweep that cannot carry `Infinity` through JSON.
#[inline]
pub fn js_pow(x: f64, y: f64) -> f64 {
    if y == 0.5 {
        if x == f64::NEG_INFINITY {
            return f64::INFINITY;
        }
        // `sqrt(-0)` is `-0`; the spec wants `+0`.
        return if x == 0.0 { 0.0 } else { x.sqrt() };
    }
    if y == -0.5 {
        if x == f64::NEG_INFINITY {
            return 0.0;
        }
        return if x == 0.0 {
            f64::INFINITY
        } else {
            1.0 / x.sqrt()
        };
    }
    arm_pow(x, y)
}

#[cfg(test)]
mod pow_tests {
    use super::js_pow;

    /// The ECMAScript contract for the ±0.5 fast path's edge cases — the ones
    /// the oracle sweep cannot express (JSON has no `Infinity` and no `-0`).
    #[test]
    fn the_half_power_fast_path_keeps_the_js_contract() {
        assert_eq!(js_pow(f64::NEG_INFINITY, 0.5), f64::INFINITY);
        assert_eq!(js_pow(f64::NEG_INFINITY, -0.5), 0.0);
        // +0, not -0 — compare the bits, since `-0.0 == 0.0`.
        assert_eq!(js_pow(-0.0, 0.5).to_bits(), 0.0_f64.to_bits());
        assert_eq!(js_pow(0.0, 0.5).to_bits(), 0.0_f64.to_bits());
        assert_eq!(js_pow(-0.0, -0.5), f64::INFINITY);
        assert_eq!(js_pow(0.0, -0.5), f64::INFINITY);
        assert!(js_pow(-4.0, 0.5).is_nan());
        assert_eq!(js_pow(9.0, 0.5), 3.0);
        assert_eq!(js_pow(0.25, -0.5), 2.0);
    }
}
