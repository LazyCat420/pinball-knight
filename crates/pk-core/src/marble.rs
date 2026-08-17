//! MARBLE MATERIALS — the "what is the ball made of" axis.
//!
//! Port of `legacy/src/game/pinball-knight/entities/marble.ts` (1,006 lines).
//!
//! A material modifies the pinball ride's physics at the same choke points
//! that already branch on springT/turboT/oilT (restitution, friction, steer,
//! knockback, speed ceiling, wall breaking), plus triggers emitters on fast
//! wall bounces and slam impacts.
//!
//! PORTS: `fx/pools/trail-ribbon.ts`, `fx/elements/water.ts`, `fx/pools/laser-mark-field.ts`, `fx/elements/fire.ts`, `fx/elements/molten.ts`
//! PORTS-PARTIAL: `entities/marble.ts` - NOT a finished port - 12 of 45 exported names carried over (27%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md
//! PORTS-PARTIAL: `entities/floor-fx.ts` - NOT a finished port - 3 of 9 exported names carried over (33%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md
//! PORTS-PARTIAL: `fx/puffs.ts` - NOT a finished port - 0 of 4 exported names carried over (0%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md
//! PORTS-PARTIAL: `fx/floor/decals.ts` - NOT a finished port - 0 of 16 exported names carried over (0%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

pub mod decals;
pub mod fire_fx;
pub mod floor_fx;
pub mod laser_mark_field;
pub mod molten_fx;
pub mod puffs;
pub mod squash;
pub mod trail_ribbon;
pub mod water_fx;

pub use decals::*;
pub use fire_fx::*;
pub use floor_fx::*;
pub use laser_mark_field::*;
pub use molten_fx::*;
pub use puffs::*;
pub use squash::*;
pub use trail_ribbon::*;
pub use water_fx::*;
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum MarbleMaterial {
    Diamond,
    Water,
    Stone,
    Storm,
    Shadow,
    Lava,
}

impl MarbleMaterial {
    pub const ALL: [MarbleMaterial; 6] = [
        MarbleMaterial::Diamond,
        MarbleMaterial::Water,
        MarbleMaterial::Stone,
        MarbleMaterial::Storm,
        MarbleMaterial::Shadow,
        MarbleMaterial::Lava,
    ];

    pub fn as_str(&self) -> &'static str {
        match self {
            MarbleMaterial::Diamond => "diamond",
            MarbleMaterial::Water => "water",
            MarbleMaterial::Stone => "stone",
            MarbleMaterial::Storm => "storm",
            MarbleMaterial::Shadow => "shadow",
            MarbleMaterial::Lava => "lava",
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            MarbleMaterial::Diamond => "Diamond",
            MarbleMaterial::Water => "Water",
            MarbleMaterial::Stone => "Stone",
            MarbleMaterial::Storm => "Storm",
            MarbleMaterial::Shadow => "Shadow",
            MarbleMaterial::Lava => "Lava",
        }
    }

    pub fn icon(&self) -> &'static str {
        match self {
            MarbleMaterial::Diamond => "💎",
            MarbleMaterial::Water => "💧",
            MarbleMaterial::Stone => "🪨",
            MarbleMaterial::Storm => "⚡",
            MarbleMaterial::Shadow => "🌑",
            MarbleMaterial::Lava => "🔥",
        }
    }

    pub fn tint_hex(&self) -> u32 {
        match self {
            MarbleMaterial::Diamond => 0x6fd0e8,
            MarbleMaterial::Water => 0x3f9fd8,
            MarbleMaterial::Stone => 0x9aa4b4,
            MarbleMaterial::Storm => 0xf0e05a,
            MarbleMaterial::Shadow => 0x2a1e3a,
            MarbleMaterial::Lava => 0xf0a63c,
        }
    }

    pub fn trail_hex(&self) -> u32 {
        match self {
            MarbleMaterial::Diamond => 0xd8f6ff,
            MarbleMaterial::Water => 0x3f9fd8,
            MarbleMaterial::Stone => 0x9aa4b4,
            MarbleMaterial::Storm => 0xfff3a0,
            MarbleMaterial::Shadow => 0x140a1e,
            MarbleMaterial::Lava => 0xd97b29,
        }
    }

    pub fn duration_seconds(&self) -> f64 {
        match self {
            MarbleMaterial::Diamond => 8.0,
            MarbleMaterial::Water => 10.0,
            MarbleMaterial::Stone => 9.0,
            MarbleMaterial::Storm => 7.0,
            MarbleMaterial::Shadow => 8.5,
            MarbleMaterial::Lava => 8.0,
        }
    }
}

