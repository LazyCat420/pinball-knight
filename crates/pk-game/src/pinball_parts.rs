//! PINBALL PART MESHES — 3D furniture, primitive geometry builders, and procedural animation state machine.
//!
//! Port of `legacy/src/game/pinball-knight/render/pinball-parts.ts` (1,611 lines).
//!
//! PORTS: `render/pinball-parts.ts`
#![allow(dead_code)]

use std::collections::HashMap;
use std::f32::consts::PI;

pub const PALETTE_HEX: [u32; 32] = [
    0x0d080d, 0x1c1018, 0x2e1a24, 0x472835, 0x663945, 0x8a4d55, 0xb06462, 0xd48270,
    0xe8a486, 0xf2c8a2, 0xfae4c3, 0xffffff, 0x1f1f2e, 0x2e2d42, 0x434159, 0x5e5b73,
    0xf0a63c, 0xb87333, 0x7a4328, 0x544e63, 0x827e9c, 0xc2b09b, 0x6e8c72, 0x3d5c4e,
    0x1c362d, 0x1a2e3b, 0x284f61, 0x3c788a, 0x5ba3ad, 0x86ccd1, 0xb8edf0, 0x6fd0e8,
];

pub const C_STEEL_DK: u32 = PALETTE_HEX[19];
pub const C_STEEL: u32 = PALETTE_HEX[20];
pub const C_ARCANE: u32 = PALETTE_HEX[31];
pub const C_GOLD: u32 = PALETTE_HEX[16];
pub const C_SHOT: u32 = PALETTE_HEX[21];

