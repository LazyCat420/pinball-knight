//! THE ONE DERIVATION FROM `(level, run_seed)` TO A FLOOR THE GAME CAN STAND ON.
//!
//! Two callers, one arithmetic. `tests/maze_pass_digests.rs` has reproduced the
//! pre-track stream by hand since pass 1 — modifier roll, windiness roll,
//! `clamp(0.35, 0.85)` — and the shell is about to need exactly the same three
//! lines to boot a generated floor. Written twice they would be two derivations
//! free to drift, and the drift would be invisible: the parity harness would
//! keep replaying the oracle while the GAME quietly built a different floor from
//! the same seed. So [`derive_floor_spec`] is the derivation and the parity
//! harness calls it.
//!
//! ## What this module refuses to do
//!
//! It does not decide anything. Every number in a [`FloorSpec`] comes from
//! `archetypes.rs`, `modifiers.rs` or `floor_seed`, and the one arithmetic
//! expression here (`windiness.clamp(0.35, 0.85)`) is transcribed from
//! `spawn/floor-authoring.ts:159`. A constant invented here would be a floor the
//! oracle has never seen, which is the one thing the whole harness exists to
//! prevent.
//!
//! ## Why the spec CARRIES the rng
//!
//! `authorFloor` draws one or two values before the generator starts, so
//! "the floor's rng" is not `floor_rng(run_seed, level)` — it is that stream
//! advanced past the modifier and windiness rolls. Handing back the position
//! rather than the recipe means a caller cannot accidentally rebuild the floor
//! from a fresh stream and get a floor that is wrong by two draws.
//!
//! ## THE PIPELINE IS NINE PASSES OF TWENTY-THREE
//!
//! Everything below is honest about that and none of it papers over it. The
//! floor a spec builds today has no `T_STAIRS` (pass 21), no published arcs
//! (pass 10), no boss chamber (pass 15) and no carved doorways (pass 18). Its
//! endpoints are the PROVISIONAL pass-7 pick, which `endpoints-final` re-picks
//! at pass 14 — see [`RuntimeFloorInfo::provisional_exit_tile`]. What it does
//! have is the thing a shell needs: a connected walkable grid with a spawn on
//! it, byte-identical to the oracle's grid at the `plan-doorways` boundary on
//! all ten corpus floors.
//!
//! PORTS: `maze/modifiers.ts`
//! PORTS-PARTIAL: `maze/floor-rules.ts` - NOT a finished port - 0 of 8 exported names carried over (0%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

use super::archetypes::{archetype_for, level_cells, windiness_for, FloorArchetype};
use super::modifiers::{roll_modifier, ModifierId};
use super::track_floor::{build_track_floor, BuildTrackFloorOpts, TrackFloor};
use super::track_launch::TilePos;
use super::{floor_rng, floor_seed, CountingRng};
use crate::collide::circle_collides;
use crate::flow_field::bfs_distances;
use crate::grid::{at, idx, is_walkable, shape_at, tile_center, Grid, SHAPE_FULL};
use crate::state::{DT, PLAYER_R, PLAYER_SPEED};

/// `growMazeAround`'s density is the windiness roll CLAMPED — transcribed from
/// `spawn/floor-authoring.ts:159`, where it is written inline in the
/// `buildTrackFloor` call.
const DENSITY_RANGE: (f64, f64) = (0.35, 0.85);

/// The four cardinals, in scan order — the tie-break for both derived
/// directions on this floor: [`first_step_downhill`] and [`derive_wall_probe`].
///
/// ⚠️ ORDER IS OUTPUT, not a detail. A floor with two equally short routes to
/// the exit, or two walls at the same distance from the spawn, resolves HERE and
/// nowhere else — and both answers are pinned in a fixture and replayed through
/// a browser. Reordering this list is a fixture change, not a refactor. North
/// first because the isometric camera puts north at screen up-right, so a
/// failure is the direction a human would look at.
const PROBE_CARDINALS: [(i32, i32); 4] = [(0, -1), (0, 1), (-1, 0), (1, 0)];

