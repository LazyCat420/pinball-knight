//! Player Settings Persistence — Saved dungeon options, volume, post-fx, and camera zoom.
//!
//! PORTS: `settings-save.ts`

use serde::{Deserialize, Serialize};

pub const SETTINGS_KEY: &str = "pk_settings_v1";

pub const QUANTIZE_DEFAULT: bool = true;
pub const DITHER_DEFAULT: bool = true;
pub const SCANLINE_DEFAULT: bool = false;
pub const OUTLINE_DEFAULT: bool = false;
pub const HEAT_DEFAULT: bool = true;
pub const CAMERA_ZOOM_DEFAULT: f32 = 1.0;
pub const VOLUME_STEPS: usize = 20;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DungeonSettings {
    #[serde(default)]
    pub muted: bool,
    #[serde(default = "default_volume")]
    pub volume: f32,
    #[serde(default = "default_heat")]
    pub heat: bool,
    #[serde(default = "default_quantize")]
    pub quantize: bool,
    #[serde(default = "default_dither")]
    pub dither: bool,
    #[serde(default)]
    pub scanlines: bool,
    #[serde(default)]
    pub outlines: bool,
    #[serde(default = "default_camera_zoom")]
    pub camera_zoom: f32,
    #[serde(default)]
    pub speedrun: bool,
    #[serde(default)]
    pub haul_reveal: bool,
}

fn default_volume() -> f32 {
    1.0
}
fn default_heat() -> bool {
    HEAT_DEFAULT
}
fn default_quantize() -> bool {
    QUANTIZE_DEFAULT
}
fn default_dither() -> bool {
    DITHER_DEFAULT
}
fn default_camera_zoom() -> f32 {
    CAMERA_ZOOM_DEFAULT
}

impl Default for DungeonSettings {
    fn default() -> Self {
        Self {
            muted: false,
            volume: 1.0,
            heat: HEAT_DEFAULT,
            quantize: QUANTIZE_DEFAULT,
            dither: DITHER_DEFAULT,
            scanlines: SCANLINE_DEFAULT,
            outlines: OUTLINE_DEFAULT,
            camera_zoom: CAMERA_ZOOM_DEFAULT,
            speedrun: false,
            haul_reveal: false,
        }
    }
}

impl DungeonSettings {
    pub fn new() -> Self {
        Self::default()
    }

    /// Snaps volume to the nearest discrete step.
    pub fn snap_volume(&mut self, vol: f32) {
        let clamped = vol.clamp(0.0, 1.0);
        let step = (clamped * VOLUME_STEPS as f32).round() / VOLUME_STEPS as f32;
        self.volume = step;
    }

    pub fn serialize_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }

    pub fn deserialize_json(json_str: &str) -> Self {
        serde_json::from_str(json_str).unwrap_or_default()
    }
}
