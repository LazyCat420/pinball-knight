//! The UI theme — `legacy/src/game/pinball-knight/gui/theme.ts`, verbatim.
//!
//! Every colour is a Cold Crypt entry by index (see that file's sweep note:
//! exactly three palette pairs are dither-unstable, and stone-as-plate rendered
//! GREEN — the leather ramp is the stable choice, not an aesthetic one).
//! Body text steps DOWN from cream on purpose: max-contrast 8px text shimmers
//! under scanlines.

use crate::painter::Rgba;
use crate::palette::c;

pub struct Ui;

impl Ui {
    /// Full-screen scrim behind a modal sheet. Palette 0 at 82% (0.82 × 255 → 209).
    pub const SCRIM: Rgba = Rgba::hex_a(0x0b0d12, 209);

    /// Sheet body and its two-tone frame (leather ramp — see theme.ts's sweep).
    pub const SHEET: Rgba = c(26); // leather shadow — the plate itself
    pub const SHEET_EDGE: Rgba = c(27); // leather dark — the keyline
    pub const SHEET_EDGE_LIT: Rgba = c(28); // leather mid — top/left bevel

    /// A key sitting PROUD of the plate — buttons, tabs, the focused row's face.
    pub const RAISED: Rgba = c(27); // leather dark (same as SHEET_EDGE, by design)

    /// The chisel. Highlight is TWO rungs off the face — one rung read as nothing.
    pub const BEVEL_LIT: Rgba = c(24); // skin mid
    pub const BEVEL_SHADE: Rgba = c(1); // outline
    /// Corner studs — the one palette entry nothing else names.
    pub const RIVET: Rgba = c(5); // stone highlight

    /// Rows and wells sunk into the sheet.
    pub const WELL: Rgba = c(0);
    pub const WELL_EDGE: Rgba = c(1);

    /// Type.
    pub const TEXT: Rgba = c(21); // steel light — body
    pub const TEXT_DIM: Rgba = c(20); // steel mid — hints, units
    pub const TEXT_FAINT: Rgba = c(19); // steel dark — disabled
    pub const HEADING: Rgba = c(17); // flame light
    pub const GOLD: Rgba = c(16); // flame — currency, the accent

    /// State colours.
    pub const GOOD: Rgba = c(9); // rot light
    pub const DANGER: Rgba = c(13); // blood light
    pub const ARCANE: Rgba = c(31); // arcane light

    /// Focus ring — the brightest entry in the palette.
    pub const FOCUS: Rgba = c(18); // flame core

    /// The selection as a SURFACE (Doom highlights the row, then adds a cursor).
    pub const SELECT_FACE: Rgba = c(11); // blood dark
    pub const SELECT_EDGE: Rgba = c(12); // blood mid
    pub const CURSOR: Rgba = c(18); // flame core — same tone as focus: one cursor
}

/// THE GRID. Every offset, size and gap in the UI is a multiple of this.
pub const GRID: f64 = 8.0;

/// Snap any coordinate to the grid.
pub fn snap(v: f64) -> f64 {
    js_round(v / GRID) as f64 * GRID
}

/// JS `Math.round`: half-toward-+∞, i.e. `floor(v + 0.5)`.
///
/// NOT Rust's `f64::round` (half-away-from-zero): they disagree at negative
/// halves — `Math.round(-1.5) == -1`, `(-1.5f64).round() == -2` — and
/// `focus_ring`'s `inset(r, -2)` produces negative coordinates at screen edges.
pub fn js_round(v: f64) -> i64 {
    (v + 0.5).floor() as i64
}

/// Snap to whole pixels — theme.ts's `px()`.
pub fn px(v: f64) -> i64 {
    js_round(v)
}

/// Row metrics, so every screen agrees on how tall a line of UI is.
pub const ROW_H: f64 = 24.0;
pub const ROW_GAP: f64 = 4.0;
pub const PAD: f64 = 16.0;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn px_is_js_math_round_not_rusts() {
        assert_eq!(px(-1.5), -1); // Math.round(-1.5) === -1; Rust round gives -2
        assert_eq!(px(-2.5), -2);
        assert_eq!(px(1.5), 2);
        assert_eq!(px(2.5), 3);
        assert_eq!(px(0.49), 0);
        assert_eq!(px(-0.5), 0); // Math.round(-0.5) === -0
    }

    #[test]
    fn snap_lands_on_grid_lines() {
        assert_eq!(snap(11.0), 8.0);
        assert_eq!(snap(12.0), 16.0); // 12/8 = 1.5 → Math.round = 2
        assert_eq!(snap(-4.0), -0.0); // -4/8 = -0.5 → Math.round = 0
        assert_eq!(snap(668.0), 672.0); // 668/8 = 83.5 → JS half-up → 84
    }
}
