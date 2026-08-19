//! CARD GLYPHS — Every mark on a card face, drawn as resolution-independent vector paths and polygons.
//!
//! Replaces all system emoji dependencies with crisp vector geometry for card face elements,
//! energy emblems, rarity stars/pips, shiny sparkles, and large mythic sigil plate etchings.
//!
//! PORTS: `render/card-glyphs.ts`

use std::collections::HashMap;

pub type GlyphPath = Vec<(f64, f64)>;

pub fn poly_points(pts: &[f64]) -> GlyphPath {
    let mut out = Vec::with_capacity(pts.len() / 2);
    let mut i = 0;
    while i + 1 < pts.len() {
        out.push((pts[i], pts[i + 1]));
        i += 2;
    }
    out
}

pub fn star_points(points: usize, inner_r: f64, outer_r: f64) -> GlyphPath {
    let mut out = Vec::with_capacity(points * 2);
    let step = std::f64::consts::PI / points as f64;
    for i in 0..(points * 2) {
        let r = if i % 2 == 0 { outer_r } else { inner_r };
        let angle = i as f64 * step - std::f64::consts::FRAC_PI_2;
        out.push((angle.cos() * r, angle.sin() * r));
    }
    out
}

pub fn bezier_quadratic(p0: (f64, f64), p1: (f64, f64), p2: (f64, f64), steps: usize) -> GlyphPath {
    let mut out = Vec::with_capacity(steps + 1);
    for i in 0..=steps {
        let t = i as f64 / steps as f64;
        let u = 1.0 - t;
        let x = u * u * p0.0 + 2.0 * u * t * p1.0 + t * t * p2.0;
        let y = u * u * p0.1 + 2.0 * u * t * p1.1 + t * t * p2.1;
        out.push((x, y));
    }
    out
}

pub fn bezier_cubic(
    p0: (f64, f64),
    p1: (f64, f64),
    p2: (f64, f64),
    p3: (f64, f64),
    steps: usize,
) -> GlyphPath {
    let mut out = Vec::with_capacity(steps + 1);
    for i in 0..=steps {
        let t = i as f64 / steps as f64;
        let u = 1.0 - t;
        let x = u * u * u * p0.0 + 3.0 * u * u * t * p1.0 + 3.0 * u * t * t * p2.0 + t * t * t * p3.0;
        let y = u * u * u * p0.1 + 3.0 * u * u * t * p1.1 + 3.0 * u * t * t * p2.1 + t * t * t * p3.1;
        out.push((x, y));
    }
    out
}

// ── ELEMENT EMBLEMS ───────────────────────────────────────────────────────────

/// STORM — a lightning bolt.
pub fn glyph_bolt() -> GlyphPath {
    poly_points(&[
        0.12, -1.0, -0.62, 0.1, -0.08, 0.1, -0.3, 1.0, 0.62, -0.18, 0.05, -0.18,
    ])
}

/// BLAZE — a flame, teardrop with a curled tip.
pub fn glyph_flame() -> GlyphPath {
    let mut out = Vec::new();
    out.extend(bezier_cubic((0.0, -1.0), (0.62, -0.34), (0.86, 0.16), (0.52, 0.6), 8));
    out.extend(bezier_cubic((0.52, 0.6), (0.28, 0.92), (-0.3, 1.02), (-0.6, 0.66), 8));
    out.extend(bezier_cubic((-0.6, 0.66), (-0.92, 0.26), (-0.66, -0.28), (-0.2, -0.52), 8));
    out.extend(bezier_cubic((-0.2, -0.52), (-0.34, -0.16), (-0.16, 0.06), (0.04, 0.02), 8));
    out.extend(bezier_cubic((0.04, 0.02), (0.3, -0.04), (0.26, -0.5), (0.0, -1.0), 8));
    out
}

pub fn glyph_fire() -> GlyphPath {
    glyph_flame()
}

/// FROST — a six-armed snowflake with barbs.
pub fn glyph_frost() -> GlyphPath {
    let mut out = Vec::new();
    for i in 0..6 {
        let a = (i as f64 / 6.0) * std::f64::consts::PI * 2.0;
        let cx = a.cos();
        let cy = a.sin();
        out.push((0.0, 0.0));
        out.push((cx, cy));
        for &t in &[0.5, 0.78] {
            for &s in &[-1.0, 1.0] {
                let ba = a + s * 0.72;
                out.push((cx * t, cy * t));
                out.push((cx * t + ba.cos() * 0.3, cy * t + ba.sin() * 0.3));
            }
        }
    }
    out
}

