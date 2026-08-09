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
//! `libm::hypot`. (`Math.sqrt`/`f64::sqrt` are both IEEE-correctly-rounded
//! and need no twin; `Math.sin/cos/atan2` go through `libm`, which matched V8
//! bit-for-bit on every fixture so far.)

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
