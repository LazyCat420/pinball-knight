//! Pinball physics, combo curve, table parts, booster, rails, and steel ball tuning constants.
//!
//! Port of `legacy/src/game/pinball-knight/constants/pinball.ts` (1,289 lines).
//!
//! PORTS: `constants/pinball.ts`

// ── Momentum & Overcharge ───────────────────────────────────────────────────

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

pub const POCKET_RADIUS: f64 = 1.4;
pub const POCKET_BOUNCES: i32 = 5;
pub const POCKET_DAMP: f64 = 0.62;
pub const POCKET_WINDOW: f64 = 1.1;

// ── Hitstop & Screen Juice ──────────────────────────────────────────────────

pub const HITSTOP_MIN_GAP: f64 = 0.11;
pub const HITSTOP_CHAIN_FALLOFF: f64 = 0.55;
pub const HITSTOP_CHAIN_FLOOR: f64 = 0.25;
pub const HITSTOP_MAX_PENDING: f64 = 0.09;

pub const SHAKE_CHAIN_WINDOW: f64 = 0.09;
pub const SHAKE_CHAIN_FALLOFF: f64 = 0.72;
pub const SHAKE_CHAIN_FLOOR: f64 = 0.35;

pub const PINBALL_COMBO_WINDOW: f64 = 1.6;
pub const BALL_SPEED_MULT: f64 = 1.35;

// ── Progressive Combo Ramp ──────────────────────────────────────────────────

pub const COMBO_CEIL_BASE: f64 = 8.0;
pub const COMBO_CEIL_K: f64 = 0.15;
pub const COMBO_CEIL_NSAT: f64 = 80.0;

pub const COMBO_REST_LAMBDA: f64 = 0.08;
pub const COMBO_ADD_MU: f64 = 0.06;

pub const COMBO_WINDOW_MAX: f64 = 2.2;
pub const COMBO_WINDOW_MIN: f64 = 0.9;
pub const COMBO_WINDOW_ALPHA: f64 = 0.07;

pub const COMBO_FRICTION_K: f64 = 0.015;
pub const COMBO_GOLD_TIER: u32 = 3;

pub const COMBO_DMG_MAX: f64 = 1.35;
pub const COMBO_DMG_K: f64 = 0.15;
pub const COMBO_DMG_NSAT: f64 = 60.0;

pub const COMBO_ZONE_CRUISE: u32 = 8;
pub const COMBO_ZONE_FRENZY: u32 = 30;

pub const FRENZY_BALL_SPEED_MULT: f64 = 1.6;
pub const FRENZY_VIGNETTE: f64 = 0.48;
pub const FRENZY_ABERRATION: f64 = 0.006;

pub const BALL_RAM_COOLDOWN: f64 = 0.18;
pub const BALL_RAM_KNOCKBACK: f64 = 1.1;
pub const FPS_BALL: u32 = 14;

// ── Steel Base Ball ─────────────────────────────────────────────────────────

pub const STEEL_WALL_BREAK_SPEED: f64 = 11.0;
pub const STEEL_SECRET_BREAK_SPEED: f64 = 5.5;
pub const STEEL_RAM_KNOCKBACK: f64 = 1.9;
pub const STEEL_FRICTION_MULT: f64 = 0.82;
pub const STEEL_STEER_MULT: f64 = 0.88;
pub const STEEL_WALL_BREAK_SPEED_COST: f64 = 0.82;
pub const STEEL_RAM_DAMAGE_MULT: f64 = 1.35;

pub const FLOOR_FX_MAX: usize = 300;

// ── Groove Rut Mechanics ────────────────────────────────────────────────────

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

// ── Multi-Ball (Echo Knights) ───────────────────────────────────────────────

pub const MULTIBALL_COUNT: usize = 2;
pub const MULTIBALL_TRAIL_SECONDS: f64 = 1.2;
pub const MULTIBALL_LAGS: [f64; 2] = [0.22, 0.4];
pub const MULTIBALL_SIDE_OFFSET: f64 = 0.42;
pub const MULTIBALL_HEADING_STEP: f64 = 0.1;
pub const MULTIBALL_FOLLOW_RATE: f64 = 16.0;
pub const MULTIBALL_RAM_MULT: f64 = 0.5;
pub const MULTIBALL_RAM_COOLDOWN: f64 = 0.45;
pub const MULTIBALL_OPACITY: f64 = 0.5;

// ── Pop Bumpers ─────────────────────────────────────────────────────────────

