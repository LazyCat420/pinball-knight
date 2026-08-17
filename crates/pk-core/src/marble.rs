//! MARBLE MATERIALS — the "what is the ball made of" axis.
//!
//! Port of `legacy/src/game/pinball-knight/entities/marble.ts` (1,006 lines).
//!
//! A material modifies the pinball ride's physics at the same choke points
//! that already branch on springT/turboT/oilT (restitution, friction, steer,
//! knockback, speed ceiling, wall breaking), plus triggers emitters on fast
//! wall bounces and slam impacts.
//!
//! PORTS: `entities/marble.ts`

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

use crate::collide::{move_circle, MoveResult};
use crate::grid::{is_walkable, tile_center, world_to_tile, Grid};
use crate::state::{Player, SimState, PLAYER_R};

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

pub struct MaterialMeta {
    pub label: &'static str,
    pub icon: &'static str,
    pub tint: u32,
    pub trail: u32,
}

pub fn get_material_meta(mat: MarbleMaterial) -> MaterialMeta {
    MaterialMeta {
        label: mat.label(),
        icon: mat.icon(),
        tint: mat.tint_hex(),
        trail: mat.trail_hex(),
    }
}

pub const MATERIAL_LIST: [MarbleMaterial; 6] = MarbleMaterial::ALL;

pub fn is_material(id: &str) -> bool {
    matches!(
        id,
        "diamond" | "water" | "stone" | "storm" | "shadow" | "lava"
    )
}

// ── Physics Constants for Materials ─────────────────────────────────────────
pub const MATERIAL_DURATION_DIAMOND: f64 = 8.0;
pub const MATERIAL_DURATION_WATER: f64 = 10.0;
pub const MATERIAL_DURATION_STONE: f64 = 9.0;
pub const MATERIAL_DURATION_STORM: f64 = 7.0;
pub const MATERIAL_DURATION_SHADOW: f64 = 8.5;
pub const MATERIAL_DURATION_LAVA: f64 = 8.0;

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
pub const BALL_RAM_COOLDOWN: f64 = 0.35;
pub const PINBALL_MAX_SPEED: f64 = 22.0;

pub const WATER_SQUASH: f64 = 0.55;
pub const LAVA_SQUASH: f64 = 0.25;
pub const SQUASH_RECOVER: f64 = 0.18;
pub const SQUASH_DEPTH: f64 = 0.42;
pub const SQUASH_MIN_SPEED: f64 = 6.0;

pub const DIAMOND_CUT_SPEED: f64 = 14.0;
pub const DIAMOND_CUT_DMG_MULT: f64 = 1.8;
pub const DIAMOND_CUT_COOLDOWN: f64 = 0.05;
pub const DIAMOND_CUT_KNOCKBACK: f64 = 0.0;

pub const SHADOW_SLAYER_MULT: f64 = 2.5;
pub const SHADOW_LIFESTEAL: f64 = 15.0;
pub const SHADOW_LIFESTEAL_CD: f64 = 0.8;
pub const SHADOW_PHASE_GRACE: f64 = 0.12;

pub const WATER_STEAM_LAUNCH: f64 = 16.0;
pub const WATER_STEAM_RADIUS: f64 = 2.4;
pub const WATER_STEAM_DMG: f64 = 25.0;
pub const STONE_MAGSTRIP_CAP: f64 = 12.0;
pub const DIAMOND_DISCHARGE_RADIUS: f64 = 2.5;
pub const DIAMOND_DISCHARGE_DMG: f64 = 30.0;

/// State for active player marble material and fusion.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct MarbleState {
    pub current: Option<MarbleMaterial>,
    pub time_remaining: f64,
    pub fuse_material: Option<MarbleMaterial>,
    pub fuse_time: f64,
    pub emit_cooldown: f64,
    pub iron_time: f64, // Ball Form potion
    pub vamp_cd: f64,
    pub phase_stuck_t: f64,
    pub enabled: bool,
    pub terrain_reactions: bool,
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
        if self.vamp_cd > 0.0 {
            self.vamp_cd = (self.vamp_cd - dt).max(0.0);
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

    pub fn cuts_through(&self, speed: f64) -> bool {
        self.active_material() == Some(MarbleMaterial::Diamond) && speed >= DIAMOND_CUT_SPEED
    }

    pub fn phases_walls(&self) -> bool {
        self.active_material() == Some(MarbleMaterial::Shadow)
    }

    pub fn resists_drain(&self) -> bool {
        self.active_material() == Some(MarbleMaterial::Diamond)
    }

    pub fn squash(&self) -> f64 {
        match self.active_material() {
            Some(MarbleMaterial::Water) => WATER_SQUASH,
            Some(MarbleMaterial::Lava) => LAVA_SQUASH,
            _ => 0.0,
        }
    }
}

// ── Oracle Carryover Top-Level Functions ────────────────────────────────────

