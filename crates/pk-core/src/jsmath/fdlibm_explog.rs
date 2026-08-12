//! Sun's ORIGINAL fdlibm `exp`/`log` — the ones the JS runtime still runs.
//!
//! Same shape as `fdlibm.rs`'s sin/cos, and the survey said the same thing
//! ("exp NOTHING MATCHES", "log NOTHING MATCHES"). It was not the same cause.
//! The two rows failed for two completely different reasons, and only one of
//! them is the story the trig twins told.
//!
//! ## `log` — the expected answer, and it holds
//!
//! `libm::log` is a port of musl's, and musl (like glibc, hence this platform's
//! std) replaced Sun's routine with ARM optimized-routines' table-driven one: a
//! 128-entry table plus a short polynomial around the tabulated point, instead
//! of fdlibm's single reduction to `sqrt(2)/2 < 1+f < sqrt(2)` and a degree-7
//! polynomial in `s = f/(2+f)`. V8 kept the 1993 code (`src/base/ieee754.cc`, a
//! translation of fdlibm 5.3), so the two disagree — 1 ulp, and always inside
//! the reduced band, because outside it the `k*ln2` term dominates and both
//! land on the same double. Measured against node, divergent inputs:
//!
//! ```text
//!   range                          n        libm    std
//!   [1e-9, 1e3]  (the oracle's)    100001    196   1903
//!   [0.7071, 1.4143]  (the band)    50001   2013   2663   ← 4% of inputs
//!   [0.999999, 1.000001]            50001     15     15
//!   [5e-324, 1e-300]  (subnormal)   50001      0      7
//!   [1e300, MAX]                    50001      0      0
//!   Math.log(185)   node 0x4014e1a4f518c72c   libm & std 0x…2b
//! ```
//!
//! ## `exp` — NOT what the survey implied
//!
//! `libm::exp` **is** fdlibm's `e_exp` — the Rust `libm` crate never took the
//! table-driven rewrite for this one. Over eight swept ranges crossing the
//! overflow and underflow thresholds, the subnormal tail, the `|x| < 2^-28`
//! fast path and both argument-reduction boundaries, `libm::exp` reproduces
//! node on every single input **except one**:
//!
//! ```text
//!   range                          n        libm    std
//!   [-20, 20]  (the oracle's)      100001      1   9621
//!   [-709, 709]                    100001      0   9740
//!   [700, 709.782712893384]         50001      0   4692
//!   [-745.2, -708]                  50001      0    535
//!   [-746, -744]  (subnormal tail)  50001      0      0
//!   [-1e-8, 1e-8]  (fast path)      50001      0    296
//!   [0.34, 0.35]  (0.5·ln2)         50001      0   8821
//!   [1.03, 1.05]  (1.5·ln2)         50001      0   9488
//! ```
//!
//! That one input is `x == 1`, where V8 returns `Math.E` and fdlibm returns the
//! next double up — see the guard at the top of [`js_exp`]. A whole-curve digest
//! cannot tell "one special case" from "the wrong algorithm"; it says NOTHING
//! MATCHES either way. `example/dump_unary` + `dump-trig-sweep.mjs --diff` named
//! the input in one run, which is the entire reason those two exist.
//!
//! So `js_exp` is carried for one input and `js_log` for one input in twenty-five
//! — and the port must call both, because neither knows which input it will get.
//!
//! ## Why this is not academic
//!
//! `pk_core::combo` already calls `libm::exp` and `libm::log` for the
//! corner-restitution, corner-add and combo-window curves that feed pinball
//! physics. `combo_speed_ceil`'s `log(1 + k·n)` lands squarely in the divergent
//! band for small combo counts. Those call sites are NOT switched here — doing
//! so changes shipped sim behaviour and needs its own fixture re-verification.
//!
//! Ported verbatim from fdlibm 5.3 `e_exp.c` and `e_log.c`, and gated by
//! `crates/pk-core/tests/jsmath_oracle.rs` over the ranges tabulated above.
//!
//! PORTS-NOTHING — Sun fdlibm exp/log, same reason