pub const BUMPER_RADIUS: f64 = 0.46;
pub const BUMPER_KICK_MULT: f64 = 1.0;
pub const BUMPER_KICK_ADD: f64 = 3.2;
pub const BUMPER_MIN_EXIT: f64 = 9.0;
pub const BUMPER_COOLDOWN: f64 = 0.25;
pub const BUMPER_SCATTER: f64 = 0.1;
pub const BUMPER_LIT_HITS: u32 = 3;
pub const BUMPER_KICK_LIT: f64 = 5.6;
pub const BUMPER_LIT_GOLD: u32 = 3;
pub const JACKPOT_BUMPERS: u32 = 5;
pub const JACKPOT_GOLD: u32 = 45;
pub const JACKPOT_DAMAGE: f64 = 6.0;

// ── Buff Visual Cadence & World Tells ───────────────────────────────────────

pub const BUFF_TELL_INTERVAL: f64 = 0.1;
pub const TELL_TINT_RAGE: u32 = 0xd97b29;
pub const TELL_TINT_HASTE: u32 = 0x6fd0e8;
pub const TELL_TINT_SHIELD: u32 = 0x8fc46b;
pub const SHIELD_RING_INTERVAL: f64 = 0.13;
pub const SHIELD_RING_MOTES: usize = 3;
pub const SHIELD_RING_RADIUS: f64 = 0.55;

// ── Shot Identity & Plunger ─────────────────────────────────────────────────

pub const ROLLOVER_RADIUS: f64 = 0.46;
pub const ROLLOVER_COOLDOWN: f64 = 0.5;
pub const ORBIT_WINDOW: f64 = 2.6;
pub const ORBIT_GOLD: u32 = 30;
pub const ORBIT_LAP_BONUS: u32 = 15;
pub const LANE_CLEAR_GOLD: u32 = 25;

pub const PLUNGER_SPEED: f64 = 13.0;
pub const PLUNGER_MIN_SPEED: f64 = 6.0;
pub const PLUNGER_CHARGE_TIME: f64 = 0.85;
pub const PLUNGER_AIM_MAX: f64 = std::f64::consts::FRAC_PI_6; // ~30 deg
pub const PLUNGER_AIM_RATE: f64 = 1.7;
pub const PLUNGER_SKILL_RANGE: f64 = 26.0;
pub const SKILL_SHOT_WINDOW: f64 = 6.0;
pub const SKILL_SHOT_GOLD: u32 = 40;
pub const NAMED_CHAIN_MAX: usize = 5;

pub const SHOT_LIGHT_MIN_SPEED: f64 = 5.0;
pub const SHOT_LIGHT_RANGE: f64 = 14.0;
pub const SHOT_LIGHT_COS: f64 = 0.94;
pub const PART_ANIM_RANGE: f64 = 24.0;
pub const PART_ANIM_RANGE_SQ: f64 = PART_ANIM_RANGE * PART_ANIM_RANGE;

pub const PART_TOUCH_BROAD: f64 = 12.0;
pub const PART_TOUCH_BROAD_SQ: f64 = PART_TOUCH_BROAD * PART_TOUCH_BROAD;

// ── Springs, Ramps & Deflectors ─────────────────────────────────────────────

pub const SPRING_SPEED: f64 = 16.0;
pub const SPRING_COOLDOWN: f64 = 0.6;

pub const RAMP_SPEED: f64 = 13.0;
pub const RAMP_COOLDOWN: f64 = 0.35;
pub const RAMP_STEER_LOCK: f64 = 0.25;
pub const RAMP_HOP_HEIGHT: f64 = 1.75;
pub const RAMP_HOP_MIN: f64 = 2.5;
pub const RAMP_HOP_MAX: f64 = 4.75;
pub const VAULT_RAMPS_PER_FLOOR: usize = 3;
pub const FOG_RADIUS: f64 = 6.0;
pub const RAMP_HOP_SPEED: f64 = 16.0;

pub const DEFLECTOR_BOOST: f64 = 1.03;
pub const DEFLECTOR_COOLDOWN: f64 = 0.3;
pub const DEFLECTOR_GRAB_TIME: f64 = 0.13;
pub const DEFLECTOR_THROW_SPEED: f64 = 19.0;
pub const DEFLECTOR_THROW_BOOST: f64 = 1.18;

// ── Boosters & Rails ────────────────────────────────────────────────────────

pub const BOOSTER_SPEED: f64 = 17.5;
pub const BOOSTER_STEER_LOCK: f64 = 0.22;
pub const BOOST_CORNER_SPEED: f64 = 18.0;
pub const BOOST_CURVE_SPEED: f64 = 18.5;

pub const JUMP_PAD_SPEED: f64 = 15.0;
pub const JUMP_PAD_LIFETIME: f64 = 0.90;
pub const JUMP_PAD_AIR_TIME: f64 = 0.65;

pub const GLOVE_PUNCH_SPEED: f64 = 20.0;
pub const GLOVE_LANE_LEN: f64 = 1.7;
pub const SPIN_PAD_TORQUE: f64 = 4.5;
pub const SLINGSHOT_SPEED: f64 = 18.0;
pub const TARGET_RESTITUTION: f64 = 0.85;
pub const TRAPDOOR_LIFETIME: f64 = 2.05;
pub const FLIPPER_TIP_SPEED: f64 = 21.0;
pub const FLIPPER_ANGULAR_VEL: f64 = 14.0;

