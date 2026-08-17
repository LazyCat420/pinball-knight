//! CARD STYLES — Physical material palettes and border styles chosen by monster taxonomy.
//!
//! Replaces arbitrary stat gradients with monster material families: bone (undead), ink (incorporeal),
//! stone (rooted), chitin (arthropods), iron (wrought), and void (chase relics).
//!
//! PORTS-PARTIAL: `render/card-styles.ts` - NOT a finished port - 103 rust code lines against 371 legacy (28%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

use crate::painter::Rgba;

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
pub struct CardStyleDef {
    pub id: CardStyleId,
    pub imprint: &'static str,
    pub stock: [Rgba; 2],
    pub panel: Rgba,
    pub rule: Rgba,
    pub accent: Rgba,
}

pub fn style_def(id: CardStyleId) -> CardStyleDef {
    match id {
        CardStyleId::Bone => CardStyleDef {
            id,
            imprint: "BONE RELIC",
            stock: [Rgba::rgb(22, 20, 18), Rgba::rgb(34, 30, 26)],
            panel: Rgba::rgb(42, 38, 32),
            rule: Rgba::rgb(140, 130, 115),
            accent: Rgba::rgb(220, 200, 160),
        },
        CardStyleId::Ink => CardStyleDef {
            id,
            imprint: "INK PHANTASM",
            stock: [Rgba::rgb(10, 12, 18), Rgba::rgb(18, 22, 32)],
            panel: Rgba::rgb(26, 32, 45),
            rule: Rgba::rgb(80, 100, 140),
            accent: Rgba::rgb(140, 190, 255),
        },
        CardStyleId::Stone => CardStyleDef {
            id,
            imprint: "STONE EMBLEM",
            stock: [Rgba::rgb(18, 20, 22), Rgba::rgb(28, 30, 32)],
            panel: Rgba::rgb(38, 40, 42),
            rule: Rgba::rgb(110, 115, 120),
            accent: Rgba::rgb(190, 180, 160),
        },
        CardStyleId::Chitin => CardStyleDef {
            id,
            imprint: "CHITIN CARAPACE",
            stock: [Rgba::rgb(16, 20, 16), Rgba::rgb(24, 32, 24)],
            panel: Rgba::rgb(32, 42, 32),
            rule: Rgba::rgb(90, 130, 90),
            accent: Rgba::rgb(160, 220, 120),
        },
        CardStyleId::Iron => CardStyleDef {
            id,
            imprint: "IRON WORK",
            stock: [Rgba::rgb(16, 16, 18), Rgba::rgb(28, 28, 32)],
            panel: Rgba::rgb(36, 38, 44),
            rule: Rgba::rgb(120, 125, 135),
            accent: Rgba::rgb(240, 160, 80),
        },
        CardStyleId::Void => CardStyleDef {
            id,
            imprint: "VOID RELIC",
            stock: [Rgba::rgb(12, 8, 16), Rgba::rgb(22, 14, 30)],
            panel: Rgba::rgb(32, 20, 42),
            rule: Rgba::rgb(130, 90, 160),
            accent: Rgba::rgb(220, 140, 255),
        },
    }
}

/// Resolves card material style from monster family kind.
pub fn style_for_monster(kind: &str) -> CardStyleDef {
    match kind {
        "zombie" | "skeleton" | "reaper" => style_def(CardStyleId::Bone),
        "ghost" | "wraith" | "specter" => style_def(CardStyleId::Ink),
        "brute" | "golem" | "troll" => style_def(CardStyleId::Stone),
        "spider" | "crawler" | "beetle" => style_def(CardStyleId::Chitin),
        "knight" | "automaton" | "guard" => style_def(CardStyleId::Iron),
        _ => style_def(CardStyleId::Void),
    }
}

/// Resolves card material style from card id.
pub fn style_for_card(card_id: &str) -> CardStyleDef {
    if card_id.starts_with("zombie_") || card_id.starts_with("bone_") {
        style_def(CardStyleId::Bone)
    } else if card_id.starts_with("ghost_") || card_id.starts_with("ink_") {
        style_def(CardStyleId::Ink)
    } else if card_id.starts_with("brute_") || card_id.starts_with("stone_") {
        style_def(CardStyleId::Stone)
    } else if card_id.starts_with("spider_") || card_id.starts_with("chitin_") {
        style_def(CardStyleId::Chitin)
    } else if card_id.starts_with("iron_") || card_id.starts_with("blade_") {
        style_def(CardStyleId::Iron)
    } else {
        style_def(CardStyleId::Void)
    }
}
