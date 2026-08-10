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
//! Passes 1–3 of 23 replay, all ten floors bit-exact. The other twenty are not
//! ported, so most of this fixture is still unread.
//!
//! Underneath the replays sit the instrument's own gates, and they are not a
//! formality. A digest that is subtly wrong (a missed length fold, a big-endian
//! f64) disagrees with the oracle on every pass of every floor, which is
//! indistinguishable from a completely broken generator; debugging a port with
//! an uncertified instrument means every failure has two candidate causes. So:
//!
//!   1. `digest_matches_its_pinned_vectors` — the hash, byte encodings
//!      included, against values JSON cannot even carry (`-0`, `Infinity`).
//!   2. `floor_seed_matches_the_js_oracle` — the one seed derivation every
//!      corpus floor rests on.
//!   3. `fixture_has_the_shape_the_port_will_replay` — the pass ORDER against
//!      `PASS_ORDER`, so a rename on the TS side fails here rather than as
//!      twenty-two shifted digests once the port lands.
//!
//! Each newly ported pass gains a replay test that re-runs the whole prefix
//! (see `prefix_through_path` — the passes share one rng stream, so there is no
//! starting in the middle) and compares every digest and count the boundary
//! pins.
//!
//! ⚠️ **A green replay proves what its boundary can see, which is less than it
//! looks.** Sabotage-measured per pass, and for `carve-track` six of ten
//! injected defects survived — including compiling in the wrong trig library.
//! The per-pass headers carry those tables; read the one for the pass you are
//! about to trust.

use pk_core::grid::{is_walkable, Grid};
use pk_core::maze::archetypes::{
    archetype_for, level_cells, track_node_counts, windiness_for, NodeLayout, SurfaceMix,
};
use pk_core::maze::archetypes::{ARCHETYPES, DEFAULT_RULE_WEIGHTS, DEFAULT_TRACK_PROFILE};
use pk_core::maze::modifiers::{
    roll_modifier, ModifierId, MODIFIER_CHANCE, MODIFIER_FROM_LEVEL, MODIFIER_POOL,
};
use pk_core::maze::track_carve::carve_track;
use pk_core::maze::track_grow::TrackGraph;
use pk_core::maze::track_grow::{
    circuit_rank, digest_edges, digest_nodes, grow_track, GrowTrackOpts,
};
use pk_core::maze::track_path::{
    build_track_path, digest_legs, TrackPath, TrackPathOpts, TRACK_RADII,
};
use pk_core::maze::{digest, floor_rng, floor_seed, CountingRng, TrackMask, PASS_ORDER};
use serde::Deserialize;
use std::collections::BTreeMap;

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
    density: f64,
    /// The archetype's TrackProfile as the oracle resolved it, verbatim.
    profile: ProfileJson,
    passes: Vec<Pass>,
}

/// The legacy `TrackProfile`, as `JSON.stringify` writes it.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProfileJson {
    layout: String,
    food_per_1k: f64,
    relay_per_1k: f64,
    min_loops: i32,
    lane_scale: f64,
    fill: f64,
    link_chance: f64,
    plaza_frac: f64,
    max_len_frac: f64,
    survive: f64,
    /// Only the keys the archetype OVERRIDES are present — the rest inherit
    /// DEFAULT_RULE_WEIGHTS, so an absent key and a key set to the default
    /// value are different facts and are compared as such.
    #[serde(default)]
    rules: RulesJson,
    #[serde(default)]
    bands: Option<BandsJson>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RulesJson {
    perimeter_bias: Option<f64>,
    min_boss_tiles: Option<f64>,
    min_boss_euclid: Option<f64>,
}

/// ⚠️ `BTreeMap<u8, f64>` and not a `Vec` of pairs, on purpose: a JS object with
/// integer-like keys iterates in ASCENDING NUMERIC order whatever order the
/// literal was written in, and BTreeMap is the container with that same order.
/// Deserializing into an insertion-ordered structure would compare the fixture
/// against a claim the fixture does not make.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BandsJson {
    #[serde(default)]
    launch: Option<BTreeMap<u8, f64>>,
    #[serde(default)]
    machine: Option<BTreeMap<u8, f64>>,
    #[serde(default)]
    drain: Option<BTreeMap<u8, f64>>,
    coverage: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Pass {
    pass: String,
    draws: u64,
    t: u32,
    shapes: u32,
    arcs: u32,
    /// Born at `carve-track`, when `ensureArcs` allocates it. Null before.
    arc_idx: Option<u32>,
    /// The mask's three arrays — null on the two passes that run before the
    /// track is carved and the mask does not exist.
    lane: Option<u32>,
    sealed: Option<u32>,
    dist: Option<u32>,
    walkable: u32,
    shaped: u32,
    arc_tiles: u32,
    lane_tiles: u32,
    sealed_tiles: u32,
    /// The circuit, on the two passes that own it. Null everywhere else.
    graph_nodes: Option<u32>,
    graph_edges: Option<u32>,
    /// The rideable geometry, on the ONE pass that owns it. Null elsewhere.
    path_legs: Option<u32>,
    path_arcs: Option<u32>,
    path_arc_half: Option<f64>,
    extra: serde_json::Value,
}