/// Everything `(level, run_seed)` determines before a tile is carved.
///
/// Clone-able and inspectable on purpose: this is what the debug banner, the
/// telemetry payload and the fixture all read, and each of them reading the same
/// struct is what stops the banner and the gate disagreeing about which floor is
/// on screen.
#[derive(Clone, Debug)]
pub struct FloorSpec {
    pub level: i32,
    pub run_seed: u32,
    /// `run_seed ^ (level * GOLDEN32)` — every draw on this floor is downstream.
    pub floor_seed: u32,
    pub cells_w: i32,
    pub cells_h: i32,
    /// `cells_w * 2 + 1`. Carried rather than re-derived at each read site.
    pub w: i32,
    pub h: i32,
    /// The clamped windiness roll `grow_maze_around` reads.
    pub density: f64,
    /// This floor's twist. Rolled here because the roll DRAWS — dropping it
    /// would shift every later draw on the floor.
    pub modifier: ModifierId,
    pub archetype: &'static FloorArchetype,
    /// The floor's stream, positioned exactly where `build_track_floor` picks it
    /// up. See the module header.
    pub rng: CountingRng,
}

/// Why a floor could not be built, or could not be stood on.
///
/// One enum for both halves because a caller answers them the same way — show
/// the failure, never fall back to a different floor. Each variant carries the
/// numbers a bug report would otherwise have to be asked for: a
/// `SpawnBlockedForPlayerRadius { tile, radius }` says which tile and at what
/// body size, and those two are the whole reproduction.
#[derive(Clone, Debug, PartialEq)]
pub enum FloorBuildError {
    /// `build_track_floor` returned `None` — no edges after the prune, or no
    /// rideable straight. A legitimate outcome the shipping game answers by
    /// falling back to the growing-tree generator, which is not ported.
    PipelineDeclined {
        level: i32,
        run_seed: u32,
    },
    /// The floor built but `pick_track_endpoints` found fewer than two lane
    /// tiles, so there is nowhere to open and nowhere to leave.
    MissingEndpoints,
    StartNotWalkable {
        tile: TilePos,
    },
    ProvisionalExitNotWalkable {
        tile: TilePos,
    },
    /// The two ends are in different walkable components. `repair-1` is supposed
    /// to make this impossible; if it fires, the repair passes regressed.
    ProvisionalExitUnreachable {
        start: TilePos,
        exit: TilePos,
    },
    /// The tile is walkable but a body of `radius` does not fit on its centre —
    /// a shaped tile or arc slice intruding. Distinct from `StartNotWalkable`
    /// because the two have completely different causes.
    SpawnBlockedForPlayerRadius {
        tile: TilePos,
        radius: f64,
    },
    /// A spec that could not be derived at all (a level below 1, say).
    InvalidSpec {
        reason: String,
    },
}

impl std::fmt::Display for FloorBuildError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::PipelineDeclined { level, run_seed } => {
                write!(f, "the pipeline declined L{level} seed {run_seed}")
            }
            Self::MissingEndpoints => write!(f, "the floor has fewer than two lane tiles"),
            Self::StartNotWalkable { tile } => {
                write!(f, "start tile ({}, {}) is not walkable", tile.i, tile.j)
            }
            Self::ProvisionalExitNotWalkable { tile } => {
                write!(f, "exit tile ({}, {}) is not walkable", tile.i, tile.j)
            }
            Self::ProvisionalExitUnreachable { start, exit } => write!(
                f,
                "exit ({}, {}) is unreachable from start ({}, {})",
                exit.i, exit.j, start.i, start.j
            ),
            Self::SpawnBlockedForPlayerRadius { tile, radius } => write!(
                f,
                "a body of radius {radius} does not fit on start tile ({}, {})",
                tile.i, tile.j
            ),
            Self::InvalidSpec { reason } => write!(f, "invalid floor spec: {reason}"),
        }
    }
}

impl std::error::Error for FloorBuildError {}