// ── Physics Constants for Materials (from constants/pinball.ts) ─────────────
pub const MATERIAL_FUSION_TIME: f64 = 1.8;
pub const MATERIAL_EMIT_SPEED: f64 = 10.0;
pub const MATERIAL_EMIT_COOLDOWN: f64 = 0.22;

pub const DIAMOND_RESTITUTION: f64 = 1.14;
pub const DIAMOND_WALL_BREAK_SPEED: f64 = 8.0;
pub const DIAMOND_SECRET_BREAK_SPEED: f64 = 4.0;
pub const DIAMOND_BOUNCE_SHARDS: i32 = 4;
pub const DIAMOND_BOUNCE_FAN: f64 = 0.55;
pub const DIAMOND_BOUNCE_DMG: f64 = 14.0;
pub const DIAMOND_SHARD_SPEED: f64 = 16.0;
pub const DIAMOND_SLAM_SHARDS: i32 = 8;
pub const DIAMOND_SLAM_SPEED: f64 = 18.0;
pub const DIAMOND_SLAM_DMG: f64 = 32.0;

pub const WATER_RESTITUTION: f64 = 0.82;
pub const WATER_FRICTION_MULT: f64 = 0.55;
pub const WATER_STEER_MULT: f64 = 0.45;
pub const WATER_RAM_KNOCKBACK: f64 = 0.7;
pub const WATER_SLICK_RADIUS: f64 = 0.85;
pub const WATER_SLICK_LIFE: f64 = 4.5;
pub const WATER_SLAM_SLICKS: i32 = 5;
pub const WATER_SLAM_SPEED_KICK: f64 = 18.0;

pub const STONE_RAM_KNOCKBACK: f64 = 2.2;
pub const STONE_RAM_DAMAGE_MULT: f64 = 1.85;
pub const STONE_WALL_BREAK_SPEED_COST: f64 = 0.8;
pub const STONE_WALL_BREAK_SPEED: f64 = 11.0;
pub const STONE_SECRET_BREAK_SPEED: f64 = 5.5;
pub const STONE_FRICTION_MULT: f64 = 1.35;
pub const STONE_MAX_SPEED: f64 = 16.0;
pub const STONE_BUMPER_KICK_MULT: f64 = 0.65;
pub const STONE_CORNER_ADD_MULT: f64 = 1.4;
pub const STONE_SHOCK_RADIUS: f64 = 2.2;
pub const STONE_SHOCK_DMG: f64 = 24.0;
pub const STONE_SHOCK_GOLEM_MULT: f64 = 2.0;
pub const STONE_SLAM_RADIUS: f64 = 3.2;
pub const STONE_SLAM_BASE_DMG: f64 = 45.0;
pub const STONE_SLAM_DMG_PER_SPEED: f64 = 2.2;

pub const STEEL_WALL_BREAK_SPEED: f64 = 10.0;
pub const STEEL_SECRET_BREAK_SPEED: f64 = 5.0;
pub const STEEL_RAM_KNOCKBACK: f64 = 1.8;
pub const STEEL_FRICTION_MULT: f64 = 0.75;
pub const STEEL_STEER_MULT: f64 = 0.70;
pub const STEEL_RAM_DAMAGE_MULT: f64 = 1.5;
pub const STEEL_WALL_BREAK_SPEED_COST: f64 = 1.2;

pub const STORM_LANE_PULL_MULT: f64 = 2.4;
pub const STORM_STEER_MULT: f64 = 1.45;
pub const STORM_BOUNCE_ARC_DMG: f64 = 18.0;
pub const STORM_BOUNCE_ARC_LEN: f64 = 3.6;
pub const STORM_BOUNCE_ARC_HALF: f64 = 0.45;
pub const STORM_CLAP_RADIUS: f64 = 2.8;
pub const STORM_CLAP_DMG: f64 = 38.0;
pub const STORM_CLAP_STUN: f64 = 1.2;
pub const STORM_WET_DMG: f64 = 1.6;

pub const SHADOW_PLAYER_R: f64 = 0.22;
pub const SHADOW_RESTITUTION: f64 = 0.75;
pub const SHADOW_BUMPER_SCATTER_MULT: f64 = 2.2;
pub const SHADOW_LURE_RADIUS: f64 = 3.5;
pub const SHADOW_LURE_TIME: f64 = 2.5;
pub const SHADOW_IMPLODE_RADIUS: f64 = 2.6;
pub const SHADOW_IMPLODE_PULL: f64 = 6.0;
pub const SHADOW_IMPLODE_DMG: f64 = 28.0;

