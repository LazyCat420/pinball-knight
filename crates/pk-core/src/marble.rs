//! MARBLE MATERIALS — the "what is the ball made of" axis.
//!
//! Port of `legacy/src/game/pinball-knight/entities/marble.ts` (1,005 lines).
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

use crate::collide::move_circle;
use crate::combat::damage_zombie;
use crate::combat::DamageSource;
use crate::grid::{is_walkable, tile_center, world_to_tile, Grid};
use crate::monsters::types::{EnemyKind, EnemyMode, LiveMonster};

// Material Tuning Constants
pub const MATERIAL_DURATION_DEFAULT: f64 = 8.0;
pub const MATERIAL_FUSION_TIME: f64 = 2.5;
pub const MATERIAL_EMIT_SPEED: f64 = 10.0;
pub const MATERIAL_EMIT_COOLDOWN: f64 = 0.35;

pub const DIAMOND_RESTITUTION: f64 = 0.98;
pub const DIAMOND_WALL_BREAK_SPEED: f64 = 4.0;
pub const DIAMOND_SECRET_BREAK_SPEED: f64 = 8.0;
pub const DIAMOND_BOUNCE_SHARDS: usize = 6;
pub const DIAMOND_BOUNCE_FAN: f64 = 0.8;
pub const DIAMOND_BOUNCE_DMG: i32 = 1;
pub const DIAMOND_SHARD_SPEED: f64 = 12.0;
pub const DIAMOND_SLAM_SHARDS: usize = 12;
pub const DIAMOND_SLAM_SPEED: f64 = 14.0;
pub const DIAMOND_SLAM_DMG: i32 = 2;
pub const DIAMOND_CUT_SPEED: f64 = 14.0;
pub const DIAMOND_CUT_DMG_MULT: f64 = 1.4;
pub const DIAMOND_CUT_KNOCKBACK: f64 = 0.2;
pub const DIAMOND_CUT_COOLDOWN: f64 = 0.08;
pub const DIAMOND_DISCHARGE_RADIUS: f64 = 3.2;
pub const DIAMOND_DISCHARGE_DMG: i32 = 2;

pub const WATER_RESTITUTION: f64 = 0.75;
pub const WATER_FRICTION_MULT: f64 = 0.45;
pub const WATER_STEER_MULT: f64 = 0.55;
pub const WATER_RAM_KNOCKBACK: f64 = 0.4;
pub const WATER_SLICK_RADIUS: f64 = 1.2;
pub const WATER_SLICK_LIFE: f64 = 3.5;
pub const WATER_SLAM_SLICKS: usize = 6;
pub const WATER_SLAM_SPEED_KICK: f64 = 4.0;
pub const WATER_STEAM_LAUNCH: f64 = 16.0;
pub const WATER_STEAM_RADIUS: f64 = 2.4;
pub const WATER_STEAM_DMG: i32 = 3;
pub const WATER_SQUASH: f64 = 0.5;

pub const STONE_RESTITUTION: f64 = 0.6;
pub const STONE_RAM_KNOCKBACK: f64 = 2.8;
pub const STONE_RAM_DAMAGE_MULT: f64 = 1.75;
pub const STONE_WALL_BREAK_SPEED_COST: f64 = 1.5;
pub const STONE_WALL_BREAK_SPEED: f64 = 5.5;
pub const STONE_SECRET_BREAK_SPEED: f64 = 11.0;
pub const STONE_FRICTION_MULT: f64 = 1.8;
pub const STONE_MAX_SPEED: f64 = 17.0;
pub const STONE_BUMPER_KICK_MULT: f64 = 0.4;
pub const STONE_CORNER_ADD_MULT: f64 = 1.35;
pub const STONE_SHOCK_RADIUS: f64 = 2.6;
pub const STONE_SHOCK_DMG: f64 = 2.0;
pub const STONE_SHOCK_GOLEM_MULT: f64 = 2.5;
pub const STONE_SLAM_RADIUS: f64 = 3.0;
pub const STONE_SLAM_BASE_DMG: f64 = 2.0;
pub const STONE_SLAM_DMG_PER_SPEED: f64 = 0.3;
pub const STONE_MAGSTRIP_CAP: f64 = 8.0;

