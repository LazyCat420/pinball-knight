//! THE FLOOR THE SHELL BOOTS, CHECKED WHERE THE TRUTH IS CHEAP TO STATE.
//!
//! `--real-floor` replaces `demo_floor(7)` — a 25×25 pillar arena — with the
//! ported generator's output. That swap moves three separate risks into the
//! game, and this file owns two of them:
//!
//!   1. **The floor is not the oracle's floor.** Covered by
//!      `maze_pass_digests.rs` at every pass boundary. What is NEW here is that
//!      the shell reaches the pipeline by a different route — `derive_floor_spec`
//!      rather than a fixture's pinned `cellsW`/`density` — so the route itself
//!      is compared against the corpus below.
//!   2. **The floor is the oracle's floor and you still cannot stand on it.**
//!      A digest says nothing about whether a body of radius 0.3 fits on the
//!      spawn tile, whether the exit is reachable, or whether the grid the sim
//!      steps is still the grid the renderer drew. Those are this file's job.
//!
//! The third risk — that the wasm build boots, paints and takes input — cannot
//! be answered here at all, and is not pretended to be: it lives in
//! `scripts/pk-check.mjs --real-floor`, in a real browser, replaying the
//! `wallProbe` this file derives.
//!
//! ## Why the fixture is cross-checked before it is trusted
//!
//! `real-floor-l3s1-p9.json` is written by `examples/real_floor_fixture.rs` —
//! the port grading its own homework. Nine of its fields are also in
//! `maze-pass-digests.json`, which came out of the LEGACY TypeScript generator,
//! and `the_fixture_agrees_with_the_legacy_oracle_corpus` compares them first.
//! Re-exporting a regression is therefore not enough to make this suite green.

use pk_core::collide::{circle_collides, move_circle};
use pk_core::flow_field::bfs_distances;
use pk_core::grid::{idx, is_walkable, world_to_tile, Grid};
use pk_core::maze::digest::{digest_grid_state, GridStateDigest};
use pk_core::maze::floor_spec::{
    build_track_floor_from_spec, build_track_floor_from_spec_observed, derive_floor_spec,
    validate_runtime_floor, FloorBuildError, RuntimeFloorInfo,
};
use pk_core::maze::track_floor::{TrackFloor, PASSES_LANDED};
use pk_core::maze::{Extra, PASS_ORDER};
use pk_core::state::{simulate, FrameInput, SimState, PLAYER_R};
use serde::Deserialize;

