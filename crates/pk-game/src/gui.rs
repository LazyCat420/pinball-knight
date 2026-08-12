//! THE GUI SHELL — the file `pk_gui`'s header names, and the reason the tavern
//! finally has a menu instead of a paragraph of `Text`.
//!
//! `pk-gui` is the whole legacy toolkit on a CPU buffer: no Bevy, no GPU, and
//! byte-identical to the browser that authored the goldens. What it cannot do is
//! reach a screen. This module is the three things it deliberately left out —
//! **the texture upload, the input feed, and the schedule** — and nothing else:
//! no widget lives here, and no screen is painted here that is not a call into
//! `pk_gui::screens`.
//!
//! ## Where the layer sits, and the one thing that is not parity
//!
//! Legacy composites the GUI canvas INSIDE the pixel pass, between the ink
//! outline and the flash, so the menu wears the same cel bands as the art.
//! `post/composite.wgsl` reserves that slot — `@binding(7) ui_tex`, with the
//! blend written out — and it is still a stub.
//!
//! This layer therefore draws as a UI node OVER the present blit, which puts it
//! downstream of the grade rather than upstream. What that costs is exactly one
//! thing: the menu is not posterized with the frame behind it. What it buys is
//! that the pixel LATTICE is still honoured — the painter is `render_w ×
//! render_h` and the node is the present blit's own rectangle, so one painted
//! pixel is `scale` screen pixels, on the same grid, with the same nearest
//! sampler. A menu that upscaled fractionally would be the "the game is blurry"
//! defect `post::sizing` is written to prevent, and that would have been the
//! real cost of taking the easy route.
//!
//! ## The two states that look identical from outside
//!
//! A GUI that never ran and a GUI that ran and was composited away both show
//! nothing. `UiStats` counts both halves — frames driven and frames painted —
//! and `__pk.gui` publishes them, so the question is one query rather than an
//! afternoon.

use bevy::asset::RenderAssetUsages;
use bevy::image::{Image, ImageSampler};
use bevy::prelude::*;
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat};
use bevy::window::PrimaryWindow;

use pk_gui::im::{empty_ui_input, Pointer};
use pk_gui::root::{paint_stack, UiStats};
use pk_gui::screens::alchemist::{paint_alchemist, AlchemistAction, AlchemistView};
use pk_gui::screens::armory::{paint_armory, ArmoryAction, ArmoryView};
use pk_gui::screens::forge::{paint_forge, ForgeAction, ForgeView};
use pk_gui::screens::intro::{
    paint_intro_chrome, IntroChromeView, DESIGN_H as INTRO_DESIGN_H, DESIGN_MAX_ZOOM as INTRO_ZOOM,
    DESIGN_W as INTRO_DESIGN_W,
};
use pk_gui::screens::tavern::{
    paint_run_summary, paint_station_panel, paint_station_prompt, PanelView, StationView,
    SummaryView,
};
use pk_gui::stack::{ScreenEntry, UiStack};
use pk_gui::{Fonts, Painter, UiInput};

use crate::post::sizing::PixelSizing;

/// Above the present blit (`-100`) and below the loading card (`80`), which is
/// opaque and is a different kind of screen: the loading card is the app saying
/// it is busy, and a menu must not paint over that.
const GUI_Z: i32 = 60;

/// Which screen. The shell's vocabulary, not the toolkit's — `pk-gui` is generic
/// over the id precisely so the game names its own screens.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ScreenId {
    /// The contextual `[E] ALCHEMIST` line. Never pauses; it is a label.
    StationPrompt,
    RunSummary,
    StationPanel,
    /// The title sequence's skip button, title banner and black wipe.
    /// Non-pausing: the intro runs its own clock and there is no sim to freeze.
    IntroChrome,
    /// The armorer's counter — "Manage Loadout".
    Armory,
    /// The alchemist's counter — "Trade": the shelf and the brew book.
    Alchemist,
    /// The weaponsmith's counter — "Forge / Repair": the anvil.
    Forge,
}

