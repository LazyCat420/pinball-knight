//! Dungeon NPCs — Magician room shuffler, Speed Witch buff, Oracle Frog navigator, and Merchant Cart.
//!
//! Port of `legacy/src/game/pinball-knight/entities/npc.ts` (408 lines).
//!
//! PORTS: `entities/npc.ts`

use crate::collide::move_circle;
use crate::constants::player::PLAYER_R;
use crate::flow_field::bfs_distances;
use crate::grid::{idx, is_walkable, tile_center, world_to_tile, Grid};
use crate::rng::Mulberry32;
use crate::state::{Npc, SimState};

pub const MAGICIAN_PERIOD: f64 = 45.0;
pub const MAGICIAN_JITTER: f64 = 15.0;
pub const MAGICIAN_FROM_LEVEL: i32 = 2;
pub const MAGICIAN_BOW: f64 = 1.2;
pub const MAGICIAN_LINGER: f64 = 3.0;
pub const TRICK_RADIUS: f64 = 8.0;
pub const TRICK_SAFE_RADIUS: f64 = 2.0;
pub const TRICK_PART_SWAPS: usize = 3;

pub const WITCH_BUFF_TIME: f64 = 18.0;
pub const FROG_COOLDOWN: f64 = 30.0;
pub const FROG_TRAIL_TILES: usize = 16;
pub const FROG_TRAIL_STAGGER: f64 = 0.08;

pub const MERCHANT_SPEED: f64 = 2.8;
pub const MERCHANT_FLEE_SPEED: f64 = 4.8;
pub const MERCHANT_FLEE_RANGE: f64 = 5.0;
pub const MERCHANT_CATCH_RANGE: f64 = 1.2;
pub const MERCHANT_BOUNCE_DWELL: f64 = 0.4;
pub const MERCHANT_BELL_PERIOD: f64 = 4.0;
pub const MERCHANT_BELL_RANGE: f64 = 12.0;

/// Roll the countdown to the Magician's next visit.
pub fn roll_magician_clock(rng: &mut Mulberry32) -> f64 {
    MAGICIAN_PERIOD + (rng.next_f64() * 2.0 - 1.0) * MAGICIAN_JITTER
}

/// Helper to instantiate an NPC state record.
pub fn make_npc(kind: &str, x: f64, z: f64) -> Npc {
    Npc {
        id: String::new(),
        kind: kind.to_string(),
        x,
        z,
        vx: 0.0,
        vz: 0.0,
        dialogue: Vec::new(),
        t: 0.0,
        cooldown_t: 0.0,
        phase: "enter".to_string(),
        bob_phase: 0.0,
        shopped: false,
        dwell_t: 0.0,
        bell_t: 0.0,
    }
}

/// The Oracle Frog's dead-end perch, placed by the level plan.
pub fn spawn_frog(sim: &mut SimState, i: i32, j: i32) {
    let (cx, cz) = tile_center(&sim.grid, i, j);
    let mut frog = make_npc("frog", cx, cz);
    frog.phase = "idle".to_string();
    sim.npcs.push(frog);
}

/// The Rolling Cart Merchant — a shop on wheels that slides the floor.
pub fn spawn_merchant(sim: &mut SimState, i: i32, j: i32) {
    let (cx, cz) = tile_center(&sim.grid, i, j);
    let mut m = make_npc("merchant", cx, cz);
    m.phase = "roll".to_string();
    sim.npcs.push(m);
}

/// The Speed Witch steps out of smashed masonry.
pub fn spawn_witch(sim: &mut SimState, x: f64, z: f64) {
    if sim.witch_spawned {
        return;
    }
    sim.witch_spawned = true;
    let mut witch = make_npc("witch", x, z);
    witch.phase = "idle".to_string();
    sim.npcs.push(witch);
}

/// The Magician appears at the edge of the view.
pub fn spawn_magician(sim: &mut SimState, rng: &mut Mulberry32) {
    let mut spot: Option<(f64, f64)> = None;
    for _ in 0..24 {
        if spot.is_some() {
            break;
        }
        let a = rng.next_f64() * std::f64::consts::PI * 2.0;
        let r = 4.0 + rng.next_f64() * 2.5;
        let target_x = sim.player.x + a.cos() * r;
        let target_z = sim.player.z + a.sin() * r;
        let (ti, tj) = world_to_tile(&sim.grid, target_x, target_z);
        if is_walkable(&sim.grid, ti, tj) {
            spot = Some(tile_center(&sim.grid, ti, tj));
        }
    }
    let (sx, sz) = spot.unwrap_or((sim.player.x + 2.0, sim.player.z));
    let mut m = make_npc("magician", sx, sz);
    m.phase = "bow".to_string();
    sim.npcs.push(m);
}

