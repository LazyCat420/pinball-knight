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
//! Passes 1–4 of 23 replay, all ten floors bit-exact. The other nineteen are
//! not ported, so most of this fixture is still unread.
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
//! Each newly ported pass gains a replay test. They all drive the SAME
//! `build_track_floor` (see `replay_through`) rather than reassembling the
//! pipeline: the passes share one rng stream and one grid, so there is no
//! starting in the middle, and a hand-copied prefix is a second pipeline free
//! to drift from the one the port ships.
//!
//! ⚠️ **A green replay proves what its boundary can see, which is less than it
//! looks.** Sabotage-measured per pass, and for `carve-track` six of ten
//! injected defects survived — including compiling in the wrong trig library.
//! The per-pass headers carry those tables; read the one for the pass you are
//! about to trust.

use pk_core::grid::{idx, is_walkable, Grid, T_CRACKED};
use pk_core::maze::archetypes::{
    archetype_for, level_cells, track_node_counts, windiness_for, NodeLayout, SurfaceMix,
};
use pk_core::maze::archetypes::{ARCHETYPES, DEFAULT_RULE_WEIGHTS, DEFAULT_TRACK_PROFILE};
use pk_core::maze::doorways::{
    clearance_field, doorway_footprint, label_sections, plan_doorways, resolve_doorway,
    section_territory, try_candidate, CarveGuards, PlanOpts,
};
use pk_core::maze::floor_spec::derive_floor_spec;
use pk_core::maze::modifiers::{
    roll_modifier, ModifierId, MODIFIER_CHANCE, MODIFIER_FROM_LEVEL, MODIFIER_POOL,
};
use pk_core::maze::track_floor::{build_track_floor, BuildTrackFloorOpts, PASSES_LANDED};
use pk_core::maze::track_grow::{circuit_rank, digest_edges, digest_nodes, TrackGraph};
use pk_core::maze::track_path::{digest_legs, TrackPath, TRACK_RADII};
use pk_core::maze::{
    digest, floor_rng, floor_seed, record, CountingRng, Extra, PassRecord, PassSnapshot, TrackMask,
    PASS_ORDER,
};
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
    /// The doorway plan, on the ONE pass that owns it. Null elsewhere.
    ///
    /// Unlike the graph and path digests above, this one IS carried by
    /// `PassRecord` — the pipeline hands the plan across the probe seam, so the
    /// comparison needs no second `build_track_floor` call.
    plan_sites: Option<u32>,
    extra: serde_json::Value,
}

/// The two pre-track draws `authorFloor` makes, and the `density` the second
/// one produces.
///
/// ⚠️ `windiness` is NOT discarded. `spawn/floor-authoring.ts:159` passes
/// `density: Math.max(0.35, Math.min(0.85, windiness))` into `buildTrackFloor`,
/// where it sets how often the growing-tree picks newest-first rather than at
/// random — which changes how many draws each iteration spends. Treating the
/// draw as bookkeeping and letting `growMazeAround`'s own `?? 0.62` default
/// apply cost 548 extra draws on L1 s1 with the walkable count only 2 tiles out:
/// a floor that looks almost right and shares no random stream with the oracle.
///
/// The fixture pins `density` per floor, so the derivation is asserted rather
/// than trusted.
///
/// ⚠️ THE DERIVATION MOVED, and this now calls it rather than repeating it.
/// `maze::floor_spec::derive_floor_spec` is the same three lines, and it had to
/// stop being two copies the moment the SHELL needed them: `--real-floor` boots
/// from a level and a run seed with no fixture to read `cellsW`/`density` out
/// of, so a second copy here would let the parity harness keep replaying the
/// oracle while the game quietly built a different floor. The assertion below is
/// unchanged and is what makes the shared derivation safe — it is checked
/// against the ORACLE's `density`, not against a second implementation.
fn pre_track_draws(f: &Floor) -> (CountingRng, f64) {
    let spec = derive_floor_spec(f.level, f.run_seed);
    assert_eq!(
        spec.density, f.density,
        "L{} seed {}: density derived from windiness disagrees with the oracle's",
        f.level, f.run_seed
    );
    assert_eq!(
        (spec.cells_w, spec.cells_h),
        (f.cells_w, f.cells_h),
        "L{} seed {}: the spec asks for a different grid than the oracle built",
        f.level,
        f.run_seed
    );
    (spec.rng, spec.density)
}

/// Run a corpus floor through the SHIPPING pipeline and hand back the two
/// products a [`PassRecord`] cannot carry.
///
/// The graph and path digests (`graphNodes`, `graphEdges`, `pathLegs`,
/// `pathArcs`, `pathArcHalf`) live in the fixture but not in `record()`, because
/// they are pass-local products rather than grid state. So passes 1 and 2 need
/// the objects themselves — and they must come from the same `build_track_floor`
/// call everything else is checked against, not from a hand-assembled copy of
/// the pipeline sitting in a test file.
fn run_floor(f: &Floor) -> (TrackGraph, TrackPath) {
    let arch = archetype_for(f.level);
    let (mut rng, density) = pre_track_draws(f);
    let floor = build_track_floor(
        f.cells_w,
        f.cells_h,
        &mut rng,
        &BuildTrackFloorOpts {
            profile: Some(&arch.track),
            density: Some(density),
            ..Default::default()
        },
        None,
    )
    .unwrap_or_else(|| {
        panic!(
            "L{} seed {}: the pipeline declined a corpus floor",
            f.level, f.run_seed
        )
    });
    (floor.graph, floor.path)
}