/// WHAT the open screens say. Filled by whoever owns the scene, read here.
///
/// The split is what keeps this module from growing a copy of the tavern: the
/// tavern decides which station you are standing at and what its counter is
/// called; this decides what a sheet looks like. A `None` view with its screen
/// open paints nothing rather than panicking — a scene mid-teardown is allowed
/// to have dropped its data before its screens close.
#[derive(Resource, Default)]
pub struct GuiViews {
    pub prompt: Option<StationView>,
    pub summary: Option<SummaryView>,
    pub panel: Option<PanelView>,
    pub intro: Option<IntroChromeView>,
    pub armory: Option<ArmoryView>,
    pub alchemist: Option<AlchemistView>,
    pub forge: Option<ForgeView>,
}

/// Assign only if the value actually differs.
///
/// ⚠️ THE REASON THE REPAINT SKIP NEEDS THIS. A scene rebuilds its view structs
/// every frame — that is what immediate mode is — and `ResMut` marks the
/// resource changed on the DEREF, not on a difference. So `views.prompt =
/// Some(same_thing)` set the changed flag sixty times a second and the skip had
/// a 0% hit rate while looking, from inside, like it worked. Measured: the
/// tavern sat at 14 fps with a caption on screen, and the browser gate's timed
/// walk started missing its lane because the probe (every 5 frames) had gone
/// 357 ms stale.
pub fn set_view<T: PartialEq>(slot: &mut Option<T>, want: Option<T>) {
    if *slot != want {
        *slot = want;
    }
}

/// The layer: the buffer, the fonts, the stack, and the texture they land in.
#[derive(Resource)]
pub struct GuiLayer {
    painter: Painter,
    fonts: Fonts,
    pub stack: UiStack<ScreenId>,
    pub stats: UiStats,
    pub image: Handle<Image>,
    /// What closed itself this frame — a CLOSE button or a cancel-pop. Read by
    /// the scene so its own idea of what is open cannot drift from the stack's.
    ///
    /// One frame's worth: written every frame, `None` when nothing closed.
    pub closed: Option<ScreenId>,
    /// Did SKIP get pressed this frame? See [`ScreenId::IntroChrome`].
    pub skip_pressed: bool,
    /// What the armorer's counter was asked to do this frame.
    pub armory_action: Option<ArmoryAction>,
    /// …and the alchemist's. One frame's worth, like every other action here.
    pub alchemist_action: Option<AlchemistAction>,
    /// …and the weaponsmith's.
    pub forge_action: Option<ForgeAction>,
    /// Has the texture got pixels on it that the stack no longer accounts for?
    ///
    /// Set by every paint, taken by the first idle frame. Without it, closing
    /// the last screen leaves the sheet on screen forever — the toolkit's
    /// early-out on an empty stack is a decision about the PAINTER, and the
    /// texture is this module's problem.
    dirty: bool,
    /// Bumped whenever Bevy's change detection says [`GuiViews`] was written.
    views_gen: u64,
    /// Where the cursor was last frame, in painter pixels.
    ///
    /// ⚠️ `pointer_moved` MEANS MOVED. Setting it whenever a cursor is over the
    /// window makes every frame a repaint the moment the mouse rests on the
    /// game — which is most frames a player ever produces, and would have given
    /// the skip below a 0% hit rate while looking like it worked in a test.
    last_pointer: Option<(f64, f64)>,
    /// What the last painted frame was a picture OF.
    ///
    /// ⚠️ REPAINTING EVERY FRAME COST HALF THE FRAME RATE. Immediate mode means
    /// the widgets are rebuilt each pass, and it is easy to read that as "the
    /// pixels must be too" — they must not. The tavern with only its station
    /// prompt up fell from 36 fps to 14 (measured, in the real Windows build)
    /// once this layer existed: a 756x482 clear plus a 1.4 MB texture write,
    /// sixty times a second, to redraw a caption that had not changed. The
    /// browser gate's timed walk started falling short of the DESCEND board,
    /// which is how it surfaced — as a harness flake, three files away.
    ///
    /// So a frame repaints when something could have MOVED: the views changed,
    /// the stack changed, or input arrived. Everything else reuses the texture
    /// that is already on the GPU.
    seen: PaintKey,
}

