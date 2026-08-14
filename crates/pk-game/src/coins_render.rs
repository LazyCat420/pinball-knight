//! 3D gold coin particle and projectile renderer.
//!
//! PORTS: `economy/coins.ts`, `render/cel-painter.ts`

use bevy::prelude::*;
use pk_core::economy::coins::{
    coin_count_for, split_coin_value, update_coins_physics, CoinEntity,
};

#[derive(Component)]
pub struct VisualCoin {
    pub coin: CoinEntity,
    pub spin_rate: f32,
}

#[derive(Resource, Default)]
pub struct DungeonCoinPool {
    pub coins: Vec<CoinEntity>,
    pub next_id: u64,
}

/// Spawns a burst of scattered gold coins from a slain monster or opened chest.
pub fn spawn_coin_burst(
    pool: &mut DungeonCoinPool,
    origin_x: f64,
    origin_z: f64,
    total_gold: i64,
    rng_seed: u32,
) {
    let count = coin_count_for(total_gold);
    if count == 0 {
        return;
    }
    let values = split_coin_value(total_gold, count);
    let mut rng = pk_core::rng::Mulberry32::new(rng_seed);

    for (i, val) in values.into_iter().enumerate() {
        let angle = (i as f64 / count as f64) * std::f64::consts::TAU + (rng.next_f64() * 0.4);
        let speed = 1.2 + rng.next_f64() * 1.6;
        let vx = angle.cos() * speed;
        let vz = angle.sin() * speed;

        let id = pool.next_id;
        pool.next_id += 1;
        pool.coins.push(CoinEntity::new(id, origin_x, origin_z, val, vx, vz));
    }
}

/// Steps all active coin entities and applies magnetic attraction towards player.
pub fn step_dungeon_coins(
    time: Res<Time>,
    sim: Option<ResMut<crate::Sim>>,
    mut pool: ResMut<DungeonCoinPool>,
) {
    let Some(mut sim) = sim else {
        return;
    };
    let dt = (time.delta_secs_f64()).min(0.05);
    if dt <= 0.0 {
        return;
    }

    let px = sim.0.player.x;
    let pz = sim.0.player.z;
    let has_sprint_aura = sim.0.player.sprint_charge > 0.4 || sim.0.player.is_ball();

    let collected = update_coins_physics(&mut pool.coins, px, pz, has_sprint_aura, dt);
    if collected > 0 {
        sim.0.gold_run += collected;
    }
}
