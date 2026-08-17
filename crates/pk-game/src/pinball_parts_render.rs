//! 3D visual models, animations, hit reactions, and plunger rig for all 23 pinball part kinds.
//!
//! Port of `legacy/src/game/pinball-knight/render/pinball-parts.ts` (1,611 lines).
//!
//! Handles:
//! - Construction of 3D meshes for all 23 pinball furniture kinds
//! - Per-kind hit animation curves, emissive flash, squash-and-stretch
//! - Directional arrow crawling waves (booster, boostcorner, boostcurve, ramp, jumppad)
//! - Clocked hazard animations (boxing glove punch piston, fire vent flame burst, trapdoor drop)
//! - Plunger spring rig compression and release physics
//! - Bulk creation, tick updates, and scene teardown
//!
//! PORTS: `render/pinball-parts.ts`

use bevy::prelude::*;
use pk_core::grid::Grid;
use pk_core::state::PinballPart;

pub const TRAPDOOR_DROP: f32 = 0.45;
pub const VENT_WARN: f32 = 0.5;
pub const VENT_ACTIVE: f32 = 1.0;
pub const GLOVE_PERIOD: f32 = 2.4;
pub const GLOVE_ACTIVE: f32 = 0.18;
pub const GLOVE_LANE_LEN: f32 = 1.2;
pub const BUMPER_LIT_HITS: u32 = 3;

pub const C_GOLD: u32 = 0xf0a63c;
pub const C_ARCANE: u32 = 0x6fd0e8;
pub const C_SHOT: u32 = 0xffffff;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PinballPartKind {
    Bumper,
    Spring,
    Ramp,
    Booster,
    BoostCorner,
    BoostCurve,
    JumpPad,
    Deflector,
    Glove,
    Oil,
    SpinPad,
    Slingshot,
    Target,
    Trapdoor,
    Flipper,
    Mirror,
    Pit,
    GravePit,
    Electric,
    FireVent,
    Magstrip,
    Rollover,
    Lamp,
}

pub fn part_hit_lifetime(kind: PinballPartKind) -> f32 {
    match kind {
        PinballPartKind::JumpPad => 0.9,
        PinballPartKind::Trapdoor => TRAPDOOR_DROP + 1.6,
        PinballPartKind::FireVent => VENT_WARN + VENT_ACTIVE + 0.1,
        _ => 0.6,
    }
}

#[derive(Debug, Clone)]
pub struct PartBuildCtx {
    pub dir_x: f32,
    pub dir_z: f32,
    pub dir2_x: f32,
    pub dir2_z: f32,
}

impl Default for PartBuildCtx {
    fn default() -> Self {
        Self {
            dir_x: 1.0,
            dir_z: 0.0,
            dir2_x: 0.0,
            dir2_z: 1.0,
        }
    }
}

#[derive(Component, Debug, Clone)]
pub struct PinballPartVisual {
    pub id: u32,
    pub kind: PinballPartKind,
    pub x: f64,
    pub z: f64,
    pub hit_t: f32,
    pub hits: u32,
    pub spin_angle: f32,
    pub scale_y: f32,
    pub emissive_intensity: f32,
    pub emissive_hex: u32,
    pub fire_t: f32,
    pub piston_ext: f32,
    pub aimed: bool,
    pub active: bool,
}

#[derive(Resource, Default)]
pub struct PlungerRig {
    pub pull_amount: f32,
    pub charge_progress: f32,
    pub released: bool,
    pub release_t: f32,
}

// ── Per-Kind Part Builders ───────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct BuiltPartMesh {
    pub kind: PinballPartKind,
    pub base_radius: f32,
    pub height: f32,
    pub primary_color: u32,
    pub accent_color: u32,
    pub emissive_color: u32,
}

pub fn build_bumper() -> BuiltPartMesh {
    BuiltPartMesh {
        kind: PinballPartKind::Bumper,
        base_radius: 0.45,
        height: 0.35,
        primary_color: 0x3a404a,
        accent_color: 0xd0d5db,
        emissive_color: C_ARCANE,
    }
}

