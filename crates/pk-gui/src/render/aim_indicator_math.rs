//! Aim Indicator Ground Geometry — Pure vector divergence and steering orientation calculations.
//!
//! PORTS: `render/aim-indicator-math.ts`

/// How divergent the steer is from the heading, as 0..1.
///
/// 0 = pointing exactly where you're already going (nothing to show), 1 = fully reversed.
/// Uses angle rather than raw dot product so the ramp is linear in degrees.
pub fn bend_fraction(mom_x: f32, mom_z: f32, steer_x: f32, steer_z: f32) -> f32 {
    let ml = (mom_x * mom_x + mom_z * mom_z).sqrt();
    let sl = (steer_x * steer_x + steer_z * steer_z).sqrt();
    if ml < 1e-6 || sl < 1e-6 {
        return 0.0;
    }
    let dot = (mom_x * steer_x + mom_z * steer_z) / (ml * sl);
    let clamped_dot = dot.clamp(-1.0, 1.0);
    let ang = clamped_dot.acos();
    ang / std::f32::consts::PI
}

/// Which side the steer sits on: +1 for right, -1 for left, 0 when collinear.
/// The XZ cross product's Y component sign.
pub fn steer_sign(mom_x: f32, mom_z: f32, steer_x: f32, steer_z: f32) -> i32 {
    let cross = mom_x * steer_z - mom_z * steer_x;
    if cross.abs() < 1e-6 {
        0
    } else if cross > 0.0 {
        1
    } else {
        -1
    }
}