/// Fisher-Yates shuffle helper.
fn shuffle_vec<T>(arr: &mut [T], rng: &mut Mulberry32) {
    for i in (1..arr.len()).rev() {
        let j = (rng.next_f64() * (i + 1) as f64) as usize % (i + 1);
        arr.swap(i, j);
    }
}

/// The Magician shuffles ground loot and pinball parts in the room.
pub fn magician_trick(sim: &mut SimState, m_idx: usize, rng: &mut Mulberry32) {
    let px = sim.player.x;
    let pz = sim.player.z;

    // 1. Shuffle ground items
    let item_indices: Vec<usize> = sim
        .ground_items
        .iter()
        .enumerate()
        .filter(|(_, it)| {
            let dx = it.x - px;
            let dz = it.z - pz;
            (dx * dx + dz * dz).sqrt() <= TRICK_RADIUS
        })
        .map(|(i, _)| i)
        .collect();

    if item_indices.len() >= 2 {
        let mut spots: Vec<(f64, f64)> = item_indices
            .iter()
            .map(|&i| (sim.ground_items[i].x, sim.ground_items[i].z))
            .collect();
        shuffle_vec(&mut spots, rng);
        for (k, &it_idx) in item_indices.iter().enumerate() {
            sim.ground_items[it_idx].x = spots[k].0;
            sim.ground_items[it_idx].z = spots[k].1;
        }
    }

    if let Some(m) = sim.npcs.get_mut(m_idx) {
        m.phase = "linger".to_string();
        m.t = 0.0;
    }
}

/// Oracle Frog consultation: traces ember trail to the stairs.
pub fn frog_consult(sim: &mut SimState, frog_idx: usize) {
    if sim.stairs.0 == 0 && sim.stairs.1 == 0 {
        return;
    }
    if let Some(frog) = sim.npcs.get_mut(frog_idx) {
        frog.cooldown_t = FROG_COOLDOWN;
    }

    let field = bfs_distances(&sim.grid, sim.stairs.0, sim.stairs.1);
    let mut cur = world_to_tile(&sim.grid, sim.player.x, sim.player.z);
    let mut trail: Vec<(f64, f64)> = Vec::new();

    for _ in 0..FROG_TRAIL_TILES {
        let mut best_dist = field[idx(&sim.grid, cur.0, cur.1)];
        let mut next_tile = None;

        for (di, dj) in [(0, -1), (0, 1), (-1, 0), (1, 0)] {
            let ni = cur.0 + di;
            let nj = cur.1 + dj;
            if is_walkable(&sim.grid, ni, nj) {
                let d = field[idx(&sim.grid, ni, nj)];
                if d >= 0 && d < best_dist {
                    best_dist = d;
                    next_tile = Some((ni, nj));
                }
            }
        }

        let Some(next) = next_tile else { break };
        trail.push(tile_center(&sim.grid, next.0, next.1));
        if field[idx(&sim.grid, next.0, next.1)] <= 0 {
            break;
        }
        cur = next;
    }

    sim.frog_trail = trail;
    sim.frog_trail_t = 0.0;
}