pub const STEEL_WALL_BREAK_SPEED: f64 = 4.5;
pub const STEEL_SECRET_BREAK_SPEED: f64 = 9.0;
pub const STEEL_RAM_KNOCKBACK: f64 = 1.8;
pub const STEEL_FRICTION_MULT: f64 = 0.7;
pub const STEEL_STEER_MULT: f64 = 0.85;
pub const STEEL_RAM_DAMAGE_MULT: f64 = 1.4;
pub const STEEL_WALL_BREAK_SPEED_COST: f64 = 1.0;
pub const WALL_BREAK_SPEED_COST: f64 = 2.5;
pub const SECRET_BREAK_SPEED: f64 = 10.0;
pub const WALL_BREAK_SPEED: f64 = 5.0;
pub const PINBALL_MAX_SPEED: f64 = 22.0;
pub const BALL_RAM_KNOCKBACK: f64 = 1.0;
pub const BALL_RAM_COOLDOWN: f64 = 0.4;

pub const STORM_LANE_PULL_MULT: f64 = 1.8;
pub const STORM_STEER_MULT: f64 = 1.45;
pub const STORM_BOUNCE_ARC_DMG: f64 = 2.0;
pub const STORM_BOUNCE_ARC_LEN: f64 = 5.5;
pub const STORM_BOUNCE_ARC_HALF: f64 = 0.6;
pub const STORM_CLAP_RADIUS: f64 = 3.5;
pub const STORM_CLAP_DMG: f64 = 2.0;
pub const STORM_CLAP_STUN: f64 = 1.5;
pub const STORM_WET_DMG: f64 = 3.0;

pub const SHADOW_PLAYER_R: f64 = 0.22;
pub const SHADOW_RESTITUTION: f64 = 0.7;
pub const SHADOW_BUMPER_SCATTER_MULT: f64 = 1.6;
pub const SHADOW_LURE_RADIUS: f64 = 6.0;
pub const SHADOW_LURE_TIME: f64 = 3.0;
pub const SHADOW_IMPLODE_RADIUS: f64 = 4.5;
pub const SHADOW_IMPLODE_PULL: f64 = 0.75;
pub const SHADOW_IMPLODE_DMG: f64 = 2.0;
pub const SHADOW_SLAYER_MULT: f64 = 2.5;
pub const SHADOW_LIFESTEAL: i32 = 1;
pub const SHADOW_LIFESTEAL_CD: f64 = 1.2;
pub const SHADOW_PHASE_GRACE: f64 = 0.12;

pub const LAVA_BUMPER_MULT: f64 = 1.5;
pub const LAVA_SLAM_GLOBS: usize = 6;
pub const LAVA_SLAM_FIRE_RADIUS: f64 = 1.6;
pub const LAVA_SLAM_FIRE_LIFE: f64 = 4.0;
pub const FIRE_PUDDLE_RADIUS: f64 = 1.2;
pub const FIRE_PUDDLE_LIFE: f64 = 3.0;
pub const LAVA_SQUASH: f64 = 0.25;
pub const SQUASH_MIN_SPEED: f64 = 4.0;
pub const SQUASH_RECOVER: f64 = 0.22;
pub const SQUASH_DEPTH: f64 = 0.42;
pub const PLAYER_R: f64 = 0.28;
pub const ZOMBIE_R: f64 = 0.3;

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

pub const MATERIAL_LIST: [MarbleMaterial; 6] = MarbleMaterial::ALL;

#[derive(Debug, Clone, PartialEq)]
pub struct MaterialMeta {
    pub label: &'static str,
    pub icon: &'static str,
    pub tint: u32,
    pub trail: u32,
}

pub const fn material_meta(m: MarbleMaterial) -> MaterialMeta {
    match m {
        MarbleMaterial::Diamond => MaterialMeta { label: "Diamond", icon: "💎", tint: 0x6fd0e8, trail: 0xd8f6ff },
        MarbleMaterial::Water => MaterialMeta { label: "Water", icon: "💧", tint: 0x3f9fd8, trail: 0x3f9fd8 },
        MarbleMaterial::Stone => MaterialMeta { label: "Stone", icon: "🪨", tint: 0x9aa4b4, trail: 0x9aa4b4 },
        MarbleMaterial::Storm => MaterialMeta { label: "Storm", icon: "⚡", tint: 0xf0e05a, trail: 0xfff3a0 },
        MarbleMaterial::Shadow => MaterialMeta { label: "Shadow", icon: "🌑", tint: 0x2a1e3a, trail: 0x140a1e },
        MarbleMaterial::Lava => MaterialMeta { label: "Lava", icon: "🔥", tint: 0xf0a63c, trail: 0xd97b29 },
    }
}