/// THE DERIVATION. Two draws, four table lookups, one clamp.
///
/// ⚠️ The two draws are not bookkeeping. `roll_modifier` spends 0, 1 or 2 values
/// depending on depth and `windiness_for` spends 0 or 1, so the stream
/// `build_track_floor` inherits is at a different offset per level — and
/// `density` is a DRAW run through an expression, not a constant. Treating
/// either as ignorable cost the port 548 extra draws on L1 s1 the first time it
/// was tried (see `tests/maze_pass_digests.rs`).
pub fn derive_floor_spec(level: i32, run_seed: u32) -> FloorSpec {
    let archetype = archetype_for(level);
    let (cells_w, cells_h) = level_cells(level);
    let mut rng = floor_rng(run_seed, level);
    let modifier = roll_modifier(level, &mut rng);
    let windiness = windiness_for(level, archetype, &mut rng);
    FloorSpec {
        level,
        run_seed,
        floor_seed: floor_seed(run_seed, level),
        cells_w,
        cells_h,
        w: cells_w * 2 + 1,
        h: cells_h * 2 + 1,
        density: windiness.clamp(DENSITY_RANGE.0, DENSITY_RANGE.1),
        modifier,
        archetype,
        rng,
    }
}

/// Build the floor a spec describes, through the SHIPPING pipeline.
///
/// Takes `&FloorSpec` and clones the stream rather than consuming it, so the
/// same spec can be built twice — which is not a convenience, it is what the
/// determinism test asserts on.
pub fn build_track_floor_from_spec(spec: &FloorSpec) -> Result<TrackFloor, FloorBuildError> {
    build_track_floor_from_spec_observed(spec, None)
}