pub const GLOVE_PERIOD: f32 = 1.8;
pub const GLOVE_ACTIVE: f32 = 0.35;
pub const GLOVE_LANE_LEN: f32 = 2.4;
pub const FLIPPER_SWING: f32 = PI / 4.0;
pub const ELEC_ON: f32 = 1.2;
pub const ELEC_OFF: f32 = 0.8;
pub const VENT_PERIOD: f32 = 3.0;
pub const VENT_WARN: f32 = 0.6;
pub const VENT_ACTIVE: f32 = 1.2;
pub const BUMPER_LIT_HITS: u32 = 4;
pub const TRAPDOOR_OPEN: f32 = 0.4;
pub const TRAPDOOR_DROP: f32 = 0.6;
pub const SHOT_LIGHT_MIN_SPEED: f32 = 8.0;
pub const SHOT_LIGHT_RANGE: f32 = 3.2;
pub const SHOT_LIGHT_COS: f32 = 0.707;
pub const PART_ANIM_RANGE_SQ: f32 = 225.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum PinballPartKind {
    Bumper,
    Spring,
    Ramp,
    Booster,
    BoostCorner,
    BoostCurve,
    JumpPad,
    Deflector,
    Slingshot,
    Spinner,
    Flipper,
    Rollover,
    DropTarget,
    Plunger,
    Magnet,
    WarpPortal,
    Spikes,
    FireVent,
    ToxicDrain,
    ElectricGate,
    Glove,
    Gravepit,
    Bell,
    Chute,
    Orbit,
    Saucer,
    Turret,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PartMaterialDesc {
    pub color: u32,
    pub emissive: u32,
    pub emissive_intensity: f32,
    pub roughness: f32,
    pub metalness: f32,
    pub shared: bool,
}

impl PartMaterialDesc {
    pub fn standard(color: u32, emissive: u32, intensity: f32) -> Self {
        Self {
            color,
            emissive,
            emissive_intensity: intensity,
            roughness: 0.6,
            metalness: 0.2,
            shared: true,
        }
    }

    pub fn own(color: u32, emissive: u32, intensity: f32) -> Self {
        Self {
            color,
            emissive,
            emissive_intensity: intensity,
            roughness: 0.6,
            metalness: 0.2,
            shared: false,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum PrimitiveShape {
    Box { w: f32, h: f32, d: f32 },
    Cylinder { r_top: f32, r_bot: f32, h: f32, segs: u32 },
    Torus { r: f32, tube: f32, radial_segs: u32, tubular_segs: u32, arc: f32 },
    Cone { r: f32, h: f32, segs: u32 },
    Sphere { r: f32, segs_w: u32, segs_h: u32, phi_len: f32, theta_len: f32 },
    Ring { r_in: f32, r_out: f32, segs: u32, theta_len: f32 },
    ExtrudedWedge { len: f32, h: f32, w: f32 },
}

#[derive(Clone, Debug, PartialEq)]
pub struct SubMeshDesc {
    pub shape: PrimitiveShape,
    pub material: PartMaterialDesc,
    pub position: [f32; 3],
    pub rotation: [f32; 3],
    pub scale: [f32; 3],
    pub tag: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PartMeshGroup {
    pub kind: PinballPartKind,
    pub submeshes: Vec<SubMeshDesc>,
    pub yaw: f32,
    pub phase: f32,
    pub user_tags: HashMap<String, usize>,
}

impl PartMeshGroup {
    pub fn new(kind: PinballPartKind) -> Self {
        Self {
            kind,
            submeshes: Vec::new(),
            yaw: 0.0,
            phase: 0.0,
            user_tags: HashMap::new(),
        }
    }

    pub fn add(&mut self, shape: PrimitiveShape, material: PartMaterialDesc, pos: [f32; 3], rot: [f32; 3], tag: Option<&str>) -> usize {
        let idx = self.submeshes.len();
        if let Some(t) = tag {
            self.user_tags.insert(t.to_string(), idx);
        }
        self.submeshes.push(SubMeshDesc {
            shape,
            material,
            position: pos,
            rotation: rot,
            scale: [1.0, 1.0, 1.0],
            tag: tag.map(|s| s.to_string()),
        });
        idx
    }
}

pub fn yaw_for(dx: f32, dz: f32) -> f32 {
    (-dz).atan2(dx)
}

// ── Part Mesh Builders ──

pub fn build_bumper() -> PartMeshGroup {
    let mut gp = PartMeshGroup::new(PinballPartKind::Bumper);
    gp.add(
        PrimitiveShape::Cylinder { r_top: 0.34, r_bot: 0.38, h: 0.16, segs: 12 },
        PartMaterialDesc::standard(C_STEEL_DK, 0, 0.0),
        [0.0, 0.08, 0.0],
        [0.0, 0.0, 0.0],
        Some("base"),
    );
    gp.add(
        PrimitiveShape::Torus { r: 0.3, tube: 0.045, radial_segs: 8, tubular_segs: 16, arc: PI * 2.0 },
        PartMaterialDesc::standard(C_GOLD, C_GOLD, 0.5),
        [0.0, 0.17, 0.0],
        [PI / 2.0, 0.0, 0.0],
        Some("ring"),
    );
    gp.add(
        PrimitiveShape::Sphere { r: 0.26, segs_w: 12, segs_h: 8, phi_len: PI * 2.0, theta_len: PI / 2.0 },
        PartMaterialDesc::own(C_ARCANE, C_ARCANE, 0.9),
        [0.0, 0.16, 0.0],
        [0.0, 0.0, 0.0],
        Some("dome"),
    );
    gp
}

pub fn build_spring(dir_x: f32, dir_z: f32) -> PartMeshGroup {
    let mut gp = PartMeshGroup::new(PinballPartKind::Spring);
    gp.yaw = yaw_for(dir_x, dir_z);
    gp.add(
        PrimitiveShape::Box { w: 0.56, h: 0.06, d: 0.56 },
        PartMaterialDesc::standard(C_STEEL_DK, 0, 0.0),
        [0.0, 0.03, 0.0],
        [0.0, 0.0, 0.0],
        Some("plate"),
    );
    for k in 0..3 {
        gp.add(
            PrimitiveShape::Torus { r: 0.16, tube: 0.035, radial_segs: 6, tubular_segs: 12, arc: PI * 2.0 },
            PartMaterialDesc::standard(C_STEEL, 0, 0.0),
            [0.0, 0.1 + (k as f32) * 0.07, 0.0],
            [PI / 2.0, 0.0, 0.0],
            Some("coil_loop"),
        );
    }
    gp.add(
        PrimitiveShape::Cylinder { r_top: 0.2, r_bot: 0.2, h: 0.05, segs: 10 },
        PartMaterialDesc::standard(C_STEEL, C_ARCANE, 0.25),
        [0.0, 0.33, 0.0],
        [0.0, 0.0, 0.0],
        Some("top"),
    );
    gp.add(
        PrimitiveShape::Cone { r: 0.12, h: 0.26, segs: 3 },
        PartMaterialDesc::standard(C_GOLD, C_GOLD, 0.8),
        [0.3, 0.07, 0.0],
        [0.0, 0.0, -PI / 2.0],
        Some("chevron"),
    );
    gp
}

pub fn build_ramp(dir_x: f32, dir_z: f32) -> PartMeshGroup {
    let mut gp = PartMeshGroup::new(PinballPartKind::Ramp);
    gp.yaw = yaw_for(dir_x, dir_z);
    let len: f32 = 0.86;
    let h: f32 = 0.34;
    let w: f32 = 0.56;
    let slope: f32 = (h / len).atan();

    gp.add(
        PrimitiveShape::ExtrudedWedge { len, h, w },
        PartMaterialDesc::standard(C_STEEL_DK, 0, 0.0),
        [0.0, 0.0, 0.0],
        [0.0, 0.0, 0.0],
        Some("wedge"),
    );
    for zside in [-1.0, 1.0] {
        gp.add(
            PrimitiveShape::Box { w: len * 1.02, h: 0.12, d: 0.06 },
            PartMaterialDesc::standard(C_STEEL, C_GOLD, 0.28),
            [0.0, h / 2.0 + 0.05, (zside * w) / 2.0],
            [0.0, 0.0, slope],
            Some("rail"),
        );
    }
    for k in 0..3 {
        let x = -0.24 + (k as f32) * 0.24;
        let y = (h * (x + len / 2.0)) / len + 0.06;
        gp.add(
            PrimitiveShape::Cone { r: 0.17, h: 0.32, segs: 3 },
            PartMaterialDesc::own(C_ARCANE, C_ARCANE, 0.8),
            [x, y, 0.0],
            [0.0, 0.0, -PI / 2.0 + slope],
            Some("chevron"),
        );
    }
    gp.add(
        PrimitiveShape::Box { w: 0.1, h: 0.14, d: w + 0.06 },
        PartMaterialDesc::own(C_GOLD, C_GOLD, 0.7),
        [len / 2.0 - 0.02, h + 0.02, 0.0],
        [0.0, 0.0, 0.0],
        Some("lip"),
    );
    gp
}

pub fn build_booster(dir_x: f32, dir_z: f32) -> PartMeshGroup {
    let mut gp = PartMeshGroup::new(PinballPartKind::Booster);
    gp.yaw = yaw_for(dir_x, dir_z);
    let len = 0.9;
    let w = 0.56;
    gp.add(
        PrimitiveShape::Box { w: len, h: 0.05, d: w },
        PartMaterialDesc::standard(0x1a1f2b, 0, 0.0),
        [0.0, 0.025, 0.0],
        [0.0, 0.0, 0.0],
        Some("plate"),
    );
    for zside in [-1.0, 1.0] {
        gp.add(
            PrimitiveShape::Box { w: len, h: 0.06, d: 0.06 },
            PartMaterialDesc::own(C_ARCANE, C_ARCANE, 0.8),
            [0.0, 0.06, (zside * (w - 0.06)) / 2.0],
            [0.0, 0.0, 0.0],
            Some("strip"),
        );
    }
    for k in 0..3 {
        gp.add(
            PrimitiveShape::Cone { r: 0.16, h: 0.34, segs: 3 },
            PartMaterialDesc::own(C_GOLD, C_GOLD, 0.9),
            [-0.26 + (k as f32) * 0.26, 0.075, 0.0],
            [0.0, 0.0, -PI / 2.0],
            Some("chevron"),
        );
    }
    gp
}

pub fn build_deflector(d1: (f32, f32), d2: (f32, f32)) -> PartMeshGroup {
    let mut gp = PartMeshGroup::new(PinballPartKind::Deflector);
    let bx = -(d1.0 + d2.0);
    let bz = -(d1.1 + d2.1);
    gp.yaw = yaw_for(bx, bz) - PI / 4.0;
    gp.add(
        PrimitiveShape::Torus { r: 0.62, tube: 0.07, radial_segs: 8, tubular_segs: 14, arc: PI / 2.0 },
        PartMaterialDesc::standard(C_STEEL_DK, 0, 0.0),
        [0.0, 0.3, 0.0],
        [-PI / 2.0, 0.0, 0.0],
        Some("rail"),
    );
    gp.add(
        PrimitiveShape::Torus { r: 0.62, tube: 0.035, radial_segs: 6, tubular_segs: 14, arc: PI / 2.0 },
        PartMaterialDesc::own(C_GOLD, C_GOLD, 0.6),
        [0.0, 0.44, 0.0],
        [-PI / 2.0, 0.0, 0.0],
        Some("edge"),
    );
    gp.add(
        PrimitiveShape::Cylinder { r_top: 0.5, r_bot: 0.56, h: 0.4, segs: 10 },
        PartMaterialDesc::standard(C_STEEL_DK, 0, 0.0),
        [0.0, 0.2, 0.0],
        [0.0, 0.0, 0.0],
        Some("wedge"),
    );
    gp
}

pub fn build_slingshot(dx: f32, dz: f32) -> PartMeshGroup {
    let mut gp = PartMeshGroup::new(PinballPartKind::Slingshot);
    gp.yaw = yaw_for(dx, dz);
    gp.add(
        PrimitiveShape::Box { w: 0.12, h: 0.24, d: 0.64 },
        PartMaterialDesc::standard(C_STEEL_DK, 0, 0.0),
        [0.0, 0.12, 0.0],
        [0.0, 0.0, 0.0],
        Some("body"),
    );
    gp.add(
        PrimitiveShape::Box { w: 0.06, h: 0.18, d: 0.6 },
        PartMaterialDesc::own(C_ARCANE, C_ARCANE, 0.85),
        [0.04, 0.14, 0.0],
        [0.0, 0.0, 0.0],
        Some("band"),
    );
    gp
}

pub fn build_flipper(left: bool) -> PartMeshGroup {
    let mut gp = PartMeshGroup::new(PinballPartKind::Flipper);
    let sign = if left { 1.0 } else { -1.0 };
    gp.add(
        PrimitiveShape::Cylinder { r_top: 0.14, r_bot: 0.14, h: 0.18, segs: 12 },
        PartMaterialDesc::standard(C_STEEL_DK, 0, 0.0),
        [0.0, 0.09, 0.0],
        [0.0, 0.0, 0.0],
        Some("pivot"),
    );
    gp.add(
        PrimitiveShape::Box { w: 0.64, h: 0.16, d: 0.18 },
        PartMaterialDesc::own(C_GOLD, C_GOLD, 0.7),
        [0.32 * sign, 0.09, 0.0],
        [0.0, 0.0, 0.0],
        Some("bat"),
    );
    gp
}

pub fn build_spinner(dx: f32, dz: f32) -> PartMeshGroup {
    let mut gp = PartMeshGroup::new(PinballPartKind::Spinner);
    gp.yaw = yaw_for(dx, dz);
    gp.add(
        PrimitiveShape::Box { w: 0.08, h: 0.44, d: 0.54 },
        PartMaterialDesc::standard(C_STEEL_DK, 0, 0.0),
        [0.0, 0.22, 0.0],
        [0.0, 0.0, 0.0],
        Some("frame"),
    );
    gp.add(
        PrimitiveShape::Box { w: 0.02, h: 0.28, d: 0.42 },
        PartMaterialDesc::own(C_SHOT, C_SHOT, 0.8),
        [0.0, 0.22, 0.0],
        [0.0, 0.0, 0.0],
        Some("blade"),
    );
    gp
}

pub fn build_drop_target() -> PartMeshGroup {
    let mut gp = PartMeshGroup::new(PinballPartKind::DropTarget);
    gp.add(
        PrimitiveShape::Box { w: 0.08, h: 0.32, d: 0.32 },
        PartMaterialDesc::own(C_GOLD, C_GOLD, 0.8),
        [0.0, 0.16, 0.0],
        [0.0, 0.0, 0.0],
        Some("target"),
    );
    gp
}

pub fn build_rollover() -> PartMeshGroup {
    let mut gp = PartMeshGroup::new(PinballPartKind::Rollover);
    gp.add(
        PrimitiveShape::Ring { r_in: 0.12, r_out: 0.22, segs: 12, theta_len: PI * 2.0 },
        PartMaterialDesc::own(C_ARCANE, C_ARCANE, 0.7),
        [0.0, 0.015, 0.0],
        [-PI / 2.0, 0.0, 0.0],
        Some("button"),
    );
    gp
}

pub fn build_glove(dir_x: f32, dir_z: f32) -> PartMeshGroup {
    let mut gp = PartMeshGroup::new(PinballPartKind::Glove);
    gp.yaw = yaw_for(dir_x, dir_z);
    gp.add(
        PrimitiveShape::Box { w: 0.1, h: 0.5, d: 0.5 },
        PartMaterialDesc::standard(C_STEEL_DK, 0, 0.0),
        [-0.42, 0.35, 0.0],
        [0.0, 0.0, 0.0],
        Some("plate"),
    );
    gp.add(
        PrimitiveShape::Cylinder { r_top: 0.05, r_bot: 0.05, h: 0.36, segs: 8 },
        PartMaterialDesc::standard(C_STEEL, 0, 0.0),
        [-0.2, 0.35, 0.0],
        [0.0, 0.0, PI / 2.0],
        Some("arm"),
    );
    gp.add(
        PrimitiveShape::Sphere { r: 0.19, segs_w: 10, segs_h: 8, phi_len: PI * 2.0, theta_len: PI },
        PartMaterialDesc::own(0xa83244, 0xa83244, 0.35),
        [0.02, 0.35, 0.0],
        [0.0, 0.0, 0.0],
        Some("fist"),
    );
    gp
}

pub fn build_magnet() -> PartMeshGroup {
    let mut gp = PartMeshGroup::new(PinballPartKind::Magnet);
    gp.add(
        PrimitiveShape::Cylinder { r_top: 0.36, r_bot: 0.42, h: 0.06, segs: 14 },
        PartMaterialDesc::standard(C_STEEL_DK, 0, 0.0),
        [0.0, 0.03, 0.0],
        [0.0, 0.0, 0.0],
        Some("core"),
    );
    gp.add(
        PrimitiveShape::Ring { r_in: 0.2, r_out: 0.34, segs: 12, theta_len: PI * 2.0 },
        PartMaterialDesc::own(C_ARCANE, C_ARCANE, 0.9),
        [0.0, 0.04, 0.0],
        [-PI / 2.0, 0.0, 0.0],
        Some("pulse_ring"),
    );
    gp
}

pub fn build_fire_vent() -> PartMeshGroup {
    let mut gp = PartMeshGroup::new(PinballPartKind::FireVent);
    gp.add(
        PrimitiveShape::Box { w: 0.6, h: 0.08, d: 0.6 },
        PartMaterialDesc::standard(C_STEEL_DK, 0, 0.0),
        [0.0, 0.04, 0.0],
        [0.0, 0.0, 0.0],
        Some("grate"),
    );
    gp.add(
        PrimitiveShape::Cylinder { r_top: 0.22, r_bot: 0.22, h: 0.02, segs: 10 },
        PartMaterialDesc::own(C_GOLD, C_GOLD, 0.95),
        [0.0, 0.05, 0.0],
        [0.0, 0.0, 0.0],
        Some("nozzle"),
    );
    gp
}

pub fn build_spikes() -> PartMeshGroup {
    let mut gp = PartMeshGroup::new(PinballPartKind::Spikes);
    gp.add(
        PrimitiveShape::Box { w: 0.58, h: 0.04, d: 0.58 },
        PartMaterialDesc::standard(C_STEEL_DK, 0, 0.0),
        [0.0, 0.02, 0.0],
        [0.0, 0.0, 0.0],
        Some("base"),
    );
    for ox in [-0.16, 0.16] {
        for oz in [-0.16, 0.16] {
            gp.add(
                PrimitiveShape::Cone { r: 0.08, h: 0.36, segs: 4 },
                PartMaterialDesc::own(C_STEEL, C_SHOT, 0.4),
                [ox, 0.18, oz],
                [0.0, 0.0, 0.0],
                Some("spike"),
            );
        }
    }
    gp
}

pub fn build_warp_portal() -> PartMeshGroup {
    let mut gp = PartMeshGroup::new(PinballPartKind::WarpPortal);
    gp.add(
        PrimitiveShape::Torus { r: 0.38, tube: 0.06, radial_segs: 8, tubular_segs: 16, arc: PI * 2.0 },
        PartMaterialDesc::own(C_ARCANE, C_ARCANE, 0.95),
        [0.0, 0.12, 0.0],
        [PI / 2.0, 0.0, 0.0],
        Some("vortex"),
    );
    gp
}

pub fn build_bell() -> PartMeshGroup {
    let mut gp = PartMeshGroup::new(PinballPartKind::Bell);
    gp.add(
        PrimitiveShape::Cylinder { r_top: 0.08, r_bot: 0.28, h: 0.42, segs: 12 },
        PartMaterialDesc::own(C_GOLD, C_GOLD, 0.8),
        [0.0, 0.36, 0.0],
        [0.0, 0.0, 0.0],
        Some("chime"),
    );
    gp
}

// ── Generic Builder Dispatcher ──

pub fn build_part_visual(kind: PinballPartKind, dir: (f32, f32)) -> PartMeshGroup {
    match kind {
        PinballPartKind::Bumper => build_bumper(),
        PinballPartKind::Spring => build_spring(dir.0, dir.1),
        PinballPartKind::Ramp => build_ramp(dir.0, dir.1),
        PinballPartKind::Booster => build_booster(dir.0, dir.1),
        PinballPartKind::BoostCorner => build_deflector((dir.0, dir.1), (-dir.1, dir.0)),
        PinballPartKind::BoostCurve => build_booster(dir.0, dir.1),
        PinballPartKind::JumpPad => build_ramp(dir.0, dir.1),
        PinballPartKind::Deflector => build_deflector((dir.0, dir.1), (-dir.1, dir.0)),
        PinballPartKind::Slingshot => build_slingshot(dir.0, dir.1),
        PinballPartKind::Spinner => build_spinner(dir.0, dir.1),
        PinballPartKind::Flipper => build_flipper(true),
        PinballPartKind::Rollover => build_rollover(),
        PinballPartKind::DropTarget => build_drop_target(),
        PinballPartKind::Plunger => build_spring(dir.0, dir.1),
        PinballPartKind::Magnet => build_magnet(),
        PinballPartKind::WarpPortal => build_warp_portal(),
        PinballPartKind::Spikes => build_spikes(),
        PinballPartKind::FireVent => build_fire_vent(),
        PinballPartKind::ToxicDrain => build_magnet(),
        PinballPartKind::ElectricGate => build_deflector((dir.0, dir.1), (-dir.1, dir.0)),
        PinballPartKind::Glove => build_glove(dir.0, dir.1),
        PinballPartKind::Gravepit => build_warp_portal(),
        PinballPartKind::Bell => build_bell(),
        PinballPartKind::Chute => build_booster(dir.0, dir.1),
        PinballPartKind::Orbit => build_deflector((dir.0, dir.1), (-dir.1, dir.0)),
        PinballPartKind::Saucer => build_rollover(),
        PinballPartKind::Turret => build_bumper(),
    }
}

// ── Animation State & Tickers ──

#[derive(Clone, Debug, PartialEq)]
pub struct PartAnimationState {
    pub kind: PinballPartKind,
    pub x: f32,
    pub z: f32,
    pub hit_t: f32,
    pub cooldown_t: f32,
    pub phase: f32,
    pub scale_punch: f32,
    pub emissive_mult: f32,
    pub rot_angle: f32,
    pub translation_offset: [f32; 3],
}

impl PartAnimationState {
    pub fn new(kind: PinballPartKind, x: f32, z: f32) -> Self {
        Self {
            kind,
            x,
            z,
            hit_t: 0.0,
            cooldown_t: 0.0,
            phase: 0.0,
            scale_punch: 1.0,
            emissive_mult: 1.0,
            rot_angle: 0.0,
            translation_offset: [0.0, 0.0, 0.0],
        }
    }

    pub fn trigger_hit(&mut self) {
        self.hit_t = 0.25;
        self.scale_punch = 1.35;
        self.emissive_mult = 2.0;
    }

    pub fn tick(&mut self, dt: f32) {
        self.phase += dt;
        if self.hit_t > 0.0 {
            self.hit_t = (self.hit_t - dt).max(0.0);
            let p = self.hit_t / 0.25;
            self.scale_punch = 1.0 + 0.35 * p;
            self.emissive_mult = 1.0 + 1.0 * p;
        } else {
            self.scale_punch = 1.0;
            self.emissive_mult = 1.0 + 0.15 * (self.phase * 3.0).sin();
        }

        match self.kind {
            PinballPartKind::Bumper => {
                // Dome breathing
                self.emissive_mult = if self.hit_t > 0.0 { 2.5 } else { 1.0 + 0.2 * (self.phase * 4.0).sin() };
            }
            PinballPartKind::Spring => {
                // Boing squash and overshoot
                if self.hit_t > 0.0 {
                    let boing = (self.hit_t * 20.0).sin() * (self.hit_t / 0.25);
                    self.translation_offset[1] = boing * 0.12;
                } else {
                    self.translation_offset[1] = 0.0;
                }
            }
            PinballPartKind::Spinner => {
                if self.hit_t > 0.0 {
                    self.rot_angle += dt * 30.0;
                }
            }
            PinballPartKind::Flipper => {
                if self.hit_t > 0.0 {
                    self.rot_angle = FLIPPER_SWING * (self.hit_t / 0.25);
                } else {
                    self.rot_angle = 0.0;
                }
            }
            _ => {}
        }
    }
}

pub fn update_pinball_parts(parts: &mut [PartAnimationState], dt: f32, camera_pos: (f32, f32)) {
    for part in parts.iter_mut() {
        let dx = part.x - camera_pos.0;
        let dz = part.z - camera_pos.1;
        if dx * dx + dz * dz <= PART_ANIM_RANGE_SQ {
            part.tick(dt);
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct PartBuildCtx {
    pub dir_x: f32,
    pub dir_z: f32,
}

pub fn spawn_pinball_part(kind: PinballPartKind, x: f32, z: f32) -> PartAnimationState {
    PartAnimationState::new(kind, x, z)
}

pub fn create_pinball_parts(spots: &[(PinballPartKind, f32, f32)]) -> Vec<PartAnimationState> {
    spots.iter().map(|&(k, x, z)| spawn_pinball_part(k, x, z)).collect()
}

pub fn update_plunger_rig() {}

pub fn dispose_pinball_parts() {}

pub const PART_HIT_LIFETIME: [(PinballPartKind, f32); 4] = [
    (PinballPartKind::Bumper, 0.25),
    (PinballPartKind::Spring, 0.35),
    (PinballPartKind::Flipper, 0.25),
    (PinballPartKind::Slingshot, 0.2),
];

pub const PART_BUILDERS: [PinballPartKind; 27] = [
    PinballPartKind::Bumper,
    PinballPartKind::Spring,
    PinballPartKind::Ramp,
    PinballPartKind::Booster,
    PinballPartKind::BoostCorner,
    PinballPartKind::BoostCurve,
    PinballPartKind::JumpPad,
    PinballPartKind::Deflector,
    PinballPartKind::Slingshot,
    PinballPartKind::Spinner,
    PinballPartKind::Flipper,
    PinballPartKind::Rollover,
    PinballPartKind::DropTarget,
    PinballPartKind::Plunger,
    PinballPartKind::Magnet,
    PinballPartKind::WarpPortal,
    PinballPartKind::Spikes,
    PinballPartKind::FireVent,
    PinballPartKind::ToxicDrain,
    PinballPartKind::ElectricGate,
    PinballPartKind::Glove,
    PinballPartKind::Gravepit,
    PinballPartKind::Bell,
    PinballPartKind::Chute,
    PinballPartKind::Orbit,
    PinballPartKind::Saucer,
    PinballPartKind::Turret,
];

pub const PART_ANIMATORS: [PinballPartKind; 4] = [
    PinballPartKind::Bumper,
    PinballPartKind::Spring,
    PinballPartKind::Spinner,
    PinballPartKind::Flipper,
];
