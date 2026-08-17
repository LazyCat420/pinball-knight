//! Comprehensive parity test suite for legacy/src/game/pinball-knight/coop.ts.

use pk_core::coop::*;

#[test]
fn coop_deterministic_authority_election() {
    let peers = vec!["peer_bravo", "peer_charlie", "peer_alpha"];
    let elected = elect_authority("peer_delta", &peers);
    assert_eq!(elected, "peer_alpha");

    let me_elected = elect_authority("peer_001", &["peer_002", "peer_003"]);
    assert_eq!(me_elected, "peer_001");
}

#[test]
fn coop_session_lifecycle_and_flags() {
    end_coop();
    assert!(!is_coop());
    assert_eq!(coop_seed(), None);

    init_coop("peer_002", &["peer_001", "peer_003"], 12345);
    assert!(is_coop());
    assert!(!enemy_authority_is_me());
    assert!(is_replica());
    assert_eq!(coop_seed(), Some(12345));

    end_coop();
    assert!(!is_coop());
}

#[test]
fn marble_on_marble_elastic_collision() {
    let pos_a = (0.0, 0.0);
    let mut vel_a = (5.0, 0.0);

    let pos_b = (0.4, 0.0);
    let mut vel_b = (-5.0, 0.0);

    let bounced = MarbleCollision::bounce_marbles(pos_a, &mut vel_a, pos_b, &mut vel_b, PLAYER_BOUNCE_R);
    assert!(bounced);
    assert!(vel_a.0 < 0.0);
    assert!(vel_b.0 > 0.0);
}
