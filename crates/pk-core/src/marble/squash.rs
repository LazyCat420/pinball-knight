//! Area-preserving squash and stretch collision impact deformation.
//!
//! PORTS-PARTIAL: `constants/pinball.ts` - NOT a finished port - 116 of 454 exported names carried over (26%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

pub const SQUASH_RECOVER: f64 = 0.18;
pub const SQUASH_DEPTH: f64 = 0.30;
pub const SQUASH_MIN_SPEED: f64 = 5.0;

/// Projects a 3D world normal onto the 45-degree isometric camera screen plane.
pub fn world_dir_to_screen(nx: f64, nz: f64) -> (f64, f64) {
    // 45-degree yaw projection: screen X = (nx - nz), screen Y = (nx + nz) * 0.5
    let sx = nx - nz;
    let sy = (nx + nz) * 0.7071067811865475;
    let len = (sx * sx + sy * sy).sqrt();
    if len > 1e-4 {
        (sx / len, sy / len)
    } else {
        (1.0, 0.0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct BallSquash {
    pub timer: f64,
    pub amplitude: f64,
    pub screen_hx: f64,
    pub screen_hy: f64,
}

impl BallSquash {
    /// Records a wall/obstacle impact.
    pub fn record_impact(&mut self, nx: f64, nz: f64, speed: f64) {
        if speed < SQUASH_MIN_SPEED {
            return;
        }
        let (hx, hy) = world_dir_to_screen(nx, nz);
        self.screen_hx = hx;
        self.screen_hy = hy;
        self.amplitude = (speed / (SQUASH_MIN_SPEED * 2.0)).min(1.0);
        self.timer = SQUASH_RECOVER;
    }

    /// Ticks the recovery timer.
    pub fn update(&mut self, dt: f64) {
        if self.timer > 0.0 {
            self.timer = (self.timer - dt).max(0.0);
        }
    }

    /// Computes the exact area-preserving non-uniform scale `[scaleX, scaleY]`.
    ///
    /// Area is preserved because `bulge = 1.0 / flat` so `scaleX * scaleY == 1.0`.
    pub fn scale(&self) -> (f32, f32) {
        if self.timer <= 0.0 || self.amplitude <= 0.0 {
            return (1.0, 1.0);
        }
        let t = (self.timer / SQUASH_RECOVER).clamp(0.0, 1.0);
        let d = (SQUASH_DEPTH * self.amplitude * (t * std::f64::consts::FRAC_PI_2).sin()) as f32;
        let flat = (1.0 - d).max(0.2);
        let bulge = 1.0 / flat;

        if self.screen_hx.abs() >= self.screen_hy.abs() {
            (flat, bulge)
        } else {
            (bulge, flat)
        }
    }
}
