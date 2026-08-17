// Parity test suite for Multiball trailing echoes power-up.
// Replicates legacy/src/game/pinball-knight/entities/multiball.ts

use pk_core::entities::multiball::{step_multiball, MultiballState, MULTIBALL_RAM_MULT};
use pk_core::monsters::types::{EnemyKind, LiveMonster};

#[test]
fn multiball_inactive_does_not_step() {
    let mut state = MultiballState::default();
    state.active = false;
    let mut monsters = vec![];
    let hits = step_multiball(&mut state, 0.0, 0.0, &mut monsters, 20.0, 0.016);
    assert!(hits.is_empty());
}

#[test]
fn multiball_samples_lagged_trail_and_damages_monsters() {
    let mut state = MultiballState::default();
    state.active = true;

    // Simulate player moving North along the z-axis for 0.5s
    for step in 0..30 {
        let z = -(step as f64) * 0.2;
        let mut empty = vec![];
        step_multiball(&mut state, 0.0, z, &mut empty, 20.0, 0.016);
    }

    // Verify trail recorded points
    assert!(state.trail.len() > 10);

    // Place a zombie near echo 1's trailing position
    let echo1_x = state.echoes[0].x;
    let echo1_z = state.echoes[0].z;

    let mut monsters = vec![LiveMonster::new(1, EnemyKind::Zombie, echo1_x, echo1_z)];

    let hits = step_multiball(&mut state, 0.0, -6.2, &mut monsters, 20.0, 0.016);
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].monster_id, 1);
    assert_eq!(hits[0].damage, 20.0 * MULTIBALL_RAM_MULT);

    // Immediate next step hits cooldown -> no repeat hit
    let hits_cd = step_multiball(&mut state, 0.0, -6.2, &mut monsters, 20.0, 0.016);
    assert!(hits_cd.is_empty());
}
