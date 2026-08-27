//! Pinball physics, momentum, combos, parts, rails, and marble material constants.
//!
//! Port of `legacy/src/game/pinball-knight/constants/pinball.ts` (1,289 lines).
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
pub const PINBALL_TURN_BOOST_MAX: f64 = 2.4;
pub const PINBALL_TURN_BOOST_START_DOT: f64 = 0.15;
pub const PINBALL_COUNTER_BRAKE: f64 = 4.0;
pub const PINBALL_COUNTER_BRAKE_DOT: f64 = -0.45;
pub const PINBALL_TURN_MAX_DELTA: f64 = 10.0;
pub const LANE_CENTER_PULL: f64 = 5.0;
pub const LANE_PROBE_MAX: f64 = 1.8;
pub const PINBALL_EXIT_MULT: f64 = 1.05;

pub const POCKET_RADIUS: f64 = 1.4;
pub const POCKET_BOUNCES: i32 = 5;
pub const POCKET_DAMP: f64 = 0.62;
pub const POCKET_WINDOW: f64 = 1.1;

pub const HITSTOP_MIN_GAP: f64 = 0.11;
pub const HITSTOP_CHAIN_FALLOFF: f64 = 0.55;
pub const HITSTOP_CHAIN_FLOOR: f64 = 0.25;
pub const HITSTOP_MAX_PENDING: f64 = 0.09;
pub const SHAKE_CHAIN_WINDOW: f64 = 0.09;
pub const SHAKE_CHAIN_FALLOFF: f64 = 0.72;
pub const SHAKE_CHAIN_FLOOR: f64 = 0.35;

pub const PINBALL_COMBO_WINDOW: f64 = 1.6;
pub const BALL_SPEED_MULT: f64 = 1.35;
pub const COMBO_CEIL_BASE: f64 = 8.0;
pub const COMBO_CEIL_K: f64 = 0.15;
pub const COMBO_CEIL_NSAT: f64 = 80.0;
pub const COMBO_REST_LAMBDA: f64 = 0.08;
pub const COMBO_ADD_MU: f64 = 0.06;
pub const COMBO_WINDOW_MAX: f64 = 2.2;
pub const COMBO_WINDOW_MIN: f64 = 0.9;
pub const COMBO_WINDOW_ALPHA: f64 = 0.07;
pub const COMBO_FRICTION_K: f64 = 0.015;
pub const COMBO_GOLD_TIER: i32 = 3;

pub const COMBO_DMG_MAX: f64 = 1.35;
pub const COMBO_DMG_K: f64 = 0.15;
pub const COMBO_DMG_NSAT: f64 = 60.0;
pub const COMBO_ZONE_CRUISE: i32 = 8;
pub const COMBO_ZONE_FRENZY: i32 = 30;
pub const FRENZY_BALL_SPEED_MULT: f64 = 1.6;
pub const FRENZY_VIGNETTE: f64 = 0.48;
pub const FRENZY_ABERRATION: f64 = 0.006;
pub const BALL_RAM_COOLDOWN: f64 = 0.18;
pub const BALL_RAM_KNOCKBACK: f64 = 1.1;
pub const FPS_BALL: i32 = 14;

pub const STEEL_WALL_BREAK_SPEED: f64 = 11.0;
pub const STEEL_SECRET_BREAK_SPEED: f64 = 5.5;
pub const STEEL_RAM_KNOCKBACK: f64 = 1.9;
pub const STEEL_FRICTION_MULT: f64 = 0.82;
pub const STEEL_STEER_MULT: f64 = 0.88;
pub const STEEL_WALL_BREAK_SPEED_COST: f64 = 0.82;
pub const STEEL_RAM_DAMAGE_MULT: f64 = 1.35;

pub const FLOOR_FX_MAX: usize = 300;
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

pub const MULTIBALL_COUNT: usize = 2;
pub const MULTIBALL_TRAIL_SECONDS: f64 = 1.2;
pub const MULTIBALL_LAGS: [f64; 2] = [0.22, 0.4];
pub const MULTIBALL_SIDE_OFFSET: f64 = 0.42;
pub const MULTIBALL_HEADING_STEP: f64 = 0.1;
pub const MULTIBALL_FOLLOW_RATE: f64 = 16.0;

// Bumper Tuning
pub const BUMPER_IMPULSE: f64 = 14.0;
pub const BUMPER_SCORE: i32 = 100;
pub const BUMPER_HITSTOP: f64 = 0.06;
pub const BUMPER_SHAKE: f64 = 0.12;

// Spring Tuning
pub const SPRING_IMPULSE: f64 = 18.0;
pub const SPRING_COOLDOWN: f64 = 0.35;

// Booster Tuning
pub const BOOSTER_SPEED: f64 = 19.5;
pub const BOOSTER_CHAIN_MULT: f64 = 1.06;

// Flipper Tuning
pub const FLIPPER_FORCE: f64 = 20.0;
pub const FLIPPER_HOLD_TIME: f64 = 0.25;

// Spinner Tuning
pub const SPINNER_ROT_INERTIA: f64 = 0.95;
pub const SPINNER_MIN_ROT: f64 = 0.1;

// Magnet Tuning
pub const MAGNET_PULL_FORCE: f64 = 12.0;
pub const MAGNET_RADIUS: f64 = 2.4;

// Slingshot Tuning
pub const SLINGSHOT_IMPULSE: f64 = 15.0;
pub const SLINGSHOT_COOLDOWN: f64 = 0.22;

pub const TARGETS_PER_FLOOR: usize = 3;
pub const TRAPDOORS_PER_FLOOR: f64 = 2.0;
pub const VAULT_RAMPS_PER_FLOOR: usize = 2;
pub const HAZARDS_BASE: f64 = 2.0;
pub const HAZARDS_PER_LEVEL: f64 = 0.5;
pub const HAZARDS_MAX: f64 = 10.0;
