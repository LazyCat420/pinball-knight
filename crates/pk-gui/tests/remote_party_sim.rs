// Parity test suite for Remote Party Multiplayer Interpolation Manager.
// Replicates legacy/src/game/pinball-knight/render/remote-party.ts

use pk_gui::remote_party::{Facing, RemotePartyManager};

#[test]
fn remote_party_ingests_and_interpolates_peer_movement() {
    let mut mgr = RemotePartyManager::new();

    mgr.update_peer("peer1", 0, "Knight42", 10.0, 0.0, "walk", false);

    // Initial position matches first update
    let peer = mgr.peers.get("peer1").unwrap();
    assert_eq!(peer.current_x, 10.0);

    // Update target to 20.0 (moving East)
    mgr.update_peer("peer1", 0, "Knight42", 20.0, 0.0, "walk", false);
    mgr.step(0.05);

    let moved_peer = mgr.peers.get("peer1").unwrap();
    assert!(moved_peer.current_x > 10.0 && moved_peer.current_x < 20.0);
    assert_eq!(moved_peer.facing, Facing::E);
}

#[test]
fn remote_party_prunes_stale_peers() {
    let mut mgr = RemotePartyManager::new();

    mgr.update_peer("peer1", 0, "Knight42", 0.0, 0.0, "idle", false);
    mgr.step(1.0); // age = 1.0s

    mgr.prune_stale(0.5); // prune older than 0.5s
    assert_eq!(mgr.peers.len(), 0);
}
