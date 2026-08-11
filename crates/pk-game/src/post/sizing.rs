//! Render-size arithmetic, ported from `computeRenderSizing` /  `fitZoom`.
//! Pure functions + a resource; no Bevy types beyond the resource derive so
//! the port stays unit-testable against the oracle's measured tables.
//!
//! …and then the plumbing that makes the arithmetic real: the low-res scene
//! target, the integer nearest-neighbour present layer, and the resize
//! response. Oracle: `legacy/src/game/pinball-knight/engine/render/
//! pixel-pass.ts:1129-1220` (sizing) + `:1550-` (`resize`, the centred canvas)
//! and `legacy/src/scenes/tavern/core.ts:146-169` (`fitZoom` / `applyZoom`).
//!
//! THE LOOK THIS BUYS. Everything 3D is drawn once into a `render_w x
//! render_h` texture and blitted to the window at a WHOLE-number scale with a
//! nearest sampler. A fractional upscale (the old x1.5) makes every render
//! pixel alternately 1 and 2 screen pixels wide, in a fixed comb across the
//! whole screen — which reads as "the game is blurry" rather than as a bug in
//! any one asset. Integer-only is the invariant; a letterbox is the fallback.

use bevy::camera::ScalingMode;
use bevy::camera::{Camera, RenderTarget};
use bevy::image::ImageSampler;
use bevy::prelude::*;
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat, TextureUsages};
use bevy::render::view::Hdr;
use bevy::window::{PrimaryWindow, WindowResized};

use pk_core::tavern::camera::{CAM_ZOOM_WIDE, ROOM_FOOTPRINT_TILES_H, ROOM_FOOTPRINT_TILES_W};

use crate::{AppState, DungeonCamera};

/// legacy constants/render.ts — the reference floor, not a target size.
pub const RENDER_W: u32 = 1280;
pub const RENDER_H: u32 = 720;
/// Pixels per world unit at the shipped `wider` zoom rung.
pub const PPU: f32 = 56.0;

/// The widest / tallest grid we will ever allocate (legacy
/// `constants/render.ts:71-72`). Past this the integer scale is KEPT and the
/// canvas letterboxes: a 7680x1080 ultrawide pins the scale at 1 and would
/// otherwise ask for a 7680-wide target.
pub const MAX_RENDER_W: u32 = 2160;
pub const MAX_RENDER_H: u32 = 1216;
/// The most an upscale may grow while chasing the ceiling (pixel-pass.ts:1229).
/// A backstop, not a tuning knob — at scale 8 a 1920 grid needs a 15360 window.
pub const MAX_SCALE: u32 = 8;
/// The smallest grid the scale-bump may land on (pixel-pass.ts:1239-1240).
/// Below this the cure is worse than the letterbox.
pub const MIN_BUMP_W: u32 = 1024;
pub const MIN_BUMP_H: u32 = 576;

/// The near/far planes of `createDungeonCamera` (legacy `engine/camera.ts:19`).
/// NOT cosmetic: the AO stage's depth thresholds are absolute fractions of this
/// range, so changing it re-tunes the occlusion without touching its config.
pub const CAM_NEAR: f32 = 0.1;
pub const CAM_FAR: f32 = 200.0;

/// The live render lattice: how big the scene target is, and how many screen
/// pixels one of its texels covers.
#[derive(Resource, Debug, Clone, Copy, PartialEq, Eq)]
pub struct PixelSizing {
    pub render_w: u32,
    pub render_h: u32,
    pub scale: u32,
    /// `render_* * scale` — the size the blit covers, in LOGICAL window px.
    pub out_w: u32,
    pub out_h: u32,
    /// True when even `MAX_SCALE` could not get the grid under the ceiling, so
    /// the grid was clamped and the window letterboxes on purpose.
    pub capped: bool,
}

impl Default for PixelSizing {
    fn default() -> Self {
        Self {
            render_w: RENDER_W,
            render_h: RENDER_H,
            scale: 1,
            out_w: RENDER_W,
            out_h: RENDER_H,
            capped: false,
        }
    }
}

impl PixelSizing {
    /// The tavern's framing zoom for this lattice — see [`fit_zoom`].
    pub fn zoom(&self) -> f32 {
        fit_zoom(self.render_w, self.render_h)
    }

    /// One render-target texel, in world units, for a camera at `zoom`.
    ///
    /// The oracle's `1 / (PPU * zoom)` (`engine/camera.ts:163`). Getting this
    /// wrong does not disable the snap, it snaps to the WRONG lattice — which
    /// is strictly worse than not snapping, because the motion is still
    /// quantised and no longer lands on pixel boundaries.
    pub fn texel(&self, zoom: f32) -> f32 {
        1.0 / (PPU * zoom.max(f32::EPSILON))
    }
}

/// Round UP to the next even number (`evenCeil`, pixel-pass.ts:1089).
fn even_ceil(v: f64) -> u32 {
    let e = 2.0 * (v / 2.0).ceil();
    if e.is_finite() && e > 0.0 {
        e as u32
    } else {
        2
    }
}