pub const MIRROR_REFLECT_MULT: f64 = 1.05;
pub const MAGNET_PULL_RANGE: f64 = 4.2;
pub const MAGSTRIP_PULL_FORCE: f64 = 7.5;
pub const VENT_LANE_LEN: f64 = 2.4;
pub const FIRE_VENT_LIFETIME: f64 = 1.60;
pub const ELECTRIC_ZAP_DAMAGE: f64 = 35.0;
pub const ROLLOVER_SCORE: u32 = 250;
pub const LAMP_LIGHT_RADIUS: f64 = 3.2;

// ── Squash & Deformation ────────────────────────────────────────────────────

pub const SQUASH_REST_SCALE: (f64, f64, f64) = (1.0, 1.0, 1.0);
pub const SQUASH_DECAY_RATE: f64 = 8.0;
pub const SQUASH_MAX_DEFLECTION: f64 = 0.42;

// ── Named Combo Data ────────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NamedCombo {
    pub name: &'static str,
    pub icon: &'static str,
    pub shots: &'static [&'static str],
    pub gold: u32,
}

pub const NAMED_COMBOS: &[NamedCombo] = &[
    NamedCombo {
        name: "GRAND TOUR",
        icon: "👑",
        shots: &["ramp", "orbit", "lanes", "bank"],
        gold: 120,
    },
    NamedCombo {
        name: "PINBALL WIZARD",
        icon: "🧙",
        shots: &["bumper", "bumper", "jackpot"],
        gold: 150,
    },
    NamedCombo {
        name: "THE GAUNTLET",
        icon: "🥊",
        shots: &["flipper", "mirror", "target"],
        gold: 100,
    },
    NamedCombo {
        name: "BANK JOB",
        icon: "🏦",
        shots: &["bank", "bank", "bank"],
        gold: 50,
    },
    NamedCombo {
        name: "THE CIRCUIT",
        icon: "🌀",
        shots: &["orbit", "orbit"],
        gold: 90,
    },
    NamedCombo {
        name: "TRICK SHOT",
        icon: "🪞",
        shots: &["mirror", "mirror"],
        gold: 80,
    },
    NamedCombo {
        name: "SLING RUNNER",
        icon: "🌠",
        shots: &["sling", "orbit"],
        gold: 75,
    },
    NamedCombo {
        name: "ORBIT RUNNER",
        icon: "↻",
        shots: &["ramp", "orbit"],
        gold: 70,
    },
    NamedCombo {
        name: "KICKOFF",
        icon: "🦿",
        shots: &["flipper", "ramp"],
        gold: 65,
    },
    NamedCombo {
        name: "LANE RUNNER",
        icon: "⋯",
        shots: &["ramp", "lanes"],
        gold: 60,
    },
    NamedCombo {
        name: "SHARPSHOOTER",
        icon: "🎯",
        shots: &["skill", "target"],
        gold: 55,
    },
    NamedCombo {
        name: "ROULETTE",
        icon: "🎡",
        shots: &["spin", "target"],
        gold: 55,
    },
];

// ── Pure Math Helpers ───────────────────────────────────────────────────────

pub fn combo_speed_ceil(combo: u32) -> f64 {
    let t = (combo as f64 / COMBO_CEIL_NSAT).min(1.0);
    COMBO_CEIL_BASE + (PINBALL_MAX_SPEED - COMBO_CEIL_BASE) * (1.0 - (-COMBO_CEIL_K * t * 10.0).exp())
}

pub fn combo_damage_mult(combo: u32) -> f64 {
    if combo < COMBO_ZONE_CRUISE {
        1.0
    } else {
        let t = ((combo - COMBO_ZONE_CRUISE) as f64 / COMBO_DMG_NSAT).min(1.0);
        1.0 + (COMBO_DMG_MAX - 1.0) * (1.0 - (-COMBO_DMG_K * t * 10.0).exp())
    }
}

pub fn combo_window(combo: u32) -> f64 {
    COMBO_WINDOW_MIN + (COMBO_WINDOW_MAX - COMBO_WINDOW_MIN) * (-COMBO_WINDOW_ALPHA * combo as f64).exp()
}

pub fn combo_corner_restitution(combo: u32) -> f64 {
    1.0 + (PINBALL_CORNER_RESTITUTION - 1.0) * (-COMBO_REST_LAMBDA * combo as f64).exp()
}

pub fn combo_corner_add(combo: u32) -> f64 {
    PINBALL_CORNER_ADD * (-COMBO_ADD_MU * combo as f64).exp()
}
