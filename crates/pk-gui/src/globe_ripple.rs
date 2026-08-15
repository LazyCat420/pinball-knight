//! HUD Globe Ripple Store — Splash disturbance decay state for Life and Mana spheres.
//!
//! PORTS: `gui/globe-ripple.ts`

pub const RIPPLE_DURATION_MS: f64 = 420.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GlobeType {
    Life,
    Mana,
}

#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct GlobeRippleStore {
    pub life_until_ms: f64,
    pub mana_until_ms: f64,
}

impl GlobeRippleStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Triggers a ripple splash on the specified globe.
    pub fn trigger(&mut self, globe: GlobeType, now_ms: f64) {
        match globe {
            GlobeType::Life => self.life_until_ms = now_ms + RIPPLE_DURATION_MS,
            GlobeType::Mana => self.mana_until_ms = now_ms + RIPPLE_DURATION_MS,
        }
    }

    /// Returns the normalized 0..1 ripple intensity remaining at `now_ms`.
    pub fn amount(&self, globe: GlobeType, now_ms: f64) -> f32 {
        let until = match globe {
            GlobeType::Life => self.life_until_ms,
            GlobeType::Mana => self.mana_until_ms,
        };
        let left = until - now_ms;
        if left <= 0.0 {
            0.0
        } else {
            (left / RIPPLE_DURATION_MS) as f32
        }
    }
}