/// ADAPTIVE INTEGER RENDER SIZE — the port of `computeRenderSizing`.
///
/// ```text
/// w = floor(winW * zoom);  h = floor(winH * zoom)
/// scale   = max(1, floor(min(w / RENDER_W, h / RENDER_H)))
/// renderW = evenCeil(w / scale)      ⇒  renderW * scale >= w  (no bars)
/// while grid over the ceiling and scale < MAX_SCALE:
///     bump scale by 1 — unless the next grid falls under MIN_BUMP_*
/// ```
///
/// WHY EVEN. An ODD render width puts the orthographic frustum's centre on a
/// half-texel (`left = -renderW / (2 * PPU)`), and EVERY sprite in the scene
/// inherits that half-pixel shift and samples between texels. Rounding up to
/// even costs at most one render pixel and keeps the centre on the grid.
///
/// WHY THE CEILING RAISES THE SCALE RATHER THAN CLAMPING THE GRID. `scale` has
/// already been chosen against the unclamped size, so clamping the grid alone
/// makes `out = renderW * scale` come out SMALLER than the window and the
/// difference shows as black bars — measured on a 1080p monitor, the whole
/// 1921..2559 x 1081..1439 band letterboxed while the steps either side of it
/// did not. Raising the scale is the same trade the rest of the function makes.
///
/// `browser_zoom` IS ALWAYS 1.0 HERE. The oracle's third argument cancels
/// ctrl +/- (`cancelBrowserZoom`, pixel-pass.ts:1080-1086) by reading
/// `devicePixelRatio` against `outerWidth / innerWidth`. We deliberately do NOT
/// port that: the native shell has no browser zoom, and the wasm harness runs
/// at 100% — where `snapZoomStep` explicitly refuses to read a zoom off an
/// emulated viewport anyway. The parameter is kept so the arithmetic stays
/// shape-identical to the oracle and the tests can drive it.
pub fn compute_render_sizing(win_w: f64, win_h: f64, browser_zoom: f64) -> PixelSizing {
    let w = ((win_w * browser_zoom).floor().max(1.0)) as u32;
    let h = ((win_h * browser_zoom).floor().max(1.0)) as u32;

    let base = (f64::from(w) / f64::from(RENDER_W)).min(f64::from(h) / f64::from(RENDER_H));
    let mut scale = if base.is_finite() && base >= 1.0 {
        base.floor() as u32
    } else {
        1
    };
    scale = scale.max(1);

    let mut render_w = even_ceil(f64::from(w) / f64::from(scale));
    let mut render_h = even_ceil(f64::from(h) / f64::from(scale));
    while (render_w > MAX_RENDER_W || render_h > MAX_RENDER_H) && scale < MAX_SCALE {
        let next = scale + 1;
        let nw = even_ceil(f64::from(w) / f64::from(next));
        let nh = even_ceil(f64::from(h) / f64::from(next));
        // The bump is only allowed while the grid it produces is still a
        // PLAYABLE resolution: on a 7680x1080 ultrawide, chasing the ceiling
        // with scale alone reaches 1920x270 — four tiles of vertical view.
        // There, bars are the right answer and the clamp below takes over.
        if nw < MIN_BUMP_W || nh < MIN_BUMP_H {
            break;
        }
        scale = next;
        render_w = nw;
        render_h = nh;
    }

    let capped_w = render_w.min(MAX_RENDER_W);
    let capped_h = render_h.min(MAX_RENDER_H);
    PixelSizing {
        render_w: capped_w,
        render_h: capped_h,
        scale,
        out_w: capped_w * scale,
        out_h: capped_h * scale,
        capped: capped_w < render_w || capped_h < render_h,
    }
}

/// The tavern's ONE zoom for this visit (legacy `scenes/tavern/core.ts:146`).
///
/// Exactly 1 when the render target can hold the room's iso footprint (so the
/// tavern is genuinely 1 texel : 1 pixel), otherwise the wide framing. Never
/// anything BETWEEN the two and never above 1: magnifying would break the texel
/// identity just as badly as shrinking.
///
/// At PPU 56 the room needs `22.63 * 56 = 1267.3` x `16.45 * 56 = 921.2` — so a
/// 1280x720 window (grid 1280x720) fails on HEIGHT and runs wide, while a
/// 1920x1080 window (grid 1920x1080) fits and is pixel-perfect.
pub fn fit_zoom(render_w: u32, render_h: u32) -> f32 {
    let fits = f64::from(render_w) / f64::from(PPU) >= ROOM_FOOTPRINT_TILES_W
        && f64::from(render_h) / f64::from(PPU) >= ROOM_FOOTPRINT_TILES_H;
    if fits {
        1.0
    } else {
        CAM_ZOOM_WIDE as f32
    }
}

// ────────────────────────────────────────────────────────────────────────────
// The plumbing
// ────────────────────────────────────────────────────────────────────────────

/// The scene's low-res colour target and the size it was allocated at.
#[derive(Resource)]
pub struct SceneTarget {
    pub image: Handle<Image>,
    pub w: u32,
    pub h: u32,
}

/// The window-space camera that blits the lattice. `order: 1` so it draws
/// after the scene, and `IsDefaultUiCamera` so every existing UI root (frame
/// stats, build stamp, fade overlay, the tavern's prompt and panels) resolves
/// to it rather than to the 3D camera — see the note on `ensure_present_layer`.
#[derive(Component)]
pub struct PresentCamera;

/// The full-window root the blit lives in.
#[derive(Component)]
struct PresentRoot;

/// The `ImageNode` that IS the blit.
#[derive(Component)]
struct PresentImage;

/// Owns the scene render target, the present layer and the resize response.
pub struct SizingPlugin;

impl Plugin for SizingPlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(
            Update,
            (ensure_present_layer, sync_lattice, sync_present_layout).chain(),
        )
        .add_systems(
            PostUpdate,
            drive_scene_camera.before(bevy::camera::CameraUpdateSystems),
        );
    }
}

