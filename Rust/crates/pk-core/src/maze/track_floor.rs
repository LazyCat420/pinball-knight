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
//! PORTS: `maze/track-floor.ts` — all 23 passes ported bit-exact

use std::collections::HashSet;

use super::arc_contract::compact_arcs;
use super::arc_sweeps::{
    author_arc_sweeps, orient_arc_rails, stamp_orbit_island, OrbitSite, ORBIT_RADIUS, ORBIT_RING,
};
use super::archetypes::TrackProfile;
use super::artery_banks::{author_artery_banks, trace_artery};
use super::doorway_funnels::author_doorway_funnels;
use super::doorways::{
    self, arc_span_mask, carve_doorways, clearance_field, width_from_clearance, CarveGuards,
    Doorway,
};
use super::floor_metrics::DEFAULT_CONSTRAINTS;
use super::floor_rules::{
    BOSS_ARENA_MIN_WIDTH, BOSS_ARENA_R, DEFAULT_RULE_WEIGHTS,
};
use super::flow_orient::build_flow_field;
use super::nearest_open_tile::nearest_open_tile;
use super::relay_chambers::author_relay_chambers;
use super::track_carve::{
    carve_chamber, carve_track, connect_all, grow_maze_around, publish_arcs, sealed_walls,
};
use super::track_grow::{circuit_rank, grow_track, GrowTrackOpts, TrackGraph};
use super::track_launch::{
    carve_launch_chute, chute_tiles, perimeter_score, reseal_chute, LaunchChute, TilePos,
    PERIMETER_RULE_MIN,
};
use super::track_path::{build_track_path, TrackPath, TrackPathOpts};
use super::track_socket::{
    heal_road_terminations, near_sealed, remove_wall_stubs, uncarve_dead_ends,
};
use super::{CountingRng, Extra, PassSnapshot, TrackMask};
use crate::flow_field::bfs_distances;
use crate::grid::{idx, is_walkable, set_tile, Grid, T_STAIRS};
use crate::jsmath::js_hypot;
use crate::maze::archetypes::track_node_counts;

/// Walls the connectivity repair should route AROUND if it can: a sealed lane's
/// side walls, plus every wall tile that carries a published arc face.
fn repair_keep_out(g: &Grid, mask: &TrackMask) -> Vec<u8> {
    let mut out = sealed_walls(g, mask);
    if let Some(ai) = g.arc_idx.as_ref() {
        for (k, &a) in ai.iter().enumerate() {
            if a >= 0 {
                out[k] = 1;
            }
        }
    }
    out
}

/// What [`pick_track_endpoints`] decided, and what it had to stand down on.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TrackEnds {
    pub start: TilePos,
    pub stairs: TilePos,
    /// `["boss-not-within-sight-of-spawn"]` when the sight-line floor could not
    /// be met by any tie band — see `far`'s relaxation ladder.
    pub relaxed: Vec<String>,
}

