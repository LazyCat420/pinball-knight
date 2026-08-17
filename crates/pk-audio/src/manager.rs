//! GLOBAL AUDIO MANAGER — WebAudio procedural noise synthesizer and master sound gatekeeper.
//!
//! Generates procedural noise buffers (crack, hiss, land) and controls global test silence.
//!
//! PORTS-PARTIAL: `legacy/src/utils/audio-manager.ts` - NOT a finished port - 147 rust code lines against 634 legacy (23%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

#[derive(Clone, Debug, PartialEq)]
pub struct GlobalAudioManager {
    pub is_silenced: bool,
    pub sample_rate: u32,
}

impl Default for GlobalAudioManager {
    fn default() -> Self {
        Self::new(44100)
    }
}

impl GlobalAudioManager {
    pub fn new(sample_rate: u32) -> Self {
        Self {
            is_silenced: false,
            sample_rate,
        }
    }

    pub fn set_silenced(&mut self, silenced: bool) {
        self.is_silenced = silenced;
    }

    /// Generates decaying crack noise buffer for sharp impacts (0.03s).
    pub fn generate_crack_buffer(&self, seed: u32) -> Vec<f32> {
        let len = (self.sample_rate as f64 * 0.03) as usize;
        let mut buf = Vec::with_capacity(len);
        let mut state = seed.wrapping_add(0x1234_5678);

        for i in 0..len {
            state = state.wrapping_mul(1664525).wrapping_add(1013904223);
            let rand_val = ((state >> 16) as f32 / 32768.0) - 1.0;
            let decay = 1.0 - (i as f32 / len as f32);
            buf.push(rand_val * 0.5 * decay);
        }
        buf
    }

    /// Generates hiss noise buffer for sustained atmospheric textures (0.35s).
    pub fn generate_hiss_buffer(&self, seed: u32) -> Vec<f32> {
        let len = (self.sample_rate as f64 * 0.35) as usize;
        let mut buf = Vec::with_capacity(len);
        let mut state = seed.wrapping_add(0x8765_4321);

        for _ in 0..len {
            state = state.wrapping_mul(1664525).wrapping_add(1013904223);
            let rand_val = ((state >> 16) as f32 / 32768.0) - 1.0;
            buf.push(rand_val * 0.18);
        }
        buf
    }

    /// Generates land noise buffer for heavy body impacts (0.05s).
    pub fn generate_land_buffer(&self, seed: u32) -> Vec<f32> {
        let len = (self.sample_rate as f64 * 0.05) as usize;
        let mut buf = Vec::with_capacity(len);
        let mut state = seed.wrapping_add(0xABCD_EF01);

        for _ in 0..len {
            state = state.wrapping_mul(1664525).wrapping_add(1013904223);
            let rand_val = ((state >> 16) as f32 / 32768.0) - 1.0;
            buf.push(rand_val * 0.06);
        }
        buf
    }
}
