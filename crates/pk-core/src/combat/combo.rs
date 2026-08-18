//! Melee attack combo state machine, weapon heft cadence, and finisher multipliers.

use crate::items::WeaponDef;

pub const BASE_SWING_DURATION: f64 = 0.22;
pub const COMBO_RESET_WINDOW: f64 = 0.75;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ComboStage {
    #[default]
    Combo1,
    Combo2,
    Finisher,
}

impl ComboStage {
    pub fn damage_multiplier(&self) -> f64 {
        match self {
            Self::Combo1 => 1.0,
            Self::Combo2 => 1.25,
            Self::Finisher => 1.75,
        }
    }

    pub fn next(&self) -> Self {
        match self {
            Self::Combo1 => Self::Combo2,
            Self::Combo2 => Self::Finisher,
            Self::Finisher => Self::Combo1,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct CombatComboState {
    pub stage: ComboStage,
    pub timer: f64,
    pub combo_window_timer: f64,
    pub is_swinging: bool,
    pub swing_duration: f64,
}

impl CombatComboState {
    /// Attempts to trigger an attack swing with the given weapon.
    /// Returns true if swing was started.
    pub fn trigger_attack(&mut self, weapon: &WeaponDef) -> bool {
        if self.is_swinging {
            return false;
        }

        if self.combo_window_timer > 0.0 {
            self.stage = self.stage.next();
        } else {
            self.stage = ComboStage::Combo1;
        }

        self.swing_duration = BASE_SWING_DURATION * weapon.heft;
        self.timer = self.swing_duration;
        self.is_swinging = true;
        self.combo_window_timer = COMBO_RESET_WINDOW;
        true
    }

    /// Steps the combat attack timer and combo window.
    pub fn update(&mut self, dt: f64) {
        if self.is_swinging {
            self.timer -= dt;
            if self.timer <= 0.0 {
                self.is_swinging = false;
                self.timer = 0.0;
            }
        } else if self.combo_window_timer > 0.0 {
            self.combo_window_timer = (self.combo_window_timer - dt).max(0.0);
            if self.combo_window_timer <= 0.0 {
                self.stage = ComboStage::Combo1;
            }
        }
    }

    /// Computes total damage dealt to a monster on hit.
    pub fn compute_hit_damage(&self, weapon: &WeaponDef, mom_speed: f64) -> i32 {
        let base = weapon.damage as f64;
        let combo_mult = self.stage.damage_multiplier();
        let speed_bonus = 1.0 + (mom_speed * 0.12).min(1.5);
        (base * combo_mult * speed_bonus).round().max(1.0) as i32
    }
}
