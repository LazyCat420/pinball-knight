//! SPRITE ATLAS & BILLBOARDING ENGINE — Cel-painted single-texture horizontal strip atlases and quad billboarding.
//!
//! Billboards sprites around bottom-center foot origins with fixed isometric camera tilt or dynamic FPS yaw tracking.
//!
//! PORTS-PARTIAL: `engine/render/sprite.ts` - NOT a finished port - 66 rust code lines against 757 legacy (9%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

#[derive(Clone, Debug, PartialEq)]
pub struct SpriteQuad {
    pub width: f32,
    pub height: f32,
}

impl Default for SpriteQuad {
    fn default() -> Self {
        Self {
            width: 1.0,
            height: 1.0,
        }
    }
}

impl SpriteQuad {
    pub fn new(width: f32, height: f32) -> Self {
        Self { width, height }
    }

    /// Generates bottom-center origin quad vertices: bottom-left, bottom-right, top-right, top-left.
    pub fn vertices(&self) -> [[f32; 3]; 4] {
        let hw = self.width * 0.5;
        [
            [-hw, 0.0, 0.0],
            [hw, 0.0, 0.0],
            [hw, self.height, 0.0],
            [-hw, self.height, 0.0],
        ]
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct SpriteSheetAtlas {
    pub total_frames: usize,
}

impl SpriteSheetAtlas {
    pub fn new(total_frames: usize) -> Self {
        Self {
            total_frames: 1.max(total_frames),
        }
    }

    /// Computes horizontal UV coordinate bounds (u0, u1) for the requested frame index.
    pub fn frame_uv_bounds(&self, frame_idx: usize) -> (f32, f32) {
        let idx = frame_idx % self.total_frames;
        let u0 = idx as f32 / self.total_frames as f32;
        let u1 = (idx + 1) as f32 / self.total_frames as f32;
        (u0, u1)
    }
}

/// Computes static isometric camera tilt orientation (rotation order YXZ).
pub fn face_camera(camera_yaw: f32, camera_tilt: f32) -> [f32; 3] {
    [-camera_tilt, camera_yaw, 0.0]
}

/// Computes upright yaw angle facing toward a ground camera position.
pub fn face_camera_yaw(actor_pos: (f32, f32), cam_pos: (f32, f32)) -> f32 {
    let dx = cam_pos.0 - actor_pos.0;
    let dz = cam_pos.1 - actor_pos.1;
    dx.atan2(dz)
}
