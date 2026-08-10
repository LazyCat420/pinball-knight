//! Sun's ORIGINAL fdlibm `sin`/`cos` — the ones the JS runtime still runs.
//!
//! This is not a stylistic preference and it is not a rewrite. `libm`'s `sin`
//! and `cos` are ports of musl's, and musl (like glibc, and like every modern
//! BSD) took FreeBSD's 2002 rewrite of the kernels, which evaluates the same
//! polynomial in a different ORDER:
//!
//! ```text
//!   Sun 1993   r = z*(C1+z*(C2+z*(C3+z*(C4+z*(C5+z*C6)))))    // Horner
//!   FreeBSD    r = z*(C1+z*(C2+z*C3)) + z*z*z*z*(C4+z*(C5+z*C6))
//! ```
//!
//! C1..C6 and S1..S6 are bit-identical in all three libraries; only the shape
//! of the sum differs, and floating-point addition is not associative. Sun also
//! carries a `qx` split in `__kernel_cos` for |x| >= 0.3 that the rewrite drops
//! entirely. V8 kept the 1993 code (`src/base/ieee754.cc`, a translation of
//! fdlibm 5.3), so the runtime and both Rust candidates sit 1 ulp apart on real
//! inputs: `Math.cos(0.1)` is `0x3fefd712f9a817c0` in node and `…c1` in `libm`
//! and in std.
//!
//! Found by the maze parity harness: `track_grow` places ring and hub nodes at
//! `cos(theta)`/`sin(theta)`, and on two corpus floors one ulp of one angle
//! moved one node one cell, which moved the K-nearest sort, which moved the
//! whole circuit. Same node count, same edge count, different roads.
//!
//! Ported verbatim from fdlibm 5.3 `s_sin.c`, `s_cos.c`, `k_sin.c`, `k_cos.c`,
//! `e_rem_pio2.c` and `k_rem_pio2.c`, and verified against the runtime by
//! whole-curve digest over ranges chosen to cross every branch boundary — see
//! `crates/pk-core/tests/jsmath_oracle.rs`.

// The polynomial coefficients are transcribed DIGIT FOR DIGIT from the C, which
// writes them with more decimals than an f64 can hold. Clippy is right that the
// extra digits are dropped and wrong that they should go: keeping the literals
// identical to fdlibm's is what lets the next reader diff this file against the
// original and see that nothing was "tidied" on the way in. The parsed values
// are unchanged either way — that is the whole point.
#![allow(clippy::excessive_precision)]
// Three more lints fire on verbatim fdlibm, all of them DENY-level, which means
// they abort the whole workspace lint run rather than adding a warning:
//
// · `approx_constant` on `INVPIO2` — it is 2/pi, deliberately written as
//   fdlibm's 21-digit literal and not `FRAC_2_PI`, because the point of the
//   file is that it still diffs against `e_rem_pio2.c`.
// · `eq_op` on `x - x`, fdlibm's idiom for "return a NaN with this argument's
//   payload" at the infinity/NaN guards. `f64::NAN` is not the same value.
// · `needless_range_loop` in `kernel_rem_pio2`, where the index walks two
//   arrays at different offsets (`fq[jz - i]` from `q[i + k]`). An iterator
//   rewrite would not be the C any more.
#![allow(clippy::approx_constant)]
#![allow(clippy::eq_op)]
#![allow(clippy::needless_range_loop)]

// ─── word access, the fdlibm macros ──────────────────────────────────────────
//
// `__HI`, `__LO` and the union write-back, which every fdlibm routine leans on.
// Shared with `fdlibm_explog.rs` rather than re-declared there: two copies of a
// bit-twiddling helper is two places for a port to drift.

#[inline]
pub(super) fn high_word(x: f64) -> i32 {
    (x.to_bits() >> 32) as u32 as i32
}

#[inline]
pub(super) fn low_word(x: f64) -> u32 {
    x.to_bits() as u32
}

#[inline]
pub(super) fn from_words(hi: u32, lo: u32) -> f64 {
    f64::from_bits((u64::from(hi) << 32) | u64::from(lo))
}

// ─── k_cos.c ─────────────────────────────────────────────────────────────────

