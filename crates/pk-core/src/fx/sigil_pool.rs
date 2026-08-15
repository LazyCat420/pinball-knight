//! Floor Rune Sigils — Arcane summoning glyphs and ground decals.
//!
//! PORTS: `fx/pools/sigil-pool.ts`

pub const SIGIL_COUNT: usize = 8;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SigilInstance {
    pub x: f64,
    pub z: f64,
    pub radius: f64,
    pub rotation: f64,
    pub rot_speed: f64,
    pub alpha: f32,
    pub life: f32,
    pub max_life: f32,
    pub active: bool,
    pub color_hex: u32,
}

impl Default for SigilInstance {
    fn default() -> Self {
        Self {
            x: 0.0,
            z: 0.0,
            radius: 1.0,
            rotation: 0.0,
            rot_speed: 0.5,
            alpha: 0.0,
            life: 0.0,
            max_life: 1.0,
            active: false,
            color_hex: 0xffffff,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct SigilPool {
    pub sigils: [SigilInstance; SIGIL_COUNT],
    pub next_idx: usize,
}

impl Default for SigilPool {
    fn default() -> Self {
        Self {
            sigils: [SigilInstance::default(); SIGIL_COUNT],
            next_idx: 0,
        }
    }
}

impl SigilPool {
    pub fn new() -> Self {
        Self::default()
    }

    /// Spawns a rotating rune sigil on the floor.
    pub fn spawn(&mut self, x: f64, z: f64, radius: f64, color_hex: u32, duration: f32) {
        let idx = self.next_idx;
        self.next_idx = (self.next_idx + 1) % SIGIL_COUNT;

        let rot_dir = if idx % 2 == 0 { 1.0 } else { -1.0 };

        self.sigils[idx] = SigilInstance {
            x,
            z,
            radius,
            rotation: 0.0,
            rot_speed: rot_dir * 0.75,
            alpha: 1.0,
            life: duration,
            max_life: duration,
            active: true,
            color_hex,
        };
    }

    /// Advances the sigils' animation, rotation, and alpha fadeout.
    pub fn tick(&mut self, dt: f32) {
        for sigil in &mut self.sigils {
            if !sigil.active {
                continue;
            }

            sigil.life -= dt;
            if sigil.life <= 0.0 {
                sigil.active = false;
                sigil.alpha = 0.0;
                continue;
            }

            sigil.rotation += sigil.rot_speed * dt as f64;

            // Fade out smoothly in the last 30% of lifetime
            let life_ratio = sigil.life / sigil.max_life;
            if life_ratio < 0.3 {
                sigil.alpha = life_ratio / 0.3;
            } else {
                sigil.alpha = 1.0;
            }
        }
    }

    pub fn active_count(&self) -> usize {
        self.sigils.iter().filter(|s| s.active).count()
    }
}
