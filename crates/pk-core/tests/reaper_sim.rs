// Parity test suite for Reaper King Boss Spawner.
// Replicates legacy/src/game/pinball-knight/spawn/reaper.ts

use pk_core::spawn::reaper::{
    compute_reaper_spawn_pos, ReaperParams, REAPER_DISTANCE_TILES, REAPER_HP, REAPER_SCALE,
    REAPER_SPEED_BASE, REAPER_TINT,
};

#[test]
fn reaper_spawns_twelve_tiles_out_radially() {
    let (x0, z0) = compute_reaper_spawn_pos(10.0, 20.0, 0.0);
    assert!((x0 - (10.0 + REAPER_DISTANCE_TILES)).abs() < 1e-5);
    assert!((z0 - 20.0).abs() < 1e-5);

    let (x_half, z_half) = compute_reaper_spawn_pos(0.0, 0.0, std::f32::consts::PI / 2.0);
    assert!(x_half.abs() < 1e-5);
    assert!((z_half - REAPER_DISTANCE_TILES).abs() < 1e-5);
}

#[test]
fn reaper_default_params_match_boss_archetype() {
    let params = ReaperParams::default_params();
    assert_eq!(params.hp, REAPER_HP);
    assert_eq!(params.scale, REAPER_SCALE);
    assert_eq!(params.speed_base, REAPER_SPEED_BASE);
    assert_eq!(params.tint, REAPER_TINT);
    assert!(params.aggro);
}
