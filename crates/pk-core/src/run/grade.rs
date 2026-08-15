//! End-of-Floor Performance Grading Rubric — FLOW velocity averaging and 3-axis combat scoring.
//!
//! PORTS: `run/grade.ts`

pub const GRADE_FLOW_FULL: f32 = 6.5;
pub const GRADE_FLOW_OK: f32 = 4.0;
pub const GRADE_KILLS_FULL: f32 = 0.90;
pub const GRADE_KILLS_OK: f32 = 0.60;
pub const GRADE_COMBO_FULL: u32 = 12;
pub const GRADE_COMBO_OK: u32 = 6;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FloorGradeResult {
    pub grade: String,
    pub points: u32,
    pub gold: u32,
}

/// Computes average speed carried through the floor (flow velocity).
pub fn compute_floor_flow(level_flow_sum: f32, level_flow_t: f32) -> f32 {
    if level_flow_t <= 0.0 {
        0.0
    } else {
        level_flow_sum / level_flow_t
    }
}

/// Grades the completed floor across FLOW, Carnage (kill share), and Style (best bounce combo).
pub fn grade_floor(kills: u32, horde_size: u32, flow: f32, best_combo: u32) -> FloorGradeResult {
    let share = kills as f32 / horde_size.max(1) as f32;
    let mut pts = 0;

    // Axis 1: Flow (pace & speed maintenance)
    if flow >= GRADE_FLOW_FULL {
        pts += 2;
    } else if flow >= GRADE_FLOW_OK {
        pts += 1;
    }

    // Axis 2: Carnage (share of horde eliminated)
    if share >= GRADE_KILLS_FULL {
        pts += 2;
    } else if share >= GRADE_KILLS_OK {
        pts += 1;
    }

    // Axis 3: Style (longest wall/actor bounce combo)
    if best_combo >= GRADE_COMBO_FULL {
        pts += 2;
    } else if best_combo >= GRADE_COMBO_OK {
        pts += 1;
    }

    let (grade_str, gold) = match pts {
        6..=u32::MAX => ("S", 100),
        5 => ("A", 60),
        3 | 4 => ("B", 35),
        2 => ("C", 15),
        _ => ("D", 0),
    };

    FloorGradeResult {
        grade: grade_str.to_string(),
        points: pts,
        gold,
    }
}