pub fn is_material(id: &str) -> bool {
    matches!(id, "diamond" | "water" | "stone" | "storm" | "shadow" | "lava")
}

/// State for active player marble material and fusion.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct MarbleState {
    pub current: Option<MarbleMaterial>,
    pub time_remaining: f64,
    pub fuse_material: Option<MarbleMaterial>,
    pub fuse_time: f64,
    pub emit_cooldown: f64,
    pub iron_time: f64,
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

    pub fn flat_restitution(&self) -> Option<f64> {
        material_flat_restitution(self.active_material())
    }

    pub fn player_radius(&self, base_r: f64) -> f64 {
        material_player_r(self.active_material(), base_r)
    }

    pub fn bumper_scatter_mult(&self) -> f64 {
        material_bumper_scatter_mult(self.active_material())
    }

    pub fn break_speeds(&self) -> (f64, f64) {
        material_break_speeds(self.active_material(), self.is_steel_ball())
    }

    pub fn friction_mult(&self) -> f64 {
        material_friction_mult(self.active_material(), self.is_steel_ball())
    }

    pub fn steer_mult(&self) -> f64 {
        material_steer_mult(self.active_material(), self.is_steel_ball())
    }

    pub fn lane_pull_mult(&self) -> f64 {
        material_lane_pull(self.active_material())
    }

    pub fn ram_knockback(&self) -> f64 {
        material_ram_knockback(self.active_material(), self.is_steel_ball())
    }

    pub fn ram_damage_mult(&self) -> f64 {
        material_ram_damage_mult(self.active_material(), self.is_steel_ball())
    }

    pub fn wall_break_speed_cost(&self) -> f64 {
        material_wall_break_cost(self.active_material(), self.is_steel_ball())
    }

    pub fn corner_add_mult(&self) -> f64 {
        material_corner_add_mult(self.active_material())
    }

    pub fn bumper_kick_mult(&self) -> f64 {
        material_bumper_mult(self.active_material())
    }

    pub fn max_speed(&self) -> f64 {
        material_max_speed(self.active_material())
    }
}

// Top-level 1:1 function adapters
pub fn active_material(state: &MarbleState) -> Option<MarbleMaterial> {
    state.active_material()
}

pub fn apply_material(state: &mut MarbleState, id: MarbleMaterial) {
    state.apply_material(id);
}

pub fn update_material(state: &mut MarbleState, dt: f64) {
    state.update(dt);
}

pub fn material_flat_restitution(mat: Option<MarbleMaterial>) -> Option<f64> {
    match mat {
        Some(MarbleMaterial::Diamond) => Some(DIAMOND_RESTITUTION),
        Some(MarbleMaterial::Water) => Some(WATER_RESTITUTION),
        Some(MarbleMaterial::Shadow) => Some(SHADOW_RESTITUTION),
        _ => None,
    }
}

pub fn material_player_r(mat: Option<MarbleMaterial>, base_r: f64) -> f64 {
    if mat == Some(MarbleMaterial::Shadow) {
        SHADOW_PLAYER_R
    } else {
        base_r
    }
}

pub fn material_bumper_scatter_mult(mat: Option<MarbleMaterial>) -> f64 {
    if mat == Some(MarbleMaterial::Shadow) {
        SHADOW_BUMPER_SCATTER_MULT
    } else {
        1.0
    }
}

pub fn material_break_speeds(mat: Option<MarbleMaterial>, is_steel: bool) -> (f64, f64) {
    match mat {
        Some(MarbleMaterial::Diamond) => (DIAMOND_SECRET_BREAK_SPEED, DIAMOND_WALL_BREAK_SPEED),
        Some(MarbleMaterial::Stone) => (STONE_SECRET_BREAK_SPEED, STONE_WALL_BREAK_SPEED),
        _ => {
            if is_steel {
                (STEEL_SECRET_BREAK_SPEED, STEEL_WALL_BREAK_SPEED)
            } else {
                (SECRET_BREAK_SPEED, WALL_BREAK_SPEED)
            }
        }
    }
}

