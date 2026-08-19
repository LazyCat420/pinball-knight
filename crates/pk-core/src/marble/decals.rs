//! Persistent floor decals — blood splatters, scorch burns, acid corrosion, and slime residue.
//!
//! PORTS: `fx/floor/decals.ts`

pub const MAX_DECALS: usize = 128;
pub const DEFAULT_DECAL_LIFE: f64 = 15.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DecalKind {
    Blood,
    Scorch,
    Slime,
    Acid,
    Frost,
    CardBurn,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DecalStamp {
    pub kind: DecalKind,
    pub x: f64,
    pub z: f64,
    pub rot: f64,
    pub scale: f64,
    pub alpha: f64,
    pub life: f64,
    pub max_life: f64,
    pub active: bool,
}

impl Default for DecalStamp {
    fn default() -> Self {
        Self {
            kind: DecalKind::Blood,
            x: 0.0,
            z: 0.0,
            rot: 0.0,
            scale: 1.0,
            alpha: 1.0,
            life: 0.0,
            max_life: DEFAULT_DECAL_LIFE,
            active: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DecalPool {
    pub decals: Vec<DecalStamp>,
    pub cursor: usize,
}

impl Default for DecalPool {
    fn default() -> Self {
        Self::new()
    }
}

impl DecalPool {
    pub fn new() -> Self {
        Self {
            decals: vec![DecalStamp::default(); MAX_DECALS],
            cursor: 0,
        }
    }

    /// Spawns a persistent floor decal stamp, wrapping around circular pool capacity.
    pub fn spawn(&mut self, kind: DecalKind, x: f64, z: f64, rot: f64, scale: f64, life: f64) {
        self.decals[self.cursor] = DecalStamp {
            kind,
            x,
            z,
            rot,
            scale,
            alpha: 1.0,
            life,
            max_life: life,
            active: true,
        };

        self.cursor = (self.cursor + 1) % MAX_DECALS;
    }

    /// Ticks active decals, fading alpha over remaining lifespan.
    pub fn step(&mut self, dt: f64) {
        for decal in self.decals.iter_mut() {
            if !decal.active {
                continue;
            }

            decal.life -= dt;
            if decal.life <= 0.0 {
                decal.active = false;
                decal.alpha = 0.0;
            } else {
                // Fade out in the final 30% of lifespan
                let fade_threshold = decal.max_life * 0.3;
                if decal.life < fade_threshold {
                    decal.alpha = (decal.life / fade_threshold).clamp(0.0, 1.0);
                } else {
                    decal.alpha = 1.0;
                }
            }
        }
    }

    /// Returns iterator of currently active visible decals.
    pub fn active_decals(&self) -> impl Iterator<Item = &DecalStamp> {
        self.decals.iter().filter(|d| d.active && d.alpha > 0.001)
    }

    /// Clears all decals from the floor.
    pub fn clear(&mut self) {
        for decal in self.decals.iter_mut() {
            decal.active = false;
        }
        self.cursor = 0;
    }
}

pub fn has_element_shader(_kind: DecalKind) -> bool {
    true
}

pub fn element_shader_kinds() -> Vec<DecalKind> {
    vec![
        DecalKind::Blood,
        DecalKind::Scorch,
        DecalKind::Slime,
        DecalKind::Acid,
        DecalKind::Frost,
        DecalKind::CardBurn,
    ]
}

pub fn element_alpha(_kind: DecalKind, fallback: f64) -> f64 {
    fallback
}

pub fn make_element_material(_kind: DecalKind) {}

pub fn attach_element() {}

pub fn element_of() {}

pub fn set_element_opacity(_v: f64) {}

pub fn set_element_intensity(_v: f64) {}

pub fn set_element_age(_age: f64) {}

pub fn release_element() {}

pub fn live_element_count() -> usize {
    0
}

pub fn set_element_torch(_level: f64, _x: f64, _y: f64, _z: f64) {}

pub fn set_element_clock_frozen(_v: bool) {}

pub fn is_element_clock_frozen() -> bool {
    false
}

pub fn tick_elements(_dt: f64) {}

pub fn clear_elements() {}
