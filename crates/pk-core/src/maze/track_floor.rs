//! `buildTrackFloor` — the 23-pass pipeline itself.
//!
//! Port of `legacy/src/game/pinball-knight/maze/track-floor.ts`. The individual
//! passes live in their own modules ([`super::track_grow`], [`super::track_path`],
//! [`super::track_carve`], …); this file is the ORDER, which the legacy source
//! calls the contract in two separate places and is right to. Every pass draws
//! from one shared rng stream and mutates the grid the next one reads, so
//! reordering any two changes every draw after them — into a completely
//! different floor that renders perfectly, throws nothing, and passes every
//! property test, because "connected", "solvable" and "has an exit" are all
//! still true of the wrong floor.
//!
//! ## Landing incrementally, and what that means for callers
//!
//! Passes arrive one at a time, each bit-identical at its boundary before the
//! next starts. Until all 23 land, [`build_track_floor`] returns a floor that is
//! correct as far as it goes and unfinished after that — it is driven by the
//! parity harness, not by the game, and `pk_core::state::demo_floor` is still
//! what the shell builds. [`PASSES_LANDED`] says how far it gets, and the replay
//! test reads that number rather than carrying its own copy.
//!
//! ## The probe
//!
//! `on_pass` is the twin of the TS `onPass` hook: it consumes no rng, allocates
//! nothing into the floor, and never touches the grid, so a floor built with a
//! probe is bit-identical to one built without. The TS makes `extra` a thunk so
//! an unobserved floor pays nothing; here the same job is done by building the
//! `PassExtra` only inside the `if let Some(p)`.
//!
//! Every emit site is `on_pass.as_mut()` — including the LAST one, where
//! `on_pass` could be moved instead. Uniform on purpose: the last emit stops
//! being the last one the moment the next pass lands, and a form that only
//! compiles while it is last is a trap set for that commit.

use super::archetypes::TrackProfile;
use super::track_carve::carve_chamber;
use super::track_grow::{grow_track, GrowTrackOpts, TrackGraph};
use super::track_launch::{carve_launch_chute, LaunchChute};
use super::track_path::{build_track_path, TrackPath, TrackPathOpts};
use super::{CountingRng, Extra, PassSnapshot, TrackMask};
use crate::grid::Grid;
use crate::maze::archetypes::track_node_counts;
use crate::maze::track_carve::{carve_track, grow_maze_around};

/// How many of `PASS_ORDER`'s 23 boundaries [`build_track_floor`] currently
/// reaches. Bumped in the same commit as the pass it counts.
///
/// A number rather than a comment because the replay test asserts against it:
/// a pass that lands without being counted here, or a count raised without a
/// pass, fails rather than silently changing what is under test.
pub const PASSES_LANDED: usize = 6;

/// What the pipeline hands back. Grows a field at a time with the passes that
/// author them — `start`/`stairs` at pass 7, `chute` at pass 5, and so on.
#[derive(Debug)]
pub struct TrackFloor {
    pub grid: Grid,
    pub graph: TrackGraph,
    pub path: TrackPath,
    pub mask: TrackMask,
    /// The plunger lane, or `None` when no straight sealed run fitted. When
    /// present, `start` IS `chute.base` — the floor opens parked at the closed
    /// end, and firing runs the hallway before the maze begins.
    pub chute: Option<LaunchChute>,
    /// Rules the generator could not satisfy and DELIBERATELY stood down on.
    ///
    /// Recorded rather than silently relaxed: constraints like "open at the
    /// edge" and "give the chute a long straight sealed run" can be jointly
    /// unsatisfiable on a floor whose circuit never reaches the border, and a
    /// rule that quietly gives up is indistinguishable from one that broke.
    pub relaxed: Vec<String>,
}

/// Knobs `authorFloor` hands the pipeline. `None` means "take the profile's".
#[derive(Clone, Debug, Default)]
pub struct BuildTrackFloorOpts<'a> {
    pub profile: Option<&'a TrackProfile>,
    pub min_loops: Option<i64>,
    pub link_chance: Option<f64>,
    pub fill: Option<f64>,
    pub density: Option<f64>,
}