const C1: f64 = 4.166_666_666_666_660_19e-02;
const C2: f64 = -1.388_888_888_887_410_96e-03;
const C3: f64 = 2.480_158_728_947_672_94e-05;
const C4: f64 = -2.755_731_435_139_066_33e-07;
const C5: f64 = 2.087_572_321_298_174_83e-09;
const C6: f64 = -1.135_964_755_778_819_48e-11;

/// `__kernel_cos(x, y)` — |x| <= pi/4, `y` the tail of the reduced argument.
///
/// The `qx` branch is the part the FreeBSD rewrite deleted. For |x| >= 0.3 it
/// subtracts a constant from both `1` and `z/2` before the cancellation, so the
/// rounding happens somewhere else than it would in `1 - z/2 + …`. That
/// relocation IS the 1 ulp.
fn kernel_cos(x: f64, y: f64) -> f64 {
    let ix = high_word(x) & 0x7fff_ffff;
    if ix < 0x3e40_0000 {
        // |x| < 2**-27
        if x as i32 == 0 {
            return 1.0;
        }
    }
    let z = x * x;
    let r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
    if ix < 0x3FD3_3333 {
        // |x| < 0.3
        1.0 - (0.5 * z - (z * r - x * y))
    } else {
        let qx = if ix > 0x3fe9_0000 {
            // |x| > 0.78125
            0.28125
        } else {
            // x/4, exactly, by decrementing the exponent
            from_words((ix - 0x0020_0000) as u32, 0)
        };
        let hz = 0.5 * z - qx;
        let a = 1.0 - qx;
        a - (hz - (z * r - x * y))
    }
}

// ─── k_sin.c ─────────────────────────────────────────────────────────────────

const S1: f64 = -1.666_666_666_666_663_24e-01;
const S2: f64 = 8.333_333_333_322_489_46e-03;
const S3: f64 = -1.984_126_982_985_794_93e-04;
const S4: f64 = 2.755_731_370_707_006_77e-06;
const S5: f64 = -2.505_076_025_340_686_34e-08;
const S6: f64 = 1.589_690_995_211_550_10e-10;

/// `__kernel_sin(x, y, iy)` — |x| <= pi/4. `iy == false` means the caller has no
/// tail (`y` is a literal zero), which takes a shorter, differently-rounded sum.
fn kernel_sin(x: f64, y: f64, iy: bool) -> f64 {
    let ix = high_word(x) & 0x7fff_ffff;
    if ix < 0x3e40_0000 {
        // |x| < 2**-27
        if x as i32 == 0 {
            return x;
        }
    }
    let z = x * x;
    let v = z * x;
    let r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
    if !iy {
        x + v * (S1 + z * r)
    } else {
        x - ((z * (0.5 * y - v * r) - y) - v * S1)
    }
}

// ─── e_rem_pio2.c ────────────────────────────────────────────────────────────

const INVPIO2: f64 = 6.366_197_723_675_813_824_33e-01;
const PIO2_1: f64 = 1.570_796_326_734_125_614_17e+00;
const PIO2_1T: f64 = 6.077_100_506_506_192_249_32e-11;
const PIO2_2: f64 = 6.077_100_506_303_965_976_60e-11;
const PIO2_2T: f64 = 2.022_266_248_795_950_631_54e-21;
const PIO2_3: f64 = 2.022_266_248_711_166_455_80e-21;
const PIO2_3T: f64 = 8.478_427_660_368_899_569_97e-32;
const TWO24: f64 = 1.677_721_6e+07;
const TWON24: f64 = 5.960_464_477_539_062_5e-08;

/// High words of n*(pi/2) for n = 1..32 — the table that says "this argument is
/// close enough to a multiple of pi/2 that the quick reduction will cancel".
#[rustfmt::skip]
const NPIO2_HW: [i32; 32] = [
    0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C,
    0x4025FDBB, 0x402921FB, 0x402C463A, 0x402F6A7A, 0x4031475C, 0x4032D97C,
    0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB, 0x403AB41B, 0x403C463A,
    0x403DD85A, 0x403F6A7A, 0x40407E4C, 0x4041475C, 0x4042106C, 0x4042D97C,
    0x4043A28C, 0x40446B9C, 0x404534AC, 0x4045FDBB, 0x4046C6CB, 0x40478FDB,
    0x404858EB, 0x404921FB,
];