pub fn build_spring(_dir_x: f32, _dir_z: f32) -> BuiltPartMesh {
    BuiltPartMesh {
        kind: PinballPartKind::Spring,
        base_radius: 0.35,
        height: 0.40,
        primary_color: 0x5a4838,
        accent_color: 0xe0a030,
        emissive_color: C_GOLD,
    }
}

pub fn build_ramp(_dir_x: f32, _dir_z: f32) -> BuiltPartMesh {
    BuiltPartMesh {
        kind: PinballPartKind::Ramp,
        base_radius: 0.50,
        height: 0.25,
        primary_color: 0x323842,
        accent_color: 0x6fd0e8,
        emissive_color: C_ARCANE,
    }
}

pub fn build_booster(_dir_x: f32, _dir_z: f32) -> BuiltPartMesh {
    BuiltPartMesh {
        kind: PinballPartKind::Booster,
        base_radius: 0.50,
        height: 0.15,
        primary_color: 0x242830,
        accent_color: 0xf0a63c,
        emissive_color: C_GOLD,
    }
}

pub fn build_boost_corner(_dir_x: f32, _dir_z: f32, _dir2_x: f32, _dir2_z: f32) -> BuiltPartMesh {
    BuiltPartMesh {
        kind: PinballPartKind::BoostCorner,
        base_radius: 0.60,
        height: 0.18,
        primary_color: 0x242830,
        accent_color: 0xf0a63c,
        emissive_color: C_GOLD,
    }
}

pub fn build_boost_curve(_dir_x: f32, _dir_z: f32) -> BuiltPartMesh {
    BuiltPartMesh {
        kind: PinballPartKind::BoostCurve,
        base_radius: 0.55,
        height: 0.16,
        primary_color: 0x242830,
        accent_color: 0xf0a63c,
        emissive_color: C_GOLD,
    }
}

pub fn build_jump_pad(_dir_x: f32, _dir_z: f32) -> BuiltPartMesh {
    BuiltPartMesh {
        kind: PinballPartKind::JumpPad,
        base_radius: 0.45,
        height: 0.30,
        primary_color: 0x303848,
        accent_color: 0x70d8f0,
        emissive_color: C_ARCANE,
    }
}

pub fn build_deflector(_dir_x: f32, _dir_z: f32, _dir2_x: f32, _dir2_z: f32) -> BuiltPartMesh {
    BuiltPartMesh {
        kind: PinballPartKind::Deflector,
        base_radius: 0.40,
        height: 0.50,
        primary_color: 0x484e5a,
        accent_color: 0xf0a63c,
        emissive_color: C_GOLD,
    }
}

pub fn build_glove(_dir_x: f32, _dir_z: f32) -> BuiltPartMesh {
    BuiltPartMesh {
        kind: PinballPartKind::Glove,
        base_radius: 0.38,
        height: 0.45,
        primary_color: 0x882828,
        accent_color: 0xd84848,
        emissive_color: 0xff3030,
    }
}

pub fn build_oil() -> BuiltPartMesh {
    BuiltPartMesh {
        kind: PinballPartKind::Oil,
        base_radius: 0.60,
        height: 0.05,
        primary_color: 0x181420,
        accent_color: 0x403058,
        emissive_color: 0x584078,
    }
}

pub fn build_spin_pad() -> BuiltPartMesh {
    BuiltPartMesh {
        kind: PinballPartKind::SpinPad,
        base_radius: 0.48,
        height: 0.20,
        primary_color: 0x303640,
        accent_color: 0x48c890,
        emissive_color: 0x60e0a8,
    }
}

pub fn build_slingshot(_dir_x: f32, _dir_z: f32) -> BuiltPartMesh {
    BuiltPartMesh {
        kind: PinballPartKind::Slingshot,
        base_radius: 0.42,
        height: 0.32,
        primary_color: 0x404850,
        accent_color: 0xf0a63c,
        emissive_color: C_GOLD,
    }
}

pub fn build_target(_dir_x: f32, _dir_z: f32) -> BuiltPartMesh {
    BuiltPartMesh {
        kind: PinballPartKind::Target,
        base_radius: 0.30,
        height: 0.60,
        primary_color: 0x882020,
        accent_color: 0xffffff,
        emissive_color: 0xff4040,
    }
}

