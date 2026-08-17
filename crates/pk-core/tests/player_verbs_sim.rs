// Parity test for Player Verbs (Melee Slash, Dash Roll, Plunger Launch).
// Replicates legacy/src/game/pinball-knight/entities/combat.ts, movement.ts

use pk_core::grid::Grid;
use pk_core::monsters::types::{EnemyKind, LiveMonster};
use pk_core::player::types::{PlayerCoreState, PlayerFacing};
use pk_core::player::verbs::{
    step_dash, step_melee_slash, step_plunger, trigger_dash, trigger_melee_slash,
};

#[test]
fn melee_slash_strikes_monsters_inside_forward_arc() {
    let mut player = PlayerCoreState::default();
    player.facing = PlayerFacing::South; // looking down (0, 1)

    let mut monsters = vec![
        // Monster directly in front
        LiveMonster::new(1, EnemyKind::Zombie, 0.0, 0.8),
        // Monster behind the knight
        LiveMonster::new(2, EnemyKind::Zombie, 0.0, -0.8),
    ];

    let initial_hp_front = monsters[0].hp;
    let initial_hp_back = monsters[1].hp;

    assert!(trigger_melee_slash(&mut player));
    let hits = step_melee_slash(&mut player, &mut monsters, 0.016);

    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].monster_id, 1);
    assert!(monsters[0].hp < initial_hp_front);
    assert_eq!(monsters[1].hp, initial_hp_back);
    assert!(
        monsters[0].vz > 0.0,
        "Knockback should propel monster southward"
    );
}

#[test]
fn dash_roll_grants_iframes_and_moves_player() {
    let mut player = PlayerCoreState::default();
    player.facing = PlayerFacing::East;
    let mut grid = Grid::solid(20, 20);
    for t in grid.t.iter_mut() {
        *t = pk_core::grid::T_FLOOR;
    }

    let start_x = player.x;
    assert!(trigger_dash(&mut player, 1.0, 0.0));
    assert!(player.iframes > 0.0);
    assert!(player.dash.active);

    for _ in 0..10 {
        step_dash(&mut player, &grid, 0.016);
    }

    assert!(
        player.x > start_x,
        "Dash should displace player position forward"
    );
}

#[test]
fn plunger_accumulates_tension_and_launches_impulse() {
    let mut player = PlayerCoreState::default();

    // Hold launch key for 0.5s
    for _ in 0..30 {
        let launched = step_plunger(&mut player, true, 0.0, -1.0, 1.0 / 60.0);
        assert!(!launched);
    }
    assert!(player.plunger.tension > 0.4);

    // Release launch key
    let launched = step_plunger(&mut player, false, 0.0, -1.0, 1.0 / 60.0);
    assert!(launched);
    assert!(
        player.vz < -5.0,
        "Player must launch northward with high velocity"
    );
    assert!(player.pinball_mode);
}