/// Every digest and count a boundary pins, compared in ONE place.
///
/// Both sides are a [`PassRecord`]: the Rust one from `maze::record` on the live
/// pipeline's own probe, the oracle's from the fixture. Comparing records rather
/// than re-deriving digests in the test matters — a test that computed its own
/// would be certifying an encoder the pipeline never calls, which is the same
/// mistake `digest_matches_its_pinned_vectors` exists to prevent one level down.
///
/// Field by field rather than one `assert_eq!` on the whole struct: a
/// twenty-field diff tells you nothing, and each field here has its own
/// diagnosis.
///
/// The ORDER is deliberate. Counts first, because "we carved half the circuit"
/// is a different bug from "the circuit is one tile off" and a digest cannot
/// tell them apart. Draws second, because that is what splits "wrong draw
/// sequence" from "right stream, wrong arithmetic". Digests last.
fn assert_record(head: &str, want: &Pass, got: &PassRecord) {
    assert_eq!(got.walkable, want.walkable, "{head}: walkable tile count");
    assert_eq!(got.shaped, want.shaped, "{head}: shaped tile count");
    assert_eq!(got.arc_tiles, want.arc_tiles, "{head}: arc tile count");
    assert_eq!(got.lane_tiles, want.lane_tiles, "{head}: lane tile count");
    assert_eq!(
        got.sealed_tiles, want.sealed_tiles,
        "{head}: sealed tile count"
    );

    assert_eq!(got.draws, want.draws, "{head}: cumulative rng draws");

    assert_eq!(got.t, want.t, "{head}: tile digest");
    assert_eq!(got.shapes, want.shapes, "{head}: shape digest");
    assert_eq!(got.arcs, want.arcs, "{head}: arc feature digest");
    assert_eq!(got.arc_idx, want.arc_idx, "{head}: arcIdx digest");
    assert_eq!(got.lane, want.lane, "{head}: mask.lane digest");
    assert_eq!(got.sealed, want.sealed, "{head}: mask.sealed digest");
    // `dist` is the one array the tile grid cannot fake: on these floors `lane`
    // and `t` hold the same bytes and digest identically, so a port that
    // returned the tile array as the mask would satisfy both of those.
    assert_eq!(got.dist, want.dist, "{head}: mask.dist digest");
    // ⚠️ The ONLY thing at `plan-doorways` that is not `repair-1`'s output
    // repeated. Every digest above and every count below is byte-identical
    // across that boundary on all ten corpus floors, so without this line the
    // pass is pinned by the two integers in `extra` alone. See
    // `pk_core::maze::digest::digest_sites`.
    assert_eq!(
        got.plan_sites, want.plan_sites,
        "{head}: doorway plan digest (position, axis and wanted width, in plan order)"
    );

    // The pass's own scalars, compared POSITIONALLY against the JSON object the
    // TS wrote — not sorted, not looked up by key. The exporter writes them in
    // the order the pass reports them, and an order change is a change.
    let obj = want
        .extra
        .as_object()
        .unwrap_or_else(|| panic!("{head}: fixture extra is not an object"));
    assert_eq!(
        got.extra.len(),
        obj.len(),
        "{head}: extra has {} keys, oracle has {}",
        got.extra.len(),
        obj.len()
    );
    for (n, (key, val)) in got.extra.iter().enumerate() {
        let (want_key, want_val) = obj.iter().nth(n).unwrap();
        assert_eq!(key, want_key, "{head}: extra key {n}");
        let ok = match val {
            Extra::Int(v) => want_val.as_i64() == Some(*v),
            Extra::Ints(v) => want_val.as_array().is_some_and(|a| {
                a.iter()
                    .map(serde_json::Value::as_i64)
                    .eq(v.iter().map(|x| Some(*x)))
            }),
            Extra::Strs(v) => want_val.as_array().is_some_and(|a| {
                a.iter()
                    .map(serde_json::Value::as_str)
                    .eq(v.iter().map(|x| Some(x.as_str())))
            }),
            Extra::Null => want_val.is_null(),
        };
        assert!(ok, "{head}: extra {key} — rust {val:?}, oracle {want_val}");
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
        //
        // ⚠️ HAND-WRITTEN ON PURPOSE, and it is the only place left that is.
        // `pre_track_draws` now calls `derive_floor_spec`, which the SHELL also
        // calls — so without these five lines the harness and the game would
        // share one derivation with nothing standing beside it. This is the
        // second opinion: the primitives, in order, spelled out. The final
        // assertion compares the two paths directly, which turns "both agree
        // with the oracle" into "and they agree with each other".
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
        let spec = derive_floor_spec(f.level, f.run_seed);
        assert_eq!(
            (spec.rng.draws(), spec.density, spec.floor_seed),
            (rng.draws(), windiness.clamp(0.35, 0.85), f.floor_seed),
            "{head}: derive_floor_spec and the hand-written stream disagree — the shell and \
             this harness would build different floors from the same seed"
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

        // ONE pipeline. `replay_through` already compares every digest and count
        // this boundary pins, so what remains here is the two things a
        // `PassRecord` does not carry — the graph digests — plus the pass's own
        // structural contract. Re-running the generator by hand instead would be
        // a second pipeline free to drift from the one the port ships.
        let (graph, _path) = run_floor(f);
        let want = &f.passes[0];
        assert_eq!(want.pass, "grow-track", "{head}: fixture pass 1 moved");

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

        // ONE pipeline — see the note in pass 1. What is left here is the three
        // path digests, which a `PassRecord` does not carry and which are the
        // entire reason this boundary gates at all.
        let (_graph, path) = run_floor(f);
        let want = &f.passes[1];
        assert_eq!(want.pass, "track-path", "{head}: fixture pass 2 moved");

        // "this pass draws nothing" is NOT asserted here. It used to be, against
        // the live rng — but with one pipeline the live count reaches this file
        // only through `replay_through(1)`, which compares it to the fixture like
        // every other field. Restating it here would mean comparing the fixture's
        // pass-1 draws to its pass-2 draws, which is true of the ORACLE whatever
        // the port does: a check that passes in both states is not a check.

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
    replay_through(2);
}

/// Pass 4 of 23 — `plaza`. The Great Hall's one vast chamber.
///
/// ⚠️ **HALF THE CORPUS CANNOT SEE THIS PASS.** Five of the ten floors have
/// `plazaFrac == 0` and the boundary is byte-identical to pass 3's on them — a
/// port that skipped the pass entirely would be green on those five. The five
/// that do carve one are L3 s1, L8 s1, L13 s1, L3 s424242 and L8 s424242, all
/// Great Halls, and they are the whole gate.
///
/// And `relaxed` is `[]` on all ten: the first radius always fitted, so the
/// step-down loop — the part the legacy comment spends twenty lines justifying
/// — is **never exercised by the corpus**. Its `r -= 1` countdown over
/// non-integral radii is unverified by anything here.
#[test]
fn pass4_plaza_replays_the_oracle() {
    replay_through(3);
}

/// Pass 5 of 23 — `launch-chute`. The plunger lane, and the first pass since
/// `grow-track` that DRAWS.
///
/// That makes the draw count a live localiser again after three passes of
/// silence: it is exactly one draw, the pick out of the candidate pool, so a
/// mismatch means the pool came out a different size or the floor took a
/// different branch — not that the carve is wrong.
///
/// The `extra` is the base and mouth coordinates, so a divergence names the
/// chosen SITE before any digest is consulted. L3 s1 fits no chute and pins
/// `null`, so the "a floor can legitimately have no plunger lane" branch is
/// covered rather than assumed.
///
/// ⚠️ Sabotage-measured, and five of eleven defects survived — four of them
/// TIE-BREAKS (both sort stabilities, the `CARDINALS` order, the scan order),
/// because no two sites in this corpus score exactly equal. The fifth is a
/// coverage hole with a number on it: the corpus's `perimeter_bias` values are
/// 0.9/0.85/0.8/0.7/0.15, so the `>= 0.5` compliance threshold sits in an empty
/// gap and which side `0.5` falls on is untested. Full table in
/// `maze::track_launch`'s header.
#[test]
fn pass5_launch_chute_replays_the_oracle() {
    replay_through(4);
}

/// Pass 6 of 23 — `grow-maze`. Where the floor's rng budget actually goes.
///
/// Three draw sources interleave into one stream here: the growing-tree pick,
/// the direction shuffle, and the per-wall on-ramp roll — and then
/// `widen_maze_corridors` adds a fourth. So the draw count is a strong
/// localiser at this boundary in a way it has not been since pass 1: it is in
/// the thousands, and it is the FIRST field `assert_record` compares after the
/// counts.
///
/// ⚠️ The shuffle is `[...dirs].sort(() => rng() - 0.5)`, the classic broken
/// shuffle, and here it is the oracle rather than a bug: every comparator call
/// spends a draw, and V8 makes FOUR or FIVE of them for a 4-element array
/// depending on the results. `crate::jssort` reproduces V8's binary insertion
/// sort trace-for-trace; anything else desynchronises the stream on most calls.
#[test]
fn pass6_grow_maze_replays_the_oracle() {
    replay_through(5);
}

/// Pass 7 of 23 — `endpoints-early`. Where the floor opens and where it lets you
/// out, picked provisionally so the repair passes know what not to fill in.
///
/// ⚠️ **THIS PASS MUTATES NOTHING.** All seven digests and all six counts are
/// byte-identical to `grow-maze`'s, and it draws no rng, so `extra` — the two
/// tile coordinates — is the ENTIRE gate. That is the shape the harness memo
/// warns about, with one difference that makes it acceptable: those two
/// coordinates are the pass's whole output, not a summary of it (compare pass
/// 2's original `legs` count, which was a summary and gated nothing).
///
/// What the corpus does NOT cover, measured rather than assumed:
///  · `relaxed` is `[]` on 10/10 floors — the sight-line relaxation ladder
///    (`0.8`/`0.65`/`0.5` re-bands, and the `score = -euclid` branch behind it)
///    is never taken here. It is not dead code in the game: it is reached at
///    `endpoints-final` on a post-curve grid.
///  · `start_band` runs on 1/10 floors (L3 s1, the only corpus floor with no
///    chute). The other nine take `chute.base` and never score a perimeter.
///  · `stairs_in` is `None` on all ten — the King's Hall preference arrives at
///    pass 14.
#[test]
fn pass7_endpoints_early_replays_the_oracle() {
    replay_through(6);
}

/// Pass 8 of 23 — `repair-1`. Uncarve, reconnect, de-stub, demote.
///
/// The first pass since `carve-track` whose boundary is a strong one on the
/// digests alone: `t` moves (uncarve fills floor→wall, de-stub opens wall→floor)
/// and `lane` moves (terminations demoted), on all ten floors. It also draws
/// nothing — `connect_all` takes an rng in the TS and never calls it — so the
/// draw count is once again inert here, and the gate is `t` + `lane` + the
/// walkable/lane counts.
///
/// The four passes run in the ONE order that is safe: uncarve can disconnect, so
/// it must precede the connectivity guarantee; de-stub must follow both because
/// each manufactures nubs the other cannot see; heal runs last with `reach = 0`,
/// which makes every termination a DEMOTION and leaves the `joined` branch
/// unreachable from `PASS_ORDER` (unit-tested in `maze::track_socket` instead).
#[test]
fn pass8_repair_1_replays_the_oracle() {
    replay_through(7);
}

/// THE THREE FACTS THAT EXPLAIN WHY `repair-1`'s SABOTAGE SWEEP LEAKED.
///
/// Sixteen of twenty-six injected defects survived both boundaries (table in
/// `maze::track_floor`'s header). Three of the survivors are not corpus luck —
/// they are structural, and this test pins the structure so that the day it
/// stops holding, the explanation fails LOUDLY instead of the sabotage quietly
/// becoming catchable:
///
/// 1. **The floor is already ONE walkable component when `repair-1` starts**, so
///    `connect_all` carves nothing (measured: 0 tiles on 10/10 floors). Two
///    sabotages ride on that — moving `connect_all` after the de-stub, and not
///    passing it the `repair_keep_out` mask (36-92 marked tiles per floor, every
///    one unconsulted). Both are still real defects at `repair-2`, where the
///    curve passes have filled corner pockets floor→wall and CAN disconnect.
///
/// 2. **`uncarve_dead_ends` can never disconnect anything anyway** — it only
///    fills tiles with ≤1 open 4-neighbour, and removing a leaf from a
///    4-connected component leaves it connected. So the legacy comment's
///    ordering rationale ("uncarve first, which is fine only because connectAll
///    runs after it") is a true statement about the wrong pass.
///
/// 3. **Both endpoints are LANE tiles, and `uncarve_dead_ends` already refuses
///    every lane tile**, which makes the `protected_tiles` argument redundant on
///    this call path — hence "endpoints not protected" surviving. It stops being
///    redundant at `endpoints-final`, where the stairs tile is later stamped
///    `T_STAIRS` and the boss chamber is carved around it.
///
/// Also asserted: zero `T_CRACKED` tiles exist yet (secret walls are authored in
/// `decorate.ts`), which is why dropping the de-stub's cracked-wall exemption
/// changed nothing.
#[test]
fn repair_1_stands_on_a_floor_that_is_already_connected() {
    let c: Corpus = serde_json::from_str(&fixture("maze-pass-digests.json")).unwrap();
    for f in &c.floors {
        let head = format!("L{} seed {}", f.level, f.run_seed);
        let arch = archetype_for(f.level);
        let (mut rng, density) = pre_track_draws(f);

        // Captured at the `grow-maze` boundary — the grid `repair-1` inherits.
        let mut components = usize::MAX;
        let mut cracked = usize::MAX;
        let mut probe = |snap: PassSnapshot<'_>| {
            if snap.pass == "grow-maze" {
                components = walkable_components(snap.grid);
                cracked = snap.grid.t.iter().filter(|&&t| t == T_CRACKED).count();
            }
        };
        let floor = build_track_floor(
            f.cells_w,
            f.cells_h,
            &mut rng,
            &BuildTrackFloorOpts {
                profile: Some(&arch.track),
                density: Some(density),
                ..Default::default()
            },
            Some(&mut probe),
        )
        .unwrap_or_else(|| panic!("{head}: the pipeline declined a corpus floor"));

        assert_eq!(
            components, 1,
            "{head}: `grow-maze` handed `repair-1` {components} components — \
             `connect_all` is load-bearing here after all, and the two sabotages \
             that survived because it is inert have to be re-run"
        );
        assert_eq!(cracked, 0, "{head}: a cracked wall exists before decorate");

        let ends = floor.ends.expect("a corpus floor has endpoints");
        let g = &floor.grid;
        for (what, p) in [("start", ends.start), ("stairs", ends.stairs)] {
            assert_eq!(
                floor.mask.lane[idx(g, p.i, p.j)],
                1,
                "{head}: {what} is not a lane tile, so the uncarve's protection \
                 list stops being redundant and needs its own gate"
            );
        }
    }
}

/// Pass 9 of 23 — `plan-doorways`. Label the sections, partition the corridor
/// space between them, and site one opening per boundary component.
///
/// ⚠️ THE WEAKEST BOUNDARY IN THE PIPELINE, and the port had to strengthen it
/// before it could be believed. This pass MUTATES NOTHING — every function it
/// calls is read-only — so all seven grid/mask digests, all six counts and the
/// cumulative draw count are byte-identical to `repair-1`'s on 10/10 floors.
/// What the fixture originally pinned about pass 9's own output was
/// `{ sites: N, guard: M }`: two integers standing in for 9-26 structured
/// records. A port with the wrong per-site axis, or the right sites in the wrong
/// order, matched it exactly.
///
/// It would then diverge at pass 11, where `on_doorway` steers
/// `stamp_orbit_island` and that pass DRAWS — so the draw counter, the localiser
/// every other pass leans on, would have reported the wrong pass two boundaries
/// late.
///
/// So `planSites` was added to the exporter (`digest_sites`: `i, j, ai, aj, wi,
/// wj, want, a, b` per site, in plan order, length-folded). Same move, same
/// reason, as `digestLegs` at pass 2 — and re-exporting left every other record
/// on every other pass byte-identical, which is itself the check that the fold
/// was added and nothing else moved.
#[test]
fn pass9_plan_doorways_replays_the_oracle() {
    replay_through(8);
}

#[test]
fn pass10_publish_arcs_replays_the_oracle() {
    replay_through(9);
}

#[test]
fn pass11_orbit_island_replays_the_oracle() {
    replay_through(10);
}

#[test]
fn pass12_arc_sweeps_replays_the_oracle() {
    replay_through(11);
}

#[test]
fn pass13_repair_2_replays_the_oracle() {
    replay_through(12);
}

#[test]
fn pass14_endpoints_final_replays_the_oracle() {
    replay_through(13);
}

#[test]
fn pass15_boss_chamber_replays_the_oracle() {
    replay_through(14);
}

#[test]
fn pass16_artery_banks_replays_the_oracle() {
    replay_through(15);
}

#[test]
fn pass17_reseal_chute_replays_the_oracle() {
    replay_through(16);
}

#[test]
fn pass18_carve_doorways_replays_the_oracle() {
    replay_through(17);
}

#[test]
fn pass19_funnels_relays_replays_the_oracle() {
    replay_through(18);
}

#[test]
fn pass20_compact_fixed_point_replays_the_oracle() {
    replay_through(19);
}

#[test]
fn pass21_stairs_replays_the_oracle() {
    replay_through(20);
}

#[test]
fn pass22_arc_rails_replays_the_oracle() {
    replay_through(21);
}

#[test]
fn pass23_done_replays_the_oracle() {
    replay_through(22);
}

/// The companion to pass 9's replay: the pass is inert on the grid, ASSERTED.
///
/// `plan-doorways` earns its place by what it decides, not by what it writes,
/// and the whole port rests on that: `plan_doorways`, `resolve_doorway` and
/// `doorway_footprint` take `&Grid`, so the type system already forbids a write.
/// What it does NOT forbid is the pass being wired to something that writes —
/// carving the plan here instead of at pass 18 is the exact mistake the split
/// exists to prevent, and it would show up as a *better*-looking floor.
///
/// So: every digest and every count at boundary 9 must equal boundary 8's. If
/// this fails and the replay still passes, someone has re-exported the fixture
/// with the carve moved forward.
#[test]
fn plan_doorways_changes_nothing_on_the_grid() {
    let c: Corpus = serde_json::from_str(&fixture("maze-pass-digests.json")).unwrap();
    for f in &c.floors {
        let head = format!("L{} seed {}", f.level, f.run_seed);
        let arch = archetype_for(f.level);
        let (mut rng, density) = pre_track_draws(f);

        let mut seen: Vec<PassRecord> = Vec::new();
        let mut probe = |snap: PassSnapshot<'_>| seen.push(record(&snap));
        build_track_floor(
            f.cells_w,
            f.cells_h,
            &mut rng,
            &BuildTrackFloorOpts {
                profile: Some(&arch.track),
                density: Some(density),
                ..Default::default()
            },
            Some(&mut probe),
        )
        .unwrap_or_else(|| panic!("{head}: the pipeline declined a corpus floor"));

        let before = &seen[7];
        let after = &seen[8];
        assert_eq!(before.pass, "repair-1", "{head}: boundary 8 moved");
        assert_eq!(after.pass, "plan-doorways", "{head}: boundary 9 moved");

        for (what, a, b) in [
            ("tiles", before.t, after.t),
            ("shapes", before.shapes, after.shapes),
            ("arcs", before.arcs, after.arcs),
        ] {
            assert_eq!(a, b, "{head}: `plan-doorways` moved the {what} digest");
        }
        for (what, a, b) in [
            ("arcIdx", before.arc_idx, after.arc_idx),
            ("mask.lane", before.lane, after.lane),
            ("mask.sealed", before.sealed, after.sealed),
            ("mask.dist", before.dist, after.dist),
        ] {
            assert_eq!(a, b, "{head}: `plan-doorways` moved the {what} digest");
        }
        for (what, a, b) in [
            ("walkable", before.walkable, after.walkable),
            ("shaped", before.shaped, after.shaped),
            ("arc tile", before.arc_tiles, after.arc_tiles),
            ("lane tile", before.lane_tiles, after.lane_tiles),
            ("sealed tile", before.sealed_tiles, after.sealed_tiles),
        ] {
            assert_eq!(a, b, "{head}: `plan-doorways` moved the {what} count");
        }
        assert_eq!(
            before.draws, after.draws,
            "{head}: `plan-doorways` drew from the rng — the module takes no rng \
             and must not acquire one"
        );
        assert!(
            before.plan_sites.is_none() && after.plan_sites.is_some(),
            "{head}: the plan digest is not on the pass that owns it"
        );
    }
}

/// PASS 9's SABOTAGE SURVIVORS, WITH A NUMBER ON EACH — the trigger counts.
///
/// 27 defects were injected at this boundary and **18 were caught**, including
/// the positive control (the pass carving its own plan, i.e. pass 18 ten passes
/// early). Nine survived, and they are not one kind of thing. Three are
/// PROVABLY INERT — a sabotage that cannot reproduce a defect proves nothing
/// about the gate — and six are branches the corpus does not reach. This test
/// puts a measured number on the second group so the next person knows whether
/// they are looking at a hole or at a tautology.
///
/// ## Provably inert (no test needed, and none written)
///
/// - **`label_sections` flood FIFO instead of LIFO** — a flood visits the whole
///   connected component whatever order it walks it in, so `label` and `sizes`
///   are identical either way.
/// - **boundary-strip flood FIFO instead of LIFO**, and
/// - **8-connected neighbour order `di`-outer instead of `dj`-outer** — same
///   argument, plus the strip's winner is an ARGMIN under a total order
///   (`c < best_cross || (c == best_cross && k < best_k)`), which is by
///   construction independent of visit order. That is exactly why inverting the
///   tie-break to `k > best_k` WAS caught: it changes the argmin, not the walk.
///
/// ## Six branches the corpus does not reach — counted below
///
/// Each assertion here fails the day a corpus floor starts exercising the
/// branch, which is the point: the number is pinned so it cannot quietly become
/// non-zero and leave the sabotage table stale.
#[test]
fn the_pass_9_survivors_have_a_number_on_them() {
    let c: Corpus = serde_json::from_str(&fixture("maze-pass-digests.json")).unwrap();
    let (mut slides, mut mirrored, mut oob, mut overlaps) = (0, 0, 0, 0);
    let (mut sealed_changes, mut forks, mut border_open) = (0, 0, 0);

    for f in &c.floors {
        let head = format!("L{} seed {}", f.level, f.run_seed);
        let arch = archetype_for(f.level);
        let (mut rng, density) = pre_track_draws(f);

        // The grid and mask `plan-doorways` reads. Cloned out of the probe
        // because everything below re-derives the plan on them.
        let mut snapshot: Option<(Grid, TrackMask)> = None;
        let mut probe = |snap: PassSnapshot<'_>| {
            if snap.pass == "plan-doorways" {
                snapshot = Some((snap.grid.clone(), snap.mask.expect("mask exists").clone()));
            }
        };
        build_track_floor(
            f.cells_w,
            f.cells_h,
            &mut rng,
            &BuildTrackFloorOpts {
                profile: Some(&arch.track),
                density: Some(density),
                ..Default::default()
            },
            Some(&mut probe),
        )
        .unwrap_or_else(|| panic!("{head}: the pipeline declined a corpus floor"));
        let (g, mask) = snapshot.expect("pass 9 emitted");

        let sites = plan_doorways(&g, &PlanOpts::default());
        let guards = CarveGuards {
            mask: Some(&mask),
            span_mask: None,
        };

        // 1. THE SLIDE, and whether its SIGN ORDER can matter. `s = 0` is
        //    tried first, so −1-before-+1 is only observable where a site
        //    resolves at BOTH ±shift for the winning width. Enumerating the
        //    candidate space is what `try_candidate` was split out for.
        // 2. THE JAMB `cut` ALIASING — only live when a footprint leaves the grid.
        // 3. FOOTPRINT OVERLAP — without one, `door_guard`'s dedup is invisible
        //    in `extra.guard`.
        let mut guard = vec![0_u8; (g.w * g.h) as usize];
        for s in &sites {
            let Some(d) = resolve_doorway(&g, s, &guards) else {
                continue;
            };
            let shift = (d.site.i - s.i) * s.wi + (d.site.j - s.j) * s.wj;
            // Independent cross-check of the driver against an explicit
            // enumeration of the candidate space in the oracle's order.
            let mut widths = [7, 5, 3];
            widths.reverse();
            let mut want: Option<pk_core::maze::doorways::Doorway> = None;
            'outer: for w in widths {
                if w < s.want.max(open_run_across(&g, s)) {
                    continue;
                }
                for step in 0..=6_i32 {
                    let sh = if step == 0 {
                        0
                    } else {
                        (if step % 2 == 1 { -1 } else { 1 }) * ((step + 1) / 2)
                    };
                    if let Some(c) = try_candidate(&g, s, &guards, w, sh) {
                        want = Some(c);
                        break 'outer;
                    }
                }
            }
            assert_eq!(
                Some(d),
                want,
                "the `resolve_doorway` driver disagrees with an explicit walk of \
                 the same candidate space"
            );
            if shift != 0 {
                slides += 1;
                if try_candidate(&g, s, &guards, d.w, -shift).is_some() {
                    mirrored += 1;
                }
            }
            for t in doorway_footprint(&d) {
                if t.i < 0 || t.j < 0 || t.i >= g.w || t.j >= g.h {
                    oob += 1;
                }
                let k = idx(&g, t.i, t.j);
                if guard[k] == 1 {
                    overlaps += 1;
                }
                guard[k] = 1;
            }
        }

        // 4. THE SEALED GUARD, measured as a DIFFERENTIAL rather than by
        //    counting tiles near a sealed lane. `near_sealed` being true
        //    somewhere a candidate reads is not the trigger — the trigger is the
        //    guard changing a resolution, and only withholding it can say so.
        let unguarded = CarveGuards {
            mask: None,
            span_mask: None,
        };
        for s in &sites {
            if resolve_doorway(&g, s, &guards) != resolve_doorway(&g, s, &unguarded) {
                sealed_changes += 1;
            }
        }

        // 5. `SIDES` ORDER IN THE BOUNDARY SCAN. The scan `break`s on the FIRST
        //    direction that finds a differently-owned neighbour, so the order
        //    only decides anything where a tile borders two neighbours whose
        //    PAIR KEYS disagree — a fork. Two same-key neighbours are not a fork.
        let cl = clearance_field(&g);
        let sec = label_sections(&g, &cl, None);
        let owner = section_territory(&g, &sec);
        let p = sec.sizes.len() as i32;
        for j in 0..g.h {
            for i in 0..g.w {
                let oa = owner[idx(&g, i, j)];
                if oa < 0 {
                    continue;
                }
                let mut keys = Vec::new();
                for (di, dj) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                    let (x, y) = (i + di, j + dj);
                    if x < 0 || y < 0 || x >= g.w || y >= g.h {
                        continue;
                    }
                    let ob = owner[idx(&g, x, y)];
                    if ob < 0 || ob == oa {
                        continue;
                    }
                    keys.push(if oa < ob { oa * p + ob } else { ob * p + oa });
                }
                if keys.windows(2).any(|w| w[0] != w[1]) {
                    forks += 1;
                }
            }
        }

        // 6. `tile_state`'s BORDER-BEFORE-WALKABLE order — only observable if a
        //    walkable tile ever sits on the outermost ring.
        for i in 0..g.w {
            for j in [0, g.h - 1] {
                if is_walkable(&g, i, j) {
                    border_open += 1;
                }
            }
        }
        for j in 0..g.h {
            for i in [0, g.w - 1] {
                if is_walkable(&g, i, j) {
                    border_open += 1;
                }
            }
        }
    }

    // ── THE NUMBERS, PINNED ──────────────────────────────────────────────────
    //
    // Not "the corpus never reaches this" — three of these branches ARE reached
    // and the sabotage survived anyway, which is a different and more useful
    // fact. Each assertion fails the day the corresponding sabotage starts being
    // meaningful, so the table in `doorways.rs` cannot quietly go stale.

    // THE SLIDE IS REACHED — 57 of the corpus's resolutions sit off their
    // planned centre. So "slide sequence +1 before −1" did NOT survive for want
    // of a slide. It survived because not
    // one of those six resolves at the mirrored shift as well: a slide happens
    // where the unslid placement is blocked, and on this corpus the blockage is
    // always one-sided. An absence of TIES, not an absence of slides — which is
    // the same shape of hole passes 5, 7 and 8 each reported.
    assert_eq!(slides, 57, "the slide census moved");
    assert_eq!(
        mirrored, 0,
        "a doorway now resolves at both +shift and −shift — the slide sequence's \
         sign order decides which centre is recorded and needs its own gate"
    );

    // THE SEALED GUARD IS INERT HERE, measured the only way that means anything:
    // withholding it changes 0 of the resolutions. Tiles near a sealed lane are
    // plentiful (the launch chute seals a lane on nine of ten floors) — they are
    // simply never the tile that decides a candidate. That is the honest reading
    // of "the mask guard is withheld" surviving.
    assert_eq!(
        sealed_changes, 0,
        "the sealed-lane guard now changes a doorway resolution — withholding \
         the mask from `resolve_doorway` must stop surviving the sweep"
    );

    // NEVER REACHED, and each is one line of geometry away from being reached.
    assert_eq!(
        oob, 0,
        "a doorway footprint left the grid — `jambs_survive`'s unchecked `idx` \
         aliasing is now live and the bounds-checked sabotage should bite"
    );
    assert_eq!(
        overlaps, 0,
        "two doorway footprints overlap — `door_guard`'s dedup is now observable \
         in `extra.guard`"
    );
    assert_eq!(
        border_open, 0,
        "the floor's outer ring has a walkable tile — `tile_state`'s \
         border-before-walkable order is now observable"
    );

    // REACHED TWICE, and still not load-bearing: two boundary tiles across ten
    // floors border differently-keyed owners, so `SIDES` order decides which
    // pair they are filed under — but neither is its strip's argmin, so the
    // sited doorway is the same either way. A third fork could easily land on a
    // winner, which is why this is pinned rather than dismissed.
    assert_eq!(
        forks, 2,
        "the count of boundary tiles whose pair key depends on `SIDES` order \
         moved — re-run the `SIDES order reversed` sabotage"
    );
}