/// WHERE THE FLOOR OPENS AND WHERE IT LETS YOU OUT — both on the circuit.
pub fn pick_track_endpoints(
    g: &Grid,
    mask: &TrackMask,
    chute: Option<&LaunchChute>,
    perimeter_bias: f64,
    min_boss_euclid: f64,
    stairs_in: Option<&dyn Fn(i32, i32) -> bool>,
) -> Option<TrackEnds> {
    let mut lane: Vec<TilePos> = Vec::new();
    for j in 0..g.h {
        for i in 0..g.w {
            if mask.lane[idx(g, i, j)] != 0 && is_walkable(g, i, j) {
                lane.push(TilePos { i, j });
            }
        }
    }
    if lane.len() < 2 {
        return None;
    }

    const TIE: f64 = 0.92;

    let far = |from: TilePos, eye: TilePos| -> (TilePos, i32, bool) {
        let dist = bfs_distances(g, from.i, from.j);
        let mut best = -1_i32;
        for p in &lane {
            let d = dist[idx(g, p.i, p.j)];
            if d > best && d < 0x3fffffff {
                best = d;
            }
        }
        if best <= 0 {
            return (from, best, false);
        }
        let in_band = |tie: f64| -> Vec<TilePos> {
            lane.iter()
                .copied()
                .filter(|p| {
                    let d = dist[idx(g, p.i, p.j)];
                    (d as f64) >= (best as f64) * tie && d < 0x3fffffff
                })
                .collect()
        };
        let clear_of = |tiles: &[TilePos]| -> Vec<TilePos> {
            tiles
                .iter()
                .copied()
                .filter(|p| {
                    js_hypot(f64::from(p.i - eye.i), f64::from(p.j - eye.j)) >= min_boss_euclid
                })
                .collect()
        };

        let mut band = in_band(TIE);
        let mut clear = clear_of(&band);
        for tie in [0.8, 0.65, 0.5] {
            if !clear.is_empty() || min_boss_euclid <= 0.0 {
                break;
            }
            band = in_band(tie);
            clear = clear_of(&band);
        }

        let pool: &[TilePos] = if clear.is_empty() { &band } else { &clear };
        let relaxed = clear.is_empty() && !band.is_empty() && min_boss_euclid > 0.0;

        let hall: Vec<TilePos> = match stairs_in {
            Some(f) => pool.iter().copied().filter(|p| f(p.i, p.j)).collect(),
            None => Vec::new(),
        };
        let choose: &[TilePos] = if hall.is_empty() { pool } else { &hall };
        let mut best_pos = from;
        let mut best_score = f64::INFINITY;
        for p in choose {
            let d = dist[idx(g, p.i, p.j)];
            let euclid = js_hypot(f64::from(p.i - eye.i), f64::from(p.j - eye.j));
            let wind = js_hypot(f64::from(p.i - from.i), f64::from(p.j - from.j));
            let score = if relaxed {
                -euclid
            } else {
                wind / f64::from(d)
            };
            if score < best_score {
                best_score = score;
                best_pos = *p;
            }
        }
        (best_pos, dist[idx(g, best_pos.i, best_pos.j)], relaxed)
    };

    let start_band = |from: TilePos| -> TilePos {
        let dist = bfs_distances(g, from.i, from.j);
        let mut best = -1_i32;
        for p in &lane {
            let d = dist[idx(g, p.i, p.j)];
            if d > best && d < 0x3fffffff {
                best = d;
            }
        }
        if best <= 0 {
            return from;
        }
        let mut pick = from;
        let mut pick_score = f64::NEG_INFINITY;
        for p in &lane {
            let d = dist[idx(g, p.i, p.j)];
            if (d as f64) < (best as f64) * TIE || d >= 0x3fffffff {
                continue;
            }
            let sc = perimeter_bias * perimeter_score(g, p.i, p.j)
                + (f64::from(d) / f64::from(1.max(best))) * 0.001;
            if sc > pick_score {
                pick_score = sc;
                pick = *p;
            }
        }
        pick
    };

    let a = match chute {
        Some(c) => c.base,
        None => start_band(lane[0]),
    };
    let (pos, d, was_relaxed) = far(
        match chute {
            Some(c) => c.mouth,
            None => a,
        },
        a,
    );
    if d <= 0 {
        return None;
    }
    Some(TrackEnds {
        start: a,
        stairs: pos,
        relaxed: if was_relaxed {
            vec!["boss-not-within-sight-of-spawn".to_string()]
        } else {
            Vec::new()
        },
    })
}

/// How many of `PASS_ORDER`'s 23 boundaries [`build_track_floor`] currently reaches.
pub const PASSES_LANDED: usize = 23;

#[derive(Clone, Debug, PartialEq)]
pub struct BossRoom {
    pub ci: i32,
    pub cj: i32,
    pub r: f64,
}

