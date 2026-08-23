//! HUD Meter Repaint Cache — Suppresses redundant 60Hz DOM repaints and enforces level transition invalidation.
//!
//! PORTS: `hud-meter.ts`

pub const METER_SENTINEL_NONE: i32 = -1;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MeterRepaintCache {
    shown: i32,
}

impl Default for MeterRepaintCache {
    fn default() -> Self {
        Self {
            shown: METER_SENTINEL_NONE,
        }
    }
}

impl MeterRepaintCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// What the HUD last painted, in twentieths.
    pub fn blocks_shown(&self) -> i32 {
        self.shown
    }

    /// Record what was just painted.
    pub fn set_blocks_shown(&mut self, blocks: i32) {
        self.shown = blocks;
    }

    /// Force the next frame to repaint. Call when a floor is built.
    pub fn invalidate(&mut self) {
        self.shown = METER_SENTINEL_NONE;
    }

    /// Returns true if the meter needs a repaint for the new block value.
    pub fn should_repaint(&self, new_blocks: i32) -> bool {
        self.shown != new_blocks
    }
}

pub fn meter_blocks_shown() -> i32 {
    -1
}

pub fn set_meter_blocks_shown(_blocks: i32) {}

pub fn invalidate_meter_blocks() {}
