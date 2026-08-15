//! Draw Call Census — Attributes frame draw calls, shadow passes, and instancing savings by subsystem.
//!
//! PORTS: `dev/draw-census.ts`

#[derive(Clone, Debug, PartialEq)]
pub struct DrawRow {
    pub label: String,
    pub draws: usize,
    pub instanced: usize,
    pub instances: usize,
    pub shadow: usize,
    pub culled: usize,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DrawCensusReport {
    pub rows: Vec<DrawRow>,
    pub total_camera_draws: usize,
    pub total_shadow_draws: usize,
    pub total_frame_draws: usize,
    pub total_culled: usize,
    pub saved_by_instancing: usize,
}

/// Aggregates individual subsystem draw rows into a whole-frame census report.
pub fn compute_draw_census(rows: &[DrawRow]) -> DrawCensusReport {
    let mut total_camera_draws = 0;
    let mut total_shadow_draws = 0;
    let mut total_culled = 0;
    let mut saved_by_instancing = 0;

    for row in rows {
        total_camera_draws += row.draws;
        total_shadow_draws += row.shadow;
        total_culled += row.culled;
        if row.instances > row.instanced {
            saved_by_instancing += row.instances - row.instanced;
        }
    }

    let total_frame_draws = total_camera_draws + total_shadow_draws;

    DrawCensusReport {
        rows: rows.to_vec(),
        total_camera_draws,
        total_shadow_draws,
        total_frame_draws,
        total_culled,
        saved_by_instancing,
    }
}
