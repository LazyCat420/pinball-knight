// Parity test for Arc Wall Sweeps and Rail Tangents.
// Replicates legacy/src/game/pinball-knight/maze/arc-sweeps.ts, arc-sweeps.test.ts

use pk_core::grid::{set_tile, Grid, T_FLOOR};
use pk_core::maze::arc_sweeps::{
    arc_tangent_at, has_clear_rail_runway, rail_exit,
};
use pk_core::tile_shape::{ArcFeature, LaneBand};

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

    let lane = LaneBand {
        a0: 0.0,
        span: std::f64::consts::FRAC_PI_2,
        cw: true,
        cooldown_t: 0.0,
        hit_t: -1.0,
    };

    let exit = rail_exit(&g, &feature, &lane, true).unwrap();
    assert_eq!(exit.i, 4);
    assert_eq!(exit.j, 8);
    assert_eq!(exit.di, -1);
    assert_eq!(exit.dj, 0);

    // Runway is open floor (3 tiles from x=4 to wall at x=0)
    assert!(has_clear_rail_runway(&g, exit.i, exit.j, exit.di, exit.dj, 3));
}
