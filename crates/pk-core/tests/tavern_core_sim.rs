//! Comprehensive test suite for legacy/src/scenes/tavern/core.ts tavern scene bootstrap, options, locomotion, camera, and station focus.

use pk_core::tavern::core::*;
use pk_core::tavern::layout::{
    ROOM_CENTER_X, ROOM_CENTER_Z, ROOM_MAX_X, ROOM_MAX_Z, ROOM_MIN_X, ROOM_MIN_Z,
};
use pk_core::tavern::state::TavernStats;

#[test]
fn tavern_core_constants_match_oracle() {
    assert_eq!(BG_COLOR, 0x07090d);
    assert_eq!(FOG_COLOR, 0x141018);
    assert_eq!(FOG_NEAR, 28.0);
    assert_eq!(FOG_FAR, 64.0);

    assert_eq!(CAM_LEAN, 0.72);
    assert_eq!(CAM_LERP, 3.4);
    assert_eq!(CAMERA_DIST, 24.0);
    assert_eq!(PLAYER_SPEED, 4.0);

    let fog = TavernFogConfig::default();
    assert_eq!(fog.near, 28.0);
    assert_eq!(fog.far, 64.0);
}

#[test]
fn tavern_session_lifecycle() {
    let mut session = TavernSession::new();
    assert!(!is_tavern_scene_open(&session));

    let opened = open_tavern_scene(
        &mut session,
        TavernOptions {
            stats: TavernStats::default(),
            lobby: false,
        },
    );
    assert!(opened);
    assert!(is_tavern_scene_open(&session));

    close_tavern(&mut session);
    assert!(!is_tavern_scene_open(&session));
}

#[test]
fn tavern_locomotion_bounds_and_camera_tracking() {
    let mut session = TavernSession::new();
    open_tavern_scene(&mut session, TavernOptions::default());

    // Move diagonally for 10 seconds -> must clamp inside room walls
    session.step((1.0, 1.0), 10.0);
    assert!(session.player_pos.0 <= ROOM_MAX_X - 0.5);
    assert!(session.player_pos.1 <= ROOM_MAX_Z - 0.5);

    // Camera tracks towards player position
    assert!(session.camera_pos.0 != ROOM_CENTER_X);
    assert!(session.camera_pos.1 != ROOM_CENTER_Z);

    // Move back northwest
    session.step((-1.0, -1.0), 20.0);
    assert!(session.player_pos.0 >= ROOM_MIN_X + 0.5);
    assert!(session.player_pos.1 >= ROOM_MIN_Z + 0.5);
}

#[test]
fn station_focus_and_interaction() {
    let mut session = TavernSession::new();
    open_tavern_scene(&mut session, TavernOptions::default());

    let _st = session.interact_station();
}

#[test]
fn camera_focus_and_vfx_functions() {
    let (tx, tz) = camera_target_for_focus(2.0, 4.0, Some((6.0, 8.0)));
    assert!(tx > ROOM_CENTER_X);
    assert!(tz > ROOM_CENTER_Z);

    let h_int = hearth_flicker_intensity(1.5);
    assert!(h_int > 0.0);

    let c_int = coals_emissive_intensity(1.5);
    assert!(c_int > 0.0);

    let lit_b = bumper_emissive_intensity(1.0, 0, 3);
    let dark_b = bumper_emissive_intensity(1.0, 4, 3);
    assert!(lit_b >= 0.5);
    assert_eq!(dark_b, 0.04);

    let ball_pos = diorama_ball_position(0.0);
    assert!((ball_pos.0 - DIORAMA_BALL_RX).abs() < 1e-6);
}
