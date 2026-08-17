//! RICOCHET FORM — high-velocity chaotic ricochet state.
//!
//! Port of `legacy/src/game/pinball-knight/entities/ricochet-form.ts` (343 lines).
//!
//! Shared by the Storm marble special ("Lightning Bolt") and the Laser Potion ("Laser Beam").
//! Player is invulnerable, inputs are ignored, and collisions deflect with random jitter.
//!
//! PORTS-PARTIAL: `entities/ricochet-form.ts` - NOT a finished port - 0 of 5 exported names carried over (0%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

use crate::rng::Mulberry32;

pub const RICOCHET_DEFLECT_JITTER: f64 = 0.38;
pub const RICOCHET_HIT_RADIUS: f64 = 0.55;
pub const RICOCHET_EXIT_SPEED: f64 = 14.0;

pub const BOLT_DURATION: f64 = 2.4;
pub const BOLT_SPEED: f64 = 26.0;
pub const BOLT_DAMAGE: f64 = 35.0;

pub const LASER_DURATION: f64 = 2.8;
pub const LASER_SPEED: f64 = 32.0;
pub const LASER_DAMAGE: f64 = 48.0;
pub const LASER_ZIG_PERIOD: f64 = 0.18;
pub const LASER_ZIG_ANGLE: f64 = 0.42;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RicochetFlavor {
    Bolt,
    Laser,
}

impl RicochetFlavor {
    pub fn duration(&self) -> f64 {
        match self {
            RicochetFlavor::Bolt => BOLT_DURATION,
            RicochetFlavor::Laser => LASER_DURATION,
        }
    }

    pub fn speed(&self) -> f64 {
        match self {
            RicochetFlavor::Bolt => BOLT_SPEED,
            RicochetFlavor::Laser => LASER_SPEED,
        }
    }

    pub fn damage(&self) -> f64 {
        match self {
            RicochetFlavor::Bolt => BOLT_DAMAGE,
            RicochetFlavor::Laser => LASER_DAMAGE,
        }
    }

    pub fn tint_hex(&self) -> u32 {
        match self {
            RicochetFlavor::Bolt => 0xf0e05a,
            RicochetFlavor::Laser => 0xff2a55,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct RicochetState {
    pub active: bool,
    pub flavor: RicochetFlavor,
    pub time_remaining: f64,
    pub vx: f64,
    pub vz: f64,
    pub zig_timer: f64,
    pub zig_sign: f64,
    pub bounces: u32,
}

impl Default for RicochetState {
    fn default() -> Self {
        Self {
            active: false,
            flavor: RicochetFlavor::Bolt,
            time_remaining: 0.0,
            vx: 0.0,
            vz: 0.0,
            zig_timer: 0.0,
            zig_sign: 1.0,
            bounces: 0,
        }
    }
}

impl RicochetState {
    pub fn enter(&mut self, flavor: RicochetFlavor, initial_heading: (f64, f64)) {
        self.active = true;
        self.flavor = flavor;
        self.time_remaining = flavor.duration();
        let speed = flavor.speed();
        let len =
            (initial_heading.0 * initial_heading.0 + initial_heading.1 * initial_heading.1).sqrt();
        let (dir_x, dir_z) = if len > 1e-4 {
            (initial_heading.0 / len, initial_heading.1 / len)
        } else {
            (0.0, 1.0)
        };
        self.vx = dir_x * speed;
        self.vz = dir_z * speed;
        self.zig_timer = LASER_ZIG_PERIOD;
        self.zig_sign = 1.0;
        self.bounces = 0;
    }

    pub fn update(&mut self, dt: f64, _rng: &mut Mulberry32) {
        if !self.active {
            return;
        }

        self.time_remaining -= dt;
        if self.time_remaining <= 0.0 {
            self.active = false;
            // Damp to exit speed
            let speed = (self.vx * self.vx + self.vz * self.vz).sqrt();
            if speed > RICOCHET_EXIT_SPEED && speed > 1e-4 {
                self.vx = (self.vx / speed) * RICOCHET_EXIT_SPEED;
                self.vz = (self.vz / speed) * RICOCHET_EXIT_SPEED;
            }
            return;
        }

        // Mid-air zig-zag for laser flavor
        if self.flavor == RicochetFlavor::Laser {
            self.zig_timer -= dt;
            if self.zig_timer <= 0.0 {
                self.zig_timer = LASER_ZIG_PERIOD;
                self.zig_sign = -self.zig_sign;
                let angle = LASER_ZIG_ANGLE * self.zig_sign;
                let cos = angle.cos();
                let sin = angle.sin();
                let new_vx = self.vx * cos - self.vz * sin;
                let new_vz = self.vx * sin + self.vz * cos;
                self.vx = new_vx;
                self.vz = new_vz;
            }
        }
    }

    pub fn on_wall_bounce(&mut self, normal_x: f64, normal_z: f64, rng: &mut Mulberry32) {
        if !self.active {
            return;
        }
        self.bounces += 1;
        let speed = self.flavor.speed();

        // Reflect velocity across normal
        let dot = self.vx * normal_x + self.vz * normal_z;
        let rx = self.vx - 2.0 * dot * normal_x;
        let rz = self.vz - 2.0 * dot * normal_z;

        // Apply chaotic jitter
        let jitter = (rng.next_f64() - 0.5) * 2.0 * RICOCHET_DEFLECT_JITTER;
        let cos_j = jitter.cos();
        let sin_j = jitter.sin();
        let jx = rx * cos_j - rz * sin_j;
        let jz = rx * sin_j + rz * cos_j;

        let len = (jx * jx + jz * jz).sqrt();
        if len > 1e-4 {
            self.vx = (jx / len) * speed;
            self.vz = (jz / len) * speed;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ricochet_lifecycle_and_deflection() {
        let mut r = RicochetState::default();
        let mut rng = Mulberry32::new(42);

        r.enter(RicochetFlavor::Bolt, (1.0, 0.0));
        assert!(r.active);
        assert_eq!(r.vx, BOLT_SPEED);
        assert_eq!(r.vz, 0.0);

        // Bounce off vertical wall (normal pointing -X)
        r.on_wall_bounce(-1.0, 0.0, &mut rng);
        assert!(r.vx < 0.0); // reflected
        assert_eq!(r.bounces, 1);

        // Update past duration
        r.update(BOLT_DURATION + 0.1, &mut rng);
        assert!(!r.active);
        let speed = (r.vx * r.vx + r.vz * r.vz).sqrt();
        assert!((speed - RICOCHET_EXIT_SPEED).abs() < 1e-3);
    }
}