/// The cheap summary of "would this frame paint the same picture as the last".
///
/// Deliberately NOT a hash of the pixels — that would cost the paint it exists
/// to avoid. It is the inputs to the paint: what is open, at what size, and
/// whether the views behind them changed since the last pass. `views_gen`
/// counts Bevy change-detection ticks rather than comparing contents, so a
/// screen whose text is rebuilt into an identical `String` still repaints once
/// and never spins.
#[derive(Default, Clone, Copy, PartialEq, Eq)]
struct PaintKey {
    open: usize,
    top: Option<ScreenId>,
    focus: i64,
    size: (u32, u32),
    views_gen: u64,
}

impl GuiLayer {
    /// Is the UI holding the keyboard? NOT "is anything open" — the station
    /// prompt is open for the whole visit and must never eat WASD.
    pub fn pauses(&self) -> bool {
        self.stack.pauses()
    }

    /// Open a screen, with the design box the legacy sheet was authored in.
    pub fn open(&mut self, id: ScreenId) {
        let entry = match id {
            // A label pinned to the scene: no design box, so it paints at 1x on
            // whatever the lattice is, exactly like the legacy scene overlay.
            ScreenId::StationPrompt => ScreenEntry::new(id, false),
            // The sheet box the goldens were baked at.
            ScreenId::RunSummary | ScreenId::StationPanel => {
                ScreenEntry::new(id, true).with_design(600.0, 338.0, 2)
            }
            // `design: { w: 480, h: 270, max: 3 }` — the oracle's own box
            // (intro-chrome.ts). It does NOT pause, and it must not capture the
            // keyboard: "PRESS ANY KEY" is handled by the intro's own listener
            // and swallowing keys here would make it a lie.
            ScreenId::IntroChrome => {
                ScreenEntry::new(id, false).with_design(INTRO_DESIGN_W, INTRO_DESIGN_H, INTRO_ZOOM)
            }
            // The counter PAUSES the room and takes the keyboard: the oracle's
            // vendor screens are modal over the walkable tavern, and a sheet
            // you can walk away from while it is open is how `openStation`
            // and the stack drift apart.
            // Both counters are modal over the walkable room and both were
            // authored in the same box, so they zoom together — two vendor
            // sheets at different scales read as two different games.
            ScreenId::Armory | ScreenId::Alchemist | ScreenId::Forge => {
                ScreenEntry::new(id, true).with_design(600.0, 338.0, 2)
            }
        };
        self.stack.push(entry);
    }

    pub fn close(&mut self, id: ScreenId) {
        self.stack.remove(id);
    }

    /// Close everything — a scene handing the screen to another scene.
    ///
    /// The stack is global and the SCENES are not, so a room that opened a
    /// screen has to close it on the way out. Nothing else can: `Update` systems
    /// are gated on the state that just ended.
    pub fn clear(&mut self) {
        self.stack.clear();
    }

    /// The `__pk.gui` payload — "did it run" and "did it paint", which are the
    /// two failures that look identical on a black screen.
    #[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
    pub fn telemetry_json(&self) -> String {
        format!(
            r#"{{"frames":{},"painted":{},"open":{},"pauses":{},"w":{},"h":{}}}"#,
            self.stats.frames,
            self.stats.painted,
            self.stack.len(),
            self.pauses(),
            self.painter.w,
            self.painter.h,
        )
    }
}

