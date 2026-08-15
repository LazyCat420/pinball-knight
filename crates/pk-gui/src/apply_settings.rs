//! Live Settings Dispatch Bridge — Synchronizes persisted settings onto runtime audio gates and pixel pass shader flags.
//!
//! PORTS: `gui/apply-settings.ts`

#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct SettingsConfig {
    pub muted: bool,
    pub volume: f32,
    pub quantize: bool,
    pub dither: bool,
    pub scanline: bool,
    pub outline: bool,
    pub heat_shimmer: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct SettingsTarget {
    pub sfx_muted: bool,
    pub sfx_volume: f32,
    pub quantize: bool,
    pub dither: bool,
    pub scanline: bool,
    pub outline: bool,
    pub heat_shimmer: bool,
}

/// Pushes persisted settings onto the live systems.
pub fn apply_settings_live(settings: &SettingsConfig, target: &mut SettingsTarget) {
    target.sfx_muted = settings.muted;
    target.sfx_volume = settings.volume;
    target.quantize = settings.quantize;
    target.dither = settings.dither;
    target.scanline = settings.scanline;
    target.outline = settings.outline;
    target.heat_shimmer = settings.heat_shimmer;
}
