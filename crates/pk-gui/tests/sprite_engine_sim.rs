// Parity test suite for Sprite Atlas and Billboarding Engine.
// Replicates legacy/src/game/pinball-knight/engine/render/sprite.ts

use pk_gui::engine::render::sprite::{
    face_camera, face_camera_yaw, SpriteQuad, SpriteSheetAtlas,
};

#[test]
fn sprite_quad_bottom_center_origin_bounds() {
    let quad = SpriteQuad::new(2.0, 3.0);
    let vertices = quad.vertices();

    // Bottom-left
    assert_eq!(vertices[0], [-1.0, 0.0, 0.0]);
    // Bottom-right
    assert_eq!(vertices[1], [1.0, 0.0, 0.0]);
    // Top-right
    assert_eq!(vertices[2], [1.0, 3.0, 0.0]);
    // Top-left
    assert_eq!(vertices[3], [-1.0, 3.0, 0.0]);
}

#[test]
fn sprite_sheet_atlas_uv_strip_bounds() {
    let atlas = SpriteSheetAtlas::new(4);

    let (u0, u1) = atlas.frame_uv_bounds(0);
    assert_eq!((u0, u1), (0.0, 0.25));

    let (u2, u3) = atlas.frame_uv_bounds(2);
    assert_eq!((u2, u3), (0.5, 0.75));
}

#[test]
fn billboard_orientation_solvers() {
    let rot = face_camera(0.0, 0.663);
    assert_eq!(rot, [-0.663, 0.0, 0.0]);

    let yaw = face_camera_yaw((0.0, 0.0), (0.0, 10.0));
    assert_eq!(yaw, 0.0);
}
