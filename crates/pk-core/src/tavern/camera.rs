//! The tavern's camera targeting — the pure frame math from
//! `legacy/src/scenes/tavern/core.ts` (CAM_LEAN / CAM_LERP and the per-frame
//! ease). Zoom fitting (`fitZoom`) reads the render target and stays in the
//! shell; this is only the aim point.
//!
//! PORTS-NOTHING — helper module, full core.ts port lives in tavern/core.rs

pub use super::core::{
    CAM_LEAN, CAM_LERP, CAM_ZOOM_WIDE, ROOM_CENTER_X, ROOM_CENTER_Z,
    ROOM_FOOTPRINT_TILES_H, ROOM_FOOTPRINT_TILES_W,
};

/// Where the camera should aim this frame: anchored on the room's centre,
/// leaning a fraction toward the player — and further toward a focused
/// station, so the room subtly presents what you're about to use. Never a
/// full follow: this is a staged single-screen hub.
pub fn camera_target(player_x: f64, player_z: f64, focus: Option<(f64, f64)>) -> (f64, f64) {
    let (lean_x, lean_z) = match focus {
        Some((fx, fz)) => ((fx + player_x) / 2.0, (fz + player_z) / 2.0),
        None => (player_x, player_z),
    };
    (
        ROOM_CENTER_X + (lean_x - ROOM_CENTER_X) * CAM_LEAN,
        ROOM_CENTER_Z + (lean_z - ROOM_CENTER_Z) * CAM_LEAN,
    )
}

/// One frame of the camera ease toward its target (legacy `frame()`'s lerp).
pub fn ease_camera(cam_x: &mut f64, cam_z: &mut f64, tx: f64, tz: f64, dt: f64) {
    let k = (dt * CAM_LERP).min(1.0);
    *cam_x += (tx - *cam_x) * k;
    *cam_z += (tz - *cam_z) * k;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_centred_player_holds_the_room_centre() {
        let (tx, tz) = camera_target(ROOM_CENTER_X, ROOM_CENTER_Z, None);
        assert_eq!((tx, tz), (ROOM_CENTER_X, ROOM_CENTER_Z));
    }

    #[test]
    fn the_camera_carries_a_fraction_of_the_players_offset() {
        let (tx, _) = camera_target(4.0, 0.0, None);
        assert!((tx - 4.0 * CAM_LEAN).abs() < 1e-12);
    }

    #[test]
    fn focus_pulls_the_aim_halfway_toward_the_station() {
        let (tx, tz) = camera_target(0.0, 4.0, Some((0.0, -4.9)));
        // Midpoint (0, -0.45), leaned by CAM_LEAN.
        assert!((tx - 0.0).abs() < 1e-12);
        assert!((tz - (-0.45 * CAM_LEAN)).abs() < 1e-12);
    }

    #[test]
    fn the_ease_is_stable_at_large_dt() {
        let (mut cx, mut cz) = (0.0, 0.0);
        // A 2s hitch clamps k at 1 — the camera lands, never overshoots.
        ease_camera(&mut cx, &mut cz, 3.0, -2.0, 2.0);
        assert_eq!((cx, cz), (3.0, -2.0));
    }
}