/// How many connected components the walkable tiles form. 4-neighbourhood, the
/// same one `connect_all` floods with.
fn walkable_components(g: &Grid) -> usize {
    let n = (g.w * g.h) as usize;
    let w = g.w as usize;
    let mut seen = vec![false; n];
    let mut components = 0;
    for k in 0..n {
        let (i, j) = ((k % w) as i32, (k / w) as i32);
        if seen[k] || !is_walkable(g, i, j) {
            continue;
        }
        components += 1;
        let mut st = vec![k];
        seen[k] = true;
        while let Some(cur) = st.pop() {
            let (ci, cj) = ((cur % w) as i32, (cur / w) as i32);
            for (di, dj) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                let (x, y) = (ci + di, cj + dj);
                if x < 0 || y < 0 || x >= g.w || y >= g.h || !is_walkable(g, x, y) {
                    continue;
                }
                let kk = idx(g, x, y);
                if !seen[kk] {
                    seen[kk] = true;
                    st.push(kk);
                }
            }
        }
    }
    components
}

/// Drive the REAL pipeline to boundary `k` and compare every digest and count
/// the fixture pins there, on all ten floors.
///
/// One function rather than one per pass, because the passes share an rng
/// stream and a grid: a per-pass test would have to rebuild the prefix anyway,
/// and rebuilding it by hand is how a replay drifts into testing a pipeline the
/// oracle never ran. The probe collects every boundary the run emits, so a pass
/// that fires out of order or not at all fails on the NAME before any digest is
/// looked at.
fn replay_through(k: usize) {
    assert!(
        k < PASSES_LANDED,
        "boundary {k} ({}) is not ported yet — PASSES_LANDED is {PASSES_LANDED}",
        PASS_ORDER[k]
    );
    let c: Corpus = serde_json::from_str(&fixture("maze-pass-digests.json")).unwrap();
    let mut moved: Vec<String> = Vec::new();
    for f in &c.floors {
        let head = format!("L{} seed {}", f.level, f.run_seed);
        let arch = archetype_for(f.level);

        let mut seen: Vec<PassRecord> = Vec::new();
        let (mut rng, density) = pre_track_draws(f);

        let mut probe = |snap: PassSnapshot<'_>| seen.push(record(&snap));
        build_track_floor(
            f.cells_w,
            f.cells_h,
            &mut rng,
            &BuildTrackFloorOpts {
                profile: Some(&arch.track),
                density: Some(density),
                ..Default::default()
            },
            Some(&mut probe),
        )
        .unwrap_or_else(|| panic!("{head}: the pipeline declined a corpus floor"));

        let want = &f.passes[k];
        assert!(
            seen.len() > k,
            "{head}: the run emitted {} boundaries, wanted at least {}",
            seen.len(),
            k + 1
        );
        for (n, got) in seen.iter().enumerate() {
            assert_eq!(got.pass, PASS_ORDER[n], "{head}: boundary {n} out of order");
        }
        let got = &seen[k];
        assert_eq!(got.pass, want.pass, "{head}: fixture pass {k} moved");

        // Collected rather than asserted in place, for the reason pass 1 spells
        // out: HOW MANY floors moved is itself the diagnosis. One of ten is a
        // value landing on a rounding boundary; ten of ten is the algorithm.
        if let Err(e) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            assert_record(&head, want, got);
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
        "{} of {} floors diverged at the {} boundary:\n{}",
        moved.len(),
        c.floors.len(),
        PASS_ORDER[k],
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

/// `site_width` by another name — the open run across the passage at the planned
/// centre, which is what raises a doorway to the next vocabulary member up.
fn open_run_across(g: &Grid, s: &pk_core::maze::doorways::DoorwaySite) -> i32 {
    let mut n = if is_walkable(g, s.i, s.j) {
        1
    } else {
        return 0;
    };
    let mut k = 1;
    while is_walkable(g, s.i + s.wi * k, s.j + s.wj * k) {
        n += 1;
        k += 1;
    }
    let mut k = 1;
    while is_walkable(g, s.i - s.wi * k, s.j - s.wj * k) {
        n += 1;
        k += 1;
    }
    n
}