pub fn material_friction_mult(mat: Option<MarbleMaterial>, is_steel: bool) -> f64 {
    match mat {
        Some(MarbleMaterial::Water) => WATER_FRICTION_MULT,
        Some(MarbleMaterial::Stone) => STONE_FRICTION_MULT,
        _ => {
            if is_steel && mat.is_none() {
                STEEL_FRICTION_MULT
            } else {
                1.0
            }
        }
    }
}

pub fn material_steer_mult(mat: Option<MarbleMaterial>, is_steel: bool) -> f64 {
    match mat {
        Some(MarbleMaterial::Water) => WATER_STEER_MULT,
        Some(MarbleMaterial::Storm) => STORM_STEER_MULT,
        _ => {
            if is_steel && mat.is_none() {
                STEEL_STEER_MULT
            } else {
                1.0
            }
        }
    }
}

pub fn material_lane_pull(mat: Option<MarbleMaterial>) -> f64 {
    if mat == Some(MarbleMaterial::Storm) {
        STORM_LANE_PULL_MULT
    } else {
        1.0
    }
}

pub fn material_ram_knockback(mat: Option<MarbleMaterial>, is_steel: bool) -> f64 {
    match mat {
        Some(MarbleMaterial::Stone) => STONE_RAM_KNOCKBACK,
        Some(MarbleMaterial::Water) => WATER_RAM_KNOCKBACK,
        _ => {
            if is_steel && mat.is_none() {
                STEEL_RAM_KNOCKBACK
            } else {
                BALL_RAM_KNOCKBACK
            }
        }
    }
}

pub fn material_ram_damage_mult(mat: Option<MarbleMaterial>, is_steel: bool) -> f64 {
    if mat == Some(MarbleMaterial::Stone) {
        STONE_RAM_DAMAGE_MULT
    } else if is_steel && mat.is_none() {
        STEEL_RAM_DAMAGE_MULT
    } else {
        1.0
    }
}

pub fn material_wall_break_cost(mat: Option<MarbleMaterial>, is_steel: bool) -> f64 {
    if mat == Some(MarbleMaterial::Stone) {
        STONE_WALL_BREAK_SPEED_COST
    } else if is_steel && mat.is_none() {
        STEEL_WALL_BREAK_SPEED_COST
    } else {
        WALL_BREAK_SPEED_COST
    }
}

pub fn material_corner_add_mult(mat: Option<MarbleMaterial>) -> f64 {
    if mat == Some(MarbleMaterial::Stone) {
        STONE_CORNER_ADD_MULT
    } else {
        1.0
    }
}

pub fn material_bumper_mult(mat: Option<MarbleMaterial>) -> f64 {
    match mat {
        Some(MarbleMaterial::Stone) => STONE_BUMPER_KICK_MULT,
        Some(MarbleMaterial::Lava) => LAVA_BUMPER_MULT,
        _ => 1.0,
    }
}

pub fn material_max_speed(mat: Option<MarbleMaterial>) -> f64 {
    if mat == Some(MarbleMaterial::Stone) {
        STONE_MAX_SPEED
    } else {
        PINBALL_MAX_SPEED
    }
}

pub fn material_clip(mat: Option<MarbleMaterial>) -> Option<&'static str> {
    match mat {
        Some(MarbleMaterial::Diamond) => Some("diamondball"),
        Some(MarbleMaterial::Water) => Some("waterball"),
        Some(MarbleMaterial::Stone) => Some("stoneball"),
        Some(MarbleMaterial::Storm) => Some("stormball"),
        Some(MarbleMaterial::Shadow) => Some("shadowball"),
        Some(MarbleMaterial::Lava) => Some("lavaball"),
        None => None,
    }
}

