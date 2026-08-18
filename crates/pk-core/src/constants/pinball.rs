//! Pinball table physics, momentum, combo curves, boosters, and rails tuning constants.
//!
//! PORTS: `constants/pinball.ts`

pub const OVERCHARGE_TIME: f64 = 1.4;
pub const OVERCHARGE_DECAY: f64 = 1.0;
pub const PINBALL_WALL_RESTITUTION: f64 = 0.94;
pub const PINBALL_CORNER_RESTITUTION: f64 = 1.08;
pub const PINBALL_CORNER_ADD: f64 = 1.0;
pub const PINBALL_MAX_SPEED: f64 = 22.0;
pub const PINBALL_FRICTION: f64 = 0.9;
pub const FRICTION_OPEN: f64 = 0.35;
pub const FRICTION_CORRIDOR: f64 = 1.0;
pub const FRICTION_TIGHT: f64 = 2.1;
pub const PINBALL_STEER: f64 = 3.6;
pub const LANE_CENTER_PULL: f64 = 5.0;
pub const LANE_PROBE_MAX: f64 = 1.8;
pub const PINBALL_EXIT_MULT: f64 = 1.05;

// Pocket-rattle guard
pub const POCKET_RADIUS: f64 = 1.4;
pub const POCKET_BOUNCES: i32 = 5;
pub const POCKET_DAMP: f64 = 0.62;
pub const POCKET_WINDOW: f64 = 1.1;

// Juice governor
pub const HITSTOP_MIN_GAP: f64 = 0.11;
pub const HITSTOP_CHAIN_FALLOFF: f64 = 0.55;
pub const HITSTOP_CHAIN_FLOOR: f64 = 0.25;
pub const HITSTOP_MAX_PENDING: f64 = 0.09;
pub const SHAKE_CHAIN_WINDOW: f64 = 0.09;
pub const SHAKE_CHAIN_FALLOFF: f64 = 0.72;
pub const SHAKE_CHAIN_FLOOR: f64 = 0.35;

pub const PINBALL_COMBO_WINDOW: f64 = 1.6;
pub const BALL_SPEED_MULT: f64 = 1.35;

// Progressive combo ramp
pub const COMBO_CEIL_BASE: f64 = 8.0;
pub const COMBO_CEIL_K: f64 = 0.15;
pub const COMBO_CEIL_NSAT: i32 = 80;
pub const COMBO_REST_LAMBDA: f64 = 0.08;
pub const COMBO_ADD_MU: f64 = 0.06;
pub const COMBO_WINDOW_MAX: f64 = 2.2;
pub const COMBO_WINDOW_MIN: f64 = 0.9;
pub const COMBO_WINDOW_ALPHA: f64 = 0.07;
pub const COMBO_FRICTION_K: f64 = 0.015;
pub const COMBO_GOLD_TIER: i64 = 3;
pub const COMBO_DMG_MAX: f64 = 1.35;
pub const COMBO_DMG_K: f64 = 0.15;
pub const COMBO_DMG_NSAT: i32 = 60;
pub const COMBO_ZONE_CRUISE: i32 = 8;
pub const COMBO_ZONE_FRENZY: i32 = 30;
pub const FRENZY_BALL_SPEED_MULT: f64 = 1.6;
pub const FRENZY_VIGNETTE: f64 = 0.48;
pub const FRENZY_ABERRATION: f64 = 0.006;
pub const BALL_RAM_COOLDOWN: f64 = 0.18;
pub const BALL_RAM_KNOCKBACK: f64 = 1.1;
pub const FPS_BALL: f64 = 14.0;

// Steel Ball Form Defaults
pub const STEEL_WALL_BREAK_SPEED: f64 = 11.0;
pub const STEEL_SECRET_BREAK_SPEED: f64 = 5.5;
pub const STEEL_RAM_KNOCKBACK: f64 = 1.9;
pub const STEEL_FRICTION_MULT: f64 = 0.82;
pub const STEEL_STEER_MULT: f64 = 0.88;
pub const STEEL_WALL_BREAK_SPEED_COST: f64 = 0.82;
pub const STEEL_RAM_DAMAGE_MULT: f64 = 1.35;
pub const FLOOR_FX_MAX: usize = 300;

