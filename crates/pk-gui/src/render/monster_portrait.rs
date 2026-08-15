//! Monster Card Portraits — Maps slain monster kinds to their card art frame, cel-sheet key, and tinting.
//!
//! PORTS: `render/monster-portrait.ts`

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MonsterPortraitSpec {
    pub sheet_key: &'static str,
    pub frame_idx: usize,
    pub tint_hex: Option<u32>,
    pub scale: f32,
}

impl MonsterPortraitSpec {
    pub const fn new(
        sheet_key: &'static str,
        frame_idx: usize,
        tint_hex: Option<u32>,
        scale: f32,
    ) -> Self {
        Self {
            sheet_key,
            frame_idx,
            tint_hex,
            scale,
        }
    }
}

/// Resolves the card portrait render spec for any enemy kind.
pub fn portrait_spec_for_enemy(kind: &str, variant: usize) -> MonsterPortraitSpec {
    match kind {
        "zombie" => MonsterPortraitSpec::new("zombie", variant % 4, None, 1.0),
        "spider" => MonsterPortraitSpec::new("spider", 0, None, 1.0),
        "brute" => MonsterPortraitSpec::new("brute", 0, None, 1.15),
        "spitter" => MonsterPortraitSpec::new("spitter", 0, None, 1.0),
        "ghost" => MonsterPortraitSpec::new("ghost", 0, None, 1.0),
        "bat" => MonsterPortraitSpec::new("bat", 0, None, 0.9),
        "slime" => MonsterPortraitSpec::new("slime", 0, None, 1.0),
        "goblin" => MonsterPortraitSpec::new("goblin", 0, None, 1.0),
        "pin" => MonsterPortraitSpec::new("pin", 0, None, 1.0),
        "golem" => MonsterPortraitSpec::new("golem", 0, None, 1.2),
        "chomper" => MonsterPortraitSpec::new("chomper", 0, None, 1.0),
        "magnet" => MonsterPortraitSpec::new("magnet", 0, None, 1.0),
        "webspinner" => MonsterPortraitSpec::new("webspinner", 0, None, 1.0),
        "reaper" => MonsterPortraitSpec::new("reaper", 0, Some(0x7b1fa2), 1.25),
        "sporeling" => MonsterPortraitSpec::new("sporeling", 0, None, 1.0),
        "jester" => MonsterPortraitSpec::new("jester", 0, None, 1.0),
        "croaker" => MonsterPortraitSpec::new("croaker", 0, None, 1.0),
        "rotortail" => MonsterPortraitSpec::new("rotortail", 0, None, 1.0),
        "stiltneck" => MonsterPortraitSpec::new("stiltneck", 0, None, 1.1),
        "hound" => MonsterPortraitSpec::new("hound", 0, None, 1.0),
        "fish_feet" => MonsterPortraitSpec::new("fish_feet", 0, None, 1.0),
        _ => MonsterPortraitSpec::new("zombie", 0, None, 1.0),
    }
}