pub const LAVA_BUMPER_MULT: f64 = 1.65;
pub const LAVA_SLAM_GLOBS: i32 = 6;
pub const LAVA_SLAM_FIRE_RADIUS: f64 = 2.4;
pub const LAVA_SLAM_FIRE_LIFE: f64 = 5.0;
pub const FIRE_PUDDLE_RADIUS: f64 = 0.75;
pub const FIRE_PUDDLE_LIFE: f64 = 4.0;

pub const SECRET_BREAK_SPEED: f64 = 6.0;
pub const WALL_BREAK_SPEED: f64 = 12.0;
pub const WALL_BREAK_SPEED_COST: f64 = 2.5;
pub const BALL_RAM_KNOCKBACK: f64 = 1.0;
pub const PINBALL_MAX_SPEED: f64 = 22.0;

/// State for active player marble material and fusion.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct MarbleState {
    pub current: Option<MarbleMaterial>,
    pub time_remaining: f64,
    pub fuse_material: Option<MarbleMaterial>,
    pub fuse_time: f64,
    pub emit_cooldown: f64,
    pub iron_time: f64, // Ball Form potion
}

impl MarbleState {
    pub fn is_steel_ball(&self) -> bool {
        self.iron_time > 0.0
    }

    pub fn active_material(&self) -> Option<MarbleMaterial> {
        if self.time_remaining > 0.0 {
            self.current
        } else {
            None
        }
    }

    pub fn apply_material(&mut self, mat: MarbleMaterial) {
        if let Some(prev) = self.current {
            if prev != mat && self.time_remaining > 0.0 {
                self.fuse_material = Some(prev);
                self.fuse_time = MATERIAL_FUSION_TIME;
            }
        }
        self.current = Some(mat);
        self.time_remaining = mat.duration_seconds();
    }

    pub fn update(&mut self, dt: f64) {
        if self.emit_cooldown > 0.0 {
            self.emit_cooldown = (self.emit_cooldown - dt).max(0.0);
        }
        if self.fuse_time > 0.0 {
            self.fuse_time = (self.fuse_time - dt).max(0.0);
            if self.fuse_time == 0.0 {
                self.fuse_material = None;
            }
        }
        if self.time_remaining > 0.0 {
            self.time_remaining = (self.time_remaining - dt).max(0.0);
            if self.time_remaining == 0.0 {
                self.current = None;
            }
        }
        if self.iron_time > 0.0 {
            self.iron_time = (self.iron_time - dt).max(0.0);
        }
    }

    /// Flat / slant wall restitution override.
    pub fn flat_restitution(&self) -> Option<f64> {
        match self.active_material() {
            Some(MarbleMaterial::Diamond) => Some(DIAMOND_RESTITUTION),
            Some(MarbleMaterial::Water) => Some(WATER_RESTITUTION),
            Some(MarbleMaterial::Shadow) => Some(SHADOW_RESTITUTION),
            _ => None,
        }
    }

    /// Collision radius override (shadow marble is narrow).
    pub fn player_radius(&self, base_r: f64) -> f64 {
        if self.active_material() == Some(MarbleMaterial::Shadow) {
            SHADOW_PLAYER_R
        } else {
            base_r
        }
    }

    /// Multiplier on bumper exit scatter.
    pub fn bumper_scatter_mult(&self) -> f64 {
        if self.active_material() == Some(MarbleMaterial::Shadow) {
            SHADOW_BUMPER_SCATTER_MULT
        } else {
            1.0
        }
    }

    /// Break speeds for secret doors and normal walls: `(secret_speed, wall_speed)`.
    pub fn break_speeds(&self) -> (f64, f64) {
        match self.active_material() {
            Some(MarbleMaterial::Diamond) => (DIAMOND_SECRET_BREAK_SPEED, DIAMOND_WALL_BREAK_SPEED),
            Some(MarbleMaterial::Stone) => (STONE_SECRET_BREAK_SPEED, STONE_WALL_BREAK_SPEED),
            _ => {
                if self.is_steel_ball() {
                    (STEEL_SECRET_BREAK_SPEED, STEEL_WALL_BREAK_SPEED)
                } else {
                    (SECRET_BREAK_SPEED, WALL_BREAK_SPEED)
                }
            }
        }
    }

    /// Multiplier on friction (water glides, stone drags).
    pub fn friction_mult(&self) -> f64 {
        match self.active_material() {
            Some(MarbleMaterial::Water) => WATER_FRICTION_MULT,
            Some(MarbleMaterial::Stone) => STONE_FRICTION_MULT,
            _ => {
                if self.is_steel_ball() {
                    STEEL_FRICTION_MULT
                } else {
                    1.0
                }
            }
        }
    }

