//! Comprehensive test suite for maze/arc-sweeps.ts arc sweep fillets, orbit islands, and oriented rails.

use pk_core::grid::{set_tile, Grid, T_FLOOR};
use pk_core::maze::arc_sweeps::*;
use pk_core::tile_shape::ArcFeature;

#[test]
fn arc_sweeps_constants_match_oracle() {
    assert_eq!(FILLET_RADII, [3, 2]);
    assert_eq!(MAX_SWEEPS_PER_FLOOR, 96);
    assert_eq!(ORBIT_RADIUS, 2.3);
    assert_eq!(ORBIT_RING, 1.6);
    assert_eq!(KICK_CHANCE, 0.22);
    assert_eq!(KICK_BAND_FRAC, 0.62);
    assert_eq!(KICK_ISLAND_BANDS, 3);
    assert_eq!(KICK_ISLAND_SPAN, 0.62);
    assert_eq!(KICK_MAX_PER_FLOOR, 6);
    assert_eq!(KICK_MIN_SPAN, 0.9);
    assert_eq!(LANE_CHANCE, 0.92);
    assert_eq!(LANE_BAND_FRAC, 0.94);
    assert_eq!(LANE_MAX_PER_FLOOR, 16);
    assert_eq!(LANE_MIN_SPAN, 0.9);
    assert_eq!(RAIL_RIDE_INSET, 0.3);
    assert_eq!(RAIL_MIN_RUNWAY, 5);
}

#[test]
fn quadrant_a0_computations() {
    assert_eq!(quadrant_a0(1, -1), -std::f64::consts::FRAC_PI_2);
    assert_eq!(quadrant_a0(1, 1), 0.0);
    assert_eq!(quadrant_a0(-1, 1), std::f64::consts::FRAC_PI_2);
    assert_eq!(quadrant_a0(-1, -1), std::f64::consts::PI);
}

#[test]
fn centred_band_and_lane_creation() {
    let band = centred_band(0.0, std::f64::consts::PI, 0.5);
    assert_eq!(band.span, std::f64::consts::PI * 0.5);
    assert_eq!(band.a0, std::f64::consts::PI * 0.25);

    let lane = centred_lane(0.0, std::f64::consts::PI, 0.8, true);
    assert_eq!(lane.span, std::f64::consts::PI * 0.8);
    assert_eq!(lane.a0, std::f64::consts::PI * 0.1);
    assert!(lane.cw);
}

#[test]
fn rail_exit_and_runway_clearance() {
    let mut g = Grid::solid(16, 16);
    for j in 0..16 {
        for i in 0..16 {
            set_tile(&mut g, i, j, T_FLOOR);
        }
    }

    let lane = centred_lane(0.0, std::f64::consts::FRAC_PI_2, 0.9, true);
    let f = ArcFeature {
        cx: 8.5,
        cz: 8.5,
        r: 2.0,
        a0: 0.0,
        span: std::f64::consts::FRAC_PI_2,
        solid_out: true,
        owner: Some("sweep"),
        kicks: Vec::new(),
        lanes: vec![lane],
    };

    let exit_cw = rail_exit(&g, &f, &f.lanes[0], true);
    assert!(exit_cw.is_some());
    let exit = exit_cw.unwrap();

    let clear = has_clear_rail_runway(&g, exit.i, exit.j, exit.tx, exit.tz, 5);
    assert!(clear);
}

#[test]
fn author_arc_sweeps_and_stamp_orbit_island() {
    let mut g = Grid::solid(20, 20);
    for j in 0..20 {
        for i in 0..20 {
            set_tile(&mut g, i, j, T_FLOOR);
        }
    }

    let occupied = |_i, _j| false;
    let mut rng_val = 0.1;
    let mut rng = || {
        rng_val = (rng_val + 0.1) % 1.0;
        rng_val
    };

    let island = stamp_orbit_island(&mut g, (10, 10), &occupied, &mut rng);
    assert!(island.is_some());
    assert_eq!(g.arcs.len(), 1);

    let count = author_arc_sweeps(&mut g, (10, 10), &occupied, &mut rng);
    let _ = count;
}