// Same rationale as `fdlibm.rs`: the constants are transcribed DIGIT FOR DIGIT
// from the C, which writes more decimals than an f64 can hold. Keeping the
// literals identical to fdlibm's is what lets the next reader diff this file
// against the original and see that nothing was "tidied" on the way in.
#![allow(clippy::excessive_precision)]
// `e_log.c` opens with `if (((hx&0x7fffffff)|lx)==0) return -two54/zero;` and
// `if (hx<0) return (x-x)/zero;` — dividing by a named `zero` to raise the
// right IEEE exception, and `x - x` to propagate a NaN payload. Clippy reads
// both as mistakes (`eq_op`, and the divide as suspicious); they are the C, and
// the whole value of this file is that it still diffs against the C.
#![allow(clippy::eq_op)]
// `approx_constant` on `INVLN2` — it is log2(e), written as `e_exp.c`'s literal
// rather than `f64::consts::LOG2_E` for the same reason. Deny-level, like the
// two above: left unsuppressed it aborts the workspace lint run.
#![allow(clippy::approx_constant)]

use super::fdlibm::{from_words, high_word, low_word};

// ─── e_exp.c ─────────────────────────────────────────────────────────────────

const ONE: f64 = 1.0;
const HALF: [f64; 2] = [0.5, -0.5];
const HUGE: f64 = 1.0e+300;
/// 2**-1000 — the scale factor that lets the k < -1021 path build a subnormal
/// result without the exponent add overflowing into the sign bit.
const TWOM1000: f64 = 9.332_636_185_032_188_789_90e-302;
/// The largest x with a finite `exp(x)`: 0x40862E42_FEFA39EF.
const O_THRESHOLD: f64 = 7.097_827_128_933_839_730_96e+02;
/// Below this, `exp(x)` is 0: 0xC0874910_D52D3051.
const U_THRESHOLD: f64 = -7.451_332_191_019_411_084_20e+02;
const LN2HI: [f64; 2] = [
    6.931_471_803_691_238_164_90e-01,
    -6.931_471_803_691_238_164_90e-01,
];
const LN2LO: [f64; 2] = [
    1.908_214_929_270_587_700_02e-10,
    -1.908_214_929_270_587_700_02e-10,
];
const INVLN2: f64 = 1.442_695_040_888_963_387_00e+00;
const P1: f64 = 1.666_666_666_666_660_190_37e-01;
const P2: f64 = -2.777_777_777_701_559_338_42e-03;
const P3: f64 = 6.613_756_321_437_934_361_17e-05;
const P4: f64 = -1.653_390_220_546_525_153_90e-06;
const P5: f64 = 4.138_136_797_057_238_460_39e-08;

