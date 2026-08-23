// Parity test suite for Draw Call Census.
// Replicates legacy/src/game/pinball-knight/dev/draw-census.ts

use pk_core::profiler::draw_census::{compute_draw_census, DrawRow};

#[test]
fn compute_draw_census_aggregates_frame_metrics() {
    let rows = vec![
        DrawRow {
            label: "maze_walls".to_string(),
            draws: 1,
            instanced: 1,
            instances: 450,
            shadow: 1,
            culled: 0,
        },
        DrawRow {
            label: "zombies".to_string(),
            draws: 25,
            instanced: 0,
            instances: 0,
            shadow: 25,
            culled: 15,
        },
        DrawRow {
            label: "torches".to_string(),
            draws: 8,
            instanced: 0,
            instances: 0,
            shadow: 0,
            culled: 32,
        },
    ];

    let report = compute_draw_census(&rows);
    assert_eq!(report.rows.len(), 3);
    assert_eq!(report.total_camera_draws, 34); // 1 + 25 + 8
    assert_eq!(report.total_shadow_draws, 26); // 1 + 25 + 0
    assert_eq!(report.total_frame_draws, 60); // 34 + 26
    assert_eq!(report.total_culled, 47); // 0 + 15 + 32
    assert_eq!(report.saved_by_instancing, 449); // 450 - 1
}
