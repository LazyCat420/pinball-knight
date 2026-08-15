//! Orbiting Blades VFX Ring Pool — Blade Storm orbiting crescent blades with keep-alive state tracking.
//!
//! PORTS: `fx/pools/blade-ring.ts`

use std::f32::consts::PI;

pub const BLADE_MAX: usize = 6;
pub const BLADE_HOLD: f32 = 0.12; // seconds a placed blade survives without a refresh
pub const CAMERA_YAW: f32 = PI / 4.0;
pub const CAMERA_TILT: f32 = 30.0 * (PI / 180.0);

#[derive(Clone, Debug, PartialEq)]
pub struct BladeInstance {
    pub pos: [f32; 3],
    pub rot_z: f32,
    pub rot_y: f32,
    pub rot_x: f32,
    pub color_hex: u32,
    pub opacity: f32,
    pub scale: f32,
    pub visible: bool,
}

impl BladeInstance {
    pub fn new() -> Self {
        Self {
            pos: [0.0, 0.0, 0.0],
            rot_z: 0.0,
            rot_y: CAMERA_YAW,
            rot_x: -CAMERA_TILT,
            color_hex: 0xffffff,
            opacity: 0.85,
            scale: 1.0,
            visible: false,
        }
    }
}

impl Default for BladeInstance {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct BladeRing {
    pub meshes: Vec<BladeInstance>,
    pub hold: f32,
}

impl BladeRing {
    pub fn new() -> Self {
        let mut meshes = Vec::with_capacity(BLADE_MAX);
        for _ in 0..BLADE_MAX {
            meshes.push(BladeInstance::new());
        }
        Self { meshes, hold: 0.0 }
    }

    /// Positions orbiting blades around actor position for this frame and arms hold timer.
    pub fn refresh(
        &mut self,
        pos: [f32; 3],
        angle: f32,
        count: usize,
        radius: f32,
        color_hex: u32,
        mut rng: impl FnMut() -> f32,
    ) {
        self.hold = BLADE_HOLD;
        let n = count.min(BLADE_MAX);

        for i in 0..BLADE_MAX {
            let m = &mut self.meshes[i];
            if i >= n {
                m.visible = false;
                continue;
            }

            let a = angle + (i as f32 / n as f32) * PI * 2.0;
            m.pos = [
                pos[0] + a.cos() * radius,
                pos[1],
                pos[2] + a.sin() * radius,
            ];

            // Lean crescent along orbit tangent, then billboard to iso camera
            m.rot_z = -a - PI / 2.0;
            m.rot_y = CAMERA_YAW;
            m.rot_x = -CAMERA_TILT;

            m.color_hex = color_hex;
            m.opacity = 0.7 + rng() * 0.3;
            m.scale = 0.9 + rng() * 0.2;
            m.visible = true;
        }
    }

    /// Ticks down keep-alive hold timer and hides blades on buff expiration.
    pub fn update(&mut self, dt: f32) {
        if self.hold <= 0.0 {
            return;
        }
        self.hold -= dt;
        if self.hold <= 0.0 {
            for m in self.meshes.iter_mut() {
                m.visible = false;
            }
        }
    }

    /// Total count of currently visible blades.
    pub fn active_count(&self) -> usize {
        self.meshes.iter().filter(|m| m.visible).count()
    }
}

impl Default for BladeRing {
    fn default() -> Self {
        Self::new()
    }
}
