//! PINBALL KNIGHT — title intro, Bevy shell.
//!
//! The gag, in order (legacy `intro/index.ts`):
//!   1. A flat side-scroller: the knight sprints through a suspiciously
//!      cheerful overworld (blue sky, hills, "WORLD 1-1") like it's 1985.
//!   2. He jumps and headbutts a floating brick — hitstop, flash, DING.
//!   3. The whole 2D world shatters into falling shards, revealing that the
//!      knight has been inside the DUNGEON all along — a 3D isometric maze
//!      whose walls spell "PINBALL / KNIGHT".
//!   4. He's now a pinball, ricocheting around the letterforms while the
//!      camera tilts up from side-on and pulls out until the title reads.
//!      PRESS ANY KEY.
//!
//! Everything that ticks lives in `pk_core::intro` (phase clock, ricochet,
//! camera path — all fixture-pinned); this module is the view: the CPU-painted
//! 2D overlay, the title-maze meshes, the billboards, the UI chrome, and the
//! skip input. Skips: any key/click, `?no-intro=1`, `?autostart=1`,
//! `__skipDungeonIntro`, prefers-reduced-motion — and it plays ONCE per
//! launch (deliberately not persisted: a saved flag would mean nobody ever
//! sees it again, including whoever has to change it).

use bevy::camera::ScalingMode;
use bevy::image::{Image, ImageSampler};
use bevy::math::Affine2;
use bevy::prelude::*;

use crate::dungeon_light;
use crate::gui::{GuiLayer, GuiViews, ScreenId};
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat};
use bevy::window::PrimaryWindow;
use pk_core::intro::{
    aim_intro_camera, build_title_grid, fit_zoom, step_intro_ball, IntroBall, IntroCue, IntroPhase,
    IntroSeq, TitleLayout, SIM_DT_CLAMP, SWEEP_DUR,
};
use pk_gui::screens::intro::{blink_phase, IntroChromeView};

use crate::overworld::{Overworld, BW};
use crate::sfx::{Audio, SfxEvent};
use crate::{
    camera_offset_angles, spawn_grid_meshes, AppState, DungeonCamera, FadeOverlay, KnightArt,
    VIEW_H, WALL_H,
};
use pk_audio::Patch;

/// HARNESS SEAM: hold the sequence at an authored moment.
///
/// `?intro-freeze=<phase>:<seconds>` (or `PK_INTRO_FREEZE=<phase>:<seconds>`)
/// stops both clocks the frame `pt` reaches that offset in that phase, and the
/// scene then paints the same instant forever. The twin of the oracle's
/// `window.__introFreeze`, and it exists for the same reason: a CDP screenshot
/// takes longer than the `bonk` phase lasts, so a moving title sequence cannot
/// be A/B'd by shutter timing at all. See `pk-ab-intro.mjs`'s header and the
/// oracle's seam comment (`intro/index.ts`).
fn intro_freeze_at() -> Option<(IntroPhase, f64)> {
    let raw = {
        #[cfg(target_arch = "wasm32")]
        {
            js_sys::eval("location.search")
                .ok()
                .and_then(|v| v.as_string())
                .and_then(|s| {
                    s.split(['?', '&'])
                        .find_map(|kv| kv.strip_prefix("intro-freeze=").map(str::to_owned))
                })
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            std::env::var("PK_INTRO_FREEZE").ok()
        }
    }?;
    let (phase, t) = raw.split_once(':')?;
    let phase = match phase {
        "run" => IntroPhase::Run,
        "bonk" => IntroPhase::Bonk,
        "shatter" => IntroPhase::Shatter,
        "sweep" => IntroPhase::Sweep,
        "title" => IntroPhase::Title,
        _ => return None,
    };
    Some((phase, t.parse().ok()?))
}