/// The pipeline PREFIX — every pass before the one under test, run for real.
///
/// Each pass shares one rng stream with all the passes before it, so a replay
/// test cannot start in the middle: it has to re-run the whole prefix, with the
/// same draws in the same order. Passes 1 and 2 open-code that because there was
/// nothing to share; from pass 3 there are twenty-one more, and twenty-one
/// hand-copied prefixes is twenty-one chances for one of them to drift into
/// testing a pipeline the oracle never ran.
///
/// Returns the grid the passes mutate, the rng they draw from (already advanced
/// past the two pre-track draws), and the two upstream products.
fn prefix_through_path(f: &Floor) -> (Grid, CountingRng, TrackGraph, TrackPath) {
    let arch = archetype_for(f.level);
    let p = &arch.track;

    // `buildTrackFloor` builds the grid from CELL counts, not tile counts:
    // `w = cellsW * 2 + 1`. The fixture pins both, and `fixture_has_the_shape…`
    // asserts they agree, so this uses the tile dims directly.
    let g = Grid::solid(f.w, f.h);

    let mut rng = floor_rng(f.run_seed, f.level);
    roll_modifier(f.level, &mut rng);
    let _windiness = windiness_for(f.level, arch, &mut rng);
    let (foods, relays) = track_node_counts(p, f.w, f.h);
    let graph = grow_track(
        f.w,
        f.h,
        &mut rng,
        &GrowTrackOpts {
            foods: Some(foods as usize),
            relays: Some(relays as usize),
            min_loops: Some(i64::from(p.min_loops)),
            layout: Some(p.layout),
            max_len_frac: Some(p.max_len_frac),
            survive: Some(p.survive),
            grow: None,
        },
    );
    let path = build_track_path(
        &graph,
        &TrackPathOpts {
            radii: None,
            lane_scale: Some(p.lane_scale),
        },
    );
    (g, rng, graph, path)
}