/// Build a floor. `None` when the circuit came out unusable — no edges after
/// the prune, or no rideable straight — which the caller answers by falling
/// back to the growing-tree generator.
///
/// `cells_w`/`cells_h` are CELL counts, not tiles: the grid is `2c + 1` on each
/// axis, so the odd-coordinate lattice the maze grows on lines up.
pub fn build_track_floor(
    cells_w: i32,
    cells_h: i32,
    rng: &mut CountingRng,
    opts: &BuildTrackFloorOpts<'_>,
    mut on_pass: Option<&mut dyn FnMut(PassSnapshot<'_>)>,
) -> Option<TrackFloor> {
    let w = cells_w * 2 + 1;
    let h = cells_h * 2 + 1;
    let mut grid = Grid::solid(w, h);

    let default_profile = super::archetypes::DEFAULT_TRACK_PROFILE;
    let prof = opts.profile.unwrap_or(&default_profile);
    let (foods, relays) = track_node_counts(prof, w, h);

    // ── 1. grow-track ───────────────────────────────────────────────────────
    let graph = grow_track(
        w,
        h,
        rng,
        &GrowTrackOpts {
            foods: Some(foods as usize),
            relays: Some(relays as usize),
            min_loops: Some(opts.min_loops.unwrap_or(i64::from(prof.min_loops))),
            layout: Some(prof.layout),
            max_len_frac: Some(prof.max_len_frac),
            survive: Some(prof.survive),
            grow: None,
        },
    );
    if graph.edges.is_empty() {
        return None;
    }
    if let Some(p) = on_pass.as_mut() {
        p(PassSnapshot {
            pass: "grow-track",
            grid: &grid,
            mask: None,
            draws: rng.draws(),
            extra: vec![
                ("nodes", Extra::Int(graph.nodes.len() as i64)),
                ("edges", Extra::Int(graph.edges.len() as i64)),
                ("foods", Extra::Int(i64::from(foods))),
                ("relays", Extra::Int(i64::from(relays))),
            ],
        });
    }

    // ── 2. track-path ───────────────────────────────────────────────────────
    let path = build_track_path(
        &graph,
        &TrackPathOpts {
            radii: None,
            lane_scale: Some(prof.lane_scale),
        },
    );
    if path.legs.is_empty() {
        return None;
    }
    if let Some(p) = on_pass.as_mut() {
        p(PassSnapshot {
            pass: "track-path",
            grid: &grid,
            mask: None,
            draws: rng.draws(),
            extra: vec![("legs", Extra::Int(path.legs.len() as i64))],
        });
    }

    // ── 3. carve-track ──────────────────────────────────────────────────────
    let mut mask = carve_track(&mut grid, &path);
    if let Some(p) = on_pass.as_mut() {
        p(PassSnapshot {
            pass: "carve-track",
            grid: &grid,
            mask: Some(&mask),
            draws: rng.draws(),
            extra: Vec::new(),
        });
    }

    // ── 4. plaza ────────────────────────────────────────────────────────────
    //
    // THE PLAZA GOES DOWN BEFORE THE MAZE, never after. Carved afterwards it
    // would bulldoze finished corridors and leave severed stubs pointing into
    // it; carved here it is simply part of the circuit, and the maze's keep-out
    // margin respects it like any other lane.
    //
    // AND IT HAS TO WIN. The Great Hall's card promises one vast chamber, and
    // censused over 36 floors it did not have the floor's biggest chamber —
    // a single `carveChamber` call that returned false on a bad site left the
    // archetype's only structural feature silently absent, with nothing
    // recording that it hadn't. So: try the largest radius the profile asks
    // for and step down until one fits, and if none does say so in `relaxed`
    // rather than shipping a Great Hall with no hall in it. Stepping down beats
    // moving the site, because the site is the topological centre of the
    // circuit and a chamber somewhere else is one the roads do not lead to.
    let mut relaxed: Vec<String> = Vec::new();
    if prof.plaza_frac > 0.0 && !graph.nodes.is_empty() {
        let cx = f64::from(w) / 2.0;
        let cz = f64::from(h) / 2.0;
        let mut hub = &graph.nodes[0];
        for n in &graph.nodes {
            // `(n.x - cx) ** 2` — squared distance, no sqrt, exactly as the TS.
            if (n.x - cx).powi(2) + (n.z - cz).powi(2) < (hub.x - cx).powi(2) + (hub.z - cz).powi(2)
            {
                hub = n;
            }
        }
        let want = f64::from(w.min(h)) * prof.plaza_frac;
        let mut carved = false;
        // `for (let r = want; r >= want * 0.6 && !carved; r -= 1)` — a f64
        // countdown, NOT an integer one: `want` is rarely integral and the
        // radii tried are `want`, `want-1`, … which are not whole numbers.
        let mut r = want;
        while r >= want * 0.6 && !carved {
            carved = carve_chamber(&mut grid, &mut mask, hub.x, hub.z, r);
            r -= 1.0;
        }
        if !carved {
            relaxed.push("archetype-has-its-chamber".to_string());
        }
    }
    if let Some(p) = on_pass.as_mut() {
        p(PassSnapshot {
            pass: "plaza",
            grid: &grid,
            mask: Some(&mask),
            draws: rng.draws(),
            extra: vec![("relaxed", Extra::Strs(relaxed.clone()))],
        });
    }

    // ── 5. launch-chute ─────────────────────────────────────────────────────
    //
    // Carved HERE, between the circuit and the maze, for the same reason the
    // plaza is: it must be part of the track by the time anything else looks at
    // the grid. Carved after `grow_maze_around` it would bulldoze finished
    // corridors; carved as decoration it would be a launch ritual with no lane
    // behind it. The archetype's spawn-placement weight reaches the chute here —
    // this call is what decides where the floor opens on 94% of floors.
    // `prof.rules?.perimeterBias ?? DEFAULT_RULE_WEIGHTS.perimeterBias` — the
    // profile carries only the keys it OVERRIDES, so the merge happens here.
    let bias = prof.rules.resolve().perimeter_bias;
    let chute = carve_launch_chute(&mut grid, &mut mask, rng, bias);
    if let Some(p) = on_pass.as_mut() {
        p(PassSnapshot {
            pass: "launch-chute",
            grid: &grid,
            mask: Some(&mask),
            draws: rng.draws(),
            extra: vec![(
                "chute",
                match &chute {
                    Some(c) => Extra::Ints(vec![
                        i64::from(c.base.i),
                        i64::from(c.base.j),
                        i64::from(c.mouth.i),
                        i64::from(c.mouth.j),
                    ]),
                    None => Extra::Null,
                },
            )],
        });
    }

    // ── 6. grow-maze ────────────────────────────────────────────────────────
    //
    // Everything the track did not claim, plus the on-ramps, plus the widening
    // pass and the connectivity repair behind it. This is where most of the
    // floor's rng goes.
    grow_maze_around(
        &mut grid,
        &mask,
        rng,
        // `margin` has no override in `authorFloor`; the legacy default is 1.
        1,
        opts.link_chance.unwrap_or(prof.link_chance),
        // ⚠️ `density` is `opts.density` with NO profile fallback — the TS passes
        // `density: opts.density`, which is `undefined` on every shipping call,
        // so `growMazeAround`'s own `?? 0.62` supplies it. Reading the profile
        // here would be a different floor.
        opts.density.unwrap_or(0.62),
        opts.fill.unwrap_or(prof.fill),
    );
    if let Some(p) = on_pass.as_mut() {
        p(PassSnapshot {
            pass: "grow-maze",
            grid: &grid,
            mask: Some(&mask),
            draws: rng.draws(),
            extra: Vec::new(),
        });
    }

    Some(TrackFloor {
        grid,
        graph,
        path,
        mask,
        chute,
        relaxed,
    })
}