/// The pinned floor. L3 is a Great Hall (a carved plaza), seed 1 is the one
/// corpus floor with NO launch chute — so the pinned case exercises
/// `pick_track_endpoints`'s `start_band` branch, which the other nine floors
/// never reach.
const LEVEL: i32 = 3;
const SEED: u32 = 1;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RealFloorFixture {
    schema: u32,
    producer: String,
    producer_commit: String,
    pass: String,
    generator_version: usize,
    level: i32,
    run_seed: u32,

    // ── Shared with the legacy oracle corpus ──
    floor_seed: u32,
    cells_w: i32,
    cells_h: i32,
    w: i32,
    h: i32,
    density: f64,
    draws: u64,
    tile_digest: u32,
    walkable_tiles: u32,
    start: [i32; 2],
    provisional_exit: [i32; 2],

    // ── Pinned by this port only ──
    archetype: String,
    modifier: String,
    mask_lane: u32,
    mask_sealed: u32,
    mask_dist: u32,
    plan_sites: i64,
    plan_guard: i64,
    start_world: [f64; 2],
    provisional_exit_world: [f64; 2],
    path_distance: i32,
    first_path_step: [i32; 2],
    grid_state: GridStateJson,
    wall_probe: Option<WallProbeJson>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GridStateJson {
    w: i32,
    h: i32,
    tiles: u32,
    shapes: u32,
    arcs: u32,
    arc_idx: u32,
    surfaces: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WallProbeJson {
    from: [f64; 2],
    input: [i8; 2],
    ticks: u32,
    wall_tile: [i32; 2],
    expected_blocked_axis: String,
    max_allowed_travel: f64,
}

/// The corpus rows this file reads. Deliberately a THIN view of
/// `maze-pass-digests.json` — `maze_pass_digests.rs` owns the full shape, and a
/// second `deny_unknown_fields` mirror of it here would be a schema to keep in
/// sync for no gain.
#[derive(Deserialize)]
struct Corpus {
    floors: Vec<CorpusFloor>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CorpusFloor {
    level: i32,
    run_seed: u32,
    floor_seed: u32,
    cells_w: i32,
    cells_h: i32,
    w: i32,
    h: i32,
    density: f64,
    passes: Vec<CorpusPass>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CorpusPass {
    pass: String,
    draws: u64,
    t: u32,
    lane: Option<u32>,
    sealed: Option<u32>,
    dist: Option<u32>,
    walkable: u32,
    extra: serde_json::Value,
}

fn fixture(name: &str) -> String {
    let path = format!(
        "{}/../../assets/fixtures/{name}",
        env!("CARGO_MANIFEST_DIR")
    );
    std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "fixture {path} missing ({e}) — regenerate with `PK_FIXTURE_COMMIT=$(git rev-parse \
             HEAD) cargo run -p pk-core --example real_floor_fixture -- --level 3 --seed 1 > \
             assets/fixtures/real-floor-l3s1-p9.json`"
        )
    })
}

fn pinned() -> RealFloorFixture {
    serde_json::from_str(&fixture("real-floor-l3s1-p9.json"))
        .expect("the real-floor fixture parses")
}

/// The pinned floor, built and validated through the shipping path.
fn pinned_floor() -> (TrackFloor, RuntimeFloorInfo) {
    let spec = derive_floor_spec(LEVEL, SEED);
    let track = build_track_floor_from_spec(&spec).expect("the pinned floor builds");
    let info = validate_runtime_floor(&track).expect("the pinned floor validates");
    (track, info)
}

/// Walkable components by flood fill — the invariant `repair-1` promises and the
/// thing that decides whether an exit marker is ever reachable.
fn walkable_components(g: &Grid) -> usize {
    let n = (g.w * g.h) as usize;
    let mut seen = vec![false; n];
    let mut components = 0;
    for j in 0..g.h {
        for i in 0..g.w {
            if !is_walkable(g, i, j) || seen[idx(g, i, j)] {
                continue;
            }
            components += 1;
            let mut stack = vec![(i, j)];
            seen[idx(g, i, j)] = true;
            while let Some((ci, cj)) = stack.pop() {
                for (di, dj) in [(0, -1), (0, 1), (-1, 0), (1, 0)] {
                    let (ni, nj) = (ci + di, cj + dj);
                    if !is_walkable(g, ni, nj) || seen[idx(g, ni, nj)] {
                        continue;
                    }
                    seen[idx(g, ni, nj)] = true;
                    stack.push((ni, nj));
                }
            }
        }
    }
    components
}

// ── THE FIXTURE'S OWN PROVENANCE ─────────────────────────────────────────────

/// THE FIRST GATE, AND THE ONE THAT MAKES THE REST WORTH RUNNING.
///
/// Nine fields of `real-floor-l3s1-p9.json` also appear in
/// `maze-pass-digests.json`, exported by
/// `legacy/src/game/pinball-knight/port-maze-fixtures.test.ts` from the
/// TypeScript generator this whole crate is a port of. Comparing them here is
/// what stops the real-floor fixture being a self-portrait: a re-export taken
/// after a regression would move `tileDigest` or `draws` and land here, against
/// a file no Rust program can write.
///
/// `producerCommit` is NOT trusted as evidence of anything — a string in a JSON
/// file is a claim, not a measurement. It is carried for the human who has to
/// find out when a fixture drifted, and asserted only to be non-empty.
#[test]
fn the_fixture_agrees_with_the_legacy_oracle_corpus() {
    let f = pinned();
    assert_eq!(f.schema, 1, "the fixture schema moved");
    assert!(
        f.producer.contains("real_floor_fixture.rs"),
        "producer names something else: {}",
        f.producer
    );
    assert!(!f.producer_commit.is_empty(), "producerCommit is blank");
    assert_eq!(f.level, LEVEL);
    assert_eq!(f.run_seed, SEED);

    // The boundary the fixture was taken at is the last LANDED pass. A pass
    // landing without this fixture being re-exported is a fixture describing a
    // floor the shell no longer builds — and, since passes 10+ mutate the grid,
    // a silently stale `tileDigest`.
    assert_eq!(
        f.generator_version, PASSES_LANDED,
        "the fixture was taken at {} passes and {} have landed — re-export it",
        f.generator_version, PASSES_LANDED
    );
    assert_eq!(
        f.pass,
        PASS_ORDER[PASSES_LANDED - 1],
        "the fixture's boundary is not the last landed pass"
    );

    let c: Corpus = serde_json::from_str(&fixture("maze-pass-digests.json")).unwrap();
    let o = c
        .floors
        .iter()
        .find(|x| x.level == LEVEL && x.run_seed == SEED)
        .expect("L3 seed 1 is in the oracle corpus");
    let p = o
        .passes
        .iter()
        .find(|x| x.pass == f.pass)
        .expect("the corpus pins this pass");

    assert_eq!(f.floor_seed, o.floor_seed, "floorSeed");
    assert_eq!(f.cells_w, o.cells_w, "cellsW");
    assert_eq!(f.cells_h, o.cells_h, "cellsH");
    assert_eq!(f.w, o.w, "w");
    assert_eq!(f.h, o.h, "h");
    assert_eq!(
        f.density, o.density,
        "density (an exact f64 — it is a draw)"
    );
    assert_eq!(f.draws, p.draws, "cumulative draws at the boundary");
    assert_eq!(f.tile_digest, p.t, "tile digest");
    assert_eq!(f.walkable_tiles, p.walkable, "walkable tile count");
    assert_eq!(f.mask_lane, p.lane.expect("the corpus pins mask.lane"));
    assert_eq!(
        f.mask_sealed,
        p.sealed.expect("the corpus pins mask.sealed")
    );
    assert_eq!(f.mask_dist, p.dist.expect("the corpus pins mask.dist"));
    assert_eq!(
        f.plan_sites,
        p.extra["sites"].as_i64().expect("sites"),
        "planned doorway sites"
    );
    assert_eq!(f.plan_guard, p.extra["guard"].as_i64().expect("guard"));

    // The endpoints, against the pass the oracle picked them at. The exit at
    // pass 9 is PROVISIONAL — `endpoints-final` (pass 14) re-picks it, and the
    // corpus's own `result.stairs` for this floor is [18, 35], not [17, 34]. The
    // fixture must match the pass-7 pick, which is what a nine-pass pipeline can
    // actually produce; matching the final one would mean the port had run ahead.
    let ep = o
        .passes
        .iter()
        .find(|x| x.pass == "endpoints-early")
        .expect("the corpus pins endpoints-early");
    let want_start: Vec<i64> = ep.extra["start"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_i64().unwrap())
        .collect();
    let want_exit: Vec<i64> = ep.extra["stairs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_i64().unwrap())
        .collect();
    assert_eq!(
        vec![i64::from(f.start[0]), i64::from(f.start[1])],
        want_start,
        "start tile"
    );
    assert_eq!(
        vec![
            i64::from(f.provisional_exit[0]),
            i64::from(f.provisional_exit[1])
        ],
        want_exit,
        "provisional exit tile"
    );
}

// ── SPEC DERIVATION ──────────────────────────────────────────────────────────

/// The route the SHELL takes to the pipeline, compared against the corpus.
///
/// `maze_pass_digests.rs` reaches `build_track_floor` with `cellsW`/`cellsH`/
/// `density` READ OUT OF THE FIXTURE. The shell has no fixture — it has a level
/// and a run seed. This is the assertion that those two routes arrive at the
/// same place, on every corpus floor and not only the pinned one.
#[test]
fn spec_derivation_matches_the_corpus_on_every_floor() {
    let c: Corpus = serde_json::from_str(&fixture("maze-pass-digests.json")).unwrap();
    assert!(c.floors.len() >= 10, "the corpus was thinned out");
    for o in &c.floors {
        let head = format!("L{} seed {}", o.level, o.run_seed);
        let s = derive_floor_spec(o.level, o.run_seed);
        assert_eq!(s.floor_seed, o.floor_seed, "{head}: floorSeed");
        assert_eq!(
            (s.cells_w, s.cells_h),
            (o.cells_w, o.cells_h),
            "{head}: cells"
        );
        assert_eq!((s.w, s.h), (o.w, o.h), "{head}: grid size");
        assert_eq!(s.density, o.density, "{head}: density");
        // The stream's POSITION, not just its seed — the whole reason the spec
        // carries the rng rather than the recipe.
        let before = o
            .passes
            .first()
            .map(|_| ())
            .map(|_| s.rng.draws())
            .unwrap_or_default();
        assert!(
            before <= o.passes[0].draws,
            "{head}: the spec's stream is already past the first boundary"
        );
    }
}

// ── THE FLOOR ITSELF ─────────────────────────────────────────────────────────

/// Build and validate the pinned floor, and compare EVERY field the fixture
/// carries. Field by field rather than one struct compare: a twelve-field diff
/// names nothing, and each of these has its own diagnosis.
#[test]
fn the_pinned_floor_builds_and_validates_bit_exact() {
    let f = pinned();
    let spec = derive_floor_spec(LEVEL, SEED);
    assert_eq!(spec.cells_w, f.cells_w);
    assert_eq!(spec.cells_h, f.cells_h);
    assert_eq!(spec.archetype.id.as_str(), f.archetype, "archetype");
    assert_eq!(format!("{:?}", spec.modifier), f.modifier, "modifier");

    // Through the OBSERVED path so the boundary's draw count is compared too —
    // the localiser that splits "wrong arithmetic" from "wrong draw sequence".
    let mut draws = 0_u64;
    let mut sites = 0_i64;
    let mut probe = |s: pk_core::maze::PassSnapshot<'_>| {
        if s.pass != f.pass {
            return;
        }
        draws = s.draws;
        for (k, v) in &s.extra {
            if let (&"sites", Extra::Int(n)) = (k, v) {
                sites = *n;
            }
        }
    };
    let track = build_track_floor_from_spec_observed(&spec, Some(&mut probe))
        .expect("the pinned floor builds");
    assert_eq!(draws, f.draws, "cumulative draws at {}", f.pass);
    assert_eq!(sites, f.plan_sites, "planned doorway sites");

    let gs = digest_grid_state(&track.grid);
    assert_eq!(
        gs,
        GridStateDigest {
            w: f.grid_state.w,
            h: f.grid_state.h,
            tiles: f.grid_state.tiles,
            shapes: f.grid_state.shapes,
            arcs: f.grid_state.arcs,
            arc_idx: f.grid_state.arc_idx,
            surfaces: f.grid_state.surfaces,
        },
        "the grid state digest moved"
    );
    assert_eq!(
        gs.tiles, f.tile_digest,
        "tileDigest and gridState.tiles disagree"
    );

    let info = validate_runtime_floor(&track).expect("the pinned floor validates");
    assert_eq!(
        [info.start_tile.i, info.start_tile.j],
        f.start,
        "start tile"
    );
    assert_eq!(
        [info.provisional_exit_tile.i, info.provisional_exit_tile.j],
        f.provisional_exit,
        "provisional exit tile"
    );
    assert_eq!(
        [info.start_world.0, info.start_world.1],
        f.start_world,
        "start world"
    );
    assert_eq!(
        [info.provisional_exit_world.0, info.provisional_exit_world.1],
        f.provisional_exit_world,
        "exit world"
    );
    assert_eq!(info.path_distance, f.path_distance, "BFS path distance");
    assert_eq!(
        [info.first_path_step.0, info.first_path_step.1],
        f.first_path_step,
        "first path step"
    );

    let want = f.wall_probe.expect("the pinned floor has a wall probe");
    let got = info.wall_probe.expect("validation derived a wall probe");
    assert_eq!(got.from, want.from, "probe origin");
    assert_eq!(got.input, want.input, "probe input");
    assert_eq!(got.ticks, want.ticks, "probe ticks");
    assert_eq!(got.wall_tile, want.wall_tile, "probe wall tile");
    assert_eq!(
        got.expected_blocked_axis, want.expected_blocked_axis,
        "probe axis"
    );
    assert_eq!(
        got.max_allowed_travel, want.max_allowed_travel,
        "probe clamp coordinate"
    );
}

/// The world mapping, computed twice by two different routes.
///
/// `tile_center` is `i + 0.5 - w/2`, and the renderer, the camera, the exit
/// marker and the telemetry all depend on it agreeing with `world_to_tile`. A
/// half-tile error here is a floor that looks right and spawns the knight inside
/// a wall — the class of defect a digest cannot see at all.
#[test]
fn the_world_mapping_round_trips_at_both_endpoints() {
    let (track, info) = pinned_floor();
    let g = &track.grid;
    for (what, tile, world) in [
        ("start", info.start_tile, info.start_world),
        (
            "exit",
            info.provisional_exit_tile,
            info.provisional_exit_world,
        ),
    ] {
        assert_eq!(
            world_to_tile(g, world.0, world.1),
            (tile.i, tile.j),
            "{what}: world→tile does not land back on its own tile"
        );
        assert_eq!(
            world.0,
            f64::from(tile.i) + 0.5 - f64::from(g.w) / 2.0,
            "{what}: x"
        );
        assert_eq!(
            world.1,
            f64::from(tile.j) + 0.5 - f64::from(g.h) / 2.0,
            "{what}: z"
        );
    }
}

/// The body fits where the floor opens, and the floor is ONE walkable piece.
///
/// The second half is stronger than "the exit is reachable" and cheaper to state
/// than to argue: with one component every walkable tile is reachable from
/// spawn, so no generated feature can strand the player and no exit marker can
/// be painted somewhere unreachable.
#[test]
fn the_spawn_holds_a_body_and_the_floor_is_one_walkable_piece() {
    let (track, info) = pinned_floor();
    assert!(
        !circle_collides(
            &track.grid,
            info.start_world.0,
            info.start_world.1,
            PLAYER_R
        ),
        "the spawn overlaps a wall"
    );
    assert!(
        !circle_collides(
            &track.grid,
            info.provisional_exit_world.0,
            info.provisional_exit_world.1,
            PLAYER_R
        ),
        "the provisional exit overlaps a wall — the marker would be drawn inside stone"
    );
    assert_eq!(
        walkable_components(&track.grid),
        1,
        "the floor is in pieces — some of it is unreachable from the spawn"
    );
}

/// 4-NEIGHBOUR REACHABILITY, stated on its own rather than left implicit in the
/// component count — this is the claim `pk-check` deliberately does NOT make,
/// because a browser cannot walk a whole floor in a gate.
#[test]
fn the_provisional_exit_is_reachable_from_the_spawn() {
    let (track, info) = pinned_floor();
    let g = &track.grid;
    let d = bfs_distances(g, info.start_tile.i, info.start_tile.j);
    let at_exit = d[idx(
        g,
        info.provisional_exit_tile.i,
        info.provisional_exit_tile.j,
    )];
    assert!(at_exit >= 0, "the exit is unreachable from the spawn");
    assert_eq!(
        at_exit, info.path_distance,
        "the sweep from the start and the sweep from the exit disagree about the distance"
    );
    assert!(
        at_exit > 20,
        "the exit is {at_exit} tiles from the spawn — the boss would be shooting at t=0"
    );
}

/// THE FIRST STEP, TWO WAYS.
///
/// The micro-move (0.05 units) proves the spawn tile is clear and the sim
/// resolves an unobstructed move exactly — and proves nothing else, because a
/// body of radius 0.3 nudged 0.05 off a tile centre never reaches the tile
/// boundary. So the second half WALKS: it holds the step direction until the
/// body is physically inside the neighbouring tile. That is the claim
/// "`first_path_step` is a step the player can take", and it is the one the
/// browser gate mirrors.
#[test]
fn the_first_path_step_is_a_step_the_body_can_actually_take() {
    let (track, info) = pinned_floor();
    let (di, dj) = info.first_path_step;
    assert!(
        (di, dj) != (0, 0),
        "no first step — the spawn and the exit are the same tile"
    );
    assert!(
        is_walkable(&track.grid, info.start_tile.i + di, info.start_tile.j + dj),
        "the first path step points at a wall"
    );

    let out = move_circle(
        &track.grid,
        info.start_world.0,
        info.start_world.1,
        PLAYER_R,
        f64::from(di) * 0.05,
        f64::from(dj) * 0.05,
    );
    assert!(
        (out.x - (info.start_world.0 + f64::from(di) * 0.05)).abs() < 1e-9,
        "the 0.05 step was clamped on x"
    );
    assert!(
        (out.z - (info.start_world.1 + f64::from(dj) * 0.05)).abs() < 1e-9,
        "the 0.05 step was clamped on z"
    );

    // The step the micro-move cannot make: walk into the next tile. 30 ticks is
    // ~2.1 tiles of travel at walking speed, so a body that has not crossed a
    // one-tile boundary by then is being stopped by something.
    let mut sim = SimState::new(track.grid.clone(), info.start_world, 1);
    sim.plunger_armed = false;
    let input = FrameInput {
        move_x: f64::from(di),
        move_z: f64::from(dj),
        sprint: false,
        dodge: false,
    };
    let want = (info.start_tile.i + di, info.start_tile.j + dj);
    let mut arrived = None;
    for tick in 1..=30 {
        simulate(&mut sim, &input);
        if world_to_tile(&sim.grid, sim.player.x, sim.player.z) == want {
            arrived = Some(tick);
            break;
        }
    }
    assert!(
        arrived.is_some(),
        "the body never entered ({}, {}) in 30 ticks — ended at ({:.3}, {:.3}), tile {:?}",
        want.0,
        want.1,
        sim.player.x,
        sim.player.z,
        world_to_tile(&sim.grid, sim.player.x, sim.player.z)
    );
}

// ── THE IMMUTABILITY CONTRACT ────────────────────────────────────────────────

/// `SimState` receives a CLONE of the floor's grid, and the two must stay equal
/// for the life of the floor: the renderer drew one of them and the collider
/// reads the other.
///
/// Checked at setup AND after two scripted input traces, because "the sim does
/// not write terrain" is a property of today's `simulate` call chain, not a
/// guarantee the type system makes. A `set_tile` added to a future pinball part
/// — a collapsing floor, a breakable wall — would desynchronise the two with no
/// symptom until a wall stopped being where it looks.
#[test]
fn the_sims_grid_never_drifts_from_the_floors() {
    let (track, info) = pinned_floor();
    let authored = digest_grid_state(&track.grid);
    let mut sim = SimState::new(track.grid.clone(), info.start_world, 1);
    sim.plunger_armed = false;
    assert_eq!(
        digest_grid_state(&sim.grid),
        authored,
        "the clone handed to the sim is not the floor that was authored"
    );

    // A long diagonal grind: 600 ticks of hard south-east, which walks into
    // walls, slides along them and drives the shaped/arc corrective pass.
    let grind = FrameInput {
        move_x: 1.0,
        move_z: 1.0,
        sprint: false,
        dodge: false,
    };
    for _ in 0..600 {
        simulate(&mut sim, &grind);
    }
    assert_eq!(
        digest_grid_state(&sim.grid),
        authored,
        "600 ticks of walking mutated the terrain"
    );

    // And the probe's own trace, which is the one the browser gate replays.
    if let Some(p) = &info.wall_probe {
        let input = FrameInput {
            move_x: f64::from(p.input[0]),
            move_z: f64::from(p.input[1]),
            sprint: false,
            dodge: false,
        };
        for _ in 0..p.ticks {
            simulate(&mut sim, &input);
        }
        assert_eq!(
            digest_grid_state(&sim.grid),
            authored,
            "the wall probe's trace mutated the terrain"
        );
    }
}

/// THE WALL PROBE, RUN. Both halves: the body reaches the wall, and it does not
/// pass the analytically derived limit.
///
/// The limit comes from the tile face plus the body radius — arithmetic this
/// file does, not a number the sim reported — so a collider that let the body
/// through would fail here rather than agreeing with itself.
#[test]
fn the_wall_probe_stops_the_body_without_freezing_it() {
    let (track, info) = pinned_floor();
    let p = info.wall_probe.expect("the pinned floor has a wall probe");

    // The wall really is a wall, and the tile the body starts on really is not.
    assert!(
        !is_walkable(&track.grid, p.wall_tile[0], p.wall_tile[1]),
        "the probe points at a walkable tile"
    );

    let mut sim = SimState::new(track.grid.clone(), info.start_world, 1);
    sim.plunger_armed = false;
    let input = FrameInput {
        move_x: f64::from(p.input[0]),
        move_z: f64::from(p.input[1]),
        sprint: false,
        dodge: false,
    };
    for _ in 0..p.ticks {
        simulate(&mut sim, &input);
    }
    let coord = [sim.player.x, sim.player.z][p.axis_index()];
    let v = p.verdict(coord);
    assert!(
        v.reached,
        "the body travelled {:.4} of a {:.4} gap — it never reached the wall, so this gate \
         would pass a sim that ignored input",
        v.travelled,
        p.gap()
    );
    assert!(
        v.overshoot <= 0.0,
        "the body ended {:.4} PAST the wall face at {} = {:.4}",
        v.overshoot,
        p.expected_blocked_axis,
        p.max_allowed_travel
    );
    assert!(
        !circle_collides(&track.grid, sim.player.x, sim.player.z, PLAYER_R),
        "the body finished inside a wall"
    );

    // Holding LONGER must not help — the clamp is a bound, not a delay. This is
    // what makes the browser gate's wall-clock key hold sound.
    for _ in 0..120 {
        simulate(&mut sim, &input);
    }
    let coord = [sim.player.x, sim.player.z][p.axis_index()];
    assert!(
        p.verdict(coord).overshoot <= 0.0,
        "ten times the probe's tick count pushed the body through the wall"
    );
}

// ── BEYOND THE PINNED FLOOR ──────────────────────────────────────────────────

/// EVERY LEVEL THE FLAG CAN ASK FOR, not just the one with a fixture.
///
/// `--real-floor --level N` accepts any depth, and a validation that only ever
/// ran on L3 s1 would ship a flag that panics on L7. Two seeds per level so a
/// level that happens to work for one seed is not read as a level that works.
///
/// The failures are COLLECTED rather than asserted in place: how many floors
/// fail, and how, is the diagnosis. One floor of forty declining is the
/// pipeline's documented `None`; forty of forty is a broken derivation.
#[test]
fn every_level_the_flag_accepts_builds_a_floor_you_can_stand_on() {
    let mut bad: Vec<String> = Vec::new();
    let mut with_probe = 0;
    let mut total = 0;
    for level in 1..=20 {
        for seed in [1_u32, 424_242] {
            total += 1;
            let spec = derive_floor_spec(level, seed);
            let built = build_track_floor_from_spec(&spec)
                .and_then(|t| validate_runtime_floor(&t).map(|i| (t, i)));
            match built {
                Ok((track, info)) => {
                    if info.wall_probe.is_some() {
                        with_probe += 1;
                    }
                    if walkable_components(&track.grid) != 1 {
                        bad.push(format!("  L{level} s{seed}: the floor is in pieces"));
                    }
                    if circle_collides(
                        &track.grid,
                        info.start_world.0,
                        info.start_world.1,
                        PLAYER_R,
                    ) {
                        bad.push(format!("  L{level} s{seed}: the spawn overlaps a wall"));
                    }
                    if info.first_path_step == (0, 0) {
                        bad.push(format!("  L{level} s{seed}: no first path step"));
                    }
                }
                Err(e) => bad.push(format!("  L{level} s{seed}: {e}")),
            }
        }
    }
    assert!(
        bad.is_empty(),
        "{} of {total} floors are not standable:\n{}",
        bad.len(),
        bad.join("\n")
    );
    // NOT a silent cap: the wall probe is optional, and how often it is actually
    // available decides whether the browser gate can rely on it. Printed as a
    // number rather than assumed to be "always".
    assert_eq!(
        with_probe, total,
        "{with_probe} of {total} floors produced a wall probe — the browser gate's collision \
         check is unavailable on the rest, and pk-check must say so rather than skip quietly"
    );
}

/// The build is a pure function of the spec — the property the whole flag rests
/// on, since the harness, the fixture and the browser each build the floor
/// independently and compare notes.
#[test]
fn the_same_spec_builds_the_same_floor_twice() {
    let spec = derive_floor_spec(LEVEL, SEED);
    let a = build_track_floor_from_spec(&spec).unwrap();
    let b = build_track_floor_from_spec(&spec).unwrap();
    assert_eq!(digest_grid_state(&a.grid), digest_grid_state(&b.grid));
    assert_eq!(
        validate_runtime_floor(&a).unwrap(),
        validate_runtime_floor(&b).unwrap()
    );
}

/// The failure path is a VALUE, not a panic and not a fallback.
///
/// Constructed by hand because no corpus floor reaches it: a floor whose
/// endpoints are missing is what a two-lane-tile circuit produces, and the
/// shipping levels do not make one. Without this the error enum is code no test
/// has ever executed, and "the overlay shows the failure" would be untested.
#[test]
fn a_floor_with_no_endpoints_is_an_error_and_not_a_panic() {
    let spec = derive_floor_spec(LEVEL, SEED);
    let mut track = build_track_floor_from_spec(&spec).unwrap();
    track.ends = None;
    assert_eq!(
        validate_runtime_floor(&track),
        Err(FloorBuildError::MissingEndpoints)
    );

    // And a start that is not walkable — the other half of the guard, reached by
    // filling the spawn tile in.
    let mut track = build_track_floor_from_spec(&spec).unwrap();
    let s = track.ends.as_ref().unwrap().start;
    pk_core::grid::set_tile(&mut track.grid, s.i, s.j, pk_core::grid::T_WALL);
    assert_eq!(
        validate_runtime_floor(&track),
        Err(FloorBuildError::StartNotWalkable { tile: s })
    );

    // Every variant carries a message. A `Display` that panicked or came out
    // empty would leave the on-screen overlay blank at the one moment it matters.
    for e in [
        FloorBuildError::PipelineDeclined {
            level: 3,
            run_seed: 1,
        },
        FloorBuildError::MissingEndpoints,
        FloorBuildError::StartNotWalkable { tile: s },
        FloorBuildError::ProvisionalExitNotWalkable { tile: s },
        FloorBuildError::ProvisionalExitUnreachable { start: s, exit: s },
        FloorBuildError::SpawnBlockedForPlayerRadius {
            tile: s,
            radius: PLAYER_R,
        },
        FloorBuildError::InvalidSpec {
            reason: "level 0".into(),
        },
    ] {
        assert!(!e.to_string().is_empty(), "{e:?} formats to nothing");
    }
}