/// `__ieee754_rem_pio2(x, y)` → `n`, with `y = [head, tail]` the reduced
/// argument in [-pi/4, pi/4] and `x ~= n*(pi/2) + y`.
fn rem_pio2(x: f64, y: &mut [f64; 2]) -> i32 {
    let hx = high_word(x);
    let ix = hx & 0x7fff_ffff;

    if ix <= 0x3fe9_21fb {
        // |x| ≲ pi/4 — nothing to reduce
        y[0] = x;
        y[1] = 0.0;
        return 0;
    }

    if ix < 0x4002_d97c {
        // |x| < 3pi/4 — n is +-1 and the reduction is a single subtraction
        if hx > 0 {
            let mut z = x - PIO2_1;
            if ix != 0x3ff9_21fb {
                y[0] = z - PIO2_1T;
                y[1] = (z - y[0]) - PIO2_1T;
            } else {
                // within an ulp of pi/2 — 33+33+53 bits of pi needed
                z -= PIO2_2;
                y[0] = z - PIO2_2T;
                y[1] = (z - y[0]) - PIO2_2T;
            }
            return 1;
        }
        let mut z = x + PIO2_1;
        if ix != 0x3ff9_21fb {
            y[0] = z + PIO2_1T;
            y[1] = (z - y[0]) + PIO2_1T;
        } else {
            z += PIO2_2;
            y[0] = z + PIO2_2T;
            y[1] = (z - y[0]) + PIO2_2T;
        }
        return -1;
    }

    if ix <= 0x4139_21fb {
        // |x| ≲ 2^20*(pi/2) — medium size, iterative Cody-Waite
        let mut t = libm::fabs(x);
        let n = (t * INVPIO2 + 0.5) as i32;
        let fnn = f64::from(n);
        let mut r = t - fnn * PIO2_1;
        let mut w = fnn * PIO2_1T; // 1st round, good to 85 bits
        if n < 32 && ix != NPIO2_HW[(n - 1) as usize] {
            y[0] = r - w; // quick check: no cancellation
        } else {
            let j = ix >> 20;
            y[0] = r - w;
            let mut high = high_word(y[0]);
            let mut i = j - ((high >> 20) & 0x7ff);
            if i > 16 {
                // 2nd iteration needed, good to 118 bits
                t = r;
                w = fnn * PIO2_2;
                r = t - w;
                w = fnn * PIO2_2T - ((t - r) - w);
                y[0] = r - w;
                high = high_word(y[0]);
                i = j - ((high >> 20) & 0x7ff);
                if i > 49 {
                    // 3rd iteration, 151 bits — covers every remaining case
                    t = r;
                    w = fnn * PIO2_3;
                    r = t - w;
                    w = fnn * PIO2_3T - ((t - r) - w);
                    y[0] = r - w;
                }
            }
        }
        y[1] = (r - y[0]) - w;
        if hx < 0 {
            y[0] = -y[0];
            y[1] = -y[1];
            return -n;
        }
        return n;
    }

    if ix >= 0x7ff0_0000 {
        // inf or NaN
        y[0] = x - x;
        y[1] = y[0];
        return 0;
    }

    // All other (large) arguments: split |x| into three 24-bit chunks and go
    // through the multi-word 2/pi table.
    let e0 = (ix >> 20) - 1046; // ilogb(z) - 23
    let mut z = from_words((ix - (e0 << 20)) as u32, low_word(x));
    let mut tx = [0.0_f64; 3];
    for slot in tx.iter_mut().take(2) {
        *slot = f64::from(z as i32);
        z = (z - *slot) * TWO24;
    }
    tx[2] = z;
    let mut nx = 3usize;
    while tx[nx - 1] == 0.0 {
        nx -= 1;
    }
    let n = kernel_rem_pio2(&tx[..nx], y, e0);
    if hx < 0 {
        y[0] = -y[0];
        y[1] = -y[1];
        return -n;
    }
    n
}

