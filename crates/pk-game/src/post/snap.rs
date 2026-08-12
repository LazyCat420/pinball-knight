//! Pixel snapping. Both the camera and the sprites land on the same lattice,
//! and the lattice is the camera's own right/up basis — snapping world axes
//! under a 45° yaw is the documented way to get judder instead of stillness
//! (legacy `engine/camera.ts:142-171`, `scenes/tavern/player.ts:66-113`).
//!
//! WHY IT MATTERS. Without this the camera slides by fractions of a render
//! pixel and every static wall crawls and shimmers as you walk — the single
//! most common reason 8-bit 3D looks subtly wrong. It only becomes visible
//! once there IS a low-res lattice to land on, which is why it lives next to
//! `sizing.rs` and reads its resource.
//!
//! ── ORDERING: `PostUpdate`, NOT `.after(the scene's camera system)` ────────
//! The two systems that write the camera transform — `tavern.rs::tavern_camera`
//! and `main.rs::follow_camera` — are private `fn`s in crates/modules this file
//! may not edit, so there is no name to hang `.after(...)` on. `PostUpdate` is
//! the late schedule that is unconditionally after every `Update` system, and
//! `.before(TransformSystems::Propagate)` keeps the snapped `Transform` the one
//! that reaches `GlobalTransform` this frame rather than next.
//!
//! This is safe to do repeatedly because every camera driver in the shell
//! ASSIGNS the translation (`tf.translation = target + camera_offset()`)
//! rather than accumulating into it, so the correction cannot compound across
//! frames. A driver that ever switches to `+=` would need this revisited.
//!
//! ⚠️ AND SO WOULD A PARTIAL ONE — which is how this bit. The rule is not
//! "don't use `+=`", it is **assign every component you do not want the snap
//! to own**. `sync_tavern_knight` wrote `.x` and `.z` and left `.y` alone,
//! which is not accumulation and still defeats the fixed point: the camera's
//! up vector is (-0.435, 0.788, -0.435) under the iso rig, so rounding the up
//! component moves a sprite in world Y, and handing back a fresh x/z with
//! last frame's corrected y meant the snap recomputed a residual every frame
//! instead of settling. Measured live over ~11s of walking: worst deviation
//! 0.0217 world units with the partial write, 0.0000 with a full assignment
//! (one texel is 0.0229).
//!
//! The drift is BOUNDED, not divergent, because the tavern camera eases
//! toward the player — the offset this rounds stays roughly constant. A first
//! diagnosis modelled a stationary camera, predicted a runaway off the top of
//! the screen, and was wrong (docs/src/status/incidents.md). Pinned by
//! `a_partial_restore_leaves_y_unpinned_and_a_full_assignment_does_not`.
//!
//! PORTS-NOTHING — pixel-snapping the camera on Bevy

use bevy::prelude::*;
use bevy::transform::TransformSystems;

use crate::post::sizing::PixelSizing;
use crate::DungeonCamera;

/// Attach to anything whose texels must land on whole render pixels — the
/// knight, the keepers, any billboard.
///
/// Deliberately a marker rather than a query over sprite types: the scenes own
/// their own entities, and the ones that need snapping get to say so without
/// this module knowing what they are. Nothing here attaches it.
#[derive(Component, Debug, Clone, Copy, Default)]
pub struct PixelSnapped;

pub struct SnapPlugin;

impl Plugin for SnapPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<SnapPeak>();
        app.add_systems(
            PostUpdate,
            (snap_camera, snap_sprites, track_snap_peak)
                .chain()
                .before(TransformSystems::Propagate),
        );
    }
}

/// The most extreme Y a snapped sprite has been left at, EVER, this session.
///
/// Sampling the probe from outside sees one frame in three at best, so a
/// per-frame excursion hides between samples — which is exactly the mistake
/// that made an earlier measurement of the knight's drift read as harmless.
/// This watches every frame, after the snap, and only ever widens.
#[derive(Resource, Debug)]
pub struct SnapPeak {
    pub min_y: f32,
    pub max_y: f32,
    pub frames: u64,
}

