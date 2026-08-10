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

use pk_core::jsmath::{js_cos, js_pow, js_sin};
use pk_core::maze::digest::Fnv1a;
use serde::Deserialize;

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

/// A candidate implementation of a JS primitive. Named because the whole file
/// is about choosing between several of them for the same function.
type Candidate = fn(f64) -> f64;

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
        // IEEE-correctly-rounded — every implementation agrees, no twin needed.
        "sqrt" => Some(f64::sqrt),
        "atan" => Some(libm::atan),
        // exp/log have NO agreeing implementation — see the gap test below.
        _ => None,
    }
}

#[test]
fn every_swept_primitive_matches_the_runtime() {
    let o = load();
    assert!(
        o.unary.len() >= 14,
        "the sweep set was thinned out — {} entries",
        o.unary.len()
    );

    let mut checked = 0;
    for u in &o.unary {
        let Some(f) = required_impl(&u.name) else {
            continue;
        };
        assert_eq!(
            sweep_digest(u, f),
            u.digest,
            "Math.{} over [{}, {}] ({} points) diverged from the JS runtime",
            u.name,
            u.from,
            u.to,
            u.n
        );
        checked += 1;
    }
    // sin/cos: 5 ranges each. sqrt, atan: 1 each.
    assert_eq!(checked, 12, "a sweep stopped being checked");
}

/// The negative control. `js_cos`/`js_sin` are 300 lines of transcribed 1993 C,
/// and the only thing that justifies carrying them is that the alternatives are
/// wrong. If a future `libm` picks up Sun's evaluation order — or a target's std
/// starts routing through it — this fails and says so, instead of leaving the
/// twins in place as unexplained ceremony.
///
/// Asserted per range, because the multi-word reduction above 2^20·(π/2) is a
/// different code path from the Cody–Waite one below it, and a library could
/// agree on one and not the other.
#[test]
fn the_rejected_trig_candidates_still_disagree() {
    let o = load();
    let mut ranges = 0;
    for u in &o.unary {
        let (libm_f, std_f): (Candidate, Candidate) = match u.name.as_str() {
            "cos" => (libm::cos, f64::cos),
            "sin" => (libm::sin, f64::sin),
            _ => continue,
        };
        for (who, f) in [("libm", libm_f), ("std", std_f)] {
            assert_ne!(
                sweep_digest(u, f),
                u.digest,
                "{}::{} now AGREES with the runtime over [{}, {}] — if that is real, \
                 jsmath::fdlibm's whole rationale changed and its header is stale",
                who,
                u.name,
                u.from,
                u.to
            );
        }
        ranges += 1;
    }
    assert_eq!(ranges, 10, "a trig range stopped being controlled");
}

/// **A MEASURED GAP, pinned so it cannot be mistaken for a passing row.**
///
/// `Math.exp` and `Math.log` are reproduced by NEITHER `libm` nor this
/// platform's std — same story as `cos`: V8 kept fdlibm's `e_exp.c`/`e_log.c`
/// and everyone else moved to the table-driven ARM optimized-routines versions.
/// No twin is written yet.
///
/// This is not theoretical. `pk_core::combo` already calls `libm::exp` and
/// `libm::log` (the corner-restitution, corner-add and combo-window curves,
/// which feed pinball physics), `gambler::darts` calls `libm::log10`, and
/// `intro.rs` uses std `ln`/`exp` for the camera zoom. The 600-tick momentum
/// fixture is bit-exact today, so no divergent input has been HIT — that is a
/// statement about the inputs those traces happen to take, not about the
/// primitives being safe.
///
/// The test asserts the gap rather than skipping it, so writing the twins makes
/// this fail and forces the row into `required_impl` above.
#[test]
fn exp_and_log_have_no_agreeing_implementation_yet() {
    let o = load();
    let mut gaps = 0;
    for u in &o.unary {
        let candidates: [(&str, Candidate); 2] = match u.name.as_str() {
            "exp" => [("libm", libm::exp), ("std", f64::exp)],
            "log" => [("libm", libm::log), ("std", f64::ln)],
            _ => continue,
        };
        for (who, f) in candidates {
            assert_ne!(
                sweep_digest(u, f),
                u.digest,
                "{}::{} now matches the runtime — promote it into required_impl() \
                 and delete this gap test",
                who,
                u.name
            );
        }
        gaps += 1;
    }
    assert_eq!(
        gaps, 2,
        "exp/log stopped being swept — the gap is now invisible"
    );
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
