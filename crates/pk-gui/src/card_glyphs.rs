//! 🎴 CARD GLYPHS — Every mark on a card face, drawn as vector paths.
//!
//! PORTS: `render/card-glyphs.ts`

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CardGlyphKind {
    Bolt,
    Flame,
    Frost,
    Fang,
    Momentum,
    Swift,
    Shield,
    Blades,
    Star,
}

pub struct GlyphPoint {
    pub x: f32,
    pub y: f32,
}

pub const BOLT_POINTS: &[GlyphPoint] = &[
    GlyphPoint { x: 0.12, y: -1.0 },
    GlyphPoint { x: -0.62, y: 0.1 },
    GlyphPoint { x: -0.08, y: 0.1 },
    GlyphPoint { x: -0.3, y: 1.0 },
    GlyphPoint { x: 0.62, y: -0.18 },
    GlyphPoint { x: 0.05, y: -0.18 },
];

pub const BLADES_POINTS: &[GlyphPoint] = &[
    GlyphPoint { x: 0.0, y: -1.0 },
    GlyphPoint { x: 0.15, y: -0.2 },
    GlyphPoint { x: 0.35, y: -0.2 },
    GlyphPoint { x: 0.2, y: 0.3 },
    GlyphPoint { x: 0.0, y: 0.9 },
    GlyphPoint { x: -0.2, y: 0.3 },
    GlyphPoint { x: -0.35, y: -0.2 },
    GlyphPoint { x: -0.15, y: -0.2 },
];

impl CardGlyphKind {
    pub const fn name(self) -> &'static str {
        match self {
            Self::Bolt => "Storm Bolt",
            Self::Flame => "Blaze Flame",
            Self::Frost => "Frost Snowflake",
            Self::Fang => "Savage Fang",
            Self::Momentum => "Momentum Vector",
            Self::Swift => "Swift Feather",
            Self::Shield => "Guard Crest",
            Self::Blades => "Crossed Steel",
            Self::Star => "Astral Star",
        }
    }
}