/// Update Travelling Merchant kinematics.
pub fn update_merchant(
    g: &Grid,
    m: &mut Npc,
    px: f64,
    pz: f64,
    dist: f64,
    dt: f64,
    rng: &mut Mulberry32,
) -> bool {
    m.bell_t -= dt;
    if m.bell_t <= 0.0 {
        m.bell_t = MERCHANT_BELL_PERIOD;
    }

    if dist <= MERCHANT_CATCH_RANGE && m.cooldown_t <= 0.0 {
        m.vx = 0.0;
        m.vz = 0.0;
        m.shopped = true;
        m.cooldown_t = 3.0;
        return true; // Caught!
    }

    let fleeing = !m.shopped && dist < MERCHANT_FLEE_RANGE;
    let speed = if fleeing {
        MERCHANT_FLEE_SPEED
    } else {
        MERCHANT_SPEED
    };

    let mut hx = m.vx;
    let mut hz = m.vz;
    m.dwell_t = (m.dwell_t - dt).max(0.0);

    if m.dwell_t > 0.0 {
        // Committed to bounce heading
    } else if fleeing {
        if dist > 1e-3 {
            hx = (m.x - px) / dist;
            hz = (m.z - pz) / dist;
        }
    } else if (hx * hx + hz * hz).sqrt() < 0.1 || rng.next_f64() < 0.6 * dt {
        let a = rng.next_f64() * std::f64::consts::PI * 2.0;
        hx = a.cos();
        hz = a.sin();
    }

    let hl = (hx * hx + hz * hz).sqrt().max(1.0);
    m.vx = hx / hl;
    m.vz = hz / hl;

    let step_x = m.vx * speed * dt;
    let step_z = m.vz * speed * dt;
    let res = move_circle(g, m.x, m.z, PLAYER_R, step_x, step_z);

    let hit_x = (res.x - (m.x + step_x)).abs() > 1e-3;
    let hit_z = (res.z - (m.z + step_z)).abs() > 1e-3;
    if hit_x || hit_z {
        if hit_x {
            m.vx = -m.vx;
        }
        if hit_z {
            m.vz = -m.vz;
        }
        m.dwell_t = MERCHANT_BOUNCE_DWELL;
    }

    m.x = res.x;
    m.z = res.z;
    false
}

/// Tick every NPC in the simulation.
pub fn update_npcs(sim: &mut SimState, dt: f64, rng: &mut Mulberry32) {
    if sim.player.hp <= 0 {
        return;
    }

    // 1. Magician timer
    if sim.level >= MAGICIAN_FROM_LEVEL && !sim.reaper_out {
        sim.magician_t -= dt;
        if sim.magician_t <= 0.0 && !sim.npcs.iter().any(|n| n.kind == "magician") {
            sim.magician_t = roll_magician_clock(rng);
            spawn_magician(sim, rng);
        }
    }

    // 2. Frog ember trail
    if !sim.frog_trail.is_empty() {
        sim.frog_trail_t -= dt;
        if sim.frog_trail_t <= 0.0 {
            sim.frog_trail_t = FROG_TRAIL_STAGGER;
            sim.frog_trail.remove(0);
        }
    }

    // 3. Update NPC entities
    let px = sim.player.x;
    let pz = sim.player.z;
    let mut to_remove = Vec::new();

    for k in 0..sim.npcs.len() {
        let dist = ((sim.npcs[k].x - px).powi(2) + (sim.npcs[k].z - pz).powi(2)).sqrt();
        sim.npcs[k].t += dt;
        sim.npcs[k].cooldown_t = (sim.npcs[k].cooldown_t - dt).max(0.0);

        match sim.npcs[k].kind.as_str() {
            "magician" => {
                if sim.npcs[k].phase == "bow" && sim.npcs[k].t >= MAGICIAN_BOW {
                    magician_trick(sim, k, rng);
                } else if sim.npcs[k].phase == "linger" && sim.npcs[k].t >= MAGICIAN_LINGER {
                    to_remove.push(k);
                }
            }
            "witch" => {
                if dist <= 0.8 && sim.player.hp > 2 {
                    sim.player.hp = ((sim.player.hp + 1) / 2).max(1);
                    sim.player.turbo_t = WITCH_BUFF_TIME;
                    sim.player.spring_t = WITCH_BUFF_TIME;
                    to_remove.push(k);
                }
            }
            "frog" => {
                if dist <= 0.75 && sim.npcs[k].cooldown_t <= 0.0 {
                    frog_consult(sim, k);
                }
            }
            "merchant" => {
                let mut m = sim.npcs[k].clone();
                let caught = update_merchant(&sim.grid, &mut m, px, pz, dist, dt, rng);
                sim.npcs[k] = m;
                if caught {
                    sim.merchant_caught = true;
                }
            }
            _ => {}
        }
    }

    for &idx in to_remove.iter().rev() {
        sim.npcs.remove(idx);
    }
}

/// Dispose NPCs upon level transition.
pub fn dispose_npcs(sim: &mut SimState) {
    sim.npcs.clear();
    sim.frog_trail.clear();
}
