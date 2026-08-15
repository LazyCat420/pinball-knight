// Parity test suite for Tavern Pool Presence.
// Replicates legacy/src/scenes/tavern/multiplayer.ts

use pk_core::tavern::multiplayer::{TavernPoolPresence, TAVERN_SCENE};

#[test]
fn tavern_presence_single_player_fallback_when_offline() {
    let mut presence = TavernPoolPresence::new();
    let joined = presence.init_tavern_pool(false, 0);
    assert!(!joined);
    assert!(!presence.is_multiplayer_active());
    assert_eq!(presence.pool_online_count(), 0);
}

#[test]
fn tavern_presence_captures_online_peer_roster() {
    let mut presence = TavernPoolPresence::new();
    let joined = presence.init_tavern_pool(true, 4);
    assert!(joined);
    assert!(presence.is_multiplayer_active());
    assert_eq!(presence.pool_online_count(), 4);
    assert_eq!(presence.scene, TAVERN_SCENE);

    presence.dispose_tavern_pool();
    assert!(!presence.is_multiplayer_active());
    assert_eq!(presence.pool_online_count(), 0);
}