/// The two resources a scene needs to drive a menu, as one system param.
///
/// Bundled because `tavern_frame` sits ON Bevy's 16-param tuple limit and the
/// failure is an `E0599` on `.chain()` that never mentions arity — the same
/// signpost `TavernUi` carried before this replaced it.
#[derive(bevy::ecs::system::SystemParam)]
pub struct Gui<'w> {
    pub layer: ResMut<'w, GuiLayer>,
    pub views: ResMut<'w, GuiViews>,
}

/// The node that shows the buffer. Its layout mirrors `PresentImage`'s exactly.
#[derive(Component)]
struct GuiImage;

/// A transparent image of `(w, h)`, nearest-sampled — a menu drawn at the
/// lattice size and filtered on the way up would defeat the entire pixel pass.
fn blank_image(w: u32, h: u32) -> Image {
    let mut img = Image::new_fill(
        Extent3d {
            width: w,
            height: h,
            depth_or_array_layers: 1,
        },
        TextureDimension::D2,
        &[0, 0, 0, 0],
        // sRGB, because the painter writes DISPLAY bytes — the same numbers the
        // legacy canvas puts in a `CanvasRenderingContext2D`. Bound as UNORM
        // they would be read as linear and every panel would come out pale.
        TextureFormat::Rgba8UnormSrgb,
        RenderAssetUsages::default(),
    );
    img.sampler = ImageSampler::nearest();
    img
}

fn setup_gui(mut commands: Commands, mut images: ResMut<Assets<Image>>, sizing: Res<PixelSizing>) {
    let (w, h) = (sizing.render_w, sizing.render_h);
    let image = images.add(blank_image(w, h));
    commands.insert_resource(GuiLayer {
        painter: Painter::new(w, h),
        fonts: Fonts::load_embedded(),
        stack: UiStack::new(),
        stats: UiStats::default(),
        image: image.clone(),
        closed: None,
        skip_pressed: false,
        armory_action: None,
        alchemist_action: None,
        forge_action: None,
        dirty: false,
        views_gen: 0,
        last_pointer: None,
        seen: PaintKey::default(),
    });
    commands.spawn((
        GuiImage,
        ImageNode {
            image,
            // `Stretch`: the NODE's size is the authority, not the texture's —
            // the same rule the present blit follows, and the reason the two
            // stay on the same lattice when the window resizes mid-frame.
            image_mode: bevy::ui::widget::NodeImageMode::Stretch,
            ..default()
        },
        Node {
            position_type: PositionType::Absolute,
            ..default()
        },
        GlobalZIndex(GUI_Z),
    ));
}

/// Keep the buffer, the texture and the node on the lattice.
///
/// Three things move together or the menu lands off-grid: the painter's size,
/// the image's size, and the node's rectangle. They are recomputed from
/// `PixelSizing` rather than from each other, so a resize cannot leave two of
/// them agreeing with each other and disagreeing with the screen.
fn sync_gui_layout(
    sizing: Res<PixelSizing>,
    window: Query<&Window, With<PrimaryWindow>>,
    mut images: ResMut<Assets<Image>>,
    mut layer: ResMut<GuiLayer>,
    mut node_q: Query<&mut Node, With<GuiImage>>,
) {
    let Ok(win) = window.single() else { return };
    let Ok(mut node) = node_q.single_mut() else {
        return;
    };
    if layer.painter.w != sizing.render_w || layer.painter.h != sizing.render_h {
        layer.painter = Painter::new(sizing.render_w, sizing.render_h);
        let fresh = blank_image(sizing.render_w, sizing.render_h);
        // Replace the asset in place: the node holds this handle, and handing it
        // a new one would leave a frame showing the old size stretched.
        if let Some(img) = images.get_mut(&layer.image) {
            *img = fresh;
        }
    }
    let out_w = sizing.out_w as f32;
    let out_h = sizing.out_h as f32;
    let left = ((win.width() - out_w) / 2.0).round();
    let top = ((win.height() - out_h) / 2.0).round();
    // Each field guarded on its own: `Node` is change-detected, so assigning
    // four identical values every frame would mark the whole UI tree dirty and
    // re-lay it out for nothing.
    let set = |slot: &mut Val, want: Val| {
        if *slot != want {
            *slot = want;
        }
    };
    set(&mut node.width, Val::Px(out_w));
    set(&mut node.height, Val::Px(out_h));
    set(&mut node.left, Val::Px(left));
    set(&mut node.top, Val::Px(top));
}