/// The shell services `intro_tick` talks OUT to, bundled.
///
/// ⚠️ NOT a tidiness refactor: Bevy's `IntoSystem` impls stop at 16 parameters,
/// and adding the chrome screen's two resources took the tick to 18. The
/// failure is `no method named `run_if` found for fn item` on the *plugin
/// registration line*, which names neither the parameter count nor the
/// system's own signature — so it reads as a trait-import problem three files
/// from the actual cause.
#[derive(bevy::ecs::system::SystemParam)]
struct Shell<'w> {
    gui: ResMut<'w, GuiLayer>,
    views: ResMut<'w, GuiViews>,
    sfx: MessageWriter<'w, SfxEvent>,
    audio: Res<'w, Audio>,
}

/// The legacy echo trail's opacities, nose to tail.
const ECHO_OPACITY: [f32; 4] = [0.3, 0.2, 0.12, 0.06];

pub struct IntroPlugin;

impl Plugin for IntroPlugin {
    fn build(&self, app: &mut App) {
        // Lazy setup rather than OnEnter: the initial state's OnEnter fires
        // before Startup's commands (KnightArt, camera) have applied — see
        // the note in main(). IntroRes doubles as the "already set up" latch.
        app.add_systems(
            Update,
            (
                intro_setup
                    .run_if(resource_exists::<KnightArt>)
                    .run_if(not(resource_exists::<IntroRes>)),
                intro_tick.run_if(resource_exists::<IntroRes>),
            )
                .chain()
                .run_if(in_state(AppState::Intro)),
        )
        .add_systems(OnExit(AppState::Intro), intro_teardown);
    }
}

/// Everything the intro owns, torn down wholesale on exit.
#[derive(Component)]
pub struct IntroOnly;

#[derive(Resource)]
pub struct IntroRes {
    layout: TitleLayout,
    seq: IntroSeq,
    ball: IntroBall,
    sim_acc: f64,
    elapsed: f64,
    trail: Vec<(f64, f64)>,
    trail_clock: f64,
    ow: Overworld,
    finishing: bool,
    finish_t: f64,
    /// `?intro-freeze=<phase>:<t>` — see [`intro_freeze_at`]. `None` in play.
    freeze: Option<(IntroPhase, f64)>,
    // Entities the tick addresses directly (avoids query-filter tangles).
    canvas_img: Handle<Image>,
    cam_e: Entity,
    ball_e: Entity,
    echo_es: Vec<Entity>,
    coin_text_e: Entity,
    hud_es: Vec<Entity>,
    ball_mat: Handle<StandardMaterial>,
    echo_mats: Vec<Handle<StandardMaterial>>,
    ball_cells: Vec<[f32; 4]>, // uv cells: legacy `E:ball ?? E:run`
}

impl IntroRes {
    /// The `__dungeonIntroPhase` equivalent for the __pk surface (wasm-only
    /// caller — `publish_stats`).
    #[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
    pub fn phase_name(&self) -> &'static str {
        self.seq.phase.name()
    }
}

