//! Tavern Station Focus & Lighting FX — Floor spotlight positioning, fade transitions, and accent light breathing.
//!
//! PORTS: `legacy/src/scenes/tavern/stations.ts`

#[derive(Clone, Debug, PartialEq, Default)]
pub struct StationFxState {
    pub current_station: Option<String>,
    pub fade: f32,
    pub disc_visible: bool,
    pub disc_opacity: f32,
    pub disc_pos: [f32; 3],
    pub disc_color: u32,
}

impl StationFxState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Moves the spotlight disc under the focused station or hides it when None.
    pub fn set_focus(&mut self, s: Option<(&str, [f32; 3], u32)>) {
        if let Some((id, pos, color)) = s {
            self.current_station = Some(id.to_string());
            self.disc_pos = [pos[0], 0.03, pos[2]];
            self.disc_color = color;
            self.disc_visible = true;
        } else {
            self.current_station = None;
        }
    }

    /// Ticks smooth fade transitions and breathing opacity for the spotlight disc.
    pub fn update(&mut self, dt: f32, time: f32) {
        let target = if self.current_station.is_some() {
            1.0
        } else {
            0.0
        };
        let diff = target - self.fade;
        self.fade += diff.signum() * diff.abs().min(dt * 6.0);
        self.disc_opacity = self.fade * (0.22 + (time * 4.0).sin() * 0.05);

        if self.fade <= 0.001 {
            self.disc_visible = false;
        }
    }
}

/// Computes the modulated point light intensity for a tavern station.
pub fn compute_accent_intensity(base: f32, is_focused: bool, time: f32, pos_x: f32) -> f32 {
    let freq = if is_focused { 5.0 } else { 1.6 };
    let amp = if is_focused { 0.22 } else { 0.07 };
    let boost = if is_focused { 1.5 } else { 1.0 };

    let breathe = 1.0 + (time * freq + pos_x).sin() * amp;
    base * breathe * boost
}

/// Recomputes focus from player position. Returns true if focus state actually changed.
pub fn refresh_focus(current_id: Option<&str>, next_id: Option<&str>) -> bool {
    current_id != next_id
}
