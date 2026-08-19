//! The monster roster: per-kind stats, gates, spawn ratios, tide, and bestiary milestones.
//!
//! Port of `legacy/src/game/pinball-knight/constants/enemies.ts` (822 lines).
//!
//! PORTS: `constants/enemies.ts`

pub const REAPER_AFTER: f64 = 110.0;
pub const REAPER_WARNING: f64 = 15.0;
pub const REAPER_HP: i32 = 1;
pub const REAPER_SPEED_BASE: f64 = 2.4;
pub const REAPER_SPEED_RAMP: f64 = 0.035;
pub const REAPER_SPEED_MAX: f64 = 6.2;
pub const REAPER_DAMAGE: i32 = 2;
pub const REAPER_CONTACT_RANGE: f64 = 0.6;
pub const REAPER_ATTACK_WINDUP: f64 = 0.32;
pub const REAPER_ATTACK_COOLDOWN: f64 = 1.2;
pub const REAPER_SCALE: f64 = 1.4;
pub const REAPER_TINT: u32 = 0xd94848;

pub const ZOMBIE_DAMAGE: i32 = 1;
pub const SPIDER_DAMAGE: i32 = 1;
pub const BRUTE_DAMAGE: i32 = 2;
pub const JESTER_DISC_DAMAGE: i32 = 1;
pub const CROAKER_BEAM_DAMAGE: i32 = 1;
pub const ROTORTAIL_TIMBER_DAMAGE: i32 = 2;
pub const STILTNECK_BLAST_DAMAGE: i32 = 2;

pub const TIDE_GRACE: f64 = 18.0;
pub const TIDE_RAMP: f64 = REAPER_AFTER - TIDE_GRACE - 10.0;
pub const TIDE_INTERVAL_CALM: f64 = 9.0;
pub const TIDE_INTERVAL_PEAK: f64 = 2.4;
pub const TIDE_PULSE_CALM: usize = 1;
pub const TIDE_PULSE_PEAK: usize = 4;
pub const TIDE_SHARE_CALM: f64 = 0.3;
pub const TIDE_SHARE_PEAK: f64 = 1.0;
pub const TIDE_SPAWN_MIN_TILES: i32 = 12;
pub const TIDE_SPAWN_MAX_TILES: i32 = 34;
pub const TIDE_MOBILE_TRIES: usize = 4;
pub const CORPSE_BUDGET: usize = 48;

pub const BAT_HP: i32 = 1;
pub const BAT_R: f64 = 0.24;
pub const BAT_SPEED_FACTOR: f64 = 1.9;
pub const BAT_CONTACT_RANGE: f64 = 0.5;
pub const BAT_ATTACK_WINDUP: f64 = 0.18;
pub const BAT_ATTACK_COOLDOWN: f64 = 1.6;
pub const BAT_DAMAGE: i32 = 1;
pub const BAT_WOBBLE_AMP: f64 = 1.6;
pub const BAT_WOBBLE_FREQ: f64 = 5.5;
pub const BAT_HOVER_Y: f64 = 0.5;
pub const BAT_RATIO: usize = 4;
pub const BAT_FROM_LEVEL: i32 = 3;

pub const SLIME_HP: i32 = 4;
pub const SLIME_R: f64 = 0.34;
pub const SLIME_SPEED_FACTOR: f64 = 0.55;
pub const SLIME_CONTACT_RANGE: f64 = 0.66;
pub const SLIME_ATTACK_WINDUP: f64 = 0.5;
pub const SLIME_ATTACK_COOLDOWN: f64 = 1.2;
pub const SLIME_DAMAGE: i32 = 1;
pub const SLIME_MINI_HP: i32 = 1;
pub const SLIME_MINI_SPEED_MULT: f64 = 1.7;
pub const SLIME_MINI_SCALE: f64 = 0.62;
pub const SLIME_RATIO: usize = 6;
pub const SLIME_FROM_LEVEL: i32 = 3;

pub const GOBLIN_HP: i32 = 2;
pub const GOBLIN_R: f64 = 0.3;
pub const GOBLIN_SPEED_FACTOR: f64 = 1.2;
pub const GOBLIN_KICK_SPEED: f64 = 9.0;
pub const GOBLIN_KICK_COOLDOWN: f64 = 0.6;
pub const GOBLIN_RATIO: usize = 5;
pub const GOBLIN_FROM_LEVEL: i32 = 1;

pub const SPORELING_RATIO: usize = 6;
pub const SPORELING_FROM_LEVEL: i32 = 1;
pub const SPORELING_SPEED_FACTOR: f64 = 0.85;

pub const PIN_HP: i32 = 1;
pub const PIN_R: f64 = 0.24;
pub const PIN_CREW_SIZE: usize = 6;
pub const PIN_SLIDE_DECAY: f64 = 3.2;
pub const PIN_CHAIN_SPEED: f64 = 2.2;
pub const PIN_SLIDE_FROM_HIT: f64 = 7.0;
pub const PIN_STRIKE_WINDOW: f64 = 1.6;
pub const PIN_STRIKE_COUNT: usize = 3;
pub const PIN_STRIKE_GOLD: i32 = 12;
pub const PIN_FROM_LEVEL: i32 = 1;

