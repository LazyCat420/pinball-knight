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
//!
//! PORTS-PARTIAL: `maze/decorate.ts`

use crate::grid::{is_walkable, Grid, T_CRACKED};
use crate::rng::Mulberry32;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TorchSpot {
    pub i: i32,
    pub j: i32,
    pub di: i8,
    pub dj: i8,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ItemDropSpot {
    pub i: i32,
    pub j: i32,
    pub kind: String, // "weapon" | "gear" | "potion"
    pub item_id: String,
    pub rarity: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PropSpot {
    pub i: i32,
    pub j: i32,
    pub kind: String, // "bones" | "skull" | "rubble"
}

#[derive(Clone, Debug, PartialEq)]
pub struct PinballPartSpot {
    pub i: i32,
    pub j: i32,
    pub kind: String, // "bumper" | "spring" | "booster" | "deflector" | "flipper" | "spinpad"
    pub dir_i: i8,
    pub dir_j: i8,
    pub dir2_i: i8,
    pub dir2_j: i8,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MonsterSpawnSpot {
    pub i: i32,
    pub j: i32,
    pub kind: String,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct DecoratedFloor {
    pub torches: Vec<TorchSpot>,
    pub parts: Vec<PinballPartSpot>,
    pub props: Vec<PropSpot>,
    pub items: Vec<ItemDropSpot>,
    pub monster_spawns: Vec<MonsterSpawnSpot>,
    pub cracked_walls: Vec<(i32, i32)>,
}

/// Sits pinball parts, torches, props, and spawns into a finished maze grid.
pub fn decorate_maze(
    grid: &mut Grid,
    start_i: i32,
    start_j: i32,
    exit_i: i32,
    exit_j: i32,
    rng: &mut Mulberry32,
) -> DecoratedFloor {
    let mut dec = DecoratedFloor::default();
    let w = grid.w;
    let h = grid.h;

    // 1. Identify Topology for every walkable tile
    for j in 1..h - 1 {
        for i in 1..w - 1 {
            if !is_walkable(grid, i, j) {
                continue;
            }
            if (i == start_i && j == start_j) || (i == exit_i && j == exit_j) {
                continue;
            }

            let north = is_walkable(grid, i, j - 1);
            let south = is_walkable(grid, i, j + 1);
            let west = is_walkable(grid, i - 1, j);
            let east = is_walkable(grid, i + 1, j);

            let open_count = (north as i32) + (south as i32) + (west as i32) + (east as i32);

            // BUMPERS at junctions (3 or 4 open neighbours)
            if open_count >= 3 && rng.next_f64() < 0.28 {
                dec.parts.push(PinballPartSpot {
                    i,
                    j,
                    kind: "bumper".to_string(),
                    dir_i: 0,
                    dir_j: 0,
                    dir2_i: 0,
                    dir2_j: 0,
                });
            }
            // SPRINGS at dead ends (1 open neighbour)
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
                dec.parts.push(PinballPartSpot {
                    i,
                    j,
                    kind: "spring".to_string(),
                    dir_i: di,
                    dir_j: dj,
                    dir2_i: 0,
                    dir2_j: 0,
                });
            }
            // BOOSTERS along straight corridors (2 opposite open neighbours)
            else if open_count == 2
                && ((north && south) || (west && east))
                && rng.next_f64() < 0.22
            {
                let (di, dj) = if north && south { (0, 1) } else { (1, 0) };
                dec.parts.push(PinballPartSpot {
                    i,
                    j,
                    kind: "booster".to_string(),
                    dir_i: di,
                    dir_j: dj,
                    dir2_i: 0,
                    dir2_j: 0,
                });
            }
            // DEFLECTORS at corners (2 perpendicular open neighbours)
            else if open_count == 2 && rng.next_f64() < 0.20 {
                let (di, dj) = if north { (0, -1) } else { (0, 1) };
                let (d2i, d2j) = if west { (-1, 0) } else { (1, 0) };
                dec.parts.push(PinballPartSpot {
                    i,
                    j,
                    kind: "deflector".to_string(),
                    dir_i: di,
                    dir_j: dj,
                    dir2_i: d2i,
                    dir2_j: d2j,
                });
            }
        }
    }

    // 2. Mount Torches on wall tiles facing floor tiles with spacing
    let torch_spacing = 5;
    for j in 1..h - 1 {
        for i in 1..w - 1 {
            if is_walkable(grid, i, j) {
                continue;
            }
            // Check adjacent walkable tiles
            for (di, dj) in [(0, 1), (0, -1), (1, 0), (-1, 0)] {
                let ni = i + di;
                let nj = j + dj;
                if ni >= 1 && ni < w - 1 && nj >= 1 && nj < h - 1 && is_walkable(grid, ni, nj) {
                    if (i * 7 + j * 13) % torch_spacing == 0 {
                        dec.torches.push(TorchSpot {
                            i: ni,
                            j: nj,
                            di: (-di) as i8,
                            dj: (-dj) as i8,
                        });
                        break;
                    }
                }
            }
        }
    }

    // 3. Monster Spawns (weighted away from spawn point)
    let min_spawn_dist_sq = 16.0; // at least 4 tiles away
    for j in 2..h - 2 {
        for i in 2..w - 2 {
            if !is_walkable(grid, i, j) {
                continue;
            }
            let dx = (i - start_i) as f64;
            let dz = (j - start_j) as f64;
            if dx * dx + dz * dz >= min_spawn_dist_sq && rng.next_f64() < 0.08 {
                let kind = match (rng.next_f64() * 6.0) as u32 {
                    0 => "zombie",
                    1 => "skeleton",
                    2 => "goblin",
                    3 => "croaker",
                    4 => "brute",
                    _ => "spider",
                };
                dec.monster_spawns.push(MonsterSpawnSpot {
                    i,
                    j,
                    kind: kind.to_string(),
                });
            }
        }
    }

    // 4. Secret breakable walls
    for j in 2..h - 2 {
        for i in 2..w - 2 {
            if !is_walkable(grid, i, j) && rng.next_f64() < 0.03 {
                grid.t[(j * w + i) as usize] = T_CRACKED;
                dec.cracked_walls.push((i, j));
            }
        }
    }

    dec
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grid::set_tile;

    #[test]
    fn decorate_maze_places_torches_and_pinball_parts() {
        let mut grid = Grid::solid(25, 25);
        // Carve cross
        for i in 1..24 {
            set_tile(&mut grid, i, 12, 1); // T_FLOOR
        }
        for j in 1..24 {
            set_tile(&mut grid, 12, j, 1); // T_FLOOR
        }

        let mut rng = Mulberry32::new(12345);
        let dec = decorate_maze(&mut grid, 1, 12, 23, 12, &mut rng);

        assert!(!dec.torches.is_empty());
        assert!(!dec.parts.is_empty());
    }
}
