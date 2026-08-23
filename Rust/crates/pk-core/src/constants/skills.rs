//! Cards, abilities, mana, rampage and their presentation timings.
//!
//! Port of `legacy/src/game/pinball-knight/constants/skills.ts` (306 lines).
//!
//! PORTS: `constants/skills.ts`


// ── Combat Juice ──────────────────────────────────────────────────────────────
pub const HITSTOP_HIT: f64 = 0.05;
pub const HITSTOP_KILL: f64 = 0.09;
pub const SHAKE_ON_HIT: f64 = 0.1;
pub const SHAKE_ON_KILL: f64 = 0.2;

// ── Cards Tuning ──────────────────────────────────────────────────────────────
pub const CARD_PINBALL_SPEED: f64 = 8.0;
pub const MOMENTUM_T_FLOOR: f64 = 5.2; // PLAYER_SPEED
pub const MOMENTUM_T_K: f64 = 0.22;
pub const CARD_CHILL_TIME: f64 = 2.5;
pub const CARD_CHILL_SLOW: f64 = 0.5;
pub const CARD_BURN_TIME: f64 = 3.0;
pub const CARD_BURN_TICK: f64 = 0.5;
pub const CARD_BURN_DMG: i32 = 1;

pub const CARD_BOLT_LENGTH: f64 = 5.0;
pub const CARD_BOLT_HALF_WIDTH: f64 = 0.9;
pub const CARD_BOLT_DAMAGE: i32 = 4;
pub const CARD_BOLT_COOLDOWN: f64 = 0.6;

pub const PARTS_BASE: usize = 6;
pub const PARTS_PER_LEVEL: usize = 2;
pub const PARTS_MAX: usize = 26;

// ── Rampage (FPS Ultimate) ────────────────────────────────────────────────────
pub const ULT_CHARGE_PER_KILL: f64 = 0.09;
pub const ULT_DURATION: f64 = 12.0;

// ── Mana & Abilities ──────────────────────────────────────────────────────────
pub const MANA_MAX: i32 = 100;
pub const MANA_POOL_FLOOR: i32 = 55;
pub const MANA_REGEN: f64 = 7.0;
pub const MANA_PER_KILL: i32 = 6;

pub const ARCANE_PULSE_RADIUS: f64 = 3.4;
pub const ARCANE_PULSE_DAMAGE: i32 = 5;
pub const FLIPPER_LAUNCH_SPEED: f64 = 19.0;
pub const MAGNET_AURA_PULL: f64 = 8.0;
pub const TIMECRAWL_FACTOR: f64 = 0.3;
pub const BLADESTORM_RADIUS: f64 = 1.6;
pub const BLADESTORM_DAMAGE: i32 = 2;
pub const BLADESTORM_TICK: f64 = 0.35;

// ── Arcane Pulse Shockwave ────────────────────────────────────────────────────
pub const PULSE_WAVE_DUR: f64 = 0.55;
pub const PULSE_RING_LAG: f64 = 0.07;
pub const PULSE_RIM_BURSTS: usize = 8;
pub const PULSE_CAST_FORKS: usize = 8;
pub const PULSE_MID_FORKS: usize = 6;
pub const PULSE_CRACKLE_ARCS: usize = 2;
pub const PULSE_CRACKLE_EVERY: f64 = 0.07;
pub const PULSE_SIGIL_LIFE: f64 = 0.85;
pub const PULSE_SIGIL_SPIN: f64 = 1.4;
pub const PULSE_COLUMN_MOTES: usize = 14;
pub const PULSE_C_LIGHT: u32 = 0x6fd0e8;
pub const PULSE_C_MID: u32 = 0x2e6d8f;

// ── Sustained Buff Aesthetics ─────────────────────────────────────────────────
pub const BLADESTORM_BLADES: usize = 3;
pub const BLADESTORM_SPIN: f64 = 7.5;
pub const MAGNET_FIELD_R: f64 = 3.2;
pub const MAGNET_PULSE_EVERY: f64 = 0.42;
pub const MAGNET_LEASH_MAX: usize = 3;
pub const MAGNET_HORDE_PULL: f64 = 1.6;
pub const TIMECRAWL_FIELD_R: f64 = 4.2;
pub const TIMECRAWL_SMEAR: f64 = 0.22;

// ── Flipper Charge Fire Trail ─────────────────────────────────────────────────
pub const FLIPPER_TRAIL_T: f64 = 0.9;
pub const FLIPPER_TRAIL_MIN_SPEED: f64 = 6.0;
pub const FLIPPER_TRAIL_RADIUS: f64 = 0.55;
pub const FLIPPER_TRAIL_LIFE: f64 = 3.5;
pub const FLIPPER_TRAIL_GHOST_T: f64 = 0.05;

// ── Slick Field ───────────────────────────────────────────────────────────────
pub const OIL_SLICK_RADIUS: f64 = 1.6;
pub const OIL_SLICK_LIFE: f64 = 12.0;
pub const OIL_ZOMBIE_T: f64 = 2.5;
pub const OIL_STEER_BLEND: f64 = 1.1;
pub const OIL_MARBLE_T: f64 = 0.35;
pub const OIL_IGNITE_LIFE: f64 = 8.0;