#[allow(clippy::too_many_arguments)]
fn intro_setup(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut images: ResMut<Assets<Image>>,
    mut ambient: ResMut<AmbientLight>,
    mut gui: ResMut<GuiLayer>,
    mut views: ResMut<GuiViews>,
    art: Res<KnightArt>,
    window: Query<&Window, With<PrimaryWindow>>,
    cam_q: Query<Entity, With<DungeonCamera>>,
) {
    let (ww, wh) = window
        .single()
        .map(|w| (f64::from(w.width()), f64::from(w.height())))
        .unwrap_or((1600.0, 900.0));

    // ── The 3D title maze, built now so pipelines prewarm during the 2D bit ──
    let layout = build_title_grid();
    for e in spawn_grid_meshes(
        &mut commands,
        &mut meshes,
        &mut materials,
        &mut images,
        &layout.grid,
        // The title maze is not a dungeon floor and has no biome; the Cold
        // Crypt's unremapped slots are what the oracle paints before
        // `startLevel` sets one.
        dungeon_light::Stone::default(),
    ) {
        commands.entity(e).insert(IntroOnly);
    }

    // ── The intro's own light rig (`intro/index.ts:163-168`) ──
    // Without this the title maze is a black slab: the dungeon's rig belongs to
    // a scene the intro never enters, so the letterforms were lit by Bevy's
    // default ambient and nothing else. See `dungeon_light::install_intro`.
    for e in dungeon_light::install_intro(&mut commands, &mut ambient) {
        commands.entity(e).insert(IntroOnly);
    }

    // ── The pinball knight + echo trail (E sheet, `ball ?? run` clip) ──
    let ball = IntroBall::at_spawn(&layout);
    let ball_cells = art.e.run.clone();
    let tex = materials
        .get(&art.e.material)
        .and_then(|m| m.base_color_texture.clone());
    let quad_h = 1.15f32;
    let quad = meshes.add(Rectangle::new(quad_h * art.e.aspect, quad_h));
    let mut mk_mat = |alpha: f32| {
        materials.add(StandardMaterial {
            base_color: Color::srgba(1.0, 1.0, 1.0, alpha),
            base_color_texture: tex.clone(),
            unlit: true,
            alpha_mode: AlphaMode::Blend,
            cull_mode: None,
            ..default()
        })
    };
    let ball_mat = mk_mat(1.0);
    let echo_mats: Vec<_> = ECHO_OPACITY.iter().map(|op| mk_mat(*op)).collect();
    let ball_e = commands
        .spawn((
            IntroOnly,
            Mesh3d(quad.clone()),
            MeshMaterial3d(ball_mat.clone()),
            Transform::from_xyz(ball.x as f32, quad_h / 2.0, ball.z as f32),
            Visibility::Hidden,
        ))
        .id();
    let echo_es: Vec<Entity> = echo_mats
        .iter()
        .map(|m| {
            commands
                .spawn((
                    IntroOnly,
                    Mesh3d(quad.clone()),
                    MeshMaterial3d(m.clone()),
                    Transform::from_xyz(ball.x as f32, quad_h / 2.0, ball.z as f32),
                    Visibility::Hidden,
                ))
                .id()
        })
        .collect();

    // ── 2D overworld canvas: CPU buffer → nearest-sampled fullscreen image ──
    let ow = Overworld::new(ww, wh);
    let mut img = Image::new(
        Extent3d {
            width: BW as u32,
            height: ow.h as u32,
            depth_or_array_layers: 1,
        },
        TextureDimension::D2,
        ow.buf.clone(),
        TextureFormat::Rgba8UnormSrgb,
        Default::default(), // MAIN_WORLD | RENDER_WORLD: repainted every frame
    );
    img.sampler = ImageSampler::nearest();
    let canvas_img = images.add(img);
    commands.spawn((
        IntroOnly,
        ImageNode::new(canvas_img.clone()),
        Node {
            position_type: PositionType::Absolute,
            left: Val::Px(0.0),
            top: Val::Px(0.0),
            width: Val::Percent(100.0),
            height: Val::Percent(100.0),
            ..default()
        },
        GlobalZIndex(50),
    ));

    // ── Chrome: HUD, skip affordances, title (intro-chrome.ts) ──
    // Design space 480×270, up to 3× — a title card is the one place where
    // small type has nothing to trade itself against.
    let ui = (ww / 480.0).min(wh / 270.0).min(3.0) as f32;
    let mut hud_es = Vec::new();
    let hud = |commands: &mut Commands, txt: &str, node: Node, size: f32, col: Color| {
        commands
            .spawn((
                IntroOnly,
                Text::new(txt),
                TextFont {
                    font_size: size,
                    ..default()
                },
                TextColor(col),
                node,
                GlobalZIndex(60),
            ))
            .id()
    };
    hud_es.push(hud(
        &mut commands,
        "WORLD 1-1",
        Node {
            position_type: PositionType::Absolute,
            left: Val::Px(16.0 * ui),
            top: Val::Px(10.0 * ui),
            ..default()
        },
        10.0 * ui,
        Color::WHITE,
    ));
    let coin_text_e = hud(
        &mut commands,
        "COIN x00",
        Node {
            position_type: PositionType::Absolute,
            right: Val::Px(24.0 * ui),
            top: Val::Px(10.0 * ui),
            ..default()
        },
        10.0 * ui,
        Color::WHITE,
    );
    hud_es.push(coin_text_e);
    hud_es.push(hud(
        &mut commands,
        "ANY KEY - SKIP", // ASCII: the default font has no em-dash (P5 pixel fonts will)
        Node {
            position_type: PositionType::Absolute,
            left: Val::Px(16.0 * ui),
            bottom: Val::Px(10.0 * ui),
            ..default()
        },
        8.0 * ui,
        Color::srgba(1.0, 1.0, 1.0, 0.75),
    ));
    // ── The title, PRESS ANY KEY and SKIP are the CHROME SCREEN, not UI nodes ──
    // `gui/screens/intro-chrome.ts`, ported to `pk_gui::screens::intro`. They
    // were three Bevy `Text` nodes here: a different typeface, off the pixel
    // lattice, with no SKIP button at all. See that module's header.
    //
    // ⚠️ THE VIEW EXISTS FROM SETUP; THE SCREEN OPENS AT `ShatterStart`.
    // The oracle's chrome is painted INSIDE `pixelPass.render()`, and the tick
    // calls that in `shatter`/`sweep`/`title` and NOT in `run`/`bonk`
    // (`index.ts:849-874`) — during those first 2.65 s the two opaque 2D
    // canvases cover the renderer's canvas anyway, so a UI frame would paint
    // SKIP *underneath* the gag. Its own docblock calls this asymmetry out.
    //
    // Opening at setup is therefore a real divergence and it was MEASURED as
    // one: the port grew a SKIP button over the side-scroller and the `run`
    // phase's diff went 14.5 → 21.7. Parity here means the button is absent
    // until the world breaks.
    views.intro = Some(IntroChromeView::default());
    let _ = &mut gui;

    let cam_e = cam_q.single().expect("camera spawns in setup_common");

    commands.insert_resource(IntroRes {
        layout,
        seq: IntroSeq::new(),
        ball,
        sim_acc: 0.0,
        elapsed: 0.0,
        trail: Vec::new(),
        trail_clock: 0.0,
        ow,
        finishing: false,
        finish_t: 0.0,
        freeze: intro_freeze_at(),
        canvas_img,
        cam_e,
        ball_e,
        echo_es,
        coin_text_e,
        hud_es,
        ball_mat,
        echo_mats,
        ball_cells,
    });
}