// Groove Mechanics
pub const GROOVE_MIN_SPEED: f64 = 9.0;
pub const GROOVE_SPACING: f64 = 0.34;
pub const GROOVE_RADIUS: f64 = 0.3;
pub const GROOVE_LIFE: f64 = 26.0;
pub const GROOVE_TRIP_TIME: f64 = 0.42;
pub const GROOVE_TRIP_SPEED: f64 = 0.9;
pub const GROOVE_RAIL_PULL: f64 = 3.4;
pub const GROOVE_RAIL_MAX_SPEED: f64 = 17.0;
pub const GROOVE_ALIGN_RIDE: f64 = 0.72;
pub const GROOVE_ALIGN_CROSS: f64 = 0.42;
pub const GROOVE_HOP_HEIGHT: f64 = 0.34;
pub const GROOVE_HOP_TIME: f64 = 0.19;
pub const GROOVE_HOP_SPEED_KEEP: f64 = 0.94;
pub const GROOVE_HOP_MIN_SPEED: f64 = 7.0;
pub const GROOVE_DEFLECT: f64 = 5.2;
pub const GROOVE_HOP_COOLDOWN: f64 = 0.26;

// Multi-Ball
pub const MULTIBALL_COUNT: usize = 2;
pub const MULTIBALL_TRAIL_SECONDS: f64 = 1.2;
pub const MULTIBALL_LAGS: [f64; 2] = [0.22, 0.4];
pub const MULTIBALL_SIDE_OFFSET: f64 = 0.42;
pub const MULTIBALL_HEADING_STEP: f64 = 0.1;
pub const MULTIBALL_FOLLOW_RATE: f64 = 16.0;
pub const MULTIBALL_RAM_MULT: f64 = 0.5;
pub const MULTIBALL_RAM_COOLDOWN: f64 = 0.45;
pub const MULTIBALL_OPACITY: f64 = 0.5;

// Pinball Parts
pub const BUMPER_RADIUS: f64 = 0.46;
pub const BUMPER_KICK_MULT: f64 = 1.0;
pub const BUMPER_KICK_ADD: f64 = 3.2;
pub const BUMPER_MIN_EXIT: f64 = 9.0;
pub const BUMPER_COOLDOWN: f64 = 0.25;
pub const BUMPER_SCATTER: f64 = 0.1;
pub const BUMPER_LIT_HITS: i32 = 3;
pub const BUMPER_KICK_LIT: f64 = 5.6;
pub const BUMPER_LIT_GOLD: i64 = 3;
pub const JACKPOT_BUMPERS: i32 = 5;

// Buff Tells
pub const BUFF_TELL_INTERVAL: f64 = 0.1;
pub const TELL_TINT_RAGE: u32 = 0xd97b29;
pub const TELL_TINT_HASTE: u32 = 0x6fd0e8;
pub const TELL_TINT_SHIELD: u32 = 0x8fc46b;
pub const SHIELD_RING_INTERVAL: f64 = 0.13;
pub const SHIELD_RING_MOTES: usize = 3;
pub const SHIELD_RING_RADIUS: f64 = 0.55;

// Shot Identity & Plunger
pub const ROLLOVER_RADIUS: f64 = 0.46;
pub const ROLLOVER_COOLDOWN: f64 = 0.5;
pub const ORBIT_WINDOW: f64 = 2.6;
pub const ORBIT_GOLD: i64 = 30;
pub const ORBIT_LAP_BONUS: i64 = 15;
pub const LANE_CLEAR_GOLD: i64 = 25;
pub const PLUNGER_SPEED: f64 = 13.0;
pub const PLUNGER_MIN_SPEED: f64 = 6.0;
pub const PLUNGER_CHARGE_TIME: f64 = 0.85;
pub const PLUNGER_AIM_MAX: f64 = std::f64::consts::FRAC_PI_6;
pub const PLUNGER_AIM_RATE: f64 = 1.7;
pub const PLUNGER_SKILL_RANGE: f64 = 26.0;
pub const SKILL_SHOT_WINDOW: f64 = 6.0;
pub const SKILL_SHOT_GOLD: i64 = 40;
pub const NAMED_CHAIN_MAX: usize = 5;