/// Keyboard and pointer → one `UiInput`.
///
/// ⚠️ DIRECTIONS ARE PRESS COUNTS, not booleans. A screen painting at 2 fps
/// under load collapses three quick Downs into one if this reports a flag —
/// which is the war story `pk_gui`'s header carries, and the reason `just_pressed`
/// is counted rather than tested.
fn gather_ui_input(
    keys: &ButtonInput<KeyCode>,
    mouse: &ButtonInput<MouseButton>,
    pointer: Option<(f64, f64)>,
    was: Option<(f64, f64)>,
) -> UiInput {
    let count = |ks: &[KeyCode]| ks.iter().filter(|k| keys.just_pressed(**k)).count() as u32;
    let mut input = empty_ui_input();
    input.up = count(&[KeyCode::ArrowUp, KeyCode::KeyW]);
    input.down = count(&[KeyCode::ArrowDown, KeyCode::KeyS]);
    input.left = count(&[KeyCode::ArrowLeft, KeyCode::KeyA]);
    input.right = count(&[KeyCode::ArrowRight, KeyCode::KeyD]);
    input.next_tab = count(&[KeyCode::Tab]);
    input.accept = keys.just_pressed(KeyCode::Enter) || keys.just_pressed(KeyCode::Space);
    // ESCAPE ONLY. `E` closes a panel too, but it does so through the tavern's
    // own interact handler — routing it here as well would pop TWO screens on
    // one press the day a panel raises a confirm.
    input.cancel = keys.just_pressed(KeyCode::Escape);
    if let Some((x, y)) = pointer {
        input.pointer = Pointer {
            x,
            y,
            inside: true,
            down: mouse.pressed(MouseButton::Left),
            pressed: mouse.just_pressed(MouseButton::Left),
            released: mouse.just_released(MouseButton::Left),
        };
        input.pointer_moved = was != Some((x, y));
    }
    input
}

/// Did NOTHING arrive this frame?
///
/// Written out rather than derived from a `PartialEq` on `UiInput`, because the
/// answer is not "is this equal to the empty input" — a pointer that is inside
/// the lattice and merely still is not empty, and it must not force a repaint
/// every frame the mouse rests over the window. Motion, buttons and keys are
/// events; a resting position is not.
fn is_quiet(i: &UiInput) -> bool {
    i.up == 0
        && i.down == 0
        && i.left == 0
        && i.right == 0
        && i.next_tab == 0
        && i.prev_tab == 0
        && !i.accept
        && !i.cancel
        && !i.pointer_moved
        && !i.pointer.pressed
        && !i.pointer.released
        && !i.pointer.down
        && i.scroll == 0.0
        && i.digit == 0
        && i.typed.is_empty()
}

/// The window cursor, in painter pixels — or `None` when it is off the lattice.
///
/// Off the lattice is not the same as off the window: the blit is centred and
/// can letterbox, and a pointer in a black bar is over no widget at all. Saying
/// `inside: false` there is what stops a hover surviving into the margin.
fn pointer_in_lattice(win: &Window, sizing: &PixelSizing) -> Option<(f64, f64)> {
    let c = win.cursor_position()?;
    let left = ((win.width() - sizing.out_w as f32) / 2.0).round();
    let top = ((win.height() - sizing.out_h as f32) / 2.0).round();
    let scale = sizing.scale.max(1) as f32;
    let x = (c.x - left) / scale;
    let y = (c.y - top) / scale;
    if x < 0.0 || y < 0.0 || x >= sizing.render_w as f32 || y >= sizing.render_h as f32 {
        return None;
    }
    Some((f64::from(x), f64::from(y)))
}

