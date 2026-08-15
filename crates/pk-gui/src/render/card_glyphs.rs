//! CARD GLYPHS — Resolution-independent geometric vector paths for card face emblems and icons.
//!
//! Renders clean unit-space polygons without system emoji font dependencies.
//!
//! PORTS: `render/card-glyphs.ts`

pub fn poly_points(pts: &[f64]) -> Vec<(f64, f64)> {
    let mut out = Vec::with_capacity(pts.len() / 2);
    let mut i = 0;
    while i + 1 < pts.len() {
        out.push((pts[i], pts[i + 1]));
        i += 2;
    }
    out
}

pub fn star_points(points: usize, outer_r: f64, inner_r: f64) -> Vec<(f64, f64)> {
    let mut out = Vec::with_capacity(points * 2);
    let step = std::f64::consts::PI / points as f64;
    for i in 0..(points * 2) {
        let r = if i % 2 == 0 { outer_r } else { inner_r };
        let angle = i as f64 * step - std::f64::consts::FRAC_PI_2;
        out.push((angle.cos() * r, angle.sin() * r));
    }
    out
}

pub fn glyph_sword() -> Vec<(f64, f64)> {
    poly_points(&[
        0.0, -0.95, 0.15, -0.7, 0.1, 0.3, 0.35, 0.35, 0.35, 0.45, 0.08, 0.45,
        0.08, 0.85, -0.08, 0.85, -0.08, 0.45, -0.35, 0.45, -0.35, 0.35, -0.1,
        0.3, -0.15, -0.7,
    ])
}

pub fn glyph_shield() -> Vec<(f64, f64)> {
    poly_points(&[
        -0.75, -0.85, 0.75, -0.85, 0.75, -0.2, 0.5, 0.4, 0.0, 0.9, -0.5, 0.4,
        -0.75, -0.2,
    ])
}

pub fn glyph_fire() -> Vec<(f64, f64)> {
    poly_points(&[
        0.0, -0.9, 0.35, -0.4, 0.2, -0.1, 0.65, 0.2, 0.45, 0.75, 0.0, 0.9,
        -0.45, 0.75, -0.65, 0.2, -0.2, -0.1, -0.35, -0.4,
    ])
}

pub fn glyph_frost() -> Vec<(f64, f64)> {
    star_points(6, 0.9, 0.35)
}

pub fn glyph_lightning() -> Vec<(f64, f64)> {
    poly_points(&[
        0.1, -0.95, -0.5, -0.05, -0.05, -0.05, -0.2, 0.95, 0.5, 0.05, 0.05,
        0.05,
    ])
}

pub fn glyph_heart() -> Vec<(f64, f64)> {
    poly_points(&[
        0.0, -0.4, 0.3, -0.85, 0.75, -0.7, 0.85, -0.2, 0.5, 0.35, 0.0, 0.9,
        -0.5, 0.35, -0.85, -0.2, -0.75, -0.7, -0.3, -0.85,
    ])
}

pub fn glyph_skull() -> Vec<(f64, f64)> {
    poly_points(&[
        -0.7, -0.3, -0.6, -0.75, 0.0, -0.9, 0.6, -0.75, 0.7, -0.3, 0.5, 0.3,
        0.35, 0.75, -0.35, 0.75, -0.5, 0.3,
    ])
}

pub fn get_card_glyph(name: &str) -> Option<Vec<(f64, f64)>> {
    match name {
        "sword" | "attack" => Some(glyph_sword()),
        "shield" | "armor" => Some(glyph_shield()),
        "fire" => Some(glyph_fire()),
        "frost" | "ice" => Some(glyph_frost()),
        "lightning" | "spark" => Some(glyph_lightning()),
        "heart" | "health" => Some(glyph_heart()),
        "skull" | "death" => Some(glyph_skull()),
        _ => None,
    }
}
