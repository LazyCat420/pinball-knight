//! `Math.pow`, computed the same way on every target.
//!
//! ## Why this file exists
//!
//! `js_pow` used to be `f64::powf` with a ±0.5 fast path, justified by a
//! measurement: on this box `powf` reproduces the JS runtime over four full
//! sweeps, and `libm::pow` (fdlibm) does not. Both halves of that were true and
//! the conclusion was still target-local — `powf` is only the platform's `pow`
//! where there IS a platform. Measured 2026-08-10 with
//! `scripts/jsmath-wasm-check.mjs`, which runs the oracle sweeps inside a
//! `wasm32-unknown-unknown` module:
//!
//! ```text
//! x^1.35  19,904 / 200,001 differ   max 1 ulp
//! x^2.5    9,730 / 100,001 differ   max 1 ulp
//! x^7      5,043 /  50,001 differ   max 1 ulp
//! x^0.5         0             ——    (the sqrt fast path, not pow at all)
//! ```
//!
//! …and the wasm digests equal `libm::pow`'s exactly, naming the cause: on wasm
//! there is no system libm, so `f64::powf` lowers to `compiler_builtins`, which
//! carries the `libm` crate, which is Sun's `e_pow.c`.
//!
//! `x86_64-pc-windows-gnullvm` — the PLAY target — is worse, and it is worse in
//! a way "wasm falls back to fdlibm" would not have predicted. Measured the
//! same day with `cargo run --target x86_64-pc-windows-gnullvm -p pk-core
//! --example pow_diff`, mingw's `pow` is a THIRD implementation: 201 / 200,001
//! off the runtime on x^1.35, and not fdlibm either (19,904 off that). So both
//! non-native targets were generating floors the fixtures do not describe, for
//! two unrelated reasons. Enumerating targets was never going to work; the
//! routine has to be carried.
//!
//! `js_pow` feeds lane WIDTH in the maze generator ~140 times per floor, and a
//! 1-ulp difference there produces a floor with identical topology and
//! different roads. That is precisely the failure the `jsmath` module exists to
//! prevent, so the fix is to stop asking the target: transcribe the routine and
//! carry it.
//!
//! ## What was transcribed
//!
//! ARM's optimized-routines `math/pow.c` — the implementation glibc has shipped
//! as `sysdeps/ieee754/dbl-64/e_pow.c` since 2.28 and the one the runtime's
//! answers match. Worst case 0.54 ulp, so it is NOT correctly-rounded: a
//! from-scratch high-precision pow would disagree with the runtime on some
//! inputs and be *more* accurate while failing the gate. Reproducing the
//! runtime is the requirement; accuracy is not.
//!
//! The tables in [`super::pow_data`] were converted mechanically by
//! `scripts/transcribe-pow-tables.py` (parse the C hex floats, print bit
//! patterns), never by eye. 128 four-double rows and 256 u64s hand-copied is a
//! table that is right in 383 places.
//!
//! ## ⚠️ THE SOURCE IS NOT THE ALGORITHM — the fusions are load-bearing
//!
//! Transcribing `pow.c` faithfully is not enough, and this is the part worth
//! reading twice. A literal transcription — every operation exactly as the C
//! spells it, both `HAVE_FAST_FMA` arms tried — still differed from the runtime
//! on 153 of 200,001 x^1.35 inputs. 130× better than fdlibm and still not
//! parity, which is what "right algorithm, wrong arithmetic" looks like.
//!
//! The missing piece is in the *build*, not the source: glibc compiles its
//! `e_pow-fma` ifunc variant with `-mfma`, and GCC's default
//! `-ffp-contract=fast` then fuses `a*b + c` into a single `fma` wherever it
//! can. Those fusions are invisible in the C. Measured five ways
//! (`scripts/pow-contraction-probe.c`), and the result is unambiguous:
//!
//! ```text
//! gcc -O2 -mfma                       0 / 200001 differ from glibc pow
//! gcc -O2 -mfma -ffp-contract=off   153 / 200001
//! gcc -O2                           153 / 200001
//! ```
//!
//! …and 153 is exactly what the strict Rust produced. Under contraction the two
//! `HAVE_FAST_FMA` arms converge to the same answer, so the arm stops mattering
//! and only the fusion set does.
//!
//! Which expressions GCC fuses was not guessed. `-fdump-tree-optimized` prints
//! them, and each `mul_add` below is one line of that dump. Note the ones it
//! does *not* fuse: `t2 + ar2` and `t2 - hi + ar2` stay separate because `ar2`
//! has other readers. Rust never contracts on its own, so what is written here
//! is what runs — which is the property that makes wasm and Windows agree with
//! native at all.
//!
//! Two consequences worth carrying:
//!
//! · The oracle's `pow` is the FMA-capable ifunc variant, so these fixtures
//!   describe a CPU with FMA. A machine without it would export different
//!   bytes from the same node.
//! · `f64::mul_add` on wasm lowers to a `compiler_builtins` softfloat `fma` —
//!   exactly rounded, and slower. At ~140 pow calls per generated floor that
//!   cost is not worth a second thought.
//!
//! PORTS-NOTHING — ARM optimized-routines pow, matching V8 fusion-for-fusion

