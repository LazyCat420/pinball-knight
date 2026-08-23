// Parity test suite for Multiball trailing echoes power-up.
// Replicates legacy/src/game/pinball-knight/entities/multiball.ts

use pk_core::entities::multiball::*;

#[test]
fn multiball_trail_and_lagged_echoes() {
    let mut trail = Vec::new();
    push_trail(&mut trail, 0.0, 0.0, 0.0, MULTIBALL_TRAIL_SECONDS);
    push_trail(&mut trail, 2.0, 0.0, 0.2, MULTIBALL_TRAIL_SECONDS);
    push_trail(&mut trail, 4.0, 0.0, 0.4, MULTIBALL_TRAIL_SECONDS);

    let mut echoes = spawn_multiball(0.0, 0.0);
    assert_eq!(echoes.len(), 2);

    let mut clock = 0.5;
    update_multiball(&mut echoes, &mut trail, &mut clock, 6.0, 0.0, 0.1);
    assert!(echoes[0].x > 0.0);

    dispose_multiball(&mut echoes, &mut trail, &mut clock);
    assert!(echoes.is_empty());
    assert!(trail.is_empty());
}
