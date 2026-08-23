// Parity test suite for Tavern Scene Bootstrap and Lifecycle.
// Replicates legacy/src/scenes/tavern/core.ts

use pk_core::tavern::core::TavernSession;
use pk_core::tavern::layout::{ROOM_MAX_X, ROOM_MAX_Z};

#[test]
fn tavern_session_locomotion_and_camera_tracking() {
    let mut session = TavernSession::new();

    let initial_x = session.player_pos.0;
    let initial_y = session.player_pos.1;

    // Step north-east
    session.step((1.0, 1.0), 0.1);
    assert!(session.player_pos.0 > initial_x);
    assert!(session.player_pos.1 > initial_y);
    assert!(session.camera_pos.0 > initial_x);
    assert!(session.camera_pos.1 > initial_y);

    // Overstep out of room: should clamp to borders
    session.step((100.0, 100.0), 10.0);
    assert!(session.player_pos.0 <= ROOM_MAX_X - 0.5);
    assert!(session.player_pos.1 <= ROOM_MAX_Z - 0.5);
}
