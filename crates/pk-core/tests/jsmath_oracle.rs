//! Every JS math primitive the port leans on, replayed against sweeps exported
//! from the real runtime.
//!
//! Exported by `legacy/.../port-fixtures.test.ts` ("the JS math primitives match
//! their pinned sweeps"). This is a PRIMITIVE-level parity gate, not a trace: it
//! exists because the maze port diverged on 1 ulp in one input in ten, with the
//! topology bit-identical, and no structural check could see it.
//!
//! Digests of whole curves rather than spot values, on purpose — a handful of
//! samples is exactly how a one-in-ten 1-ulp difference gets missed. And each
//! primitive is asserted against the ONE implementation the port is required to
//! call, with the rejected candidates asserted to still disagree: an oracle that
//! only says "someone matches" stops being a gate the moment a library changes.

use pk_core::jsmath::{js_cos, js_exp, js_log, js_pow, js_sin};
use pk_core::maze::digest::Fnv1a;
use serde::Deserialize;
use std::collections::BTreeMap;

/// A unary f64 implementation — the runtime's, or one of the candidates being
/// held up against it.
type Candidate = fn(f64) -> f64;

#[derive(Deserialize)]
struct Oracle {
    unary: Vec<Unary>,
    sweeps: Vec<Sweep>,
    /// `[base, exponent, expected]` — printable, so a failure reads next to a
    /// node REPL instead of only as a hash.
    spot: Vec<[f64; 3]>,
}

#[derive(Deserialize)]
struct Unary {
    name: String,
    from: f64,
    to: f64,
    n: u32,
    digest: u32,
}

#[derive(Deserialize)]
struct Sweep {
    exp: f64,
    n: u32,
    digest: u32,
}

fn load() -> Oracle {
    // ⚠️ This path was `jsmath-pow-oracle.json` for a while and the exporter has
    // always written `jsmath-oracle.json`, so the whole gate failed at the read
    // with "fixture missing — run the exporter", which reads as an unconfigured
    // checkout rather than a broken test. If you are here because of a missing
    // fixture, check the NAME before you re-export.
    let path = format!(
        "{}/../../assets/fixtures/jsmath-oracle.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "{path}: {e}\nre-export with: cd legacy && RUN_EXPORT=1 scripts/ops/pk-run.sh \
             --class test -- npx vitest run src/game/pinball-knight/port-fixtures.test.ts"
        )
    });
    serde_json::from_str(&text).unwrap()
}

fn sweep_digest(u: &Unary, f: impl Fn(f64) -> f64) -> u32 {
    let mut h = Fnv1a::new();
    for k in 0..=u.n {
        h.f64(f(u.from + (u.to - u.from) * f64::from(k) / f64::from(u.n)));
    }
    h.finish()
}

/// The mapping from a JS primitive to the Rust call the port must make. Every
/// row was a separate measurement and three of them were surprises — see
/// `cargo run -p pk-core --example survey`, which prints this table with the
/// divergence counts.
fn required_impl(name: &str) -> Option<Candidate> {
    match name {
        "cos" => Some(js_cos),
        "sin" => Some(js_sin),
        "exp" => Some(js_exp),
        "log" => Some(js_log),
        // IEEE-correctly-rounded — every implementation agrees, no twin needed.
        "sqrt" => Some(f64::sqrt),
        "atan" => Some(libm::atan),
        _ => None,
    }
}

