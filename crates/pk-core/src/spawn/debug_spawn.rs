//! Debug spawn layout — where a scripted spawn actually puts its monsters.
//!
//! Port of `legacy/src/game/pinball-knight/debug-spawn.ts` (217 lines).
//!
//! PORTS: `debug-spawn.ts`

use std::collections::HashSet;
use std::f64::consts::PI;

use crate::grid::{is_walkable, tile_center, world_to_tile, Grid};
use crate::maze::track_launch::TilePos;
use crate::monsters::types::EnemyKind;

#[derive(Debug, Clone, PartialEq, Default)]
pub struct SpawnLayout {
    pub count: usize,
    pub ring: Option<f64>,
    pub phase: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DebugSpawnSpec {
    pub layout: SpawnLayout,
    pub kind: EnemyKind,
    pub hp: Option<i32>,
    pub aggro: bool,
    pub at: Option<(f64, f64)>,
    pub ztype: Option<String>,
}

impl Default for DebugSpawnSpec {
    fn default() -> Self {
        Self {
            layout: SpawnLayout {
                count: 1,
                ring: None,
                phase: None,
            },
            kind: EnemyKind::Zombie,
            hp: None,
            aggro: true,
            at: None,
            ztype: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DebugSpawnResult {
    pub spawned: usize,
    pub requested: usize,
    pub kind: String,
    pub points: Vec<(f64, f64)>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Offset {
    pub di: f64,
    pub dj: f64,
}

pub fn layout_offsets(layout: &SpawnLayout) -> Vec<Offset> {
    let n = layout.count;
    let r = layout.ring.unwrap_or(0.0);
    let phase = layout.phase.unwrap_or(0.0);
    let mut out = Vec::with_capacity(n);

    for k in 0..n {
        if r <= 0.0 {
            out.push(Offset { di: 0.0, dj: 0.0 });
            continue;
        }
        let a = phase + ((k as f64) / (n as f64)) * PI * 2.0;
        out.push(Offset {
            di: a.cos() * r,
            dj: a.sin() * r,
        });
    }
    out
}

pub fn free_tile_near(
    g: &Grid,
    ti: i32,
    tj: i32,
    taken: &mut HashSet<usize>,
    max_r: i32,
) -> Option<TilePos> {
    for r in 0..=max_r {
        for dj in -r..=r {
            for di in -r..=r {
                if r > 0 && di.abs().max(dj.abs()) != r {
                    continue;
                }
                let i = ti + di;
                let j = tj + dj;
                let key = (j * g.w + i) as usize;
                if taken.contains(&key) || !is_walkable(g, i, j) {
                    continue;
                }
                taken.insert(key);
                return Some(TilePos { i, j });
            }
        }
    }
    None
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SpawnPoint {
    pub i: i32,
    pub j: i32,
    pub x: f64,
    pub z: f64,
}

const RING_SEARCH_SLACK: f64 = 4.0;
const RING_W_RADIUS: f64 = 3.0;
const RING_W_BEARING: f64 = 1.0;

fn angle_delta(a: f64, b: f64) -> f64 {
    let mut d = (a - b) % (PI * 2.0);
    if d > PI {
        d -= PI * 2.0;
    }
    if d < -PI {
        d += PI * 2.0;
    }
    d.abs()
}

#[derive(Debug, Clone, Copy)]
struct Candidate {
    i: i32,
    j: i32,
    d: f64,
    a: f64,
}

fn ring_candidates(g: &Grid, ci: i32, cj: i32, r: f64) -> Vec<Candidate> {
    let mut out = Vec::new();
    let reach = (r + RING_SEARCH_SLACK).ceil() as i32;
    for dj in -reach..=reach {
        for di in -reach..=reach {
            let d = ((di * di + dj * dj) as f64).sqrt();
            if (d - r).abs() > RING_SEARCH_SLACK {
                continue;
            }
            let i = ci + di;
            let j = cj + dj;
            if !is_walkable(g, i, j) {
                continue;
            }
            out.push(Candidate {
                i,
                j,
                d,
                a: (dj as f64).atan2(di as f64),
            });
        }
    }
    out
}

pub fn resolve_spawn_points(
    g: &Grid,
    cx: f64,
    cz: f64,
    layout: &SpawnLayout,
) -> Vec<SpawnPoint> {
    let centre = world_to_tile(g, cx, cz);
    let mut taken = HashSet::new();
    let mut out = Vec::new();
    let r = layout.ring.unwrap_or(0.0);

    let push = |out: &mut Vec<SpawnPoint>, i: i32, j: i32| {
        let c = tile_center(g, i, j);
        out.push(SpawnPoint {
            i,
            j,
            x: c.0,
            z: c.1,
        });
    };

    if r <= 0.0 {
        for _ in 0..layout.count {
            if let Some(spot) = free_tile_near(g, centre.0, centre.1, &mut taken, 6) {
                push(&mut out, spot.i, spot.j);
            }
        }
        return out;
    }

    let cand = ring_candidates(g, centre.0, centre.1, r);
    for off in layout_offsets(layout) {
        let want = off.dj.atan2(off.di);
        let mut best: Option<Candidate> = None;
        let mut best_cost = f64::INFINITY;
        for c in &cand {
            let key = (c.j * g.w + c.i) as usize;
            if taken.contains(&key) {
                continue;
            }
            let cost = (c.d - r).abs() * RING_W_RADIUS + angle_delta(c.a, want) * RING_W_BEARING;
            if cost < best_cost {
                best_cost = cost;
                best = Some(*c);
            }
        }
        if let Some(b) = best {
            taken.insert((b.j * g.w + b.i) as usize);
            push(&mut out, b.i, b.j);
        }
    }
    out
}