pub fn active_material(player: &Player) -> Option<MarbleMaterial> {
    player.marble.active_material()
}

pub fn apply_material(player: &mut Player, id: MarbleMaterial) {
    player.marble.apply_material(id);
}

pub fn update_material(player: &mut Player, dt: f64) {
    player.marble.update(dt);
}

pub fn material_flat_restitution(player: &Player) -> Option<f64> {
    player.marble.flat_restitution()
}

pub fn material_player_r(player: &Player) -> f64 {
    player.marble.player_radius(PLAYER_R)
}

pub fn material_bumper_scatter_mult(player: &Player) -> f64 {
    player.marble.bumper_scatter_mult()
}

pub fn material_break_speeds(player: &Player) -> (f64, f64) {
    player.marble.break_speeds()
}

pub fn material_friction_mult(player: &Player) -> f64 {
    player.marble.friction_mult()
}

pub fn material_steer_mult(player: &Player) -> f64 {
    player.marble.steer_mult()
}

pub fn material_lane_pull(player: &Player) -> f64 {
    player.marble.lane_pull_mult()
}

pub fn material_ram_knockback(player: &Player) -> f64 {
    player.marble.ram_knockback()
}

pub fn material_ram_damage_mult(player: &Player) -> f64 {
    player.marble.ram_damage_mult()
}

pub fn material_wall_break_cost(player: &Player) -> f64 {
    player.marble.wall_break_speed_cost()
}

pub fn material_corner_add_mult(player: &Player) -> f64 {
    player.marble.corner_add_mult()
}

pub fn material_bumper_mult(player: &Player) -> f64 {
    player.marble.bumper_kick_mult()
}

pub fn material_max_speed(player: &Player) -> f64 {
    player.marble.max_speed()
}

pub fn material_clip(player: &Player) -> Option<&'static str> {
    player.marble.active_material().map(|m| match m {
        MarbleMaterial::Diamond => "diamondball",
        MarbleMaterial::Water => "waterball",
        MarbleMaterial::Stone => "stoneball",
        MarbleMaterial::Storm => "stormball",
        MarbleMaterial::Shadow => "shadowball",
        MarbleMaterial::Lava => "lavaball",
    })
}

pub fn material_squash(player: &Player) -> f64 {
    player.marble.squash()
}

pub fn note_squash(player: &mut Player, nx: f64, nz: f64, speed: f64) {
    let amp = material_squash(player);
    if amp <= 0.0 || speed < SQUASH_MIN_SPEED {
        return;
    }
    let len = (nx * nx + nz * nz).sqrt();
    let len = if len == 0.0 { 1.0 } else { len };
    player.squash_nx = nx / len;
    player.squash_nz = nz / len;
    player.squash_amp = amp * (speed / (SQUASH_MIN_SPEED * 2.0)).min(1.0);
    player.squash_t = SQUASH_RECOVER;
}

pub fn squash_scale(player: &Player) -> (f64, f64) {
    if player.squash_t <= 0.0 {
        return (1.0, 1.0);
    }
    let t = player.squash_t / SQUASH_RECOVER;
    let d = SQUASH_DEPTH * player.squash_amp * (t * std::f64::consts::PI * 0.5).sin();
    let flat = 1.0 - d;
    let bulge = if flat > 0.0 { 1.0 / flat } else { 1.0 };
    if player.squash_nx.abs() >= player.squash_nz.abs() {
        (flat, bulge)
    } else {
        (bulge, flat)
    }
}

pub fn update_squash(player: &mut Player, dt: f64) {
    if player.squash_t > 0.0 {
        player.squash_t = (player.squash_t - dt).max(0.0);
    }
}

pub fn material_cuts_through(player: &Player) -> bool {
    player.marble.cuts_through(player.mom_speed)
}

pub fn material_ram_cut_mult(player: &Player) -> f64 {
    if material_cuts_through(player) {
        DIAMOND_CUT_DMG_MULT
    } else {
        1.0
    }
}

pub fn material_contact_knockback(player: &Player) -> f64 {
    if material_cuts_through(player) {
        DIAMOND_CUT_KNOCKBACK
    } else {
        material_ram_knockback(player)
    }
}

pub fn material_ram_cooldown(player: &Player) -> f64 {
    if material_cuts_through(player) {
        DIAMOND_CUT_COOLDOWN
    } else {
        BALL_RAM_COOLDOWN
    }
}

pub fn material_resists_drain(player: &Player) -> bool {
    player.marble.resists_drain()
}

pub fn shadow_slayer_mult(player: &Player, kind: &str) -> f64 {
    if player.marble.active_material() == Some(MarbleMaterial::Shadow)
        && (kind == "ghost" || kind == "reaper" || kind == "wisp")
    {
        SHADOW_SLAYER_MULT
    } else {
        1.0
    }
}

