//! Export `assets/fixtures/real-floor-l3s1-p9.json` — the floor the shell boots
//! under `--real-floor`, pinned.
//!
//! ```text
//! cargo run -p pk-core --example real_floor_fixture -- --level 3 --seed 1 \
//!   > assets/fixtures/real-floor-l3s1-p9.json
//! ```
//!
//! ## What a fixture written by the thing it tests is worth
//!
//! On its own, nothing: it records whatever the pipeline did on the day, so a
//! regression re-exported is a green suite. That is why HALF of what it carries
//! is already pinned by `maze-pass-digests.json`, which was exported from the
//! LEGACY TypeScript generator — `floorSeed`, `cellsW/H`, `w/h`, `density`,
//! `draws`, `tileDigest`, `walkableTiles`, `start`, `provisionalExit`. The
//! integration suite compares those nine fields against the oracle corpus before
//! it looks at anything else, so a hand-edited or re-exported fixture that
//! flatters a broken port disagrees with a file this program cannot write.
//!
//! The other half — `firstPathStep`, `wallProbe`, `gridState`, `pathDistance` —
//! is genuinely new: the oracle never computed it, because the legacy game had
//! no reason to. Those fields are pinned here so a CHANGE to them is visible,
//! and they are also derived independently (BFS, tile faces, the body radius)
//! rather than read off a simulation, so the tests that consume them can fail.
//!
//! `producerCommit` is stamped from the environment rather than guessed — see
//! `stamp` below.

use pk_core::grid::{is_walkable, Grid};
use pk_core::maze::digest::{digest_bytes, digest_f32, digest_grid_state};
use pk_core::maze::floor_spec::{
    build_track_floor_from_spec_observed, derive_floor_spec, validate_runtime_floor,
};
use pk_core::maze::track_floor::PASSES_LANDED;
use pk_core::maze::{Extra, PASS_ORDER};

/// The boundary this fixture is taken at — the last pass that has landed.
const PASS: &str = PASS_ORDER[PASSES_LANDED - 1];

fn arg(name: &str, default: &str) -> String {
    let mut it = std::env::args();
    while let Some(a) = it.next() {
        if a == name {
            return it.next().unwrap_or_else(|| default.to_string());
        }
    }
    default.to_string()
}

fn walkable_count(g: &Grid) -> u32 {
    let mut n = 0;
    for j in 0..g.h {
        for i in 0..g.w {
            if is_walkable(g, i, j) {
                n += 1;
            }
        }
    }
    n
}

/// The commit this fixture was produced at. Read from `PK_FIXTURE_COMMIT` so the
/// caller supplies `git rev-parse HEAD`; a value this program derived itself
/// would be a claim about a tree it cannot see the dirtiness of.
fn stamp() -> String {
    std::env::var("PK_FIXTURE_COMMIT").unwrap_or_else(|_| "unstamped".into())
}

fn main() {
    let level: i32 = arg("--level", "3").parse().expect("--level is an integer");
    let seed: u32 = arg("--seed", "1").parse().expect("--seed is an integer");

    let spec = derive_floor_spec(level, seed);

    // The pass-9 boundary, captured through the SHIPPING build path. `draws` and
    // the two mask digests exist only at the boundary, so they are read from the
    // probe rather than recomputed from the finished floor.
    let mut draws = 0_u64;
    let mut lane = 0_u32;
    let mut sealed = 0_u32;
    let mut dist = 0_u32;
    let mut sites = 0_i64;
    let mut guard = 0_i64;
    let mut probe = |s: pk_core::maze::PassSnapshot<'_>| {
        if s.pass != PASS {
            return;
        }
        draws = s.draws;
        if let Some(m) = s.mask {
            lane = digest_bytes(&m.lane);
            sealed = digest_bytes(&m.sealed);
            dist = digest_f32(&m.dist);
        }
        for (k, v) in &s.extra {
            if let Extra::Int(n) = v {
                match *k {
                    "sites" => sites = *n,
                    "guard" => guard = *n,
                    _ => {}
                }
            }
        }
    };
    let track = build_track_floor_from_spec_observed(&spec, Some(&mut probe))
        .unwrap_or_else(|e| panic!("L{level} seed {seed}: {e}"));
    let info =
        validate_runtime_floor(&track).unwrap_or_else(|e| panic!("L{level} seed {seed}: {e}"));
    let gs = digest_grid_state(&track.grid);

    let wall_probe = match &info.wall_probe {
        Some(p) => format!(
            r#"{{
    "from": [{}, {}],
    "input": [{}, {}],
    "ticks": {},
    "wallTile": [{}, {}],
    "expectedBlockedAxis": "{}",
    "maxAllowedTravel": {}
  }}"#,
            p.from[0],
            p.from[1],
            p.input[0],
            p.input[1],
            p.ticks,
            p.wall_tile[0],
            p.wall_tile[1],
            p.expected_blocked_axis,
            p.max_allowed_travel
        ),
        None => "null".to_string(),
    };

    // Hand-written rather than serde-derived: the fixture's KEY ORDER is read by
    // a human diffing two exports, and it groups by provenance (oracle-shared
    // fields first, port-only fields after) in a way a derive cannot express.
    println!(
        r#"{{
  "schema": 1,
  "producer": "crates/pk-core/examples/real_floor_fixture.rs",
  "producerCommit": "{commit}",
  "pass": "{pass}",
  "generatorVersion": {passes},
  "level": {level},
  "runSeed": {seed},

  "floorSeed": {floor_seed},
  "cellsW": {cells_w},
  "cellsH": {cells_h},
  "w": {w},
  "h": {h},
  "density": {density},
  "draws": {draws},
  "tileDigest": {tile_digest},
  "walkableTiles": {walkable},
  "start": [{si}, {sj}],
  "provisionalExit": [{ei}, {ej}],

  "archetype": "{archetype}",
  "modifier": "{modifier:?}",
  "maskLane": {lane},
  "maskSealed": {sealed},
  "maskDist": {dist},
  "planSites": {sites},
  "planGuard": {guard},

  "startWorld": [{sx}, {sz}],
  "provisionalExitWorld": [{ex}, {ez}],
  "pathDistance": {path_distance},
  "firstPathStep": [{fi}, {fj}],
  "gridState": {{
    "w": {gw},
    "h": {gh},
    "tiles": {g_tiles},
    "shapes": {g_shapes},
    "arcs": {g_arcs},
    "arcIdx": {g_arc_idx},
    "surfaces": {g_surfaces}
  }},
  "wallProbe": {wall_probe}
}}"#,
        commit = stamp(),
        pass = PASS,
        passes = PASSES_LANDED,
        floor_seed = spec.floor_seed,
        cells_w = spec.cells_w,
        cells_h = spec.cells_h,
        w = spec.w,
        h = spec.h,
        density = spec.density,
        tile_digest = gs.tiles,
        walkable = walkable_count(&track.grid),
        si = info.start_tile.i,
        sj = info.start_tile.j,
        ei = info.provisional_exit_tile.i,
        ej = info.provisional_exit_tile.j,
        archetype = spec.archetype.id.as_str(),
        modifier = spec.modifier,
        sx = info.start_world.0,
        sz = info.start_world.1,
        ex = info.provisional_exit_world.0,
        ez = info.provisional_exit_world.1,
        path_distance = info.path_distance,
        fi = info.first_path_step.0,
        fj = info.first_path_step.1,
        gw = gs.w,
        gh = gs.h,
        g_tiles = gs.tiles,
        g_shapes = gs.shapes,
        g_arcs = gs.arcs,
        g_arc_idx = gs.arc_idx,
        g_surfaces = gs.surfaces,
    );
}