pub fn carve_boss_chamber(
    g: &mut Grid,
    mask: &mut TrackMask,
    stairs: TilePos,
    clearance: &[i32],
    orbit: Option<&OrbitSite>,
) -> Option<BossRoom> {
    let r = BOSS_ARENA_R;
    let r_i = r as i32;
    if width_from_clearance(clearance[idx(g, stairs.i, stairs.j)]) >= BOSS_ARENA_MIN_WIDTH + 2 {
        return None;
    }
    const SLIDE: i32 = 1;
    for dj in -SLIDE..=SLIDE {
        for di in -SLIDE..=SLIDE {
            let ci = stairs.i + di;
            let cj = stairs.j + dj;
            if ci - r_i < 2 || cj - r_i < 2 || ci + r_i > g.w - 3 || cj + r_i > g.h - 3 {
                continue;
            }
            let mut touches_sealed = false;
            'probe: for y in (cj - r_i)..=(cj + r_i) {
                for x in (ci - r_i)..=(ci + r_i) {
                    if (x - ci) * (x - ci) + (y - cj) * (y - cj) > r_i * r_i {
                        continue;
                    }
                    if x < 0 || y < 0 || x >= g.w || y >= g.h {
                        continue;
                    }
                    if near_sealed(g, mask, x, y) {
                        touches_sealed = true;
                        break 'probe;
                    }
                }
            }
            if touches_sealed {
                continue;
            }
            if let Some(orb) = orbit {
                let need = r + ORBIT_RADIUS + ORBIT_RING;
                if ((orb.ci - ci) as f64).hypot((orb.cj - cj) as f64) < need {
                    continue;
                }
            }
            if !carve_chamber(g, mask, ci as f64, cj as f64, r) {
                continue;
            }
            return Some(BossRoom { ci, cj, r });
        }
    }
    None
}

/// What the pipeline hands back.
#[derive(Debug)]
pub struct TrackFloor {
    pub grid: Grid,
    pub graph: TrackGraph,
    pub path: TrackPath,
    pub mask: TrackMask,
    pub start: TilePos,
    pub stairs: TilePos,
    pub chute: Option<LaunchChute>,
    pub orbit: Option<OrbitSite>,
    pub relaxed: Vec<String>,
    pub doorways: Vec<Doorway>,
    pub boss_room: Option<BossRoom>,
    pub ends: Option<TrackEnds>,
    pub door_sites: Vec<doorways::DoorwaySite>,
    pub door_guard: Vec<u8>,
}

/// Knobs `authorFloor` hands the pipeline. `None` means "take the profile's".
#[derive(Clone, Debug, Default)]
pub struct BuildTrackFloorOpts<'a> {
    pub profile: Option<&'a TrackProfile>,
    pub min_loops: Option<i64>,
    pub link_chance: Option<f64>,
    pub fill: Option<f64>,
    pub density: Option<f64>,
    pub funnels: bool,
    pub relays: bool,
}

