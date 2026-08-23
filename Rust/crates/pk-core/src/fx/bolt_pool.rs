//! Thunderbolts Jagged Line VFX Pool — Pre-allocated line strands for electric lightning arcs.
//!
//! PORTS: `fx/pools/bolt-pool.ts`

use std::f32::consts::PI;

pub const BOLT_LINES: usize = 40;
pub const BOLT_POINTS: usize = 16;
pub const BOLT_LIFE: f32 = 0.22;
pub const BOLT_CORE_HEX: u32 = 0xdff3ff; // tight strand — near white
pub const BOLT_GLOW_HEX: u32 = 0x5eb0ff; // wide strand — electric blue

#[derive(Clone, Debug, PartialEq)]
pub struct BoltStrand {
    pub points: Vec<[f32; 3]>,
    pub life: f32,
    pub max_life: f32,
    pub color_hex: u32,
    pub opacity: f32,
    pub visible: bool,
}

impl BoltStrand {
    pub fn new() -> Self {
        Self {
            points: vec![[0.0, 0.0, 0.0]; BOLT_POINTS],
            life: 0.0,
            max_life: 0.0,
            color_hex: BOLT_GLOW_HEX,
            opacity: 0.0,
            visible: false,
        }
    }
}

impl Default for BoltStrand {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct BoltPool {
    pub strands: Vec<BoltStrand>,
    pub cursor: usize,
}

impl BoltPool {
    pub fn new() -> Self {
        let mut strands = Vec::with_capacity(BOLT_LINES);
        for _ in 0..BOLT_LINES {
            strands.push(BoltStrand::new());
        }
        Self { strands, cursor: 0 }
    }

    /// Spawns a dual-strand jagged lightning arc (tight core + wide glow).
    pub fn spawn(
        &mut self,
        origin: [f32; 3],
        dir: [f32; 2],
        length: f32,
        mut rng: impl FnMut() -> f32,
    ) {
        let d = (dir[0] * dir[0] + dir[1] * dir[1]).sqrt().max(1e-4);
        let nx = dir[0] / d;
        let nz = dir[1] / d;
        let px = -nz; // ground-plane perpendicular
        let pz = nx;

        for s in 0..2 {
            let i = self.cursor;
            self.cursor = (self.cursor + 1) % BOLT_LINES;
            let amp = if s == 0 { 0.26 } else { 0.55 };

            let strand = &mut self.strands[i];
            strand.color_hex = if s == 0 { BOLT_CORE_HEX } else { BOLT_GLOW_HEX };
            strand.opacity = 1.0;
            strand.visible = true;
            strand.life = BOLT_LIFE;
            strand.max_life = BOLT_LIFE;

            for k in 0..BOLT_POINTS {
                let t = k as f32 / (BOLT_POINTS - 1) as f32;
                let taper = (t * PI).sin(); // 0 at both endpoints -> clean anchor points
                let j = (rng() * 2.0 - 1.0) * amp * taper;
                let yj = (rng() * 2.0 - 1.0) * 0.16 * taper;

                strand.points[k] = [
                    origin[0] + nx * length * t + px * j,
                    origin[1] + yj,
                    origin[2] + nz * length * t + pz * j,
                ];
            }
        }
    }

    /// Ticks active lightning bolts and updates crackle flicker opacity.
    pub fn update(&mut self, dt: f32, mut rng: impl FnMut() -> f32) {
        for strand in self.strands.iter_mut() {
            if strand.life <= 0.0 {
                continue;
            }
            strand.life -= dt;
            if strand.life <= 0.0 {
                strand.visible = false;
                strand.opacity = 0.0;
            } else {
                let t = strand.life / strand.max_life;
                // Flicker: fade out with jittered brightness crackle
                strand.opacity = t * (0.55 + rng() * 0.45);
            }
        }
    }

    /// Total count of currently active visible strands.
    pub fn active_count(&self) -> usize {
        self.strands.iter().filter(|s| s.visible).count()
    }
}

impl Default for BoltPool {
    fn default() -> Self {
        Self::new()
    }
}