/// Keys that must NOT skip — the legacy listener's exclusion list.
fn is_modifier(k: KeyCode) -> bool {
    matches!(
        k,
        KeyCode::ShiftLeft
            | KeyCode::ShiftRight
            | KeyCode::ControlLeft
            | KeyCode::ControlRight
            | KeyCode::AltLeft
            | KeyCode::AltRight
            | KeyCode::SuperLeft
            | KeyCode::SuperRight
            | KeyCode::F5
            | KeyCode::F11
            | KeyCode::F12
    )
}

#[allow(clippy::too_many_arguments)]
fn intro_tick(
    mut res: ResMut<IntroRes>,
    time: Res<Time>,
    keys: Res<ButtonInput<KeyCode>>,
    mouse: Res<ButtonInput<MouseButton>>,
    art: Res<KnightArt>,
    mut images: ResMut<Assets<Image>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut next: ResMut<NextState<AppState>>,
    window: Query<&Window, With<PrimaryWindow>>,
    mut tf_q: Query<&mut Transform>,
    mut proj_q: Query<&mut Projection>,
    mut vis_q: Query<&mut Visibility>,
    mut text_q: Query<&mut Text>,
    mut fade_q: Query<&mut BackgroundColor, With<FadeOverlay>>,
    mut shell: Shell,
) {
    // TWO deltas: `pdt` is real time and drives the choreography, `dt` stays
    // clamped and drives the ball — see pk_core::intro's clock notes. Bevy's
    // Time hands us the real frame delta directly (zero on frame one, which
    // is the legacy first-tick stamp behaviour).
    let pdt = time.delta_secs_f64();
    // The freeze seam, read before either clock is spent.
    let held = res
        .freeze
        .is_some_and(|(ph, t)| res.seq.phase == ph && res.seq.pt >= t);
    let pdt = if held { 0.0 } else { pdt };
    let dt = pdt.min(SIM_DT_CLAMP);
    res.elapsed += pdt;

    // The 400ms black hold between setIntroFade(1) and the handoff.
    if res.finishing {
        res.finish_t += pdt;
        if res.finish_t >= 0.4 {
            // Hub-first: the title sequence hands you the tavern, and the
            // DESCEND board is what builds a floor.
            next.set(AppState::Tavern);
        }
        return;
    }

    // Skip: any key (minus modifiers), any click, or the chrome's SKIP button.
    // The button is a THIRD route to the same place, not a special case — the
    // oracle's `onSkip` callback is the same function its key listener calls.
    let skip_key = keys.get_just_pressed().any(|k| !is_modifier(*k));
    if skip_key || mouse.get_just_pressed().next().is_some() || shell.gui.skip_pressed {
        res.finishing = true;
        for mut bg in &mut fade_q {
            bg.0 = Color::srgba(0.0, 0.0, 0.0, 1.0);
        }
        return;
    }

    // Advance the authored sequence by REAL time.
    let mut cues = Vec::new();
    res.seq.advance(pdt, &mut cues);
    for cue in &cues {
        match cue {
            IntroCue::Roll => {
                shell.sfx.write(SfxEvent::Roll);
            }
            IntroCue::BonkStart => {
                res.ow.shake = 1.0;
                // Both, same frame, in this order — the shatter reads as one
                // event: the brick breaking and the coin it pays out.
                shell.sfx.write(SfxEvent::Break);
                shell.sfx.write(SfxEvent::Coin);
            }
            IntroCue::ShatterStart => {
                // Snapshot the bonk frame WITHOUT the knight (legacy removed
                // the knight canvas before snapshotting): he doesn't shatter,
                // he materialises as the pinball below.
                let bonk_t = pk_core::intro::BONK_DUR;
                res.ow.shake = 0.0;
                let ow = &mut res.ow;
                ow.paint(
                    &art.e_cpu,
                    pk_core::intro::RUN_DUR,
                    true,
                    bonk_t,
                    0.0,
                    false,
                );
                ow.begin_shatter();
                // The ball exists from here on.
                if let Ok(mut v) = vis_q.get_mut(res.ball_e) {
                    *v = Visibility::Inherited;
                }
                // HUD belongs to the 2D world — it shatters with it.
                for e in res.hud_es.clone() {
                    if let Ok(mut v) = vis_q.get_mut(e) {
                        *v = Visibility::Hidden;
                    }
                }
                // …and the chrome arrives as the 2D world leaves. See the note
                // at the view's construction: the oracle paints no UI frame
                // during `run`/`bonk`.
                shell.gui.open(ScreenId::IntroChrome);
            }
            IntroCue::SweepStart => res.ow.clear_for_sweep(),
            IntroCue::TitleStart => {
                if let Some(v) = shell.views.intro.as_mut() {
                    v.show_title = true;
                }
            }
            IntroCue::Finish => {
                res.finishing = true;
                // Scheduled 0.4s out ON THE AUDIO CLOCK, not a Bevy timer:
                // the sting has to land under the black hold that ends the
                // sequence, and a frame timer drifts against the samples it
                // is trying to sit beside.
                shell.audio.play(Patch::LevelStart { at_offset: 0.4 });
                for mut bg in &mut fade_q {
                    bg.0 = Color::srgba(0.0, 0.0, 0.0, 1.0);
                }
            }
        }
    }

    // Phase work.
    let phase = res.seq.phase;
    let pt = res.seq.pt;
    let mut canvas_dirty = false;
    match phase {
        IntroPhase::Run => {
            res.ow.paint(&art.e_cpu, pt, false, 0.0, dt, true);
            canvas_dirty = true;
        }
        IntroPhase::Bonk => {
            res.ow.shake = (res.ow.shake - dt * 3.0).max(0.0);
            res.ow
                .paint(&art.e_cpu, pk_core::intro::RUN_DUR, true, pt, dt, true);
            canvas_dirty = true;
            // Coin HUD flips on the bonk.
            if let Ok(mut t) = text_q.get_mut(res.coin_text_e) {
                **t = format!("COIN x{:02}", res.ow.coins);
            }
        }
        IntroPhase::Shatter => {
            if sim_ball(&mut res, dt, &mut tf_q, &mut vis_q, &mut materials) {
                shell.sfx.write(SfxEvent::Bumper);
            }
            aim_camera(&mut res, 0.0, &window, &mut tf_q, &mut proj_q);
            res.ow.paint_shatter(dt, pt);
            canvas_dirty = true;
        }
        IntroPhase::Sweep => {
            if sim_ball(&mut res, dt, &mut tf_q, &mut vis_q, &mut materials) {
                shell.sfx.write(SfxEvent::Bumper);
            }
            aim_camera(&mut res, pt / SWEEP_DUR, &window, &mut tf_q, &mut proj_q);
        }
        IntroPhase::Title => {
            if sim_ball(&mut res, dt, &mut tf_q, &mut vis_q, &mut materials) {
                shell.sfx.write(SfxEvent::Bumper);
            }
            aim_camera(&mut res, 1.0, &window, &mut tf_q, &mut proj_q);
            // A 1.1s step blink, from wall clock (intro-chrome.ts). The
            // modulus itself lives in `pk_gui::screens::intro::blink_phase` so
            // the port has ONE of it.
            if let Some(v) = shell.views.intro.as_mut() {
                v.blink_on = blink_phase(res.elapsed * 1000.0);
            }
        }
    }

    if canvas_dirty {
        if let Some(img) = images.get_mut(&res.canvas_img) {
            if let Some(data) = img.data.as_mut() {
                data.copy_from_slice(&res.ow.buf);
            }
        }
    }
}