use super::pow_data::{
    EXP_POLY, EXP_TAB, INV_LN2N, LN2HI, LN2LO, LOG_POLY, LOG_TAB, NEG_LN2HI_N, NEG_LN2LO_N, SHIFT,
};

const POW_LOG_TABLE_BITS: u32 = 7;
const EXP_TABLE_BITS: u32 = 7;
const N_EXP: u64 = 1 << EXP_TABLE_BITS;
/// `OFF` in the C: the low end of the log table's range, as raw bits. `z` is
/// normalised into `[OFF, 2*OFF)` so the subinterval index is a bit-slice.
const OFF: u64 = 0x3fe6_9555_0000_0000;
const SIGN_BIAS: u32 = 0x800 << EXP_TABLE_BITS;

// Rust has no hex-float literals, so the C's `0x1pN` scale factors are written
// as bit patterns. `2^e` is the double whose significand is zero and whose
// biased exponent is `e + 1023`, which is what each of these spells out.
/// `0x1p1009` — undoes the 1009-exponent backoff in the overflow path.
const P2_1009: f64 = f64::from_bits(0x7f00_0000_0000_0000);
/// `0x1p-1022` — the smallest normal, the subnormal path's final scale.
const P2_M1022: f64 = f64::from_bits(0x0010_0000_0000_0000);
/// `0x1p-54` — the bottom of `exp_inline`'s fast range.
const P2_M54: f64 = f64::from_bits(0x3c90_0000_0000_0000);
/// `0x1p52` — normalises a subnormal `x` before the log.
const P2_52: f64 = f64::from_bits(0x4330_0000_0000_0000);

#[inline]
fn top12(x: f64) -> u32 {
    (x.to_bits() >> 52) as u32
}