impl Default for SnapPeak {
    fn default() -> Self {
        Self {
            min_y: f32::INFINITY,
            max_y: f32::NEG_INFINITY,
            frames: 0,
        }
    }
}

fn track_snap_peak(mut peak: ResMut<SnapPeak>, q: Query<&Transform, With<PixelSnapped>>) {
    for tf in &q {
        // Only the knight rides at half a quad; keepers stand on their feet at
        // y≈0 and the blob sits at BLOB_LIFT, so filter to the tall one.
        if tf.translation.y > 0.3 {
            peak.min_y = peak.min_y.min(tf.translation.y);
            peak.max_y = peak.max_y.max(tf.translation.y);
            peak.frames += 1;
        }
    }
}

/// The scene camera, read-only, disjoint from the snapped entities so the two
/// `Transform` accesses in `snap_sprites` cannot alias.
type SceneCameraPose<'w, 's> = Query<
    'w,
    's,
    (&'static Transform, &'static Projection),
    (With<DungeonCamera>, Without<PixelSnapped>),
>;

/// One render pixel, in world units, for this camera.
///
/// The oracle writes it `1 / (PPU * cam.zoom)` and warns that using `1 / PPU`
/// does not disable the snap — it snaps to the WRONG lattice, which is strictly
/// worse, because the motion stays quantised while no longer landing on pixel
/// boundaries. The tavern is exactly where that bit: it runs at 0.78, so a
/// `1 / PPU` step was 0.78 of a pixel and every wall crawled.
///
/// We derive it from the projection instead of re-deriving `PPU * zoom`, and
/// the two agree by construction: `sizing.rs` sets the tavern's frustum to
/// `render_w / (PPU * zoom)` world units wide, so
/// `area.height() / render_h == 1 / (PPU * zoom)`. Reading the projection also
/// gets the dungeon and the intro right for free — they size off `VIEW_H` and
/// `o.scale`, never off `PPU`.
fn lattice_step(sizing: &PixelSizing, proj: &Projection) -> Option<f32> {
    let Projection::Orthographic(o) = proj else {
        // The pixel lattice is an orthographic-only idea: under perspective a
        // sprite covers a different number of pixels at the top of the screen
        // than at the bottom, so there is no single texel size to snap to.
        return None;
    };
    let h = o.area.height();
    if h.is_finite() && h > 1e-4 {
        Some(h / sizing.render_h as f32)
    } else {
        // `area` is only filled in by `camera_system`; on the very first frame
        // it is still the default. Fall back to the oracle's own expression.
        Some(sizing.texel(sizing.zoom()))
    }
}

/// Round to the nearest multiple of `step`.
fn snap(v: f32, step: f32) -> f32 {
    (v / step).round() * step
}

/// Snap the camera along its OWN right/up axes to whole render pixels.
///
/// World-axis snapping only works when world axes map to screen axes. With the
/// 45° yaw they do not, so we project the position onto the camera basis, round
/// each component, and add the correction back along the same two vectors — the
/// projected image then shifts by whole texels regardless of orientation. Same
/// cure, new anatomy (legacy `aimCamera`).
///
/// The forward component is deliberately untouched: an orthographic projection
/// does not care where along its own view axis the camera sits, and moving it
/// there would only nudge the near/far clip.
fn snap_camera(
    sizing: Res<PixelSizing>,
    mut cam_q: Query<(&mut Transform, &Projection), With<DungeonCamera>>,
) {
    for (mut tf, proj) in &mut cam_q {
        let Some(step) = lattice_step(&sizing, proj) else {
            continue;
        };
        let right = tf.rotation * Vec3::X;
        let up = tf.rotation * Vec3::Y;
        let p = tf.translation;
        let (dr, du) = (p.dot(right), p.dot(up));
        let fix = right * (snap(dr, step) - dr) + up * (snap(du, step) - du);
        if fix != Vec3::ZERO {
            tf.translation = p + fix;
        }
    }
}

