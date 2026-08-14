//! 🎴 CARD STYLES — What a card is printed on, chosen by the monster it came from.
//!
//! PORTS: `render/card-styles.ts`

use crate::card_glyphs::CardGlyphKind;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum EnemyKind {
    Zombie,
    Brute,
    Reaper,
    Chomper,
    Bloater,
    Hound,
    Sporeling,
    Ghost,
    Wisp,
    Bat,
    Necromancer,
    Golem,
    Crystalback,
    Pin,
    Mimic,
    Spider,
    Webspinner,
    Slime,
    Spitter,
    Croaker,
    FishFeet,
    Goblin,
    Jester,
    Rotortail,
    Stiltneck,
    Warden,
    Sapper,
    Magnet,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum StyleId {
    Bone,
    Ink,
    Stone,
    Chitin,
    Iron,
    Void,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CardStyle {
    pub imprint: &'static str,
    pub stock: (&'static str, &'static str),
    pub panel: &'static str,
    pub rule: &'static str,
    pub accent: &'static str,
    pub ink: &'static str,
    pub glow: &'static str,
}

pub const STYLE_BONE: CardStyle = CardStyle {
    imprint: "BONE RELIC",
    stock: ("#100d0a", "#282019"),
    panel: "#161311",
    rule: "#786a55",
    accent: "#c0472f",
    ink: "#d6cfc0",
    glow: "#a8482f",
};

pub const STYLE_INK: CardStyle = CardStyle {
    imprint: "INK BOUND",
    stock: ("#080a10", "#161c2c"),
    panel: "#0c1018",
    rule: "#5c6b8c",
    accent: "#7ea6d8",
    ink: "#c3cee0",
    glow: "#6d8fd0",
};

pub const STYLE_STONE: CardStyle = CardStyle {
    imprint: "CARVED SLATE",
    stock: ("#0b1211", "#1d2b27"),
    panel: "#0f1615",
    rule: "#5f7a72",
    accent: "#68b39a",
    ink: "#c2d0cb",
    glow: "#5fae94",
};

pub const STYLE_CHITIN: CardStyle = CardStyle {
    imprint: "CHITIN PLATE",
    stock: ("#0b0f08", "#1e2812"),
    panel: "#0e1309",
    rule: "#6d7f47",
    accent: "#a8c85a",
    ink: "#cbd6ac",
    glow: "#9dc257",
};

pub const STYLE_IRON: CardStyle = CardStyle {
    imprint: "IRON WORK",
    stock: ("#0c0f15", "#212a38"),
    panel: "#0f1319",
    rule: "#78828e",
    accent: "#d8862f",
    ink: "#cbd2da",
    glow: "#c8792a",
};

pub const STYLE_VOID: CardStyle = CardStyle {
    imprint: "UNMADE",
    stock: ("#0a0616", "#22103f"),
    panel: "#0b0814",
    rule: "#8b6bc4",
    accent: "#c08bff",
    ink: "#ddd0f2",
    glow: "#a86bff",
};

pub fn kind_style(kind: Option<EnemyKind>) -> StyleId {
    let Some(k) = kind else {
        return StyleId::Void;
    };
    match k {
        EnemyKind::Zombie
        | EnemyKind::Brute
        | EnemyKind::Reaper
        | EnemyKind::Chomper
        | EnemyKind::Bloater
        | EnemyKind::Hound
        | EnemyKind::Sporeling => StyleId::Bone,

        EnemyKind::Ghost
        | EnemyKind::Wisp
        | EnemyKind::Bat
        | EnemyKind::Necromancer => StyleId::Ink,

        EnemyKind::Golem
        | EnemyKind::Crystalback
        | EnemyKind::Pin
        | EnemyKind::Mimic => StyleId::Stone,

        EnemyKind::Spider
        | EnemyKind::Webspinner
        | EnemyKind::Slime
        | EnemyKind::Spitter
        | EnemyKind::Croaker
        | EnemyKind::FishFeet => StyleId::Chitin,

        EnemyKind::Goblin
        | EnemyKind::Jester
        | EnemyKind::Rotortail
        | EnemyKind::Stiltneck
        | EnemyKind::Warden
        | EnemyKind::Sapper
        | EnemyKind::Magnet => StyleId::Iron,
    }
}

pub fn style_for(source: Option<EnemyKind>) -> &'static CardStyle {
    match kind_style(source) {
        StyleId::Bone => &STYLE_BONE,
        StyleId::Ink => &STYLE_INK,
        StyleId::Stone => &STYLE_STONE,
        StyleId::Chitin => &STYLE_CHITIN,
        StyleId::Iron => &STYLE_IRON,
        StyleId::Void => &STYLE_VOID,
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Metal {
    pub name: &'static str,
    pub stops: (&'static str, &'static str, &'static str),
    pub glow: &'static str,
}

pub const METALS: &[Metal] = &[
    Metal { name: "PEWTER", stops: ("#8b8d90", "#4b4e52", "#9a9ca0"), glow: "#9a9ca0" },
    Metal { name: "SILVER", stops: ("#d6dde4", "#767e88", "#e7edf3"), glow: "#cfd8e2" },
    Metal { name: "BRONZE", stops: ("#d8a45c", "#7a5320", "#e8bd76"), glow: "#d9a557" },
    Metal { name: "TARNISHED GOLD", stops: ("#f0d489", "#8a6413", "#ffe9a8"), glow: "#f2cf74" },
    Metal { name: "BLACKENED", stops: ("#c79bff", "#3d1f6e", "#efdcff"), glow: "#b985ff" },
];

pub fn metal_for(tier: usize) -> &'static Metal {
    let idx = tier.min(METALS.len() - 1);
    &METALS[idx]
}

pub fn element_glyph_for(
    bolt: bool,
    on_hit_burn: bool,
    on_hit_chill: bool,
    crit_chance: bool,
    pinball_mult: f64,
    cooldown_mult: f64,
    durability_mult: f64,
) -> CardGlyphKind {
    if bolt {
        CardGlyphKind::Bolt
    } else if on_hit_burn {
        CardGlyphKind::Flame
    } else if on_hit_chill {
        CardGlyphKind::Frost
    } else if crit_chance {
        CardGlyphKind::Fang
    } else if pinball_mult > 1.0 {
        CardGlyphKind::Momentum
    } else if cooldown_mult > 0.0 && cooldown_mult < 1.0 {
        CardGlyphKind::Swift
    } else if durability_mult > 1.0 {
        CardGlyphKind::Shield
    } else {
        CardGlyphKind::Blades
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_zombie_kind_has_a_material_style() {
        for kind in [
            EnemyKind::Zombie,
            EnemyKind::Brute,
            EnemyKind::Ghost,
            EnemyKind::Golem,
            EnemyKind::Spider,
            EnemyKind::Goblin,
        ] {
            let st = style_for(Some(kind));
            assert!(!st.imprint.is_empty());
        }
    }

    #[test]
    fn metals_escalate_through_blackened() {
        assert_eq!(metal_for(0).name, "PEWTER");
        assert_eq!(metal_for(4).name, "BLACKENED");
    }
}