/// simBall: 120 Hz sub-steps against the REAL ported collision, the echo
/// trail, and the billboard frame/flip.
fn sim_ball(
    res: &mut IntroRes,
    dt: f64,
    tf_q: &mut Query<&mut Transform>,
    vis_q: &mut Query<&mut Visibility>,
    materials: &mut Assets<StandardMaterial>,
) -> bool {
    res.sim_acc += dt;
    let mut bounced = false;
    while res.sim_acc >= 1.0 / 120.0 {
        res.sim_acc -= 1.0 / 120.0;
        let layout = &res.layout;
        // Sub-steps can report several bounces in one frame; the patch layer
        // holds the 90 ms gap, so collapsing them to one cue here is only an
        // early-out, not the rate limit itself.
        bounced |= step_intro_ball(&layout.grid, &mut res.ball, 1.0 / 120.0);
    }
    res.trail_clock += dt;
    if res.trail_clock >= 0.05 {
        res.trail_clock = 0.0;
        res.trail.insert(0, (res.ball.x, res.ball.z));
        res.trail.truncate(res.echo_es.len() + 1);
    }

    // Billboard: position + camera-facing + mirrored when moving west.
    let cam_rot = tf_q.get(res.cam_e).map(|t| t.rotation).unwrap_or_default();
    let flip = res.ball.vx < 0.0;
    if let Ok(mut tf) = tf_q.get_mut(res.ball_e) {
        tf.translation.x = res.ball.x as f32;
        tf.translation.z = res.ball.z as f32;
        tf.rotation = cam_rot;
        tf.scale.x = if flip { -1.0 } else { 1.0 };
    }
    // Legacy cadence: performance.now()/60 — a 60ms frame step.
    let cells = &res.ball_cells;
    if cells.is_empty() {
        return bounced;
    }
    let frame = ((res.elapsed * 1000.0 / 60.0) as usize) % cells.len();
    let [u, v, uw, vh] = cells[frame];
    for h in std::iter::once(&res.ball_mat).chain(res.echo_mats.iter()) {
        if let Some(m) = materials.get_mut(h) {
            m.uv_transform = Affine2 {
                matrix2: Mat2::from_diagonal(Vec2::new(uw, vh)),
                translation: Vec2::new(u, v),
            };
        }
    }
    for (i, e) in res.echo_es.clone().into_iter().enumerate() {
        let s = res.trail.get(i + 1).copied();
        if let Ok(mut vis) = vis_q.get_mut(e) {
            *vis = if s.is_some() {
                Visibility::Inherited
            } else {
                Visibility::Hidden
            };
        }
        if let (Some((x, z)), Ok(mut tf)) = (s, tf_q.get_mut(e)) {
            tf.translation.x = x as f32;
            tf.translation.z = z as f32;
            tf.rotation = cam_rot;
            tf.scale.x = if flip { -1.0 } else { 1.0 };
        }
    }
    bounced
}

