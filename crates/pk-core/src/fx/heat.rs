//! CPU Heat Spot Projector — Selects and projects up to eight hottest scene elements to RT UV coordinates.
//!
//! PORTS: `fx/heat.ts`

pub const HEAT_SPOTS: usize = 8;

#[derive(Clone, Debug, PartialEq)]
pub struct HeatSource {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub radius: f64,
    pub score: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct HeatSpotFrame {
    pub xs: [f32; HEAT_SPOTS],
    pub ys: [f32; HEAT_SPOTS],
    pub rs: [f32; HEAT_SPOTS],
    pub active_count: usize,
    pub dropped_count: usize,
}

impl Default for HeatSpotFrame {
    fn default() -> Self {
        Self {
            xs: [0.0; HEAT_SPOTS],
            ys: [0.0; HEAT_SPOTS],
            rs: [0.0; HEAT_SPOTS],
            active_count: 0,
            dropped_count: 0,
        }
    }
}

/// Gathers, ranks, and projects heat sources into normalized RT UV space with a V-flip (1 - v).
pub fn project_heat_sources(
    sources: &mut [HeatSource],
    camera_x: f64,
    camera_z: f64,
    zoom: f64,
    viewport_w: f64,
    viewport_h: f64,
) -> HeatSpotFrame {
    // Sort descending by score
    sources.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

    let mut frame = HeatSpotFrame::default();
    let count = sources.len().min(HEAT_SPOTS);
    frame.active_count = count;
    frame.dropped_count = sources.len().saturating_sub(HEAT_SPOTS);

    for (i, s) in sources.iter().take(count).enumerate() {
        // Orthographic isometric projection relative to camera
        let dx = s.x - camera_x;
        let dz = s.z - camera_z;

        // Screen space mapping centered in viewport
        let screen_x = (dx * zoom) / viewport_w + 0.5;
        let screen_y = (dz * zoom) / viewport_h + 0.5;

        // V-flip for RT UV sampling convention
        let uv_u = screen_x.clamp(0.0, 1.0) as f32;
        let uv_v = (1.0 - screen_y).clamp(0.0, 1.0) as f32;
        let uv_r = ((s.radius * zoom) / viewport_w.min(viewport_h)) as f32;

        frame.xs[i] = uv_u;
        frame.ys[i] = uv_v;
        frame.rs[i] = uv_r;
    }

    frame
}