// ─── k_rem_pio2.c (prec = 2, the only precision sin/cos ask for) ─────────────

/// 2/pi to 396 bits, in 24-bit chunks. Only reachable for |x| > 2^20*(pi/2).
#[rustfmt::skip]
const TWO_OVER_PI: [i32; 66] = [
    0xA2F983, 0x6E4E44, 0x1529FC, 0x2757D1, 0xF534DD, 0xC0DB62,
    0x95993C, 0x439041, 0xFE5163, 0xABDEBB, 0xC561B7, 0x246E3A,
    0x424DD2, 0xE00649, 0x2EEA09, 0xD1921C, 0xFE1DEB, 0x1CB129,
    0xA73EE8, 0x8235F5, 0x2EBB44, 0x84E99C, 0x7026B4, 0x5F7E41,
    0x3991D6, 0x398353, 0x39F49C, 0x845F8B, 0xBDF928, 0x3B1FF8,
    0x97FFDE, 0x05980F, 0xEF2F11, 0x8B5A0A, 0x6D1F6D, 0x367ECF,
    0x27CB09, 0xB74F46, 0x3F669E, 0x5FEA2D, 0x7527BA, 0xC7EBE5,
    0xF17B3D, 0x0739F7, 0x8A5292, 0xEA6BFB, 0x5FB11F, 0x8D5D08,
    0x560330, 0x46FC7B, 0x6BABF0, 0xCFBC20, 0x9AF436, 0x1DA9E3,
    0x91615E, 0xE61B08, 0x659985, 0x5F14A0, 0x68408D, 0xFFD880,
    0x4D7327, 0x310606, 0x1556CA, 0x73A8C9, 0x60E27B, 0xC08C6B,
];

/// pi/2 in 8 pieces of 24 bits.
const PIO2: [f64; 8] = [
    1.570_796_251_296_997_070_31e+00,
    7.549_789_415_861_596_353_35e-08,
    5.390_302_529_957_764_765_54e-15,
    3.282_003_415_807_912_941_23e-22,
    1.270_655_753_080_676_073_49e-29,
    1.229_333_089_811_113_289_32e-36,
    2.733_700_538_164_645_596_24e-44,
    2.167_416_838_778_048_194_44e-51,
];

