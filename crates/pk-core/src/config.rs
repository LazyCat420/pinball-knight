//! Engine Configuration & Global Settings.
//!
//! PORTS: `engine/config.ts`

use std::sync::Mutex;

#[derive(Debug, Clone, PartialEq)]
pub struct CameraConfig {
    pub tilt: f64,
    pub yaw: f64,
    pub dist: f64,
    pub ppu: f64,
    pub zoom: f64,
}

impl Default for CameraConfig {
    fn default() -> Self {
        Self {
            tilt: 0.6154797,
            yaw: std::f64::consts::FRAC_PI_4,
            dist: 50.0,
            ppu: 32.0,
            zoom: 1.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct JuiceConfig {
    pub shake_mult: f64,
    pub hitstop_mult: f64,
    pub freeze_mult: f64,
}

impl Default for JuiceConfig {
    fn default() -> Self {
        Self {
            shake_mult: 1.0,
            hitstop_mult: 1.0,
            freeze_mult: 1.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SpriteConfig {
    pub units: f64,
    pub px: f64,
    pub quad_w: f64,
    pub quad_h: f64,
}

impl Default for SpriteConfig {
    fn default() -> Self {
        Self {
            units: 1.5,
            px: 64.0,
            quad_w: 1.5,
            quad_h: 1.5,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PostConfig {
    pub bloom: bool,
    pub scanlines: bool,
    pub vignette: f64,
    pub dither: bool,
}

impl Default for PostConfig {
    fn default() -> Self {
        Self {
            bloom: true,
            scanlines: true,
            vignette: 0.25,
            dither: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AnimConfig {
    pub fps: f64,
    pub walk_cycle_rate: f64,
}

impl Default for AnimConfig {
    fn default() -> Self {
        Self {
            fps: 12.0,
            walk_cycle_rate: 1.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct EngineConfig {
    pub fixed_timestep_hz: u32,
    pub max_substeps: u32,
    pub pixel_scale: u32,
    pub camera: CameraConfig,
    pub juice: JuiceConfig,
    pub sprite: SpriteConfig,
    pub post: PostConfig,
    pub anim: AnimConfig,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            fixed_timestep_hz: 60,
            max_substeps: 5,
            pixel_scale: 2,
            camera: CameraConfig::default(),
            juice: JuiceConfig::default(),
            sprite: SpriteConfig::default(),
            post: PostConfig::default(),
            anim: AnimConfig::default(),
        }
    }
}

impl EngineConfig {
    pub fn fixed_dt(&self) -> f64 {
        1.0 / (self.fixed_timestep_hz as f64)
    }
}

static ENGINE_CONFIG: Mutex<Option<EngineConfig>> = Mutex::new(None);

pub fn on_config_change(_fn: fn()) {}

pub fn configure_engine(cfg: EngineConfig) {
    if let Ok(mut lock) = ENGINE_CONFIG.lock() {
        *lock = Some(cfg);
    }
}

pub fn get_engine_config() -> EngineConfig {
    if let Ok(lock) = ENGINE_CONFIG.lock() {
        lock.clone().unwrap_or_default()
    } else {
        EngineConfig::default()
    }
}
