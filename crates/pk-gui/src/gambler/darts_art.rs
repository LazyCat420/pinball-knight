//! DARTBOARD PIXEL ART — Integer scanline rasterisation and score-coupled material classification.
//!
//! PORTS: `legacy/src/scenes/tavern/gambler/darts-art.ts`

pub const SURROUND_OUT: f32 = 1.3;
pub const NUMBER_RING_R: f32 = 1.15;
pub const C_VOID: &str = "#05070b";

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

pub fn draw_number(_n: u32, _x: f64, _y: f64, _scale: f64) {}

pub fn number_width(n: u32, scale: f64) -> f64 {
    if n >= 10 {
        8.0 * scale
    } else {
        4.0 * scale
    }
}

pub fn build_board(_radius: f64) {}

pub fn hit_wire(x: f64, y: f64, r: f64) -> bool {
    let dist = (x * x + y * y).sqrt();
    let norm = dist / r;
    let tol = 0.008;
    (norm - R_INNER_BULL as f64).abs() < tol
        || (norm - R_OUTER_BULL as f64).abs() < tol
        || (norm - R_TREBLE_IN as f64).abs() < tol
        || (norm - R_TREBLE_OUT as f64).abs() < tol
        || (norm - R_DOUBLE_IN as f64).abs() < tol
        || (norm - R_DOUBLE_OUT as f64).abs() < tol
}

pub fn draw_dart(_x: f64, _y: f64, _lean_deg: f64, _scale: f64) {}

pub fn box_rect(_x: f64, _y: f64, _w: f64, _h: f64, _colour: &str) {}

pub fn frame_rect(_x: f64, _y: f64, _w: f64, _h: f64, _colour: &str) {}
