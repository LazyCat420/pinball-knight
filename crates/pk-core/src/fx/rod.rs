//! Lightning Rod Elemental Surface Math — 11Hz shallow electrical hum, pinpoint power core, and creeping filaments.
//!
//! PORTS: `fx/elements/rod.ts`

pub const ROD_RAMP: [u8; 4] = [29, 31, 22, 18];
pub const ROD_STOPS: [f32; 3] = [0.28, 0.60, 0.88];

/// Fast, shallow electrical hum: sin(t * 11.0) * 0.12 + 1.0.
pub fn compute_rod_hum(time: f32, seed: f32) -> f32 {
    let t = time + seed;
    (t * 11.0).sin() * 0.12 + 1.0
}

/// Hard pinpoint core: pow(clamp(1 - r, 0, 1), 8.0) * hum.
pub fn compute_rod_core(r: f32, hum: f32) -> f32 {
    let base = (1.0 - r).clamp(0.0, 1.0);
    base.powi(8) * hum
}

/// Charged resonant ring at fixed radius r = 0.52 * hum.
pub fn compute_rod_ring(r: f32, hum: f32) -> f32 {
    let ring_r = 0.52 * hum;
    let dist = (r - ring_r).abs();
    // smoothstep(0.10, 0.0, dist) * 0.55
    if dist >= 0.10 {
        0.0
    } else if dist <= 0.0 {
        0.55
    } else {
        let x = 1.0 - (dist / 0.10);
        x * x * (3.0 - 2.0 * x) * 0.55
    }
}

/// Computes the total electrical charge intensity of the lightning rod.
pub fn compute_rod_intensity(
    pos: [f32; 2],
    time: f32,
    seed: f32,
    intensity: f32,
    noise_01: impl Fn(f32, f32, f32) -> f32,
) -> f32 {
    let r = (pos[0] * pos[0] + pos[1] * pos[1]).sqrt();
    let t = time + seed;
    let hum = compute_rod_hum(time, seed);

    let core = compute_rod_core(r, hum);
    let ring = compute_rod_ring(r, hum);

    let ang = pos[1].atan2(pos[0]);
    // smoothstep(1.0, 0.15, r)
    let falloff = if r >= 1.0 {
        0.0
    } else if r <= 0.15 {
        1.0
    } else {
        let x = (1.0 - r) / (1.0 - 0.15);
        x * x * (3.0 - 2.0 * x)
    };

    let fil = noise_01(ang.cos() * 3.0, ang.sin() * 3.0, t * 0.9) * falloff * 0.34;

    ((core + ring + fil) * intensity).clamp(0.0, 1.0)
}
