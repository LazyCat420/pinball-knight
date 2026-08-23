// Parity test suite for Movement Telegraph to Animation Clip Mapper.
// Replicates legacy/src/game/pinball-knight/render/tell-clips.ts

use pk_gui::render::paint_types::ClipName;
use pk_gui::render::tell_clips::{clip_for_steer, TELL_COMMIT, TELL_LEAP, TELL_PACK};

#[test]
fn clip_for_steer_maps_leap_crouch_only_when_held() {
    assert_eq!(
        clip_for_steer(Some(TELL_LEAP), true, false),
        Some(ClipName::Crouch)
    );
    assert_eq!(clip_for_steer(Some(TELL_LEAP), false, true), None);
}

#[test]
fn clip_for_steer_maps_pack_stalk_gait_only_when_moving() {
    assert_eq!(
        clip_for_steer(Some(TELL_PACK), false, true),
        Some(ClipName::Wait)
    );
    assert_eq!(clip_for_steer(Some(TELL_PACK), false, false), None);
}

#[test]
fn clip_for_steer_maps_commit_burst_only_when_moving() {
    assert_eq!(
        clip_for_steer(Some(TELL_COMMIT), false, true),
        Some(ClipName::Wake)
    );
    assert_eq!(clip_for_steer(Some(TELL_COMMIT), false, false), None);
}

#[test]
fn clip_for_steer_passes_through_for_approach_flavours() {
    assert_eq!(clip_for_steer(Some(0x9fd0ff), false, true), None); // FLANK
    assert_eq!(clip_for_steer(Some(0xffd98a), false, true), None); // STRAFE
    assert_eq!(clip_for_steer(Some(0xc9a0ff), false, true), None); // ORBIT
    assert_eq!(clip_for_steer(None, false, true), None);
}
