// Comprehensive simulation test suite for Tavern Scene Bootstrap & Locomotion Orchestrator.
// Replicates legacy/src/scenes/tavern/core.ts

use pk_core::tavern::core::*;
use pk_core::tavern::layout::{ROOM_MAX_X, ROOM_MAX_Z, ROOM_MIN_X, ROOM_MIN_Z};

#[test]
fn tavern_session_initialization_and_fit_zoom() {
    let mut session = TavernSession::new();
    assert!(session.active);
    assert!(!session.frozen);
    assert_eq!(session.cam_zoom, CAM_ZOOM_WIDE);

    // Zoom fits on standard 1080p target
    session.apply_zoom(1920.0, 1080.0, DEFAULT_PPU);
    assert_eq!(session.cam_zoom, 1.0);

    // Zoom drops to wide framing on smaller window
    session.apply_zoom(800.0, 600.0, DEFAULT_PPU);
    assert_eq!(session.cam_zoom, CAM_ZOOM_WIDE);
}

#[test]
fn tavern_locomotion_bounds_and_facing() {
    let mut session = TavernSession::new();

    // Step East
    session.step((1.0, 0.0), 0.5);
    assert_eq!(session.player_facing, "E");
    assert!(session.player_pos.0 > ROOM_CENTER_X);

    // Step North
    session.step((0.0, -1.0), 0.5);
    assert_eq!(session.player_facing, "N");
    assert!(session.player_pos.1 < ROOM_CENTER_Z);

    // Attempt to walk past room walls (clamped)
    for _ in 0..50 {
        session.step((1.0, 0.0), 0.5);
    }
    assert!(session.player_pos.0 <= ROOM_MAX_X - 0.5);
    assert!(session.player_pos.0 >= ROOM_MIN_X + 0.5);
}

#[test]
fn tavern_station_focus_and_interaction_routing() {
    let mut session = TavernSession::new();

    // Descend board is at (0.0, -4.9)
    session.player_pos = (0.0, -4.9);
    session.step((0.0, 0.0), 0.1);

    assert_eq!(session.active_station_id, Some("board".to_string()));

    let evt = session.interact();
    assert_eq!(evt, Some(TavernInteractionEvent::Descend { floor: None }));
    assert!(session.panel_open());

    session.close_station();
    assert!(!session.panel_open());
}

#[test]
fn tavern_menu_and_freeze_state() {
    let mut session = TavernSession::new();
    assert!(!session.panel_open());

    let menu_evt = session.open_menu();
    assert_eq!(menu_evt, Some(TavernInteractionEvent::Menu));
    assert!(session.panel_open());

    // Locomotion frozen during open panel
    let pos_before = session.player_pos;
    session.step((1.0, 0.0), 0.5);
    assert_eq!(session.player_pos, pos_before);

    session.close_menu();
    assert!(!session.panel_open());
}

#[test]
fn tavern_counter_flourish_and_diorama() {
    let mut session = TavernSession::new();
    session.diorama.ball_speed = 2.0;

    session.step((0.0, 0.0), 1.0);
    assert!(session.ball_angle > 0.0);

    // Apply counter equip flourish
    session.apply_counter_fx(&["gear"]);
    assert_eq!(session.one_shot_action, Some("equip".to_string()));

    // Apply forge flourish
    session.apply_counter_fx(&["smith"]);
    assert_eq!(session.one_shot_action, Some("forge".to_string()));
}
