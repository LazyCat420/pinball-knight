// Parity test suite for Uniform Spacing Grid Accelerator.
// Replicates legacy/src/game/pinball-knight/engine/spacing-grid.ts

use pk_core::maze::spacing_grid::{Metric, SpacingGrid};

#[test]
fn spacing_grid_euclid_matches_brute_force_oracle() {
    let mut grid = SpacingGrid::new(5.0, Metric::Euclid);
    let mut oracle_points: Vec<(i32, i32)> = Vec::new();

    // Insert 50 structured points
    for i in 0..50 {
        let x = (i * 13) % 100 - 50;
        let y = (i * 17) % 100 - 50;
        grid.add(x, y);
        oracle_points.push((x, y));
    }

    assert_eq!(grid.size(), 50);

    // Query 100 random positions against both grid and linear scan
    for q in 0..100 {
        let qx = (q * 7) % 120 - 60;
        let qy = (q * 11) % 120 - 60;

        let grid_hit = grid.occupied(qx, qy);
        let oracle_hit = oracle_points.iter().any(|&(px, py)| {
            let dx = (px - qx) as f32;
            let dy = (py - qy) as f32;
            (dx * dx + dy * dy).sqrt() < 5.0
        });

        assert_eq!(grid_hit, oracle_hit, "Mismatch at ({}, {})", qx, qy);
    }
}

#[test]
fn spacing_grid_manhattan_matches_brute_force_oracle() {
    let mut grid = SpacingGrid::new(6.0, Metric::Manhattan);
    let mut oracle_points: Vec<(i32, i32)> = Vec::new();

    for i in 0..50 {
        let x = (i * 19) % 100 - 50;
        let y = (i * 23) % 100 - 50;
        grid.add(x, y);
        oracle_points.push((x, y));
    }

    for q in 0..100 {
        let qx = (q * 5) % 120 - 60;
        let qy = (q * 9) % 120 - 60;

        let grid_hit = grid.occupied(qx, qy);
        let oracle_hit = oracle_points.iter().any(|&(px, py)| {
            let dx = (px - qx).abs() as f32;
            let dy = (py - qy).abs() as f32;
            (dx + dy) < 6.0
        });

        assert_eq!(
            grid_hit, oracle_hit,
            "Manhattan mismatch at ({}, {})",
            qx, qy
        );
    }
}

#[test]
fn zero_radius_never_occupies() {
    let mut grid = SpacingGrid::new(0.0, Metric::Euclid);
    grid.add(10, 10);
    assert!(!grid.occupied(10, 10));
}