/// Every digest and count a boundary pins, compared in ONE place.
///
/// Asserting these inline per pass would be twenty lines per test and, worse,
/// each test would choose which of the seven digests it bothered with — which
/// is exactly how `track-path` ended up pinning a leg count and gating nothing.
/// Here a pass either compares all of them or names the ones it cannot yet.
///
/// Order is deliberate: COUNTS first, because "we carved half the circuit" is a
/// different diagnosis from "the circuit is one tile off", and a digest cannot
/// tell you which.
fn assert_boundary(head: &str, want: &Pass, g: &Grid, mask: Option<&TrackMask>, draws: u64) {
    let walkable = (0..g.h)
        .flat_map(|j| (0..g.w).map(move |i| (i, j)))
        .filter(|&(i, j)| is_walkable(g, i, j))
        .count() as u32;
    let shaped = g.shapes.iter().filter(|&&s| s != 0).count() as u32;
    let arc_tiles = g
        .arc_idx
        .as_ref()
        .map_or(0, |a| a.iter().filter(|&&v| v >= 0).count()) as u32;
    assert_eq!(walkable, want.walkable, "{head}: walkable tile count");
    assert_eq!(shaped, want.shaped, "{head}: shaped tile count");
    assert_eq!(arc_tiles, want.arc_tiles, "{head}: arc tile count");
    if let Some(m) = mask {
        assert_eq!(
            m.lane.iter().filter(|&&v| v == 1).count() as u32,
            want.lane_tiles,
            "{head}: lane tile count"
        );
        assert_eq!(
            m.sealed.iter().filter(|&&v| v == 1).count() as u32,
            want.sealed_tiles,
            "{head}: sealed tile count"
        );
    }

    // Draws next — the localiser. A mismatch here means the divergence is in
    // the DRAW SEQUENCE and every value after it is downstream of that; a match
    // with a bad digest means this pass consumed the right stream and did the
    // wrong arithmetic with it.
    assert_eq!(draws, want.draws, "{head}: cumulative rng draws");

    assert_eq!(digest::digest_bytes(&g.t), want.t, "{head}: tile digest");
    assert_eq!(
        digest::digest_bytes(&g.shapes),
        want.shapes,
        "{head}: shape digest"
    );
    assert_eq!(
        digest::digest_arcs(&g.arcs),
        want.arcs,
        "{head}: arc feature digest"
    );
    match (&g.arc_idx, want.arc_idx) {
        (Some(a), Some(d)) => assert_eq!(digest::digest_i16(a), d, "{head}: arcIdx digest"),
        (None, None) => {}
        (a, d) => panic!(
            "{head}: arcIdx exists on one side only (rust={}, oracle={})",
            a.is_some(),
            d.is_some()
        ),
    }
    if let Some(m) = mask {
        assert_eq!(
            digest::digest_bytes(&m.lane),
            want.lane.expect("a carved pass pins a lane digest"),
            "{head}: mask.lane digest"
        );
        assert_eq!(
            digest::digest_bytes(&m.sealed),
            want.sealed.expect("a carved pass pins a sealed digest"),
            "{head}: mask.sealed digest"
        );
        // `dist` is the one that separates the mask from the grid: on these
        // floors `lane` and `t` hold the same bytes and digest identically, so
        // a port that swapped them passes both.
        assert_eq!(
            digest::digest_f32(&m.dist),
            want.dist.expect("a carved pass pins a dist digest"),
            "{head}: mask.dist digest — the f32 store/f64 compare in `disc`"
        );
    }
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

        // ── The path digests exist EXACTLY where the path does ──────────────
        //
        // `track-path` is the only boundary carrying live path geometry, and —
        // uniquely — the only pass whose draw count equals its predecessor's,
        // because `build_track_path` draws nothing. Before these digests were
        // added the boundary pinned a leg COUNT plus the graph pass 1 had
        // already pinned, so a port that shifted every leg by a tile matched.
        // A null here is the gate being off, not a missing nicety.
        let with_path: Vec<&str> = f
            .passes
            .iter()
            .filter(|p| p.path_legs.is_some())
            .map(|p| p.pass.as_str())
            .collect();
        assert_eq!(
            with_path,
            ["track-path"],
            "{head}: the path digests are not pinned at exactly one boundary"
        );
        assert!(
            f.passes[1].path_arcs.is_some() && f.passes[1].path_arc_half.unwrap_or(0.0) > 0.0,
            "{head}: track-path pins legs but not the fillets or the sweep width"
        );
        assert_eq!(
            f.passes[1].draws, f.passes[0].draws,
            "{head}: track-path drew from the rng — it is pure geometry"
        );
    }
}

/// Compare one band's mix against the fixture's ascending-key map.
fn mix_matches(mine: Option<SurfaceMix>, theirs: &Option<BTreeMap<u8, f64>>, what: &str) {
    match (mine, theirs) {
        (None, None) => {}
        (Some(m), Some(t)) => {
            let as_pairs: Vec<(u8, f64)> = t.iter().map(|(&k, &v)| (k, v)).collect();
            assert_eq!(
                m,
                as_pairs.as_slice(),
                "{what}: mix diverged (order is part of it)"
            );
        }
        _ => panic!("{what}: one side has the band and the other does not"),
    }
}

