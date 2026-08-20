//! CARD STYLES — Monster-family visual themes and material styling for playing cards.
//!
//! PORTS: `render/card-styles.ts`

use crate::painter::Rgba;
use std::collections::HashMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum CardStyleId {
    Bone,
    Ink,
    Stone,
    Chitin,
    Iron,
    Void,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Metal {
    pub rim: Rgba,
    pub body: Rgba,
    pub specular: Rgba,
}

pub const METALS: [Metal; 5] = [
    Metal {
        rim: Rgba::rgb(80, 80, 80),
        body: Rgba::rgb(140, 140, 140),
        specular: Rgba::rgb(220, 220, 220),
    },
    Metal {
        rim: Rgba::rgb(120, 70, 30),
        body: Rgba::rgb(180, 110, 50),
        specular: Rgba::rgb(240, 180, 100),
    },
    Metal {
        rim: Rgba::rgb(140, 110, 30),
        body: Rgba::rgb(210, 170, 50),
        specular: Rgba::rgb(255, 230, 120),
    },
    Metal {
        rim: Rgba::rgb(40, 100, 120),
        body: Rgba::rgb(80, 160, 190),
        specular: Rgba::rgb(160, 230, 255),
    },
    Metal {
        rim: Rgba::rgb(100, 40, 120),
        body: Rgba::rgb(160, 80, 190),
        specular: Rgba::rgb(230, 160, 255),
    },
];

#[derive(Clone, Debug, PartialEq)]
pub struct CardStyle {
    pub id: CardStyleId,
    pub imprint: &'static str,
    pub stock: [Rgba; 2],
    pub panel: Rgba,
    pub rule: Rgba,
    pub accent: Rgba,
    pub dark_rule: Rgba,
    pub light_accent: Rgba,
}

pub fn metal_for(tier: usize) -> Metal {
    METALS[tier.min(METALS.len() - 1)].clone()
}

pub fn style_def(id: CardStyleId) -> CardStyle {
    match id {
        CardStyleId::Bone => CardStyle {
            id,
            imprint: "BONE RELIC",
            stock: [Rgba::rgb(22, 20, 18), Rgba::rgb(34, 30, 26)],
            panel: Rgba::rgb(42, 38, 32),
            rule: Rgba::rgb(140, 130, 115),
            accent: Rgba::rgb(220, 200, 160),
            dark_rule: Rgba::rgb(70, 65, 55),
            light_accent: Rgba::rgb(245, 235, 210),
        },
        CardStyleId::Ink => CardStyle {
            id,
            imprint: "INK PHANTASM",
            stock: [Rgba::rgb(10, 12, 18), Rgba::rgb(18, 22, 32)],
            panel: Rgba::rgb(26, 32, 45),
            rule: Rgba::rgb(80, 100, 140),
            accent: Rgba::rgb(140, 190, 255),
            dark_rule: Rgba::rgb(40, 50, 70),
            light_accent: Rgba::rgb(190, 220, 255),
        },
        CardStyleId::Stone => CardStyle {
            id,
            imprint: "STONE EMBLEM",
            stock: [Rgba::rgb(18, 20, 22), Rgba::rgb(28, 30, 32)],
            panel: Rgba::rgb(38, 40, 42),
            rule: Rgba::rgb(110, 115, 120),
            accent: Rgba::rgb(190, 180, 160),
            dark_rule: Rgba::rgb(55, 58, 60),
            light_accent: Rgba::rgb(220, 215, 200),
        },
        CardStyleId::Chitin => CardStyle {
            id,
            imprint: "CHITIN CARAPACE",
            stock: [Rgba::rgb(16, 20, 16), Rgba::rgb(24, 32, 24)],
            panel: Rgba::rgb(32, 42, 32),
            rule: Rgba::rgb(90, 130, 90),
            accent: Rgba::rgb(160, 220, 150),
            dark_rule: Rgba::rgb(45, 65, 45),
            light_accent: Rgba::rgb(200, 245, 190),
        },
        CardStyleId::Iron => CardStyle {
            id,
            imprint: "IRON FORGE",
            stock: [Rgba::rgb(20, 18, 22), Rgba::rgb(32, 28, 36)],
            panel: Rgba::rgb(44, 38, 50),
            rule: Rgba::rgb(130, 110, 140),
            accent: Rgba::rgb(210, 160, 230),
            dark_rule: Rgba::rgb(65, 55, 70),
            light_accent: Rgba::rgb(240, 205, 255),
        },
        CardStyleId::Void => CardStyle {
            id,
            imprint: "VOID RELIC",
            stock: [Rgba::rgb(12, 8, 16), Rgba::rgb(20, 14, 28)],
            panel: Rgba::rgb(30, 20, 42),
            rule: Rgba::rgb(150, 90, 180),
            accent: Rgba::rgb(230, 140, 255),
            dark_rule: Rgba::rgb(75, 45, 90),
            light_accent: Rgba::rgb(250, 190, 255),
        },
    }
}

pub fn card_styles_map() -> HashMap<CardStyleId, CardStyle> {
    let mut m = HashMap::new();
    m.insert(CardStyleId::Bone, style_def(CardStyleId::Bone));
    m.insert(CardStyleId::Ink, style_def(CardStyleId::Ink));
    m.insert(CardStyleId::Stone, style_def(CardStyleId::Stone));
    m.insert(CardStyleId::Chitin, style_def(CardStyleId::Chitin));
    m.insert(CardStyleId::Iron, style_def(CardStyleId::Iron));
    m.insert(CardStyleId::Void, style_def(CardStyleId::Void));
    m
}

pub fn kind_style_map() -> HashMap<&'static str, CardStyleId> {
    let mut m = HashMap::new();
    m.insert("skeleton", CardStyleId::Bone);
    m.insert("zombie", CardStyleId::Bone);
    m.insert("ghost", CardStyleId::Ink);
    m.insert("gargoyle", CardStyleId::Stone);
    m.insert("spider", CardStyleId::Chitin);
    m.insert("knight", CardStyleId::Iron);
    m.insert("reaper", CardStyleId::Void);
    m
}

pub fn style_for_monster(kind: &str) -> CardStyle {
    match kind {
        "zombie" | "skeleton" => style_def(CardStyleId::Bone),
        "ghost" => style_def(CardStyleId::Ink),
        "brute" | "gargoyle" => style_def(CardStyleId::Stone),
        "spider" => style_def(CardStyleId::Chitin),
        "knight" => style_def(CardStyleId::Iron),
        _ => style_def(CardStyleId::Void),
    }
}

pub fn style_for(source: Option<&str>) -> CardStyle {
    match source {
        Some(s) => style_for_monster(s),
        None => style_def(CardStyleId::Bone),
    }
}

pub fn style_for_card(id: &str) -> CardStyle {
    if id.starts_with("zombie") || id.starts_with("bone") {
        style_def(CardStyleId::Bone)
    } else if id.starts_with("ghost") || id.starts_with("ink") {
        style_def(CardStyleId::Ink)
    } else if id.starts_with("stone") || id.starts_with("brute") {
        style_def(CardStyleId::Stone)
    } else if id.starts_with("chitin") || id.starts_with("spider") {
        style_def(CardStyleId::Chitin)
    } else if id.starts_with("blade") || id.starts_with("iron") || id.starts_with("knight") {
        style_def(CardStyleId::Iron)
    } else {
        style_def(CardStyleId::Void)
    }
}

pub fn element_for(_m: &str) -> &'static str {
    "fire"
}