/// The same build with the per-pass probe attached — for the fixture exporter
/// and the tests that pin a boundary's draw count.
///
/// A separate entry point rather than an argument on the shipping one, and the
/// split is the point: the shell must not be able to pass a probe by accident,
/// and the exporter must not be able to build the floor by a different route
/// than the shell does. Both funnel through this body, so there is exactly one
/// `build_track_floor` call site behind a spec.
pub fn build_track_floor_from_spec_observed(
    spec: &FloorSpec,
    on_pass: Option<&mut dyn FnMut(super::PassSnapshot<'_>)>,
) -> Result<TrackFloor, FloorBuildError> {
    let mut rng = spec.rng.clone();
    build_track_floor(
        spec.cells_w,
        spec.cells_h,
        &mut rng,
        &BuildTrackFloorOpts {
            profile: Some(&spec.archetype.track),
            density: Some(spec.density),
            ..Default::default()
        },
        on_pass,
    )
    .ok_or(FloorBuildError::PipelineDeclined {
        level: spec.level,
        run_seed: spec.run_seed,
    })
}

/// A SCRIPTED COLLISION, derived from the grid and checkable from outside.
///
/// The thing a screenshot cannot prove: that the walls the renderer drew are the
/// walls the collider enforces. It is expressed as INPUT rather than as a
/// position because the only view a browser harness has is the keyboard — a
/// probe that said "teleport here and call `circle_collides`" would verify the
/// collider against itself and never touch the input path, the fixed-step
/// scheduler or the grid the shell actually installed.
///
/// [`max_allowed_travel`](Self::max_allowed_travel) is derived ANALYTICALLY from
/// the tile boundary and the body radius, never by running the sim: a bound
/// measured from the thing it is bounding is a tautology, and this one has to
/// fail when the collider changes.
#[derive(Clone, Debug, PartialEq)]
pub struct WallProbe {
    /// World position the probe starts from — the start tile's centre.
    pub from: [f64; 2],
    /// World-space movement intent, a unit cardinal. The shell's key mapping is
    /// screen-relative (45° yaw), so a browser harness presses the PAIR of keys
    /// whose sum is this vector; see `scripts/pk-check.mjs`.
    pub input: [i8; 2],
    /// Ticks of `simulate` at this input. Sized so the body is pressed flat
    /// against the wall with slack to spare — holding LONGER only makes the
    /// bound below a stronger claim, which is what lets a browser harness use
    /// wall-clock key holds against a fixed-step sim.
    pub ticks: u32,
    /// The wall tile the travel is expected to stop against.
    pub wall_tile: [i32; 2],
    /// `"x"` or `"z"` — which world axis is blocked.
    pub expected_blocked_axis: String,
    /// The coordinate on that axis the body must never pass, travelling along
    /// `input`. Equal to the wall face plus the body radius, so the sim's own
    /// `EPS` back-off satisfies it with room and no shared constant is needed.
    ///
    /// Half of a two-sided check, and the half that is worthless alone: a sim
    /// that ignores input never passes this bound either. The other half is
    /// derivable from the same two numbers — the gap `|from[axis] - limit|` is
    /// the distance the body MUST cover — so both checkers compute it rather
    /// than each carrying a copy of a tolerance.
    pub max_allowed_travel: f64,
}

impl WallProbe {
    /// Index into a `[x, z]` pair for this probe's blocked axis.
    pub fn axis_index(&self) -> usize {
        usize::from(self.expected_blocked_axis == "z")
    }

    /// How far the body must travel to reach the wall — `|from - limit|`.
    /// Derived, never stored: two stored numbers cannot disagree with each other
    /// the way a stored third could disagree with both.
    pub fn gap(&self) -> f64 {
        (self.from[self.axis_index()] - self.max_allowed_travel).abs()
    }

    /// Did a body that ended at `coord` on the blocked axis both REACH the wall
    /// and stay out of it? `travelled >= gap/2` is the liveness half; not passing
    /// `max_allowed_travel` is the collision half.
    pub fn verdict(&self, coord: f64) -> ProbeVerdict {
        let ax = self.axis_index();
        let sign = f64::from(self.input[ax]);
        let start = self.from[ax];
        let travelled = (coord - start) * sign;
        ProbeVerdict {
            travelled,
            reached: travelled >= self.gap() / 2.0,
            // Positive overshoot means the body is inside the wall.
            overshoot: (coord - self.max_allowed_travel) * sign,
        }
    }
}

/// What [`WallProbe::verdict`] decided, in numbers rather than a bool — a gate
/// that prints "failed" and not "travelled 0.00 of 0.20" costs a second run.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ProbeVerdict {
    /// Distance covered along `input` on the blocked axis.
    pub travelled: f64,
    /// The body actually moved toward the wall.
    pub reached: bool,
    /// How far PAST the limit the body ended. `<= 0` is the passing side.
    pub overshoot: f64,
}

impl ProbeVerdict {
    pub fn passed(&self) -> bool {
        self.reached && self.overshoot <= 0.0
    }
}

/// What the shell needs from a built floor, and nothing it does not.
///
/// Every field is derived from the grid by this module rather than read off
/// `TrackFloor` directly, because `TrackFloor`'s endpoints are TILES and the
/// shell, the camera, the telemetry and the exit marker all need WORLD
/// coordinates. Converting once here is what stops five call sites each writing
/// `i + 0.5 - w/2` and one of them writing it wrong.
#[derive(Clone, Debug, PartialEq)]
pub struct RuntimeFloorInfo {
    pub start_tile: TilePos,
    /// ⚠️ PROVISIONAL. This is the pass-7 `endpoints-early` pick, which pass 14
    /// re-picks on the post-curve grid. It is not where the stairs will be; it
    /// is where the stairs would be if the pipeline stopped here. Named so at
    /// every read site, including the telemetry and the on-screen banner.
    pub provisional_exit_tile: TilePos,
    pub start_world: (f64, f64),
    pub provisional_exit_world: (f64, f64),
    /// 4-neighbour BFS distance start → exit, in tiles.
    pub path_distance: i32,
    /// The first step of a shortest path, as a unit cardinal.
    pub first_path_step: (i32, i32),
    /// EVERY step of that shortest path, start → exit, as unit cardinals.
    ///
    /// The BFS field is already swept to answer `path_distance`; walking it down
    /// costs one more pass and turns "the exit is reachable" — an arithmetic
    /// claim about an array — into a route something can actually be driven
    /// along. That is what the browser gate does with it: the descend rule is
    /// "stand on the exit", and the only honest way to test a rule about walking
    /// is to walk.
    ///
    /// Length is exactly `path_distance`, and empty when the start IS the exit.
    pub route_to_exit: Vec<(i32, i32)>,
    /// `None` when no square wall abuts the start tile — an open plaza spawn.
    /// Optional rather than fabricated: a probe pointed at a wall that is not
    /// there is a gate that fails for the wrong reason.
    pub wall_probe: Option<WallProbe>,
}

