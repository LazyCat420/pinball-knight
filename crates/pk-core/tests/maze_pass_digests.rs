//! The Rust half of the maze parity harness.
//!
//! Exported by `legacy/src/game/pinball-knight/port-maze-fixtures.test.ts`:
//!
//!   · `maze-digest-selftest.json` — the digest's own pinned vectors.
//!   · `maze-pass-digests.json`    — ten corpus floors × twenty-three pass
//!     boundaries, each with seven digests, six exact counts, the cumulative
//!     rng draw count and the pass's own scalars.
//!
//! ## What this file can prove TODAY, and what it cannot
//!
//! The generator is not ported yet, so nothing here replays a floor. What it
//! does prove is that the INSTRUMENT is sound before it is ever pointed at a
//! port — and that is not a formality. A digest that is subtly wrong (a missed
//! length fold, a big-endian f64) disagrees with the oracle on every pass of
//! every floor, which is indistinguishable from a completely broken generator.
//! Debugging the port with an uncertified instrument means every failure has
//! two candidate causes. So:
//!
//!   1. `digest_matches_its_pinned_vectors` — the hash, byte encodings
//!      included, against values JSON cannot even carry (`-0`, `Infinity`).
//!   2. `floor_seed_matches_the_js_oracle` — the one seed derivation every
//!      corpus floor rests on.
//!   3. `fixture_has_the_shape_the_port_will_replay` — the pass ORDER against
//!      `PASS_ORDER`, so a rename on the TS side fails here rather than as
//!      twenty-two shifted digests once the port lands.
//!
//! As each pass of `build_track_floor` is ported it gains a replay test that
//! drives the real pipeline through `PassProbe` and compares `record()` against
//! this fixture, first-divergence-first. Until then this file is the harness's
//! own gate, and it is honest about being exactly that.

use pk_core::maze::{digest, floor_seed, PASS_ORDER};
use serde::Deserialize;

#[derive(Deserialize)]
struct SelfTest {
    algo: String,
    vectors: Vec<Vector>,
}

#[derive(Deserialize)]
struct Vector {
    name: String,
    kind: String,
    /// Element count — what the length fold folds. NOT the byte count.
    elements: usize,
    /// The little-endian byte stream the elements encode to, before the fold.
    bytes: String,
    digest: u32,
}

#[derive(Deserialize)]
struct Corpus {
    #[serde(rename = "passOrder")]
    pass_order: Vec<String>,
    floors: Vec<Floor>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Floor {
    level: i32,
    run_seed: u32,
    floor_seed: u32,
    cells_w: i32,
    cells_h: i32,
    w: i32,
    h: i32,
    draws_before_track: u64,
    total_draws: u64,
    passes: Vec<Pass>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Pass {
    pass: String,
    draws: u64,
    t: u32,
    arcs: u32,
    lane: Option<u32>,
    walkable: u32,
    arc_tiles: u32,
}

fn fixture(name: &str) -> String {
    let path = format!(
        "{}/../../assets/fixtures/{name}",
        env!("CARGO_MANIFEST_DIR")
    );
    std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "fixture {path} missing ({e}) — regenerate with `cd legacy && RUN_EXPORT=1 \
             scripts/ops/pk-run.sh --class test -- npx vitest run \
             src/game/pinball-knight/port-maze-fixtures.test.ts`"
        )
    })
}

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|k| u8::from_str_radix(&s[k..k + 2], 16).expect("fixture bytes are hex"))
        .collect()
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// The values behind each wide vector, mirroring the TS exporter's literals.
///
/// ⚠️ MIRROR, and deliberately so: JSON cannot carry `-0` (it stringifies to
/// `0`) or `Infinity` (it stringifies to `null`), and those two are precisely
/// the bit patterns a float encoding gets wrong. Writing the values out on both
/// sides and pinning the ENCODED BYTES is what makes the mirror self-checking —
/// if either list drifts, the byte comparison below fails immediately.
fn wide_vector_bytes(kind: &str) -> (Vec<u8>, u32, usize) {
    match kind {
        // ⚠️ The bytes come from `digest::le_*`, the same seam the digest
        // itself encodes through — not from a local `to_le_bytes`. A test that
        // encodes with its own copy certifies an encoder it never called.
        "f64" => {
            let vals = [
                0.0_f64,
                -0.0,
                1.0,
                std::f64::consts::PI,
                f64::INFINITY,
                -1.5e-300,
            ];
            let bytes = vals.iter().flat_map(|&v| digest::le_f64(v)).collect();
            (bytes, digest::digest_f64(&vals), vals.len())
        }
        "f32" => {
            let vals = [0.0_f32, -0.0, 1.0, 3.5, f32::INFINITY];
            let bytes = vals.iter().flat_map(|&v| digest::le_f32(v)).collect();
            (bytes, digest::digest_f32(&vals), vals.len())
        }
        "i16" => {
            let vals = [-1_i16, 0, 1, -32768, 32767];
            let bytes = vals.iter().flat_map(|&v| digest::le_i16(v)).collect();
            (bytes, digest::digest_i16(&vals), vals.len())
        }
        other => panic!("unknown wide vector kind {other}"),
    }
}

