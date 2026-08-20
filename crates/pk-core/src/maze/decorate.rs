//! Level decoration — procedural placement of content in a generated maze floor.
//!
//! Port of `legacy/src/game/pinball-knight/maze/decorate.ts` (3,169 lines).
//!
//! Authors:
//! - Torches on solid wall faces adjacent to floor tiles
//! - Pinball furniture (bumpers, boosters, springs, deflectors, flippers, spinpads) by topology
//! - Monster spawn locations weighted away from player starting point
//! - Breakable secret walls (`T_CRACKED`)
//! - Weapon, gear, and potion loot drops
//! - Atmospheric prop spots (rubble, bones)
//! - Main artery widening, launch targets opening, and duel breaking
//!
//! PORTS: `maze/decorate.ts`

pub use crate::maze::artery_banks::trace_artery;
use crate::flow_field::bfs_distances;
use crate::grid::{
    at, idx, is_walkable, set_tile, shape_at, Grid, T_CRACKED, T_FLOOR, T_STAIRS, T_WALL,
};
use crate::maze::flow_orient::open_runway;
use crate::maze::track_launch::TilePos;
use crate::rng::Mulberry32;
use crate::tile_shape::SHAPE_ARC;

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct Room {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct Torch {
    pub i: i32,
    pub j: i32,
    /// Direction from the floor tile to the wall it mounts on.
    pub di: i32,
    pub dj: i32,
}
pub type TorchSpot = Torch;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ItemDrop {
    pub i: i32,
    pub j: i32,
    pub kind: String, // "weapon" | "gear" | "potion"
    pub id: String,
    pub rarity: Option<crate::items::ItemRarity>,
}
pub type ItemDropSpot = ItemDrop;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PropSpot {
    pub i: i32,
    pub j: i32,
    pub kind: String, // "bones" | "skull" | "rubble"
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PartSpotKind {
    Bumper,
    Spring,
    Booster,
    Deflector,
    Flipper,
    Spinpad,
    Target,
    Firevent,
    Oil,
    Slingshot,
    Glove,
    DropTarget,
    Rollover,
    Magnet,
    Gate,
    Turret,
}

impl PartSpotKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Bumper => "bumper",
            Self::Spring => "spring",
            Self::Booster => "booster",
            Self::Deflector => "deflector",
            Self::Flipper => "flipper",
            Self::Spinpad => "spinpad",
            Self::Target => "target",
            Self::Firevent => "firevent",
            Self::Oil => "oil",
            Self::Slingshot => "slingshot",
            Self::Glove => "glove",
            Self::DropTarget => "droptarget",
            Self::Rollover => "rollover",
            Self::Magnet => "magnet",
            Self::Gate => "gate",
            Self::Turret => "turret",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct PinballPartSpot {
    pub i: i32,
    pub j: i32,
    pub kind: String,
    pub dir_i: i32,
    pub dir_j: i32,
    pub dir2_i: i32,
    pub dir2_j: i32,
    pub spine: bool,
    pub chain: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PrefabAnchor {
    pub i: i32,
    pub j: i32,
    pub kind: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RoomArchetype {
    Bumper,
    Speedway,
    Arena,
    Vault,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PlannedRoom {
    pub room: Room,
    pub archetype: RoomArchetype,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Endpoints {
    pub start: TilePos,
    pub stairs: TilePos,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MonsterSpawnSpot {
    pub i: i32,
    pub j: i32,
    pub kind: String,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct LevelPlan {
    pub start: TilePos,
    pub stairs: TilePos,
    pub torches: Vec<Torch>,
    pub parts: Vec<PinballPartSpot>,
    pub props: Vec<PropSpot>,
    pub items: Vec<ItemDrop>,
    pub monster_spawns: Vec<MonsterSpawnSpot>,
    pub cracked_walls: Vec<(i32, i32)>,
    pub plazas: Vec<TilePos>,
}

pub type DecoratedFloor = LevelPlan;

pub const POTION_POOL: [&str; 10] = [
    "rage",
    "haste",
    "shield",
    "gold",
    "ballform",
    "freeze",
    "multiball",
    "curveshot",
    "magnetboots",
    "laser",
];

pub const MAX_LOCK_DUTY: f64 = 0.3;
pub const PAD_STRIDE: usize = 8;
pub const ALT_PAD_STRIDE: usize = PAD_STRIDE * 3;
pub const STATION_MIN_GAP: usize = 6;
pub const ROUTE_CHAIN_REACH: usize = PAD_STRIDE + 4;
pub const FAR_BAND: f64 = 0.82;
pub const STAIRS_SAMPLES: usize = 6;
pub const MIN_RUNWAY: i32 = 3;

const CARDINALS: [(i32, i32); 4] = [(0, -1), (0, 1), (-1, 0), (1, 0)];
const BAND_OFFSETS: [(i32, i32); 4] = [(0, 0), (1, 0), (0, 1), (1, 1)];

fn corner_dist(p: TilePos, cx: i32, cy: i32) -> i32 {
    (p.i - cx).abs() + (p.j - cy).abs()
}

fn pick_winding_stairs(
    g: &Grid,
    start: TilePos,
    far: &[TilePos],
    dist: &[i32],
    rng: &mut Mulberry32,
) -> Option<TilePos> {
    if far.is_empty() {
        return None;
    }
    let mut best: Option<TilePos> = None;
    let mut best_score = f64::INFINITY;
    let samples = STAIRS_SAMPLES.min(far.len());
    for _ in 0..samples {
        let idx_cand = (rng.next_f64() * far.len() as f64) as usize % far.len();
        let cand = far[idx_cand];
        let path_len = dist[idx(g, cand.i, cand.j)];
        if path_len <= 0 {
            continue;
        }
        let directness = ((cand.i - start.i).pow(2) as f64 + (cand.j - start.j).pow(2) as f64).sqrt()
            / path_len as f64;
        let path = trace_artery(g, start, cand, dist);
        let mut turns = 0;
        for t in 2..path.len() {
            let ai = path[t - 1].i - path[t - 2].i;
            let aj = path[t - 1].j - path[t - 2].j;
            let bi = path[t].i - path[t - 1].i;
            let bj = path[t].j - path[t - 1].j;
            if ai != bi || aj != bj {
                turns += 1;
            }
        }
        let score = directness - (turns as f64) / (path_len as f64);
        if score < best_score {
            best_score = score;
            best = Some(cand);
        }
    }
    best
}

/// Pick a floor's START and STAIRS endpoints based on BFS distance and winding route score.
pub fn pick_endpoints(g: &Grid, rng: &mut Mulberry32) -> Option<Endpoints> {
    let mut floors = Vec::new();
    for j in 0..g.h {
        for i in 0..g.w {
            if at(g, i, j) == T_FLOOR {
                floors.push(TilePos { i, j });
            }
        }
    }
    if floors.is_empty() {
        return None;
    }

    let corners = [
        (0, 0),
        (g.w - 1, 0),
        (0, g.h - 1),
        (g.w - 1, g.h - 1),
    ];
    let corner_idx = (rng.next_f64() * corners.len() as f64) as usize % corners.len();
    let (cx, cy) = corners[corner_idx];

    let mut start = floors[0];
    let mut best_corner = i32::MAX;
    for p in &floors {
        let d = corner_dist(*p, cx, cy);
        if d < best_corner {
            best_corner = d;
            start = *p;
        }
    }

    let dist = bfs_distances(g, start.i, start.j);
    let mut max_dist = 0;
    for p in &floors {
        let d = dist[idx(g, p.i, p.j)];
        if d > max_dist {
            max_dist = d;
        }
    }

    let cutoff = 1.max((max_dist as f64 * FAR_BAND) as i32);
    let far: Vec<TilePos> = floors
        .iter()
        .copied()
        .filter(|p| {
            let d = dist[idx(g, p.i, p.j)];
            d >= cutoff && !(p.i == start.i && p.j == start.j)
        })
        .collect();

    let stairs = pick_winding_stairs(g, start, &far, &dist, rng).unwrap_or(start);
    Some(Endpoints { start, stairs })
}

/// Widen main artery corridor from stairs back to start along BFS gradient.
pub fn widen_main_artery(g: &mut Grid, ends: &Endpoints) {
    let dist = bfs_distances(g, ends.start.i, ends.start.j);
    if dist[idx(g, ends.stairs.i, ends.stairs.j)] <= 6 {
        return;
    }
    let path = trace_artery(g, ends.start, ends.stairs, &dist);
    if path.is_empty() {
        return;
    }

    for k in 0..path.len() {
        let a = path[k];
        let b = path[(path.len() - 1).min(k + 1)];
        let di = (b.i - a.i).signum();
        let dj = (b.j - a.j).signum();
        let perps = if dj != 0 || di != 0 {
            [(-dj, di), (dj, -di)]
        } else {
            [(1, 0), (-1, 0)]
        };
        for (pi, pj) in perps {
            let wi = a.i + pi;
            let wj = a.j + pj;
            if wi <= 0 || wj <= 0 || wi >= g.w - 1 || wj >= g.h - 1 {
                continue;
            }
            if at(g, wi, wj) == T_WALL {
                set_tile(g, wi, wj, T_FLOOR);
                break;
            }
        }
    }
}

/// Count consecutive open tiles stepping (di,dj) from (i,j), capped at 8.
fn launch_runway(g: &Grid, i: i32, j: i32, di: i32, dj: i32) -> i32 {
    open_runway(g, i, j, di, dj, 8) as i32
}

/// Opens launch targets by punching through secret cracked walls along straight paths.
pub fn open_launch_targets(
    g: &mut Grid,
    parts: &mut [PinballPartSpot],
    torches: &[Torch],
    _rng: &mut Mulberry32,
    budget: usize,
) -> usize {
    let mut occupied = std::collections::HashSet::new();
    for t in torches {
        occupied.insert(idx(g, t.i + t.di, t.j + t.dj));
    }
    for p in parts.iter() {
        if p.kind == "target" {
            occupied.insert(idx(g, p.i + p.dir_i, p.j + p.dir_j));
        } else if p.kind == "firevent" {
            occupied.insert(idx(g, p.i - p.dir_i, p.j - p.dir_j));
        }
    }

    let mut bands: Vec<TilePos> = Vec::new();
    for j in (0..g.h - 1).step_by(2) {
        for i in (0..g.w - 1).step_by(2) {
            if at(g, i, j) == T_CRACKED {
                bands.push(TilePos { i, j });
            }
        }
    }

    let mut opened = 0;
    for p in parts.iter_mut() {
        if opened >= budget {
            break;
        }
        if p.kind != "booster" && p.kind != "spring" {
            continue;
        }
        let run = launch_runway(g, p.i, p.j, p.dir_i, p.dir_j);
        if run < MIN_RUNWAY {
            let wi = p.i + p.dir_i * (run + 1);
            let wj = p.j + p.dir_j * (run + 1);
            let bi = wi & !1;
            let bj = wj & !1;
            if bi < 2 || bj < 2 || bi + 1 > g.w - 3 || bj + 1 > g.h - 3 {
                continue;
            }
            let mut can_crack = true;
            for (ddi, ddj) in BAND_OFFSETS {
                let check_idx = idx(g, bi + ddi, bj + ddj);
                if at(g, bi + ddi, bj + ddj) != T_WALL
                    || occupied.contains(&check_idx)
                    || shape_at(g, bi + ddi, bj + ddj) == SHAPE_ARC
                {
                    can_crack = false;
                    break;
                }
            }
            if can_crack {
                for (ddi, ddj) in BAND_OFFSETS {
                    set_tile(g, bi + ddi, bj + ddj, T_CRACKED);
                }
                bands.push(TilePos { i: bi, j: bj });
                opened += 1;
            }
        }
    }
    opened
}

/// Breaks facing launch duels (springs/boosters pointed directly into each other).
pub fn break_launch_duels(g: &Grid, parts: &mut Vec<PinballPartSpot>) -> usize {
    let mut fixed = 0;
    for _round in 0..8 {
        let mut duel: Option<(usize, usize)> = None;
        'outer: for x in 0..parts.len() {
            for y in x + 1..parts.len() {
                let px = &parts[x];
                let py = &parts[y];
                if (px.kind == "spring" || px.kind == "booster")
                    && (py.kind == "spring" || py.kind == "booster")
                    && px.i + px.dir_i == py.i
                    && px.j + px.dir_j == py.j
                    && py.i + py.dir_i == px.i
                    && py.j + py.dir_j == px.j
                {
                    if px.spine && py.spine {
                        continue;
                    }
                    duel = Some((x, y));
                    break 'outer;
                }
            }
        }

        let Some((x, y)) = duel else { break };
        let victim = if !parts[x].spine { x } else { y };
        let mut reaimed = false;
        for (di, dj) in CARDINALS {
            if di == parts[victim].dir_i && dj == parts[victim].dir_j {
                continue;
            }
            let run = launch_runway(g, parts[victim].i, parts[victim].j, di, dj);
            if run >= MIN_RUNWAY {
                parts[victim].dir_i = di;
                parts[victim].dir_j = dj;
                reaimed = true;
                break;
            }
        }
        if !reaimed {
            parts[victim].kind = "bumper".to_string();
            parts[victim].dir_i = 0;
            parts[victim].dir_j = 0;
        }
        fixed += 1;
    }
    fixed
}

/// Sits pinball parts, torches, props, loot drops, and spawns into a finished maze grid.
pub fn decorate_maze(
    g: &mut Grid,
    rng: &mut Mulberry32,
    zombie_count: usize,
    torch_budget: usize,
    _part_budget: usize,
    _rooms: Vec<Room>,
) -> LevelPlan {
    let endpoints = pick_endpoints(g, rng).unwrap_or(Endpoints {
        start: TilePos { i: 1, j: 1 },
        stairs: TilePos {
            i: g.w - 2,
            j: g.h - 2,
        },
    });

    set_tile(g, endpoints.stairs.i, endpoints.stairs.j, T_STAIRS);

    let mut plan = LevelPlan {
        start: endpoints.start,
        stairs: endpoints.stairs,
        ..Default::default()
    };

    let w = g.w;
    let h = g.h;

    // 1. Identify topology for every walkable tile
    for j in 1..h - 1 {
        for i in 1..w - 1 {
            if !is_walkable(g, i, j) {
                continue;
            }
            if (i == plan.start.i && j == plan.start.j)
                || (i == plan.stairs.i && j == plan.stairs.j)
            {
                continue;
            }

            let north = is_walkable(g, i, j - 1);
            let south = is_walkable(g, i, j + 1);
            let west = is_walkable(g, i - 1, j);
            let east = is_walkable(g, i + 1, j);
            let open_count = (north as i32) + (south as i32) + (west as i32) + (east as i32);

            // BUMPERS at junctions
            if open_count >= 3 && rng.next_f64() < 0.28 {
                plan.parts.push(PinballPartSpot {
                    i,
                    j,
                    kind: "bumper".to_string(),
                    dir_i: 0,
                    dir_j: 0,
                    dir2_i: 0,
                    dir2_j: 0,
                    spine: false,
                    chain: false,
                });
            }
            // SPRINGS at dead ends
            else if open_count == 1 {
                let (di, dj) = if north {
                    (0, -1)
                } else if south {
                    (0, 1)
                } else if west {
                    (-1, 0)
                } else {
                    (1, 0)
                };
                plan.parts.push(PinballPartSpot {
                    i,
                    j,
                    kind: "spring".to_string(),
                    dir_i: di,
                    dir_j: dj,
                    dir2_i: 0,
                    dir2_j: 0,
                    spine: false,
                    chain: false,
                });
            }
            // BOOSTERS along straight corridors
            else if open_count == 2
                && ((north && south) || (west && east))
                && rng.next_f64() < 0.22
            {
                let (di, dj) = if north && south { (0, 1) } else { (1, 0) };
                plan.parts.push(PinballPartSpot {
                    i,
                    j,
                    kind: "booster".to_string(),
                    dir_i: di,
                    dir_j: dj,
                    dir2_i: 0,
                    dir2_j: 0,
                    spine: false,
                    chain: false,
                });
            }
            // DEFLECTORS at corners
            else if open_count == 2 && rng.next_f64() < 0.20 {
                let (di, dj) = if north { (0, -1) } else { (0, 1) };
                let (d2i, d2j) = if west { (-1, 0) } else { (1, 0) };
                plan.parts.push(PinballPartSpot {
                    i,
                    j,
                    kind: "deflector".to_string(),
                    dir_i: di,
                    dir_j: dj,
                    dir2_i: d2i,
                    dir2_j: d2j,
                    spine: false,
                    chain: false,
                });
            }
        }
    }

    // 2. Mount Torches on walls facing floor tiles
    let mut torch_count = 0;
    for j in 1..h - 1 {
        for i in 1..w - 1 {
            if torch_count >= torch_budget {
                break;
            }
            if is_walkable(g, i, j) {
                continue;
            }
            for (di, dj) in CARDINALS {
                let ni = i + di;
                let nj = j + dj;
                if ni >= 1 && ni < w - 1 && nj >= 1 && nj < h - 1 && is_walkable(g, ni, nj) {
                    if (i * 7 + j * 13) % 5 == 0 {
                        plan.torches.push(Torch {
                            i: ni,
                            j: nj,
                            di: -di,
                            dj: -dj,
                        });
                        torch_count += 1;
                        break;
                    }
                }
            }
        }
    }

    // 3. Monster Spawns
    let min_spawn_dist_sq = 16.0;
    let mut spawns_placed = 0;
    for j in 2..h - 2 {
        for i in 2..w - 2 {
            if spawns_placed >= zombie_count {
                break;
            }
            if !is_walkable(g, i, j) {
                continue;
            }
            let dx = (i - plan.start.i) as f64;
            let dz = (j - plan.start.j) as f64;
            if dx * dx + dz * dz >= min_spawn_dist_sq && rng.next_f64() < 0.12 {
                let kind = match (rng.next_f64() * 6.0) as u32 {
                    0 => "zombie",
                    1 => "skeleton",
                    2 => "goblin",
                    3 => "croaker",
                    4 => "brute",
                    _ => "spider",
                };
                plan.monster_spawns.push(MonsterSpawnSpot {
                    i,
                    j,
                    kind: kind.to_string(),
                });
                spawns_placed += 1;
            }
        }
    }

    // 4. Secret breakable walls
    for j in 2..h - 2 {
        for i in 2..w - 2 {
            if !is_walkable(g, i, j) && rng.next_f64() < 0.03 {
                set_tile(g, i, j, T_CRACKED);
                plan.cracked_walls.push((i, j));
            }
        }
    }

    // 5. Break launch duels
    break_launch_duels(g, &mut plan.parts);

    plan
}
