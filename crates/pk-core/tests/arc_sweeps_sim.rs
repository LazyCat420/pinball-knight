// Parity test for Arc Wall Sweeps and Rail Tangents.
// Replicates legacy/src/game/pinball-knight/maze/arc-sweeps.ts, arc-sweeps.test.ts

use pk_core::grid::{set_tile, Grid, T_FLOOR};
use pk_core::maze::arc_sweeps::{
    arc_tangent_at, has_clear_rail_runway, rail_exit, RAIL_MIN_RUNWAY,
};
use pk_core::tile_shape::ArcFeature;

#[test]
fn arc_tangent_computes_continuous_unit_vector() {
    let feature = ArcFeature {
        cx: 10.0,
        cz: 10.0,
        r: 3.0,
        a0: 0.0,
        span: std::f64::consts::FRAC_PI_2, // 90 degree arc
        solid_out: false,
        owner: Some("test"),
        kicks: Vec::new(),
        lanes: Vec::new(),
    };

    // At u = 0 (start)
    let t0 = arc_tangent_at(&feature, 0.0);
    assert!((t0.0.abs() - 0.0).abs() < 1e-4);
    assert!((t0.1 - 1.0).abs() < 1e-4);

    // At u = 1 (end)
    let t1 = arc_tangent_at(&feature, 1.0);
    assert!((t1.0 - (-1.0)).abs() < 1e-4);
    assert!((t1.1.abs() - 0.0).abs() < 1e-4);
}

#[test]
fn rail_exit_checks_forward_runway() {
    let mut g = Grid::solid(20, 20);
    for j in 1..19 {
        for i in 1..19 {
            set_tile(&mut g, i, j, T_FLOOR);
        }
    }

    let feature = ArcFeature {
        cx: 5.0,
        cz: 5.0,
        r: 3.0,
        a0: 0.0,
        span: std::f64::consts::FRAC_PI_2,
        solid_out: false,
        owner: Some("test"),
        kicks: Vec::new(),
        lanes: Vec::new(),
    };

    let (ex, ez, dx, dz) = rail_exit(&feature);
    assert_eq!(ex, 5);
    assert_eq!(ez, 8);

    // Runway is open floor
    assert!(has_clear_rail_runway(&g, ex, ez, dx, dz, RAIL_MIN_RUNWAY));
}
