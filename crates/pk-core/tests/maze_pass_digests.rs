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

use pk_core::maze::archetypes::{
    archetype_for, level_cells, track_node_counts, windiness_for, NodeLayout, SurfaceMix,
};
use pk_core::maze::archetypes::{ARCHETYPES, DEFAULT_RULE_WEIGHTS, DEFAULT_TRACK_PROFILE};
use pk_core::maze::modifiers::{
    roll_modifier, ModifierId, MODIFIER_CHANCE, MODIFIER_FROM_LEVEL, MODIFIER_POOL,
};
use pk_core::maze::track_grow::{
    circuit_rank, digest_edges, digest_nodes, grow_track, GrowTrackOpts,
};
use pk_core::maze::{digest, floor_rng, floor_seed, PASS_ORDER};
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
    arcs: u32,
    lane: Option<u32>,
    walkable: u32,
    arc_tiles: u32,
    /// The circuit, on the two passes that own it. Null everywhere else.
    graph_nodes: Option<u32>,
    graph_edges: Option<u32>,
    extra: serde_json::Value,
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
    let mut diverged: Vec<(i32, u32, bool)> = Vec::new();
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

        // ── THE ONE GAP, NAMED ──────────────────────────────────────────────
        //
        // The `hub` layout is the only one that calls `Math.cos`/`Math.sin` on
        // an arbitrary angle, and V8's trig is a THIRD implementation: neither
        // Rust's `libm` nor the platform's. Measured, `cos(0.1)` is
        // 0x3fefd712f9a817c0 in the runtime and ...c1 in both Rust candidates.
        // One node of L3's 44 lands one ulp away because of it.
        //
        // Blocked on `jsmath::js_cos`/`js_sin` (fdlibm kernels + reduction) —
        // see the Incidents page. Until then these floors are checked for
        // everything that IS settled, and the divergence is pinned NEGATIVELY:
        // when the twin lands, this assertion fails and the branch gets deleted.
        // A skipped floor would have gone on passing silently forever.
        let nodes_ok =
            digest_nodes(&graph.nodes) == want.graph_nodes.expect("pass 1 pins a node digest");
        let edges_ok =
            digest_edges(&graph.edges) == want.graph_edges.expect("pass 1 pins an edge digest");
        if !(nodes_ok && edges_ok) {
            diverged.push((f.level, f.run_seed, nodes_ok));
            continue;
        }

        // The pass's own contract, restated as an assertion rather than trusted:
        // a connected loopy core with no dangling spurs.
        assert!(
            circuit_rank(&graph) >= i64::from(p.min_loops),
            "{head}: circuit rank below the profile's floor"
        );
    }

    // ── THE ONE GAP, NAMED FLOOR BY FLOOR ───────────────────────────────────
    //
    // V8's trig is a THIRD implementation: neither Rust's `libm` nor the
    // platform's. Measured, `cos(0.1)` is 0x3fefd712f9a817c0 in the runtime and
    // ...c1 in BOTH Rust candidates — they agree with each other and not with
    // the oracle. `layout_nodes`' hub branch is the only place a maze angle is
    // arbitrary, and one node of L3's 44 lands an ulp away because of it.
    //
    // Listed floor by floor rather than by layout, because the difference only
    // bites where it crosses a rounding boundary: L8 and L13 are hub floors too
    // and they come out bit-exact. Listing the LAYOUT would have excused them
    // as well and quietly stopped testing three floors that already pass.
    //
    // Blocked on `jsmath::js_cos`/`js_sin` (fdlibm kernels — V8 keeps the
    // original Sun evaluation order where musl and glibc both took FreeBSD's
    // rewrite). When they land, this set empties and the assertion below is
    // what says so.
    // TWO floors of ten. The other three hub floors (L8 s1, L13… no — L8 s1,
    // L3 s424242, L8 s424242) come out bit-exact, which is the measurement that
    // made "list the layout" the wrong shape for this exclusion.
    let expected: &[(i32, u32)] = &[(3, 1), (13, 1)];
    let actual: Vec<(i32, u32)> = diverged.iter().map(|&(l, s, _)| (l, s)).collect();
    assert_eq!(
        actual, expected,
        "the set of trig-blocked floors changed. Shrunk? js_cos/js_sin landed — \
         delete the entries. Grown? a NEW divergence, and it is not this one. \
         (nodes_ok per floor: {diverged:?})"
    );
}
