//! The mixer, category trims, mute gates, and fail-silent audio bus contract.
//!
//! PORTS: `sfx/bus.ts`

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum SfxCategory {
    Combat = 0,
    Weapons = 1,
    Pinball = 2,
    Monsters = 3,
    World = 4,
    Run = 5,
    Ambience = 6,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AudioMixerBus {
    pub sfx_muted: bool,
    pub master_muted: bool,
    pub master_volume: f32,
    pub category_trims: [f32; 7],
}

impl Default for AudioMixerBus {
    fn default() -> Self {
        Self {
            sfx_muted: false,
            master_muted: false,
            master_volume: 1.0,
            category_trims: [1.0; 7],
        }
    }
}

impl AudioMixerBus {
    pub fn new() -> Self {
        Self::default()
    }

    /// Evaluates the final effective linear volume for a given sound category.
    /// Returns 0.0 if either master or SFX layer is muted.
    pub fn effective_volume(&self, cat: SfxCategory) -> f32 {
        if self.master_muted || self.sfx_muted {
            return 0.0;
        }

        let cat_idx = cat as usize;
        let trim = self.category_trims[cat_idx];
        (self.master_volume * trim).clamp(0.0, 2.0)
    }

    /// Sets the trim multiplier for a specific category (default 1.0).
    pub fn set_category_trim(&mut self, cat: SfxCategory, trim: f32) {
        let cat_idx = cat as usize;
        self.category_trims[cat_idx] = trim.clamp(0.0, 2.0);
    }

    pub fn set_sfx_muted(&mut self, muted: bool) {
        self.sfx_muted = muted;
    }

    pub fn set_master_muted(&mut self, muted: bool) {
        self.master_muted = muted;
    }

    pub fn set_master_volume(&mut self, vol: f32) {
        self.master_volume = vol.clamp(0.0, 1.0);
    }
}