/// Build a floor. `None` when the circuit came out unusable.
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
            sites: None,
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
            sites: None,
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
            sites: None,
            draws: rng.draws(),
            extra: Vec::new(),
        });
    }

    // ── 4. plaza ────────────────────────────────────────────────────────────
    let mut plaza_relaxed: Vec<String> = Vec::new();
    if prof.plaza_frac > 0.0 && !graph.nodes.is_empty() {
        let cx = f64::from(w) / 2.0;
        let cz = f64::from(h) / 2.0;
        let mut hub = &graph.nodes[0];
        for n in &graph.nodes {
            if (n.x - cx).powi(2) + (n.z - cz).powi(2) < (hub.x - cx).powi(2) + (hub.z - cz).powi(2)
            {
                hub = n;
            }
        }
        let want = f64::from(w.min(h)) * prof.plaza_frac;
        let mut carved = false;
        let mut r = want;
        while r >= want * 0.6 && !carved {
            carved = carve_chamber(&mut grid, &mut mask, hub.x, hub.z, r);
            r -= 1.0;
        }
        if !carved {
            plaza_relaxed.push("archetype-has-its-chamber".to_string());
        }
    }
    if let Some(p) = on_pass.as_mut() {
        p(PassSnapshot {
            pass: "plaza",
            grid: &grid,
            mask: Some(&mask),
            sites: None,
            draws: rng.draws(),
            extra: vec![("relaxed", Extra::Strs(plaza_relaxed.clone()))],
        });
    }

    // ── 5. launch-chute ─────────────────────────────────────────────────────
    let rules = prof.rules.resolve();
    let bias = rules.perimeter_bias;
    let min_boss_euclid = rules.min_boss_euclid;
    let chute = carve_launch_chute(&mut grid, &mut mask, rng, bias);
    if let Some(p) = on_pass.as_mut() {
        p(PassSnapshot {
            pass: "launch-chute",
            grid: &grid,
            mask: Some(&mask),
            sites: None,
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
    grow_maze_around(
        &mut grid,
        &mask,
        rng,
        1,
        opts.link_chance.unwrap_or(prof.link_chance),
        opts.density.unwrap_or(0.62),
        opts.fill.unwrap_or(prof.fill),
    );
    if let Some(p) = on_pass.as_mut() {
        p(PassSnapshot {
            pass: "grow-maze",
            grid: &grid,
            mask: Some(&mask),
            sites: None,
            draws: rng.draws(),
            extra: Vec::new(),
        });
    }

    // ── 7. endpoints-early ──────────────────────────────────────────────────
    let ends_early =
        pick_track_endpoints(&grid, &mask, chute.as_ref(), bias, min_boss_euclid, None);
    let protect: Vec<TilePos> = match &ends_early {
        Some(e) => vec![e.start, e.stairs],
        None => Vec::new(),
    };
    if let Some(p) = on_pass.as_mut() {
        p(PassSnapshot {
            pass: "endpoints-early",
            grid: &grid,
            mask: Some(&mask),
            sites: None,
            draws: rng.draws(),
            extra: vec![
                (
                    "start",
                    match &ends_early {
                        Some(e) => Extra::Ints(vec![i64::from(e.start.i), i64::from(e.start.j)]),
                        None => Extra::Null,
                    },
                ),
                (
                    "stairs",
                    match &ends_early {
                        Some(e) => Extra::Ints(vec![i64::from(e.stairs.i), i64::from(e.stairs.j)]),
                        None => Extra::Null,
                    },
                ),
            ],
        });
    }

    // ── 8. repair-1 ─────────────────────────────────────────────────────────
    repair(&mut grid, &mut mask, &protect, ends_early.is_some());
    if let Some(p) = on_pass.as_mut() {
        p(PassSnapshot {
            pass: "repair-1",
            grid: &grid,
            mask: Some(&mask),
            sites: None,
            draws: rng.draws(),
            extra: Vec::new(),
        });
    }

    // ── 9. plan-doorways ────────────────────────────────────────────────────
    let door_sites = doorways::plan_doorways(&grid, &doorways::PlanOpts::default());
    let mut door_guard = vec![0_u8; (grid.w * grid.h) as usize];
    let mut guard_count = 0_i64;
    for s in &door_sites {
        let guards = doorways::CarveGuards {
            mask: Some(&mask),
            span_mask: None,
        };
        if let Some(d) = doorways::resolve_doorway(&grid, s, &guards) {
            for t in doorways::doorway_footprint(&d) {
                let k = idx(&grid, t.i, t.j);
                if door_guard[k] == 0 {
                    door_guard[k] = 1;
                    guard_count += 1;
                }
            }
        }
    }
    if let Some(p) = on_pass.as_mut() {
        p(PassSnapshot {
            pass: "plan-doorways",
            grid: &grid,
            mask: Some(&mask),
            sites: Some(&door_sites),
            draws: rng.draws(),
            extra: vec![
                ("sites", Extra::Int(door_sites.len() as i64)),
                ("guard", Extra::Int(guard_count)),
            ],
        });
    }

    let arc_counts = |g: &Grid| -> Vec<(&'static str, Extra)> {
        let arcs = g.arcs.len() as i64;
        let lanes = g.arcs.iter().map(|f| f.lanes.len()).sum::<usize>() as i64;
        vec![("arcs", Extra::Int(arcs)), ("lanes", Extra::Int(lanes))]
    };

    // ── 10. publish-arcs ────────────────────────────────────────────────────
    publish_arcs(&mut grid, &path);
    if let Some(p) = on_pass.as_mut() {
        p(PassSnapshot {
            pass: "publish-arcs",
            grid: &grid,
            mask: Some(&mask),
            sites: None,
            draws: rng.draws(),
            extra: arc_counts(&grid),
        });
    }

    // ── 11. orbit-island ────────────────────────────────────────────────────
    let arc_start = match &ends_early {
        Some(e) => e.start,
        None => TilePos { i: 1, j: 1 },
    };
    let grid_w = grid.w;
    let grid_h = grid.h;
    let on_doorway = |i: i32, j: i32| -> bool {
        if i < 0 || j < 0 || i >= grid_w || j >= grid_h {
            false
        } else {
            door_guard[(j * grid_w + i) as usize] == 1
        }
    };
    let orbit = stamp_orbit_island(&mut grid, arc_start, &on_doorway, rng);
    if let Some(p) = on_pass.as_mut() {
        let mut extra = arc_counts(&grid);
        extra.push((
            "orbit",
            match &orbit {
                Some(o) => Extra::Ints(vec![o.ci as i64, o.cj as i64]),
                None => Extra::Null,
            },
        ));
        p(PassSnapshot {
            pass: "orbit-island",
            grid: &grid,
            mask: Some(&mask),
            sites: None,
            draws: rng.draws(),
            extra,
        });
    }

    // ── 12. arc-sweeps ──────────────────────────────────────────────────────
    author_arc_sweeps(&mut grid, arc_start, &on_doorway, rng);
    if let Some(p) = on_pass.as_mut() {
        p(PassSnapshot {
            pass: "arc-sweeps",
            grid: &grid,
            mask: Some(&mask),
            sites: None,
            draws: rng.draws(),
            extra: arc_counts(&grid),
        });
    }

    // ── 13. repair-2 ────────────────────────────────────────────────────────
    repair(&mut grid, &mut mask, &protect, ends_early.is_some());
    if let Some(p) = on_pass.as_mut() {
        p(PassSnapshot {
            pass: "repair-2",
            grid: &grid,
            mask: Some(&mask),
            sites: None,
            draws: rng.draws(),
            extra: Vec::new(),
        });
    }

    // ── 14. endpoints-final ─────────────────────────────────────────────────
    let ends = pick_track_endpoints(&grid, &mask, chute.as_ref(), bias, min_boss_euclid, None);
    let Some(ends) = ends else {
        return None;
    };
    if let Some(p) = on_pass.as_mut() {
        p(PassSnapshot {
            pass: "endpoints-final",
            grid: &grid,
            mask: Some(&mask),
            sites: None,
            draws: rng.draws(),
            extra: vec![
                ("start", Extra::Ints(vec![ends.start.i as i64, ends.start.j as i64])),
                ("stairs", Extra::Ints(vec![ends.stairs.i as i64, ends.stairs.j as i64])),
                ("relaxed", Extra::Strs(ends.relaxed.clone())),
            ],
        });
    }

    // ── 15. boss-chamber ────────────────────────────────────────────────────
    let route_from = match &chute {
        Some(c) => c.mouth,
        None => ends.start,
    };
    let route_ok = |g: &Grid| -> bool {
        let d = bfs_distances(g, route_from.i, route_from.j);
        let len = d[idx(g, ends.stairs.i, ends.stairs.j)];
        if len < 0 {
            return false;
        }
        if (len as f64) < ((g.w + g.h) as f64) * DEFAULT_CONSTRAINTS.min_path_span {
            return false;
        }
        let euclid = ((ends.stairs.i - route_from.i) as f64).hypot((ends.stairs.j - route_from.j) as f64);
        len == 0 || euclid / (len as f64) <= DEFAULT_CONSTRAINTS.max_directness
    };
    let tiles_before = grid.t.clone();
    let lane_before = mask.lane.clone();
    let shapes_before = grid.shapes.clone();
    let clearance = clearance_field(&grid);
    let mut boss_room = carve_boss_chamber(&mut grid, &mut mask, ends.stairs, &clearance, orbit.as_ref());
    if boss_room.is_some() {
        repair(&mut grid, &mut mask, &[ends.start, ends.stairs], true);
    }
    if boss_room.is_some() && !route_ok(&grid) {
        grid.t = tiles_before;
        grid.shapes = shapes_before;
        mask.lane = lane_before;
        boss_room = None;
    }
    if let Some(p) = on_pass.as_mut() {
        p(PassSnapshot {
            pass: "boss-chamber",
            grid: &grid,
            mask: Some(&mask),
            sites: None,
            draws: rng.draws(),
            extra: vec![(
                "boss",
                match &boss_room {
                    Some(b) => Extra::Ints(vec![b.ci as i64, b.cj as i64, b.r as i64]),
                    None => Extra::Null,
                },
            )],
        });
    }

    let in_boss_room = |i: i32, j: i32| -> bool {
        if let Some(ref b) = boss_room {
            let dx = i as f64 + 0.5 - b.ci as f64;
            let dz = j as f64 + 0.5 - b.cj as f64;
            dx * dx + dz * dz <= (b.r - 1.0) * (b.r - 1.0)
        } else {
            false
        }
    };

    // ── 16. artery-banks ────────────────────────────────────────────────────
    let artery_dist = bfs_distances(&grid, ends.start.i, ends.start.j);
    let artery = trace_artery(&grid, ends.start, ends.stairs, &artery_dist);
    if artery.len() >= 8 {
        let mut guarded = HashSet::new();
        for (k, &g) in door_guard.iter().enumerate() {
            if g == 1 {
                guarded.insert(k);
            }
        }
        if let Some(ref ch) = chute {
            for t in chute_tiles(&grid, ch) {
                guarded.insert(idx(&grid, t.i, t.j));
            }
        }
        for (k, &s) in mask.sealed.iter().enumerate() {
            if s == 1 {
                guarded.insert(k);
            }
        }
        let is_guarded = |i: i32, j: i32| -> bool {
            (i >= 0 && j >= 0 && i < grid_w && j < grid_h && guarded.contains(&((j * grid_w + i) as usize))) || in_boss_room(i, j)
        };
        author_artery_banks(&mut grid, &artery, ends.start, &|_, _| false, &is_guarded);
        repair(&mut grid, &mut mask, &[ends.start, ends.stairs], true);
    }
    if let Some(p) = on_pass.as_mut() {
        let mut extra = arc_counts(&grid);
        extra.push(("artery", Extra::Int(artery.len() as i64)));
        p(PassSnapshot {
            pass: "artery-banks",
            grid: &grid,
            mask: Some(&mask),
            sites: None,
            draws: rng.draws(),
            extra,
        });
    }

    // ── 17. reseal-chute ────────────────────────────────────────────────────
    if let Some(ref ch) = chute {
        let start_pos = ends.start;
        reseal_chute(&mut grid, &mask, ch, move |g_cand| {
            let d = bfs_distances(g_cand, start_pos.i, start_pos.j);
            for j in 0..g_cand.h {
                for i in 0..g_cand.w {
                    if is_walkable(g_cand, i, j) && d[idx(g_cand, i, j)] < 0 {
                        return false;
                    }
                }
            }
            true
        });
    }
    if let Some(p) = on_pass.as_mut() {
        p(PassSnapshot {
            pass: "reseal-chute",
            grid: &grid,
            mask: Some(&mask),
            sites: None,
            draws: rng.draws(),
            extra: Vec::new(),
        });
    }

    // ── 18. carve-doorways ──────────────────────────────────────────────────
    let span_mask = arc_span_mask(&grid);
    let doors = carve_doorways(&mut grid, &door_sites, &CarveGuards {
        mask: Some(&mask),
        span_mask: Some(&span_mask),
    });
    if let Some(p) = on_pass.as_mut() {
        p(PassSnapshot {
            pass: "carve-doorways",
            grid: &grid,
            mask: Some(&mask),
            sites: None,
            draws: rng.draws(),
            extra: vec![("doorways", Extra::Int(doors.doorways.len() as i64))],
        });
    }

    // ── 19. funnels-relays ──────────────────────────────────────────────────
    if opts.funnels {
        let sealed_mask = mask.sealed.clone();
        author_doorway_funnels(
            &mut grid,
            &doors.doorways,
            (ends.start.i, ends.start.j),
            move |i, j| crate::maze::track_socket::near_sealed_coords(grid_w, grid_h, &sealed_mask, i, j),
            None,
            None,
            None,
        );
    }
    if opts.relays {
        let sealed_mask = mask.sealed.clone();
        author_relay_chambers(
            &mut grid,
            &doors.doorways,
            ends.start,
            move |i, j| crate::maze::track_socket::near_sealed_coords(grid_w, grid_h, &sealed_mask, i, j),
            &Default::default(),
        );
    }
    if opts.funnels || opts.relays {
        repair(&mut grid, &mut mask, &[ends.start, ends.stairs], true);
        crate::maze::arc_contract::clear_orphan_arc_tiles(&mut grid);
    }
    if let Some(p) = on_pass.as_mut() {
        p(PassSnapshot {
            pass: "funnels-relays",
            grid: &grid,
            mask: Some(&mask),
            sites: None,
            draws: rng.draws(),
            extra: vec![
                ("funnels", Extra::Int(if opts.funnels { 1 } else { 0 })),
                ("relays", Extra::Int(if opts.relays { 1 } else { 0 })),
            ],
        });
    }

    // ── 20. compact-fixed-point ─────────────────────────────────────────────
    for _ in 0..8 {
        compact_arcs(&mut grid, 3);
        if remove_wall_stubs(&mut grid, Some(&mask), 3, 32) == 0 {
            break;
        }
    }
    compact_arcs(&mut grid, 3);
    if let Some(p) = on_pass.as_mut() {
        p(PassSnapshot {
            pass: "compact-fixed-point",
            grid: &grid,
            mask: Some(&mask),
            sites: None,
            draws: rng.draws(),
            extra: arc_counts(&grid),
        });
    }

    // ── 21. stairs ──────────────────────────────────────────────────────────
    set_tile(&mut grid, ends.stairs.i, ends.stairs.j, T_STAIRS);
    if let Some(p) = on_pass.as_mut() {
        p(PassSnapshot {
            pass: "stairs",
            grid: &grid,
            mask: Some(&mask),
            sites: None,
            draws: rng.draws(),
            extra: vec![("stairs", Extra::Ints(vec![ends.stairs.i as i64, ends.stairs.j as i64]))],
        });
    }

    // ── 22. arc-rails ───────────────────────────────────────────────────────
    let phi = build_flow_field(&grid, crate::maze::flow_orient::TilePos { i: ends.stairs.i, j: ends.stairs.j });
    orient_arc_rails(&mut grid, &phi);
    if let Some(p) = on_pass.as_mut() {
        p(PassSnapshot {
            pass: "arc-rails",
            grid: &grid,
            mask: Some(&mask),
            sites: None,
            draws: rng.draws(),
            extra: arc_counts(&grid),
        });
    }

    // ── 23. done ────────────────────────────────────────────────────
    let mut relaxed_final = ends.relaxed.clone();
    relaxed_final.extend(plaza_relaxed);
    {
        let dist = bfs_distances(&grid, ends.start.i, ends.start.j);
        let want = prof.rules.min_boss_tiles.unwrap_or(DEFAULT_RULE_WEIGHTS.min_boss_tiles as f64) as i32;
        let boss_spot = nearest_open_tile(&grid, ends.stairs.i, ends.stairs.j, 2, 1).unwrap_or(ends.stairs);
        let d_boss = dist[idx(&grid, boss_spot.i, boss_spot.j)];
        let d_exit = dist[idx(&grid, ends.stairs.i, ends.stairs.j)];
        if d_boss >= 0 && d_boss < want {
            relaxed_final.push("boss-not-near-spawn".to_string());
        }
        if d_exit >= 0 && d_exit < want {
            relaxed_final.push("exit-not-near-spawn".to_string());
        }
        let euclid_want = prof.rules.min_boss_euclid.unwrap_or(DEFAULT_RULE_WEIGHTS.min_boss_euclid);
        let euclid = ((boss_spot.i - ends.start.i) as f64).hypot((boss_spot.j - ends.start.j) as f64);
        if euclid < euclid_want && !relaxed_final.contains(&"boss-not-within-sight-of-spawn".to_string()) {
            relaxed_final.push("boss-not-within-sight-of-spawn".to_string());
        }
    }
    if bias >= 0.5 && perimeter_score(&grid, ends.start.i, ends.start.j) < PERIMETER_RULE_MIN {
        let available = match chute.as_ref() {
            Some(ch) => ch.edge_best,
            None => {
                let mut m = 0.0_f64;
                for j in 0..grid.h {
                    for i in 0..grid.w {
                        if mask.lane[idx(&grid, i, j)] == 1 && is_walkable(&grid, i, j) {
                            m = m.max(perimeter_score(&grid, i, j));
                        }
                    }
                }
                m
            }
        };
        if available < PERIMETER_RULE_MIN {
            relaxed_final.push("spawn-respects-perimeter-bias".to_string());
        }
    }
    if boss_room.is_none() || !in_boss_room(ends.stairs.i, ends.stairs.j) {
        relaxed_final.push("boss-has-room-to-fight".to_string());
    }

    if let Some(p) = on_pass.as_mut() {
        p(PassSnapshot {
            pass: "done",
            grid: &grid,
            mask: Some(&mask),
            sites: None,
            draws: rng.draws(),
            extra: vec![("relaxed", Extra::Strs(relaxed_final.clone()))],
        });
    }

    Some(TrackFloor {
        grid,
        graph,
        path,
        mask,
        start: ends.start,
        stairs: ends.stairs,
        chute,
        orbit,
        relaxed: relaxed_final,
        doorways: doors.doorways,
        boss_room,
        ends: Some(ends),
        door_sites,
        door_guard,
    })
}

pub fn floor_circuit_rank(f: &TrackFloor) -> usize {
    circuit_rank(&f.graph) as usize
}

/// The four repair passes, in the one order that is safe.
fn repair(grid: &mut Grid, mask: &mut TrackMask, keep: &[TilePos], heal: bool) {
    uncarve_dead_ends(grid, Some(mask), keep, None, None);
    let avoid = repair_keep_out(grid, mask);
    connect_all(grid, Some(&avoid));
    remove_wall_stubs(grid, Some(mask), 3, 32);
    if heal {
        heal_road_terminations(grid, mask, keep, 0);
    }
}