/// Can the player STAND on this floor, and can they LEAVE the tile they open on?
///
/// Read-only and total: it either answers with a [`RuntimeFloorInfo`] or names
/// the reason it cannot. No panics and no fallbacks — a shell that silently
/// booted a different floor when this failed would make every "the real floor
/// looks like the demo floor" report unfalsifiable.
pub fn validate_runtime_floor(track: &TrackFloor) -> Result<RuntimeFloorInfo, FloorBuildError> {
    let ends = track
        .ends
        .as_ref()
        .ok_or(FloorBuildError::MissingEndpoints)?;
    validate_runtime_grid(&track.grid, ends.start, ends.stairs)
}

/// [`validate_runtime_floor`] for a floor that has no [`TrackFloor`] behind it.
///
/// The generator is not the only thing that can produce a floor: an AUTHORED
/// floor exported from the oracle (`assets/floors/*.json`) arrives as a grid and
/// two endpoints and nothing else. Every check below reads exactly those three
/// things, so the split is an extraction and not a second implementation — which
/// matters more here than it usually would, because the alternative on offer was
/// to fabricate a `TrackFloor` around the grid (an empty graph, an empty path, a
/// mask nobody carved) purely to reach this function. A fabricated field is a
/// field some later pass will read and believe.
pub fn validate_runtime_grid(
    g: &Grid,
    start: TilePos,
    exit: TilePos,
) -> Result<RuntimeFloorInfo, FloorBuildError> {
    if !is_walkable(g, start.i, start.j) {
        return Err(FloorBuildError::StartNotWalkable { tile: start });
    }
    if !is_walkable(g, exit.i, exit.j) {
        return Err(FloorBuildError::ProvisionalExitNotWalkable { tile: exit });
    }

    let start_world = tile_center(g, start.i, start.j);
    let provisional_exit_world = tile_center(g, exit.i, exit.j);

    // The body, not the tile. `is_walkable` says a tile is floor; this says a
    // circle of the player's radius fits on its centre, which a shaped tile or
    // an arc slice in the next cell over can deny.
    if circle_collides(g, start_world.0, start_world.1, PLAYER_R) {
        return Err(FloorBuildError::SpawnBlockedForPlayerRadius {
            tile: start,
            radius: PLAYER_R,
        });
    }

    // Swept from the EXIT, not the start: the same field answers "how far apart
    // are they" and "which neighbour of start is one step closer to the exit",
    // and two fields could disagree about a floor with several shortest paths.
    let from_exit = bfs_distances(g, exit.i, exit.j);
    let path_distance = from_exit[idx(g, start.i, start.j)];
    if path_distance < 0 {
        return Err(FloorBuildError::ProvisionalExitUnreachable { start, exit });
    }

    let first_path_step = first_step_downhill(g, start, &from_exit, path_distance);
    let route_to_exit = route_downhill(g, start, &from_exit, path_distance);

    Ok(RuntimeFloorInfo {
        start_tile: start,
        provisional_exit_tile: exit,
        start_world,
        provisional_exit_world,
        path_distance,
        first_path_step,
        route_to_exit,
        wall_probe: derive_wall_probe(g, start, start_world),
    })
}