/// `__kernel_rem_pio2` at `prec = 2` (`jk = 4`), which is what `sin`/`cos` ask
/// for. `x` holds `nx` 24-bit chunks of the magnitude, scaled by `2^e0`.
fn kernel_rem_pio2(x: &[f64], y: &mut [f64; 2], e0: i32) -> i32 {
    const JK: usize = 4; // init_jk[prec = 2]
    const JP: usize = JK;

    let jx = x.len() - 1;
    let jv = if e0 - 3 < 0 { 0 } else { (e0 - 3) / 24 };
    let mut q0 = e0 - 24 * (jv + 1);

    // f[0..=jx+jk] = the slice of 2/pi this argument's exponent lands on
    let mut f = [0.0_f64; 20];
    let mut j = jv - jx as i32;
    for slot in f.iter_mut().take(jx + JK + 1) {
        *slot = if j < 0 {
            0.0
        } else {
            f64::from(TWO_OVER_PI[j as usize])
        };
        j += 1;
    }

    let mut q = [0.0_f64; 20];
    for i in 0..=JK {
        let mut fw = 0.0;
        for (k, xk) in x.iter().enumerate() {
            fw += xk * f[jx + i - k];
        }
        q[i] = fw;
    }

    let mut jz = JK;
    let mut iq = [0_i32; 20];
    #[allow(unused_assignments)] // written on every path through the loop below
    let mut z = 0.0_f64;
    let mut ih;

    // `recompute:` — the goto in the original, which re-enters after extending
    // q[] by the terms the cancellation ate.
    let n = loop {
        // distill q[] into iq[] reversingly
        z = q[jz];
        let mut i = 0usize;
        let mut jj = jz;
        while jj > 0 {
            let fw = f64::from((TWON24 * z) as i32);
            iq[i] = (z - TWO24 * fw) as i32;
            z = q[jj - 1] + fw;
            i += 1;
            jj -= 1;
        }

        // compute n
        z = libm::scalbn(z, q0);
        z -= 8.0 * libm::floor(z * 0.125); // trim off integer >= 8
        let mut n = z as i32;
        z -= f64::from(n);
        ih = 0;
        if q0 > 0 {
            // need iq[jz-1] to determine n
            let i = iq[jz - 1] >> (24 - q0);
            n += i;
            iq[jz - 1] -= i << (24 - q0);
            ih = iq[jz - 1] >> (23 - q0);
        } else if q0 == 0 {
            ih = iq[jz - 1] >> 23;
        } else if z >= 0.5 {
            ih = 2;
        }

        if ih > 0 {
            // q > 0.5 — replace it by 1-q and remember the sign
            n += 1;
            let mut carry = 0;
            for slot in iq.iter_mut().take(jz) {
                let v = *slot;
                if carry == 0 {
                    if v != 0 {
                        carry = 1;
                        *slot = 0x100_0000 - v;
                    }
                } else {
                    *slot = 0xff_ffff - v;
                }
            }
            // rare case, chance is 1 in 12
            match q0 {
                1 => iq[jz - 1] &= 0x7f_ffff,
                2 => iq[jz - 1] &= 0x3f_ffff,
                _ => {}
            }
            if ih == 2 {
                z = 1.0 - z;
                if carry != 0 {
                    z -= libm::scalbn(1.0, q0);
                }
            }
        }

        // check if recomputation is needed
        if z == 0.0 {
            let mut acc = 0;
            for i in (JK..jz).rev() {
                acc |= iq[i];
            }
            if acc == 0 {
                let mut k = 1usize; // number of terms needed
                while iq[JK - k] == 0 {
                    k += 1;
                }
                for i in jz + 1..=jz + k {
                    f[jx + i] = f64::from(TWO_OVER_PI[jv as usize + i]);
                    let mut fw = 0.0;
                    for (m, xm) in x.iter().enumerate() {
                        fw += xm * f[jx + i - m];
                    }
                    q[i] = fw;
                }
                jz += k;
                continue;
            }
        }

        break n;
    };

    // chop off zero terms
    if z == 0.0 {
        jz -= 1;
        q0 -= 24;
        while iq[jz] == 0 {
            jz -= 1;
            q0 -= 24;
        }
    } else {
        // break z into 24-bit chunks if necessary
        z = libm::scalbn(z, -q0);
        if z >= TWO24 {
            let fw = f64::from((TWON24 * z) as i32);
            iq[jz] = (z - TWO24 * fw) as i32;
            jz += 1;
            q0 += 24;
            iq[jz] = fw as i32;
        } else {
            iq[jz] = z as i32;
        }
    }

    // convert the integer "bit" chunks back to floating point
    let mut fw = libm::scalbn(1.0, q0);
    for i in (0..=jz).rev() {
        q[i] = fw * f64::from(iq[i]);
        fw *= TWON24;
    }

    // compute PIo2[0..=jp] * q[jz..=0]
    let mut fq = [0.0_f64; 20];
    for i in (0..=jz).rev() {
        let mut acc = 0.0;
        let mut k = 0usize;
        while k <= JP && k <= jz - i {
            acc += PIO2[k] * q[i + k];
            k += 1;
        }
        fq[jz - i] = acc;
    }

    // compress fq[] into y[] — prec == 2
    let mut head = 0.0;
    for i in (0..=jz).rev() {
        head += fq[i];
    }
    y[0] = if ih == 0 { head } else { -head };
    let mut tail = fq[0] - head;
    for i in 1..=jz {
        tail += fq[i];
    }
    y[1] = if ih == 0 { tail } else { -tail };

    n & 7
}

// ─── s_sin.c / s_cos.c ───────────────────────────────────────────────────────