/// aimIntroCamera: side-on → isometric, zoom fitted to frame the whole title.
fn aim_camera(
    res: &mut IntroRes,
    sweep_u: f64,
    window: &Query<&Window, With<PrimaryWindow>>,
    tf_q: &mut Query<&mut Transform>,
    proj_q: &mut Query<&mut Projection>,
) {
    let aspect = window
        .single()
        .map(|w| f64::from(w.width()) / f64::from(w.height().max(1.0)))
        .unwrap_or(16.0 / 9.0);
    let half_h = f64::from(VIEW_H) / 2.0;
    let half_w = half_h * aspect;
    let g = &res.layout.grid;
    let fit = fit_zoom(
        f64::from(g.w),
        f64::from(g.h),
        f64::from(WALL_H),
        half_w,
        half_h,
    );
    let pose = aim_intro_camera(sweep_u, (res.ball.x, res.ball.z), res.layout.center, fit);
    let target = Vec3::new(pose.target.0 as f32, 0.0, pose.target.1 as f32);
    if let Ok(mut tf) = tf_q.get_mut(res.cam_e) {
        tf.translation = target + camera_offset_angles(pose.tilt as f32, pose.yaw as f32);
        tf.look_at(target, Vec3::Y);
    }
    if let Ok(mut proj) = proj_q.get_mut(res.cam_e) {
        if let Projection::Orthographic(o) = &mut *proj {
            o.scaling_mode = ScalingMode::FixedVertical {
                viewport_height: VIEW_H,
            };
            o.scale = (1.0 / pose.zoom) as f32;
        }
    }
}

