//! Engine Configuration & Global Settings.
//!
//! PORTS-PARTIAL: `engine/config.ts` - NOT a finished port - 24 rust code lines against 147 legacy (16%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

#[derive(Debug, Clone, PartialEq)]
pub struct EngineConfig {
    pub fixed_timestep_hz: u32,
    pub max_substeps: u32,
    pub pixel_scale: u32,
    pub enable_bloom: bool,
    pub enable_scanlines: bool,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            fixed_timestep_hz: 60,
            max_substeps: 5,
            pixel_scale: 2,
            enable_bloom: true,
            enable_scanlines: true,
        }
    }
}

impl EngineConfig {
    pub fn fixed_dt(&self) -> f64 {
        1.0 / (self.fixed_timestep_hz as f64)
    }
}