/// `log(x) = y + *tail`, with about 15 bits of headroom in the tail. `ix` is
/// `x`'s bits, already normalised out of the subnormal range by the caller.
///
/// Every `mul_add` below is a fusion GCC performs and the C source does not
/// spell — see the module header. They are not decoration: with them removed
/// this function is 1 ulp from the runtime on 153 of 200,001 inputs.
#[inline]
fn log_inline(ix: u64, tail: &mut f64) -> f64 {
    // x = 2^k z, z in [OFF, 2*OFF) and exact; the range splits into 128
    // subintervals and c sits near the centre of the one holding z.
    let tmp = ix.wrapping_sub(OFF);
    let i = ((tmp >> (52 - POW_LOG_TABLE_BITS)) % (1 << POW_LOG_TABLE_BITS)) as usize;
    let k = (tmp as i64) >> 52; // arithmetic shift, as in the C
    let iz = ix.wrapping_sub(tmp & (0xfff_u64 << 52));
    let z = f64::from_bits(iz);
    let kd = k as f64;

    let (invc, logc, logctail) = LOG_TAB[i];

    // |z/c - 1| < 1/N and 1/c has few significand bits, so r is exact.
    let r = z.mul_add(invc, -1.0);

    // k*Ln2 + log(c) + r, carried as an unevaluated sum.
    let t1 = kd.mul_add(LN2HI, logc);
    let t2 = t1 + r;
    let lo1 = kd.mul_add(LN2LO, logctail);
    let lo2 = t1 - t2 + r;

    // Ordered for a superscalar pipeline in the original; the ORDER is
    // load-bearing for the bits, so it is preserved verbatim.
    let ar = LOG_POLY[0] * r; // LOG_POLY[0] == -0.5
    let ar2 = r * ar;
    let ar3 = r * ar2;
    // `t2 + ar2` and `t2 - hi + ar2` are NOT fused: `ar2` has other readers, so
    // GCC materialises the product and adds it. Fusing them here would be a
    // different function.
    let hi = t2 + ar2;
    let lo3 = ar.mul_add(r, -ar2);
    let lo4 = t2 - hi + ar2;

    // p = log1p(r) - r - A[0]*r*r, order 8 — evaluated as three independent
    // linear pieces folded by ar2, which is how GCC schedules the C's nested
    // expression, and the final `* ar3` fuses into the lo sum below rather than
    // standing on its own.
    let p1 = r.mul_add(LOG_POLY[2], LOG_POLY[1]);
    let p2 = r.mul_add(LOG_POLY[4], LOG_POLY[3]);
    let p3 = r.mul_add(LOG_POLY[6], LOG_POLY[5]);
    let poly = ar2.mul_add(ar2.mul_add(p3, p2), p1);

    let lo = ar3.mul_add(poly, lo1 + lo2 + lo3 + lo4);
    let y = hi + lo;
    *tail = hi - y + lo;
    y
}

/// The overflow/underflow tail of `exp_inline`, split out exactly as the C
/// does. `sbits` may have an exponent that overflowed into the sign bit, hence
/// the two-step rescale.
#[cold]
fn specialcase(tmp: f64, mut sbits: u64, ki: u64) -> f64 {
    if ki & 0x8000_0000 == 0 {
        // k > 0: scale's exponent may have overflowed by <= 460, so back it
        // off, evaluate, and put the scale back.
        //
        // The C guards one more case here — `pow(0x1.fffffffffffffp+1023, 1.0)`
        // under round-up — but only inside `#ifndef __FP_FAST_FMA`, i.e. only
        // on the non-fma path this port does not take.
        sbits = sbits.wrapping_sub(1009_u64 << 52);
        let scale = f64::from_bits(sbits);
        let y = tmp.mul_add(scale, scale);
        return y * P2_1009;
    }
    // k < 0: the subnormal range needs the round-before-scale dance, or double
    // rounding costs 0.5 + E/2 ulp.
    sbits = sbits.wrapping_add(1022_u64 << 52);
    let scale = f64::from_bits(sbits);
    let mut y = tmp.mul_add(scale, scale);
    if y.abs() < 1.0 {
        let one = if y < 0.0 { -1.0 } else { 1.0 };
        let lo = tmp.mul_add(scale, scale - y);
        let hi = one + y;
        let lo = one - hi + y + lo;
        y = (hi + lo) - one;
        if y == 0.0 {
            // Keep the sign of zero.
            y = f64::from_bits(sbits & 0x8000_0000_0000_0000);
        }
    }
    P2_M1022 * y
}