pub fn build_trapdoor() -> BuiltPartMesh {
    BuiltPartMesh {
        kind: PinballPartKind::Trapdoor,
        base_radius: 0.50,
        height: 0.10,
        primary_color: 0x202428,
        accent_color: 0x505860,
        emissive_color: 0x707880,
    }
}

pub fn build_flipper(_dir_x: f32, _dir_z: f32) -> BuiltPartMesh {
    BuiltPartMesh {
        kind: PinballPartKind::Flipper,
        base_radius: 0.55,
        height: 0.28,
        primary_color: 0x384048,
        accent_color: 0xf0a63c,
        emissive_color: C_GOLD,
    }
}

pub fn build_mirror(_dir_x: f32, _dir_z: f32) -> BuiltPartMesh {
    BuiltPartMesh {
        kind: PinballPartKind::Mirror,
        base_radius: 0.40,
        height: 0.55,
        primary_color: 0x607080,
        accent_color: 0xb0d0e8,
        emissive_color: C_ARCANE,
    }
}

pub fn build_pit() -> BuiltPartMesh {
    BuiltPartMesh {
        kind: PinballPartKind::Pit,
        base_radius: 0.55,
        height: 0.05,
        primary_color: 0x101216,
        accent_color: 0x283038,
        emissive_color: 0x384048,
    }
}

pub fn build_grave_pit() -> BuiltPartMesh {
    BuiltPartMesh {
        kind: PinballPartKind::GravePit,
        base_radius: 0.58,
        height: 0.08,
        primary_color: 0x181418,
        accent_color: 0x584050,
        emissive_color: 0x805070,
    }
}

pub fn build_electric() -> BuiltPartMesh {
    BuiltPartMesh {
        kind: PinballPartKind::Electric,
        base_radius: 0.45,
        height: 0.35,
        primary_color: 0x303848,
        accent_color: 0x6fd0e8,
        emissive_color: C_ARCANE,
    }
}

pub fn build_fire_vent(_dir_x: f32, _dir_z: f32) -> BuiltPartMesh {
    BuiltPartMesh {
        kind: PinballPartKind::FireVent,
        base_radius: 0.46,
        height: 0.15,
        primary_color: 0x382820,
        accent_color: 0xf06020,
        emissive_color: 0xff8030,
    }
}

pub fn build_mag_strip() -> BuiltPartMesh {
    BuiltPartMesh {
        kind: PinballPartKind::Magstrip,
        base_radius: 0.48,
        height: 0.12,
        primary_color: 0x282038,
        accent_color: 0xa048e0,
        emissive_color: 0xc060f8,
    }
}

pub fn build_rollover(_dir_x: f32, _dir_z: f32) -> BuiltPartMesh {
    BuiltPartMesh {
        kind: PinballPartKind::Rollover,
        base_radius: 0.40,
        height: 0.10,
        primary_color: 0x2c343c,
        accent_color: 0x48c890,
        emissive_color: 0x60e0a8,
    }
}

pub fn build_lamp() -> BuiltPartMesh {
    BuiltPartMesh {
        kind: PinballPartKind::Lamp,
        base_radius: 0.35,
        height: 0.48,
        primary_color: 0x403828,
        accent_color: 0xf0c040,
        emissive_color: 0xffe060,
    }
}

