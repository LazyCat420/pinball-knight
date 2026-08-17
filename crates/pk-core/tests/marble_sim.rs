//! Parity test suite for entities/marble.ts
//! Replicates all exported functions, physics constants, fusion, and environmental reactions.

use pk_core::grid::Grid;
use pk_core::marble::*;
use pk_core::state::{Player, SimState, PLAYER_R};

#[test]
fn material_metadata_and_constants_match_oracle() {
    assert_eq!(MATERIAL_LIST.len(), 6);
    assert!(is_material("diamond"));
    assert!(is_material("water"));
    assert!(is_material("stone"));
    assert!(is_material("storm"));
    assert!(is_material("shadow"));
    assert!(is_material("lava"));
    assert!(!is_material("iron"));

    let diamond_meta = get_material_meta(MarbleMaterial::Diamond);
    assert_eq!(diamond_meta.label, "Diamond");
    assert_eq!(diamond_meta.icon, "💎");
    assert_eq!(diamond_meta.tint, 0x6fd0e8);
    assert_eq!(diamond_meta.trail, 0xd8f6ff);
}

#[test]
fn material_physics_accessors_match_oracle() {
    let mut player = Player::default();

    // Default neutral state
    assert_eq!(active_material(&player), None);
    assert_eq!(material_flat_restitution(&player), None);
    assert_eq!(material_player_r(&player), PLAYER_R);
    assert_eq!(material_bumper_scatter_mult(&player), 1.0);
    assert_eq!(material_friction_mult(&player), 1.0);
    assert_eq!(material_steer_mult(&player), 1.0);
    assert_eq!(material_lane_pull(&player), 1.0);
    assert_eq!(material_ram_damage_mult(&player), 1.0);
    assert_eq!(material_corner_add_mult(&player), 1.0);
    assert_eq!(material_bumper_mult(&player), 1.0);
    assert_eq!(material_max_speed(&player), PINBALL_MAX_SPEED);
    assert_eq!(material_clip(&player), None);
    assert_eq!(material_squash(&player), 0.0);

    // Diamond
    apply_material(&mut player, MarbleMaterial::Diamond);
    assert_eq!(active_material(&player), Some(MarbleMaterial::Diamond));
    assert_eq!(material_flat_restitution(&player), Some(DIAMOND_RESTITUTION));
    assert_eq!(
        material_break_speeds(&player),
        (DIAMOND_SECRET_BREAK_SPEED, DIAMOND_WALL_BREAK_SPEED)
    );
    assert_eq!(material_clip(&player), Some("diamondball"));
    assert!(material_resists_drain(&player));

    // Water
    apply_material(&mut player, MarbleMaterial::Water);
    assert_eq!(material_friction_mult(&player), WATER_FRICTION_MULT);
    assert_eq!(material_steer_mult(&player), WATER_STEER_MULT);
    assert_eq!(material_ram_knockback(&player), WATER_RAM_KNOCKBACK);
    assert_eq!(material_squash(&player), WATER_SQUASH);
    assert_eq!(material_clip(&player), Some("waterball"));

    // Stone
    apply_material(&mut player, MarbleMaterial::Stone);
    assert_eq!(material_friction_mult(&player), STONE_FRICTION_MULT);
    assert_eq!(material_max_speed(&player), STONE_MAX_SPEED);
    assert_eq!(material_ram_damage_mult(&player), STONE_RAM_DAMAGE_MULT);
    assert_eq!(material_bumper_mult(&player), STONE_BUMPER_KICK_MULT);
    assert_eq!(material_corner_add_mult(&player), STONE_CORNER_ADD_MULT);
    assert_eq!(material_wall_break_cost(&player), STONE_WALL_BREAK_SPEED_COST);

    // Storm
    apply_material(&mut player, MarbleMaterial::Storm);
    assert_eq!(material_steer_mult(&player), STORM_STEER_MULT);
    assert_eq!(material_lane_pull(&player), STORM_LANE_PULL_MULT);

    // Shadow
    apply_material(&mut player, MarbleMaterial::Shadow);
    assert_eq!(material_player_r(&player), SHADOW_PLAYER_R);
    assert_eq!(material_bumper_scatter_mult(&player), SHADOW_BUMPER_SCATTER_MULT);
    assert_eq!(material_flat_restitution(&player), Some(SHADOW_RESTITUTION));
    assert!(material_phases_walls(&player));
    assert_eq!(shadow_slayer_mult(&player, "ghost"), SHADOW_SLAYER_MULT);
    assert_eq!(shadow_slayer_mult(&player, "reaper"), SHADOW_SLAYER_MULT);
    assert_eq!(shadow_slayer_mult(&player, "wisp"), SHADOW_SLAYER_MULT);
    assert_eq!(shadow_slayer_mult(&player, "zombie"), 1.0);

    // Lava
    apply_material(&mut player, MarbleMaterial::Lava);
    assert_eq!(material_bumper_mult(&player), LAVA_BUMPER_MULT);
    assert_eq!(material_squash(&player), LAVA_SQUASH);
    assert!(lava_melt_if_active(&player));
}