/// GUARD — a kite shield with a centre rib.
pub fn glyph_shield() -> GlyphPath {
    let mut out = Vec::new();
    out.push((0.0, -0.94));
    out.push((0.8, -0.62));
    out.extend(bezier_cubic((0.8, -0.62), (0.8, 0.24), (0.46, 0.76), (0.0, 1.0), 8));
    out.extend(bezier_cubic((0.0, 1.0), (-0.46, 0.76), (-0.8, 0.24), (-0.8, -0.62), 8));
    out
}

pub fn glyph_armor() -> GlyphPath {
    glyph_shield()
}

/// POWER — a single upright blade with crossguard, grip, and pommel.
pub fn glyph_blades() -> GlyphPath {
    let mut out = poly_points(&[
        0.0, -1.05, 0.26, -0.62, 0.22, 0.2, -0.22, 0.2, -0.26, -0.62,
    ]);
    out.extend(poly_points(&[
        -0.62, 0.2, 0.62, 0.2, 0.62, 0.4, -0.62, 0.4,
    ]));
    out.extend(poly_points(&[
        -0.13, 0.4, 0.13, 0.4, 0.13, 0.84, -0.13, 0.84,
    ]));
    out
}

pub fn glyph_sword() -> GlyphPath {
    glyph_blades()
}

/// MOMENTUM — a comet head with three trailing speed lines.
pub fn glyph_momentum() -> GlyphPath {
    let mut out = Vec::new();
    let steps = 16;
    for i in 0..=steps {
        let a = (i as f64 / steps as f64) * std::f64::consts::PI * 2.0;
        out.push((0.44 + a.cos() * 0.42, a.sin() * 0.42));
    }
    for &(oy, len, w) in &[(0.0, 1.5, 0.24), (-0.42, 1.06, 0.15), (0.42, 1.06, 0.15)] {
        out.extend(poly_points(&[
            0.2,
            oy - w,
            0.2 - len,
            oy - w * 0.34,
            0.2 - len,
            oy + w * 0.34,
            0.2,
            oy + w,
        ]));
    }
    out
}

/// SWIFT — a chevron pair.
pub fn glyph_swift() -> GlyphPath {
    let mut out = Vec::new();
    for &dx in &[-0.34, 0.3] {
        out.push((dx - 0.3, -0.72));
        out.push((dx + 0.36, 0.0));
        out.push((dx - 0.3, 0.72));
    }
    out
}

/// Blood drop.
pub fn glyph_drop() -> GlyphPath {
    let mut out = Vec::new();
    out.push((0.0, -1.0));
    out.extend(bezier_cubic((0.0, -1.0), (0.66, -0.16), (0.72, 0.36), (0.32, 0.76), 8));
    out.extend(bezier_cubic((0.32, 0.76), (-0.06, 1.1), (-0.62, 0.9), (-0.76, 0.4), 8));
    out.extend(bezier_cubic((-0.76, 0.4), (-0.86, 0.0), (-0.5, -0.4), (0.0, -1.0), 8));
    out
}

pub fn glyph_fang() -> GlyphPath {
    poly_points(&[
        -0.68, -0.78, 0.68, -0.78, 0.3, -0.3, 0.16, 0.98, -0.02, -0.24, -0.24, 0.7, -0.34, -0.34,
    ])
}

pub fn glyph_sparkle() -> GlyphPath {
    let mut out = Vec::new();
    out.push((0.0, -1.0));
    out.extend(bezier_quadratic((0.0, -1.0), (0.14, -0.14), (1.0, 0.0), 6));
    out.extend(bezier_quadratic((1.0, 0.0), (0.14, 0.14), (0.0, 1.0), 6));
    out.extend(bezier_quadratic((0.0, 1.0), (-0.14, 0.14), (-1.0, 0.0), 6));
    out.extend(bezier_quadratic((-1.0, 0.0), (-0.14, -0.14), (0.0, -1.0), 6));
    out
}

pub fn glyph_pip() -> GlyphPath {
    star_points(4, 0.34, 1.0)
}

pub fn glyph_heart() -> GlyphPath {
    let mut out = Vec::new();
    out.push((0.0, 0.92));
    out.extend(bezier_cubic((0.0, 0.92), (-0.94, 0.2), (-0.82, -0.62), (-0.4, -0.72), 8));
    out.extend(bezier_cubic((-0.4, -0.72), (-0.16, -0.78), (-0.02, -0.56), (0.0, -0.4), 6));
    out.extend(bezier_cubic((0.0, -0.4), (0.02, -0.56), (0.16, -0.78), (0.4, -0.72), 6));
    out.extend(bezier_cubic((0.4, -0.72), (0.82, -0.62), (0.94, 0.2), (0.0, 0.92), 8));
    out
}