/// `sign * exp(x + xtail)`, with `|xtail| < 2^-8/N` and `|xtail| <= |x|`.
#[inline]
fn exp_inline(x: f64, xtail: f64, sign_bias: u32) -> f64 {
    let mut abstop = top12(x) & 0x7ff;
    if abstop.wrapping_sub(top12(P2_M54)) >= top12(512.0) - top12(P2_M54) {
        if abstop.wrapping_sub(top12(P2_M54)) >= 0x8000_0000 {
            // Tiny x — including the common x == 0 — must not raise underflow.
            let one = 1.0 + x;
            return if sign_bias != 0 { -one } else { one };
        }
        if abstop >= top12(1024.0) {
            // inf/nan are already handled by the caller.
            return if x.to_bits() >> 63 != 0 {
                if sign_bias != 0 {
                    -0.0
                } else {
                    0.0
                }
            } else if sign_bias != 0 {
                f64::NEG_INFINITY
            } else {
                f64::INFINITY
            };
        }
        abstop = 0; // large x falls through to specialcase
    }

    // exp(x) = 2^(k/N) * exp(r), r in [-ln2/2N, ln2/2N]. `z` never exists as a
    // rounded value: the scale and the round-to-int shift fuse into one step.
    let kd0 = x.mul_add(INV_LN2N, SHIFT);
    let ki = kd0.to_bits();
    let kd = kd0 - SHIFT;

    let mut r = kd.mul_add(NEG_LN2LO_N, kd.mul_add(NEG_LN2HI_N, x));
    r += xtail;

    let idx = (2 * (ki % N_EXP)) as usize;
    let top = (ki.wrapping_add(u64::from(sign_bias))) << (52 - EXP_TABLE_BITS);
    let tail = f64::from_bits(EXP_TAB[idx]);
    let sbits = EXP_TAB[idx + 1].wrapping_add(top);

    let r2 = r * r;
    // EXP_POLY_ORDER == 5: C2, C3, C4, C5.
    let tmp = (r2 * r2).mul_add(
        r.mul_add(EXP_POLY[3], EXP_POLY[2]),
        r2.mul_add(r.mul_add(EXP_POLY[1], EXP_POLY[0]), tail + r),
    );

    if abstop == 0 {
        return specialcase(tmp, sbits, ki);
    }
    let scale = f64::from_bits(sbits);
    tmp.mul_add(scale, scale)
}

/// `2` if `y` is an odd integer, `1` if an even integer, `0` otherwise.
/// Transcribed from `math_config.h`'s `checkint`, whose return values are
/// `0 = not integer`, `1 = odd`, `2 = even` — note the C's `1` means ODD, and
/// getting that backwards silently flips the sign of every negative base.
#[inline]
fn checkint(iy: u64) -> u32 {
    let e = ((iy >> 52) & 0x7ff) as i32;
    if e < 0x3ff {
        return 0;
    }
    if e > 0x3ff + 52 {
        return 2;
    }
    if iy & ((1_u64 << (0x3ff + 52 - e)) - 1) != 0 {
        return 0;
    }
    if iy & (1_u64 << (0x3ff + 52 - e)) != 0 {
        return 1;
    }
    2
}

#[inline]
fn zeroinfnan(i: u64) -> bool {
    2_u64.wrapping_mul(i).wrapping_sub(1) >= 2 * (f64::INFINITY.to_bits()) - 1
}

