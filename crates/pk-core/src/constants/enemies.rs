//! Enemy roster tuning, spawn gates, Reaper timer, and Tide reinforcement constants.
//!
//! PORTS: `constants/enemies.ts`

// The Death Dealer (Reaper)
pub const REAPER_AFTER: f64 = 110.0;
pub const REAPER_WARNING: f64 = 15.0;
pub const REAPER_HP: f64 = 1.0;
pub const REAPER_SPEED_BASE: f64 = 2.4;
pub const REAPER_SPEED_RAMP: f64 = 0.035;
pub const REAPER_SPEED_MAX: f64 = 6.2;
pub const REAPER_DAMAGE: f64 = 2.0;
pub const REAPER_CONTACT_RANGE: f64 = 0.6;
pub const REAPER_ATTACK_WINDUP: f64 = 0.32;
pub const REAPER_ATTACK_COOLDOWN: f64 = 1.2;
pub const REAPER_SCALE: f64 = 1.4;
pub const REAPER_TINT: u32 = 0xd94848;

// The Tide (rolling reinforcements)
pub const TIDE_GRACE: f64 = 18.0;
pub const TIDE_RAMP: f64 = REAPER_AFTER - TIDE_GRACE - 10.0;
pub const TIDE_INTERVAL_CALM: f64 = 9.0;
pub const TIDE_INTERVAL_PEAK: f64 = 2.4;
pub const TIDE_PULSE_CALM: i32 = 1;
pub const TIDE_PULSE_PEAK: i32 = 4;
pub const TIDE_SHARE_CALM: f64 = 0.3;
pub const TIDE_SHARE_PEAK: f64 = 1.0;
pub const TIDE_SPAWN_MIN_TILES: f64 = 12.0;
pub const TIDE_SPAWN_MAX_TILES: f64 = 34.0;
pub const TIDE_MOBILE_TRIES: i32 = 4;
pub const CORPSE_BUDGET: usize = 48;

// Bats
pub const BAT_HP: f64 = 1.0;
pub const BAT_R: f64 = 0.24;
pub const BAT_SPEED_FACTOR: f64 = 1.9;
pub const BAT_CONTACT_RANGE: f64 = 0.5;