pub fn material_squash(mat: Option<MarbleMaterial>) -> f64 {
    match mat {
        Some(MarbleMaterial::Water) => WATER_SQUASH,
        Some(MarbleMaterial::Lava) => LAVA_SQUASH,
        _ => 0.0,
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct SquashState {
    pub hx: f64,
    pub hy: f64,
    pub amp: f64,
    pub timer: f64,
}

pub fn note_squash(squash: &mut SquashState, nx: f64, nz: f64, speed: f64, mat: Option<MarbleMaterial>) {
    let amp = material_squash(mat);
    if amp <= 0.0 || speed < SQUASH_MIN_SPEED {
        return;
    }
    let sx = (nx - nz) * std::f64::consts::FRAC_1_SQRT_2;
    let sz = (nx + nz) * std::f64::consts::FRAC_1_SQRT_2;
    let len = (sx * sx + sz * sz).sqrt().max(1e-4);
    squash.hx = sx / len;
    squash.hy = sz / len;
    squash.amp = amp * (speed / (SQUASH_MIN_SPEED * 2.0)).min(1.0);
    squash.timer = SQUASH_RECOVER;
}

pub fn squash_scale(squash: &SquashState) -> (f64, f64) {
    if squash.timer <= 0.0 {
        return (1.0, 1.0);
    }
    let t = squash.timer / SQUASH_RECOVER;
    let d = SQUASH_DEPTH * squash.amp * (t * std::f64::consts::PI * 0.5).sin();
    let flat = 1.0 - d;
    let bulge = 1.0 / flat.max(1e-4);
    if squash.hx.abs() >= squash.hy.abs() {
        (flat, bulge)
    } else {
        (bulge, flat)
    }
}

pub fn update_squash(squash: &mut SquashState, dt: f64) {
    if squash.timer > 0.0 {
        squash.timer = (squash.timer - dt).max(0.0);
    }
}

pub fn material_cuts_through(mat: Option<MarbleMaterial>, mom_speed: f64) -> bool {
    mat == Some(MarbleMaterial::Diamond) && mom_speed >= DIAMOND_CUT_SPEED
}

pub fn material_ram_cut_mult(mat: Option<MarbleMaterial>, mom_speed: f64) -> f64 {
    if material_cuts_through(mat, mom_speed) {
        DIAMOND_CUT_DMG_MULT
    } else {
        1.0
    }
}

pub fn material_contact_knockback(mat: Option<MarbleMaterial>, mom_speed: f64, is_steel: bool) -> f64 {
    if material_cuts_through(mat, mom_speed) {
        DIAMOND_CUT_KNOCKBACK
    } else {
        material_ram_knockback(mat, is_steel)
    }
}

pub fn material_ram_cooldown(mat: Option<MarbleMaterial>, mom_speed: f64) -> f64 {
    if material_cuts_through(mat, mom_speed) {
        DIAMOND_CUT_COOLDOWN
    } else {
        BALL_RAM_COOLDOWN
    }
}

pub fn material_resists_drain(mat: Option<MarbleMaterial>) -> bool {
    mat == Some(MarbleMaterial::Diamond)
}

pub fn shadow_slayer_mult(mat: Option<MarbleMaterial>, kind: EnemyKind) -> f64 {
    if mat == Some(MarbleMaterial::Shadow) && matches!(kind, EnemyKind::Ghost | EnemyKind::Reaper | EnemyKind::Wisp) {
        SHADOW_SLAYER_MULT
    } else {
        1.0
    }
}

pub fn shadow_vampire(mat: Option<MarbleMaterial>, player_hp: &mut i32, max_hp: i32, vamp_cd: &mut f64) -> bool {
    if mat != Some(MarbleMaterial::Shadow) || *vamp_cd > 0.0 || *player_hp >= max_hp {
        return false;
    }
    *player_hp = (*player_hp + SHADOW_LIFESTEAL).min(max_hp);
    *vamp_cd = SHADOW_LIFESTEAL_CD;
    true
}

pub fn update_vampire(vamp_cd: &mut f64, dt: f64) {
    if *vamp_cd > 0.0 {
        *vamp_cd = (*vamp_cd - dt).max(0.0);
    }
}

pub fn lava_melt_if_active(mat: Option<MarbleMaterial>, _nx: f64, _nz: f64, _speed: f64) -> bool {
    mat == Some(MarbleMaterial::Lava)
}

pub fn material_phases_walls(mat: Option<MarbleMaterial>) -> bool {
    mat == Some(MarbleMaterial::Shadow)
}

pub fn phase_move(grid: &Grid, x: f64, z: f64, r: f64, dx: f64, dz: f64, mat: Option<MarbleMaterial>) -> (f64, f64) {
    if !material_phases_walls(mat) {
        let res = move_circle(grid, x, z, r, dx, dz);
        return (res.x, res.z);
    }
    let lim_x = (grid.w as f64) / 2.0 - 1.0 - r;
    let lim_z = (grid.h as f64) / 2.0 - 1.0 - r;
    (
        (x + dx).clamp(-lim_x, lim_x),
        (z + dz).clamp(-lim_z, lim_z),
    )
}

pub fn update_phase_eject(
    grid: &Grid,
    player_x: &mut f64,
    player_z: &mut f64,
    phase_stuck_t: &mut f64,
    mat: Option<MarbleMaterial>,
    dt: f64,
) -> bool {
    if material_phases_walls(mat) {
        *phase_stuck_t = 0.0;
        return false;
    }
    let (ti, tj) = world_to_tile(grid, *player_x, *player_z);
    if is_walkable(grid, ti, tj) {
        *phase_stuck_t = 0.0;
        return false;
    }
    *phase_stuck_t += dt;
    if *phase_stuck_t < SHADOW_PHASE_GRACE {
        return false;
    }
    *phase_stuck_t = 0.0;

    for rad in 1_i32..=8_i32 {
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
                let d = (cx - *player_x).powi(2) + (cz - *player_z).powi(2);
                if best.map_or(true, |b| d < b.2) {
                    best = Some((cx, cz, d));
                }
            }
        }
        if let Some((bx, bz, _)) = best {
            *player_x = bx;
            *player_z = bz;
            return true;
        }
    }
    false
}