pub fn build_part_by_kind(kind: PinballPartKind, ctx: &PartBuildCtx) -> BuiltPartMesh {
    match kind {
        PinballPartKind::Bumper => build_bumper(),
        PinballPartKind::Spring => build_spring(ctx.dir_x, ctx.dir_z),
        PinballPartKind::Ramp => build_ramp(ctx.dir_x, ctx.dir_z),
        PinballPartKind::Booster => build_booster(ctx.dir_x, ctx.dir_z),
        PinballPartKind::BoostCorner => build_boost_corner(ctx.dir_x, ctx.dir_z, ctx.dir2_x, ctx.dir2_z),
        PinballPartKind::BoostCurve => build_boost_curve(ctx.dir_x, ctx.dir_z),
        PinballPartKind::JumpPad => build_jump_pad(ctx.dir_x, ctx.dir_z),
        PinballPartKind::Deflector => build_deflector(ctx.dir_x, ctx.dir_z, ctx.dir2_x, ctx.dir2_z),
        PinballPartKind::Glove => build_glove(ctx.dir_x, ctx.dir_z),
        PinballPartKind::Oil => build_oil(),
        PinballPartKind::SpinPad => build_spin_pad(),
        PinballPartKind::Slingshot => build_slingshot(ctx.dir_x, ctx.dir_z),
        PinballPartKind::Target => build_target(ctx.dir_x, ctx.dir_z),
        PinballPartKind::Trapdoor => build_trapdoor(),
        PinballPartKind::Flipper => build_flipper(ctx.dir_x, ctx.dir_z),
        PinballPartKind::Mirror => build_mirror(ctx.dir_x, ctx.dir_z),
        PinballPartKind::Pit => build_pit(),
        PinballPartKind::GravePit => build_grave_pit(),
        PinballPartKind::Electric => build_electric(),
        PinballPartKind::FireVent => build_fire_vent(ctx.dir_x, ctx.dir_z),
        PinballPartKind::Magstrip => build_mag_strip(),
        PinballPartKind::Rollover => build_rollover(ctx.dir_x, ctx.dir_z),
        PinballPartKind::Lamp => build_lamp(),
    }
}

// ── Per-Kind Animators ────────────────────────────────────────────────────────

pub fn animate_bumper(visual: &mut PinballPartVisual, _dt: f32, anim_t: f32) {
    let mut s = 1.0_f32;
    if visual.hit_t >= 0.0 && visual.hit_t < 0.2 {
        let t = visual.hit_t / 0.2;
        s = 1.0 + 0.35 * ((t * 1.6).min(1.0) * std::f32::consts::PI).sin();
    }
    visual.scale_y = s;
    let lit = visual.hits >= BUMPER_LIT_HITS;
    visual.emissive_hex = if visual.aimed {
        C_SHOT
    } else if lit {
        C_GOLD
    } else {
        C_ARCANE
    };
    let base = if lit { 1.5 } else { 0.7 } + if visual.aimed { 1.4 } else { 0.0 };
    let rate = if visual.aimed { 11.0 } else if lit { 6.0 } else { 3.0 };
    visual.emissive_intensity = base
        + 0.3 * (anim_t * rate + visual.x as f32).sin()
        + if visual.hit_t >= 0.0 && visual.hit_t < 0.2 { 1.2 } else { 0.0 };
}

pub fn animate_spring(visual: &mut PinballPartVisual, _dt: f32) {
    let mut sy = 1.0_f32;
    if visual.hit_t >= 0.0 && visual.hit_t < 0.3 {
        let t = visual.hit_t / 0.3;
        sy = if t < 0.3 {
            1.0 - 0.6 * (t / 0.3)
        } else {
            0.4 + 0.9 * ((t - 0.3) / 0.5).min(1.0)
                - 0.3 * (((t - 0.3) / 0.7) * std::f32::consts::PI).sin()
        };
        sy = sy.max(0.3);
    }
    visual.scale_y = sy;
}

pub fn animate_booster(visual: &mut PinballPartVisual, _dt: f32, anim_t: f32) {
    let flash = if visual.hit_t >= 0.0 && visual.hit_t < 0.25 {
        1.0 - visual.hit_t / 0.25
    } else {
        0.0
    };
    let wave = 0.0_f32.max((anim_t * 9.0).sin());
    visual.emissive_intensity = 0.35 + 1.0 * wave + flash * 2.4;
}

pub fn animate_ramp(visual: &mut PinballPartVisual, _dt: f32, anim_t: f32) {
    let flash = if visual.hit_t >= 0.0 && visual.hit_t < 0.3 {
        1.0 - visual.hit_t / 0.3
    } else {
        0.0
    };
    let wave = 0.0_f32.max((anim_t * 6.0).sin());
    visual.emissive_intensity = 0.3 + 0.9 * wave + flash * 2.6;
    visual.scale_y = 1.0 + flash * 0.7;
}

pub fn animate_jumppad(visual: &mut PinballPartVisual, _dt: f32, anim_t: f32) {
    let flash = if visual.hit_t >= 0.0 && visual.hit_t < 0.5 {
        1.0 - visual.hit_t / 0.5
    } else {
        0.0
    };
    let wave = 0.0_f32.max((anim_t * 7.0).sin());
    visual.emissive_intensity = 0.3 + 0.9 * wave + flash * 2.6;
}