/// `Math.cos(x)` as the JS runtime computes it.
pub fn js_cos(x: f64) -> f64 {
    let ix = high_word(x) & 0x7fff_ffff;
    if ix <= 0x3fe9_21fb {
        return kernel_cos(x, 0.0);
    }
    if ix >= 0x7ff0_0000 {
        return x - x;
    }
    let mut y = [0.0_f64; 2];
    let n = rem_pio2(x, &mut y);
    match n & 3 {
        0 => kernel_cos(y[0], y[1]),
        1 => -kernel_sin(y[0], y[1], true),
        2 => -kernel_cos(y[0], y[1]),
        _ => kernel_sin(y[0], y[1], true),
    }
}

/// `Math.sin(x)` as the JS runtime computes it.
pub fn js_sin(x: f64) -> f64 {
    let ix = high_word(x) & 0x7fff_ffff;
    if ix <= 0x3fe9_21fb {
        return kernel_sin(x, 0.0, false);
    }
    if ix >= 0x7ff0_0000 {
        return x - x;
    }
    let mut y = [0.0_f64; 2];
    let n = rem_pio2(x, &mut y);
    match n & 3 {
        0 => kernel_sin(y[0], y[1], true),
        1 => kernel_cos(y[0], y[1]),
        2 => -kernel_sin(y[0], y[1], true),
        _ => -kernel_cos(y[0], y[1]),
    }
}

#[cfg(test)]
mod tests {
    use super::{js_cos, js_sin};

    /// The input the maze harness pointed at. Bits pinned from node, and the
    /// two candidates the workspace rule would have reached for pinned as
    /// WRONG — the same shape as `js_hypot`'s and `js_pow`'s controls.
    ///
    /// One value proves nothing on its own (that is the whole lesson of this
    /// module) — `tests/jsmath_oracle.rs` is the real gate, over ten swept
    /// ranges. This is here so a failure has something a human can read.
    #[test]
    fn cos_of_a_tenth_is_the_runtimes_bits_and_not_the_libraries() {
        assert_eq!(js_cos(0.1).to_bits(), 0x3fef_d712_f9a8_17c0);
        assert_eq!(libm::cos(0.1).to_bits(), 0x3fef_d712_f9a8_17c1);
        assert_eq!(f64::cos(0.1).to_bits(), 0x3fef_d712_f9a8_17c1);
    }

    /// Exact answers must stay exact: the twins are 1-ulp-sensitive code, and
    /// an error in the argument reduction shows up here first.
    #[test]
    fn the_exact_cases_stay_exact() {
        assert_eq!(js_cos(0.0), 1.0);
        assert_eq!(js_sin(0.0).to_bits(), 0.0_f64.to_bits());
        assert_eq!(js_sin(-0.0).to_bits(), (-0.0_f64).to_bits());
        assert_eq!(js_cos(-0.0), 1.0);
        // sin/cos are odd/even — an asymmetric reduction breaks this.
        for x in [0.3, 0.9, 1.7, 3.5, 100.25, 1.0e7, 1.0e18] {
            assert_eq!(js_sin(-x), -js_sin(x), "sin is odd at {x}");
            assert_eq!(js_cos(-x), js_cos(x), "cos is even at {x}");
        }
    }

    #[test]
    fn the_nonfinite_contract() {
        assert!(js_cos(f64::NAN).is_nan());
        assert!(js_sin(f64::NAN).is_nan());
        assert!(js_cos(f64::INFINITY).is_nan());
        assert!(js_sin(f64::NEG_INFINITY).is_nan());
    }

    /// Each of the four argument-reduction branches, so a rewrite that drops
    /// one is caught by the unit tests and not only by the sweeps.
    #[test]
    fn every_reduction_branch_agrees_with_the_pythagorean_identity() {
        for x in [
            0.5,     // kernel directly, |x| <= pi/4
            1.2,     // the n = +-1 special case
            5.0,     // Cody-Waite
            1.0e6,   // Cody-Waite, near its ceiling
            1.0e8,   // multi-word 2/pi table
            1.0e15,  // ditto, deeper into the table
            1.0e300, // ditto, at the top of the exponent range
        ] {
            let (s, c) = (js_sin(x), js_cos(x));
            assert!(
                (s * s + c * c - 1.0).abs() < 1e-15,
                "sin^2 + cos^2 = {} at {x}",
                s * s + c * c
            );
        }
    }
}
