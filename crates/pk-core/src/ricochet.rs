//! RICOCHET FORM — high-velocity chaotic ricochet state.
//!
//! Port of `legacy/src/game/pinball-knight/entities/ricochet-form.ts` (343 lines).
//!
//! Shared by the Storm marble special ("Lightning Bolt") and the Laser Potion ("Laser Beam").
//! Player is invulnerable, inputs are ignored, and collisions deflect with random jitter.
//!
//! PORTS: `entities/ricochet-form.ts`

use crate::rng::Mulberry32;
use std::collections::HashMap;
use std::sync::Mutex;

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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum RicochetFlavor {
    Bolt,
    Laser,
}

#[derive(Clone, Debug, PartialEq)]
pub struct FlavorSpec {
    pub flavor: RicochetFlavor,
    pub duration: f64,
    pub speed: f64,
    pub damage: f64,
    pub tint_hex: u32,
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

    pub fn spec(&self) -> FlavorSpec {
        FlavorSpec {
            flavor: *self,
            duration: self.duration(),
            speed: self.speed(),
            damage: self.damage(),
            tint_hex: self.tint_hex(),
        }
    }
}

pub fn ricochet_flavors_map() -> HashMap<RicochetFlavor, FlavorSpec> {
    let mut m = HashMap::new();
    m.insert(RicochetFlavor::Bolt, RicochetFlavor::Bolt.spec());
    m.insert(RicochetFlavor::Laser, RicochetFlavor::Laser.spec());
    m
}

static GLOBAL_RICOCHET: Mutex<Option<RicochetState>> = Mutex::new(None);

pub fn in_ricochet_form() -> bool {
    if let Ok(lock) = GLOBAL_RICOCHET.lock() {
        lock.as_ref().map(|s| s.active).unwrap_or(false)
    } else {
        false
    }
}

pub fn ricochet_spec() -> Option<FlavorSpec> {
    if let Ok(lock) = GLOBAL_RICOCHET.lock() {
        lock.as_ref().and_then(|s| if s.active { Some(s.flavor.spec()) } else { None })
    } else {
        None
    }
}

pub fn enter_ricochet_form(flavor: RicochetFlavor) {
    if let Ok(mut lock) = GLOBAL_RICOCHET.lock() {
        let mut state = RicochetState::default();
        state.enter(flavor, (1.0, 0.0));
        *lock = Some(state);
    }
}

pub fn update_ricochet(dt: f64) -> bool {
    if let Ok(mut lock) = GLOBAL_RICOCHET.lock() {
        if let Some(state) = lock.as_mut() {
            let mut rng = Mulberry32::new(12345);
            state.update(dt, &mut rng);
            state.active
        } else {
            false
        }
    } else {
        false
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct RicochetState {
    pub active: bool,
    pub flavor: RicochetFlavor,
    pub timer: f64,
    pub vx: f64,
    pub vz: f64,
    pub bounces: usize,
    pub zig_timer: f64,
    pub zig_sign: f64,
}

impl Default for RicochetState {
    fn default() -> Self {
        Self {
            active: false,
            flavor: RicochetFlavor::Bolt,
            timer: 0.0,
            vx: 0.0,
            vz: 0.0,
            bounces: 0,
            zig_timer: 0.0,
            zig_sign: 1.0,
        }
    }
}

impl RicochetState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn enter(&mut self, flavor: RicochetFlavor, dir: (f64, f64)) {
        self.active = true;
        self.flavor = flavor;
        self.timer = flavor.duration();
        self.bounces = 0;
        self.zig_timer = 0.0;
        self.zig_sign = 1.0;

        let speed = flavor.speed();
        let len = (dir.0 * dir.0 + dir.1 * dir.1).sqrt().max(1e-4);
        self.vx = (dir.0 / len) * speed;
        self.vz = (dir.1 / len) * speed;
    }

    pub fn update(&mut self, dt: f64, _rng: &mut Mulberry32) {
        if !self.active {
            return;
        }

        self.timer -= dt;
        if self.timer <= 0.0 {
            self.active = false;
            let current_speed = (self.vx * self.vx + self.vz * self.vz).sqrt().max(1e-4);
            self.vx = (self.vx / current_speed) * RICOCHET_EXIT_SPEED;
            self.vz = (self.vz / current_speed) * RICOCHET_EXIT_SPEED;
            return;
        }

        if self.flavor == RicochetFlavor::Laser {
            self.zig_timer += dt;
            if self.zig_timer >= LASER_ZIG_PERIOD {
                self.zig_timer = 0.0;
                self.zig_sign = -self.zig_sign;

                let angle = self.zig_sign * LASER_ZIG_ANGLE;
                let cos_a = angle.cos();
                let sin_a = angle.sin();
                let nx = self.vx * cos_a - self.vz * sin_a;
                let nz = self.vx * sin_a + self.vz * cos_a;
                self.vx = nx;
                self.vz = nz;
            }
        }
    }

    pub fn on_wall_bounce(&mut self, normal_x: f64, normal_z: f64, rng: &mut Mulberry32) {
        if !self.active {
            return;
        }
        self.bounces += 1;
        let speed = self.flavor.speed();

        let dot = self.vx * normal_x + self.vz * normal_z;
        let rx = self.vx - 2.0 * dot * normal_x;
        let rz = self.vz - 2.0 * dot * normal_z;

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