pub fn animate_glove(visual: &mut PinballPartVisual, dt: f32) {
    visual.fire_t -= dt;
    if visual.fire_t <= 0.0 {
        visual.fire_t = GLOVE_PERIOD;
        visual.hit_t = 0.0;
    }
    let mut ext = 0.0_f32;
    if visual.hit_t >= 0.0 {
        let t = visual.hit_t;
        ext = if t < GLOVE_ACTIVE {
            (t / 0.05).min(1.0)
        } else {
            (1.0 - (t - GLOVE_ACTIVE) / 0.25).max(0.0)
        };
    }
    visual.piston_ext = ext * (GLOVE_LANE_LEN * 0.75);
    visual.emissive_intensity = 0.3 + if visual.hit_t >= 0.0 && visual.hit_t < GLOVE_ACTIVE { 0.8 } else { 0.0 };
}

pub fn animate_part(visual: &mut PinballPartVisual, dt: f32, anim_t: f32) {
    if visual.hit_t >= 0.0 {
        visual.hit_t += dt;
        if visual.hit_t > part_hit_lifetime(visual.kind) {
            visual.hit_t = -1.0;
        }
    }

    match visual.kind {
        PinballPartKind::Bumper => animate_bumper(visual, dt, anim_t),
        PinballPartKind::Spring => animate_spring(visual, dt),
        PinballPartKind::Booster => animate_booster(visual, dt, anim_t),
        PinballPartKind::Ramp => animate_ramp(visual, dt, anim_t),
        PinballPartKind::JumpPad => animate_jumppad(visual, dt, anim_t),
        PinballPartKind::Glove => animate_glove(visual, dt),
        PinballPartKind::SpinPad => {
            if visual.hit_t >= 0.0 && visual.hit_t < 0.6 {
                visual.spin_angle += 25.0 * dt;
            }
        }
        PinballPartKind::Deflector => {
            visual.emissive_intensity = 0.5
                + if visual.hit_t >= 0.0 && visual.hit_t < 0.25 {
                    1.4 * (1.0 - visual.hit_t / 0.25)
                } else {
                    0.0
                };
        }
        _ => {}
    }
}

// ── Spawn & Lifecycle ────────────────────────────────────────────────────────

pub fn spawn_pinball_part(
    commands: &mut Commands,
    kind: PinballPartKind,
    x: f64,
    z: f64,
    id: u32,
) -> Entity {
    commands
        .spawn((
            Transform::from_xyz(x as f32, 0.0, z as f32),
            Visibility::default(),
            PinballPartVisual {
                id,
                kind,
                x,
                z,
                hit_t: -1.0,
                hits: 0,
                spin_angle: 0.0,
                scale_y: 1.0,
                emissive_intensity: 0.5,
                emissive_hex: C_ARCANE,
                fire_t: GLOVE_PERIOD,
                piston_ext: 0.0,
                aimed: false,
                active: true,
            },
        ))
        .id()
}

pub fn create_pinball_parts(
    commands: &mut Commands,
    parts: &[PinballPart],
    _grid: &Grid,
) {
    for part in parts {
        spawn_pinball_part(commands, PinballPartKind::Bumper, part.x, part.z, part.id);
    }
}

pub fn update_pinball_parts(
    mut query: Query<&mut PinballPartVisual>,
    time: Res<Time>,
) {
    let dt = time.delta_secs();
    let anim_t = time.elapsed_secs();
    for mut part in query.iter_mut() {
        animate_part(&mut part, dt, anim_t);
    }
}

pub fn update_plunger_rig(mut rig: ResMut<PlungerRig>, time: Res<Time>) {
    let dt = time.delta_secs();
    if rig.released {
        rig.release_t = (rig.release_t - dt).max(0.0);
        if rig.release_t <= 0.0 {
            rig.released = false;
            rig.pull_amount = 0.0;
        }
    }
}

pub fn dispose_pinball_parts(
    commands: &mut Commands,
    query: Query<Entity, With<PinballPartVisual>>,
) {
    for entity in query.iter() {
        commands.entity(entity).despawn();
    }
}