#[derive(Debug, Clone, PartialEq)]
pub enum MarbleBounceEvent {
    DiamondShards { x: f64, z: f64, count: usize, damage: i32 },
    WaterSlick { x: f64, z: f64, radius: f64, life: f64 },
    StoneShockwave { x: f64, z: f64, radius: f64, damage: f64 },
    StormArc { x: f64, z: f64, dir_x: f64, dir_z: f64 },
    ShadowDecoy { x: f64, z: f64 },
    LavaFire { x: f64, z: f64, radius: f64, life: f64 },
}

pub fn emit_material_on_bounce(
    player_x: f64,
    player_z: f64,
    mom_x: f64,
    mom_z: f64,
    mom_speed: f64,
    nx: f64,
    nz: f64,
    emit_cd: &mut f64,
    active_mats: &[MarbleMaterial],
    monsters: &mut [LiveMonster],
) -> Vec<MarbleBounceEvent> {
    let mut events = Vec::new();
    if mom_speed < MATERIAL_EMIT_SPEED || *emit_cd > 0.0 || active_mats.is_empty() {
        return events;
    }
    *emit_cd = MATERIAL_EMIT_COOLDOWN;

    let cx = player_x + nx * PLAYER_R;
    let cz = player_z + nz * PLAYER_R;

    for &m in active_mats {
        match m {
            MarbleMaterial::Diamond => {
                events.push(MarbleBounceEvent::DiamondShards {
                    x: cx,
                    z: cz,
                    count: DIAMOND_BOUNCE_SHARDS,
                    damage: DIAMOND_BOUNCE_DMG,
                });
            }
            MarbleMaterial::Water => {
                events.push(MarbleBounceEvent::WaterSlick {
                    x: cx,
                    z: cz,
                    radius: WATER_SLICK_RADIUS,
                    life: WATER_SLICK_LIFE,
                });
            }
            MarbleMaterial::Stone => {
                events.push(MarbleBounceEvent::StoneShockwave {
                    x: cx,
                    z: cz,
                    radius: STONE_SHOCK_RADIUS,
                    damage: STONE_SHOCK_DMG,
                });
                for zmb in monsters.iter_mut() {
                    if zmb.mode == EnemyMode::Dead {
                        continue;
                    }
                    let dx = zmb.x - cx;
                    let dz = zmb.z - cz;
                    let rr = STONE_SHOCK_RADIUS + ZOMBIE_R;
                    if dx * dx + dz * dz <= rr * rr {
                        let dealt = if zmb.kind == EnemyKind::Golem {
                            STONE_SHOCK_DMG * STONE_SHOCK_GOLEM_MULT
                        } else {
                            STONE_SHOCK_DMG
                        };
                        damage_zombie(zmb, dealt, dx, dz, 0.8, false, DamageSource::Steel, mom_speed, 0.0, 0, None, false);
                    }
                }
            }
            MarbleMaterial::Storm => {
                let hl = (mom_x * mom_x + mom_z * mom_z).sqrt().max(1e-4);
                let ax = mom_z / hl;
                let az = -mom_x / hl;
                events.push(MarbleBounceEvent::StormArc { x: cx, z: cz, dir_x: ax, dir_z: az });
                for zmb in monsters.iter_mut() {
                    if zmb.mode == EnemyMode::Dead {
                        continue;
                    }
                    let rx = zmb.x - cx;
                    let rz = zmb.z - cz;
                    let along = rx * ax + rz * az;
                    if along < -0.4 || along > STORM_BOUNCE_ARC_LEN {
                        continue;
                    }
                    if (rx * -az + rz * ax).abs() > STORM_BOUNCE_ARC_HALF {
                        continue;
                    }
                    damage_zombie(zmb, STORM_BOUNCE_ARC_DMG, ax, az, 0.2, false, DamageSource::Ranged, mom_speed, 0.0, 0, None, false);
                }
            }
            MarbleMaterial::Shadow => {
                events.push(MarbleBounceEvent::ShadowDecoy { x: player_x, z: player_z });
            }
            MarbleMaterial::Lava => {
                events.push(MarbleBounceEvent::LavaFire {
                    x: cx,
                    z: cz,
                    radius: FIRE_PUDDLE_RADIUS,
                    life: FIRE_PUDDLE_LIFE,
                });
            }
        }
    }

    events
}

