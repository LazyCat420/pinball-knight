//! DARTBOARD PIXEL ART — Integer scanline rasterisation and score-coupled material classification.
//!
//! PORTS-PARTIAL: `legacy/src/scenes/tavern/gambler/darts-art.ts` - NOT a finished port - 44 rust code lines against 204 legacy (22%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

pub const SURROUND_OUT: f32 = 1.3;
pub const NUMBER_RING_R: f32 = 1.15;

pub const R_INNER_BULL: f32 = 0.038;
pub const R_OUTER_BULL: f32 = 0.095;
pub const R_TREBLE_IN: f32 = 0.58;
pub const R_TREBLE_OUT: f32 = 0.63;
pub const R_DOUBLE_IN: f32 = 0.95;
pub const R_DOUBLE_OUT: f32 = 1.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DartboardPixelKind {
    BullseyeInner,
    BullseyeOuter,
    TrebleRing,
    DoubleRing,
    WedgeDark,
    WedgeLite,
    Surround,
    Outside,
}

/// Classifies a normalized 2D point (x, y) centered at (0, 0) on the dartboard into a material kind.
pub fn classify_dartboard_pixel(x: f32, y: f32) -> DartboardPixelKind {
    let r = (x * x + y * y).sqrt();

    if r <= R_INNER_BULL {
        DartboardPixelKind::BullseyeInner
    } else if r <= R_OUTER_BULL {
        DartboardPixelKind::BullseyeOuter
    } else if r >= R_TREBLE_IN && r <= R_TREBLE_OUT {
        DartboardPixelKind::TrebleRing
    } else if r >= R_DOUBLE_IN && r <= R_DOUBLE_OUT {
        DartboardPixelKind::DoubleRing
    } else if r <= 1.0 {
        // 20-wedge angular parity
        let angle = y.atan2(x) + std::f32::consts::PI;
        let wedge_idx = (angle / (std::f32::consts::PI * 2.0 / 20.0)) as usize;
        if wedge_idx % 2 == 0 {
            DartboardPixelKind::WedgeDark
        } else {
            DartboardPixelKind::WedgeLite
        }
    } else if r <= SURROUND_OUT {
        DartboardPixelKind::Surround
    } else {
        DartboardPixelKind::Outside
    }
}