/// `Math.exp(x)` as the JS runtime computes it — fdlibm's `__ieee754_exp`.
///
/// The shape the table-driven rewrites abandoned: reduce `x = k*ln2 + r` with
/// `|r| <= ln2/2`, evaluate a degree-5 *odd* polynomial in `r` and recover
/// `exp(r)` as `1 - ((r*c)/(c-2) - r)` — a rational reconstruction, not a
/// direct series. The division is where fdlibm's rounding lands somewhere the
/// optimized-routines version's fused table term does not, and that is the ulp.
pub fn js_exp(x: f64) -> f64 {
    // ⚠️ THE ONE PLACE V8 IS NOT FDLIBM. `Math.exp(1)` returns `Math.E` — the
    // correctly-rounded e — where fdlibm's own algorithm returns the next
    // double UP. Measured, not read: over [-20, 20] at 100,001 points, node and
    // a verbatim fdlibm differ on exactly ONE input, and it is x == 1. It shows
    // up as a break in monotonicity, which is what a special case looks like
    // from outside:
    //
    //   x            node                 fdlibm 5.3
    //   0.9999…998   0x4005bf0a8b145768   0x4005bf0a8b145768
    //   0.9999…999   0x4005bf0a8b145769   0x4005bf0a8b145769
    //   1            0x4005bf0a8b145769   0x4005bf0a8b14576a   ← 769 twice
    //   1.0000…002   0x4005bf0a8b14576b   0x4005bf0a8b14576b
    //
    // Nothing else in the sweeps needs it: the overflow and underflow edges,
    // the subnormal tail, the |x| < 2^-28 fast path and both argument-reduction
    // boundaries are all plain fdlibm. Do not "fix" the non-monotonicity — it
    // is the runtime's answer, and matching the runtime is the whole job.
    if x == 1.0 {
        return std::f64::consts::E;
    }
    let mut x = x;
    let hx0 = high_word(x) as u32;
    let xsb = ((hx0 >> 31) & 1) as usize; // sign bit of x
    let hx = hx0 & 0x7fff_ffff; // high word of |x|

    // filter out non-finite argument
    if hx >= 0x4086_2E42 {
        // if |x| >= 709.78...
        if hx >= 0x7ff0_0000 {
            if ((hx & 0xf_ffff) | low_word(x)) != 0 {
                return x + x; // NaN
            }
            // exp(+-inf) = {inf, 0}
            return if xsb == 0 { x } else { 0.0 };
        }
        if x > O_THRESHOLD {
            return HUGE * HUGE; // overflow
        }
        if x < U_THRESHOLD {
            return TWOM1000 * TWOM1000; // underflow
        }
    }

    // argument reduction
    let mut k = 0_i32;
    let mut hi = 0.0_f64;
    let mut lo = 0.0_f64;
    if hx > 0x3fd6_2e42 {
        // if |x| > 0.5 ln2
        if hx < 0x3FF0_A2B2 {
            // and |x| < 1.5 ln2 — k is exactly +-1, no rounding to do
            hi = x - LN2HI[xsb];
            lo = LN2LO[xsb];
            k = 1 - xsb as i32 - xsb as i32;
        } else {
            k = (INVLN2 * x + HALF[xsb]) as i32;
            let t = f64::from(k);
            hi = x - t * LN2HI[0]; // t*ln2HI is exact here
            lo = t * LN2LO[0];
        }
        x = hi - lo;
    } else if hx < 0x3e30_0000 {
        // when |x| < 2**-28: exp(x) is 1+x to the last bit. The `huge+x > one`
        // guard is fdlibm's way of RAISING INEXACT, not a real test — it is
        // true for every finite x. Kept because it is in the C.
        if HUGE + x > ONE {
            return ONE + x;
        }
    } else {
        k = 0;
    }

    // x is now in primary range
    let t = x * x;
    let c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
    if k == 0 {
        return ONE - ((x * c) / (c - 2.0) - x);
    }
    let y = ONE - ((lo - (x * c) / (2.0 - c)) - hi);
    if k >= -1021 {
        // add k to y's exponent
        scale_high_word(y, k << 20)
    } else {
        scale_high_word(y, (k + 1000) << 20) * TWOM1000
    }
}

/// fdlibm's `__HI(y) += n` — wrapping unsigned addition into the high word,
/// which is how the C adds `k` to the exponent without a `scalbn` call.
#[inline]
fn scale_high_word(y: f64, n: i32) -> f64 {
    let hi = (y.to_bits() >> 32) as u32;
    from_words(hi.wrapping_add(n as u32), low_word(y))
}

// ─── e_log.c ─────────────────────────────────────────────────────────────────

const LN2_HI: f64 = 6.931_471_803_691_238_164_90e-01;
const LN2_LO: f64 = 1.908_214_929_270_587_700_02e-10;
const TWO54: f64 = 1.801_439_850_948_198_400_00e+16;
const LG1: f64 = 6.666_666_666_666_735_130e-01;
const LG2: f64 = 3.999_999_999_940_941_908e-01;
const LG3: f64 = 2.857_142_874_366_239_149e-01;
const LG4: f64 = 2.222_219_843_214_978_396e-01;
const LG5: f64 = 1.818_357_216_161_805_012e-01;
const LG6: f64 = 1.531_383_769_920_937_332e-01;
const LG7: f64 = 1.479_819_860_511_658_591e-01;

const ZERO: f64 = 0.0;

