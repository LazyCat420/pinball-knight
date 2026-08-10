//! The jsmath oracle, compiled for the target the players actually run.
//!
//! `tests/jsmath_oracle.rs` replays the sweeps exported from node and it
//! replays them **natively**, against this box's system libm. That is not the
//! shipped configuration. On `wasm32-unknown-unknown` there is no system libm:
//! `f64::powf` lowers to `compiler_builtins`' math, which is the `libm` crate,
//! which is fdlibm — the implementation the pow sweep already measured as *not*
//! V8's (19,904 of 200,001 inputs, 1 ulp each). `js_pow` runs ~140× per floor
//! feeding lane widths, so a wasm-only divergence means the browser generates
//! different floors from the ones the fixtures certify, silently, with the
//! topology intact. Exactly the failure mode `jsmath` exists for.
//!
//! Rather than reason about which symbol a target resolves, this crate compiles
//! the same digest loops the native test runs and exports them as bare numeric
//! functions. `scripts/jsmath-wasm-check.mjs` instantiates the module in node
//! and compares every digest against `assets/fixtures/jsmath-oracle.json` — the
//! same fixture, the same arithmetic, a different target. No wasm-bindgen, no
//! DOM, no GPU: this one runs in CI.
//!
//! The digest loops are duplicated from the native test on purpose. Sharing
//! them would mean a helper crate both sides import, and then a bug in the
//! helper reads as agreement. Two transcriptions of the same twelve lines that
//! must produce the same u32 is the cheaper check.

use pk_core::jsmath::{js_cos, js_exp, js_log, js_pow, js_sin};
use pk_core::maze::digest::Fnv1a;

/// Selector for the unary sweeps. Mirrors `jsmath_oracle.rs::required_impl` —
/// the ONE implementation each primitive is required to call. The node driver
/// owns the name→code mapping and asserts it covered every swept name, so a
/// primitive added to the fixture without a code here fails loudly instead of
/// being skipped.
fn required(kind: u32) -> Option<fn(f64) -> f64> {
    match kind {
        0 => Some(js_cos),
        1 => Some(js_sin),
        2 => Some(js_exp),
        3 => Some(js_log),
        4 => Some(f64::sqrt),
        5 => Some(libm::atan),
        6 => Some(libm::tan),
        _ => None,
    }
}

/// The candidates the workspace's "transcendentals go through `libm`" rule
/// would have reached for. Carried into wasm as well, because the interesting
/// question on this target is not only "does the required impl still match" but
/// "did the required impl silently BECOME one of the rejected ones".
fn candidate(kind: u32) -> Option<fn(f64) -> f64> {
    match kind {
        100 => Some(libm::cos),
        101 => Some(libm::sin),
        102 => Some(libm::exp),
        103 => Some(libm::log),
        // std, i.e. whatever this target resolves the intrinsic to.
        200 => Some(f64::cos),
        201 => Some(f64::sin),
        202 => Some(f64::exp),
        203 => Some(f64::ln),
        204 => Some(f64::tan),
        _ => None,
    }
}

/// Transcribed from `jsmath_oracle.rs::sweep_digest`. `n + 1` samples, endpoint
/// inclusive, exactly as the exporter walks them.
fn sweep(f: impl Fn(f64) -> f64, from: f64, to: f64, n: u32) -> u32 {
    let mut h = Fnv1a::new();
    for k in 0..=n {
        h.f64(f(from + (to - from) * f64::from(k) / f64::from(n)));
    }
    h.finish()
}

/// `u32::MAX` is the "no such selector" answer — a real FNV-1a digest can be
/// `u32::MAX` too, so the node driver checks the selector table by COUNT rather
/// than by sentinel. The sentinel is only here so a typo cannot panic inside a
/// module with no unwinder.
const NO_SUCH_KIND: u32 = u32::MAX;

/// # Safety
/// None required — every argument is a scalar and nothing is dereferenced.
#[no_mangle]
pub extern "C" fn unary_digest(kind: u32, from: f64, to: f64, n: u32) -> u32 {
    match required(kind).or_else(|| candidate(kind)) {
        Some(f) => sweep(f, from, to, n),
        None => NO_SUCH_KIND,
    }
}

/// Transcribed from `jsmath_oracle.rs::lattice_digest`. Outer loop is `y`,
/// inner is `x` — `atan2` is not symmetric and the loops do not commute.
#[no_mangle]
pub extern "C" fn lattice_digest(kind: u32, from: f64, to: f64, n: u32) -> u32 {
    let f: fn(f64, f64) -> f64 = match kind {
        0 => libm::atan2,
        // std's atan2, as the negative control.
        200 => |y: f64, x: f64| y.atan2(x),
        _ => return NO_SUCH_KIND,
    };
    let mut h = Fnv1a::new();
    let span = to - from;
    for j in 0..=n {
        let y = from + span * f64::from(j) / f64::from(n);
        for i in 0..=n {
            h.f64(f(y, from + span * f64::from(i) / f64::from(n)));
        }
    }
    h.finish()
}

/// `x^exp` over `n + 1` points of `[0, 1]` — the shape `js_pow_matches_the_runtime`
/// uses, and the one that matters most here.
#[no_mangle]
pub extern "C" fn pow_sweep_digest(exp: f64, n: u32) -> u32 {
    let mut h = Fnv1a::new();
    for k in 0..=n {
        h.f64(js_pow(f64::from(k) / f64::from(n), exp));
    }
    h.finish()
}

/// The same sweep through `libm::pow` — fdlibm, explicitly. If this AGREES with
/// `pow_sweep_digest` on wasm while the native build has them disagreeing, that
/// is the divergence this crate was written to find, named rather than inferred.
#[no_mangle]
pub extern "C" fn pow_sweep_digest_libm(exp: f64, n: u32) -> u32 {
    let mut h = Fnv1a::new();
    for k in 0..=n {
        h.f64(libm::pow(f64::from(k) / f64::from(n), exp));
    }
    h.finish()
}

/// One `js_pow`, bits out. The spot table in the fixture is printable on
/// purpose (a failure should read next to a node REPL, not only as a hash), and
/// that only works if the driver can get the actual value back.
#[no_mangle]
pub extern "C" fn pow_spot(base: f64, exp: f64) -> f64 {
    js_pow(base, exp)
}

/// `f64::powf` with no `js_pow` wrapper — so the driver can tell "the ±0.5 fast
/// path saved us" apart from "the platform routine matches".
#[no_mangle]
pub extern "C" fn powf_raw(base: f64, exp: f64) -> f64 {
    base.powf(exp)
}