#[derive(Debug, Clone)]
pub struct NamedComboSpec {
    pub name: &'static str,
    pub icon: &'static str,
    pub shots: &'static [&'static str],
    pub gold: i64,
}

pub const NAMED_COMBOS: &[NamedComboSpec] = &[
    NamedComboSpec {
        name: "GRAND TOUR",
        icon: "👑",
        shots: &["ramp", "orbit", "lanes", "bank"],
        gold: 120,
    },
    NamedComboSpec {
        name: "PINBALL WIZARD",
        icon: "🧙",
        shots: &["bumper", "bumper", "jackpot"],
        gold: 150,
    },
    NamedComboSpec {
        name: "THE GAUNTLET",
        icon: "🥊",
        shots: &["flipper", "mirror", "target"],
        gold: 100,
    },
    NamedComboSpec {
        name: "BANK JOB",
        icon: "🏦",
        shots: &["bank", "bank", "bank"],
        gold: 50,
    },
    NamedComboSpec {
        name: "THE CIRCUIT",
        icon: "🌀",
        shots: &["orbit", "orbit"],
        gold: 90,
    },
    NamedComboSpec {
        name: "TRICK SHOT",
        icon: "🪞",
        shots: &["mirror", "mirror"],
        gold: 80,
    },
    NamedComboSpec {
        name: "SLING RUNNER",
        icon: "🌠",
        shots: &["sling", "orbit"],
        gold: 75,
    },
    NamedComboSpec {
        name: "ORBIT RUNNER",
        icon: "↻",
        shots: &["ramp", "orbit"],
        gold: 70,
    },
    NamedComboSpec {
        name: "KICKOFF",
        icon: "🦿",
        shots: &["flipper", "ramp"],
        gold: 65,
    },
    NamedComboSpec {
        name: "LANE RUNNER",
        icon: "⋯",
        shots: &["ramp", "lanes"],
        gold: 60,
    },
    NamedComboSpec {
        name: "SHARPSHOOTER",
        icon: "🎯",
        shots: &["skill", "target"],
        gold: 55,
    },
    NamedComboSpec {
        name: "ROULETTE",
        icon: "🎡",
        shots: &["spin", "target"],
        gold: 55,
    },
];

pub const SHOT_LIGHT_MIN_SPEED: f64 = 5.0;
pub const SHOT_LIGHT_RANGE: f64 = 14.0;
pub const SHOT_LIGHT_COS: f64 = 0.94;
pub const PART_ANIM_RANGE: f64 = 24.0;
pub const PART_ANIM_RANGE_SQ: f64 = 576.0;
pub const PART_TOUCH_BROAD: f64 = 12.0;
pub const PART_TOUCH_BROAD_SQ: f64 = 144.0;
pub const JACKPOT_GOLD: i64 = 45;
pub const JACKPOT_DAMAGE: f64 = 6.0;

// Launchers & Elements
pub const SPRING_SPEED: f64 = 16.0;
pub const SPRING_COOLDOWN: f64 = 0.6;
pub const RAMP_SPEED: f64 = 13.0;
pub const RAMP_COOLDOWN: f64 = 0.35;
pub const RAMP_STEER_LOCK: f64 = 0.25;
pub const RAMP_HOP_HEIGHT: f64 = 1.75;
pub const RAMP_HOP_MIN: f64 = 2.5;
pub const RAMP_HOP_MAX: f64 = 4.75;
pub const VAULT_RAMPS_PER_FLOOR: usize = 3;
pub const FOG_RADIUS: i32 = 6;
pub const RAMP_HOP_SPEED: f64 = 16.0;
pub const DEFLECTOR_BOOST: f64 = 1.03;
pub const DEFLECTOR_COOLDOWN: f64 = 0.3;
pub const DEFLECTOR_GRAB_TIME: f64 = 0.13;
pub const DEFLECTOR_THROW_SPEED: f64 = 19.0;
pub const DEFLECTOR_THROW_BOOST: f64 = 1.18;
