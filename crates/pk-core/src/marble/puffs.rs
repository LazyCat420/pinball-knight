//! Particle puff bursts pool — deterministic high-throughput particle emitter.
//!
//! PORTS-PARTIAL: `fx/puffs.ts` - NOT a finished port - 0 of 4 exported names carried over (0%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

pub const MAX_PUFFS: usize = 256;

#[derive(Debug, Clone, PartialEq)]
pub struct PuffParticle {
    pub x: f64,
    pub z: f64,
    pub vx: f64,
    pub vz: f64,
    pub life: f64,
    pub max_life: f64,
    pub scale: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PuffPool {
    pub particles: Vec<PuffParticle>,
}

impl Default for PuffPool {
    fn default() -> Self {
        Self {
            particles: Vec::with_capacity(MAX_PUFFS),
        }
    }
}

/// Spawns a radial particle puff burst from a point source.
pub fn spawn_puff_burst(
    pool: &mut PuffPool,
    x: f64,
    z: f64,
    count: usize,
    speed: f64,
    base_scale: f64,
    life: f64,
) {
    for i in 0..count {
        if pool.particles.len() >= MAX_PUFFS {
            pool.particles.remove(0);
        }

        let angle = (i as f64 / count as f64) * std::f64::consts::TAU;
        let vx = angle.cos() * speed;
        let vz = angle.sin() * speed;

        pool.particles.push(PuffParticle {
            x,
            z,
            vx,
            vz,
            life,
            max_life: life,
            scale: base_scale,
        });
    }
}

/// Advances active puff particles, applying velocity damping and lifetime decay.
pub fn step_puffs(pool: &mut PuffPool, dt: f64) {
    for p in pool.particles.iter_mut() {
        p.x += p.vx * dt;
        p.z += p.vz * dt;
        p.vx *= 0.92;
        p.vz *= 0.92;
        p.life -= dt;
    }

    pool.particles.retain(|p| p.life > 0.0);
}
