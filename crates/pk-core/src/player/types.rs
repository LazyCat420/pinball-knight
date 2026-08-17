//! Player state, verbs, and movement physics data structures.
//!
//! PORTS: `entities/movement.ts`
//! PORTS-PARTIAL: `state.ts` - NOT a finished port - no measurable port behind the claim. Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md
//! PORTS-PARTIAL: `entities/combat.ts` - NOT a finished port - 0 of 22 exported names carried over (0%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md
//! PORTS-PARTIAL: `constants/player.ts` - NOT a finished port - 5 rust code lines against 77 legacy (6%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

pub const PLAYER_RADIUS: f64 = 0.28;
pub const PLAYER_WALK_SPEED: f64 = 4.2;
pub const PLAYER_SPRINT_MULT: f64 = 1.45;
pub const DASH_SPEED: f64 = 11.5;
pub const DASH_DURATION: f64 = 0.22;
pub const DASH_COOLDOWN: f64 = 0.85;
pub const DASH_IFRAMES: f64 = 0.25;

pub const MELEE_SWING_ARC: f64 = std::f64::consts::FRAC_PI_2 * 1.2; // ~108 degrees
pub const MELEE_REACH_BASE: f64 = 1.15;
pub const MELEE_COOLDOWN_BASE: f64 = 0.32;
pub const MELEE_DAMAGE_BASE: f64 = 12.0;

pub const PLUNGER_MAX_TENSION: f64 = 1.0;
pub const PLUNGER_PULL_RATE: f64 = 1.5;
pub const PLUNGER_MAX_LAUNCH_SPEED: f64 = 18.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlayerFacing {
    South,
    North,
    East,
    West,
    SouthEast,
    SouthWest,
    NorthEast,
    NorthWest,
}

impl PlayerFacing {
    pub fn to_vector(self) -> (f64, f64) {
        match self {
            Self::South => (0.0, 1.0),
            Self::North => (0.0, -1.0),
            Self::East => (1.0, 0.0),
            Self::West => (-1.0, 0.0),
            Self::SouthEast => (std::f64::consts::FRAC_1_SQRT_2, std::f64::consts::FRAC_1_SQRT_2),
            Self::SouthWest => (-std::f64::consts::FRAC_1_SQRT_2, std::f64::consts::FRAC_1_SQRT_2),
            Self::NorthEast => (std::f64::consts::FRAC_1_SQRT_2, -std::f64::consts::FRAC_1_SQRT_2),
            Self::NorthWest => (-std::f64::consts::FRAC_1_SQRT_2, -std::f64::consts::FRAC_1_SQRT_2),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct MeleeSlash {
    pub active: bool,
    pub timer: f64,
    pub cooldown: f64,
    pub reach: f64,
    pub base_damage: f64,
    pub dir_x: f64,
    pub dir_z: f64,
    pub hit_entities: Vec<u32>,
}

impl Default for MeleeSlash {
    fn default() -> Self {
        Self {
            active: false,
            timer: 0.0,
            cooldown: 0.0,
            reach: MELEE_REACH_BASE,
            base_damage: MELEE_DAMAGE_BASE,
            dir_x: 0.0,
            dir_z: 1.0,
            hit_entities: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct DashState {
    pub active: bool,
    pub timer: f64,
    pub cooldown: f64,
    pub dir_x: f64,
    pub dir_z: f64,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct PlungerState {
    pub pulling: bool,
    pub tension: f64,
    pub launched: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlayerCoreState {
    pub x: f64,
    pub z: f64,
    pub vx: f64,
    pub vz: f64,
    pub hp: i32,
    pub max_hp: i32,
    pub mana: f64,
    pub max_mana: f64,
    pub iframes: f64,
    pub facing: PlayerFacing,
    pub mom_speed: f64,
    pub pinball_mode: bool,
    pub slash: MeleeSlash,
    pub dash: DashState,
    pub plunger: PlungerState,
    pub inventory: super::inventory::PlayerInventory,
}

impl Default for PlayerCoreState {
    fn default() -> Self {
        Self {
            x: 0.0,
            z: 0.0,
            vx: 0.0,
            vz: 0.0,
            hp: 100,
            max_hp: 100,
            mana: 50.0,
            max_mana: 100.0,
            iframes: 0.0,
            facing: PlayerFacing::South,
            mom_speed: 0.0,
            pinball_mode: false,
            slash: MeleeSlash::default(),
            dash: DashState::default(),
            plunger: PlungerState::default(),
            inventory: super::inventory::PlayerInventory::default(),
        }
    }
}
