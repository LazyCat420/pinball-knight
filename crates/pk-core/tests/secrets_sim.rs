// Parity test for Secret Walls, Breakables, and Revolving Door Mechanics.
// Replicates legacy/src/game/pinball-knight/secrets.ts

use pk_core::grid::{at, set_tile, Grid, T_CRACKED, T_FLOOR, T_WALL};
use pk_core::secrets::{
    prune_sealed_bands, secret_doors_in_flight, smash_secret_at, smash_wall_at,
    stamp_secret_bands, update_secret_doors, wall_run_depth, SecretBand, REVOLVE_SWEEP,
    REVOLVE_TIME, SECRET_BREAK_SPEED,
};

#[test]
fn stamp_secret_bands_identifies_legal_2x2_shortcuts() {
    let mut g = Grid::solid(14, 14);
    // Create horizontal corridors on both sides of (4..=5, 4..=5)
    // Left corridor: (2..=3, 4..=5)
    for j in 4..=5 {
        for i in 2..=3 {
            set_tile(&mut g, i, j, T_FLOOR);
        }
    }
    // Right corridor: (6..=7, 4..=5)
    for j in 4..=5 {
        for i in 6..=7 {
            set_tile(&mut g, i, j, T_FLOOR);
        }
    }

    let mut rng_val = 0.5;
    let mut rng = || {
        rng_val = (rng_val * 1.5) % 1.0;
        rng_val
    };

    let stamped = stamp_secret_bands(&mut g, &mut rng, 2, Some(4), None);
    assert_eq!(stamped.len(), 1);
    assert_eq!(stamped[0].i, 4);
    assert_eq!(stamped[0].j, 4);

    // All 4 tiles of the 2x2 band must be cracked
    assert_eq!(at(&g, 4, 4), T_CRACKED);
    assert_eq!(at(&g, 5, 4), T_CRACKED);
    assert_eq!(at(&g, 4, 5), T_CRACKED);
    assert_eq!(at(&g, 5, 5), T_CRACKED);
}

#[test]
fn prune_sealed_bands_reverts_enclosed_cracks() {
    let mut g = Grid::solid(10, 10);
    // Completely enclosed 2x2 band at (4, 4)
    for di in 0..=1 {
        for dj in 0..=1 {
            set_tile(&mut g, 4 + di, 4 + dj, T_CRACKED);
        }
    }
    let mut secrets = vec![pk_core::maze::track_launch::TilePos { i: 4, j: 4 }];
    let dropped = prune_sealed_bands(&mut g, &mut secrets);

    assert_eq!(dropped, 1);
    assert_eq!(secrets.len(), 0);
    assert_eq!(at(&g, 4, 4), T_WALL);
}

#[test]
fn smash_secret_at_converts_band_to_floor_and_starts_revolve() {
    let mut g = Grid::solid(10, 10);
    for di in 0..=1 {
        for dj in 0..=1 {
            set_tile(&mut g, 4 + di, 4 + dj, T_CRACKED);
        }
    }

    let mut secrets = vec![SecretBand {
        i: 4,
        j: 4,
        x: 4.5,
        z: 4.5,
    }];
    let mut revolving = Vec::new();
    let mut rng = || 0.1;

    let res = smash_secret_at(
        &mut g,
        &mut secrets,
        &mut revolving,
        4,
        4,
        false,
        &mut rng,
    );
    assert!(res.is_some());
    let break_res = res.unwrap();
    assert_eq!(break_res.band.i, 4);
    assert!(!break_res.loot.is_empty());

    // Grid opens to floor
    for di in 0..=1 {
        for dj in 0..=1 {
            assert_eq!(at(&g, 4 + di, 4 + dj), T_FLOOR);
        }
    }

    // Revolving door starts
    assert_eq!(revolving.len(), 1);
    assert_eq!(revolving[0].rotation_y, 0.0);

    // Tick door animation to 50%
    update_secret_doors(&mut revolving, REVOLVE_TIME * 0.5);
    assert_eq!(revolving.len(), 1);
    assert!(revolving[0].rotation_y > 0.0);
    assert!(revolving[0].rotation_y <= REVOLVE_SWEEP);

    let flight = secret_doors_in_flight(&revolving);
    assert_eq!(flight.len(), 1);
    assert!(flight[0].deg > 0);

    // Tick door animation past 100% (door should finish and be removed)
    update_secret_doors(&mut revolving, REVOLVE_TIME * 0.6);
    assert_eq!(revolving.len(), 0);
}

#[test]
fn wall_run_depth_and_smash_wall() {
    let mut g = Grid::solid(12, 12);
    // Wall band of thickness 2 at x=5..=6, corridor at x=7..=8
    set_tile(&mut g, 4, 5, T_FLOOR);
    set_tile(&mut g, 5, 5, T_WALL);
    set_tile(&mut g, 6, 5, T_WALL);
    set_tile(&mut g, 7, 5, T_FLOOR);

    // Facing +X from (5, 5): should find depth 2
    let depth = wall_run_depth(&g, 5, 5, 1.0, 0.0);
    assert_eq!(depth, 2);

    // Smash ordinary wall at (5, 5)
    let smashed = smash_wall_at(&mut g, 5, 5);
    assert!(smashed);
    assert_eq!(at(&g, 5, 5), T_FLOOR);

    assert_eq!(SECRET_BREAK_SPEED, 18.0);
}
