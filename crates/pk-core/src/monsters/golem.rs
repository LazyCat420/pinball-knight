//! Golem shard burst mechanics.

use crate::enemies::*;

#[derive(Debug, Clone, PartialEq)]
pub struct ShardBurst {
    pub origin_x: f64,
    pub origin_z: f64,
    pub shard_velocities: Vec<(f64, f64)>,
    pub damage: i32,
    pub life: f64,
}

/// Generates radial shard burst when a golem shatters.
pub fn generate_golem_shards(origin_x: f64, origin_z: f64) -> ShardBurst {
    let count = GOLEM_SHARDS as usize;
    let mut velocities = Vec::with_capacity(count);

    let angle_step = std::f64::consts::TAU / (count as f64);
    for i in 0..count {
        let angle = (i as f64) * angle_step;
        let vx = angle.cos() * GOLEM_SHARD_SPEED;
        let vz = angle.sin() * GOLEM_SHARD_SPEED;
        velocities.push((vx, vz));
    }

    ShardBurst {
        origin_x,
        origin_z,
        shard_velocities: velocities,
        damage: GOLEM_SHARD_DAMAGE,
        life: GOLEM_SHARD_LIFE,
    }
}
