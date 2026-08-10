//! `Math.pow`, replayed against sweeps exported from the real JS runtime.
//!
//! Exported by `legacy/.../port-fixtures.test.ts` ("Math.pow matches its pinned
//! sweep"). This is a PRIMITIVE-level parity gate, not a trace: it exists
//! because the maze port diverged on 1 ulp in one input in ten, with the
//! topology bit-identical, and no structural check could see it.
//!
//! A digest of the whole curve rather than spot values, on purpose — a handful
//! of samples is exactly how a one-in-ten 1-ulp difference gets missed.

use pk_core::jsmath::js_pow;
use pk_core::maze::digest::Fnv1a;
use serde::Deserialize;

#[derive(Deserialize)]
struct Oracle {
    sweeps: Vec<Sweep>,
    /// `[base, exponent, expected]` — printable, so a failure reads next to a
    /// node REPL instead of only as a hash.
    spot: Vec<[f64; 3]>,
}

#[derive(Deserialize)]
struct Sweep {
    exp: f64,
    n: u32,
    digest: u32,
}

#[test]
fn js_pow_matches_the_runtime() {
    let path = format!(
        "{}/../../assets/fixtures/jsmath-pow-oracle.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let text = std::fs::read_to_string(&path).expect(
        "fixture missing — run `cd legacy && RUN_EXPORT=1 scripts/ops/pk-run.sh --class test \
         -- npx vitest run src/game/pinball-knight/port-fixtures.test.ts`",
    );
    let o: Oracle = serde_json::from_str(&text).unwrap();

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