/// One painted frame of the whole stack, then the upload.
fn paint_gui(
    keys: Res<ButtonInput<KeyCode>>,
    mouse: Res<ButtonInput<MouseButton>>,
    window: Query<&Window, With<PrimaryWindow>>,
    sizing: Res<PixelSizing>,
    views: Res<GuiViews>,
    mut images: ResMut<Assets<Image>>,
    mut layer: ResMut<GuiLayer>,
) {
    layer.closed = None;
    if layer.stack.is_empty() {
        // `paint_stack` returns early on an empty stack WITHOUT clearing, which
        // is correct for it and wrong for the texture: the last screen's pixels
        // are still up there. So the frame after the stack empties clears and
        // uploads once, and every frame after that costs nothing.
        layer.stats.frames += 1;
        if std::mem::take(&mut layer.dirty) {
            layer.painter.clear();
            upload(&mut images, &layer);
        }
        return;
    }
    let pointer = window
        .single()
        .ok()
        .and_then(|w| pointer_in_lattice(w, &sizing));
    let input = gather_ui_input(&keys, &mouse, pointer, layer.last_pointer);
    layer.last_pointer = pointer;

    // ── The repaint decision — see `GuiLayer::seen` ──
    //
    // Input is checked as "did anything arrive", not "did it change something":
    // a press that no widget answers still has to reach `paint_stack`, because
    // focus movement and cancel-pops are resolved INSIDE it. Only a frame with
    // no input at all, over an unchanged stack and unchanged views, is safe to
    // skip — and that is the frame the game spends nearly all of its time on.
    if views.is_changed() {
        layer.views_gen = layer.views_gen.wrapping_add(1);
    }
    let key = PaintKey {
        open: layer.stack.len(),
        top: layer.stack.top().map(|t| t.id),
        focus: layer.stack.top().map(|t| t.focus).unwrap_or(0),
        size: (layer.painter.w, layer.painter.h),
        views_gen: layer.views_gen,
    };
    if is_quiet(&input) && key == layer.seen && layer.dirty {
        // Still a DRIVEN frame — `frames` counts what the schedule asked for,
        // and `painted` counts what reached the texture. The gap between them is
        // the saving, and publishing both is what makes it visible.
        layer.stats.frames += 1;
        return;
    }
    layer.seen = key;

    // Split the borrows: `paint_stack` takes the painter, the fonts and the
    // stack at once, and the closure needs the views.
    let GuiLayer {
        painter,
        fonts,
        stack,
        stats,
        ..
    } = &mut *layer;
    let views = &*views;
    let mut closed = None;
    let mut skipped = false;
    let mut armory_action = None;
    let mut alchemist_action = None;
    let mut forge_action = None;
    let result = paint_stack(painter, fonts, stack, &input, stats, |f, id, entry| {
        match id {
            ScreenId::StationPrompt => {
                if let Some(v) = &views.prompt {
                    paint_station_prompt(f, v);
                }
            }
            ScreenId::RunSummary => {
                if let Some(v) = &views.summary {
                    if paint_run_summary(f, v) {
                        closed = Some(id);
                    }
                }
            }
            ScreenId::StationPanel => {
                if let Some(v) = &views.panel {
                    if paint_station_panel(f, v) {
                        closed = Some(id);
                    }
                }
            }
            ScreenId::Armory => {
                if let Some(v) = &views.armory {
                    // `entry.scroll` is the counter's own offset, persisted
                    // across frames by the stack — the port of the oracle's
                    // `UiScreen.scroll`. The screen reads it, follows the focus
                    // cursor with it, and writes it back.
                    armory_action = paint_armory(f, v, &mut entry.scroll);
                }
            }
            ScreenId::Alchemist => {
                if let Some(v) = &views.alchemist {
                    alchemist_action = paint_alchemist(f, v, &mut entry.scroll);
                }
            }
            ScreenId::Forge => {
                if let Some(v) = &views.forge {
                    forge_action = paint_forge(f, v, &mut entry.scroll);
                }
            }
            ScreenId::IntroChrome => {
                if let Some(v) = &views.intro {
                    // SKIP is not a CLOSE: the scene ends the sequence, and the
                    // screen goes with the scene. Reported through `skipped` so
                    // the intro's own skip path stays the single one.
                    if paint_intro_chrome(f, v) {
                        skipped = true;
                    }
                }
            }
        };
    });
    // A CLOSE button and a cancel-pop are the same event to the scene. The
    // button's own screen is still on the stack — the toolkit reports the press,
    // it does not act on it — so this is where it comes off.
    if let Some(id) = closed {
        layer.stack.close(id);
        layer.closed = Some(id);
    } else if let Some(id) = result.popped {
        layer.closed = Some(id);
    }
    // One frame's worth, like `closed`: the intro reads it and it is cleared by
    // the next paint. A latch would fire the skip again on the frame after the
    // scene had already left.
    layer.skip_pressed = skipped;
    // One frame's worth, like `closed` — the scene reads it and acts. A latch
    // would buy the same plate again on the frame after the purchase.
    layer.armory_action = armory_action;
    layer.alchemist_action = alchemist_action;
    layer.forge_action = forge_action;
    if result.painted {
        layer.dirty = true;
        upload(&mut images, &layer);
    }
}

