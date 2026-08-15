//! Actor Cel-Painting Vocabulary — Facing directions, 22 named animation clips, and beat duration scales.
//!
//! PORTS: `engine/render/paint-types.ts`

use std::collections::HashMap;

/// The three authored render directions. West is rendered by horizontally flipping East.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Default)]
pub enum Dir {
    #[default]
    South,
    North,
    East,
}

impl Dir {
    pub const ALL: [Dir; 3] = [Dir::South, Dir::North, Dir::East];
}

/// The 22 named animation clips an actor or marble body can execute.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ClipName {
    Idle,
    Walk,
    Attack,
    Death,
    Roll,
    Run,
    Ball,
    Steelball,
    Diamondball,
    Waterball,
    Stoneball,
    Stormball,
    Shadowball,
    Lavaball,
    Boltform,
    Laserform,
    Equip,
    Forge,
    Crouch,
    Wait,
    Wake,
    Stumble,
}

impl ClipName {
    pub const ALL: [ClipName; 22] = [
        ClipName::Idle,
        ClipName::Walk,
        ClipName::Attack,
        ClipName::Death,
        ClipName::Roll,
        ClipName::Run,
        ClipName::Ball,
        ClipName::Steelball,
        ClipName::Diamondball,
        ClipName::Waterball,
        ClipName::Stoneball,
        ClipName::Stormball,
        ClipName::Shadowball,
        ClipName::Lavaball,
        ClipName::Boltform,
        ClipName::Laserform,
        ClipName::Equip,
        ClipName::Forge,
        ClipName::Crouch,
        ClipName::Wait,
        ClipName::Wake,
        ClipName::Stumble,
    ];

    /// Checks if this clip is a marble body form.
    pub fn is_marble_body(&self) -> bool {
        matches!(
            self,
            ClipName::Ball
                | ClipName::Steelball
                | ClipName::Diamondball
                | ClipName::Waterball
                | ClipName::Stoneball
                | ClipName::Stormball
                | ClipName::Shadowball
                | ClipName::Lavaball
        )
    }

    /// Checks if this clip is a telegraph tell for enemy intent policies.
    pub fn is_telegraph(&self) -> bool {
        matches!(
            self,
            ClipName::Crouch | ClipName::Wait | ClipName::Wake | ClipName::Stumble
        )
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct ActorBeats {
    pub beats: HashMap<ClipName, u32>,
}

impl ActorBeats {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_beat(&mut self, clip: ClipName, beats: u32) {
        self.beats.insert(clip, beats);
    }

    pub fn get_beat(&self, clip: ClipName, default_frames: u32) -> u32 {
        self.beats.get(&clip).copied().unwrap_or(default_frames)
    }
}