/// The first step of a shortest path: the cardinal neighbour whose distance to
/// the exit is one less than ours.
///
/// Ties broken by [`PROBE_CARDINALS`] order and nothing else — a floor with two
/// equally short routes has to pick one, and picking it by scan order is the
/// only choice a fixture can pin. `(0, 0)` when the start IS the exit, which is
/// degenerate rather than impossible (a two-tile floor).
fn first_step_downhill(g: &Grid, start: TilePos, from_exit: &[i32], d: i32) -> (i32, i32) {
    if d == 0 {
        return (0, 0);
    }
    for (di, dj) in PROBE_CARDINALS {
        let (ni, nj) = (start.i + di, start.j + dj);
        if !is_walkable(g, ni, nj) {
            continue;
        }
        if from_exit[idx(g, ni, nj)] == d - 1 {
            return (di, dj);
        }
    }
    // Unreachable given `d >= 1` and a 4-neighbour BFS: some neighbour must be
    // one closer. Returned rather than panicked so a future grid change is a
    // failing assertion in a test, not a crash in the shell.
    (0, 0)
}

/// The whole shortest path, by repeating [`first_step_downhill`].
///
/// One function rather than a loop at the call site, and it reuses the step
/// picker rather than re-deriving one: `first_path_step` and the first entry
/// here are then equal BY CONSTRUCTION, and a fixture that pins one pins both.
/// A step that cannot be found stops the route where it stalled — the caller
/// checks the length against `path_distance`, so a truncated route fails loudly
/// instead of arriving somewhere else.
fn route_downhill(g: &Grid, start: TilePos, from_exit: &[i32], d: i32) -> Vec<(i32, i32)> {
    let mut route = Vec::with_capacity(d.max(0) as usize);
    let mut here = start;
    let mut left = d;
    while left > 0 {
        let step = first_step_downhill(g, here, from_exit, left);
        if step == (0, 0) {
            break;
        }
        route.push(step);
        here = TilePos {
            i: here.i + step.0,
            j: here.j + step.1,
        };
        left -= 1;
    }
    route
}

/// How many tiles the probe will walk looking for a wall.
///
/// A bound on the browser gate's key hold, not on the geometry: six tiles is
/// ~1.4 s of walking, and a probe longer than that spends the harness's time
/// proving something a shorter one already proved. Measured against the corpus,
/// the longest run any of forty floors needs is well inside it — see
/// `every_level_the_flag_accepts_builds_a_floor_you_can_stand_on`.
const PROBE_MAX_TILES: i32 = 6;

