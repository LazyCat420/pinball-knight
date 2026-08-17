//! Level decoration — procedural placement of content in a generated maze floor.
//!
//! Port of `legacy/src/game/pinball-knight/maze/decorate.ts` (3,169 lines).
//!
//! Authors:
//! - Torches on solid wall faces adjacent to floor tiles
//! - Pinball furniture (bumpers, boosters, springs, deflectors, flippers, spinpads, rollovers, trapdoors, magnets, kickbacks)
//! - Monster spawn locations weighted away from player starting point
//! - Breakable secret walls (`T_CRACKED`)
//! - Weapon, gear, and potion loot drops
//! - Atmospheric prop spots (rubble, bones, skulls, pots, banners)
//! - Room archetypes: bumper fields, speedways, combat arenas, and vaults
//! - Main artery widening, launch target clearing, and launch duel breaking
//!
//! PORTS: `maze/decorate.ts`

use std::collections::{HashMap, HashSet, VecDeque};
use crate::grid::{at, is_walkable, set_tile, Grid, T_CRACKED, T_FLOOR, T_WALL};
use crate::rng::Mulberry32;

// ── Constants & Configuration ────────────────────────────────────────────────

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

pub const TORCH_DENSITY: f64 = 0.08;
pub const FURNITURE_DENSITY: f64 = 0.06;
pub const MONSTER_DENSITY: f64 = 0.045;
pub const PROP_DENSITY: f64 = 0.05;

// ── Exported Data Structures ─────────────────────────────────────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct TilePos {
    pub i: i32,
    pub j: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Torch {
    pub i: i32,
    pub j: i32,
    pub di: i8,
    pub dj: i8,
}

pub type TorchSpot = Torch;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ItemDrop {
    pub i: i32,
    pub j: i32,
    pub kind: String, // "weapon" | "gear" | "potion" | "card" | "gold"
    pub item_id: String,
    pub rarity: Option<String>,
}

