// Comprehensive simulation test suite for the Mutable State Spine.
// Replicates legacy/src/game/pinball-knight/state.ts

use pk_core::grid::Grid;
use pk_core::items::WeaponId;
use pk_core::state::*;

#[test]
fn fresh_player_fields_and_defaults() {
    let p = fresh_player_fields();
    assert_eq!(p.hp, PLAYER_MAX_HP);
    assert_eq!(p.max_hp, PLAYER_MAX_HP);
    assert_eq!(p.mana, MANA_MAX);
    assert_eq!(p.facing, Facing::S);
    assert_eq!(p.attack_t, -1.0);
    assert_eq!(p.drop_t, -1.0);
    assert_eq!(p.hop_t, -1.0);
    assert_eq!(p.roll_t, -1.0);
    assert_eq!(p.rage_t, 0.0);
    assert_eq!(p.shield_t, 0.0);
    assert_eq!(p.iframes, 0.0);
}

#[test]
fn active_weapon_resolution() {
    let mut inv = pk_core::player::PlayerInventory::default();
    let w = active_weapon(&inv);
    assert_eq!(w.id, WeaponId::Sword); // Default slot 0 has sword

    inv.slots[0] = None;
    let fallback = active_weapon(&inv);
    assert_eq!(fallback.id, WeaponId::Fists);
}

#[test]
fn perception_gate_plunger_visibility() {
    // Hidden while armed in chute
    assert!(!player_is_visible_to_enemies(true));

    // Visible once launched onto the floor
    assert!(player_is_visible_to_enemies(false));
}

#[test]
fn floor_fx_lifecycle_and_tick_decay() {
    let mut grid = Grid::solid(10, 10);
    grid.t[11] = 1;
    let mut sim = SimState::new(grid, (1.5, 1.5), 42);

    sim.floor_fx.push(FloorFx {
        kind: FloorFxKind::Fire,
        x: 1.5,
        z: 1.5,
        hostile: false,
        radius: 1.0,
        life: 0.05,
        max_life: 1.0,
        tick: 0.1,
        dir_x: None,
        dir_z: None,
    });

    assert_eq!(sim.floor_fx.len(), 1);

    // Simulate 4 ticks (4 * 1/60s = ~0.067s > 0.05s)
    let input = FrameInput::default();
    for _ in 0..4 {
        simulate(&mut sim, &input);
    }

    // Fire effect expired and pruned
    assert_eq!(sim.floor_fx.len(), 0);
}

#[test]
fn session_reset_state() {
    let mut grid = Grid::solid(10, 10);
    grid.t[11] = 1;
    let mut sim = SimState::new(grid, (1.5, 1.5), 42);

    sim.kills = 12;
    sim.gold_run = 550;
    sim.jackpots = 2;
    sim.floor_fx.push(FloorFx {
        kind: FloorFxKind::Slick,
        x: 2.0,
        z: 2.0,
        hostile: false,
        radius: 0.5,
        life: 5.0,
        max_life: 5.0,
        tick: 0.5,
        dir_x: None,
        dir_z: None,
    });
    sim.ground_items.push(GroundItem {
        id: "potion_1".to_string(),
        kind: "potion".to_string(),
        x: 1.0,
        z: 1.0,
        tier: 1,
        life: 10.0,
    });

    reset_state(&mut sim);

    assert_eq!(sim.kills, 0);
    assert_eq!(sim.gold_run, 0);
    assert_eq!(sim.jackpots, 0);
    assert!(sim.floor_fx.is_empty());
    assert!(sim.ground_items.is_empty());
    assert_eq!(sim.player.hp, PLAYER_MAX_HP);
}