#[derive(Debug, Clone, PartialEq)]
pub enum MarbleSlamEvent {
    DiamondSlamBurst { x: f64, z: f64, count: usize, damage: i32 },
    WaterSlamSlicks { x: f64, z: f64, count: usize },
    StoneSlamShockwave { x: f64, z: f64, radius: f64, damage: f64 },
    StormThunderclap { x: f64, z: f64 },
    ShadowVoidImplosion { x: f64, z: f64 },
    LavaEruption { x: f64, z: f64, count: usize },
}

pub fn material_slam(
    player_x: f64,
    player_z: f64,
    mom_speed: &mut f64,
    rage_t: f64,
    active_mats: &[MarbleMaterial],
    grid: &Grid,
    monsters: &mut [LiveMonster],
) -> Vec<MarbleSlamEvent> {
    let mut events = Vec::new();
    for &m in active_mats {
        match m {
            MarbleMaterial::Diamond => {
                let rage = if rage_t > 0.0 { 1.5 } else { 1.0 };
                let count = ((DIAMOND_SLAM_SHARDS as f64) * rage).round() as usize;
                events.push(MarbleSlamEvent::DiamondSlamBurst {
                    x: player_x,
                    z: player_z,
                    count,
                    damage: DIAMOND_SLAM_DMG,
                });
            }
            MarbleMaterial::Water => {
                events.push(MarbleSlamEvent::WaterSlamSlicks {
                    x: player_x,
                    z: player_z,
                    count: WATER_SLAM_SLICKS,
                });
                *mom_speed = (*mom_speed + WATER_SLAM_SPEED_KICK).min(PINBALL_MAX_SPEED);
            }
            MarbleMaterial::Stone => {
                let dmg = STONE_SLAM_BASE_DMG + STONE_SLAM_DMG_PER_SPEED * (*mom_speed);
                events.push(MarbleSlamEvent::StoneSlamShockwave {
                    x: player_x,
                    z: player_z,
                    radius: STONE_SLAM_RADIUS,
                    damage: dmg,
                });
                for zmb in monsters.iter_mut() {
                    if zmb.mode == EnemyMode::Dead {
                        continue;
                    }
                    let dx = zmb.x - player_x;
                    let dz = zmb.z - player_z;
                    let rr = STONE_SLAM_RADIUS + ZOMBIE_R;
                    if dx * dx + dz * dz <= rr * rr {
                        damage_zombie(zmb, dmg, dx, dz, 0.8, false, DamageSource::Steel, *mom_speed, 0.0, 0, None, false);
                    }
                }
                *mom_speed *= 0.3;
            }
            MarbleMaterial::Storm => {
                events.push(MarbleSlamEvent::StormThunderclap { x: player_x, z: player_z });
                for zmb in monsters.iter_mut() {
                    if zmb.mode == EnemyMode::Dead {
                        continue;
                    }
                    let dx = zmb.x - player_x;
                    let dz = zmb.z - player_z;
                    let rr = STORM_CLAP_RADIUS + ZOMBIE_R;
                    if dx * dx + dz * dz <= rr * rr {
                        damage_zombie(zmb, STORM_CLAP_DMG, dx, dz, 0.5, false, DamageSource::Ranged, *mom_speed, 0.0, 0, None, false);
                    }
                }
            }
            MarbleMaterial::Shadow => {
                events.push(MarbleSlamEvent::ShadowVoidImplosion { x: player_x, z: player_z });
                for zmb in monsters.iter_mut() {
                    if zmb.mode == EnemyMode::Dead {
                        continue;
                    }
                    let dx = player_x - zmb.x;
                    let dz = player_z - zmb.z;
                    let d2 = dx * dx + dz * dz;
                    if d2 <= SHADOW_IMPLODE_RADIUS * SHADOW_IMPLODE_RADIUS {
                        let d = d2.sqrt().max(1e-4);
                        let pull = d * SHADOW_IMPLODE_PULL;
                        let r = move_circle(grid, zmb.x, zmb.z, ZOMBIE_R, (dx / d) * pull, (dz / d) * pull);
                        zmb.x = r.x;
                        zmb.z = r.z;
                        damage_zombie(zmb, SHADOW_IMPLODE_DMG, -dx, -dz, 0.0, false, DamageSource::Ranged, *mom_speed, 0.0, 0, None, false);
                    }
                }
            }
            MarbleMaterial::Lava => {
                events.push(MarbleSlamEvent::LavaEruption {
                    x: player_x,
                    z: player_z,
                    count: LAVA_SLAM_GLOBS,
                });
            }
        }
    }
    events
}

