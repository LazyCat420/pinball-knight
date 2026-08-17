// Parity test for Arc Wall Sweeps and Rail Tangents.
// Replicates legacy/src/game/pinball-knight/maze/arc-sweeps.ts, arc-sweeps.test.ts

use pk_core::grid::{set_tile, Grid, T_FLOOR};
use pk_core::maze::arc_sweeps::{
    arc_tangent_at, centred_lane, has_clear_rail_runway, rail_exit, RAIL_MIN_RUNWAY,
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

    let lane = centred_lane(0.0, std::f64::consts::FRAC_PI_2, 0.9, true);
    let feature = ArcFeature {
        cx: 10.0,
        cz: 10.0,
        r: 3.0,
        a0: 0.0,
        span: std::f64::consts::FRAC_PI_2,
        solid_out: true,
        owner: Some("test"),
        kicks: Vec::new(),
        lanes: vec![lane],
    };

    let exit_opt = rail_exit(&g, &feature, &feature.lanes[0], true);
    assert!(exit_opt.is_some());
    let exit = exit_opt.unwrap();

    // Runway is open floor
    assert!(has_clear_rail_runway(&g, exit.i, exit.j, exit.tx, exit.tz, RAIL_MIN_RUNWAY));
}
