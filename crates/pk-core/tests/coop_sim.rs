// Parity test suite for Dungeon Co-Op Replication Layer.
// Replicates legacy/src/game/pinball-knight/coop.ts

use pk_core::coop::{CoopAuthority, MarbleCollision};

#[test]
fn coop_authority_election_is_deterministic_minimum() {
    let peers = vec!["peer_z", "peer_alpha", "peer_beta"];
    let authority = CoopAuthority::elect_authority(&peers);
    assert_eq!(authority, Some("peer_alpha".to_string()));

    let empty: Vec<&str> = vec![];
    assert_eq!(CoopAuthority::elect_authority(&empty), None);
}

#[test]
fn coop_marble_vs_marble_elastic_collision() {
    let pos_a = (0.0, 0.0);
    let mut vel_a = (1.0, 0.0);

    let pos_b = (0.8, 0.0);
    let mut vel_b = (-1.0, 0.0);

    // Colliding with radius 0.5 (distance 0.8 < 1.0)
    let collided = MarbleCollision::bounce_marbles(pos_a, &mut vel_a, pos_b, &mut vel_b, 0.5);
    assert!(collided);
    // Velocities should reverse along x
    assert!(vel_a.0 < 0.0);
    assert!(vel_b.0 > 0.0);
}
