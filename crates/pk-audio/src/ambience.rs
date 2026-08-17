//! Sustained ambient sound beds with poll-driven dead-man's switch automation.
//!
//! PORTS: `sfx/ambience.ts`

use std::collections::HashMap;

pub const AMB_HOLD: f32 = 0.35; // Silence decay delay after last refresh
pub const AMB_FOLLOW: f32 = 0.12; // Level follower smoothing time
pub const AMB_ATTACK: f32 = 0.25; // Initial fade-in attack duration

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AmbienceKind {
    Fire,
    Water,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AmbienceVoice {
    pub kind: AmbienceKind,
    pub current_level: f32,
    pub frame_level: f32,
    pub hold_timer: f32,
    pub active: bool,
}

impl AmbienceVoice {
    pub fn new(kind: AmbienceKind) -> Self {
        Self {
            kind,
            current_level: 0.0,
            frame_level: 0.0,
            hold_timer: 0.0,
            active: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct AmbienceManager {
    pub voices: HashMap<AmbienceKind, AmbienceVoice>,
}

impl AmbienceManager {
    pub fn new() -> Self {
        let mut voices = HashMap::new();
        voices.insert(AmbienceKind::Fire, AmbienceVoice::new(AmbienceKind::Fire));
        voices.insert(AmbienceKind::Water, AmbienceVoice::new(AmbienceKind::Water));
        Self { voices }
    }

    /// Contributes an ambient sound level for the current frame.
    /// Multiple sources (e.g. 3 fires) combine additively up to 1.0.
    pub fn refresh_source(&mut self, kind: AmbienceKind, level: f32) {
        if level <= 0.0001 {
            return;
        }

        let voice = self
            .voices
            .entry(kind)
            .or_insert_with(|| AmbienceVoice::new(kind));
        voice.frame_level = (voice.frame_level + level).min(1.0);
        voice.hold_timer = AMB_HOLD;
        voice.active = true;
    }

    /// Ticks ambient voices, smoothing active levels and decaying unrefreshed beds to silence.
    pub fn step(&mut self, dt: f32) {
        for voice in self.voices.values_mut() {
            if voice.hold_timer > 0.0 {
                voice.hold_timer -= dt;

                // Follow frame level
                let follow_rate = dt / AMB_FOLLOW;
                voice.current_level +=
                    (voice.frame_level - voice.current_level) * follow_rate.clamp(0.0, 1.0);
            } else {
                // Decay to silence after hold expiry
                let decay_rate = dt / AMB_HOLD;
                voice.current_level = (voice.current_level - decay_rate).max(0.0);
                if voice.current_level == 0.0 {
                    voice.active = false;
                }
            }

            // Reset frame accumulator for next frame
            voice.frame_level = 0.0;
        }
    }

    /// Returns the current rendered volume of a named ambient bed (0.0 to 1.0).
    pub fn get_level(&self, kind: AmbienceKind) -> f32 {
        self.voices.get(&kind).map_or(0.0, |v| v.current_level)
    }
}
