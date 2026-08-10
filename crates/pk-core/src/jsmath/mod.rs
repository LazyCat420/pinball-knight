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
//! | `atan` `atan2` `tan` | ✅ | ❌ | `libm` |
//! | `exp` `log` | ✅ | — | `libm` |
//! | `pow` | ❌ 19,904/200,001 | ✅ | [`js_pow`] |
//! | `hypot` | ❌ ~35% | ❌ | [`js_hypot`] |
//! | `cos` `sin` | ❌ | ❌ | [`js_cos`] / [`js_sin`] |
//!
//! Each row was a separate measurement, and four of them were surprises. A
//! spot check cannot produce this table: `pow` agrees with `libm` on exponent
//! 0.5 and disagrees on 1.35, and `cos` disagrees on one input in roughly two.
//! Sweep the whole curve, and sweep it before the port uses the primitive —
//! every row here was found by a floor that came out structurally perfect with
//! the wrong numbers in it.
//!
//! ⚠️ THE `tan` ROW IS THE ONE THAT LOOKS WRONG AND IS NOT. `tan` shares its
//! argument reduction with `cos`/`sin`, and its KERNEL is the one that was
//! rewritten after 1993 (FreeBSD's `k_tan.c`, which musl and therefore Rust's
//! `libm` carry) while V8 kept Sun's — so the expectation going in was that it
//! would need the same twin `cos` and `sin` do. It agrees anyway, and std does
//! not. There is no "the trig family behaves like X" rule to be had here;
//! there is only the sweep.

mod fdlibm;
pub use fdlibm::{js_cos, js_sin};

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
/// ## Why `powf` and not a hand-rolled twin
///
/// A correctly-rounded `pow` is a research-grade routine (ARM's
/// optimized-routines version, which glibc and modern musl both use, needs two
/// 128-entry tables that cannot be re-derived by hand). `f64::powf` IS that
/// routine on this target, verified against the oracle rather than assumed:
/// `tests/jsmath_oracle.rs` replays four full sweeps exported from node.
///
/// ⚠️ OPEN: the guarantee is per-target. On `wasm32-unknown-unknown` there is
/// no system libm and std's `powf` lowers to compiler-builtins — i.e. back to
/// the fdlibm `libm` crate — so the wasm build is EXPECTED to diverge here and
/// has not been measured. The sweep test is what turns that into a loud failure
/// instead of a differently-shaped floor in the browser; running it under wasm
/// is tracked in the port checklist.
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
    x.powf(y)
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
