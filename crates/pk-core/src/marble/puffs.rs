//! Particle puff bursts pool — deterministic high-throughput particle emitter.
//!
//! PORTS: `fx/puffs.ts`

pub const MAX_PUFFS: usize = 256;

#[derive(Debug, Clone, PartialEq)]
pub struct PuffConfig {
    pub colors: [&'static str; 4],
    pub rise: f64,
    pub drag: f64,
    pub life_min: f64,
    pub life_max: f64,
    pub size_min: f64,
    pub size_max: f64,
}

pub const SMOKE: PuffConfig = PuffConfig {
    colors: ["#2b303b", "#454f5e", "#6b7688", "#9aa4b4"],
    rise: 0.42,
    drag: 1.6,
    life_min: 1.4,
    life_max: 2.6,
    size_min: 44.0,
    size_max: 74.0,
};

pub const STEAM: PuffConfig = PuffConfig {
    colors: ["#6b7688", "#8a94a6", "#c8ccd4", "#eef1f5"],
    rise: 0.95,
    drag: 2.4,
    life_min: 0.6,
    life_max: 1.2,
    size_min: 34.0,
    size_max: 58.0,
};

pub fn make_smoke_pool(count: usize) -> PuffPool {
    PuffPool {
        particles: Vec::with_capacity(count),
    }
}

pub fn make_steam_pool(count: usize) -> PuffPool {
    PuffPool {
        particles: Vec::with_capacity(count),
    }
}

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
