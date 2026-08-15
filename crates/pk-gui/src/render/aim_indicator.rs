//! Pinball Ground Aim Indicator — Heading, Steer, and Bend readout on the arena floor.
//!
//! PORTS: `render/aim-indicator.ts`

pub const MIN_ROLL_SPEED: f64 = 0.5;

#[derive(Clone, Debug, PartialEq)]
pub struct AimIndicatorState {
    pub px: f64,
    pub pz: f64,
    pub heading_angle: f64,
    pub steer_angle: Option<f64>,
    pub bend_fraction: f64,
    pub scale: f64,
    pub visible: bool,
}

impl Default for AimIndicatorState {
    fn default() -> Self {
        Self {
            px: 0.0,
            pz: 0.0,
            heading_angle: 0.0,
            steer_angle: None,
            bend_fraction: 0.0,
            scale: 1.0,
            visible: false,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct AimIndicatorVisual {
    pub state: AimIndicatorState,
}

impl AimIndicatorVisual {
    pub fn new() -> Self {
        Self::default()
    }

    /// Updates the aim indicator orientation, scale, and bend from momentum and steer input.
    pub fn update(
        &mut self,
        px: f64,
        pz: f64,
        mom_x: f64,
        mom_z: f64,
        steer: Option<(f64, f64)>,
        speed: f64,
        max_speed: f64,
    ) {
        if speed < MIN_ROLL_SPEED {
            self.hide();
            return;
        }

        let heading = mom_z.atan2(mom_x);
        let speed_ratio = (speed / max_speed.max(1.0)).clamp(0.2, 1.0);

        let (steer_ang, bend) = if let Some((sx, sz)) = steer {
            let sa = sz.atan2(sx);
            // Angular difference normalized to [-PI, PI]
            let mut diff = sa - heading;
            while diff < -std::f64::consts::PI {
                diff += 2.0 * std::f64::consts::PI;
            }
            while diff > std::f64::consts::PI {
                diff -= 2.0 * std::f64::consts::PI;
            }
            let bf = (diff.abs() / std::f64::consts::PI).clamp(0.0, 1.0);
            (Some(sa), bf)
        } else {
            (None, 0.0)
        };

        self.state = AimIndicatorState {
            px,
            pz,
            heading_angle: heading,
            steer_angle: steer_ang,
            bend_fraction: bend,
            scale: speed_ratio,
            visible: true,
        };
    }

    /// Hides the aim indicator (e.g. when walking or in menu).
    pub fn hide(&mut self) {
        self.state.visible = false;
    }

    pub fn is_visible(&self) -> bool {
        self.state.visible
    }
}
