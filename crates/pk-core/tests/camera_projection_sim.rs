// Parity test suite for Isometric Orthographic Camera Math.
// Replicates legacy/src/game/pinball-knight/engine/camera.ts

use pk_core::camera::{
    screen_dir_to_world, screen_px_to_world_ground, step_camera, world_to_screen_px,
    IsoCamera, ISO_YAW,
};

#[test]
fn screen_dir_to_world_rotates_isometric_45_degrees() {
    // Screen Up (0, -1) -> World (-sin45, -cos45) = (-0.7071, -0.7071)
    let (wx, wz) = screen_dir_to_world(0.0, -1.0, ISO_YAW);
    assert!((wx - (-0.7071)).abs() < 0.01);
    assert!((wz - (-0.7071)).abs() < 0.01);

    // Screen Right (1, 0) -> World (cos45, -sin45) = (0.7071, -0.7071)
    let (wx2, wz2) = screen_dir_to_world(1.0, 0.0, ISO_YAW);
    assert!((wx2 - 0.7071).abs() < 0.01);
    assert!((wz2 - (-0.7071)).abs() < 0.01);
}

#[test]
fn world_and_screen_coordinates_roundtrip_at_ground_plane() {
    let mut cam = IsoCamera::default();
    cam.current_x = 10.0;
    cam.current_z = 20.0;

    let target_world_x = 14.5;
    let target_world_z = 22.3;
    let vp_w = 640.0;
    let vp_h = 360.0;

    // Project world to screen
    let (px, py) = world_to_screen_px(&cam, target_world_x, 0.0, target_world_z, vp_w, vp_h);

    // Unproject screen back to ground plane
    let (unproj_x, unproj_z) = screen_px_to_world_ground(&cam, px, py, vp_w, vp_h);

    assert!((unproj_x - target_world_x).abs() < 0.001);
    assert!((unproj_z - target_world_z).abs() < 0.001);
}

#[test]
fn step_camera_tracks_target_and_leads_velocity() {
    let mut cam = IsoCamera::default();

    // Step towards player moving right at 10 m/s
    step_camera(&mut cam, 10.0, 0.0, 10.0, 0.0, 0.1);

    assert!(cam.current_x > 0.0);
    assert!(cam.lead_x > 0.0);
}
