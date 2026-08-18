//! FLOOR METRICS — how we judge a generated floor, as numbers.
//!
//! Port of `legacy/src/game/pinball-knight/maze/floor-metrics.ts` (433 lines).
//!
//! PORTS: `maze/floor-metrics.ts`

use std::collections::{HashMap, HashSet};

use super::track_launch::TilePos;
use crate::flow_field::bfs_distances;
use crate::grid::{at, idx, is_walkable, Grid, T_WALL};

/// Coarse region size, in tiles, for the coverage sweep.
pub const REGION: usize = 24;

/// A region below this many floor tiles is a sliver and is not held to coverage.
pub const REGION_MIN_FLOOR: usize = 120;

/// Half-width of the neighbourhood a tile must have entirely open to count as "inside a room" (5x5).
pub const CHAMBER_R: i32 = 2;

/// Which walkable tiles belong to the floor's signature feature (the circuit).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaneMask {
    pub lane: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FloorMetrics {
    /// Total tiles in the grid, walls included.
    pub tiles: usize,
    /// Walkable tiles.
    pub walkable: usize,
    /// walkable ÷ tiles — how much of the rectangle is actually a floor.
    pub open_share: f64,
    /// Walkable tiles reachable from start ÷ walkable.
    pub reach_share: f64,
    /// BFS distance start → stairs, in tiles. -1 if exit is unreachable.
    pub path_len: i32,
    /// euclid(start, stairs) ÷ path_len.
    pub directness: f64,
    /// Direction changes along the traced route ÷ its length.
    pub turn_rate: f64,
    /// Walkable tiles with <= 1 walkable neighbour — corridors to nowhere.
    pub dead_ends: usize,
    /// Walkable tiles with >= 3 walkable neighbours ÷ walkable.
    pub choice_share: f64,
    /// Track tiles ÷ walkable, or 0 with no mask.
    pub lane_share: f64,
    /// The floor's biggest actual room ÷ walkable (connected 5x5 open block).
    pub chamber_share: f64,
    /// Coarse regions holding real floor area (>= REGION_MIN_FLOOR).
    pub regions: usize,
    /// Coarse regions holding real floor area that player can reach ÷ regions.
    pub region_reach_share: f64,
}

/// The largest connected blob of tiles that are deep inside open space, in tiles.
pub fn largest_chamber(g: &Grid) -> usize {
    let n_tiles = (g.w * g.h) as usize;
    let mut deep = vec![0_u8; n_tiles];

    for j in CHAMBER_R..(g.h - CHAMBER_R) {
        for i in CHAMBER_R..(g.w - CHAMBER_R) {
            let mut ok = 1_u8;
            'outer: for dj in -CHAMBER_R..=CHAMBER_R {
                for di in -CHAMBER_R..=CHAMBER_R {
                    if !is_walkable(g, i + di, j + dj) {
                        ok = 0;
                        break 'outer;
                    }
                }
            }
            deep[idx(g, i, j)] = ok;
        }
    }

    let mut seen = vec![0_u8; n_tiles];
    let mut stack = Vec::new();
    let mut best = 0;

    for k in 0..n_tiles {
        if deep[k] == 0 || seen[k] == 1 {
            continue;
        }
        let mut count = 0;
        stack.clear();
        stack.push(k);
        seen[k] = 1;

        while let Some(c) = stack.pop() {
            count += 1;
            let ci = (c % (g.w as usize)) as i32;
            let cj = (c / (g.w as usize)) as i32;

            for (di, dj) in &[(1, 0), (-1, 0), (0, 1), (0, -1)] {
                let ni = ci + di;
                let nj = cj + dj;
                if ni < 0 || nj < 0 || ni >= g.w || nj >= g.h {
                    continue;
                }
                let nk = idx(g, ni, nj);
                if seen[nk] == 1 || deep[nk] == 0 {
                    continue;
                }
                seen[nk] = 1;
                stack.push(nk);
            }
        }
        if count > best {
            best = count;
        }
    }

    best
}