pub fn glyph_skull() -> GlyphPath {
    poly_points(&[
        -0.5, -0.5, 0.5, -0.5, 0.5, 0.2, 0.2, 0.6, -0.2, 0.6, -0.5, 0.2,
    ])
}

pub fn glyph_gold() -> GlyphPath {
    star_points(8, 0.5, 0.8)
}

pub fn glyph_potion() -> GlyphPath {
    poly_points(&[
        -0.2, -0.8, 0.2, -0.8, 0.2, -0.4, 0.6, 0.3, 0.4, 0.8, -0.4, 0.8, -0.6, 0.3, -0.2, -0.4,
    ])
}

// ── MYTHIC SIGILS ─────────────────────────────────────────────────────────────

/// WORLD BREAKER — a cracked world-rune: a ringed globe split by a fault.
pub fn sigil_world_breaker() -> GlyphPath {
    let mut out = Vec::new();
    let steps = 32;
    for i in 0..=steps {
        let a = (i as f64 / steps as f64) * std::f64::consts::PI * 2.0;
        out.push((a.cos() * 0.86, a.sin() * 0.86));
    }
    // Latitude bands
    for &t in &[-0.42, 0.0, 0.42] {
        let r = (0.86_f64 * 0.86_f64 - t * t).max(0.0_f64).sqrt();
        for i in 0..=steps {
            let a = (i as f64 / steps as f64) * std::f64::consts::PI * 2.0;
            out.push((a.cos() * r, t + a.sin() * 0.2));
        }
    }
    // Meridian
    for i in 0..=steps {
        let a = (i as f64 / steps as f64) * std::f64::consts::PI * 2.0;
        out.push((a.cos() * 0.3, a.sin() * 0.86));
    }
    // The fault
    out.extend(poly_points(&[
        -0.16, -1.12, 0.12, -0.4, -0.2, -0.1, 0.2, 0.34, -0.06, 0.66, 0.14, 1.12,
    ]));
    // Shards
    for &(sx, sy, ss) in &[
        (-0.72, -0.86, 0.14),
        (0.82, -0.6, 0.1),
        (0.68, 0.84, 0.13),
        (-0.86, 0.62, 0.09),
    ] {
        out.extend(poly_points(&[
            sx,
            sy - ss,
            sx + ss,
            sy,
            sx,
            sy + ss,
            sx - ss,
            sy,
        ]));
    }
    out
}

/// TIME RIPPER — an hourglass whose lower bulb has shattered.
pub fn sigil_time_ripper() -> GlyphPath {
    let mut out = Vec::new();
    out.push((-0.72, -0.96));
    out.push((0.72, -0.96));
    out.push((-0.72, 0.96));
    out.push((0.72, 0.96));
    // Upper bulb
    out.extend(bezier_cubic((-0.58, -0.9), (-0.58, -0.28), (-0.12, -0.14), (0.0, 0.0), 8));
    out.extend(bezier_cubic((0.0, 0.0), (0.12, -0.14), (0.58, -0.28), (0.58, -0.9), 8));
    // Falling sand
    out.push((0.0, 0.04));
    out.push((0.0, 0.52));
    // Lower bulb intact left
    out.extend(bezier_cubic((0.0, 0.0), (-0.12, 0.14), (-0.58, 0.28), (-0.58, 0.9), 8));
    // Right wall broken
    out.extend(bezier_cubic((0.0, 0.0), (0.12, 0.14), (0.44, 0.24), (0.53, 0.46), 6));
    out.push((0.42, 0.54));
    out.push((0.56, 0.64));
    out
}

/// TEMPEST CROWN — a circlet of storm-spines around an eye of calm.
pub fn sigil_tempest_crown() -> GlyphPath {
    let mut out = Vec::new();
    for i in 0..=130 {
        let t = i as f64 / 130.0;
        let a = t * std::f64::consts::PI * 4.2;
        let rad = 0.08 + t * 0.42;
        out.push((a.cos() * rad, a.sin() * rad));
    }
    let steps = 24;
    for i in 0..=steps {
        let a = (i as f64 / steps as f64) * std::f64::consts::PI * 2.0;
        out.push((a.cos() * 0.66, a.sin() * 0.66));
    }
    for i in 0..12 {
        let a = (i as f64 / 12.0) * std::f64::consts::PI * 2.0 - std::f64::consts::FRAC_PI_2;
        let len = if i % 2 == 1 { 0.86 } else { 1.04 };
        let w = 0.075;
        out.extend(poly_points(&[
            (a - w).cos() * 0.66,
            (a - w).sin() * 0.66,
            a.cos() * len,
            a.sin() * len,
            (a + w).cos() * 0.66,
            (a + w).sin() * 0.66,
        ]));
    }
    out
}