    /// Steering grip multiplier (water slides, storm grips sharply).
    pub fn steer_mult(&self) -> f64 {
        match self.active_material() {
            Some(MarbleMaterial::Water) => WATER_STEER_MULT,
            Some(MarbleMaterial::Storm) => STORM_STEER_MULT,
            _ => {
                if self.is_steel_ball() {
                    STEEL_STEER_MULT
                } else {
                    1.0
                }
            }
        }
    }

    /// Lane centering pull multiplier (storm draws toward lane axis).
    pub fn lane_pull_mult(&self) -> f64 {
        if self.active_material() == Some(MarbleMaterial::Storm) {
            STORM_LANE_PULL_MULT
        } else {
            1.0
        }
    }

    /// Ram knockback factor.
    pub fn ram_knockback(&self) -> f64 {
        match self.active_material() {
            Some(MarbleMaterial::Stone) => STONE_RAM_KNOCKBACK,
            Some(MarbleMaterial::Water) => WATER_RAM_KNOCKBACK,
            _ => {
                if self.is_steel_ball() {
                    STEEL_RAM_KNOCKBACK
                } else {
                    BALL_RAM_KNOCKBACK
                }
            }
        }
    }

    /// Ram damage multiplier.
    pub fn ram_damage_mult(&self) -> f64 {
        match self.active_material() {
            Some(MarbleMaterial::Stone) => STONE_RAM_DAMAGE_MULT,
            _ => {
                if self.is_steel_ball() {
                    STEEL_RAM_DAMAGE_MULT
                } else {
                    1.0
                }
            }
        }
    }

    /// Speed cost paid when breaking through masonry.
    pub fn wall_break_speed_cost(&self) -> f64 {
        match self.active_material() {
            Some(MarbleMaterial::Stone) => STONE_WALL_BREAK_SPEED_COST,
            _ => {
                if self.is_steel_ball() {
                    STEEL_WALL_BREAK_SPEED_COST
                } else {
                    WALL_BREAK_SPEED_COST
                }
            }
        }
    }

    /// Corner hit acceleration multiplier.
    pub fn corner_add_mult(&self) -> f64 {
        if self.active_material() == Some(MarbleMaterial::Stone) {
            STONE_CORNER_ADD_MULT
        } else {
            1.0
        }
    }

    /// Bumper kick force multiplier.
    pub fn bumper_kick_mult(&self) -> f64 {
        match self.active_material() {
            Some(MarbleMaterial::Stone) => STONE_BUMPER_KICK_MULT,
            Some(MarbleMaterial::Lava) => LAVA_BUMPER_MULT,
            _ => 1.0,
        }
    }

    /// Maximum velocity ceiling.
    pub fn max_speed(&self) -> f64 {
        if self.active_material() == Some(MarbleMaterial::Stone) {
            STONE_MAX_SPEED
        } else {
            PINBALL_MAX_SPEED
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marble_material_physics_properties_match_oracle() {
        let mut m = MarbleState::default();

        // Default
        assert_eq!(m.friction_mult(), 1.0);
        assert_eq!(m.steer_mult(), 1.0);
        assert_eq!(m.flat_restitution(), None);

        // Diamond
        m.apply_material(MarbleMaterial::Diamond);
        assert_eq!(m.flat_restitution(), Some(DIAMOND_RESTITUTION));
        assert_eq!(m.break_speeds(), (DIAMOND_SECRET_BREAK_SPEED, DIAMOND_WALL_BREAK_SPEED));

        // Water
        m.apply_material(MarbleMaterial::Water);
        assert_eq!(m.friction_mult(), WATER_FRICTION_MULT);
        assert_eq!(m.steer_mult(), WATER_STEER_MULT);
        assert_eq!(m.fuse_material, Some(MarbleMaterial::Diamond));

        // Stone
        m.apply_material(MarbleMaterial::Stone);
        assert_eq!(m.friction_mult(), STONE_FRICTION_MULT);
        assert_eq!(m.max_speed(), STONE_MAX_SPEED);
        assert_eq!(m.ram_damage_mult(), STONE_RAM_DAMAGE_MULT);

        // Storm
        m.apply_material(MarbleMaterial::Storm);
        assert_eq!(m.steer_mult(), STORM_STEER_MULT);
        assert_eq!(m.lane_pull_mult(), STORM_LANE_PULL_MULT);

        // Shadow
        m.apply_material(MarbleMaterial::Shadow);
        assert_eq!(m.player_radius(0.35), SHADOW_PLAYER_R);
        assert_eq!(m.bumper_scatter_mult(), SHADOW_BUMPER_SCATTER_MULT);
    }
}
