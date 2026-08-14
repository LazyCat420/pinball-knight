// Parity test suite for The Tide rolling reinforcements and corpse reaping.
// Replicates legacy/src/game/pinball-knight/spawn/tide.ts

use pk_core::grid::{Grid, T_FLOOR};
use pk_core::monsters::types::{EnemyKind, EnemyMode, LiveMonster};
use pk_core::spawn::tide::{reap_corpses, step_tide, TideState, CORPSE_BUDGET, TIDE_GRACE};

fn make_open_grid(w: i32, h: i32) -> Grid {
    let mut grid = Grid::solid(w, h);
    for j in 1..(h - 1) {
        for i in 1..(w - 1) {
            grid.t[(j * w + i) as usize] = T_FLOOR;
        }
    }
    grid
}

#[test]
fn tide_grace_period_spawns_no_monsters() {
    let grid = make_open_grid(40, 40);
    let mut tide = TideState::new(20, 100);
    let mut monsters = Vec::new();

    // Step for 10s (under TIDE_GRACE = 15s)
    let spawned = step_tide(&mut tide, &mut monsters, &grid, 20.0, 20.0, 10.0);
    assert!(spawned.is_empty());
    assert_eq!(monsters.len(), 0);
}

#[test]
fn tide_spawns_reinforcements_when_horde_depleted() {
    let grid = make_open_grid(40, 40);
    let mut tide = TideState::new(20, 100);
    let mut monsters = Vec::new();

    // Advance floor age past grace period
    tide.floor_age = TIDE_GRACE + 10.0;
    tide.timer = 15.0; // trigger interval

    let spawned = step_tide(&mut tide, &mut monsters, &grid, 20.0, 20.0, 1.0);
    assert!(!spawned.is_empty());
    assert!(!monsters.is_empty());
    assert!(monsters.iter().all(|m| m.is_alive()));
}

#[test]
fn reap_corpses_caps_dead_bodies_at_budget() {
    let mut monsters = Vec::new();

    // 5 alive monsters
    for id in 1..=5 {
        monsters.push(LiveMonster::new(id, EnemyKind::Zombie, 10.0, 10.0));
    }

    // 50 dead monsters
    for id in 6..=55 {
        let mut m = LiveMonster::new(id, EnemyKind::Zombie, 10.0, 10.0);
        m.mode = EnemyMode::Dead;
        m.hp = 0.0;
        monsters.push(m);
    }

    assert_eq!(monsters.len(), 55);

    reap_corpses(&mut monsters);

    let alive_count = monsters.iter().filter(|m| m.is_alive()).count();
    let dead_count = monsters.iter().filter(|m| !m.is_alive()).count();

    assert_eq!(alive_count, 5);
    assert_eq!(dead_count, CORPSE_BUDGET);
    assert_eq!(monsters.len(), 5 + CORPSE_BUDGET);
}
