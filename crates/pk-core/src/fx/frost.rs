//! Frost Elemental Surface Math — Angular Worley noise crystal growth front with 6-ray radial spokes.
//!
//! PORTS: `fx/elements/frost.ts`

pub const FROST_RAMP: [u8; 4] = [1, 29, 31, 22];
pub const FROST_STOPS: [f32; 3] = [0.20, 0.52, 0.82];

/// The growth front: 0.35 of disc at birth, full by ~0.76s (age * 0.85 + 0.35), then held.
pub fn frost_growth_front(age: f32) -> f32 {
    (age * 0.85 + 0.35).clamp(0.0, 1.0)
}

/// Angular 6-fold radial spokes: abs(cos(ang * 3.0 + seed)) * 0.5 + 0.5.
pub fn frost_spokes(x: f32, y: f32, seed: f32) -> f32 {
    let ang = y.atan2(x);
    ((ang * 3.0 + seed).cos().abs() * 0.5 + 0.5).clamp(0.0, 1.0)
}

/// Computes the cold field intensity combining growth mask, straight Worley cell boundaries, spokes, and shimmer.
pub fn compute_frost_intensity(
    pos: [f32; 2],
    age: f32,
    time: f32,
    seed: f32,
    intensity: f32,
    worley_01: impl Fn(f32, f32, f32) -> f32,
    noise_01: impl Fn(f32, f32, f32) -> f32,
) -> f32 {
    let r = (pos[0] * pos[0] + pos[1] * pos[1]).sqrt();
    let t = time + seed;

    let grown = frost_growth_front(age);
    // Smoothstep mask
    let edge0 = grown;
    let edge1 = grown * 0.55;
    let mask = if edge0 > edge1 {
        let x = ((r - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
        x * x * (3.0 - 2.0 * x)
    } else {
        0.0
    };

    let spokes = frost_spokes(pos[0], pos[1], seed);

    // Cell edges: 1 - worley is bright at boundaries
    let cells = worley_01(pos[0] * 4.2, pos[1] * 4.2, t * 0.12);
    let facets = ((1.0 - cells) * 1.4).clamp(0.0, 1.0);

    let shimmer = noise_01(pos[0] * 2.6, pos[1] * 2.6, t * 0.35) * 0.18;

    (mask * (facets * 0.55 + spokes * 0.30 + shimmer) * intensity).clamp(0.0, 1.0)
}
