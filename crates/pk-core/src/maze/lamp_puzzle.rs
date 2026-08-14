//! Light puzzle authoring — brazier and sealed loot vault placement.
//!
//! PORTS: `maze/lamp-puzzle.ts`

use crate::flow_field::bfs_distances;
use crate::grid::{at, idx, Grid, T_FLOOR};
use crate::rng::Mulberry32;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LampPuzzlePlan {
    /// Brazier tile positions (i, j)
    pub lamps: Vec<(i32, i32)>,
    /// The sealed chest vault tile position (i, j)
    pub vault: (i32, i32),
    /// Potion rewards unlocked upon puzzle completion
    pub loot: Vec<String>,
}

pub const LOOT_TABLES: [&[&str]; 5] = [
    &["gold", "gold", "health"],
    &["gold", "shield", "health"],
    &["gold", "haste", "gold"],
    &["rage", "gold", "health"],
    &["gold", "ballform", "health"],
];

/// How many braziers a floor of this depth gets (3-5).
pub fn lamp_count_for(level: u32) -> usize {
    (3 + (level / 3) as usize).clamp(3, 5)
}

/// Authors a lamp puzzle for a floor, or returns None if the floor is too small or crowded.
pub fn author_lamp_puzzle(
    g: &Grid,
    start: (i32, i32),
    occupied: impl Fn(i32, i32) -> bool,
    rng: &mut Mulberry32,
    lamp_count: usize,
) -> Option<LampPuzzlePlan> {
    let d = bfs_distances(g, start.0, start.1);
    let mut max_d = 0;
    for &dist in &d {
        if dist >= 0 && dist > max_d {
            max_d = dist;
        }
    }
    if max_d < 8 {
        return None;
    }

    // Reachable, unoccupied floor with breathing room from start
    let mut cand = Vec::new();
    for j in 1..(g.h - 1) {
        for i in 1..(g.w - 1) {
            if at(g, i, j) != T_FLOOR {
                continue;
            }
            let dd = d[idx(g, i, j)];
            if dd < 4 {
                continue;
            }
            if occupied(i, j) {
                continue;
            }
            cand.push((i, j, dd as u32));
        }
    }

    if cand.len() < lamp_count + 3 {
        return None;
    }

    // Vault: a far, open tile (all 4 cardinals floor)
    let is_open_tile = |i: i32, j: i32| -> bool {
        at(g, i + 1, j) == T_FLOOR
            && at(g, i - 1, j) == T_FLOOR
            && at(g, i, j + 1) == T_FLOOR
            && at(g, i, j - 1) == T_FLOOR
    };

    let mut far: Vec<(i32, i32, u32)> = cand
        .iter()
        .copied()
        .filter(|c| c.2 >= ((max_d as u32) / 2))
        .collect();
    far.sort_by(|a, b| b.2.cmp(&a.2));

    let vault_pos = far
        .iter()
        .find(|c| is_open_tile(c.0, c.1))
        .map(|c| (c.0, c.1))
        .or_else(|| far.first().map(|c| (c.0, c.1)))
        .unwrap_or((cand.last().unwrap().0, cand.last().unwrap().1));

    // Braziers: spread across reachable floor with minimum separation
    let mut lamps = Vec::new();
    let mut available: Vec<(i32, i32, u32)> = cand
        .into_iter()
        .filter(|c| (c.0, c.1) != vault_pos)
        .collect();

    let min_sep_sq = 9; // ~3 tile separation
    while lamps.len() < lamp_count && !available.is_empty() {
        let pick_idx = (rng.next_f64() * available.len() as f64) as usize % available.len();
        let candidate = available.swap_remove(pick_idx);

        let far_enough = lamps.iter().all(|l: &(i32, i32)| {
            let dx = candidate.0 - l.0;
            let dz = candidate.1 - l.1;
            dx * dx + dz * dz >= min_sep_sq
        });

        if far_enough {
            lamps.push((candidate.0, candidate.1));
        }
    }

    if lamps.len() < lamp_count {
        return None;
    }

    let loot_idx = (rng.next_f64() * LOOT_TABLES.len() as f64) as usize % LOOT_TABLES.len();
    let loot = LOOT_TABLES[loot_idx]
        .iter()
        .map(|s| s.to_string())
        .collect();

    Some(LampPuzzlePlan {
        lamps,
        vault: vault_pos,
        loot,
    })
}