fn intro_teardown(
    mut commands: Commands,
    doomed: Query<Entity, With<IntroOnly>>,
    mut proj_q: Query<&mut Projection, With<DungeonCamera>>,
    mut ambient: ResMut<AmbientLight>,
    mut gui: ResMut<GuiLayer>,
    mut views: ResMut<GuiViews>,
) {
    for e in &doomed {
        commands.entity(e).despawn();
    }
    // The ambient is a RESOURCE, not one of the entities above, so despawning
    // `IntroOnly` does not take it with them. `cleanupVisuals` removes the whole
    // `introLights` group (`index.ts:311`) and the scene it hands to installs its
    // own — but "the next scene overwrites it" is not a teardown, it is a
    // coincidence that holds until one scene does not. Closed by the scene that
    // opened it, per the tavern's GUI-stack lesson.
    dungeon_light::reset_ambient(&mut ambient);
    // The chrome is a GLOBAL layer, like the ambient: the stack outlives the
    // scene, so the scene that opened the screen closes it. Otherwise the title
    // and its SKIP button paint over the tavern.
    gui.close(ScreenId::IntroChrome);
    views.intro = None;
    // camera.zoom = 1 (cleanupVisuals).
    for mut proj in &mut proj_q {
        if let Projection::Orthographic(o) = &mut *proj {
            o.scale = 1.0;
        }
    }
    commands.remove_resource::<IntroRes>();
}