/// `Math.log(x)` as the JS runtime computes it — fdlibm's `__ieee754_log`.
///
/// `x = 2^k * (1+f)` with `sqrt(2)/2 < 1+f < sqrt(2)`, then `log(1+f) = f -
/// s*(f-R)` for `s = f/(2+f)` and `R` a degree-7 even polynomial in `s^2`. The
/// two things a reader will want to find:
///
/// · The `|f| < 2^-20` short circuit — inputs within about a millionth of a
///   power of two skip the polynomial entirely and take `f - f*f*(0.5 - f/3)`.
///   That is a whole separate rounding path, which is why the gate sweeps a
///   range tight around 1.0 (`k == 0`, `f` tiny) as well as the wide one.
/// · `i |= j` — the branchless "is `1+f` near 1?" test, comparing `hx` against
///   both `0x6147a` and `0x6b851` at once through the sign bit. It selects
///   whether the `hfsq = f*f/2` cancellation term is carried explicitly.
///
/// Subnormal inputs are scaled by 2^54 first and 54 is subtracted from `k`;
/// there is no other path to them, so the gate sweeps that range too.
pub fn js_log(x: f64) -> f64 {
    let mut x = x;
    let mut hx = high_word(x);
    let lx = low_word(x);

    let mut k = 0_i32;
    if hx < 0x0010_0000 {
        // x < 2**-1022
        if ((hx & 0x7fff_ffff) as u32 | lx) == 0 {
            return -TWO54 / ZERO; // log(+-0) = -inf
        }
        if hx < 0 {
            return (x - x) / ZERO; // log(-#) = NaN
        }
        k -= 54;
        x *= TWO54; // subnormal number, scale up x
        hx = high_word(x);
    }
    if hx >= 0x7ff0_0000 {
        return x + x;
    }
    k += (hx >> 20) - 1023;
    hx &= 0x000f_ffff;
    let mut i = (hx + 0x95f64) & 0x100000;
    x = from_words((hx | (i ^ 0x3ff0_0000)) as u32, low_word(x)); // normalize x or x/2
    k += i >> 20;
    let f = x - 1.0;
    if (0x000f_ffff & (2 + hx)) < 3 {
        // |f| < 2**-20
        if f == ZERO {
            if k == 0 {
                return ZERO;
            }
            let dk = f64::from(k);
            return dk * LN2_HI + dk * LN2_LO;
        }
        let r = f * f * (0.5 - 0.33333333333333333 * f);
        if k == 0 {
            return f - r;
        }
        let dk = f64::from(k);
        return dk * LN2_HI - ((r - dk * LN2_LO) - f);
    }
    let s = f / (2.0 + f);
    let dk = f64::from(k);
    let z = s * s;
    i = hx - 0x6147a;
    let w = z * z;
    let j = 0x6b851 - hx;
    let t1 = w * (LG2 + w * (LG4 + w * LG6));
    let t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
    i |= j;
    let r = t2 + t1;
    if i > 0 {
        let hfsq = 0.5 * f * f;
        if k == 0 {
            f - (hfsq - s * (hfsq + r))
        } else {
            dk * LN2_HI - ((hfsq - (s * (hfsq + r) + dk * LN2_LO)) - f)
        }
    } else if k == 0 {
        f - s * (f - r)
    } else {
        dk * LN2_HI - ((s * (f - r) - dk * LN2_LO) - f)
    }
}

#[cfg(test)]
mod tests {
    use super::{js_exp, js_log};

    /// Inputs where the runtime and the library candidates disagree, bits
    /// pinned from node. One value proves nothing on its own — that is the
    /// module's whole lesson, and `tests/jsmath_oracle.rs` is the real gate over
    /// swept ranges — but a failure here is something a human can read.
    ///
    /// Note which candidate is wrong where: no single input catches both, which
    /// is exactly why the survey needs three columns and not two.
    #[test]
    fn exp_and_log_are_the_runtimes_bits_and_not_the_libraries() {
        // exp(1): V8's one departure from fdlibm. std happens to agree with the
        // runtime here (it is correctly rounded, and so is `Math.E`).
        assert_eq!(js_exp(1.0).to_bits(), 0x4005_bf0a_8b14_5769);
        assert_eq!(libm::exp(1.0).to_bits(), 0x4005_bf0a_8b14_576a);

        // exp(19): the reverse — libm agrees (it IS fdlibm), std does not.
        assert_eq!(js_exp(19.0).to_bits(), 0x41a5_46d8_f9ed_26e2);
        assert_eq!(f64::exp(19.0).to_bits(), 0x41a5_46d8_f9ed_26e1);

        // log(14): libm's table-driven routine, 1 ulp off the runtime.
        assert_eq!(js_log(14.0).to_bits(), 0x4005_1cca_16d7_bba7);
        assert_eq!(libm::log(14.0).to_bits(), 0x4005_1cca_16d7_bba8);

        // log(185): the one integer under 200 where BOTH candidates are wrong.
        assert_eq!(js_log(185.0).to_bits(), 0x4014_e1a4_f518_c72c);
        assert_eq!(libm::log(185.0).to_bits(), 0x4014_e1a4_f518_c72b);
        assert_eq!(f64::ln(185.0).to_bits(), 0x4014_e1a4_f518_c72b);
    }

