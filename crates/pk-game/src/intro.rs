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
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat};
use bevy::window::PrimaryWindow;
use pk_core::intro::{
    aim_intro_camera, build_title_grid, fit_zoom, step_intro_ball, IntroBall, IntroCue, IntroPhase,
    IntroSeq, TitleLayout, SIM_DT_CLAMP, SWEEP_DUR,
};

use crate::overworld::{Overworld, BW};
use crate::sfx::{Audio, SfxEvent};
use pk_audio::Patch;
use crate::{
    camera_offset_angles, spawn_grid_meshes, AppState, DungeonCamera, FadeOverlay, KnightArt,
    VIEW_H, WALL_H,
};

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
    // Entities the tick addresses directly (avoids query-filter tangles).
    canvas_img: Handle<Image>,
    cam_e: Entity,
    ball_e: Entity,
    echo_es: Vec<Entity>,
    title_e: Entity,
    pak_e: Entity, // PRESS ANY KEY
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
    for e in spawn_grid_meshes(&mut commands, &mut meshes, &mut materials, &layout.grid) {
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
    let heading = Color::srgb_u8(0xff, 0xd9, 0x8a); // theme UI.heading (flame light)
    let body = Color::srgb_u8(0xc8, 0xcc, 0xd4); // theme UI.text (steel light)
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
    // The chrome's SKIP button, bottom-right (any click fires it anyway).
    hud_es.push(hud(
        &mut commands,
        "[ SKIP ]",
        Node {
            position_type: PositionType::Absolute,
            right: Val::Px(16.0 * ui),
            bottom: Val::Px(14.0 * ui),
            ..default()
        },
        8.0 * ui,
        body,
    ));

    // Title + PRESS ANY KEY, hidden until the sweep lands.
    let title_e = commands
        .spawn((
            IntroOnly,
            Text::new("PINBALL KNIGHT"),
            TextFont {
                font_size: 32.0 * ui,
                ..default()
            },
            TextColor(heading),
            Node {
                position_type: PositionType::Absolute,
                top: Val::Percent(72.0),
                width: Val::Percent(100.0),
                justify_content: JustifyContent::Center,
                ..default()
            },
            TextLayout::new_with_justify(Justify::Center),
            GlobalZIndex(70),
            Visibility::Hidden,
        ))
        .id();
    let pak_e = commands
        .spawn((
            IntroOnly,
            Text::new("PRESS ANY KEY"),
            TextFont {
                font_size: 8.0 * ui,
                ..default()
            },
            TextColor(body),
            Node {
                position_type: PositionType::Absolute,
                top: Val::Percent(86.0),
                width: Val::Percent(100.0),
                justify_content: JustifyContent::Center,
                ..default()
            },
            TextLayout::new_with_justify(Justify::Center),
            GlobalZIndex(70),
            Visibility::Hidden,
        ))
        .id();

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
        canvas_img,
        cam_e,
        ball_e,
        echo_es,
        title_e,
        pak_e,
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
    mut sfx: MessageWriter<SfxEvent>,
    audio: Res<Audio>,
) {
    // TWO deltas: `pdt` is real time and drives the choreography, `dt` stays
    // clamped and drives the ball — see pk_core::intro's clock notes. Bevy's
    // Time hands us the real frame delta directly (zero on frame one, which
    // is the legacy first-tick stamp behaviour).
    let pdt = time.delta_secs_f64();
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

    // Skip: any key (minus modifiers), any click.
    let skip_key = keys.get_just_pressed().any(|k| !is_modifier(*k));
    if skip_key || mouse.get_just_pressed().next().is_some() {
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
                sfx.write(SfxEvent::Roll);
            }
            IntroCue::BonkStart => {
                res.ow.shake = 1.0;
                // Both, same frame, in this order — the shatter reads as one
                // event: the brick breaking and the coin it pays out.
                sfx.write(SfxEvent::Break);
                sfx.write(SfxEvent::Coin);
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
            }
            IntroCue::SweepStart => res.ow.clear_for_sweep(),
            IntroCue::TitleStart => {
                for e in [res.title_e, res.pak_e] {
                    if let Ok(mut v) = vis_q.get_mut(e) {
                        *v = Visibility::Inherited;
                    }
                }
            }
            IntroCue::Finish => {
                res.finishing = true;
                // Scheduled 0.4s out ON THE AUDIO CLOCK, not a Bevy timer:
                // the sting has to land under the black hold that ends the
                // sequence, and a frame timer drifts against the samples it
                // is trying to sit beside.
                audio.play(Patch::LevelStart { at_offset: 0.4 });
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
                sfx.write(SfxEvent::Bumper);
            }
            aim_camera(&mut res, 0.0, &window, &mut tf_q, &mut proj_q);
            res.ow.paint_shatter(dt, pt);
            canvas_dirty = true;
        }
        IntroPhase::Sweep => {
            if sim_ball(&mut res, dt, &mut tf_q, &mut vis_q, &mut materials) {
                sfx.write(SfxEvent::Bumper);
            }
            aim_camera(&mut res, pt / SWEEP_DUR, &window, &mut tf_q, &mut proj_q);
        }
        IntroPhase::Title => {
            if sim_ball(&mut res, dt, &mut tf_q, &mut vis_q, &mut materials) {
                sfx.write(SfxEvent::Bumper);
            }
            aim_camera(&mut res, 1.0, &window, &mut tf_q, &mut proj_q);
            // A 1.1s step blink, from wall clock (intro-chrome.ts).
            if let Ok(mut v) = vis_q.get_mut(res.pak_e) {
                *v = if (res.elapsed * 1000.0) % 1100.0 < 620.0 {
                    Visibility::Inherited
                } else {
                    Visibility::Hidden
                };
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
) {
    for e in &doomed {
        commands.entity(e).despawn();
    }
    // camera.zoom = 1 (cleanupVisuals).
    for mut proj in &mut proj_q {
        if let Projection::Orthographic(o) = &mut *proj {
            o.scale = 1.0;
        }
    }
    commands.remove_resource::<IntroRes>();
}
