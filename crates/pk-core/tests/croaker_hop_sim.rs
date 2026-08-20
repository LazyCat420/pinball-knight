// Parity test for Croaker Hop Trajectory and Low-Wall Traversal.
// Replicates legacy/src/game/pinball-knight/entities/croaker-hop.test.ts

use pk_core::enemies::{CROAKER_HOP_BOUNCES, CROAKER_HOP_MIN_RANGE};
use pk_core::grid::{is_low_wall, set_tile, Grid, T_FLOOR, T_WALL};
use pk_core::monsters::croaker::step_croaker_hop;
use pk_core::monsters::types::{EnemyKind, EnemyMode, LiveMonster};

const W: i32 = 21;

fn open_grid() -> Grid {
    let mut g = Grid::solid(W, W);
    for t in g.t.iter_mut() {
        *t = T_FLOOR;
    }
    g
}

fn wx(i: i32) -> f64 {
    f64::from(i) - f64::from(W) / 2.0 + 0.5
}

#[test]
fn is_low_wall_predicate_matches_camera_side_rim() {
    let mut g = open_grid();
    set_tile(&mut g, 10, 10, T_WALL);
    // Floor at (10, 9) north and (9, 10) west -> camera-side rim, knee-high
    assert!(is_low_wall(&g, 10, 10));

    // Bury it: no floor north or west -> full height
    set_tile(&mut g, 10, 9, T_WALL);
    set_tile(&mut g, 9, 10, T_WALL);
    assert!(!is_low_wall(&g, 10, 10));
}

#[test]
fn croaker_crosses_knee_high_wall_airborne() {
    let mut g = open_grid();
    set_tile(&mut g, 12, 10, T_WALL);
    assert!(is_low_wall(&g, 12, 10));

    // Frog at (10, 10) west of wall, player at (15, 10) east of wall
    let mut frog = LiveMonster::new(1, EnemyKind::Croaker, wx(10), wx(10));
    let player_x = wx(15);
    let player_z = wx(10);
    assert!((player_x - frog.x).abs() > CROAKER_HOP_MIN_RANGE);

    let mut crossed = false;
    for _ in 0..240 {
        step_croaker_hop(&mut frog, &g, player_x, player_z, 1.0 / 60.0);
        if frog.x > wx(12) + 0.5 {
            crossed = true;
            break;
        }
    }
    assert!(crossed, "Croaker should cross knee-high wall airborne");
}

#[test]
fn croaker_does_not_cross_full_height_wall_and_ricochets() {
    let mut g = open_grid();
    // Full height wall
    set_tile(&mut g, 12, 10, T_WALL);
    set_tile(&mut g, 12, 9, T_WALL);
    set_tile(&mut g, 11, 10, T_WALL);
    assert!(!is_low_wall(&g, 12, 10));

    let mut frog = LiveMonster::new(1, EnemyKind::Croaker, wx(9), wx(10));
    let start_x = frog.x;
    let player_x = wx(15);
    let player_z = wx(10);

    for _ in 0..240 {
        step_croaker_hop(&mut frog, &g, player_x, player_z, 1.0 / 60.0);
    }

    assert!(
        frog.x < wx(12) - 0.2,
        "Croaker must not walk through full masonry"
    );
    assert!(
        frog.hop_bounces < CROAKER_HOP_BOUNCES,
        "Croaker must have spent a ricochet bouncing"
    );
    assert!(frog.x != start_x);
}

#[test]
fn croaker_stays_inside_grid_bounds() {
    let g = open_grid();
    let mut frog = LiveMonster::new(1, EnemyKind::Croaker, wx(2), wx(2));
    let player_x = wx(0);
    let player_z = wx(0);

    for _ in 0..600 {
        step_croaker_hop(&mut frog, &g, player_x, player_z, 1.0 / 60.0);
    }

    let half_w = f64::from(W) / 2.0;
    assert!(frog.x > -half_w && frog.x < half_w);
    assert!(frog.z > -half_w && frog.z < half_w);
}

#[test]
fn croaker_does_not_hop_when_player_is_close() {
    let g = open_grid();
    let mut frog = LiveMonster::new(1, EnemyKind::Croaker, 0.6, 0.0);
    for _ in 0..30 {
        step_croaker_hop(&mut frog, &g, 0.0, 0.0, 1.0 / 60.0);
    }
    assert_eq!(frog.mode, EnemyMode::Chase);
    assert_eq!(frog.hop_t, 0.0);
}