/// Trace the start -> stairs route by walking downhill through a distance field.
pub fn trace_route(g: &Grid, start: TilePos, stairs: TilePos, dist: &[i32]) -> Vec<TilePos> {
    if dist[idx(g, stairs.i, stairs.j)] < 0 {
        return Vec::new();
    }
    let mut path = vec![TilePos {
        i: stairs.i,
        j: stairs.j,
    }];
    let mut cur = TilePos {
        i: stairs.i,
        j: stairs.j,
    };

    let max_guard = (g.w * g.h) as usize;
    for _ in 0..max_guard {
        if cur.i == start.i && cur.j == start.j {
            break;
        }
        let d = dist[idx(g, cur.i, cur.j)];
        let mut next = None;

        for (di, dj) in &[(1, 0), (-1, 0), (0, 1), (0, -1)] {
            let ni = cur.i + di;
            let nj = cur.j + dj;
            if ni < 0 || nj < 0 || ni >= g.w || nj >= g.h {
                continue;
            }
            if !is_walkable(g, ni, nj) {
                continue;
            }
            let nd = dist[idx(g, ni, nj)];
            if nd >= 0 && nd == d - 1 {
                next = Some(TilePos { i: ni, j: nj });
                break;
            }
        }
        match next {
            Some(nxt) => {
                path.push(nxt);
                cur = nxt;
            }
            None => break,
        }
    }

    path.reverse();
    path
}

/// Measure a finished floor.
pub fn measure_floor(
    g: &Grid,
    start: TilePos,
    stairs: TilePos,
    mask: Option<&LaneMask>,
    route_from: Option<TilePos>,
) -> FloorMetrics {
    let tiles = (g.w * g.h) as usize;
    let mut walkable = 0;
    let mut dead_ends = 0;
    let mut choices = 0;
    let mut lane = 0;

    let mut floor_per_region: HashMap<usize, usize> = HashMap::new();
    let reg_w = (g.w as f64 / REGION as f64).ceil() as usize;
    let region_of = |i: i32, j: i32| -> usize {
        let rj = (j as usize) / REGION;
        let ri = (i as usize) / REGION;
        rj * reg_w + ri
    };

    for j in 0..g.h {
        for i in 0..g.w {
            if !is_walkable(g, i, j) {
                continue;
            }
            walkable += 1;
            let k = idx(g, i, j);
            if let Some(m) = mask {
                if k < m.lane.len() && m.lane[k] == 1 {
                    lane += 1;
                }
            }
            let mut open = 0;
            for (di, dj) in &[(1, 0), (-1, 0), (0, 1), (0, -1)] {
                let ni = i + di;
                let nj = j + dj;
                if ni >= 0 && nj >= 0 && ni < g.w && nj < g.h && is_walkable(g, ni, nj) {
                    open += 1;
                }
            }
            if open <= 1 {
                dead_ends += 1;
            }
            if open >= 3 {
                choices += 1;
            }
            *floor_per_region.entry(region_of(i, j)).or_insert(0) += 1;
        }
    }

    let dist = bfs_distances(g, start.i, start.j);
    let mut reached = 0;
    let mut reached_region: HashSet<usize> = HashSet::new();

    for j in 0..g.h {
        for i in 0..g.w {
            if !is_walkable(g, i, j) {
                continue;
            }
            if dist[idx(g, i, j)] < 0 {
                continue;
            }
            reached += 1;
            reached_region.insert(region_of(i, j));
        }
    }

    let from = route_from.unwrap_or(start);
    let route_dist_owned;
    let route_dist = if from == start {
        &dist
    } else {
        route_dist_owned = bfs_distances(g, from.i, from.j);
        &route_dist_owned
    };

    let path_len = route_dist[idx(g, stairs.i, stairs.j)];
    let route = trace_route(g, from, stairs, route_dist);
    let mut turns = 0;
    if route.len() > 2 {
        for t in 2..route.len() {
            let ai = route[t - 1].i - route[t - 2].i;
            let aj = route[t - 1].j - route[t - 2].j;
            let bi = route[t].i - route[t - 1].i;
            let bj = route[t].j - route[t - 1].j;
            if ai != bi || aj != bj {
                turns += 1;
            }
        }
    }
    let di = (stairs.i - from.i) as f64;
    let dj = (stairs.j - from.j) as f64;
    let euclid = (di * di + dj * dj).sqrt();

    let big_regions: Vec<(&usize, &usize)> = floor_per_region
        .iter()
        .filter(|(_, &n)| n >= REGION_MIN_FLOOR)
        .collect();
    let big_reached = big_regions
        .iter()
        .filter(|(&r, _)| reached_region.contains(&r))
        .count();

    FloorMetrics {
        tiles,
        walkable,
        open_share: if tiles > 0 {
            walkable as f64 / tiles as f64
        } else {
            0.0
        },
        reach_share: if walkable > 0 {
            reached as f64 / walkable as f64
        } else {
            0.0
        },
        path_len,
        directness: if path_len > 0 {
            euclid / path_len as f64
        } else {
            0.0
        },
        turn_rate: if route.len() > 2 {
            turns as f64 / (route.len() - 1) as f64
        } else {
            0.0
        },
        dead_ends,
        choice_share: if walkable > 0 {
            choices as f64 / walkable as f64
        } else {
            0.0
        },
        lane_share: if walkable > 0 {
            lane as f64 / walkable as f64
        } else {
            0.0
        },
        chamber_share: if walkable > 0 {
            largest_chamber(g) as f64 / walkable as f64
        } else {
            0.0
        },
        regions: big_regions.len(),
        region_reach_share: if !big_regions.is_empty() {
            big_reached as f64 / big_regions.len() as f64
        } else {
            1.0
        },
    }
}