/// GLASS CANNON — a rib-cage snapped open down one side.
pub fn sigil_glass_cannon() -> GlyphPath {
    let mut out = Vec::new();
    // Sternum
    out.push((0.0, -1.02));
    out.push((0.0, 0.72));
    // Vertebrae ticks
    for i in 0..7 {
        let y = -0.92 + (i as f64) * 0.26;
        out.push((-0.09, y));
        out.push((0.09, y));
    }
    // Ribs
    for i in 0..6 {
        let y = -0.92 + (i as f64) * 0.3;
        let span = 0.9 - ((i as f64) - 2.1).abs() * 0.12;
        let drop = 0.2;
        for &side in &[-1.0, 1.0] {
            let broken = side > 0.0 && (i == 2 || i == 3);
            let frac = if broken { 0.45 } else { 1.0 };
            let steps = 12;
            for s in 0..=steps {
                let u = (s as f64 / steps as f64) * frac;
                let rx = side * span * (u * std::f64::consts::FRAC_PI_2).sin();
                let ry = y + drop * (0.45 * u + 0.55 * u * u * u);
                out.push((rx, ry));
            }
        }
    }
    out
}

/// BLOOD PACT — a heart pierced by a dagger, bleeding.
pub fn sigil_blood_pact() -> GlyphPath {
    let mut out = glyph_heart();
    out.extend(poly_points(&[
        -0.07, -1.06, 0.07, -1.06, 0.05, 0.5, 0.0, 0.62, -0.05, 0.5,
    ]));
    out.extend(poly_points(&[
        -0.3, -1.2, 0.3, -1.2, 0.3, -1.1, -0.3, -1.1,
    ]));
    out
}

/// Fallback for a sourceless card with no bespoke sigil — an arcane seal.
pub fn sigil_seal() -> GlyphPath {
    let mut out = Vec::new();
    let steps = 24;
    for i in 0..=steps {
        let a = (i as f64 / steps as f64) * std::f64::consts::PI * 2.0;
        out.push((a.cos() * 0.94, a.sin() * 0.94));
    }
    for i in 0..=steps {
        let a = (i as f64 / steps as f64) * std::f64::consts::PI * 2.0;
        out.push((a.cos() * 0.78, a.sin() * 0.78));
    }
    out.extend(star_points(5, 0.42, 0.78));
    out
}

pub fn card_sigils_map() -> HashMap<&'static str, fn() -> GlyphPath> {
    let mut m = HashMap::new();
    m.insert("worldbreaker", sigil_world_breaker as fn() -> GlyphPath);
    m.insert("timeripper", sigil_time_ripper as fn() -> GlyphPath);
    m.insert("tempestcrown", sigil_tempest_crown as fn() -> GlyphPath);
    m.insert("gladeath", sigil_glass_cannon as fn() -> GlyphPath);
    m.insert("bloodpact", sigil_blood_pact as fn() -> GlyphPath);
    m
}

pub fn sigil_for(id: &str) -> GlyphPath {
    match id {
        "worldbreaker" => sigil_world_breaker(),
        "timeripper" => sigil_time_ripper(),
        "tempestcrown" => sigil_tempest_crown(),
        "gladeath" => sigil_glass_cannon(),
        "bloodpact" => sigil_blood_pact(),
        _ => sigil_seal(),
    }
}

pub fn get_card_glyph(name: &str) -> Option<GlyphPath> {
    match name {
        "sword" | "blades" => Some(glyph_blades()),
        "shield" | "armor" => Some(glyph_shield()),
        "flame" | "fire" => Some(glyph_flame()),
        "frost" => Some(glyph_frost()),
        "bolt" | "storm" => Some(glyph_bolt()),
        "heart" => Some(glyph_heart()),
        "skull" => Some(glyph_skull()),
        "gold" => Some(glyph_gold()),
        "potion" => Some(glyph_potion()),
        "momentum" => Some(glyph_momentum()),
        "swift" => Some(glyph_swift()),
        "drop" => Some(glyph_drop()),
        "fang" => Some(glyph_fang()),
        "sparkle" => Some(glyph_sparkle()),
        "pip" => Some(glyph_pip()),
        "worldbreaker" => Some(sigil_world_breaker()),
        "timeripper" => Some(sigil_time_ripper()),
        "tempestcrown" => Some(sigil_tempest_crown()),
        "gladeath" => Some(sigil_glass_cannon()),
        "bloodpact" => Some(sigil_blood_pact()),
        "seal" => Some(sigil_seal()),
        _ => None,
    }
}

pub fn draw_glyph(_name: &str, _x: f64, _y: f64, _r: f64) {}