/// Aim a probe at the NEAREST square wall on a cardinal from the spawn.
///
/// ⚠️ REWRITTEN AFTER MEASUREMENT. The first version only looked at the four
/// tiles touching the spawn, on the reasoning that a spawn is in a corridor. It
/// is not: 39 of 40 corpus-adjacent floors open at a launch chute's park tile,
/// which is the closed end of a *carved lane* wide enough that all four
/// neighbours are floor. One floor of forty produced a probe — the flag would
/// have shipped a browser collision gate that silently did nothing on 97% of
/// floors. Walking up to [`PROBE_MAX_TILES`] fixes it and costs nothing: the
/// body travels down the middle of a column of walkable tiles, and at radius 0.3
/// in a 1.0 tile it never touches the side walls, so the extra distance adds no
/// new way to be wrong.
///
/// SQUARE walls only (`SHAPE_FULL`): the clamp below is the tile face plus the
/// body radius, and a slant or an arc slice is a different surface at a
/// different distance. Restricting the probe keeps the derived bound an
/// independent oracle rather than a second copy of `resolve_shaped`.
///
/// NEAREST across all four cardinals, ties by [`PROBE_CARDINALS`] order — the
/// shortest hold a browser has to perform, chosen the one way a fixture can pin.
fn derive_wall_probe(g: &Grid, start: TilePos, start_world: (f64, f64)) -> Option<WallProbe> {
    let mut best: Option<(i32, (i32, i32), TilePos)> = None;
    for (di, dj) in PROBE_CARDINALS {
        for step in 1..=PROBE_MAX_TILES {
            let (ti, tj) = (start.i + di * step, start.j + dj * step);
            // Off-grid: `at` reads it as wall, but there is no tile face to
            // measure from, so the run ends without a probe.
            if ti < 0 || tj < 0 || ti >= g.w || tj >= g.h {
                break;
            }
            if is_walkable(g, ti, tj) {
                continue;
            }
            // A shaped wall ends the run without yielding a probe — the body
            // would stop somewhere this function cannot predict.
            if shape_at(g, ti, tj) != SHAPE_FULL {
                break;
            }
            debug_assert!(at(g, ti, tj) != crate::grid::T_FLOOR);
            if best.as_ref().is_none_or(|(d, _, _)| step < *d) {
                best = Some((step, (di, dj), TilePos { i: ti, j: tj }));
            }
            break;
        }
    }
    let (_, (di, dj), wall) = best?;
    let (axis, limit) = if di != 0 {
        // Travelling in +i puts the wall's WEST face at world x = wall.i - w/2;
        // travelling in -i puts its EAST face at wall.i + 1 - w/2. The body stops
        // one radius short of whichever face it meets.
        let face = f64::from(if di > 0 { wall.i } else { wall.i + 1 }) - f64::from(g.w) / 2.0;
        ("x", face - f64::from(di) * PLAYER_R)
    } else {
        let face = f64::from(if dj > 0 { wall.j } else { wall.j + 1 }) - f64::from(g.h) / 2.0;
        ("z", face - f64::from(dj) * PLAYER_R)
    };
    let gap = (start_world.if_axis(axis) - limit).abs();
    Some(WallProbe {
        from: [start_world.0, start_world.1],
        input: [di as i8, dj as i8],
        // Enough ticks to close the gap with room to spare. Slack rather than an
        // exact count on purpose: holding LONGER only strengthens the bound the
        // probe asserts, which is what lets a browser's wall-clock key hold
        // stand in for a fixed-step tick count.
        ticks: (gap / (PLAYER_SPEED * DT)).ceil() as u32 + 8,
        wall_tile: [wall.i, wall.j],
        expected_blocked_axis: axis.to_string(),
        max_allowed_travel: limit,
    })
}

/// Pick the component of a world pair that matches an axis name. A free function
/// on a tuple would read worse at the one call site than this does.
trait AxisPick {
    fn if_axis(&self, axis: &str) -> f64;
}

