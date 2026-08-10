//! Which Rust candidate reproduces the runtime, per primitive — the survey that
//! decides whether a `jsmath` twin is needed. Prints the divergence COUNT for
//! every candidate over the oracle's own sweeps, so the answer is a measurement
//! and not a spot check.
//!
//! ```text
//!   cargo run -p pk-core --example survey
//! ```
//!
//! An example, not a test: `tests/jsmath_oracle.rs` is what gates. This is how
//! you find out what to put in it.

use serde::Deserialize;

#[derive(Deserialize)]
struct Oracle {
    unary: Vec<Unary>,
}

#[derive(Deserialize)]
struct Unary {
    name: String,
    from: f64,
    to: f64,
    n: u32,
    digest: u32,
}

/// FNV-1a 32 over the little-endian bytes of each f64 — the harness's fold.
fn digest(from: f64, to: f64, n: u32, f: impl Fn(f64) -> f64) -> u32 {
    let mut h: u32 = 0x811c_9dc5;
    for k in 0..=n {
        let x = from + (to - from) * f64::from(k) / f64::from(n);
        for b in f(x).to_bits().to_le_bytes() {
            h = (h ^ u32::from(b)).wrapping_mul(0x0100_0193);
        }
    }
    h
}

fn count_diffs(from: f64, to: f64, n: u32, a: impl Fn(f64) -> f64, b: impl Fn(f64) -> f64) -> u32 {
    let mut bad = 0;
    for k in 0..=n {
        let x = from + (to - from) * f64::from(k) / f64::from(n);
        if a(x).to_bits() != b(x).to_bits() {
            bad += 1;
        }
    }
    bad
}

fn main() {
    let path = format!(
        "{}/../../assets/fixtures/jsmath-oracle.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let o: Oracle = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();

    for u in &o.unary {
        let candidates: Vec<(&str, fn(f64) -> f64)> = match u.name.as_str() {
            "cos" => vec![
                ("jsmath", pk_core::jsmath::js_cos),
                ("libm", libm::cos),
                ("std", f64::cos),
            ],
            "sin" => vec![
                ("jsmath", pk_core::jsmath::js_sin),
                ("libm", libm::sin),
                ("std", f64::sin),
            ],
            "sqrt" => vec![("libm", libm::sqrt), ("std", f64::sqrt)],
            "exp" => vec![("libm", libm::exp), ("std", f64::exp)],
            "log" => vec![("libm", libm::log), ("std", f64::ln)],
            "atan" => vec![("libm", libm::atan), ("std", f64::atan)],
            other => panic!("unknown sweep {other}"),
        };
        print!(
            "{:5} [{:>8.3e},{:>10.3e}] n={:<7}",
            u.name, u.from, u.to, u.n
        );
        // The first candidate that matches the oracle is the reference the
        // others are counted against — a count only means something next to it.
        let reference = candidates
            .iter()
            .find(|(_, f)| digest(u.from, u.to, u.n, f) == u.digest);
        match reference {
            None => print!("  NOTHING MATCHES"),
            Some((name, rf)) => {
                print!("  {name} ✓");
                for (other, of) in &candidates {
                    if other == name {
                        continue;
                    }
                    let d = count_diffs(u.from, u.to, u.n, rf, of);
                    print!("  {other}:{d}");
                }
            }
        }
        println!();
    }
}
