//! Player movement, sprint, wall-ride, dodge roll and attack timing constants.
//!
//! PORTS: `constants/player.ts`

pub const PLAYER_SPEED: f64 = 4.2;
pub const PLAYER_R: f64 = 0.3;
pub const PLAYER_MAX_HP: i32 = 6;
pub const PLAYER_IFRAMES: f64 = 0.9;

// Sprint (hold Shift)
pub const SPRINT_BASE_MULT: f64 = 1.35;
pub const SPRINT_SPEED_MULT: f64 = 1.85;
pub const MOVE_ACCEL: f64 = 55.0;
pub const MOVE_FRICTION: f64 = 42.0;
pub const SPRINT_RAMP_TIME: f64 = 1.5;
pub const SPRINT_DECAY_TIME: f64 = 0.8;
pub const SPRINT_GRACE: f64 = 0.6;
pub const SPRINT_RIDE_THRESHOLD: f64 = 0.5;
pub const RUN_CLIP_THRESHOLD: f64 = 0.12;

// Speed aura
pub const AURA_MIN_CHARGE: f64 = 0.35;
pub const AURA_INTERVAL: f64 = 0.11;
pub const AURA_LIFE: f64 = 0.32;
pub const AURA_OPACITY: f64 = 0.4;
pub const AURA_TINT_COOL: u32 = 0x6fd0e8;
pub const AURA_TINT_HOT: u32 = 0xffd23f;
pub const AURA_HOT_CHARGE: f64 = 0.95;

// Wall-ride slide & specials
pub const WALLRIDE_SLIDE_BOOST: f64 = 1.18;
pub const GRIND_SPARK_INTERVAL: f64 = 0.07;
pub const WALL_CONTACT_PROBE: f64 = 0.26;
pub const WALLKICK_DURATION: f64 = 0.3;
pub const WALLKICK_IFRAMES: f64 = 0.16;
pub const WALLKICK_DISTANCE: f64 = 2.2;
pub const POUNCE_DURATION: f64 = 0.36;
pub const POUNCE_IFRAMES: f64 = 0.22;
pub const POUNCE_DISTANCE: f64 = 3.2;
pub const POUNCE_AOE: f64 = 1.6;

// Dodge-roll
pub const ROLL_DURATION: f64 = 0.42;
pub const ROLL_IFRAMES: f64 = 0.22;
pub const ROLL_DISTANCE: f64 = 2.6;
pub const ROLL_RECOVERY: f64 = 0.1;
pub const ROLL_MIN_SPEED: f64 = 2.5;

// Attack timing model
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MoveTag {
    Light1,
    Light2,
    Finish,
    Surge,
    Heavy,
    Wallride,
    Pounce,
    Wallkick,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MoveTiming {
    pub tag: MoveTag,
    pub windup: f64,
    pub active: f64,
    pub recovery: f64,
    pub damage_mul: f64,
    pub arc_mul: f64,
    pub range_mul: f64,
    pub knockback_mul: f64,
    pub hitstop_mul: f64,
}

pub const LIGHT_1: MoveTiming = MoveTiming {
    tag: MoveTag::Light1,
    windup: 0.1,
    active: 0.05,
    recovery: 0.12,
    damage_mul: 1.0,
    arc_mul: 1.0,
    range_mul: 1.0,
    knockback_mul: 1.0,
    hitstop_mul: 1.0,
};

pub const LIGHT_2: MoveTiming = MoveTiming {
    tag: MoveTag::Light2,
    windup: 0.06,
    active: 0.05,
    recovery: 0.09,
    damage_mul: 1.15,
    arc_mul: 1.15,
    range_mul: 1.05,
    knockback_mul: 1.1,
    hitstop_mul: 1.1,
};

pub const COMBO_FINISH: MoveTiming = MoveTiming {
    tag: MoveTag::Finish,
    windup: 0.11,
    active: 0.07,
    recovery: 0.16,
    damage_mul: 2.0,
    arc_mul: 1.6,
    range_mul: 1.25,
    knockback_mul: 2.0,
    hitstop_mul: 1.8,
};

pub const HEAVY: MoveTiming = MoveTiming {
    tag: MoveTag::Heavy,
    windup: 0.24,
    active: 0.08,
    recovery: 0.28,
    damage_mul: 2.2,
    arc_mul: 1.5,
    range_mul: 1.15,
    knockback_mul: 2.6,
    hitstop_mul: 1.8,
};

pub const COMBO_SURGE: MoveTiming = MoveTiming {
    tag: MoveTag::Surge,
    windup: 0.13,
    active: 0.09,
    recovery: 0.2,
    damage_mul: 2.8,
    arc_mul: 1.9,
    range_mul: 1.35,
    knockback_mul: 2.8,
    hitstop_mul: 2.1,
};

pub const WALLKICK: MoveTiming = MoveTiming {
    tag: MoveTag::Wallkick,
    windup: 0.04,
    active: 0.06,
    recovery: 0.14,
    damage_mul: 1.4,
    arc_mul: 1.2,
    range_mul: 1.15,
    knockback_mul: 1.8,
    hitstop_mul: 1.3,
};

pub const WALLRIDE: MoveTiming = MoveTiming {
    tag: MoveTag::Wallride,
    windup: 0.05,
    active: 0.08,
    recovery: 0.16,
    damage_mul: 1.5,
    arc_mul: 1.7,
    range_mul: 1.25,
    knockback_mul: 1.5,
    hitstop_mul: 1.5,
};

pub const POUNCE: MoveTiming = MoveTiming {
    tag: MoveTag::Pounce,
    windup: 0.02,
    active: 0.1,
    recovery: 0.26,
    damage_mul: 1.9,
    arc_mul: 2.0,
    range_mul: 1.0,
    knockback_mul: 2.4,
    hitstop_mul: 2.0,
};

pub const MAX_ATLAS_WIDTH: u32 = 8192;
pub const MOMENTUM_WEAPON_MAX: f64 = 2.6;
pub const COMBO_MAX_STEP: usize = 3;
pub const COMBO_CHAIN: [MoveTiming; 4] = [LIGHT_1, LIGHT_2, COMBO_FINISH, COMBO_SURGE];
pub const COMBO_REQUIRES_HIT: bool = true;
pub const COMBO_RAMP: f64 = 0.92;
pub const COMBO_RAMP_FLOOR: f64 = 0.7;
pub const COMBO_WINDOW: f64 = 0.34;
pub const COMBO_WINDOW_HEFT_MULT: f64 = 0.75;

pub fn scale_move(move_timing: MoveTiming, heft: f64) -> MoveTiming {
    if (heft - 1.0).abs() < 1e-6 {
        return move_timing;
    }
    MoveTiming {
        windup: move_timing.windup * heft,
        recovery: move_timing.recovery * heft,
        ..move_timing
    }
}

pub const CHARGE_TIME: f64 = 0.6;
pub const INPUT_BUFFER: f64 = 0.13;
pub const KNOCKBACK_ZOMBIE: f64 = 0.45;
pub const KNOCKBACK_PLAYER: f64 = 0.35;
pub const BOOTS_SPEED_FACTOR: f64 = 1.18;
pub const PICKUP_RANGE: f64 = 0.45;
pub const CARD_PICKUP_RANGE: f64 = 0.8;
pub const PICKUP_SWEEP_MAX: f64 = 1.5;
pub const PICKUP_NOTE_COOLDOWN: f64 = 2.5;
