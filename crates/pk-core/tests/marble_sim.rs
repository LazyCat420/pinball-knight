// Parity test suite for Marble Materials Subsystem.
// Replicates legacy/src/game/pinball-knight/entities/marble.ts

use pk_core::grid::{set_tile, Grid, T_FLOOR};
use pk_core::marble::*;
use pk_core::monsters::types::{EnemyKind, LiveMonster};

fn make_open_grid(w: i32, h: i32) -> Grid {
    let mut g = Grid::solid(w, h);
    for i in 0..w {
        for j in 0..h {
            set_tile(&mut g, i, j, T_FLOOR);
        }
    }
    g
}

#[test]
fn material_physics_overrides_and_fusion_lifecycle() {
    let mut state = MarbleState::default();

    // Default neutral physics
    assert_eq!(state.friction_mult(), 1.0);
    assert_eq!(state.steer_mult(), 1.0);
    assert_eq!(state.flat_restitution(), None);

    // Apply Diamond
    state.apply_material(MarbleMaterial::Diamond);
    assert_eq!(state.active_material(), Some(MarbleMaterial::Diamond));
    assert_eq!(state.flat_restitution(), Some(DIAMOND_RESTITUTION));
    assert_eq!(
        state.break_speeds(),
        (DIAMOND_SECRET_BREAK_SPEED, DIAMOND_WALL_BREAK_SPEED)
    );

    // Apply Water -> triggers Fusion with Diamond
    state.apply_material(MarbleMaterial::Water);
    assert_eq!(state.active_material(), Some(MarbleMaterial::Water));
    assert_eq!(state.fuse_material, Some(MarbleMaterial::Diamond));
    assert_eq!(state.fuse_time, MATERIAL_FUSION_TIME);
    assert_eq!(state.friction_mult(), WATER_FRICTION_MULT);

    // Update passes fusion window
    state.update(MATERIAL_FUSION_TIME + 0.1);
    assert_eq!(state.fuse_material, None);
}

#[test]
fn squash_and_stretch_recovery() {
    let mut squash = SquashState::default();

    // Impact with water marble at speed 10.0
    note_squash(&mut squash, 1.0, 0.0, 10.0, Some(MarbleMaterial::Water));
    assert!(squash.timer > 0.0);
    assert!(squash.amp > 0.0);

    let (sx, sy) = squash_scale(&squash);
    // Area preservation (sx * sy is approximately 1.0)
    assert!((sx * sy - 1.0).abs() < 0.05);

    // Decay squash timer
    update_squash(&mut squash, SQUASH_RECOVER + 0.1);
    assert_eq!(squash_scale(&squash), (1.0, 1.0));
}

#[test]
fn shadow_phase_movement_and_wall_ejection() {
    let mut grid = Grid::solid(20, 20);
    // Floor only at (15, 15), which corresponds to world (5.5, 5.5)
    set_tile(&mut grid, 15, 15, T_FLOOR);

    let (mut player_x, mut player_z) = pk_core::grid::tile_center(&grid, 15, 15);

    // Moving through walls while Shadow is active
    let (next_x, _next_z) = phase_move(&grid, player_x, player_z, 0.28, 2.0, 0.0, Some(MarbleMaterial::Shadow));
    assert_eq!(next_x, player_x + 2.0);

    // Player ends up at (player_x + 2.0, player_z) which is inside a solid wall
    player_x += 2.0;
    let mut stuck_t = 0.0;

    // Shadow lapses (mat = None) while stuck in wall -> triggers eject
    let ejected = update_phase_eject(&grid, &mut player_x, &mut player_z, &mut stuck_t, None, SHADOW_PHASE_GRACE + 0.05);
    assert!(ejected);
    // Player ejected to walkable floor tile (15, 15)
    let (ti, tj) = pk_core::grid::world_to_tile(&grid, player_x, player_z);
    assert_eq!((ti, tj), (15, 15));
}

#[test]
fn stone_slam_shockwave_damages_foes() {
    let grid = make_open_grid(20, 20);
    let mut monsters = vec![
        LiveMonster::new(1, EnemyKind::Zombie, 5.5, 5.0),
        LiveMonster::new(2, EnemyKind::Golem, 6.0, 5.0),
    ];

    let mut mom_speed = 10.0;
    let events = material_slam(
        5.0,
        5.0,
        &mut mom_speed,
        0.0,
        &[MarbleMaterial::Stone],
        &grid,
        &mut monsters,
    );

    assert_eq!(events.len(), 1);
    assert!(mom_speed < 10.0); // Speed absorbed by ground slam
    assert!(monsters[0].hp < monsters[0].max_hp);
    assert!(monsters[1].hp < monsters[1].max_hp);
}

#[test]
fn environmental_reactions() {
    let mut monsters = vec![
        LiveMonster::new(1, EnemyKind::Zombie, 5.5, 5.0),
    ];

    let mut speed = 5.0;
    // Water steam explosion
    let steam = try_water_steam(5.0, 5.0, &mut speed, Some(MarbleMaterial::Water), &mut monsters);
    assert!(steam);
    assert_eq!(speed, WATER_STEAM_LAUNCH);
    assert!(monsters[0].hp < monsters[0].max_hp);

    // Terrain booleans
    assert!(stone_ignores_oil(Some(MarbleMaterial::Stone)));
    assert!(!stone_ignores_oil(Some(MarbleMaterial::Water)));
    assert!(lava_vaporizes_oil(5.0, 5.0, Some(MarbleMaterial::Lava)));
    assert!(water_quenches_fire(5.0, 5.0, Some(MarbleMaterial::Water)));
}