pub const GOLEM_HP: i32 = 6;
pub const GOLEM_R: f64 = 0.44;
pub const GOLEM_CONTACT_RANGE: f64 = 0.95;
pub const GOLEM_ATTACK_WINDUP: f64 = 0.7;
pub const GOLEM_ATTACK_COOLDOWN: f64 = 1.6;
pub const GOLEM_DAMAGE: i32 = 2;
pub const GOLEM_SHARDS: usize = 5;
pub const GOLEM_SHARD_SPEED: f64 = 7.0;
pub const GOLEM_SHARD_DAMAGE: i32 = 1;
pub const GOLEM_SHARD_LIFE: f64 = 1.5;
pub const GOLEM_RATIO: usize = 9;
pub const GOLEM_FROM_LEVEL: i32 = 3;

pub const CHOMPER_HP: i32 = 5;
pub const CHOMPER_R: f64 = 0.36;
pub const CHOMPER_CONTACT_RANGE: f64 = 0.95;
pub const CHOMPER_ATTACK_WINDUP: f64 = 0.26;
pub const CHOMPER_ATTACK_COOLDOWN: f64 = 1.1;
pub const CHOMPER_DAMAGE: i32 = 2;
pub const CHOMPER_RATIO: usize = 7;
pub const CHOMPER_FROM_LEVEL: i32 = 2;

pub const MAGNET_HP: i32 = 3;
pub const MAGNET_R: f64 = 0.3;
pub const MAGNET_SPEED_FACTOR: f64 = 0.5;
pub const MAGNET_CONTACT_RANGE: f64 = 0.7;
pub const MAGNET_ATTACK_WINDUP: f64 = 0.45;
pub const MAGNET_ATTACK_COOLDOWN: f64 = 1.3;
pub const MAGNET_DAMAGE: i32 = 1;
pub const MAGNET_PULL_RANGE: f64 = 4.2;
pub const MAGNET_PULL: f64 = 2.4;
pub const MAGNET_BREAK_SPEED: f64 = 8.0;
pub const MAGNET_RATIO: usize = 8;
pub const MAGNET_FROM_LEVEL: i32 = 3;

pub const WEBSPIN_HP: i32 = 2;
pub const WEBSPIN_R: f64 = 0.32;
pub const WEBSPIN_SPEED_FACTOR: f64 = 0.8;
pub const WEB_GLOB_SPEED: f64 = 6.5;
pub const WEB_SLOW_MULT: f64 = 0.45;
pub const WEB_TIME: f64 = 2.6;
pub const WEBSPIN_RATIO: usize = 7;
pub const WEBSPIN_FROM_LEVEL: i32 = 4;

pub const JESTER_HP: i32 = 3;
pub const JESTER_R: f64 = 0.3;
pub const JESTER_SPEED_FACTOR: f64 = 0.9;
pub const JESTER_RATIO: usize = 11;

pub const DODGE_RANGED_CHANCE: f64 = 0.5;
pub const SPEED_ONLY_T: f64 = 0.45;

pub const BESTIARY_MILESTONES: [i32; 4] = [10, 30, 75, 150];
pub const BESTIARY_AFFINITY_STEP: f64 = 0.25;
pub const BESTIARY_AFFINITY_MAX: f64 = 2.0;

pub const STAGGER_SPEED_FLOOR: f64 = 0.15;
pub const STAGGER_TIME_MIN: f64 = 0.25;
pub const STAGGER_TIME_MAX: f64 = 0.6;
pub const ENTROPY_FULL: f64 = 100.0;

pub const SPITTER_HP: i32 = 3;
pub const SPITTER_R: f64 = 0.3;
pub const SPITTER_SPEED_FACTOR: f64 = 0.85;
pub const SPITTER_FIRE_RANGE: f64 = 6.0;
pub const SPITTER_KITE_RANGE: f64 = 2.4;
pub const SPITTER_WINDUP: f64 = 0.55;
pub const SPITTER_COOLDOWN: f64 = 1.8;
pub const SPITTER_DAMAGE: i32 = 1;
pub const SPITTER_GLOB_SPEED: f64 = 7.5;
pub const SPITTER_RATIO: usize = 6;
pub const SPITTER_FROM_LEVEL: i32 = 4;

pub const GHOST_HP: i32 = 2;
pub const GHOST_R: f64 = 0.32;
pub const GHOST_SPEED_FACTOR: f64 = 0.7;
pub const GHOST_CONTACT_RANGE: f64 = 0.68;
pub const GHOST_ATTACK_WINDUP: f64 = 0.4;
pub const GHOST_ATTACK_COOLDOWN: f64 = 1.3;
pub const GHOST_DAMAGE: i32 = 1;
pub const GHOST_HOVER_Y: f64 = 0.35;
pub const GHOST_BOB_AMP: f64 = 0.12;
pub const GHOST_BOB_SPEED: f64 = 2.2;
pub const GHOST_RATIO: usize = 5;
pub const GHOST_FROM_LEVEL: i32 = 2;

pub const BOSS_EVERY: i32 = 5;
pub const KING_HP_BASE: i32 = 24;
pub const KING_HP_PER_FLOOR: i32 = 13;
pub const BOSS_BASE_HP: i32 = 40;
pub const BOSS_HP_PER_TIER: i32 = 25;
pub const BOSS_SPEED_FACTOR: f64 = 0.55;
pub const BOSS_GOLD: i32 = 50;