#[test]
fn diamond_cut_through_mechanics() {
    let mut player = Player::default();
    apply_material(&mut player, MarbleMaterial::Diamond);

    player.mom_speed = 10.0;
    assert!(!material_cuts_through(&player));
    assert_eq!(material_ram_cut_mult(&player), 1.0);

    player.mom_speed = 15.0; // >= DIAMOND_CUT_SPEED (14.0)
    assert!(material_cuts_through(&player));
    assert_eq!(material_ram_cut_mult(&player), DIAMOND_CUT_DMG_MULT);
    assert_eq!(material_contact_knockback(&player), DIAMOND_CUT_KNOCKBACK);
    assert_eq!(material_ram_cooldown(&player), DIAMOND_CUT_COOLDOWN);
}

#[test]
fn squash_scale_and_recovery() {
    let mut player = Player::default();
    apply_material(&mut player, MarbleMaterial::Water);

    note_squash(&mut player, 1.0, 0.0, 12.0);
    assert!(player.squash_t > 0.0);
    let (sx, sy) = squash_scale(&player);
    assert!(sx < 1.0);
    assert!(sy > 1.0);

    update_squash(&mut player, 0.2);
    assert_eq!(player.squash_t, 0.0);
    let (rx, ry) = squash_scale(&player);
    assert_eq!(rx, 1.0);
    assert_eq!(ry, 1.0);
}

#[test]
fn shadow_phase_move_and_ejection_safety() {
    let mut grid = Grid::solid(10, 10);
    for i in 1..9 {
        for j in 1..9 {
            pk_core::grid::set_tile(&mut grid, i, j, pk_core::grid::T_FLOOR);
        }
    }

    let mut player = Player::default();
    apply_material(&mut player, MarbleMaterial::Shadow);

    // Free phase movement while in shadow
    let res = phase_move(&grid, 0.0, 0.0, 0.22, 2.0, 0.0, true);
    assert_eq!(res.x, 2.0);
    assert_eq!(res.z, 0.0);
    assert_eq!(res.hit_surface, 0);

    // Shadow lapses while inside a wall tile (0, 0 is solid border if outside)
    player.x = -4.5;
    player.z = -4.5;
    update_material(&mut player, 10.0); // Shadow expires
    assert_eq!(active_material(&player), None);

    // Update phase eject past grace period
    update_phase_eject(&grid, &mut player, SHADOW_PHASE_GRACE + 0.05);

    // Player ejected onto a walkable tile
    let (ti, tj) = pk_core::grid::world_to_tile(&grid, player.x, player.z);
    assert!(pk_core::grid::is_walkable(&grid, ti, tj));
}

#[test]
fn material_terrain_environmental_reactions() {
    let mut player = Player::default();

    // Water × Magstrip -> Steam Eruption
    apply_material(&mut player, MarbleMaterial::Water);
    player.mom_speed = 5.0;
    assert!(try_water_steam(&mut player));
    assert!(player.mom_speed >= WATER_STEAM_LAUNCH);
    assert!(water_quenches_fire(&player, 0.0, 0.0));

    // Stone reactions
    apply_material(&mut player, MarbleMaterial::Stone);
    assert_eq!(stone_magstrip_cap(&player), Some(STONE_MAGSTRIP_CAP));
    assert!(stone_ignores_oil(&player));
    assert!(stone_bridges_pit(&player));

    // Lava reactions
    apply_material(&mut player, MarbleMaterial::Lava);
    assert!(lava_vaporizes_oil(&player, 0.0, 0.0));

    // Diamond reactions
    apply_material(&mut player, MarbleMaterial::Diamond);
    assert!(try_diamond_discharge(&player, 0.0, 0.0));
}

#[test]
fn bounce_and_slam_emitters_tick_state() {
    let grid = Grid::solid(10, 10);
    let mut sim = SimState::new(grid, (0.0, 0.0), 123);

    apply_material(&mut sim.player, MarbleMaterial::Water);
    sim.player.mom_speed = 12.0;

    emit_material_on_bounce(&mut sim, 1.0, 0.0);
    assert!(sim.player.marble.emit_cooldown > 0.0);

    material_slam(&mut sim);
    assert!(sim.player.mom_speed > 12.0);
}