/// The constraint band a floor must satisfy.
#[derive(Debug, Clone, PartialEq)]
pub struct FloorConstraints {
    pub min_reach_share: f64,
    pub min_region_reach_share: f64,
    /// Critical path as a fraction of the grid's Manhattan span.
    pub min_path_span: f64,
    pub max_directness: f64,
    /// Dead ends allowed per 1000 walkable tiles.
    pub max_dead_ends_per_1k: f64,
    pub min_open_share: f64,
    pub max_open_share: f64,
    pub min_choice_share: f64,
}

pub const DEFAULT_CONSTRAINTS: FloorConstraints = FloorConstraints {
    min_reach_share: 1.0,
    min_region_reach_share: 1.0,
    min_path_span: 0.2,
    max_directness: 0.85,
    max_dead_ends_per_1k: 2.5,
    min_open_share: 0.35,
    max_open_share: 0.8,
    min_choice_share: 0.2,
};

/// Human-readable constraint violations. Empty Vec = the floor is legal.
pub fn check_floor(m: &FloorMetrics, g: &Grid, c: &FloorConstraints) -> Vec<String> {
    let mut bad = Vec::new();
    let span = (g.w + g.h) as f64;

    if m.reach_share < c.min_reach_share {
        bad.push(format!(
            "unreachable floor: reachShare {:.4} < {}",
            m.reach_share, c.min_reach_share
        ));
    }
    if m.region_reach_share < c.min_region_reach_share {
        bad.push(format!(
            "sealed region: regionReachShare {:.3} < {}",
            m.region_reach_share, c.min_region_reach_share
        ));
    }
    if m.path_len < 0 {
        bad.push("no route from spawn to stairs".into());
    } else if (m.path_len as f64) < span * c.min_path_span {
        bad.push(format!(
            "exit on the doorstep: pathLen {} < {:.0}",
            m.path_len,
            span * c.min_path_span
        ));
    }
    if m.directness > c.max_directness {
        bad.push(format!(
            "straight shot to the exit: directness {:.3} > {}",
            m.directness, c.max_directness
        ));
    }
    let de_per_1k = if m.walkable > 0 {
        (m.dead_ends as f64 * 1000.0) / m.walkable as f64
    } else {
        0.0
    };
    if de_per_1k > c.max_dead_ends_per_1k {
        bad.push(format!(
            "corridors to nowhere: {:.2} dead ends per 1k tiles > {}",
            de_per_1k, c.max_dead_ends_per_1k
        ));
    }
    if m.open_share < c.min_open_share {
        bad.push(format!(
            "solid rock: openShare {:.3} < {}",
            m.open_share, c.min_open_share
        ));
    }
    if m.open_share > c.max_open_share {
        bad.push(format!(
            "no maze left: openShare {:.3} > {}",
            m.open_share, c.max_open_share
        ));
    }
    if m.choice_share < c.min_choice_share {
        bad.push(format!(
            "no branches: choiceShare {:.3} < {}",
            m.choice_share, c.min_choice_share
        ));
    }

    bad
}

/// One-line census row — for tuning scripts and failure messages.
pub fn format_metrics(m: &FloorMetrics) -> String {
    format!(
        "tiles={} open={:.3} reach={:.4} path={} direct={:.3} turn={:.3} dead={} choice={:.3} lane={:.3} chamber={:.3} regions={}",
        m.tiles,
        m.open_share,
        m.reach_share,
        m.path_len,
        m.directness,
        m.turn_rate,
        m.dead_ends,
        m.choice_share,
        m.lane_share,
        m.chamber_share,
        m.regions
    )
}

/// Tiles the player can stand on — the number every density budget should ride.
pub fn walkable_count(g: &Grid) -> usize {
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

/// Tiles that are wall — exported so callers can sanity-check a grid cheaply.
pub fn wall_count(g: &Grid) -> usize {
    let mut n = 0;
    for k in 0..g.t.len() {
        let i = (k % g.w as usize) as i32;
        let j = (k / g.w as usize) as i32;
        if at(g, i, j) == T_WALL {
            n += 1;
        }
    }
    n
}
