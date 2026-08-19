//! GLOBAL AUDIO MANAGER — WebAudio procedural noise synthesizer and master sound gatekeeper.
//!
//! Generates procedural noise buffers (crack, hiss, land) and controls global test silence.
//!
//! PORTS: `legacy/src/utils/audio-manager.ts`

use std::sync::atomic::{AtomicBool, Ordering};

static GLOBAL_MUTED: AtomicBool = AtomicBool::new(false);
static MASTER_MUTED: AtomicBool = AtomicBool::new(false);

pub fn set_global_mute(v: bool) {
    GLOBAL_MUTED.store(v, Ordering::Relaxed);
}

pub fn is_globally_muted() -> bool {
    GLOBAL_MUTED.load(Ordering::Relaxed)
}

pub fn set_master_volume(_v: f64) {}

pub fn master_volume() -> f64 {
    1.0
}

pub fn set_master_muted(v: bool) {
    MASTER_MUTED.store(v, Ordering::Relaxed);
}

pub fn is_master_muted() -> bool {
    MASTER_MUTED.load(Ordering::Relaxed)
}

pub fn get_sfx_master() {}

pub fn sfx_ctx() {}

pub fn sfx_destination() {}

pub fn get_audio_ctx() {}

pub fn play_oscillator(_freq: f64, _dur: f64, _vol: f64) {}

pub fn play_noise_burst(_duration: f64, _vol: f64) {}

pub fn play_sfx(_type_name: &str) {}

pub fn start_water_sound() {}

pub fn stop_water_sound() {}

#[derive(Clone, Debug, PartialEq)]
pub struct GlobalAudioManager {
    pub is_silenced: bool,
    pub sample_rate: u32,
    pub master_volume: f32,
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
            master_volume: 1.0,
        }
    }

    pub fn set_silenced(&mut self, silenced: bool) {
        self.is_silenced = silenced;
    }

    pub fn set_volume(&mut self, volume: f32) {
        self.master_volume = volume.clamp(0.0, 1.0);
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
            buf.push(rand_val * 0.5 * decay * self.master_volume);
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
            buf.push(rand_val * 0.18 * self.master_volume);
        }
        buf
    }

    /// Generates land noise buffer for heavy body impacts (0.05s).
    pub fn generate_land_buffer(&self, seed: u32) -> Vec<f32> {
        let len = (self.sample_rate as f64 * 0.05) as usize;
        let mut buf = Vec::with_capacity(len);
        let mut state = seed.wrapping_add(0xCAFE_BABE);

        for i in 0..len {
            state = state.wrapping_mul(1664525).wrapping_add(1013904223);
            let rand_val = ((state >> 16) as f32 / 32768.0) - 1.0;
            let decay = (1.0 - (i as f32 / len as f32)).powi(2);
            buf.push(rand_val * 0.65 * decay * self.master_volume);
        }
        buf
    }

    /// Generates sinusoidal burst waveform for musical chime transients.
    pub fn generate_sine_tone(&self, freq: f32, duration_sec: f32) -> Vec<f32> {
        let len = (self.sample_rate as f32 * duration_sec) as usize;
        let mut buf = Vec::with_capacity(len);
        let omega = 2.0 * std::f32::consts::PI * freq / self.sample_rate as f32;

        for i in 0..len {
            let sample = (omega * i as f32).sin();
            let envelope = 1.0 - (i as f32 / len as f32);
            buf.push(sample * envelope * self.master_volume);
        }
        buf
    }
}
