//! PIXEL SLOT MACHINE SYMBOLS — 16x16 hand-authored pixel run geometry with 5-tone hue-shifted shading.
//!
//! PORTS: `legacy/src/scenes/tavern/gambler/symbols.ts`

pub const SYM_GRID: u32 = 16;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tone {
    Ink,
    Shade,
    Base,
    Lite,
    Hi,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SlotSymbol {
    Ball,
    Flipper,
    Star,
    Skull,
    Crown,
    Cherry,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PixelRun {
    pub tone: Tone,
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

impl PixelRun {
    pub const fn new(tone: Tone, x: u32, y: u32, w: u32, h: u32) -> Self {
        Self { tone, x, y, w, h }
    }
}

/// Generates integer pixel runs for the requested slot symbol.
pub fn get_symbol_runs(symbol: SlotSymbol) -> Vec<PixelRun> {
    match symbol {
        SlotSymbol::Ball => vec![
            // Ink outline (14px circle silhouette)
            PixelRun::new(Tone::Ink, 5, 1, 6, 1),
            PixelRun::new(Tone::Ink, 3, 2, 10, 1),
            PixelRun::new(Tone::Ink, 2, 3, 12, 2),
            PixelRun::new(Tone::Ink, 1, 5, 14, 6),
            PixelRun::new(Tone::Ink, 2, 11, 12, 2),
            PixelRun::new(Tone::Ink, 3, 13, 10, 1),
            PixelRun::new(Tone::Ink, 5, 14, 6, 1),
            // Base fill
            PixelRun::new(Tone::Base, 5, 2, 6, 1),
            PixelRun::new(Tone::Base, 3, 3, 10, 2),
            PixelRun::new(Tone::Base, 2, 5, 12, 6),
            PixelRun::new(Tone::Base, 3, 11, 10, 2),
            PixelRun::new(Tone::Base, 5, 13, 6, 1),
            // Highlight specular
            PixelRun::new(Tone::Hi, 5, 4, 3, 2),
            PixelRun::new(Tone::Lite, 4, 3, 4, 1),
            // Shadow crescent
            PixelRun::new(Tone::Shade, 10, 8, 4, 1),
            PixelRun::new(Tone::Shade, 9, 9, 5, 1),
            PixelRun::new(Tone::Shade, 8, 10, 6, 2),
        ],
        SlotSymbol::Flipper => vec![
            PixelRun::new(Tone::Ink, 2, 6, 12, 4),
            PixelRun::new(Tone::Base, 3, 7, 10, 2),
            PixelRun::new(Tone::Hi, 3, 7, 10, 1),
            PixelRun::new(Tone::Shade, 3, 8, 10, 1),
        ],
        SlotSymbol::Star => vec![
            PixelRun::new(Tone::Ink, 7, 1, 2, 2),
            PixelRun::new(Tone::Ink, 2, 5, 12, 3),
            PixelRun::new(Tone::Ink, 4, 8, 8, 6),
            PixelRun::new(Tone::Base, 7, 2, 2, 1),
            PixelRun::new(Tone::Base, 3, 6, 10, 1),
            PixelRun::new(Tone::Base, 5, 9, 6, 4),
            PixelRun::new(Tone::Hi, 7, 3, 2, 2),
        ],
        SlotSymbol::Skull => vec![
            PixelRun::new(Tone::Ink, 4, 2, 8, 8),
            PixelRun::new(Tone::Ink, 5, 10, 6, 4),
            PixelRun::new(Tone::Base, 5, 3, 6, 6),
            PixelRun::new(Tone::Base, 6, 10, 4, 3),
            PixelRun::new(Tone::Ink, 6, 5, 1, 2), // Eye L
            PixelRun::new(Tone::Ink, 9, 5, 1, 2), // Eye R
            PixelRun::new(Tone::Hi, 5, 3, 4, 1),
        ],
        SlotSymbol::Crown => vec![
            PixelRun::new(Tone::Ink, 2, 4, 12, 9),
            PixelRun::new(Tone::Base, 3, 5, 10, 7),
            PixelRun::new(Tone::Hi, 3, 5, 2, 1),
            PixelRun::new(Tone::Hi, 7, 5, 2, 1),
            PixelRun::new(Tone::Hi, 11, 5, 2, 1),
        ],
        SlotSymbol::Cherry => vec![
            PixelRun::new(Tone::Ink, 3, 7, 5, 5),
            PixelRun::new(Tone::Ink, 8, 8, 5, 5),
            PixelRun::new(Tone::Base, 4, 8, 3, 3),
            PixelRun::new(Tone::Base, 9, 9, 3, 3),
            PixelRun::new(Tone::Hi, 4, 8, 1, 1),
            PixelRun::new(Tone::Hi, 9, 9, 1, 1),
            PixelRun::new(Tone::Ink, 6, 2, 4, 6), // Stems
        ],
    }
}
