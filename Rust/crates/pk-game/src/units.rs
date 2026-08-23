//! THREE.js → Bevy unit conversions, in one place.
//!
//! Every one of these was derived once, in `tavern.rs`, against a room whose
//! numbers came out of the oracle — and then the dungeon needed the same three
//! and the choice was to copy them or to move them. They are here because the
//! failure mode of the copy is silent: two rooms lit with two slightly different
//! candela→lumen constants look plausible on their own and can never be A/B'd
//! against the same oracle.
//!
//! The derivations stay with the constants; they are the whole value.
//!
//! PORTS-NOTHING — THREE.js -> Bevy unit conversions; the constants they convert are cited where they are used

use bevy::prelude::*;

/// 1 / `Exposure::BLENDER.exposure()`. Bevy scales every LIT surface by the
/// camera's exposure before anything else sees it — `ev100 = 9.7`, so
/// `2^-9.7 / 1.2` ≈ 1/998 (bevy_camera camera.rs:232,244, and this app spawns
/// its camera with no `Exposure`, so it gets that default). three.js has no
/// such stage at all, which is the whole reason these numbers are in the
/// thousands and the oracle's are single digits.
pub const EXPOSURE_RECIP: f32 = 998.1;

/// THREE candela → Bevy lumens. One knob for every point light in the game,
/// and no longer a guess: `4π / exposure` ≈ 12_542.
pub const PL: f32 = 4.0 * std::f32::consts::PI * EXPOSURE_RECIP;

/// A packed `0xRRGGBB` from the legacy palette as an sRGB colour.
pub fn c(hex: u32) -> Color {
    Color::srgb_u8(
        ((hex >> 16) & 0xff) as u8,
        ((hex >> 8) & 0xff) as u8,
        (hex & 0xff) as u8,
    )
}

/// The BAKED billboard orientation (legacy `sprite.ts:44-48 faceCamera`): yaw
/// to the camera's heading, then tilt back by its elevation, in YXZ order so
/// the X tilt stays local — which is what keeps sprite texels square under the
/// orthographic camera. The iso camera never moves, so this is computed once
/// per sprite rather than billboarded per frame; `lean` is the only per-frame
/// term (a keeper's `rot_z`), composed here instead of overwriting the bake.
pub fn billboard(lean: f32) -> Quat {
    Quat::from_euler(EulerRot::YXZ, crate::CAM_YAW, -crate::CAM_TILT, lean)
}