fn upload(images: &mut Assets<Image>, layer: &GuiLayer) {
    if let Some(img) = images.get_mut(&layer.image) {
        if let Some(data) = img.data.as_mut() {
            // Sizes are kept equal by `sync_gui_layout`; a mismatch means a
            // resize landed between the paint and the upload, and half a frame
            // of a stale menu is better than a panic in a render loop.
            if data.len() == layer.painter.buf.len() {
                data.copy_from_slice(&layer.painter.buf);
            }
        }
    }
}

pub struct GuiPlugin;

impl Plugin for GuiPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<GuiViews>()
            .add_systems(Startup, setup_gui)
            .add_systems(
                Update,
                (sync_gui_layout, paint_gui)
                    .chain()
                    // `Startup` has not applied its commands when the first
                    // `Update` runs — the same trap every scene in this shell
                    // documents.
                    .run_if(resource_exists::<GuiLayer>)
                    // LAST in `Update`: the scene decides what is open, and a
                    // paint that ran before it would be one frame stale on every
                    // press.
                    .after(crate::tavern::TavernSystems),
            );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys(pressed: &[KeyCode]) -> ButtonInput<KeyCode> {
        let mut k = ButtonInput::default();
        for p in pressed {
            k.press(*p);
        }
        k
    }

    /// The press-count contract, which a boolean would silently break.
    #[test]
    fn two_direction_keys_in_one_frame_are_two_presses() {
        let k = keys(&[KeyCode::ArrowDown, KeyCode::KeyS]);
        let m = ButtonInput::default();
        let input = gather_ui_input(&k, &m, None, None);
        assert_eq!(
            input.down, 2,
            "two down keys in one frame is a delta of two"
        );
        assert_eq!(input.up, 0);
        assert!(!input.pointer.inside, "no cursor is not a cursor at (0,0)");
    }

    /// `E` is the tavern's interact key and must not ALSO cancel here: one
    /// press closing two screens is the bug this exclusion exists to prevent.
    #[test]
    fn escape_cancels_and_e_does_not() {
        let m = ButtonInput::default();
        assert!(gather_ui_input(&keys(&[KeyCode::Escape]), &m, None, None).cancel);
        assert!(!gather_ui_input(&keys(&[KeyCode::KeyE]), &m, None, None).cancel);
    }

    /// The letterbox. A pointer in the black bar is over nothing, and reporting
    /// it as lattice pixel 0 would light the top-left widget from the margin.
    #[test]
    fn a_pointer_in_the_letterbox_is_outside_the_lattice() {
        let sizing = PixelSizing {
            render_w: 640,
            render_h: 360,
            scale: 2,
            out_w: 1280,
            out_h: 720,
            capped: false,
        };
        // A 1920x1080 window blitting 1280x720 leaves 320px bars left and right.
        let mut win = Window::default();
        win.resolution.set(1920.0, 1080.0);
        // Inside: the blit's own top-left corner is lattice (0, 0).
        win.set_cursor_position(Some(Vec2::new(320.0, 180.0)));
        assert_eq!(pointer_in_lattice(&win, &sizing), Some((0.0, 0.0)));
        // Inside, one lattice pixel in: two screen pixels at scale 2.
        win.set_cursor_position(Some(Vec2::new(322.0, 182.0)));
        assert_eq!(pointer_in_lattice(&win, &sizing), Some((1.0, 1.0)));
        // In the left bar.
        win.set_cursor_position(Some(Vec2::new(100.0, 500.0)));
        assert_eq!(pointer_in_lattice(&win, &sizing), None);
        // Past the right edge of the blit.
        win.set_cursor_position(Some(Vec2::new(1601.0, 500.0)));
        assert_eq!(pointer_in_lattice(&win, &sizing), None);
    }

    /// A resting cursor is not an event.
    ///
    /// The repaint skip is worthless if this reports movement every frame the
    /// mouse happens to sit over the window — which is most frames a player
    /// produces. Measured the hard way: the layer repainting unconditionally
    /// took the tavern from 36 fps to 14.
    #[test]
    fn a_still_cursor_does_not_report_movement() {
        let k = ButtonInput::default();
        let m = ButtonInput::default();
        let at = Some((10.0, 20.0));
        assert!(
            !gather_ui_input(&k, &m, at, at).pointer_moved,
            "a cursor that has not moved has not moved"
        );
        assert!(gather_ui_input(&k, &m, at, Some((10.0, 21.0))).pointer_moved);
        assert!(gather_ui_input(&k, &m, at, None).pointer_moved);
        // …and the whole frame is quiet, which is what the skip reads.
        assert!(is_quiet(&gather_ui_input(&k, &m, at, at)));
        assert!(!is_quiet(&gather_ui_input(
            &keys(&[KeyCode::ArrowDown]),
            &m,
            at,
            at
        )));
    }

    /// The prompt must never pause; a sheet always must. This is the flag the
    /// tavern reads to decide whether WASD walks or moves a focus ring.
    #[test]
    fn the_prompt_does_not_pause_and_a_sheet_does() {
        // Driven through `GuiLayer::open` — the entries this asserts about are
        // the ones the game actually pushes, not a second copy of the table.
        let mut layer = GuiLayer {
            painter: Painter::new(1, 1),
            fonts: Fonts::load_embedded(),
            stack: UiStack::new(),
            stats: UiStats::default(),
            image: Handle::default(),
            closed: None,
            skip_pressed: false,
            armory_action: None,
            alchemist_action: None,
            forge_action: None,
            dirty: false,
            views_gen: 0,
            last_pointer: None,
            seen: PaintKey::default(),
        };
        layer.open(ScreenId::StationPrompt);
        assert!(
            !layer.pauses(),
            "the prompt must never take the keyboard away from walking"
        );
        assert!(
            layer.stack.top().unwrap().design.is_none(),
            "the prompt is a scene overlay, painted at the lattice's own scale"
        );
        layer.open(ScreenId::StationPanel);
        assert!(layer.pauses());
        assert!(
            layer.stack.top().unwrap().design.is_some(),
            "a sheet is authored in a design box or it zooms with the window"
        );
        // …and closing it hands the keyboard back, rather than leaving the room
        // frozen with nothing on screen.
        layer.close(ScreenId::StationPanel);
        assert!(!layer.pauses());
    }
}