impl AxisPick for (f64, f64) {
    fn if_axis(&self, axis: &str) -> f64 {
        if axis == "z" {
            self.1
        } else {
            self.0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// THE ROUTE IS WALKED, not counted.
    ///
    /// `path_distance` is a number read out of an array, and a number can be
    /// right about a floor nobody can cross. This replays every step on ten
    /// levels: each tile it lands on must be walkable, the length must equal the
    /// distance, and the last step must land on the exit — which is the claim
    /// the descend rule stands on, and the claim a browser gate drives.
    #[test]
    fn the_route_to_the_exit_is_a_walkable_path_that_arrives() {
        for level in 1..=10 {
            let spec = derive_floor_spec(level, 1);
            let track = build_track_floor_from_spec(&spec).expect("L{level} builds");
            let info = validate_runtime_floor(&track).expect("L{level} validates");
            let g = &track.grid;
            assert_eq!(
                info.route_to_exit.len() as i32,
                info.path_distance,
                "L{level}: the route is shorter than the distance it claims — \
                 `route_downhill` stalled"
            );
            assert_eq!(
                info.route_to_exit.first().copied(),
                Some(info.first_path_step),
                "L{level}: the route's first step and `first_path_step` are the \
                 same pick or one of them is lying"
            );
            let mut here = info.start_tile;
            for (n, (di, dj)) in info.route_to_exit.iter().enumerate() {
                assert_eq!(
                    di.abs() + dj.abs(),
                    1,
                    "L{level} step {n}: {di},{dj} is not a unit cardinal"
                );
                here = TilePos {
                    i: here.i + di,
                    j: here.j + dj,
                };
                assert!(
                    is_walkable(g, here.i, here.j),
                    "L{level} step {n} lands on a wall at {here:?}"
                );
            }
            assert_eq!(
                here, info.provisional_exit_tile,
                "L{level}: the route ends somewhere that is not the exit"
            );
        }
    }

    /// The derivation is a pure function of its two arguments — asserted rather
    /// than assumed, because `derive_floor_spec` DRAWS and a stream left in the
    /// wrong place would make the second call a different floor.
    #[test]
    fn a_spec_is_a_pure_function_of_level_and_seed() {
        let a = derive_floor_spec(3, 1);
        let b = derive_floor_spec(3, 1);
        assert_eq!(a.floor_seed, b.floor_seed);
        assert_eq!(a.density, b.density);
        assert_eq!(a.rng.draws(), b.rng.draws());
        let c = derive_floor_spec(3, 2);
        assert_ne!(
            a.floor_seed, c.floor_seed,
            "the run seed must reach the floor"
        );
    }

    /// The grid a spec asks for is `2c + 1` a side. Pinned here as well as in the
    /// parity harness because the shell allocates from `spec.w`/`spec.h` and a
    /// mis-derived size is a floor that renders at the wrong scale rather than a
    /// digest mismatch.
    #[test]
    fn the_grid_is_two_cells_plus_one_on_each_axis() {
        for level in 1..=12 {
            let s = derive_floor_spec(level, 1);
            assert_eq!(s.w, s.cells_w * 2 + 1, "L{level} width");
            assert_eq!(s.h, s.cells_h * 2 + 1, "L{level} height");
        }
    }

    /// The clamp, on both sides. No corpus floor's windiness lands outside
    /// [0.35, 0.85], so this range is untested by every replay — the same hole
    /// `constants_the_corpus_cannot_discriminate_match_the_oracle` exists to fill
    /// one level down.
    #[test]
    fn density_is_the_windiness_roll_clamped_on_both_ends() {
        for level in 1..=20 {
            let d = derive_floor_spec(level, 7).density;
            assert!(
                (DENSITY_RANGE.0..=DENSITY_RANGE.1).contains(&d),
                "L{level}: density {d} escaped the clamp"
            );
        }
        // Level 1 draws no windiness and returns 1.0, which the clamp pins to
        // the TOP of the range — the one level where the clamp is load-bearing.
        assert_eq!(derive_floor_spec(1, 1).density, DENSITY_RANGE.1);
    }

    /// A probe's two halves disagree about a body that never moved and about one
    /// that walked through the wall. Unit-tested on synthetic numbers rather than
    /// only through a floor, so the verdict arithmetic is pinned independently of
    /// whatever the corpus happens to produce.
    #[test]
    fn a_probe_fails_a_frozen_body_and_a_body_inside_the_wall() {
        let p = WallProbe {
            from: [32.0, 2.0],
            input: [0, -1],
            ticks: 12,
            wall_tile: [75, 31],
            expected_blocked_axis: "z".into(),
            max_allowed_travel: 1.8,
        };
        assert_eq!(p.axis_index(), 1);
        assert!((p.gap() - 0.2).abs() < 1e-12);
        // Never moved: the collision half is satisfied and the run still fails.
        let frozen = p.verdict(2.0);
        assert!(!frozen.reached && frozen.overshoot < 0.0 && !frozen.passed());
        // Pressed against the wall with the sim's own back-off.
        assert!(p.verdict(1.8001).passed());
        // One millimetre inside it.
        let through = p.verdict(1.799);
        assert!(through.reached && through.overshoot > 0.0 && !through.passed());
        // The mirrored direction, so the sign handling is not only tested on
        // one side: travelling +z toward a wall at 5.0.
        let q = WallProbe {
            input: [0, 1],
            max_allowed_travel: 5.0,
            from: [0.0, 4.8],
            ..p
        };
        assert!(q.verdict(4.9999).passed());
        assert!(!q.verdict(5.2).passed());
        assert!(!q.verdict(4.8).reached);
    }
}
