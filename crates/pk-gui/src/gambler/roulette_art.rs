//! ROULETTE ART — Hand-rasterised isometric roulette wheel projection and layer baker.
//!
//! Replaces soft path anti-aliasing with integer scanlines and axonometric foreshortening.
//!
//! PORTS-PARTIAL: `legacy/src/scenes/tavern/gambler/roulette-art.ts` - NOT a finished port - 54 rust code lines against 423 legacy (13%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

pub const DEFAULT_FLAT: f32 = 0.46; // Vertical axonometric foreshortening

#[derive(Clone, Debug, PartialEq)]
pub struct RouletteWheelMetrics {
    pub center_x: f32,
    pub center_y: f32,
    pub radius: f32,
    pub flat: f32,
}

impl Default for RouletteWheelMetrics {
    fn default() -> Self {
        Self::new(100.0, 100.0, 80.0)
    }
}

impl RouletteWheelMetrics {
    pub fn new(center_x: f32, center_y: f32, radius: f32) -> Self {
        Self {
            center_x,
            center_y,
            radius,
            flat: DEFAULT_FLAT,
        }
    }

    /// Projects wheel-space (angle, norm_r, lift) coordinates into screen pixels.
    pub fn project_isometric(&self, angle: f32, norm_r: f32, lift: f32) -> (f32, f32) {
        let r = self.radius * norm_r;
        let x = self.center_x + r * angle.cos();
        let y = self.center_y + r * angle.sin() * self.flat - lift;
        (x, y)
    }

    /// Inverts screen pixel coordinates back into normalized wheel radius and angle.
    pub fn unproject_isometric(&self, screen_x: f32, screen_y: f32, lift: f32) -> (f32, f32) {
        let dx = (screen_x - self.center_x) / self.radius;
        let dy = (screen_y - (self.center_y - lift)) / (self.radius * self.flat);
        let norm_r = (dx * dx + dy * dy).sqrt();
        let angle = dy.atan2(dx);
        (norm_r, angle)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RouletteLayer {
    Base,
    PocketRing,
    Mid,
    Ball,
    FarRim,
}