/// THE TABLES, against the profile the oracle actually used.
///
/// The fixture records the resolved `TrackProfile` verbatim for every corpus
/// floor, which makes this a direct comparison rather than a re-derivation: a
/// mistyped digit in `crates/pk-core/src/maze/archetypes.rs` is a different
/// floor, and it would otherwise surface as a `grow-track` digest mismatch
/// forty minutes into debugging the physarum solver.
///
/// `deny_unknown_fields` on the JSON structs is half the test: a field ADDED to
/// the legacy profile fails here loudly instead of being quietly ignored by a
/// Rust table that does not model it.
#[test]
fn archetype_tables_match_the_oracles_profiles() {
    let c: Corpus = serde_json::from_str(&fixture("maze-pass-digests.json")).unwrap();
    let mut seen_layouts = std::collections::HashSet::new();
    for f in &c.floors {
        let head = format!("L{} seed {}", f.level, f.run_seed);
        let arch = archetype_for(f.level);
        let p = &arch.track;
        let o = &f.profile;
        seen_layouts.insert(p.layout);

        assert_eq!(p.layout.as_str(), o.layout, "{head}: layout");
        assert_eq!(p.food_per_1k, o.food_per_1k, "{head}: foodPer1k");
        assert_eq!(p.relay_per_1k, o.relay_per_1k, "{head}: relayPer1k");
        assert_eq!(p.min_loops, o.min_loops, "{head}: minLoops");
        assert_eq!(p.lane_scale, o.lane_scale, "{head}: laneScale");
        assert_eq!(p.fill, o.fill, "{head}: fill");
        assert_eq!(p.link_chance, o.link_chance, "{head}: linkChance");
        assert_eq!(p.plaza_frac, o.plaza_frac, "{head}: plazaFrac");
        assert_eq!(p.max_len_frac, o.max_len_frac, "{head}: maxLenFrac");
        assert_eq!(p.survive, o.survive, "{head}: survive");
        assert_eq!(
            p.rules.perimeter_bias, o.rules.perimeter_bias,
            "{head}: rules.perimeterBias"
        );
        assert_eq!(
            p.rules.min_boss_tiles, o.rules.min_boss_tiles,
            "{head}: rules.minBossTiles"
        );
        assert_eq!(
            p.rules.min_boss_euclid, o.rules.min_boss_euclid,
            "{head}: rules.minBossEuclid"
        );

        match (&p.bands, &o.bands) {
            (None, None) => {}
            (Some(b), Some(ob)) => {
                mix_matches(b.launch, &ob.launch, &format!("{head}: bands.launch"));
                mix_matches(b.machine, &ob.machine, &format!("{head}: bands.machine"));
                mix_matches(b.drain, &ob.drain, &format!("{head}: bands.drain"));
                assert_eq!(b.coverage, ob.coverage, "{head}: bands.coverage");
            }
            _ => panic!("{head}: one side has bands and the other does not"),
        }

        // The grid the level asks for, and the node counts the profile turns
        // that into — the two derived numbers `grow_track` will be handed.
        assert_eq!(
            level_cells(f.level),
            (f.cells_w, f.cells_h),
            "{head}: level_cells"
        );
        let (foods, relays) = track_node_counts(p, f.w, f.h);
        let grow = &f.passes[0].extra;
        assert_eq!(
            i64::from(foods),
            grow["foods"].as_i64().unwrap(),
            "{head}: foods"
        );
        assert_eq!(
            i64::from(relays),
            grow["relays"].as_i64().unwrap(),
            "{head}: relays"
        );

        // ── THE PRE-TRACK STREAM, END TO END ────────────────────────────
        //
        // `authorFloor` draws twice before the generator runs — the modifier
        // roll and the windiness roll — and both are conditional on depth, so
        // `drawsBeforeTrack` is 0, 1, 2 or 3 across the corpus. Reproducing it
        // exercises Mulberry32, floor_seed, roll_modifier and windiness_for in
        // one line each, and `density` is compared as an exact f64: it is a
        // draw run through an arithmetic expression, so equality here is
        // bit-equality of the stream itself.
        //
        // This is the last thing that can be verified before `grow_track`
        // lands — and it is the thing that would otherwise be discovered as a
        // pass-1 digest mismatch, blamed on the physarum solver.
        let mut rng = floor_rng(f.run_seed, f.level);
        roll_modifier(f.level, &mut rng);
        let windiness = windiness_for(f.level, arch, &mut rng);
        assert_eq!(
            rng.draws(),
            f.draws_before_track,
            "{head}: pre-track draw count"
        );
        assert_eq!(
            windiness.clamp(0.35, 0.85),
            f.density,
            "{head}: density (the windiness roll, bit-exact)"
        );
    }
    // Four layouts across five archetypes (two are `scatter`); a corpus that
    // stopped reaching `hub` or `ring` would still pass every assertion above.
    assert!(
        seen_layouts.contains(&NodeLayout::Hub) && seen_layouts.contains(&NodeLayout::Ring),
        "the corpus no longer exercises every node layout"
    );
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Constants {
    modifiers: ModifiersJson,
    rule_weights: RuleWeightsJson,
    default_track_profile: ProfileJson,
    archetypes: Vec<ArchetypeJson>,
    /// `[level, cellsW, cellsH]`, out past the L23/L24 caps.
    level_cells: Vec<[i32; 3]>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ModifiersJson {
    from_level: i32,
    chance: f64,
    ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RuleWeightsJson {
    perimeter_bias: f64,
    min_boss_tiles: f64,
    min_boss_euclid: f64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ArchetypeJson {
    id: String,
    label: String,
    flavour: String,
    windiness: [f64; 2],
}

/// THE CONSTANTS THE CORPUS PROVABLY DOES NOT PIN.
///
/// Ten floors pin an enormous amount, but not everything — and the gap was
/// measured, not guessed: changing `MODIFIER_CHANCE` from 0.45 to 0.5 here
/// changed no floor in the corpus, because separating those two needs a floor
/// whose modifier draw lands in [0.45, 0.5) and none does. A constant a corpus
/// cannot tell apart from a wrong constant is a constant the corpus does not
/// test, and "the digests are green" would have read as "the tables are right".
///
/// So the oracle exports the constants themselves and this compares them. Kept
/// as its own test rather than folded into the profile comparison, because the
/// two answer different questions: that one asks whether the archetype tables
/// match, this one asks whether the numbers no floor exercises are right.
#[test]
fn constants_the_corpus_cannot_discriminate_match_the_oracle() {
    let c: Constants = serde_json::from_str(&fixture("maze-constants.json")).unwrap();

    assert_eq!(
        MODIFIER_FROM_LEVEL, c.modifiers.from_level,
        "MODIFIER_FROM_LEVEL"
    );
    assert_eq!(MODIFIER_CHANCE, c.modifiers.chance, "MODIFIER_CHANCE");
    // The oracle's list includes "none" at index 0; the pool the second draw
    // indexes is the rest of it, in order.
    assert_eq!(
        c.modifiers.ids[0], "none",
        "the oracle's table no longer opens with none"
    );
    let want_pool: Vec<&str> = c.modifiers.ids[1..].iter().map(String::as_str).collect();
    let mine: Vec<&str> = MODIFIER_POOL.iter().map(|m| modifier_str(*m)).collect();
    assert_eq!(
        mine, want_pool,
        "the modifier pool diverged (order indexes the roll)"
    );

    assert_eq!(
        DEFAULT_RULE_WEIGHTS.perimeter_bias,
        c.rule_weights.perimeter_bias
    );
    assert_eq!(
        DEFAULT_RULE_WEIGHTS.min_boss_tiles,
        c.rule_weights.min_boss_tiles
    );
    assert_eq!(
        DEFAULT_RULE_WEIGHTS.min_boss_euclid,
        c.rule_weights.min_boss_euclid
    );

    // The baseline profile — inherited by any archetype that omits a field, and
    // reached by no corpus floor, since all five archetypes override.
    let d = &DEFAULT_TRACK_PROFILE;
    let o = &c.default_track_profile;
    assert_eq!(d.layout.as_str(), o.layout);
    assert_eq!(d.food_per_1k, o.food_per_1k);
    assert_eq!(d.relay_per_1k, o.relay_per_1k);
    assert_eq!(d.min_loops, o.min_loops);
    assert_eq!(d.lane_scale, o.lane_scale);
    assert_eq!(d.fill, o.fill);
    assert_eq!(d.link_chance, o.link_chance);
    assert_eq!(d.plaza_frac, o.plaza_frac);
    assert_eq!(d.max_len_frac, o.max_len_frac);
    assert_eq!(d.survive, o.survive);

    assert_eq!(ARCHETYPES.len(), c.archetypes.len(), "archetype count");
    for (mine, theirs) in ARCHETYPES.iter().zip(&c.archetypes) {
        assert_eq!(mine.id.as_str(), theirs.id, "archetype id/order");
        assert_eq!(mine.label, theirs.label, "{}: label", theirs.id);
        assert_eq!(mine.flavour, theirs.flavour, "{}: flavour", theirs.id);
        assert_eq!(
            [mine.windiness.0, mine.windiness.1],
            theirs.windiness,
            "{}: windiness range",
            theirs.id
        );
    }

    // The size ramp AND its clamp. The corpus stops at L13; the caps bind at
    // L23/L24, so without this the clamp is untested by every floor.
    for row in &c.level_cells {
        let [level, w, h] = *row;
        assert_eq!(level_cells(level), (w, h), "level_cells({level})");
    }
    let last = c.level_cells.last().unwrap();
    assert!(
        last[0] >= 25,
        "the exported range no longer reaches the caps"
    );
}

/// The pool ids as the legacy strings. Deliberately not a `Display` impl on
/// `ModifierId` — the strings exist to be compared against the oracle, and a
/// general-purpose formatter is one refactor away from being prettified.
fn modifier_str(m: ModifierId) -> &'static str {
    match m {
        ModifierId::None => "none",
        ModifierId::Flooded => "flooded",
        ModifierId::Blackout => "blackout",
        ModifierId::Overcharged => "overcharged",
        ModifierId::Gilded => "gilded",
        ModifierId::Collapsing => "collapsing",
        ModifierId::Frozen => "frozen",
        ModifierId::Silted => "silted",
    }
}

/// PASS 1 — `grow-track`, replayed against the oracle on every corpus floor.
///
/// The first pass that actually generates something, and the first place the
/// harness earns its keep. It writes NOTHING to the grid — the whole output is
/// a graph — so the tile digests at this boundary are the all-wall grid on both
/// sides and prove nothing. What is compared is the graph itself: node
/// positions in placement order, tube endpoints, conductivities and lengths.
///
/// The two failure modes this separates, which is the point of digesting nodes
/// and edges apart:
///
///   · nodes differ  → the LAYOUT diverged. The rejection sampler draws twice
///     per attempt including rejected ones, so this is almost always a draw
///     accounting mistake, and `draws` will say so too.
///   · nodes match, edges differ → the layout is right and the SOLVER is not.
///     140 Gauss–Seidel sweeps and a `pow(q/qMax, 1.35)` per tube per step: the
///     suspects are `libm::pow` vs V8's, the sweep order, and the normalisation.
#[test]
fn pass1_grow_track_replays_the_oracle() {
    let c: Corpus = serde_json::from_str(&fixture("maze-pass-digests.json")).unwrap();
    let mut moved: Vec<String> = Vec::new();
    for f in &c.floors {
        let head = format!("L{} seed {}", f.level, f.run_seed);
        let arch = archetype_for(f.level);
        let p = &arch.track;

        // The shipping call, exactly as `authorFloor` → `buildTrackFloor` makes
        // it: two pre-track draws, then the generator on a grid of (2c+1).
        let mut rng = floor_rng(f.run_seed, f.level);
        roll_modifier(f.level, &mut rng);
        let _windiness = windiness_for(f.level, arch, &mut rng);
        let (foods, relays) = track_node_counts(p, f.w, f.h);
        let graph = grow_track(
            f.w,
            f.h,
            &mut rng,
            &GrowTrackOpts {
                foods: Some(foods as usize),
                relays: Some(relays as usize),
                min_loops: Some(i64::from(p.min_loops)),
                layout: Some(p.layout),
                max_len_frac: Some(p.max_len_frac),
                survive: Some(p.survive),
                grow: None,
            },
        );

        let want = &f.passes[0];
        assert_eq!(want.pass, "grow-track", "{head}: fixture pass 1 moved");

        // Counts first — they are the legible failure. A digest mismatch with
        // matching counts is a different bug from "we grew half a network".
        let extra = &want.extra;
        assert_eq!(
            graph.nodes.len() as i64,
            extra["nodes"].as_i64().unwrap(),
            "{head}: surviving node count"
        );
        assert_eq!(
            graph.edges.len() as i64,
            extra["edges"].as_i64().unwrap(),
            "{head}: surviving edge count"
        );
        // The draw count next: it is the same on every floor already, including
        // the ones blocked below, because the blockage moves VALUES and not the
        // number of draws.
        assert_eq!(
            rng.draws(),
            want.draws,
            "{head}: draws at the pass-1 boundary"
        );

        // Nodes and edges are digested SEPARATELY so a failure says which half:
        // nodes differ means the layout diverged, nodes match and edges differ
        // means the layout is right and the solver is wrong.
        //
        // This is where the trig gap used to live. Two floors of ten (L3 s1,
        // L13 s1) put one node one ulp out of place, because the `hub` layout
        // is the only one that takes `Math.cos`/`Math.sin` of an arbitrary
        // angle and V8's trig is a third implementation — neither `libm`'s nor
        // the platform's. `jsmath::js_cos`/`js_sin` closed it, and the whole
        // corpus is bit-exact at this boundary now.
        //
        // Collected rather than asserted in place: HOW MANY floors moved is
        // itself the diagnosis. One floor of ten is a value landing on a
        // rounding boundary; ten of ten is the algorithm. Aborting on the first
        // one reports "L3 seed 1" either way — measured under sabotage, where
        // deleting `kernel_cos`'s qx branch moved three floors and the old
        // first-failure abort showed exactly one of them.
        if digest_nodes(&graph.nodes) != want.graph_nodes.expect("pass 1 pins a node digest") {
            moved.push(format!("  {head}: node layout — the PLACEMENT diverged"));
            continue;
        }
        if digest_edges(&graph.edges) != want.graph_edges.expect("pass 1 pins an edge digest") {
            moved.push(format!(
                "  {head}: edges, with the nodes matching — the SOLVER diverged \
                 (conductivities, prune order, or the K-nearest sort)"
            ));
            continue;
        }

        // The pass's own contract, restated as an assertion rather than trusted:
        // a connected loopy core with no dangling spurs.
        assert!(
            circuit_rank(&graph) >= i64::from(p.min_loops),
            "{head}: circuit rank below the profile's floor"
        );
    }

    // ── THE EXCLUSION LIST THAT USED TO LIVE HERE ───────────────────────────
    //
    // Two floors were pinned by name — L3 s1 and L13 s1, blocked on the trig
    // twins. It is worth recording why the list was BY NAME and not by layout,
    // because the shape is what made it safe to carry: L3, L8 and L13 are all
    // hub floors and only two of them diverged, so "exclude the hub layout"
    // would have excused three floors that were already passing and stopped
    // testing them. The list asserted EQUALITY, so it would have failed on a
    // new divergence as loudly as on a fixed one — and what actually happened
    // is that `js_cos`/`js_sin` emptied it and the equality assertion is what
    // said so.
    //
    // All ten floors assert inline, above. Nothing is excluded here — and the
    // report names every floor that moved, not just the first.
    assert!(
        moved.is_empty(),
        "{} of {} corpus floors diverged at the grow-track boundary:\n{}",
        moved.len(),
        c.floors.len(),
        moved.join("\n")
    );
}

/// PASS 2 — `track-path`, replayed against the oracle on every corpus floor.
///
/// ## Why this boundary needed the fixture widened before it could be a gate
///
/// Pass 2 is the only pass in the pipeline that draws NOTHING from the rng: it
/// is pure geometry over pass 1's graph. So the draw counter — the localiser
/// every other pass leans on, the thing that splits "wrong sequence" from
/// "wrong arithmetic" — is identical on both sides here by construction, and
/// the graph digests at this boundary are pass 1's output unchanged. What the
/// fixture pinned was `extra: { legs: N }`, a COUNT, and a count is not a
/// digest: a port that pulled every leg back by the wrong setback, or emitted
/// the same legs in a different order, matched it exactly.
///
/// `pathLegs` / `pathArcs` / `pathArcHalf` were added to the exporter for this
/// test. Digested apart so a failure says which half diverged:
///
///   · legs differ            → the SETBACK settlement is wrong (the radius
///     search, the per-junction max, or the "eaten by its own fillets" drop).
///   · legs match, arcs differ → the setbacks are right and the fillet
///     construction is not (the bisector, `R/sin(θ/2)`, or the span's sign).
///
/// The two V8 primitives this pass reaches that no earlier pass did are
/// `Math.tan` and `Math.atan2`; both are swept in `tests/jsmath_oracle.rs`
/// against the runtime, because "libm is right for atan so it is right for
/// atan2" is exactly the reasoning that put `libm::pow` in pass 1.
#[test]
fn pass2_track_path_replays_the_oracle() {
    let c: Corpus = serde_json::from_str(&fixture("maze-pass-digests.json")).unwrap();
    for f in &c.floors {
        let head = format!("L{} seed {}", f.level, f.run_seed);
        let arch = archetype_for(f.level);
        let p = &arch.track;

        // The shipping call, exactly as `buildTrackFloor` makes it.
        let mut rng = floor_rng(f.run_seed, f.level);
        roll_modifier(f.level, &mut rng);
        let _windiness = windiness_for(f.level, arch, &mut rng);
        let (foods, relays) = track_node_counts(p, f.w, f.h);
        let graph = grow_track(
            f.w,
            f.h,
            &mut rng,
            &GrowTrackOpts {
                foods: Some(foods as usize),
                relays: Some(relays as usize),
                min_loops: Some(i64::from(p.min_loops)),
                layout: Some(p.layout),
                max_len_frac: Some(p.max_len_frac),
                survive: Some(p.survive),
                grow: None,
            },
        );
        let path = build_track_path(
            &graph,
            &TrackPathOpts {
                radii: None,
                lane_scale: Some(p.lane_scale),
            },
        );

        let want = &f.passes[1];
        assert_eq!(want.pass, "track-path", "{head}: fixture pass 2 moved");

        // Counts first — the legible failure. "we built half a circuit" is a
        // different bug from "the legs are a millimetre out".
        assert_eq!(
            path.legs.len() as i64,
            want.extra["legs"].as_i64().unwrap(),
            "{head}: surviving leg count"
        );
        // The pass must still have drawn nothing. If this ever fails, the port
        // grew a draw the oracle does not have and EVERY later pass is shifted.
        assert_eq!(
            rng.draws(),
            want.draws,
            "{head}: draws at the pass-2 boundary — this pass must draw NOTHING"
        );

        assert_eq!(
            digest_legs(&path.legs),
            want.path_legs.expect("pass 2 pins a leg digest"),
            "{head}: leg digest with the same leg COUNT and the same graph — the \
             setbacks diverged (the radius search, the per-junction max, or the \
             short-leg drop), not the draw sequence: this pass draws nothing"
        );
        assert_eq!(
            digest::digest_arcs(&path.arcs),
            want.path_arcs.expect("pass 2 pins an arc digest"),
            "{head}: fillet digest with the LEGS matching — the setbacks are \
             right and the arc construction is not (bisector, R/sin(θ/2), the \
             span's sign, or the authoring ORDER, which is adjacency insertion \
             order and not a hash order)"
        );
        assert_eq!(
            path.arc_half,
            want.path_arc_half
                .expect("pass 2 pins the sweep half-width"),
            "{head}: arcHalf — the carver would sweep the fillets at the wrong \
             width and funnel every junction"
        );

        // The pass's own contract, restated rather than trusted: a circuit that
        // produced no rideable straight is a floor `buildTrackFloor` declines.
        assert!(
            !path.legs.is_empty(),
            "{head}: no legs — the floor is refused"
        );
        for a in &path.arcs {
            assert!(
                a.r >= 1.0 && a.r <= TRACK_RADII[0] + 1e-6,
                "{head}: radius {} outside the authored range",
                a.r
            );
            assert!(
                a.span > 0.0 && a.span.is_finite(),
                "{head}: span {}",
                a.span
            );
        }
    }

    // ── NOTHING IS EXCLUDED HERE ────────────────────────────────────────────
    //
    // All ten corpus floors are bit-exact at this boundary on the first run of
    // the port, which is a fact about pass 1 as much as pass 2: the graph
    // arriving here was already bit-identical on all ten, so `tan` and `atan2`
    // were the only new primitives that could have diverged and neither did.
    // If a future change breaks a subset, pin them BY NAME with an equality
    // assertion (see the note at the end of pass 1) — a list that only fails
    // when it GROWS stops telling you when the gap closes.
}

/// Pass 3 of 23 — `carve-track`. The first pass that writes a tile.
///
/// Passes 1 and 2 produced a graph and rideable geometry without touching the
/// grid; this one burns the circuit into it and creates the [`TrackMask`] every
/// later pass reads. Four of the seven digested arrays are born or move here.
///
/// ⚠️ **GREEN HERE MEANS STRUCTURE, NOT ARITHMETIC.** Measured with ten
/// sabotages rather than assumed — the full table is in `maze::track_carve`'s
/// header. Wrong step size, missing legs, wrong sweep width: caught, 10/10
/// floors. Swapping `js_hypot` for `libm::hypot`, or `js_cos`/`js_sin` for
/// `libm`'s: **not caught at all**. Everything this pass does is a threshold
/// (`d > r`) or a rounded step count, and a last-bit difference almost never
/// flips one, so the primitive guarantees for pass 3 live in
/// `tests/jsmath_oracle.rs` and nowhere else. Ten green floors here would still
/// be ten green floors with the wrong trig library compiled in.
///
/// Two more things this boundary cannot tell you:
///
/// · `carveTrack` draws no rng, so the draw count matches by construction and
///   the usual "different count = wrong draw sequence" localiser is silent.
/// · `lane` and `t` digest IDENTICALLY on every corpus floor (`T_FLOOR` is 1, a
///   lane mark is 1, and at this boundary the two arrays hold the same bytes).
///   A port that returned the tile array as the mask would pass both. `dist`
///   and `sealed` are what separate them, and `assert_boundary` compares all
///   four.
#[test]
fn pass3_carve_track_replays_the_oracle() {
    let c: Corpus = serde_json::from_str(&fixture("maze-pass-digests.json")).unwrap();
    let mut moved: Vec<String> = Vec::new();
    for f in &c.floors {
        let head = format!("L{} seed {}", f.level, f.run_seed);
        let (mut g, rng, _graph, path) = prefix_through_path(f);

        let want = &f.passes[2];
        assert_eq!(want.pass, "carve-track", "{head}: fixture pass 3 moved");

        let mask = carve_track(&mut g, &path);

        // Collected rather than asserted in place, for the reason pass 1 spells
        // out: HOW MANY floors moved is itself the diagnosis. One of ten is a
        // value landing on a rounding boundary; ten of ten is the algorithm.
        if let Err(e) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            assert_boundary(&head, want, &g, Some(&mask), rng.draws());
        })) {
            moved.push(format!("  {}", panic_message(&e)));
        }
    }

    // ── NOTHING IS EXCLUDED HERE ────────────────────────────────────────────
    //
    // If a future change breaks a subset, pin them BY NAME with an equality
    // assertion (see the note at the end of pass 1): a list that only fails
    // when it GROWS stops telling you when the gap closes.
    assert!(
        moved.is_empty(),
        "{} of {} floors diverged at the carve-track boundary:\n{}",
        moved.len(),
        c.floors.len(),
        moved.join("\n")
    );
}

/// Pull the message out of a caught panic so a collected failure reads like the
/// assertion that produced it rather than like "a floor failed".
fn panic_message(e: &Box<dyn std::any::Any + Send>) -> String {
    e.downcast_ref::<String>()
        .cloned()
        .or_else(|| e.downcast_ref::<&str>().map(|s| (*s).to_string()))
        .unwrap_or_else(|| "<non-string panic>".into())
}