/// Snap `PixelSnapped` entities onto the same lattice, RELATIVE TO THE CAMERA.
///
/// THE FRAME OF REFERENCE IS THE WHOLE TRICK (legacy `scenes/tavern/player.ts`
/// `syncMesh`). The dungeon's camera has a dead-zone, so it is usually still
/// and a world-space snap is also a screen-space snap. The tavern's camera
/// eases toward its target every single frame with no dead-zone, so the world
/// slid smoothly underneath a sprite hopping on a fixed WORLD lattice, and the
/// sprite visibly juddered against the background even when the player walked
/// in a straight line. Snapping the sprite's OFFSET FROM THE CAMERA keeps its
/// texels on whole pixels — which is the entire point — while the camera's own
/// smooth pan carries it along with the scenery instead of fighting it.
///
/// The oracle uses the camera's AIM POINT as that origin; we use the camera's
/// translation, which differs from it by the fixed `camera_offset()` vector.
/// A constant offset only shifts the lattice's phase, so both are equally
/// judder-free — and the translation is the thing `snap_camera` just put ON the
/// lattice, so the sprites land on the same grid the scenery does.
///
/// TRADEOFF, stated plainly: a snapped sprite is no longer pinned to a fixed
/// world lattice, so relative to the *floor* it can shift by up to half a pixel
/// as the camera eases. That is invisible; the judder it replaces was not.
fn snap_sprites(
    sizing: Res<PixelSizing>,
    cam_q: SceneCameraPose,
    mut q: Query<&mut Transform, (With<PixelSnapped>, Without<DungeonCamera>)>,
) {
    if q.is_empty() {
        return;
    }
    let Ok((cam_tf, proj)) = cam_q.single() else {
        return;
    };
    let Some(step) = lattice_step(&sizing, proj) else {
        return;
    };
    let right = cam_tf.rotation * Vec3::X;
    let up = cam_tf.rotation * Vec3::Y;
    // `Vec3::NEG_Z` in local space is where a Bevy camera looks. The basis is
    // orthonormal, so decomposing and re-summing is lossless for the axis we
    // leave alone — depth is preserved exactly.
    let fwd = cam_tf.rotation * Vec3::NEG_Z;
    let origin = cam_tf.translation;
    for mut tf in &mut q {
        let d = tf.translation - origin;
        let (dr, du, df) = (d.dot(right), d.dot(up), d.dot(fwd));
        let snapped = origin + right * snap(dr, step) + up * snap(du, step) + fwd * df;
        if snapped != tf.translation {
            tf.translation = snapped;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The camera basis the game actually runs at: tilt 38°, yaw 45°.
    fn iso_rotation() -> Quat {
        let tilt = 38.0_f32.to_radians();
        let yaw = 45.0_f32.to_radians();
        let dist = 40.0;
        let horiz = tilt.cos() * dist;
        let offset = Vec3::new(yaw.sin() * horiz, tilt.sin() * dist, yaw.cos() * horiz);
        Transform::from_translation(offset)
            .looking_at(Vec3::ZERO, Vec3::Y)
            .rotation
    }

    #[test]
    fn snapping_lands_on_the_lattice_in_the_camera_basis() {
        let rot = iso_rotation();
        let (right, up) = (rot * Vec3::X, rot * Vec3::Y);
        let step = 1.0 / (56.0 * 0.78);
        let p = Vec3::new(3.137, 2.0, -1.921);
        let (dr, du) = (p.dot(right), p.dot(up));
        let fixed = p + right * (snap(dr, step) - dr) + up * (snap(du, step) - du);
        // Both screen-space components are now whole numbers of render pixels.
        for c in [fixed.dot(right), fixed.dot(up)] {
            let pixels = c / step;
            assert!(
                (pixels - pixels.round()).abs() < 1e-3,
                "{c} is not a whole texel ({pixels} px)"
            );
        }
        // …and the move was sub-pixel: a snap corrects, it does not translate.
        assert!((fixed - p).length() <= step * 0.75);
    }

    #[test]
    fn snapping_world_axes_would_not_land_on_the_lattice() {
        // The documented failure mode, pinned so nobody "simplifies" the basis
        // projection away: under the 45° yaw a world-axis snap leaves the
        // SCREEN-space position between texels.
        let rot = iso_rotation();
        let right = rot * Vec3::X;
        let step = 1.0 / (56.0 * 0.78);
        let p = Vec3::new(3.137, 2.0, -1.921);
        let naive = Vec3::new(snap(p.x, step), snap(p.y, step), snap(p.z, step));
        let pixels = naive.dot(right) / step;
        assert!(
            (pixels - pixels.round()).abs() > 1e-3,
            "a world-axis snap accidentally landed on the lattice"
        );
    }

    #[test]
    fn a_sprite_snap_preserves_depth_and_quantises_the_screen_offset() {
        let rot = iso_rotation();
        let (right, up, fwd) = (rot * Vec3::X, rot * Vec3::Y, rot * Vec3::NEG_Z);
        let step = 1.0 / 56.0;
        let origin = Vec3::new(28.0, 24.6, 28.0);
        let p = Vec3::new(1.234, 0.9, -2.706);
        let d = p - origin;
        let (dr, du, df) = (d.dot(right), d.dot(up), d.dot(fwd));
        let out = origin + right * snap(dr, step) + up * snap(du, step) + fwd * df;
        // Depth from the camera is untouched.
        assert!(((out - origin).dot(fwd) - df).abs() < 1e-4);
        // The screen-space offset is a whole number of texels.
        for c in [(out - origin).dot(right), (out - origin).dot(up)] {
            let pixels = c / step;
            assert!((pixels - pixels.round()).abs() < 1e-3, "{pixels} px");
        }
    }

    #[test]
    fn a_smoothly_panning_camera_does_not_make_the_offset_jump() {
        // The judder this system exists to remove: with the camera as the
        // origin, a sprite that does not move relative to the camera keeps the
        // SAME snapped offset no matter where the camera has eased to. Against
        // a world lattice the offset would hop by a texel as the camera slid.
        let rot = iso_rotation();
        let (right, up, fwd) = (rot * Vec3::X, rot * Vec3::Y, rot * Vec3::NEG_Z);
        let step = 1.0 / (56.0 * 0.78);
        let rel = Vec3::new(0.813, 0.55, -1.207);
        let mut seen: Option<Vec3> = None;
        for i in 0..40 {
            // An eased pan: sub-pixel steps, never a whole texel.
            let origin = Vec3::new(28.0, 24.6, 28.0) + Vec3::X * (i as f32 * step * 0.137);
            let p = origin + rel;
            let d = p - origin;
            let out = origin
                + right * snap(d.dot(right), step)
                + up * snap(d.dot(up), step)
                + fwd * d.dot(fwd);
            let offset = out - origin;
            match seen {
                None => seen = Some(offset),
                Some(first) => assert!(
                    (offset - first).length() < 1e-4,
                    "the offset moved by {} at step {i}",
                    (offset - first).length()
                ),
            }
        }
    }

    #[test]
    fn the_lattice_step_reads_the_projection_and_agrees_with_the_oracle() {
        let sizing = crate::post::sizing::compute_render_sizing(1280.0, 720.0, 1.0);
        // The live case. `sizing.rs` gives the tavern a frustum of
        // render / (PPU * zoom) world units, so 720 render px over
        // 720 / (56 * 0.78) units is exactly the oracle's 1 / (PPU * zoom).
        let mut o = OrthographicProjection::default_3d();
        o.area = Rect::from_center_size(
            Vec2::ZERO,
            Vec2::new(1280.0 / (56.0 * 0.78), 720.0 / (56.0 * 0.78)),
        );
        let step = lattice_step(&sizing, &Projection::Orthographic(o)).expect("orthographic");
        assert!((step - 1.0 / (56.0 * 0.78)).abs() < 1e-6, "{step}");
    }

    /// A partial restore leaves Y for the snap to own; a full one pins it.
    ///
    /// The header promises this correction cannot compound, and that promise
    /// rests on the driver ASSIGNING the whole translation. The tavern
    /// knight's driver assigned x and z and left y alone — and under the iso
    /// rig the camera's up vector is (-0.435, 0.788, -0.435), so rounding the
    /// "up" component moves a sprite in world Y too. Feeding a fresh x/z back
    /// with last frame's corrected y made the snap recompute a residual every
    /// frame instead of settling on its fixed point.
    ///
    /// ⚠️ THE CAMERA FOLLOWS, so this is BOUNDED WANDER, not a runaway. The
    /// loop below eases the origin toward the walker exactly as
    /// `tavern_camera` does, because a model with a stationary camera makes
    /// the offset grow without limit and predicts a divergence the real
    /// system does not have — that error survived a whole diagnosis before a
    /// live measurement caught it (docs/src/status/incidents.md). Live figures
    /// over ~11s of walking: 0.0217 with the defect, 0.0000 with the fix.
    ///
    /// Both halves are pinned, because the fix is only meaningful against the
    /// failure: a partial restore MOVES, a full assignment does not.
    #[test]
    fn a_partial_restore_leaves_y_unpinned_and_a_full_assignment_does_not() {
        let rot = iso_rotation();
        let (right, up, fwd) = (rot * Vec3::X, rot * Vec3::Y, rot * Vec3::NEG_Z);
        let step = 1.0 / (56.0 * 0.78);
        let ground = 1.15 / 2.0; // KNIGHT_QUAD_H / 2.0
        let cam_off = Vec3::new(28.0, 24.6, 28.0);
        // `tavern_camera`'s ease, so the origin this rounds against tracks the
        // walker instead of receding from him.
        let snap_once = |p: Vec3, cam: Vec3| {
            let origin = cam + cam_off;
            let d = p - origin;
            origin
                + right * snap(d.dot(right), step)
                + up * snap(d.dot(up), step)
                + fwd * d.dot(fwd)
        };
        let walk = |f: i32| Vec3::new(0.02 * f as f32, 0.0, 0.0);

        // 600 frames of walking, restoring ONLY x and z — the old driver.
        let mut y = ground;
        let mut cam = Vec3::ZERO;
        let mut worst: f32 = 0.0;
        for f in 0..600 {
            let p = walk(f);
            cam += (p - cam) * 0.08;
            y = snap_once(Vec3::new(p.x, y, p.z), cam).y;
            worst = worst.max((y - ground).abs());
        }
        assert!(
            worst > step * 0.5,
            "the partial restore moved y by only {worst}, less than half a \
             texel — if this stopped moving, the snap or the basis changed and \
             the comment above is now the only record of why the driver \
             assigns all three"
        );
        assert!(
            worst < 1.15 / 2.0,
            "y moved {worst}, half a quad or more. The live measurement is \
             0.0217; a number this large means the camera ease is gone from \
             this model (or from the game) and the loop has actually diverged"
        );

        // The same walk, assigning all three — what the driver does now.
        let mut last = Vec3::ZERO;
        let mut cam = Vec3::ZERO;
        for f in 0..600 {
            let p = walk(f);
            cam += (p - cam) * 0.08;
            last = snap_once(Vec3::new(p.x, ground, p.z), cam);
        }
        assert!(
            (last.y - ground).abs() <= step,
            "a full assignment must stay within one texel of the floor, got {}",
            last.y - ground
        );
    }

    #[test]
    fn a_degenerate_projection_falls_back_to_the_oracles_expression() {
        // Not reachable in the live app — `camera_system` is registered in
        // `PostStartup` as well as `PostUpdate`, so `area` is real by the first
        // frame, and Bevy's `default_3d()` ships a non-degenerate -1..1
        // placeholder anyway. The guard exists so a zero-area projection can
        // never produce a zero or infinite step.
        let sizing = crate::post::sizing::compute_render_sizing(1280.0, 720.0, 1.0);
        let mut o = OrthographicProjection::default_3d();
        o.area = Rect::default();
        let step = lattice_step(&sizing, &Projection::Orthographic(o)).expect("orthographic");
        assert!((step - 1.0 / (56.0 * 0.78)).abs() < 1e-6, "{step}");
    }
}
