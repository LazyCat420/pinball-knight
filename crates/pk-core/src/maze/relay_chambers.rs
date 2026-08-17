//! Relay Chambers — two-focus ellipse bank arcs connecting room doorway mouths.
//!
//! PORTS: `maze/relay-chambers.ts`

pub const RELAY_STANDOFF: f64 = 1.6;
pub const RELAY_MIN_SPAN: usize = 5;
pub const RELAY_MAX_SPAN: usize = 26;
pub const RELAY_SEGMENTS: usize = 5;
pub const RELAY_MAX_PER_FLOOR: usize = 3;
pub const DEFAULT_RELAY_STANDOFF: f64 = 0.85;

#[derive(Debug, Clone, PartialEq)]
pub struct RelayEllipse {
    pub f1: (f64, f64),
    pub f2: (f64, f64),
    pub center: (f64, f64),
    pub a: f64,     // Semi-major axis
    pub b: f64,     // Semi-minor axis
    pub c: f64,     // Linear eccentricity (half focal distance)
    pub angle: f64, // Rotation of the major axis
}

impl RelayEllipse {
    /// Computes point on the ellipse given parametric angle theta (-PI..PI).
    pub fn point_at(&self, theta: f64) -> (f64, f64) {
        let x_local = self.a * theta.cos();
        let y_local = self.b * theta.sin();

        let cos_a = self.angle.cos();
        let sin_a = self.angle.sin();

        let wx = self.center.0 + x_local * cos_a - y_local * sin_a;
        let wz = self.center.1 + x_local * sin_a + y_local * cos_a;

        (wx, wz)
    }

    /// Computes normal vector at point on the ellipse.
    pub fn normal_at(&self, theta: f64) -> (f64, f64) {
        // Outward normal in local space: (cos(theta)/a, sin(theta)/b)
        let nx_local = theta.cos() / self.a;
        let ny_local = theta.sin() / self.b;
        let len = (nx_local * nx_local + ny_local * ny_local).sqrt();
        let (nx_unit, ny_unit) = (nx_local / len, ny_local / len);

        let cos_a = self.angle.cos();
        let sin_a = self.angle.sin();

        let wx = nx_unit * cos_a - ny_unit * sin_a;
        let wz = nx_unit * sin_a + ny_unit * cos_a;

        (wx, wz)
    }
}

/// Constructs a relay ellipse whose two foci lie on doorway mouths `d1` and `d2`.
pub fn compute_relay_ellipse(
    d1: (f64, f64),
    d2: (f64, f64),
    standoff: f64,
) -> Option<RelayEllipse> {
    let dx = d2.0 - d1.0;
    let dz = d2.1 - d1.1;
    let focal_dist = (dx * dx + dz * dz).sqrt();

    if focal_dist < 0.1 {
        return None;
    }

    let c = focal_dist * 0.5;
    let a = c + standoff.max(0.1);
    let b = (a * a - c * c).sqrt();

    let center = ((d1.0 + d2.0) * 0.5, (d1.1 + d2.1) * 0.5);
    let angle = dz.atan2(dx);

    Some(RelayEllipse {
        f1: d1,
        f2: d2,
        center,
        a,
        b,
        c,
        angle,
    })
}

pub fn relay_ellipse(
    d1: (f64, f64),
    d2: (f64, f64),
    standoff: f64,
) -> Option<RelayEllipse> {
    compute_relay_ellipse(d1, d2, standoff)
}

pub fn author_relay_chambers(
    doorways: &[(f64, f64)],
    standoff: f64,
) -> Vec<RelayEllipse> {
    let mut ellipses = Vec::new();
    for i in (0..doorways.len()).step_by(2) {
        if i + 1 < doorways.len() {
            if let Some(el) = compute_relay_ellipse(doorways[i], doorways[i + 1], standoff) {
                ellipses.push(el);
            }
        }
    }
    ellipses
}

/// Generates discrete polygon samples along a section of the relay ellipse boundary.
pub fn sample_relay_arc(
    ellipse: &RelayEllipse,
    theta_start: f64,
    theta_end: f64,
    num_points: usize,
) -> Vec<(f64, f64)> {
    if num_points < 2 {
        return vec![ellipse.point_at(theta_start)];
    }

    let mut points = Vec::with_capacity(num_points);
    let step = (theta_end - theta_start) / (num_points - 1) as f64;

    for i in 0..num_points {
        let theta = theta_start + step * i as f64;
        points.push(ellipse.point_at(theta));
    }

    points
}