/// The implementations the workspace's "transcendentals go through `libm`" rule
/// would have reached for, per primitive. Held up against the runtime by
/// [`the_rejected_candidates_still_disagree`] so the twins cannot quietly
/// become ceremony.
fn rejected(name: &str) -> Option<[(&'static str, Candidate); 2]> {
    match name {
        "cos" => Some([("libm", libm::cos), ("std", f64::cos)]),
        "sin" => Some([("libm", libm::sin), ("std", f64::sin)]),
        "exp" => Some([("libm", libm::exp), ("std", f64::exp)]),
        "log" => Some([("libm", libm::log), ("std", f64::ln)]),
        _ => None,
    }
}

#[test]
fn every_swept_primitive_matches_the_runtime() {
    let o = load();
    assert!(
        o.unary.len() >= 25,
        "the sweep set was thinned out — {} entries",
        o.unary.len()
    );

    // ── Collect, then report. Do NOT `assert_eq!` inside the loop. ──────────
    //
    // The SHAPE of the failure is the diagnosis, and halting at the first bad
    // sweep throws it away. Sabotage-verified 2026-08-10 — these are different
    // defects and a first-failure abort makes them look identical:
    //
    //   1 range red, the largest       a branch bug (the argument reduction)
    //   the two +-1e6 ranges red       the Cody-Waite iteration count
    //   the three huge ranges red      the multi-word 2/pi path
    //   ALL ten trig ranges red        the polynomial kernel itself
    //   1 range red, the one holding 1.0   a special-case guard
    //
    // Telling those apart from the report is worth the dozen lines.
    let mut checked = 0;
    let mut failed: Vec<String> = Vec::new();
    for u in &o.unary {
        let Some(f) = required_impl(&u.name) else {
            continue;
        };
        if sweep_digest(u, f) != u.digest {
            failed.push(format!(
                "  Math.{} over [{}, {}] ({} points)",
                u.name, u.from, u.to, u.n
            ));
        }
        checked += 1;
    }
    // sin/cos: 5 ranges each. exp: 8. log: 5. sqrt, atan: 1 each.
    assert_eq!(checked, 25, "a sweep stopped being checked");
    assert!(
        failed.is_empty(),
        "{} of {checked} swept ranges diverged from the JS runtime:\n{}",
        failed.len(),
        failed.join("\n")
    );
}

/// The negative control. The twins are hundreds of lines of transcribed 1993 C,
/// and the only thing that justifies carrying them is that the alternatives are
/// wrong. If a future `libm` picks up Sun's evaluation order — or a target's std
/// starts routing through it — this fails and says so, instead of leaving the
/// twins in place as unexplained ceremony.
///
/// ## Why this is not one blanket `assert_ne!` over every range
///
/// Because that would assert a falsehood. The four primitives fail in three
/// different shapes, and the control has to know which:
///
/// · `cos`/`sin` — the kernels differ EVERYWHERE, so every range is asserted
///   individually. The multi-word reduction above 2^20·(π/2) is a different
///   code path from the Cody–Waite one below it and a library could agree on
///   one and not the other, so an aggregate here would hide a real regression.
/// · `log` — the divergence lives inside the reduced band `sqrt(2)/2 … sqrt(2)`
///   (4% of inputs there). Outside it the `k·ln2` term dominates and `libm`
///   reproduces the runtime EXACTLY: the subnormal and 1e300 sweeps agree, and
///   must be allowed to. The band sweep is what is asserted.
/// · `exp` — `libm::exp` IS fdlibm's `e_exp`. Across eight swept ranges it is
///   wrong on ONE input in the entire double range, `Math.exp(1)`, which V8
///   special-cases to `Math.E`. Exactly one sweep may disagree, and it is the
///   one whose interval contains 1.0. Pinned as `== 1`, not `>= 1`: if that
///   number ever moves, the finding in `jsmath::fdlibm_explog`'s header is
///   stale and the header is the thing to fix.
#[test]
fn the_rejected_candidates_still_disagree() {
    let o = load();
    // (primitive, candidate) → how many swept ranges the candidate got WRONG.
    let mut wrong: BTreeMap<(&str, &str), u32> = BTreeMap::new();
    let mut ranges = 0;
    let mut band_checked = 0;

    for u in &o.unary {
        let Some(candidates) = rejected(&u.name) else {
            continue;
        };
        for (who, f) in candidates {
            let differs = sweep_digest(u, f) != u.digest;
            *wrong.entry((u.name.as_str(), who)).or_default() += u32::from(differs);

            if matches!(u.name.as_str(), "cos" | "sin") {
                assert!(
                    differs,
                    "{}::{} now AGREES with the runtime over [{}, {}] — if that is real, \
                     jsmath::fdlibm's whole rationale changed and its header is stale",
                    who, u.name, u.from, u.to
                );
            }
            // log's reduced band — the one range where the twin has to earn its
            // keep. Identified by SHAPE, not by its endpoints: the log sweep
            // that straddles 1.0 with room on both sides AND spans under two
            // octaves, i.e. the one that spends every input in the `k == 0`
            // polynomial. (`to/from` is load-bearing: [1e-9, 1e3] straddles 1.0
            // too, and matching it here silently doubled the count.)
            if u.name == "log" && u.from < 0.99 && u.to > 1.01 && u.to / u.from < 4.0 {
                assert!(
                    differs,
                    "{}::log now AGREES with the runtime across sqrt(2)/2 … sqrt(2), \
                     which is where fdlibm and the table-driven routine differ at all — \
                     js_log's rationale changed",
                    who
                );
                band_checked += 1;
            }
        }
        ranges += 1;
    }

    // cos 5 + sin 5 + exp 8 + log 5.
    assert_eq!(ranges, 23, "a controlled range stopped being controlled");
    assert_eq!(
        band_checked, 2,
        "the log band sweep is no longer in the fixture"
    );

    assert_eq!(
        wrong[&("exp", "libm")],
        1,
        "libm::exp is fdlibm and its ONLY divergence from the runtime is Math.exp(1); \
         exactly one swept range should contain 1.0. If this is not 1, either a sweep \
         was added/removed or libm::exp is no longer fdlibm — check which before \
         touching js_exp."
    );
    for who in ["libm", "std"] {
        for name in ["exp", "log"] {
            if (name, who) == ("exp", "libm") {
                continue; // pinned exactly, above
            }
            assert!(
                wrong[&(name, who)] >= 1,
                "{who}::{name} now reproduces the runtime over EVERY swept range — \
                 jsmath::fdlibm_explog would be dead weight"
            );
        }
    }
}

#[test]
fn js_pow_matches_the_runtime() {
    let o = load();

    for [base, exp, want] in &o.spot {
        let got = js_pow(*base, *exp);
        assert!(
            got.to_bits() == want.to_bits(),
            "js_pow({base}, {exp}) = {got:?}, runtime says {want:?}"
        );
    }

    assert!(o.sweeps.len() >= 4, "the sweep set was thinned out");
    for s in &o.sweeps {
        let mut h = Fnv1a::new();
        for k in 0..=s.n {
            h.f64(js_pow(f64::from(k) / f64::from(s.n), s.exp));
        }
        assert_eq!(
            h.finish(),
            s.digest,
            "x^{} over {} points diverged from the JS runtime — see jsmath::js_pow",
            s.exp,
            s.n
        );
    }

    // The negative control: the implementation the workspace rule would have
    // pointed at must FAIL this, or the test is not measuring what it claims.
    // (Both are ≤1 ulp from the true result; only one of them is what the
    // oracle computed, and only that one reproduces the oracle's floors.)
    let mut fdlibm = Fnv1a::new();
    let s = &o.sweeps[0];
    for k in 0..=s.n {
        fdlibm.f64(libm::pow(f64::from(k) / f64::from(s.n), s.exp));
    }
    assert_ne!(
        fdlibm.finish(),
        s.digest,
        "libm::pow now AGREES with the runtime — if that is real, js_pow's whole \
         rationale changed and its comment is stale"
    );
}