/// Spawn the present camera and the blit node exactly once.
///
/// WHY `IsDefaultUiCamera` IS SAFE TO ADD HERE, AND WHY IT IS NEEDED. Bevy
/// 0.17's `DefaultUiCamera::get` (bevy_ui `ui_node.rs:2783`) first looks for a
/// single camera marked `IsDefaultUiCamera`, and only otherwise falls back to
/// "the highest-order camera whose target is the primary WINDOW". The moment
/// `drive_scene_camera` points the 3D camera at an image, that fallback would
/// have picked this camera anyway — the marker just makes it deterministic
/// instead of dependent on which cameras happen to exist (the intro and the FX
/// work spawn their own). No UI spawn site is touched: the marker lives on OUR
/// camera, which is what the brief allows.
///
/// AND WHY THE BLIT STILL RENDERS UNDERNEATH. All UI now shares one camera, so
/// stacking is by `GlobalZIndex`; the blit root takes -100, which is below the
/// implicit 0 of the frame stats / build stamp / tavern panels and far below
/// the fade overlay's 100. Spawn ORDER therefore does not matter, which it
/// otherwise would — `setup_common` and this system both land in the first
/// frames with no ordering between them.
fn ensure_present_layer(mut commands: Commands, existing: Query<(), With<PresentCamera>>) {
    if !existing.is_empty() {
        return;
    }
    commands.spawn((
        PresentCamera,
        Camera2d,
        Camera {
            order: 1,
            ..default()
        },
        IsDefaultUiCamera,
    ));
    commands
        .spawn((
            PresentRoot,
            Node {
                position_type: PositionType::Absolute,
                left: Val::Px(0.0),
                top: Val::Px(0.0),
                width: Val::Percent(100.0),
                height: Val::Percent(100.0),
                ..default()
            },
            // Under every other UI root; see the doc comment.
            GlobalZIndex(-100),
        ))
        .with_children(|p| {
            p.spawn((
                PresentImage,
                ImageNode {
                    // `Stretch`, not `Auto`: the node's size is the authority
                    // (out_w x out_h logical px), not the texture's.
                    image_mode: NodeImageMode::Stretch,
                    ..default()
                },
                Node {
                    position_type: PositionType::Absolute,
                    ..default()
                },
            ));
        });
}

/// Recompute the lattice from the window and (re)allocate the target.
///
/// LOGICAL, NOT PHYSICAL, PIXELS. The oracle sizes off `window.innerWidth` with
/// `renderer.setPixelRatio(1)` — devicePixelRatio is deliberately ignored, so a
/// Retina panel gets the same grid as a 1x one and only the final blit is
/// resampled by the compositor. Bevy's `Window::width()/height()` are logical,
/// which is the exact analogue; `scale_factor` is never consulted.
fn sync_lattice(
    mut commands: Commands,
    mut images: ResMut<Assets<Image>>,
    mut sizing: ResMut<PixelSizing>,
    target: Option<ResMut<SceneTarget>>,
    window: Query<&Window, With<PrimaryWindow>>,
    mut resized: MessageReader<WindowResized>,
    mut image_q: Query<&mut ImageNode, With<PresentImage>>,
) {
    let Ok(win) = window.single() else { return };
    // Drain the resize stream: the window query alone is enough to notice a
    // change, but reading the messages keeps them from piling up and makes the
    // "recompute on WindowResized" contract explicit.
    resized.clear();

    let next = compute_render_sizing(f64::from(win.width()), f64::from(win.height()), 1.0);
    if *sizing != next {
        *sizing = next;
    }

    let stale = match &target {
        Some(t) => t.w != next.render_w || t.h != next.render_h,
        None => true,
    };
    if !stale {
        return;
    }

    let mut img = Image::new_fill(
        Extent3d {
            width: next.render_w,
            height: next.render_h,
            depth_or_array_layers: 1,
        },
        TextureDimension::D2,
        &[0, 0, 0, 255],
        TextureFormat::Rgba8UnormSrgb,
        // The main world keeps the descriptor (the UI layout and the camera
        // both read the size back); the fill data is one texel wide.
        bevy::asset::RenderAssetUsages::default(),
    );
    img.texture_descriptor.usage =
        TextureUsages::RENDER_ATTACHMENT | TextureUsages::TEXTURE_BINDING | TextureUsages::COPY_DST;
    // THE WHOLE POINT: nearest on the way out. A linear filter here would put
    // the anti-aliasing back that the low-res target exists to remove.
    img.sampler = ImageSampler::nearest();

    let handle = images.add(img);
    for mut node in &mut image_q {
        node.image = handle.clone();
    }
    // Replacing the resource drops the previous handle; with no other strong
    // reference the old texture is freed on the next asset sweep.
    commands.insert_resource(SceneTarget {
        image: handle,
        w: next.render_w,
        h: next.render_h,
    });
}

/// Size and centre the blit — the port of `pixel-pass.ts`'s `resize()`.
///
/// The canvas is CENTRED, and when the ceiling bites it is SMALLER than the
/// window (bars); when the grid rounds up it is at most one scale-step LARGER
/// and hangs off both edges. `left`/`top` are therefore `(win - out) / 2` and
/// are allowed to go negative, exactly like the legacy element's `top`.
fn sync_present_layout(
    sizing: Res<PixelSizing>,
    window: Query<&Window, With<PrimaryWindow>>,
    mut node_q: Query<&mut Node, With<PresentImage>>,
) {
    let Ok(win) = window.single() else { return };
    let Ok(mut node) = node_q.single_mut() else {
        return;
    };
    let out_w = sizing.out_w as f32;
    let out_h = sizing.out_h as f32;
    let left = ((win.width() - out_w) / 2.0).round();
    let top = ((win.height() - out_h) / 2.0).round();
    if node.width != Val::Px(out_w) {
        node.width = Val::Px(out_w);
    }
    if node.height != Val::Px(out_h) {
        node.height = Val::Px(out_h);
    }
    if node.left != Val::Px(left) {
        node.left = Val::Px(left);
    }
    if node.top != Val::Px(top) {
        node.top = Val::Px(top);
    }
}

