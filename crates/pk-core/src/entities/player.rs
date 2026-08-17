//! PLAYER CONTINUOUS LOCOMOTION & COMBAT — Grid-free hero movement, sprint curves, and weapon actions.
//!
//! PORTS-PARTIAL: `entities/player.ts` - NOT a finished port - 79 rust code lines against 1560 legacy (5%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

use crate::state::{PLAYER_R, PLAYER_SPEED, SPRINT_SPEED_MULT};

#[derive(Clone, Debug, PartialEq)]
pub struct PlayerLocomotionState {
    pub pos: (f64, f64),
    pub vel: (f64, f64),
    pub facing: (f64, f64),
    pub is_sprinting: bool,
    pub sprint_meter: f64,
    pub hp: i32,
    pub mana: i32,
    pub attack_frame: u32,
}

impl Default for PlayerLocomotionState {
    fn default() -> Self {
        Self::new(0.0, 0.0)
    }
}

impl PlayerLocomotionState {
    pub fn new(x: f64, z: f64) -> Self {
        Self {
            pos: (x, z),
            vel: (0.0, 0.0),
            facing: (0.0, 1.0),
            is_sprinting: false,
            sprint_meter: 1.0,
            hp: 100,
            mana: 100,
            attack_frame: 0,
        }
    }

    /// Advances continuous player locomotion by delta time `dt`.
    pub fn step(&mut self, input_dir: (f64, f64), dt: f64) {
        let len_sq = input_dir.0 * input_dir.0 + input_dir.1 * input_dir.1;
        if len_sq > 0.0001 {
            let len = len_sq.sqrt();
            let norm_x = input_dir.0 / len;
            let norm_z = input_dir.1 / len;
            self.facing = (norm_x, norm_z);

            let speed_mult = if self.is_sprinting && self.sprint_meter > 0.0 {
                self.sprint_meter = (self.sprint_meter - dt * 0.2).max(0.0);
                SPRINT_SPEED_MULT
            } else {
                self.sprint_meter = (self.sprint_meter + dt * 0.1).min(1.0);
                1.0
            };

            let speed = PLAYER_SPEED * speed_mult;
            self.vel = (norm_x * speed, norm_z * speed);
        } else {
            self.vel = (0.0, 0.0);
            self.sprint_meter = (self.sprint_meter + dt * 0.15).min(1.0);
        }

        self.pos.0 += self.vel.0 * dt;
        self.pos.1 += self.vel.1 * dt;

        if self.attack_frame > 0 {
            self.attack_frame += 1;
            if self.attack_frame > 3 {
                self.attack_frame = 0;
            }
        }
    }

    /// Starts a 3-frame melee swing. Returns true if swing initiated.
    pub fn trigger_melee(&mut self) -> bool {
        if self.attack_frame == 0 {
            self.attack_frame = 1;
            true
        } else {
            false
        }
    }

    /// Triggers a ranged muzzle shot along the current facing direction.
    pub fn trigger_ranged(&mut self) -> (f64, f64) {
        let muzzle_x = self.pos.0 + self.facing.0 * (PLAYER_R * 1.5);
        let muzzle_z = self.pos.1 + self.facing.1 * (PLAYER_R * 1.5);
        (muzzle_x, muzzle_z)
    }
}
