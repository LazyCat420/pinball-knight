//! Where does `js_pow` sit relative to the libraries it could have been?
//!
//! A failing digest says a curve is wrong and never how wrong — the same reason
//! `dump_unary` exists. This walks the oracle's pow sweeps and reports, per
//! sweep, how far the carried implementation is from this target's `powf` and
//! from fdlibm, with the first few named inputs of any gap.
//!
//! Expected output on a healthy tree: zero against the platform (this box's
//! `powf` is glibc's, which is what the fixtures were exported against) and
//! thousands against fdlibm (the implementation `libm::pow` carries and the one
//! `f64::powf` silently becomes on wasm). If the first column stops being zero
//! on some machine, that machine's libm is not the oracle's — start with
//! whether it has FMA, since the fixtures describe the FMA ifunc variant.
//!
//! `cargo run --release -p pk-core --example pow_diff`

use pk_core::jsmath::arm_pow;

fn ulp_gap(a: f64, b: f64) -> i64 {
    (a.to_bits() as i64 - b.to_bits() as i64).abs()
}

fn main() {
    for (exp, n) in [(1.35_f64, 200_000_u32), (2.5, 100_000), (7.0, 50_000)] {
        let (mut vs_platform, mut vs_fdlibm) = (0_u32, 0_u32);
        let mut worst = 0_i64;
        let mut shown = 0;
        for k in 0..=n {
            let x = f64::from(k) / f64::from(n);
            let ours = arm_pow(x, exp);
            if ours.to_bits() != x.powf(exp).to_bits() {
                vs_platform += 1;
                worst = worst.max(ulp_gap(ours, x.powf(exp)));
                if shown < 4 {
                    println!(
                        "  x={x:.17e}  js_pow={:016x}  platform={:016x}",
                        ours.to_bits(),
                        x.powf(exp).to_bits()
                    );
                    shown += 1;
                }
            }
            if ours.to_bits() != libm::pow(x, exp).to_bits() {
                vs_fdlibm += 1;
            }
        }
        println!(
            "x^{exp} over {}: {vs_platform} differ from this target's powf \
             (worst {worst} ulp), {vs_fdlibm} differ from fdlibm",
            n + 1
        );
    }
}