#[test]
fn digest_matches_its_pinned_vectors() {
    let st: SelfTest = serde_json::from_str(&fixture("maze-digest-selftest.json")).unwrap();
    assert_eq!(st.algo, "fnv1a32-le", "the exporter changed hash");
    assert!(st.vectors.len() >= 8, "the vector set was thinned out");
    let mut seen_wide = 0;
    for v in &st.vectors {
        let bytes = unhex(&v.bytes);
        if v.kind == "u8" {
            assert_eq!(bytes.len(), v.elements, "{}: byte/element mismatch", v.name);
            assert_eq!(
                digest::digest_bytes(&bytes),
                v.digest,
                "{}: digest_bytes diverged from the JS oracle",
                v.name
            );
            continue;
        }
        seen_wide += 1;
        let (mine, digest, elements) = wide_vector_bytes(&v.kind);
        assert_eq!(elements, v.elements, "{}: element count drifted", v.name);
        // The ENCODING first: a big-endian port would still hash to something
        // self-consistent, and this is the assertion that names the real cause.
        assert_eq!(
            hex(&mine),
            v.bytes,
            "{}: little-endian encoding diverged from the JS oracle",
            v.name
        );
        assert_eq!(
            digest, v.digest,
            "{}: digest diverged from the JS oracle",
            v.name
        );
    }
    assert_eq!(seen_wide, 3, "f64/f32/i16 must each be certified");

    // The length fold, stated as its own claim rather than left implicit in the
    // vectors above: without it a truncated array digests as a shorter one, and
    // "the port allocated the wrong grid size" is the likeliest early mistake.
    assert_ne!(
        digest::digest_bytes(&[0]),
        digest::digest_bytes(&[0, 0]),
        "the length fold is missing — two all-zero arrays of different size collide"
    );
}

#[test]
fn floor_seed_matches_the_js_oracle() {
    let c: Corpus = serde_json::from_str(&fixture("maze-pass-digests.json")).unwrap();
    for f in &c.floors {
        assert_eq!(
            floor_seed(f.run_seed, f.level),
            f.floor_seed,
            "floor_seed({}, {}) diverged — every draw on this floor is downstream of it",
            f.run_seed,
            f.level
        );
    }
}

#[test]
fn fixture_has_the_shape_the_port_will_replay() {
    let c: Corpus = serde_json::from_str(&fixture("maze-pass-digests.json")).unwrap();
    assert_eq!(
        c.pass_order, PASS_ORDER,
        "PASS_ORDER here and in the exporter have drifted apart"
    );
    assert!(c.floors.len() >= 10, "the corpus was thinned out");

    for f in &c.floors {
        let head = format!("L{} seed {}", f.level, f.run_seed);
        // The grid the port must allocate is a pure function of the level's
        // cell counts. Pinned so a port that mis-derives it fails on the SIZE
        // rather than on 3,975 tile digests.
        assert_eq!(f.w, f.cells_w * 2 + 1, "{head}: grid width is not 2c+1");
        assert_eq!(f.h, f.cells_h * 2 + 1, "{head}: grid height is not 2c+1");
        assert_eq!(f.passes.len(), PASS_ORDER.len(), "{head}: wrong pass count");
        assert!(
            f.total_draws > f.draws_before_track,
            "{head}: the generator drew nothing"
        );

        let mut draws = f.draws_before_track;
        for (k, p) in f.passes.iter().enumerate() {
            assert_eq!(p.pass, PASS_ORDER[k], "{head}: pass {k} out of order");
            // Cumulative and monotone — the property the localiser rests on.
            // If a boundary's count ever went DOWN, "drew N values against the
            // oracle's M" would be arithmetic on nothing.
            assert!(
                p.draws >= draws,
                "{head}: draws went backwards at {} ({} < {draws})",
                p.pass,
                p.draws
            );
            draws = p.draws;
        }
        assert_eq!(
            draws, f.total_draws,
            "{head}: the last boundary and the floor total disagree"
        );

        // ── The tape must exercise the pipeline ─────────────────────────────
        //
        // A fixture of twenty-three identical digests would load, validate and
        // prove nothing — the failure mode a digest harness is most prone to.
        // The trace has to show the floor actually being built.
        let distinct: std::collections::HashSet<u32> = f.passes.iter().map(|p| p.t).collect();
        assert!(
            distinct.len() > 6,
            "{head}: the tiles barely changed across 23 passes"
        );
        let last = f.passes.last().unwrap();
        assert!(last.walkable > 0, "{head}: the finished floor has no floor");
        assert!(
            last.arc_tiles > 0,
            "{head}: the finished floor has no curved walls"
        );
        // The two passes before the track is carved have no mask; every one
        // after it does. That boundary is part of the contract the port
        // reproduces, so it is asserted rather than assumed.
        assert!(
            f.passes[0].lane.is_none() && f.passes[1].lane.is_none(),
            "{head}: mask exists too early"
        );
        assert!(
            f.passes[2..].iter().all(|p| p.lane.is_some()),
            "{head}: a pass after carve-track reported no mask"
        );
        assert_eq!(
            f.passes[0].arcs, f.passes[1].arcs,
            "{head}: arcs before the grid is carved"
        );
    }
}
