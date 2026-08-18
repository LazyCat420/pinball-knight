//! Cards, abilities, mana, rampage and timing constants.
//!
//! PORTS: `constants/skills.ts`

use super::player::PLAYER_SPEED;

// Combat juice (hitstop + shake)
pub const HITSTOP_HIT: f64 = 0.05;
pub const HITSTOP_KILL: f64 = 0.09;
pub const SHAKE_ON_HIT: f64 = 0.1;
pub const SHAKE_ON_KILL: f64 = 0.2;

// Cards
pub const CARD_PINBALL_SPEED: f64 = 8.0;
pub const MOMENTUM_T_FLOOR: f64 = PLAYER_SPEED;
pub const MOMENTUM_T_K: f64 = 0.22;
pub const CARD_CHILL_TIME: f64 = 2.5;
pub const CARD_CHILL_SLOW: f64 = 0.5;
pub const CARD_BURN_TIME: f64 = 3.0;
pub const CARD_BURN_TICK: f64 = 0.5;
pub const CARD_BURN_DMG: f64 = 1.0;

pub const CARD_BOLT_LENGTH: f64 = 5.0;
pub const CARD_BOLT_HALF_WIDTH: f64 = 0.9;
pub const CARD_BOLT_DAMAGE: f64 = 4.0;
pub const CARD_BOLT_COOLDOWN: f64 = 0.6;

pub const PARTS_BASE: i32 = 6;
pub const PARTS_PER_LEVEL: i32 = 2;
pub const PARTS_MAX: i32 = 26;

// Rampage FPS Ultimate
pub const ULT_CHARGE_PER_KILL: f64 = 0.09;
pub const ULT_DURATION: f64 = 12.0;

// Mana & Abilities
pub const MANA_MAX: f64 = 100.0;
pub const MANA_POOL_FLOOR: f64 = 55.0;
pub const MANA_REGEN: f64 = 7.0;
pub const MANA_PER_KILL: f64 = 6.0;
pub const ARCANE_PULSE_RADIUS: f64 = 3.4;
pub const ARCANE_PULSE_DAMAGE: f64 = 5.0;
pub const FLIPPER_LAUNCH_SPEED: f64 = 19.0;
pub const MAGNET_AURA_PULL: f64 = 8.0;
pub const TIMECRAWL_FACTOR: f64 = 0.3;
pub const BLADESTORM_RADIUS: f64 = 1.6;
pub const BLADESTORM_DAMAGE: f64 = 2.0;
pub const BLADESTORM_TICK: f64 = 0.35;
pub const PULSE_WAVE_DUR: f64 = 0.55;
