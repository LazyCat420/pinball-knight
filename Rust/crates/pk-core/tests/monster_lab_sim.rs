// Parity test suite for Monster Lab Developer Harness.
// Replicates legacy/src/game/pinball-knight/dev/monster-lab.ts

use pk_core::dev::monster_lab::MonsterLabState;

#[test]
fn monster_lab_spawning_and_roster_inspection() {
    let mut lab = MonsterLabState::new();
    let roster = lab.roster();
    assert!(roster.contains(&"zombie"));
    assert!(roster.contains(&"spider"));
    assert!(roster.contains(&"brute"));

    // Spawn valid kind
    let count = lab.spawn("zombie", 4).expect("zombie spawns");
    assert_eq!(count, 4);
    assert_eq!(lab.spawn_history.len(), 1);

    // Solo isolation
    let only_count = lab.only("spider").expect("spider spawns solo");
    assert_eq!(only_count, 3);
    assert_eq!(lab.spawn_history.len(), 1);

    // Ring spawn
    let ring = lab.ring();
    assert_eq!(ring.len(), roster.len());
    assert_eq!(lab.spawn_history.len(), roster.len());

    // Invalid kind rejection
    assert!(lab.spawn("non_existent_beast", 1).is_err());
}