pub const SLICK_BOIL_RATE: f64 = 3.5;
pub const FIRE_QUENCH_RATE: f64 = 2.0;

// ── Finisher & FPS Constants ──────────────────────────────────────────────────
pub const FINISHER_FLASH_T: f64 = 0.14;
pub const FINISHER_FLASH_MAX: f64 = 0.75;
pub const FPS_EYE_HEIGHT: f64 = 0.62;
pub const FPS_FOV: f64 = 75.0;
pub const FPS_MOVE_SPEED: f64 = 5.6;
pub const FPS_TURN_SPEED: f64 = 2.6;
pub const FPS_MOUSE_SENS: f64 = 0.0026;
pub const FPS_PITCH_LIMIT: f64 = 0.5;
pub const FPS_SHOT_COOLDOWN: f64 = 0.14;
pub const FPS_SHOT_DAMAGE: i32 = 3;
pub const FPS_SHOT_RANGE: f64 = 14.0;

// ── Table Mana Battery ────────────────────────────────────────────────────────
pub const MANA_PER_BOUNCE: f64 = 1.4;
pub const MANA_BOUNCE_MOMENTUM: f64 = 1.15;

// ── Ability Ranks ─────────────────────────────────────────────────────────────
pub const ABILITY_RANK_MAX: usize = 3;
pub const ABILITY_RANK_STEP: f64 = 0.25;
pub const ABILITY_RANK_RULE: usize = 2;

// ── Cast Animation Defs ───────────────────────────────────────────────────────
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CastAnimDef {
    pub windup: f64,
    pub recover: f64,
    pub shake: f64,
    pub hitstop: f64,
    pub flash: f64,
    pub gather: f64,
}

pub const CAST_GATHER_EVERY: f64 = 0.035;

pub const CAST_ANIM_FLIPPERCHARGE: CastAnimDef = CastAnimDef {
    windup: 0.08,
    recover: 0.22,
    shake: 0.18,
    hitstop: 0.03,
    flash: 0.0,
    gather: 1.8,
};

pub const CAST_ANIM_ARCANEPULSE: CastAnimDef = CastAnimDef {
    windup: 0.20,
    recover: 0.34,
    shake: 0.30,
    hitstop: 0.05,
    flash: 0.08,
    gather: 3.2,
};

pub const CAST_ANIM_MAGNETAURA: CastAnimDef = CastAnimDef {
    windup: 0.13,
    recover: 0.26,
    shake: 0.08,
    hitstop: 0.0,
    flash: 0.0,
    gather: 3.0,
};

pub const CAST_ANIM_TIMECRAWL: CastAnimDef = CastAnimDef {
    windup: 0.26,
    recover: 0.40,
    shake: 0.12,
    hitstop: 0.07,
    flash: 0.12,
    gather: 4.2,
};

pub const CAST_ANIM_BLADESTORM: CastAnimDef = CastAnimDef {
    windup: 0.15,
    recover: 0.24,
    shake: 0.14,
    hitstop: 0.04,
    flash: 0.0,
    gather: 2.2,
};

pub const CAST_ANIM_SLICKFIELD: CastAnimDef = CastAnimDef {
    windup: 0.11,
    recover: 0.28,
    shake: 0.10,
    hitstop: 0.0,
    flash: 0.0,
    gather: 2.0,
};

pub fn cast_anim_for(ability: &str) -> Option<CastAnimDef> {
    match ability {
        "flippercharge" => Some(CAST_ANIM_FLIPPERCHARGE),
        "arcanepulse" => Some(CAST_ANIM_ARCANEPULSE),
        "magnetaura" => Some(CAST_ANIM_MAGNETAURA),
        "timecrawl" => Some(CAST_ANIM_TIMECRAWL),
        "bladestorm" => Some(CAST_ANIM_BLADESTORM),
        "slickfield" => Some(CAST_ANIM_SLICKFIELD),
        _ => None,
    }
}

// ── Keystones ─────────────────────────────────────────────────────────────────
pub const DYNAMO_BOUNCE_MULT: f64 = 3.2;
pub const BLOOD_PRICE_HP: i32 = 1;
pub const CINDER_WAKE_T: f64 = 0.55;
pub const CINDER_WAKE_RADIUS: f64 = 0.45;
pub const CINDER_WAKE_LIFE: f64 = 2.2;

// ── Deferred Floor FX ─────────────────────────────────────────────────────────
pub const FROST_RUNE_RADIUS: f64 = 0.7;
pub const FROST_RUNE_LIFE: f64 = 6.0;
pub const FROST_RUNE_COUNT: usize = 6;
pub const FROST_RUNE_RING: f64 = 2.6;

pub const TAR_PIT_RADIUS: f64 = 0.95;
pub const TAR_PIT_LIFE: f64 = 9.0;
pub const TAR_DRAG: f64 = 2.6;

pub const LIGHTNING_ROD_RADIUS: f64 = 0.45;
pub const LIGHTNING_ROD_LIFE: f64 = 5.0;
pub const LIGHTNING_ROD_RANGE: f64 = 4.2;
pub const LIGHTNING_ROD_DAMAGE: i32 = 3;
pub const LIGHTNING_ROD_TICK: f64 = 0.45;
