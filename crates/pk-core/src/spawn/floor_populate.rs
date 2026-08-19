//! Populating a floor — the player, the horde, the loot, and the set dressing.
//!
//! Port of `legacy/src/game/pinball-knight/spawn/floor-populate.ts` (364 lines).
//!
//! PORTS: `spawn/floor-populate.ts`

use crate::constants::economy::{MERCHANT_FROM_LEVEL, MERCHANT_SPAWN_MIN_RING};
use crate::constants::enemies::{
    BOSS_EVERY, BOSS_SPEED_FACTOR, BRUTE_SPEED_FACTOR, KING_HP_BASE, KING_HP_PER_FLOOR,
    PIN_FROM_LEVEL,
};
use crate::entities::npc::spawn_merchant;
use crate::grid::tile_center;
use crate::maze::nearest_open_tile;
use crate::maze::track_launch::TilePos;
use crate::monsters::types::EnemyKind;
use crate::spawn::factory::{make_zombie, spawn_horde_member, spawn_pin_crew, MakeZombieOpts};
use crate::spawn::floor_authoring::AuthoredFloor;
use crate::spawn::tide::arm_tide;
use crate::state::SimState;

/// Fill the committed floor with everything that lives on it.
pub fn populate_floor(f: &AuthoredFloor, sim: &mut SimState) {
    let level = f.level;
    let cfg = &f.cfg;
    let grid = &f.grid;
    let plan = &f.plan;

    let start_pos = tile_center(grid, plan.start.i, plan.start.j);
    sim.player.x = start_pos.0;
    sim.player.z = start_pos.1;

    // ── Horde: initial spawns from LevelPlan ──
    for (si, s) in plan.monster_spawns.iter().enumerate() {
        let hash = ((s.i as u32).wrapping_mul(73856093))
            ^ ((s.j as u32).wrapping_mul(19349663))
            ^ ((level as u32).wrapping_mul(83492791))
            ^ (si as u32);
        let pos = tile_center(grid, s.i, s.j);
        let m = spawn_horde_member(hash, pos.0, pos.1, cfg.zombie_speed, level as u32);
        sim.monsters.push(m);
    }

    // ── Boss King gating the exit stairs ──
    let mega = level % BOSS_EVERY == 0;
    let bhp = (KING_HP_BASE + KING_HP_PER_FLOOR * (level - 1)) * (if mega { 2 } else { 1 });
    let boss_spot = nearest_open_tile(grid, plan.stairs.i, plan.stairs.j, 2, 1)
        .unwrap_or(plan.stairs);
    let boss_speed = cfg.zombie_speed * BOSS_SPEED_FACTOR;

    let mut boss = make_zombie(
        0.0,
        0.0,
        boss_speed,
        MakeZombieOpts {
            kind: Some(EnemyKind::Brute),
            hp: Some(bhp as f64),
            max_hp: Some(bhp as f64),
            boss: true,
            ..Default::default()
        },
    );
    let boss_center = tile_center(grid, boss_spot.i, boss_spot.j);
    boss.x = boss_center.0;
    boss.z = boss_center.1;
    sim.monsters.push(boss);

    // ── Bowling Pin Crews ──
    if level >= PIN_FROM_LEVEL && !plan.monster_spawns.is_empty() {
        let crews = 1 + if level >= 5 { 1 } else { 0 };
        for c in 0..crews {
            let idx = (c as usize) % plan.monster_spawns.len();
            let spot = &plan.monster_spawns[idx];
            spawn_pin_crew(grid, TilePos { i: spot.i, j: spot.j }, sim);
        }
    }

    // ── Boss Antechamber Brute Guards ──
    if level >= 3 {
        let s = plan.stairs;
        let guards = 2 + ((level - 3) / 3) as usize;
        for n in 1..=guards {
            if let Some(spot) = nearest_open_tile(grid, s.i, s.j, n + 1, 1) {
                let c = tile_center(grid, spot.i, spot.j);
                let guard = make_zombie(
                    c.0,
                    c.1,
                    cfg.zombie_speed * BRUTE_SPEED_FACTOR,
                    MakeZombieOpts {
                        kind: Some(EnemyKind::Brute),
                        ..Default::default()
                    },
                );
                sim.monsters.push(guard);
            }
        }
    }

    // ── NPCs (Merchant) ──
    if level >= MERCHANT_FROM_LEVEL as i32 {
        let spot = nearest_open_tile(grid, plan.start.i, plan.start.j, 3, MERCHANT_SPAWN_MIN_RING as usize)
            .unwrap_or(plan.start);
        spawn_merchant(sim, spot.i, spot.j);
    }

    // ── Arm the Tide ──
    let spawns_vec: Vec<TilePos> = plan
        .monster_spawns
        .iter()
        .map(|s| TilePos { i: s.i, j: s.j })
        .collect();
    arm_tide(&spawns_vec);
}