    /// `Math.exp(1)` is a special case, so it BREAKS MONOTONICITY: the runtime
    /// returns the same double for `1` as for the double just below it. A twin
    /// that "cleaned that up" would be wrong on exactly one input in the whole
    /// double range and pass every spot check ever written, so it is pinned.
    #[test]
    fn the_exp_of_one_special_case_is_non_monotone_on_purpose() {
        let below = f64::from_bits(1.0_f64.to_bits() - 1);
        let above = f64::from_bits(1.0_f64.to_bits() + 1);
        assert_eq!(js_exp(below).to_bits(), 0x4005_bf0a_8b14_5769);
        assert_eq!(js_exp(1.0).to_bits(), 0x4005_bf0a_8b14_5769); // the same value
        assert_eq!(js_exp(above).to_bits(), 0x4005_bf0a_8b14_576b); // …576a skipped
                                                                    // Both neighbours are plain fdlibm — libm reproduces them exactly.
        assert_eq!(js_exp(below).to_bits(), libm::exp(below).to_bits());
        assert_eq!(js_exp(above).to_bits(), libm::exp(above).to_bits());
    }

    /// Exact answers must stay exact. An error in the argument reduction or in
    /// the high-word exponent add shows up here first.
    #[test]
    fn the_exact_cases_stay_exact() {
        assert_eq!(js_exp(0.0), 1.0);
        assert_eq!(js_exp(-0.0), 1.0);
        assert_eq!(js_log(1.0).to_bits(), 0.0_f64.to_bits());
        // Powers of two hit e_log.c's f == 0 short circuit — the only inputs
        // that return `k*ln2` with no polynomial at all.
        for k in [-1074_i32, -60, -1, 1, 60, 1023] {
            let x = libm::scalbn(1.0, k);
            assert_eq!(js_log(x).to_bits(), f64::ln(x).to_bits(), "log(2^{k})");
        }
    }

    /// The two thresholds `exp` hard-codes, and the paths either side of them.
    /// Bits from node; the `k < -1021` path is the one a `scalbn`-based rewrite
    /// would get subtly wrong, so it is checked as a value and not as `> 0`.
    #[test]
    fn the_exp_thresholds() {
        // o_threshold, the largest finite result.
        assert_eq!(js_exp(709.782_712_893_384).to_bits(), 0x7fef_ffff_ffff_ff2a);
        assert!(js_exp(709.9).is_infinite());
        // u_threshold, the smallest non-zero result — one subnormal ulp.
        assert_eq!(
            js_exp(-745.133_219_101_941_1).to_bits(),
            0x0000_0000_0000_0001
        );
        assert_eq!(js_exp(-745.2), 0.0);
        // …and the `k < -1021` scale-by-2^-1000 path in between must not flush.
        assert!(js_exp(-745.0) > 0.0);
        assert_eq!(js_exp(-745.0).to_bits(), libm::exp(-745.0).to_bits());
    }

    #[test]
    fn the_nonfinite_contract() {
        assert!(js_exp(f64::NAN).is_nan());
        assert_eq!(js_exp(f64::INFINITY), f64::INFINITY);
        assert_eq!(js_exp(f64::NEG_INFINITY), 0.0);
        assert!(js_log(f64::NAN).is_nan());
        assert!(js_log(-1.0).is_nan());
        assert_eq!(js_log(f64::INFINITY), f64::INFINITY);
        assert_eq!(js_log(0.0), f64::NEG_INFINITY);
        assert_eq!(js_log(-0.0), f64::NEG_INFINITY);
    }

    /// Round-trip through both twins across every `log` branch — the tiny-|f|
    /// short circuit, both sides of the `i |= j` selector, and the subnormal
    /// scale-up.
    #[test]
    fn every_branch_round_trips() {
        for x in [
            5e-324,              // subnormal, scaled by 2^54 first
            1e-300,              // k very negative
            1.0 + 1e-9,          // |f| < 2**-20, k == 0
            0.75,                // i |= j negative side
            1.4,                 // i |= j positive side
            std::f64::consts::E, // ordinary
            1e300,               // k very positive
        ] {
            let l = js_log(x);
            assert!(
                (l - f64::ln(x)).abs() <= 1e-13 * l.abs().max(1.0),
                "log({x}) = {l} vs std {}",
                f64::ln(x)
            );
        }
    }
}