/// The 3D camera and everything on it this module writes. `Without<PresentCamera>`
/// so the two camera queries can never alias.
type SceneCameraRig<'w, 's> = Query<
    'w,
    's,
    (
        Entity,
        &'static mut Camera,
        &'static mut Projection,
        Option<&'static mut Msaa>,
        Option<&'static Hdr>,
    ),
    (With<DungeonCamera>, Without<PresentCamera>),
>;

/// Point the scene camera at the lattice, and — in the tavern only — drive its
/// framing from the lattice too.
///
/// ORDERING IS A DELIBERATE OVERRIDE, NOT A RACE. `tavern.rs::setup_tavern`
/// sets `ScalingMode::FixedVertical { ROOM_FOOTPRINT_TILES_H }` in its own
/// `Update` setup, which is an approximation of `fitZoom` that ignores the
/// render target entirely. This system runs in `PostUpdate` (before
/// `CameraUpdateSystems`, so `camera_system` still sees the final value this
/// frame), which is strictly after every `Update` system and after the
/// `StateTransition` schedule that carries `OnExit(Tavern)`'s reset. It
/// therefore WINS every frame, by construction. It only writes `scaling_mode`
/// while `AppState::Tavern` is active, so the dungeon's `FixedVertical(VIEW_H)`
/// and the intro's `o.scale` zoom fit are left alone.
fn drive_scene_camera(
    mut commands: Commands,
    sizing: Res<PixelSizing>,
    target: Option<Res<SceneTarget>>,
    state: Res<State<AppState>>,
    mut cam_q: SceneCameraRig,
) {
    let Some(target) = target else { return };
    for (e, mut cam, mut proj, msaa, hdr) in &mut cam_q {
        let want = RenderTarget::Image(target.image.clone().into());
        if cam.target.as_image() != Some(&target.image) {
            cam.target = want;
        }
        // MSAA breaks BOTH things the chain needs: depth sampling for the AO
        // stage, and the hard pixel edges themselves — a multi-sampled edge
        // inside a low-res target is a smeared texel, which is precisely the
        // look this milestone removes.
        //
        // WRITE IT, DO NOT INSERT-IF-ABSENT. `bevy_render`'s `CameraPlugin`
        // does `register_required_components::<Camera, Msaa>()`, so the
        // component is ALWAYS already there, defaulted to `Sample4` — an
        // `if msaa.is_none()` guard would compile, pass a headless test that
        // has no `RenderPlugin`, and silently never disable MSAA in the real
        // app. Same for `Hdr`, which another plugin may legitimately have put
        // on the camera first, so the two are handled independently.
        match msaa {
            Some(mut m) if *m != Msaa::Off => *m = Msaa::Off,
            Some(_) => {}
            None => {
                commands.entity(e).insert(Msaa::Off);
            }
        }
        if hdr.is_none() {
            commands.entity(e).insert(Hdr);
        }
        if let Projection::Orthographic(o) = &mut *proj {
            if o.near != CAM_NEAR {
                o.near = CAM_NEAR;
            }
            if o.far != CAM_FAR {
                o.far = CAM_FAR;
            }
            // ⚠️ THE DUNGEON'S FRUSTUM FLEXES TOO, and pinning it was a defect
            // that framed every dungeon screenshot this port ever took.
            //
            // `main.rs` set `FixedVertical { VIEW_H }` with `VIEW_H = 11.25`,
            // which is `engineConfig.camera.viewH` — the config DEFAULT. Legacy
            // overwrites it on every frame: `pixel-pass.ts syncCameraFrustum`
            // sets the half-extents to `renderW/(2*PPU)` and `renderH/(2*PPU)`,
            // with a comment explaining that PPU stays pinned and the FRUSTUM is
            // what moves (otherwise the sprite identity SPRITE_UNITS * PPU ===
            // SPRITE_PIXEL_GRID breaks). At 1920x1080 and PPU 56 that is
            // 34.3 x 19.29 world units; the port was showing 11.25 tall, so the
            // dungeon was framed 1.7x too close and no screenshot of it has ever
            // been comparable to the oracle's.
            //
            // Found by `scripts/pk-ab-dungeon.mjs` on its first honest sheet —
            // which is the entire argument for building the rig before the art.
            //
            // The two scenes differ only in ZOOM: the tavern rides
            // `fitZoom` (`sizing.zoom()`), and the dungeon does not — legacy's
            // comment on that line is explicit that `zoom` is left untouched
            // there because the tavern is the only thing using it.
            let framed = match *state.get() {
                AppState::Tavern => Some(PPU * sizing.zoom()),
                AppState::Dungeon => Some(PPU),
                _ => None,
            };
            if let Some(ppu) = framed {
                let (want_w, want_h) = (sizing.render_w as f32 / ppu, sizing.render_h as f32 / ppu);
                // `ScalingMode` has no `PartialEq` in 0.17, so the "did it
                // change" test is a match rather than a comparison — worth
                // keeping, since writing the projection every frame would
                // re-trigger `camera_system` forever.
                let stale = !matches!(
                    o.scaling_mode,
                    ScalingMode::Fixed { width, height } if width == want_w && height == want_h
                );
                if stale {
                    o.scaling_mode = ScalingMode::Fixed {
                        width: want_w,
                        height: want_h,
                    };
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every expectation below is derived from the TS by hand; the working is
    /// in the comment above it. `evenCeil(v) = 2 * ceil(v / 2)`.
    ///
    /// | window      | base | scale | grid      | out       | capped | zoom |
    /// |-------------|------|-------|-----------|-----------|--------|------|
    /// | 1280 x 720  |  1   |   1   | 1280x720  | 1280x720  |  no    | 0.78 |
    /// | 1920 x 1080 |  1   |   1   | 1920x1080 | 1920x1080 |  no    | 1.00 |
    /// | 2400 x 1350 |  1   |   2   | 1200x676  | 2400x1352 |  no    | 0.78 |
    /// | 2560 x 1440 |  2   |   2   | 1280x720  | 2560x1440 |  no    | 0.78 |
    /// | 3440 x 1440 |  2   |   2   | 1720x720  | 3440x1440 |  no    | 0.78 |
    /// | 3840 x 2160 |  3   |   3   | 1280x720  | 3840x2160 |  no    | 0.78 |
    /// | 7680 x 1080 |  1   |   1   | 2160x1080 | 2160x1080 |  YES   | 1.00 |
    /// | 20000x 4608 |  6   |   8   | 2160x576  |17280x4608 |  YES   | 0.78 |
    /// | 800 x 600   |  1   |   1   |  800x600  |  800x600  |  no    | 0.78 |
    const WINDOWS: &[(f64, f64)] = &[
        (1280.0, 720.0),
        (1366.0, 768.0),
        (1280.0, 800.0),
        (1440.0, 900.0),
        (1920.0, 1080.0),
        (1600.0, 900.0),
        (2560.0, 1440.0),
        (3440.0, 1440.0),
        (3840.0, 2160.0),
        (1024.0, 600.0),
        (800.0, 600.0),
        (1921.0, 1081.0),
    ];

    fn s(w: f64, h: f64) -> PixelSizing {
        compute_render_sizing(w, h, 1.0)
    }

    /// A headless App carrying just enough of the shell for `SizingPlugin`:
    /// a primary window, an asset server, the state, and a stand-in for the
    /// camera `setup_common` spawns.
    ///
    /// This exists because the wiring half of this module cannot be checked by
    /// eye here — WSLg composites the game window on the Windows host, and an
    /// X11 root grab from inside WSL2 comes back black. So the wiring is
    /// asserted instead of squinted at.
    fn harness(w: u32, h: u32, state: AppState) -> App {
        use bevy::state::app::StatesPlugin;
        let mut app = App::new();
        app.add_plugins((
            MinimalPlugins,
            bevy::asset::AssetPlugin::default(),
            bevy::window::WindowPlugin {
                primary_window: None,
                exit_condition: bevy::window::ExitCondition::DontExit,
                ..default()
            },
            StatesPlugin,
        ))
        .init_asset::<Image>()
        .insert_state(state)
        .init_resource::<PixelSizing>()
        .add_plugins(SizingPlugin);
        app.world_mut().spawn((
            Window {
                resolution: bevy::window::WindowResolution::new(w, h),
                ..default()
            },
            PrimaryWindow,
        ));
        app.world_mut().spawn((
            DungeonCamera,
            Camera::default(),
            // `RenderPlugin` is absent here, so the `Camera -> Msaa` required
            // component does not fire; spawn it explicitly at Bevy's default so
            // the test sees the shape the real app has. Without this the MSAA
            // assertion below would pass on an inserted component and prove
            // nothing about a camera that already had one.
            Msaa::Sample4,
            Projection::Orthographic(OrthographicProjection {
                scaling_mode: ScalingMode::FixedVertical {
                    viewport_height: 11.25,
                },
                ..OrthographicProjection::default_3d()
            }),
        ));
        // Two updates: the first spawns the present layer, the second sizes it
        // (commands from the first only apply at the end of that frame).
        app.update();
        app.update();
        app
    }

    #[test]
    fn the_scene_camera_ends_up_pointed_at_the_lattice() {
        let mut app = harness(1920, 1080, AppState::Dungeon);
        let target = app
            .world()
            .get_resource::<SceneTarget>()
            .expect("a scene target was allocated");
        assert_eq!((target.w, target.h), (1920, 1080));
        let handle = target.image.clone();

        // The image is the right shape, format, usage and sampler.
        let images = app.world().resource::<Assets<Image>>();
        let img = images.get(&handle).expect("the target image exists");
        assert_eq!(img.texture_descriptor.size.width, 1920);
        assert_eq!(img.texture_descriptor.size.height, 1080);
        assert_eq!(img.texture_descriptor.format, TextureFormat::Rgba8UnormSrgb);
        assert!(img
            .texture_descriptor
            .usage
            .contains(TextureUsages::RENDER_ATTACHMENT));
        assert!(img
            .texture_descriptor
            .usage
            .contains(TextureUsages::TEXTURE_BINDING));
        assert!(img
            .texture_descriptor
            .usage
            .contains(TextureUsages::COPY_DST));
        assert!(
            matches!(img.sampler, ImageSampler::Descriptor(_)),
            "the lattice must NOT inherit the default linear sampler"
        );

        let mut cams = app.world_mut().query_filtered::<
            (&Camera, &Projection, Option<&Msaa>, Option<&Hdr>),
            With<DungeonCamera>,
        >();
        let (cam, proj, msaa, hdr) = cams.single(app.world()).expect("the scene camera");
        assert_eq!(cam.target.as_image(), Some(&handle));
        assert_eq!(msaa.copied(), Some(Msaa::Off));
        assert!(hdr.is_some());
        let Projection::Orthographic(o) = proj else {
            panic!("orthographic")
        };
        assert_eq!((o.near, o.far), (CAM_NEAR, CAM_FAR));
        // ⚠️ THIS ASSERTION USED TO PIN THE DEFECT. It read "the dungeon keeps
        // its own framing" and checked for `FixedVertical`, which is exactly
        // what `main.rs` spawns and exactly what legacy overwrites on every
        // frame (`pixel-pass.ts syncCameraFrustum`). A test can only ever say
        // the code does what it does; this one said it in a sentence that
        // sounded like a decision. The dungeon frustum flexes with the lattice
        // at PPU, zoom 1 — 1920/56 x 1080/56 world units here.
        match o.scaling_mode {
            ScalingMode::Fixed { width, height } => {
                assert!((width - 1920.0 / PPU).abs() < 1e-3, "{width}");
                assert!((height - 1080.0 / PPU).abs() < 1e-3, "{height}");
            }
            other => panic!("the dungeon frustum did not flex with the lattice: {other:?}"),
        }
    }

    /// The two scenes differ only in ZOOM, and that is worth an assertion
    /// rather than a comment: the tavern rides `fitZoom`, the dungeon does not.
    /// If the dungeon ever picked the zoom up, its frustum would shrink by 22%
    /// at this window size and every sprite would stop landing on whole texels.
    #[test]
    fn the_dungeon_does_not_ride_the_tavern_zoom() {
        for (w, h) in [(1280, 720), (1920, 1080)] {
            let mut app = harness(w, h, AppState::Dungeon);
            let sizing = *app.world().resource::<PixelSizing>();
            let mut cams = app
                .world_mut()
                .query_filtered::<&Projection, With<DungeonCamera>>();
            let Projection::Orthographic(o) = cams.single(app.world()).expect("the scene camera")
            else {
                panic!("orthographic")
            };
            let ScalingMode::Fixed { height, .. } = o.scaling_mode else {
                panic!("the dungeon frustum did not flex at {w}x{h}")
            };
            assert!(
                (height - sizing.render_h as f32 / PPU).abs() < 1e-3,
                "{w}x{h}: {height}"
            );
        }
    }

    #[test]
    fn the_tavern_framing_is_driven_from_the_lattice() {
        // 1280x720 → grid 1280x720 → zoom 0.78, so the frustum is
        // 1280 / (56 * 0.78) x 720 / (56 * 0.78) world units.
        let mut app = harness(1280, 720, AppState::Tavern);
        let mut cams = app
            .world_mut()
            .query_filtered::<&Projection, With<DungeonCamera>>();
        let proj = cams.single(app.world()).expect("the scene camera");
        let Projection::Orthographic(o) = proj else {
            panic!("orthographic")
        };
        let ppu = PPU * (CAM_ZOOM_WIDE as f32);
        match o.scaling_mode {
            ScalingMode::Fixed { width, height } => {
                assert!((width - 1280.0 / ppu).abs() < 1e-3, "{width}");
                assert!((height - 720.0 / ppu).abs() < 1e-3, "{height}");
            }
            other => panic!("the tavern override did not win: {other:?}"),
        }
    }

    #[test]
    fn the_present_layer_is_one_window_camera_under_all_other_ui() {
        let mut app = harness(2400, 1350, AppState::Tavern);
        // Exactly one present camera, targeting the window, above the scene.
        let mut cams = app
            .world_mut()
            .query_filtered::<(&Camera, Option<&IsDefaultUiCamera>), With<PresentCamera>>();
        let (cam, is_default) = cams.single(app.world()).expect("one present camera");
        assert!(matches!(cam.target, RenderTarget::Window(_)));
        assert_eq!(cam.order, 1);
        assert!(
            is_default.is_some(),
            "without this marker the UI's default camera is whichever \
             window-targeting camera sorts highest"
        );

        // The blit sits below every other UI root, so the frame stats, the
        // build stamp, the fade overlay and the tavern's panels stay on top
        // whatever order they were spawned in.
        let mut roots = app
            .world_mut()
            .query_filtered::<&GlobalZIndex, With<PresentRoot>>();
        assert!(roots.single(app.world()).expect("the blit root").0 < 0);

        // 2400x1350 → grid 1200x676 @2 → out 2400x1352, so it overhangs the
        // window by a pixel top and bottom: a NEGATIVE margin, exactly like the
        // legacy centred canvas.
        let mut nodes = app
            .world_mut()
            .query_filtered::<(&Node, &ImageNode), With<PresentImage>>();
        let (node, image) = nodes.single(app.world()).expect("the blit node");
        assert_eq!(node.width, Val::Px(2400.0));
        assert_eq!(node.height, Val::Px(1352.0));
        assert_eq!(node.left, Val::Px(0.0));
        assert_eq!(node.top, Val::Px(-1.0));
        assert!(matches!(node.position_type, PositionType::Absolute));
        assert!(matches!(image.image_mode, NodeImageMode::Stretch));
        let target = app.world().resource::<SceneTarget>();
        assert_eq!(image.image, target.image, "the blit shows the LATTICE");
    }

    #[test]
    fn a_resize_reallocates_the_lattice_and_re_centres_the_blit() {
        let mut app = harness(1920, 1080, AppState::Dungeon);
        let before = app.world().resource::<SceneTarget>().image.clone();

        {
            let mut wins = app.world_mut().query::<&mut Window>();
            let mut win = wins.single_mut(app.world_mut()).expect("the window");
            win.resolution = bevy::window::WindowResolution::new(2560, 1440);
        }
        app.update();

        let sizing = *app.world().resource::<PixelSizing>();
        assert_eq!(
            (sizing.render_w, sizing.render_h, sizing.scale),
            (1280, 720, 2)
        );
        let target = app.world().resource::<SceneTarget>();
        assert_eq!((target.w, target.h), (1280, 720));
        assert_ne!(target.image, before, "the old target must be dropped");

        let mut cams = app
            .world_mut()
            .query_filtered::<&Camera, With<DungeonCamera>>();
        let handle = app.world().resource::<SceneTarget>().image.clone();
        assert_eq!(
            cams.single(app.world())
                .expect("scene camera")
                .target
                .as_image(),
            Some(&handle),
            "the camera must follow the reallocation, not keep the freed image"
        );

        let mut nodes = app
            .world_mut()
            .query_filtered::<&Node, With<PresentImage>>();
        let node = nodes.single(app.world()).expect("the blit node");
        assert_eq!(node.width, Val::Px(2560.0));
        assert_eq!(node.height, Val::Px(1440.0));
    }

    #[test]
    fn sizing_1920x1080_is_one_to_one() {
        // base = floor(min(1920/1280, 1080/720)) = floor(min(1.5, 1.5)) = 1.
        // grid = evenCeil(1920) x evenCeil(1080) = 1920 x 1080, both under the
        // 2160 x 1216 ceiling, so no bump. out = grid * 1.
        let r = s(1920.0, 1080.0);
        assert_eq!((r.scale, r.render_w, r.render_h), (1, 1920, 1080));
        assert_eq!((r.out_w, r.out_h), (1920, 1080));
        assert!(!r.capped);
        // 1920/56 = 34.29 >= 22.63 and 1080/56 = 19.29 >= 16.45 → fits.
        assert_eq!(r.zoom(), 1.0);
    }

    #[test]
    fn sizing_1280x720_is_the_reference_and_runs_wide() {
        // base = floor(min(1, 1)) = 1. grid = 1280 x 720, under the ceiling.
        let r = s(1280.0, 720.0);
        assert_eq!((r.scale, r.render_w, r.render_h), (1, 1280, 720));
        assert_eq!((r.out_w, r.out_h), (1280, 720));
        assert!(!r.capped);
        // 1280/56 = 22.857 >= 22.63 PASSES on width, but
        //  720/56 = 12.857 <  16.45 FAILS on height (needs 921.2) → 0.78.
        assert_eq!(r.zoom(), CAM_ZOOM_WIDE as f32);
    }

    #[test]
    fn sizing_2400x1350_bumps_to_scale_two() {
        // base = floor(min(2400/1280, 1350/720)) = floor(min(1.875, 1.875)) = 1.
        // scale 1 → grid evenCeil(2400) = 2400 > MAX_RENDER_W 2160, so bump:
        //   next 2 → evenCeil(1200) = 1200, evenCeil(675) = 2*ceil(337.5) = 676
        //   1200 >= MIN_BUMP_W 1024 and 676 >= MIN_BUMP_H 576 → accepted.
        // 1200 <= 2160 and 676 <= 1216 → loop exits. out = 2400 x 1352, so the
        // grid covers the window (1352 >= 1350) with no bars.
        let r = s(2400.0, 1350.0);
        assert_eq!((r.scale, r.render_w, r.render_h), (2, 1200, 676));
        assert_eq!((r.out_w, r.out_h), (2400, 1352));
        assert!(!r.capped);
        // 1200/56 = 21.43 < 22.63 → the room no longer fits, so wide framing.
        assert_eq!(r.zoom(), CAM_ZOOM_WIDE as f32);
    }

    #[test]
    fn the_min_bump_guard_blocks_the_bump_and_the_cap_bites() {
        // 7680x1080, the pathological ultrawide.
        // base = floor(min(7680/1280 = 6, 1080/720 = 1.5)) = 1.
        // scale 1 → grid 7680 x 1080; 7680 > 2160 so we WANT to bump:
        //   next 2 → evenCeil(3840) = 3840, evenCeil(540) = 540.
        //   540 < MIN_BUMP_H 576 → BREAK. The scale stays 1; chasing the
        //   ceiling would have reached four tiles of vertical view.
        // Clamp: min(7680, 2160) = 2160, min(1080, 1216) = 1080 → capped.
        let r = s(7680.0, 1080.0);
        assert_eq!((r.scale, r.render_w, r.render_h), (1, 2160, 1080));
        assert_eq!((r.out_w, r.out_h), (2160, 1080));
        assert!(r.capped);
        assert!(r.out_w < 7680, "the window letterboxes on purpose");
    }

    #[test]
    fn the_cap_bites_after_max_scale_is_exhausted() {
        // 20000x4608 — synthetic, chosen so the MIN_BUMP guard never fires and
        // the loop runs out of MAX_SCALE instead.
        // base = floor(min(20000/1280 = 15.625, 4608/720 = 6.4)) = 6.
        // scale 6 → evenCeil(3333.3) = 3334 > 2160 → bump
        //   7 → evenCeil(2857.1) = 2858, evenCeil(658.3) = 660  (both over the
        //       MIN_BUMP floor) → accepted; 2858 still > 2160 → bump
        //   8 → evenCeil(2500) = 2500, evenCeil(576) = 576 (exactly MIN_BUMP_H,
        //       which is `>=` so it passes) → accepted.
        // scale is now MAX_SCALE, 2500 is still over the ceiling → clamp to
        // 2160 and accept the bars.
        let r = s(20000.0, 4608.0);
        assert_eq!((r.scale, r.render_w, r.render_h), (MAX_SCALE, 2160, 576));
        assert_eq!((r.out_w, r.out_h), (17280, 4608));
        assert!(r.capped);
    }

    #[test]
    fn sizing_tracks_windows_below_the_reference_floor() {
        // The FLOOR is gone on purpose: an oversized centred canvas gets a
        // negative `top` and slides the HUD out of the window.
        // base = floor(min(800/1280, 600/720)) = floor(0.625) = 0 → max(1) = 1.
        let r = s(800.0, 600.0);
        assert_eq!((r.scale, r.render_w, r.render_h), (1, 800, 600));
        assert!(r.out_w <= 800 && r.out_h <= 600);
        assert!(!r.capped);
    }

    #[test]
    fn the_short_axis_picks_the_scale() {
        // 2560x1440: base = floor(min(2, 2)) = 2 → grid 1280x720.
        let a = s(2560.0, 1440.0);
        assert_eq!((a.scale, a.render_w, a.render_h), (2, 1280, 720));
        // 3840x2160: base = floor(min(3, 3)) = 3 → grid 1280x720.
        let b = s(3840.0, 2160.0);
        assert_eq!((b.scale, b.render_w, b.render_h), (3, 1280, 720));
        // 3440x1440 is 2.6875 x 2.0 — the SHORT axis wins, so scale 2 and the
        // ultrawide fills at 1720 wide (comfortably under the 2160 ceiling).
        let c = s(3440.0, 1440.0);
        assert_eq!((c.scale, c.render_w, c.render_h), (2, 1720, 720));
        assert_eq!((c.out_w, c.out_h), (3440, 1440));
        assert!(!c.capped);
    }

    #[test]
    fn the_grid_is_always_even_and_the_scale_always_whole() {
        // An odd width puts the ortho frustum centre on a half-texel and every
        // sprite in the scene inherits the offset.
        for &(w, h) in WINDOWS {
            let r = s(w, h);
            assert_eq!(r.render_w % 2, 0, "{w}x{h} render_w={}", r.render_w);
            assert_eq!(r.render_h % 2, 0, "{w}x{h} render_h={}", r.render_h);
            assert!(r.scale >= 1, "{w}x{h}");
        }
    }

    #[test]
    fn the_blit_covers_the_window_until_the_cap_bites() {
        for &(w, h) in WINDOWS {
            let r = s(w, h);
            assert_eq!(r.out_w, r.render_w * r.scale, "{w}x{h}");
            assert_eq!(r.out_h, r.render_h * r.scale, "{w}x{h}");
            if r.capped {
                continue; // capped windows letterbox on purpose
            }
            assert!(f64::from(r.out_w) >= w, "{w}x{h} left a vertical bar");
            assert!(f64::from(r.out_h) >= h, "{w}x{h} left a horizontal bar");
            // …and never overflows by more than the rounding-up costs.
            assert!(
                f64::from(r.out_w) <= w + f64::from(r.scale) * 2.0,
                "{w}x{h}"
            );
            assert!(
                f64::from(r.out_h) <= h + f64::from(r.scale) * 2.0,
                "{w}x{h}"
            );
        }
    }

    #[test]
    fn the_grid_never_exceeds_the_ceiling() {
        for &(w, h) in WINDOWS {
            let r = s(w, h);
            assert!(r.render_w <= MAX_RENDER_W, "{w}x{h}");
            assert!(r.render_h <= MAX_RENDER_H, "{w}x{h}");
        }
    }

    #[test]
    fn degenerate_windows_do_not_divide_by_zero() {
        // w = max(1, floor(0)) = 1 → base = 1/1280 < 1 → scale 1 →
        // grid evenCeil(1) = 2 x 2. Never zero, never odd.
        let r = s(0.0, 0.0);
        assert_eq!(r.scale, 1);
        assert!(r.render_w > 0 && r.render_h > 0);
        assert_eq!(r.render_w % 2, 0);
        assert_eq!(r.render_h % 2, 0);
        // A fractional window floors first, exactly as `Math.floor` does.
        assert_eq!(s(1920.6, 1080.4), s(1920.0, 1080.0));
    }

    #[test]
    fn sizing_is_stable() {
        for &(w, h) in WINDOWS {
            assert_eq!(s(w, h), s(w, h), "{w}x{h}");
        }
    }

    #[test]
    fn fit_zoom_is_two_valued_and_never_magnifies() {
        // The threshold, in render pixels: 22.63 * 56 = 1267.28 wide,
        // 16.45 * 56 = 921.2 tall. Even grids, so 1268 x 922 is the first grid
        // that fits and 1266 x 920 the last that does not.
        assert_eq!(fit_zoom(1268, 922), 1.0);
        assert_eq!(fit_zoom(1266, 922), CAM_ZOOM_WIDE as f32);
        assert_eq!(fit_zoom(1268, 920), CAM_ZOOM_WIDE as f32);
        for &(w, h) in WINDOWS {
            let z = s(w, h).zoom();
            assert!(z == 1.0 || z == CAM_ZOOM_WIDE as f32, "{w}x{h} zoom {z}");
            assert!(z <= 1.0, "{w}x{h} magnified to {z}");
        }
    }

    #[test]
    fn the_texel_is_one_render_pixel_at_the_live_zoom() {
        let r = s(1280.0, 720.0);
        // The tavern runs wide, so a texel is 1/(56 * 0.78) world units — NOT
        // 1/56, which is the documented way to snap to the wrong lattice.
        let expect = 1.0 / (PPU * CAM_ZOOM_WIDE as f32);
        assert!((r.texel(r.zoom()) - expect).abs() < 1e-6);
        let full = s(1920.0, 1080.0);
        assert!((full.texel(full.zoom()) - 1.0 / PPU).abs() < 1e-6);
    }

    #[test]
    fn the_frustum_centre_lands_on_a_whole_texel() {
        // pixel-pass derives half-extents as renderW / (2 * PPU); with an even
        // renderW the centre is a whole number of texels from the edge.
        for &(w, h) in WINDOWS {
            let r = s(w, h);
            assert_eq!(r.render_w / 2 * 2, r.render_w, "{w}x{h}");
            assert_eq!(r.render_h / 2 * 2, r.render_h, "{w}x{h}");
        }
    }
}
