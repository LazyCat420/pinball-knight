// Simulation test suite for Floor Population.
// Replicates legacy/src/game/pinball-knight/spawn/floor-populate.ts

use pk_core::monsters::types::EnemyKind;
use pk_core::spawn::floor_authoring::author_floor;
use pk_core::spawn::floor_populate::populate_floor;
use pk_core::state::SimState;

#[test]
fn floor_populate_populates_sim_state() {
    let authored = author_floor(1, 12345, false);
    let mut sim = SimState::new(authored.grid.clone(), (authored.plan.start.i as f64, authored.plan.start.j as f64), 12345);

    populate_floor(&authored, &mut sim);

    // Monsters must be populated (at least the boss + spawns)
    assert!(!sim.monsters.is_empty());

    // Boss must be present (Brute with high max_hp)
    let has_boss = sim.monsters.iter().any(|m| m.kind == EnemyKind::Brute && m.max_hp >= 20.0);
    assert!(has_boss);
}

#[test]
fn floor_populate_with_high_depth_has_pin_crews_and_antechamber() {
    let authored = author_floor(5, 42, false);
    let mut sim = SimState::new(authored.grid.clone(), (authored.plan.start.i as f64, authored.plan.start.j as f64), 42);

    populate_floor(&authored, &mut sim);

    // Floor 5 has bowling pins and boss antechamber brutes
    let has_pin = sim.monsters.iter().any(|m| m.kind == EnemyKind::Pin);
    let brute_count = sim.monsters.iter().filter(|m| m.kind == EnemyKind::Brute).count();

    assert!(has_pin);
    assert!(brute_count >= 2);
}
