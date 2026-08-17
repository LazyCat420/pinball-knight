//! Isometric orthographic camera projections, coordinate transforms, and tracking math.
//!
//! PORTS-PARTIAL: `engine/camera.ts` - NOT a finished port - 3 of 10 exported names carried over (30%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

use std::f64::consts::FRAC_PI_4;

pub const ISO_TILT: f64 = 0.6154797086703873; // True isometric tilt: atan(1 / sqrt(2)) ~35.264°
pub const ISO_YAW: f64 = FRAC_PI_4; // 45.0°
pub const CAMERA_DIST: f64 = 50.0;
pub const ORTHO_SCALE: f64 = 16.0; // 16 pixels per world unit

#[derive(Debug, Clone, PartialEq)]
pub struct CameraConfig {
    pub tilt: f64,
    pub yaw: f64,
    pub dist: f64,
    pub view_w: f64,
    pub view_h: f64,
    pub ortho_scale: f64,
}

impl Default for CameraConfig {
    fn default() -> Self {
        Self {
            tilt: ISO_TILT,
            yaw: ISO_YAW,
            dist: CAMERA_DIST,
            view_w: 40.0,
            view_h: 22.5,
            ortho_scale: ORTHO_SCALE,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct IsoCamera {
    pub config: CameraConfig,
    pub current_x: f64,
    pub current_z: f64,
    pub lead_x: f64,
    pub lead_z: f64,
    pub shake_x: f64,
    pub shake_y: f64,
}

impl Default for IsoCamera {
    fn default() -> Self {
        Self::new(CameraConfig::default())
    }
}

impl IsoCamera {
    pub fn new(config: CameraConfig) -> Self {
        Self {
            config,
            current_x: 0.0,
            current_z: 0.0,
            lead_x: 0.0,
            lead_z: 0.0,
            shake_x: 0.0,
            shake_y: 0.0,
        }
    }

    /// Computes world 3D eye position offset for isometric rendering.
    pub fn eye_offset(&self) -> (f64, f64, f64) {
        let horiz = self.config.tilt.cos() * self.config.dist;
        let ex = self.config.yaw.sin() * horiz;
        let ey = self.config.tilt.sin() * self.config.dist;
        let ez = self.config.yaw.cos() * horiz;
        (ex, ey, ez)
    }
}

/// Converts a 2D screen direction vector (e.g. keyboard WASD) to a world XZ direction vector.
pub fn screen_dir_to_world(sx: f64, sz: f64, yaw: f64) -> (f64, f64) {
    let cos = yaw.cos();
    let sin = yaw.sin();
    // Screen Up is -Z in world under isometric yaw
    let wx = sx * cos - sz * (-sin);
    let wz = sx * (-sin) - sz * (-cos);
    (wx, wz)
}

/// Converts a world XZ direction vector to a 2D screen direction vector.
pub fn world_dir_to_screen(wx: f64, wz: f64, yaw: f64) -> (f64, f64) {
    let cos = yaw.cos();
    let sin = yaw.sin();
    let sx = wx * cos - wz * sin;
    let sz = wx * sin + wz * cos;
    (sx, sz)
}

/// Projects a 3D world coordinate to 2D viewport pixel coordinates (center-origin or top-left origin).
pub fn world_to_screen_px(
    cam: &IsoCamera,
    wx: f64,
    wy: f64,
    wz: f64,
    vp_w: f64,
    vp_h: f64,
) -> (f64, f64) {
    let dx = wx - (cam.current_x + cam.lead_x);
    let dz = wz - (cam.current_z + cam.lead_z);

    // Rotate into camera basis (yaw 45°)
    let (cam_space_x, cam_space_z) = world_dir_to_screen(dx, dz, cam.config.yaw);

    // Apply tilt compression on the vertical axis (isometric diamond)
    let proj_x = cam_space_x;
    let proj_y = wy * cam.config.tilt.cos() - cam_space_z * cam.config.tilt.sin();

    // Scale to viewport pixels
    let px = (vp_w * 0.5) + (proj_x * cam.config.ortho_scale) + cam.shake_x;
    let py = (vp_h * 0.5) - (proj_y * cam.config.ortho_scale) + cam.shake_y;

    (px, py)
}

/// Unprojects 2D screen pixel coordinates to the 3D ground plane (y = 0.0).
pub fn screen_px_to_world_ground(
    cam: &IsoCamera,
    px: f64,
    py: f64,
    vp_w: f64,
    vp_h: f64,
) -> (f64, f64) {
    let unproject_x = (px - (vp_w * 0.5) - cam.shake_x) / cam.config.ortho_scale;
    let unproject_y = ((vp_h * 0.5) - py + cam.shake_y) / cam.config.ortho_scale;

    let cam_space_x = unproject_x;
    let cam_space_z = -unproject_y / cam.config.tilt.sin();

    let (dx, dz) = screen_dir_to_world(cam_space_x, cam_space_z, cam.config.yaw);

    (cam.current_x + cam.lead_x + dx, cam.current_z + cam.lead_z + dz)
}

/// Steps smooth camera damping towards target with velocity-based lookahead lead.
pub fn step_camera(
    cam: &mut IsoCamera,
    target_x: f64,
    target_z: f64,
    target_vx: f64,
    target_vz: f64,
    dt: f64,
) {
    // 1. Smooth position tracking (exponential lerp)
    let follow_speed = 8.0;
    let t = (1.0 - (-follow_speed * dt).exp()).clamp(0.0, 1.0);
    cam.current_x += (target_x - cam.current_x) * t;
    cam.current_z += (target_z - cam.current_z) * t;

    // 2. Velocity lookahead lead
    let target_lead_x = target_vx * 0.3;
    let target_lead_z = target_vz * 0.3;
    let lead_speed = 4.0;
    let lt = (1.0 - (-lead_speed * dt).exp()).clamp(0.0, 1.0);
    cam.lead_x += (target_lead_x - cam.lead_x) * lt;
    cam.lead_z += (target_lead_z - cam.lead_z) * lt;
}
