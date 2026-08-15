// Parity test suite for CPU Heat Spot Projector.
// Replicates legacy/src/game/pinball-knight/fx/heat.ts

use pk_core::fx::heat::{project_heat_sources, HeatSource, HEAT_SPOTS};

#[test]
fn heat_projector_limits_to_eight_spots_and_tracks_dropped() {
    let mut sources: Vec<HeatSource> = (0..12)
        .map(|i| HeatSource {
            x: i as f64 * 10.0,
            y: 0.0,
            z: i as f64 * 10.0,
            radius: 5.0,
            score: (i + 1) as f64 * 10.0,
        })
        .collect();

    let frame = project_heat_sources(&mut sources, 0.0, 0.0, 1.0, 800.0, 600.0);

    assert_eq!(frame.active_count, HEAT_SPOTS);
    assert_eq!(frame.dropped_count, 4);

    // Highest score was element 11 (score 120)
    // It should be the first slot in the frame
    assert!(frame.xs[0] > 0.5);
    assert!(frame.ys[0] < 0.5); // Due to V-flip
}

#[test]
fn heat_projector_applies_v_flip_to_uv() {
    let mut sources = vec![HeatSource {
        x: 0.0,
        y: 0.0,
        z: 0.0, // Center of camera
        radius: 10.0,
        score: 100.0,
    }];

    let frame = project_heat_sources(&mut sources, 0.0, 0.0, 1.0, 800.0, 600.0);

    assert_eq!(frame.active_count, 1);
    assert_eq!(frame.dropped_count, 0);
    // Center of screen should map to UV (0.5, 0.5)
    assert!((frame.xs[0] - 0.5).abs() < 1e-4);
    assert!((frame.ys[0] - 0.5).abs() < 1e-4);
}