/// `pow(x, y)` as the JS runtime computes it, on every target.
pub fn arm_pow(x: f64, y: f64) -> f64 {
    let mut sign_bias: u32 = 0;
    let mut ix = x.to_bits();
    let iy = y.to_bits();
    let mut topx = top12(x);
    let topy = top12(y);

    if topx.wrapping_sub(1) >= 0x7ff - 1 || (topy & 0x7ff).wrapping_sub(0x3be) >= 0x43e - 0x3be {
        // x is subnormal/inf/nan, or |y| is outside [2^-65, 2^63).
        if zeroinfnan(iy) {
            if 2u64.wrapping_mul(iy) == 0 {
                return 1.0;
            }
            if ix == 1.0f64.to_bits() {
                return 1.0;
            }
            if 2u64.wrapping_mul(ix) > 2u64.wrapping_mul(f64::INFINITY.to_bits())
                || 2u64.wrapping_mul(iy) > 2u64.wrapping_mul(f64::INFINITY.to_bits())
            {
                return x + y;
            }
            if 2u64.wrapping_mul(ix) == 2u64.wrapping_mul(1.0f64.to_bits()) {
                return 1.0;
            }
            // |x|<1 && y==inf, or |x|>1 && y==-inf.
            if (2u64.wrapping_mul(ix) < 2u64.wrapping_mul(1.0f64.to_bits())) == (iy >> 63 == 0) {
                return 0.0;
            }
            return y * y;
        }
        if zeroinfnan(ix) {
            let mut x2 = x * x;
            if ix >> 63 != 0 && checkint(iy) == 1 {
                x2 = -x2;
            }
            return if iy >> 63 != 0 { 1.0 / x2 } else { x2 };
        }
        // x and y are non-zero and finite from here.
        if ix >> 63 != 0 {
            let yint = checkint(iy);
            if yint == 0 {
                return f64::NAN;
            }
            if yint == 1 {
                sign_bias = SIGN_BIAS;
            }
            ix &= 0x7fff_ffff_ffff_ffff;
            topx &= 0x7ff;
        }
        if (topy & 0x7ff).wrapping_sub(0x3be) >= 0x43e - 0x3be {
            // sign_bias is 0 here: y is not odd.
            if ix == 1.0f64.to_bits() {
                return 1.0;
            }
            if (topy & 0x7ff) < 0x3be {
                // |y| < 2^-65, so x^y ~= 1 + y*log(x).
                return if ix > 1.0f64.to_bits() {
                    1.0 + y
                } else {
                    1.0 - y
                };
            }
            return if (ix > 1.0f64.to_bits()) == (topy < 0x800) {
                f64::INFINITY
            } else {
                0.0
            };
        }
        if topx == 0 {
            // Normalise subnormal x so the exponent goes negative.
            ix = (x * P2_52).to_bits();
            ix &= 0x7fff_ffff_ffff_ffff;
            ix = ix.wrapping_sub(52_u64 << 52);
        }
    }

    let mut lo = 0.0;
    let hi = log_inline(ix, &mut lo);
    let ehi = y * hi;
    let elo = y.mul_add(lo, y.mul_add(hi, -ehi));
    exp_inline(ehi, elo, sign_bias)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The same algorithm with GCC's fusions removed — i.e. exactly what a
    /// faithful transcription of `pow.c` produces. It exists only to be
    /// asserted WRONG.
    ///
    /// Without it, the `mul_add` calls above are a claim in a comment, and the
    /// first person who finds them ugly deletes them and ships a build whose
    /// browser floors differ from its native ones on one seed in ten. The
    /// oracle sweeps would catch that too, but only as "the pow curve moved";
    /// this names the cause.
    ///
    /// Domain-limited to the sweeps' `x in (0, 1]`, positive finite `y` — the
    /// special cases are shared with [`arm_pow`] and are not what is under test.
    fn unfused_pow(x: f64, y: f64) -> f64 {
        assert!(x > 0.0 && x.is_finite() && y.is_finite());
        let ix = x.to_bits();
        let tmp = ix.wrapping_sub(OFF);
        let i = ((tmp >> (52 - POW_LOG_TABLE_BITS)) % (1 << POW_LOG_TABLE_BITS)) as usize;
        let k = (tmp as i64) >> 52;
        let iz = ix.wrapping_sub(tmp & (0xfff_u64 << 52));
        let z = f64::from_bits(iz);
        let kd = k as f64;
        let (invc, logc, logctail) = LOG_TAB[i];
        let r = z.mul_add(invc, -1.0);
        let t1 = kd * LN2HI + logc;
        let t2 = t1 + r;
        let lo1 = kd * LN2LO + logctail;
        let lo2 = t1 - t2 + r;
        let ar = LOG_POLY[0] * r;
        let ar2 = r * ar;
        let ar3 = r * ar2;
        let hi = t2 + ar2;
        let lo3 = ar.mul_add(r, -ar2);
        let lo4 = t2 - hi + ar2;
        let p = ar3
            * (LOG_POLY[1]
                + r * LOG_POLY[2]
                + ar2 * (LOG_POLY[3] + r * LOG_POLY[4] + ar2 * (LOG_POLY[5] + r * LOG_POLY[6])));
        let sum = lo1 + lo2 + lo3 + lo4 + p;
        let lg = hi + sum;
        let lgtail = hi - lg + sum;

        let ehi = y * lg;
        let elo = y * lgtail + y.mul_add(lg, -ehi);

        let z2 = INV_LN2N * ehi;
        let kd0 = z2 + SHIFT;
        let ki = kd0.to_bits();
        let kd2 = kd0 - SHIFT;
        let mut rr = ehi + kd2 * NEG_LN2HI_N + kd2 * NEG_LN2LO_N;
        rr += elo;
        let idx = (2 * (ki % N_EXP)) as usize;
        let top = ki << (52 - EXP_TABLE_BITS);
        let tail = f64::from_bits(EXP_TAB[idx]);
        let sbits = EXP_TAB[idx + 1].wrapping_add(top);
        let r2 = rr * rr;
        let t = tail
            + rr
            + r2 * (EXP_POLY[0] + rr * EXP_POLY[1])
            + r2 * r2 * (EXP_POLY[2] + rr * EXP_POLY[3]);
        let scale = f64::from_bits(sbits);
        scale + scale * t
    }

    /// Three inputs where the fused and unfused forms land on different
    /// doubles, with the runtime's answer pinned.
    ///
    /// Both bit patterns are legal ≤0.54-ulp results. Measured against a
    /// 60-digit reference, the UNFUSED one is the correctly rounded answer at
    /// x = 0.00944 and the runtime's is not — so "which is more accurate" and
    /// "which is right here" have different answers, and confusing the two is
    /// how this nearly went the wrong way.
    #[test]
    fn the_gcc_fusions_are_load_bearing() {
        for (x, runtime_bits) in [
            (5.145e-3_f64, 0x3f4a_a855_0d99_1f7d_u64),
            (9.44e-3, 0x3f5e_3e56_6407_f47b),
            (2.7115e-2, 0x3f7f_6b46_3f17_3867),
        ] {
            assert_eq!(
                arm_pow(x, 1.35).to_bits(),
                runtime_bits,
                "arm_pow({x}, 1.35) stopped matching the runtime"
            );
            assert_ne!(
                unfused_pow(x, 1.35).to_bits(),
                runtime_bits,
                "the unfused transcription now AGREES at {x} — if that is real, this \
                 module's whole rationale changed and its header is stale"
            );
        }
    }

    /// The special cases, which the sweeps cannot reach: JSON carries no
    /// infinity and no NaN, so the fixture stops at the finite domain and these
    /// come from the ECMAScript contract instead.
    #[test]
    fn the_special_cases_survive() {
        assert_eq!(arm_pow(1.0, f64::NAN), 1.0);
        assert_eq!(arm_pow(2.0, 0.0), 1.0);
        assert!(arm_pow(-2.0, 0.5).is_nan());
        assert_eq!(arm_pow(-2.0, 3.0), -8.0);
        assert_eq!(arm_pow(-2.0, 2.0), 4.0);
        assert_eq!(arm_pow(0.0, 2.0), 0.0);
        assert_eq!(arm_pow(f64::INFINITY, 2.0), f64::INFINITY);
        assert_eq!(arm_pow(0.5, f64::INFINITY), 0.0);
        assert_eq!(arm_pow(2.0, 10.0), 1024.0);
        assert_eq!(arm_pow(2.0, 0.5), std::f64::consts::SQRT_2);
    }
}
