//! Dungeon NPCs — Magician room shuffler, Speed Witch buff, Oracle Frog navigator, and Merchant Cart.
//!
//! PORTS-PARTIAL: `entities/npc.ts` - NOT a finished port - 0 of 7 exported names carried over (0%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

use crate::collide::move_circle;
use crate::flow_field::bfs_distances;
use crate::grid::{idx, is_walkable, world_to_tile, Grid};
use crate::maze::flow_loops::FlowPart;

pub const MAGICIAN_PERIOD: f64 = 45.0;
pub const MAGICIAN_JITTER: f64 = 15.0;
pub const MAGICIAN_BOW: f64 = 1.2;
pub const MAGICIAN_LINGER: f64 = 3.0;
pub const TRICK_RADIUS: f64 = 8.0;
pub const TRICK_SAFE_RADIUS: f64 = 2.0;
pub const TRICK_PART_SWAPS: usize = 3;

pub const WITCH_BUFF_TIME: f64 = 18.0;
pub const FROG_COOLDOWN: f64 = 30.0;

pub const MERCHANT_SPEED: f64 = 2.8;
pub const MERCHANT_FLEE_SPEED: f64 = 4.8;
pub const MERCHANT_FLEE_RANGE: f64 = 5.0;
pub const MERCHANT_CATCH_RANGE: f64 = 1.2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MagicianPhase {
    Hidden,
    Appearing,
    Bowing,
    Trick,
    Vanishing,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MagicianActor {
    pub x: f64,
    pub z: f64,
    pub phase: MagicianPhase,
    pub timer: f64,
    pub next_visit: f64,
}

impl Default for MagicianActor {
    fn default() -> Self {
        Self {
            x: 0.0,
            z: 0.0,
            phase: MagicianPhase::Hidden,
            timer: 0.0,
            next_visit: MAGICIAN_PERIOD,
        }
    }
}

/// Advances magician state machine and shuffles room furniture during Trick phase.
pub fn step_magician(
    magician: &mut MagicianActor,
    parts: &mut [FlowPart],
    player_x: f64,
    player_z: f64,
    dt: f64,
) -> bool {
    let mut performed_trick = false;
    match magician.phase {
        MagicianPhase::Hidden => {
            magician.timer += dt;
            if magician.timer >= magician.next_visit {
                magician.phase = MagicianPhase::Appearing;
                magician.timer = 0.0;
                magician.x = player_x + 3.0;
                magician.z = player_z + 3.0;
            }
        }
        MagicianPhase::Appearing => {
            magician.timer += dt;
            if magician.timer >= 0.5 {
                magician.phase = MagicianPhase::Bowing;
                magician.timer = 0.0;
            }
        }
        MagicianPhase::Bowing => {
            magician.timer += dt;
            if magician.timer >= MAGICIAN_BOW {
                magician.phase = MagicianPhase::Trick;
                magician.timer = 0.0;
            }
        }
        MagicianPhase::Trick => {
            // Swap valid pinball parts outside player safe radius
            let eligible_indices: Vec<usize> = parts
                .iter()
                .enumerate()
                .filter(|(_, p)| {
                    let dx = p.pos.0 as f64 - player_x;
                    let dz = p.pos.1 as f64 - player_z;
                    let dist = (dx * dx + dz * dz).sqrt();
                    dist >= TRICK_SAFE_RADIUS && dist <= TRICK_RADIUS
                })
                .map(|(i, _)| i)
                .collect();

            if eligible_indices.len() >= 2 {
                for i in 0..eligible_indices.len().min(TRICK_PART_SWAPS) - 1 {
                    let idx_a = eligible_indices[i];
                    let idx_b = eligible_indices[i + 1];
                    let pos_a = parts[idx_a].pos;
                    parts[idx_a].pos = parts[idx_b].pos;
                    parts[idx_b].pos = pos_a;
                }
            }

            performed_trick = true;
            magician.phase = MagicianPhase::Vanishing;
            magician.timer = 0.0;
        }
        MagicianPhase::Vanishing => {
            magician.timer += dt;
            if magician.timer >= 0.8 {
                magician.phase = MagicianPhase::Hidden;
                magician.timer = 0.0;
                magician.next_visit = MAGICIAN_PERIOD;
            }
        }
    }
    performed_trick
}

#[derive(Debug, Clone, PartialEq)]
pub struct SpeedWitchActor {
    pub x: f64,
    pub z: f64,
    pub revealed: bool,
    pub used: bool,
}

/// Checks if player touched an active speed witch.
pub fn check_witch_touch(witch: &mut SpeedWitchActor, player_x: f64, player_z: f64) -> bool {
    if !witch.revealed || witch.used {
        return false;
    }
    let dx = witch.x - player_x;
    let dz = witch.z - player_z;
    if (dx * dx + dz * dz).sqrt() <= 1.0 {
        witch.used = true;
        return true;
    }
    false
}

#[derive(Debug, Clone, PartialEq)]
pub struct OracleFrogActor {
    pub x: f64,
    pub z: f64,
    pub cooldown: f64,
}

/// Checks frog activation and computes BFS path to exit stairs.
pub fn step_oracle_frog(
    frog: &mut OracleFrogActor,
    grid: &Grid,
    stairs: (i32, i32),
    player_x: f64,
    player_z: f64,
    dt: f64,
) -> Option<Vec<(i32, i32)>> {
    if frog.cooldown > 0.0 {
        frog.cooldown = (frog.cooldown - dt).max(0.0);
    }

    let dx = frog.x - player_x;
    let dz = frog.z - player_z;
    if frog.cooldown <= 0.0 && (dx * dx + dz * dz).sqrt() <= 1.2 {
        frog.cooldown = FROG_COOLDOWN;

        let (fx, fz) = world_to_tile(grid, frog.x, frog.z);
        let dists = bfs_distances(grid, stairs.0, stairs.1);

        // Trace greedy downhill path from frog to stairs
        let mut path = Vec::new();
        let mut cur_x = fx;
        let mut cur_z = fz;

        for _ in 0..100 {
            path.push((cur_x, cur_z));
            if cur_x == stairs.0 && cur_z == stairs.1 {
                break;
            }

            let cur_dist = dists[idx(grid, cur_x, cur_z)];
            let mut best_next = (cur_x, cur_z);
            let mut best_dist = cur_dist;

            for (ndi, ndj) in [(-1, 0), (1, 0), (0, -1), (0, 1)] {
                let ni = cur_x + ndi;
                let nj = cur_z + ndj;
                if is_walkable(grid, ni, nj) {
                    let nd = dists[idx(grid, ni, nj)];
                    if nd >= 0 && nd < best_dist {
                        best_dist = nd;
                        best_next = (ni, nj);
                    }
                }
            }

            if best_next == (cur_x, cur_z) {
                break;
            }
            cur_x = best_next.0;
            cur_z = best_next.1;
        }

        return Some(path);
    }

    None
}

#[derive(Debug, Clone, PartialEq)]
pub struct MerchantActor {
    pub x: f64,
    pub z: f64,
    pub vx: f64,
    pub vz: f64,
    pub caught: bool,
}

/// Advances fleeing merchant AI away from the player.
pub fn step_merchant(
    merchant: &mut MerchantActor,
    grid: &Grid,
    player_x: f64,
    player_z: f64,
    dt: f64,
) -> bool {
    if merchant.caught {
        return false;
    }

    let dx = merchant.x - player_x;
    let dz = merchant.z - player_z;
    let dist = (dx * dx + dz * dz).sqrt();

    if dist <= MERCHANT_CATCH_RANGE {
        merchant.caught = true;
        merchant.vx = 0.0;
        merchant.vz = 0.0;
        return true;
    }

    if dist <= MERCHANT_FLEE_RANGE && dist > 0.001 {
        // Flee away from player
        let ndx = dx / dist;
        let ndz = dz / dist;
        merchant.vx = ndx * MERCHANT_FLEE_SPEED;
        merchant.vz = ndz * MERCHANT_FLEE_SPEED;
    } else {
        merchant.vx *= 0.9;
        merchant.vz *= 0.9;
    }

    let next_pos = move_circle(
        grid,
        merchant.x,
        merchant.z,
        0.4,
        merchant.vx * dt,
        merchant.vz * dt,
    );
    merchant.x = next_pos.x;
    merchant.z = next_pos.z;

    false
}
