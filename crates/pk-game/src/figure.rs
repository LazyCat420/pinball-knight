//! Procedural Knight and Monster Figure Skeleton and Palette Shader.
//!
//! PORTS: `engine/render/figure.ts`

pub const TEXEL: f64 = 1.0;
pub const GROUND: f64 = 118.0;
pub const CX: f64 = 64.0;

pub type Ramp = [u8; 3];
pub type Pt = (f64, f64);

pub const R_STEEL: Ramp = [19, 20, 21];
pub const R_STEEL_DK: Ramp = [19, 19, 20];
pub const R_LEATHER: Ramp = [26, 27, 28];
pub const R_BLOOD: Ramp = [11, 12, 13];
pub const R_BONE: Ramp = [20, 21, 22];
pub const R_SKIN: Ramp = [23, 24, 25];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum Dir3 {
    #[default]
    S,
    N,
    E,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Pose {
    pub root_x: f64,
    pub root_y: f64,
    pub tilt: f64,
    pub leg_l_phase: f64,
    pub leg_r_phase: f64,
    pub arm_l_phase: f64,
    pub arm_r_phase: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RigConfig {
    pub hip_w: f64,
    pub shoulder_w: f64,
    pub leg_len: f64,
    pub arm_len: f64,
    pub head_radius: f64,
}

impl Default for RigConfig {
    fn default() -> Self {
        Self {
            hip_w: 12.0,
            shoulder_w: 16.0,
            leg_len: 20.0,
            arm_len: 18.0,
            head_radius: 10.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Skeleton {
    pub hip_l: Pt,
    pub hip_r: Pt,
    pub knee_l: Pt,
    pub knee_r: Pt,
    pub foot_l: Pt,
    pub foot_r: Pt,
    pub shoulder_l: Pt,
    pub shoulder_r: Pt,
    pub elbow_l: Pt,
    pub elbow_r: Pt,
    pub hand_l: Pt,
    pub hand_r: Pt,
    pub head_center: Pt,
}

pub fn build_skeleton(dir: Dir3, pose: &Pose, cfg: &RigConfig) -> Skeleton {
    let mut skel = Skeleton::default();
    let cx = CX + pose.root_x;
    let cy = GROUND - cfg.leg_len + pose.root_y;

    match dir {
        Dir3::S | Dir3::N => {
            skel.hip_l = (cx - cfg.hip_w * 0.5, cy);
            skel.hip_r = (cx + cfg.hip_w * 0.5, cy);
            skel.knee_l = (cx - cfg.hip_w * 0.5, cy + cfg.leg_len * 0.5);
            skel.knee_r = (cx + cfg.hip_w * 0.5, cy + cfg.leg_len * 0.5);
            skel.foot_l = (cx - cfg.hip_w * 0.5, cy + cfg.leg_len);
            skel.foot_r = (cx + cfg.hip_w * 0.5, cy + cfg.leg_len);

            let sh_y = cy - cfg.arm_len * 0.8;
            skel.shoulder_l = (cx - cfg.shoulder_w * 0.5, sh_y);
            skel.shoulder_r = (cx + cfg.shoulder_w * 0.5, sh_y);
            skel.head_center = (cx, sh_y - cfg.head_radius);
        }
        Dir3::E => {
            skel.hip_l = (cx - 2.0, cy);
            skel.hip_r = (cx + 2.0, cy);
            skel.knee_l = (cx - 2.0, cy + cfg.leg_len * 0.5);
            skel.knee_r = (cx + 2.0, cy + cfg.leg_len * 0.5);
            skel.foot_l = (cx - 2.0, cy + cfg.leg_len);
            skel.foot_r = (cx + 2.0, cy + cfg.leg_len);

            let sh_y = cy - cfg.arm_len * 0.8;
            skel.shoulder_l = (cx - 3.0, sh_y);
            skel.shoulder_r = (cx + 3.0, sh_y);
            skel.head_center = (cx, sh_y - cfg.head_radius);
        }
    }

    skel
}

pub fn limb_shaded(_a: Pt, _b: Pt, _w: f64) {}

pub fn ell_shaded(_x: f64, _y: f64, _rx: f64, _ry: f64) {}

pub fn plate_shaded(_pts: &[Pt]) {}

pub fn rrect_shaded(_x: f64, _y: f64, _w: f64, _h: f64, _r: f64) {}

pub fn detail(_pts: &[Pt], _w: f64) {}

pub fn glow(_x: f64, _y: f64, _r: f64, _core_idx: usize) {}

pub fn ground_shadow(_x: f64, _y: f64, _rx: f64) {}

pub fn leg_shaded(_hip: Pt, _knee: Pt, _foot: Pt, _w: f64, _dir: Dir3) {}

pub fn arm_shaded(_sh: Pt, _el: Pt, _hand: Pt, _w: f64) {}