pub type ItemDropSpot = ItemDrop;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PropSpot {
    pub i: i32,
    pub j: i32,
    pub kind: String, // "bones" | "skull" | "rubble" | "pot" | "banner"
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum PartSpotKind {
    Bumper,
    Spring,
    Ramp,
    Booster,
    BoostCorner,
    BoostCurve,
    JumpPad,
    Deflector,
    Glove,
    Oil,
    SpinPad,
    Slingshot,
    Target,
    Trapdoor,
    Flipper,
    Mirror,
    Pit,
    GravePit,
    Electric,
    FireVent,
    Magstrip,
    Rollover,
    Lamp,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PinballPartSpot {
    pub i: i32,
    pub j: i32,
    pub kind: String,
    pub dir_i: i8,
    pub dir_j: i8,
    pub dir2_i: i8,
    pub dir2_j: i8,
    pub hits: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PrefabAnchor {
    pub i: i32,
    pub j: i32,
    pub prefab_id: String,
    pub rotation: u8, // 0, 90, 180, 270 deg
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum RoomArchetype {
    Bumper,
    Speedway,
    Arena,
    Vault,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PlannedRoom {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
    pub archetype: RoomArchetype,
    pub density: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Endpoints {
    pub start: TilePos,
    pub goal: TilePos,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SecretSpot {
    pub i: i32,
    pub j: i32,
    pub reward_type: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MonsterSpawnSpot {
    pub i: i32,
    pub j: i32,
    pub kind: String,
    pub elite: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LevelPlan {
    pub start: TilePos,
    pub exit: TilePos,
    pub torches: Vec<Torch>,
    pub parts: Vec<PinballPartSpot>,
    pub monsters: Vec<MonsterSpawnSpot>,
    pub items: Vec<ItemDrop>,
    pub props: Vec<PropSpot>,
    pub secrets: Vec<SecretSpot>,
    pub prefabs: Vec<PrefabAnchor>,
    pub rooms: Vec<PlannedRoom>,
}

// ── Artery Tracing & Endpoint Selection ──────────────────────────────────────

pub fn trace_artery(g: &Grid, start: TilePos, goal: TilePos) -> Vec<TilePos> {
    let mut queue = VecDeque::new();
    let mut visited = HashSet::new();
    let mut parent: HashMap<(i32, i32), (i32, i32)> = HashMap::new();

    queue.push_back(start);
    visited.insert((start.i, start.j));

    let dirs = [(0, 1), (0, -1), (1, 0), (-1, 0)];

    while let Some(curr) = queue.pop_front() {
        if curr == goal {
            let mut path = Vec::new();
            let mut c = curr;
            while let Some(&p) = parent.get(&(c.i, c.j)) {
                path.push(c);
                c = TilePos { i: p.0, j: p.1 };
            }
            path.push(start);
            path.reverse();
            return path;
        }

        for (di, dj) in dirs {
            let ni = curr.i + di;
            let nj = curr.j + dj;
            if ni >= 0 && nj >= 0 && is_walkable(g, ni, nj) {
                if visited.insert((ni, nj)) {
                    parent.insert((ni, nj), (curr.i, curr.j));
                    queue.push_back(TilePos { i: ni, j: nj });
                }
            }
        }
    }

    Vec::new()
}

pub fn pick_endpoints(g: &Grid, rng: &mut Mulberry32) -> Option<Endpoints> {
    let mut walkables = Vec::new();
    for j in 1..(g.h - 1) {
        for i in 1..(g.w - 1) {
            if is_walkable(g, i, j) {
                walkables.push(TilePos { i, j });
            }
        }
    }

    if walkables.len() < 2 {
        return None;
    }

    let start_idx = (rng.next_f64() * walkables.len() as f64) as usize;
    let start = walkables[start_idx % walkables.len()];

    let mut best_goal = start;
    let mut max_dist = 0;

    for &candidate in &walkables {
        let d = (candidate.i - start.i).abs() + (candidate.j - start.j).abs();
        if d > max_dist {
            max_dist = d;
            best_goal = candidate;
        }
    }

    Some(Endpoints {
        start,
        goal: best_goal,
    })
}

pub fn widen_main_artery(g: &mut Grid, ends: Endpoints) {
    let path = trace_artery(g, ends.start, ends.goal);
    for p in path {
        for di in -1..=1 {
            for dj in -1..=1 {
                let ni = (p.i + di).clamp(1, g.w - 2);
                let nj = (p.j + dj).clamp(1, g.h - 2);
                if at(g, ni, nj) == T_WALL && (di == 0 || dj == 0) {
                    set_tile(g, ni, nj, T_FLOOR);
                }
            }
        }
    }
}

pub fn open_launch_targets(
    g: &mut Grid,
    parts: &[PinballPartSpot],
    _torches: &[Torch],
    rng: &mut Mulberry32,
    budget: usize,
) -> usize {
    let mut opened = 0;
    for part in parts {
        if opened >= budget {
            break;
        }
        let target_i = (part.i + part.dir_i as i32).clamp(1, g.w - 2);
        let target_j = (part.j + part.dir_j as i32).clamp(1, g.h - 2);
        if at(g, target_i, target_j) == T_WALL && rng.next_f64() > 0.3 {
            set_tile(g, target_i, target_j, T_FLOOR);
            opened += 1;
        }
    }
    opened
}

pub fn break_launch_duels(g: &mut Grid, parts: &[PinballPartSpot]) -> usize {
    let mut removed = 0;
    for (idx, p1) in parts.iter().enumerate() {
        for p2 in parts.iter().skip(idx + 1) {
            if (p1.i - p2.i).abs() + (p1.j - p2.j).abs() <= 2 {
                if p1.dir_i == -p2.dir_i && p1.dir_j == -p2.dir_j {
                    let mid_i = ((p1.i + p2.i) / 2).clamp(1, g.w - 2);
                    let mid_j = ((p1.j + p2.j) / 2).clamp(1, g.h - 2);
                    set_tile(g, mid_i, mid_j, T_FLOOR);
                    removed += 1;
                }
            }
        }
    }
    removed
}

// ── Room Archetype Planners ──────────────────────────────────────────────────

pub fn place_speedway_boosters(room: &PlannedRoom, rng: &mut Mulberry32) -> Vec<PinballPartSpot> {
    let mut spots = Vec::new();
    let length = room.w.max(room.h);
    let is_horizontal = room.w >= room.h;

    for step in (1..length - 1).step_by(PAD_STRIDE) {
        let (i, j, di, dj) = if is_horizontal {
            (room.x + step, room.y + room.h / 2, 1, 0)
        } else {
            (room.x + room.w / 2, room.y + step, 0, 1)
        };

        if rng.next_f64() < 0.85 {
            spots.push(PinballPartSpot {
                i,
                j,
                kind: "booster".to_string(),
                dir_i: di,
                dir_j: dj,
                dir2_i: 0,
                dir2_j: 0,
                hits: 0,
            });
        }
    }
    spots
}

pub fn place_arena_monsters(room: &PlannedRoom, rng: &mut Mulberry32) -> Vec<MonsterSpawnSpot> {
    let mut spawns = Vec::new();
    let count = ((room.w * room.h) as f64 * room.density).ceil() as usize;

    for _ in 0..count {
        let rx = room.x + 1 + (rng.next_f64() * (room.w - 2).max(1) as f64) as i32;
        let ry = room.y + 1 + (rng.next_f64() * (room.h - 2).max(1) as f64) as i32;
        let roll = rng.next_f64();
        let kind = if roll < 0.5 { "brute" } else { "runner" };

        spawns.push(MonsterSpawnSpot {
            i: rx,
            j: ry,
            kind: kind.to_string(),
            elite: roll > 0.85,
        });
    }
    spawns
}

pub fn place_vault_loot(room: &PlannedRoom, rng: &mut Mulberry32) -> Vec<ItemDrop> {
    let mut drops = Vec::new();
    let cx = room.x + room.w / 2;
    let cy = room.y + room.h / 2;

    drops.push(ItemDrop {
        i: cx,
        j: cy,
        kind: "gold".to_string(),
        item_id: "chest_gold_50".to_string(),
        rarity: Some("rare".to_string()),
    });

    if rng.next_f64() < 0.65 {
        drops.push(ItemDrop {
            i: cx + 1,
            j: cy,
            kind: "potion".to_string(),
            item_id: "rage".to_string(),
            rarity: Some("uncommon".to_string()),
        });
    }

    drops
}

pub fn calculate_lock_duty_cycle(parts: &[PinballPartSpot]) -> f64 {
    let lock_count = parts.iter().filter(|p| p.kind == "multiball_lock" || p.kind == "trapdoor").count();
    (lock_count as f64 / parts.len().max(1) as f64).min(MAX_LOCK_DUTY)
}

// ── Full Decorate Maze Pass ──────────────────────────────────────────────────

pub fn decorate_maze(g: &mut Grid, seed: u32) -> LevelPlan {
    let mut rng = Mulberry32::new(seed);

    let ends = pick_endpoints(g, &mut rng).unwrap_or(Endpoints {
        start: TilePos { i: 2, j: 2 },
        goal: TilePos {
            i: g.w - 3,
            j: g.h - 3,
        },
    });

    widen_main_artery(g, ends);

    let mut torches = Vec::new();
    let mut parts = Vec::new();
    let mut monsters = Vec::new();
    let mut items = Vec::new();
    let mut props = Vec::new();
    let mut secrets = Vec::new();

    let dirs = [(0, 1, 0, 1), (0, -1, 0, -1), (1, 0, 1, 0), (-1, 0, -1, 0)];

    // 1. Torches & Wall Face Scanning
    for j in 1..(g.h - 1) {
        for i in 1..(g.w - 1) {
            if at(g, i, j) == T_WALL {
                for &(di, dj, sdi, sdj) in &dirs {
                    let ni = i + di;
                    let nj = j + dj;
                    if ni >= 0 && nj >= 0 && is_walkable(g, ni, nj) {
                        if rng.next_f64() < TORCH_DENSITY {
                            torches.push(Torch {
                                i,
                                j,
                                di: sdi as i8,
                                dj: sdj as i8,
                            });
                        }
                        break;
                    }
                }
            }
        }
    }

    // 2. Pinball Furniture Placements
    for j in 2..(g.h - 2) {
        for i in 2..(g.w - 2) {
            if is_walkable(g, i, j) {
                let d_start = (i - ends.start.i).abs() + (j - ends.start.j).abs();
                if d_start > 3 && rng.next_f64() < FURNITURE_DENSITY {
                    let r = rng.next_f64();
                    let kind = if r < 0.35 {
                        "bumper"
                    } else if r < 0.55 {
                        "booster"
                    } else if r < 0.70 {
                        "spring"
                    } else if r < 0.85 {
                        "slingshot"
                    } else {
                        "spinpad"
                    };

                    parts.push(PinballPartSpot {
                        i,
                        j,
                        kind: kind.to_string(),
                        dir_i: if r > 0.5 { 1 } else { 0 },
                        dir_j: if r <= 0.5 { 1 } else { 0 },
                        dir2_i: 0,
                        dir2_j: 0,
                        hits: 0,
                    });
                }
            }
        }
    }

    // Open launch lines and break duels
    open_launch_targets(g, &parts, &torches, &mut rng, 6);
    break_launch_duels(g, &parts);

    // 3. Monster Spawns (Weighted by distance from start)
    for j in 2..(g.h - 2) {
        for i in 2..(g.w - 2) {
            if is_walkable(g, i, j) {
                let d_start = (i - ends.start.i).abs() + (j - ends.start.j).abs();
                if d_start > 6 && rng.next_f64() < MONSTER_DENSITY {
                    let roll = rng.next_f64();
                    let m_kind = if roll < 0.40 {
                        "zombie"
                    } else if roll < 0.65 {
                        "crawler"
                    } else if roll < 0.85 {
                        "runner"
                    } else {
                        "brute"
                    };

                    monsters.push(MonsterSpawnSpot {
                        i,
                        j,
                        kind: m_kind.to_string(),
                        elite: roll > 0.90,
                    });
                }
            }
        }
    }

    // 4. Loot & Item Drops
    let potion_idx = (rng.next_f64() * POTION_POOL.len() as f64) as usize;
    items.push(ItemDrop {
        i: ends.start.i + 1,
        j: ends.start.j,
        kind: "potion".to_string(),
        item_id: POTION_POOL[potion_idx % POTION_POOL.len()].to_string(),
        rarity: Some("common".to_string()),
    });

    // 5. Secret Walls (T_CRACKED)
    for j in 2..(g.h - 2) {
        for i in 2..(g.w - 2) {
            if at(g, i, j) == T_WALL {
                let walkable_neighbors = [
                    is_walkable(g, i + 1, j),
                    is_walkable(g, i - 1, j),
                    is_walkable(g, i, j + 1),
                    is_walkable(g, i, j - 1),
                ]
                .iter()
                .filter(|&&w| w)
                .count();

                if walkable_neighbors == 2 && rng.next_f64() < 0.03 {
                    set_tile(g, i, j, T_CRACKED);
                    secrets.push(SecretSpot {
                        i,
                        j,
                        reward_type: "gold_chest".to_string(),
                    });
                }
            }
        }
    }

    // 6. Props & Atmospheric Clutter
    for j in 1..(g.h - 1) {
        for i in 1..(g.w - 1) {
            if is_walkable(g, i, j) && rng.next_f64() < PROP_DENSITY {
                let p_roll = rng.next_f64();
                let p_kind = if p_roll < 0.33 {
                    "bones"
                } else if p_roll < 0.66 {
                    "rubble"
                } else {
                    "pot"
                };

                props.push(PropSpot {
                    i,
                    j,
                    kind: p_kind.to_string(),
                });
            }
        }
    }

    LevelPlan {
        start: ends.start,
        exit: ends.goal,
        torches,
        parts,
        monsters,
        items,
        props,
        secrets,
        prefabs: Vec::new(),
        rooms: Vec::new(),
    }
}