pub fn shadow_vampire(player: &mut Player) {
    if player.marble.active_material() != Some(MarbleMaterial::Shadow) {
        return;
    }
    if player.marble.vamp_cd > 0.0 {
        return;
    }
    player.marble.vamp_cd = SHADOW_LIFESTEAL_CD;
}

pub fn update_vampire(player: &mut Player, dt: f64) {
    if player.marble.vamp_cd > 0.0 {
        player.marble.vamp_cd = (player.marble.vamp_cd - dt).max(0.0);
    }
}

pub fn lava_melt_if_active(player: &Player) -> bool {
    player.marble.active_material() == Some(MarbleMaterial::Lava)
}

pub fn material_phases_walls(player: &Player) -> bool {
    player.marble.phases_walls()
}

pub fn phase_move(
    grid: &Grid,
    x: f64,
    z: f64,
    r: f64,
    dx: f64,
    dz: f64,
    phases: bool,
) -> MoveResult {
    if !phases {
        return move_circle(grid, x, z, r, dx, dz);
    }
    let lim_x = (grid.w as f64) * 0.5 - 1.0 - r;
    let lim_z = (grid.h as f64) * 0.5 - 1.0 - r;
    MoveResult {
        x: (x + dx).clamp(-lim_x, lim_x),
        z: (z + dz).clamp(-lim_z, lim_z),
        hit_n: None,
        hit_kick: None,
        hit_lane: None,
        hit_surface: 0,
    }
}

pub fn update_phase_eject(grid: &Grid, player: &mut Player, dt: f64) {
    if material_phases_walls(player) {
        player.marble.phase_stuck_t = 0.0;
        return;
    }
    let (ti, tj) = world_to_tile(grid, player.x, player.z);
    if is_walkable(grid, ti, tj) {
        player.marble.phase_stuck_t = 0.0;
        return;
    }
    player.marble.phase_stuck_t += dt;
    if player.marble.phase_stuck_t < SHADOW_PHASE_GRACE {
        return;
    }
    player.marble.phase_stuck_t = 0.0;

    for rad in 1i32..=8i32 {
        let mut best: Option<(f64, f64, f64)> = None;
        for di in -rad..=rad {
            for dj in -rad..=rad {
                if di.abs().max(dj.abs()) != rad {
                    continue;
                }
                if !is_walkable(grid, ti + di, tj + dj) {
                    continue;
                }
                let (cx, cz) = tile_center(grid, ti + di, tj + dj);
                let d = (cx - player.x).powi(2) + (cz - player.z).powi(2);
                if best.map_or(true, |(_, _, bd)| d < bd) {
                    best = Some((cx, cz, d));
                }
            }
        }
        if let Some((bx, bz, _)) = best {
            player.x = bx;
            player.z = bz;
            return;
        }
    }
}

pub fn emit_material_on_bounce(state: &mut SimState, _nx: f64, _nz: f64) {
    if state.player.mom_speed < MATERIAL_EMIT_SPEED || state.player.marble.emit_cooldown > 0.0 {
        return;
    }
    if state.player.marble.active_material().is_none() {
        return;
    }
    state.player.marble.emit_cooldown = MATERIAL_EMIT_COOLDOWN;
}

pub fn material_slam(state: &mut SimState) {
    if let Some(mat) = state.player.marble.active_material() {
        match mat {
            MarbleMaterial::Water => {
                state.player.mom_speed =
                    material_max_speed(&state.player).min(state.player.mom_speed + WATER_SLAM_SPEED_KICK);
            }
            MarbleMaterial::Stone => {
                state.player.mom_speed *= 0.3;
            }
            _ => {}
        }
    }
}

pub fn try_water_steam(player: &mut Player) -> bool {
    if player.marble.active_material() == Some(MarbleMaterial::Water) {
        player.mom_speed = player.mom_speed.max(WATER_STEAM_LAUNCH);
        true
    } else {
        false
    }
}

pub fn stone_magstrip_cap(player: &Player) -> Option<f64> {
    if player.marble.active_material() == Some(MarbleMaterial::Stone) {
        Some(STONE_MAGSTRIP_CAP)
    } else {
        None
    }
}

pub fn stone_ignores_oil(player: &Player) -> bool {
    player.marble.active_material() == Some(MarbleMaterial::Stone)
}

pub fn lava_vaporizes_oil(player: &Player, _x: f64, _z: f64) -> bool {
    player.marble.active_material() == Some(MarbleMaterial::Lava)
}

pub fn stone_bridges_pit(player: &Player) -> bool {
    player.marble.active_material() == Some(MarbleMaterial::Stone) && player.mom_speed > 0.0
}

pub fn water_quenches_fire(player: &Player, _x: f64, _z: f64) -> bool {
    player.marble.active_material() == Some(MarbleMaterial::Water)
}

pub fn try_diamond_discharge(player: &Player, _x: f64, _z: f64) -> bool {
    player.marble.active_material() == Some(MarbleMaterial::Diamond)
}