pub fn try_water_steam(
    player_x: f64,
    player_z: f64,
    mom_speed: &mut f64,
    mat: Option<MarbleMaterial>,
    monsters: &mut [LiveMonster],
) -> bool {
    if mat != Some(MarbleMaterial::Water) {
        return false;
    }
    for zmb in monsters.iter_mut() {
        if zmb.mode == EnemyMode::Dead {
            continue;
        }
        let dx = zmb.x - player_x;
        let dz = zmb.z - player_z;
        let rr = WATER_STEAM_RADIUS + ZOMBIE_R;
        if dx * dx + dz * dz <= rr * rr {
            damage_zombie(zmb, WATER_STEAM_DMG as f64, dx, dz, 1.2, false, DamageSource::Steel, *mom_speed, 0.0, 0, None, false);
        }
    }
    *mom_speed = (*mom_speed).max(WATER_STEAM_LAUNCH);
    true
}

pub fn stone_magstrip_cap(mat: Option<MarbleMaterial>) -> Option<f64> {
    if mat == Some(MarbleMaterial::Stone) {
        Some(STONE_MAGSTRIP_CAP)
    } else {
        None
    }
}

pub fn stone_ignores_oil(mat: Option<MarbleMaterial>) -> bool {
    mat == Some(MarbleMaterial::Stone)
}

pub fn lava_vaporizes_oil(_x: f64, _z: f64, mat: Option<MarbleMaterial>) -> bool {
    mat == Some(MarbleMaterial::Lava)
}

pub fn stone_bridges_pit(mat: Option<MarbleMaterial>, mom_speed: f64) -> bool {
    mat == Some(MarbleMaterial::Stone) && mom_speed > 0.0
}

pub fn water_quenches_fire(_x: f64, _z: f64, mat: Option<MarbleMaterial>) -> bool {
    mat == Some(MarbleMaterial::Water)
}

pub fn try_diamond_discharge(
    x: f64,
    z: f64,
    mat: Option<MarbleMaterial>,
    monsters: &mut [LiveMonster],
) -> bool {
    if mat != Some(MarbleMaterial::Diamond) {
        return false;
    }
    for zmb in monsters.iter_mut() {
        if zmb.mode == EnemyMode::Dead {
            continue;
        }
        let dx = zmb.x - x;
        let dz = zmb.z - z;
        let rr = DIAMOND_DISCHARGE_RADIUS + ZOMBIE_R;
        if dx * dx + dz * dz <= rr * rr {
            damage_zombie(zmb, DIAMOND_DISCHARGE_DMG as f64, dx, dz, 0.4, false, DamageSource::Ranged, 0.0, 0.0, 0, None, false);
        }
    }
    true
}
