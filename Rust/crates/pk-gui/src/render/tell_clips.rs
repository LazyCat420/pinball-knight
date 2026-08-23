//! Movement Telegraph to Animation Clip Mapper — Translation from intent colors to learnable sprite animations.
//!
//! PORTS: `render/tell-clips.ts`

use crate::render::paint_types::ClipName;

pub const TELL_LEAP: u32 = 0xff4d2a;
pub const TELL_PACK: u32 = 0x8fe08f;
pub const TELL_COMMIT: u32 = 0xff7a2a;

/// Selects an animation clip override based on an actor's active movement telegraph color.
pub fn clip_for_steer(tell_color: Option<u32>, hold: bool, moving: bool) -> Option<ClipName> {
    let color = tell_color?;
    match color {
        // The crouch. Only while the actor is actually held during leap windup.
        TELL_LEAP => {
            if hold {
                Some(ClipName::Crouch)
            } else {
                None
            }
        }
        // The stalk. The pack-hunter shadows at half speed; wait is a stalking gait.
        TELL_PACK => {
            if moving {
                Some(ClipName::Wait)
            } else {
                None
            }
        }
        // The burst. Shared by ambusher spring and strafer dart.
        TELL_COMMIT => {
            if moving {
                Some(ClipName::Wake)
            } else {
                None
            }
        }
        // Approach flavours (flank, strafe, orbit) are represented by tint alone.
        _ => None,
    }
}
