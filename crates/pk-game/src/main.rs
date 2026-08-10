//! Pinball Knight — the Bevy shell (vertical slice).
//!
//! Sim-as-a-resource: `pk_core::simulate` steps in `FixedUpdate` at 60 Hz;
//! everything Bevy-side is a view synced from it with overstep interpolation.
//! The slice renders the demo floor (border walls, pillar field), the knight
//! billboard animated from the real published sheets (embedded), the 38°/45°
//! orthographic camera, and WASD/arrow movement through the ported collision.
//!
//! Boot flow: `Intro` (the shattered-overworld title sequence, `intro.rs`)
//! → `Tavern`, the hub you outfit in before a run; the DESCEND board builds
//! the floor. The intro is skipped for harness entries (`?autostart=1`), the
//! documented opt-out (`?no-intro=1` / `--no-intro` / `PK_NO_INTRO=1`),
//! `__skipDungeonIntro`, and prefers-reduced-motion — see
//! `pk_core::intro::should_skip_intro`. A skipped intro still lands in the
//! hub; `--dungeon` / `?dungeon=1` / `PK_SCENE=dungeon` is the dev hatch that
//! boots a floor directly (the harness's sim gates need one without walking).

mod fx;
mod intro;
mod overworld;
mod post;
mod sfx;
mod tavern;
mod tavern_art;

use bevy::asset::RenderAssetUsages;
use bevy::camera::ScalingMode;
use bevy::core_pipeline::tonemapping::Tonemapping;
use bevy::diagnostic::{DiagnosticsStore, FrameTimeDiagnosticsPlugin};
use bevy::image::{Image, ImageSampler};
use bevy::math::Affine2;
use bevy::prelude::*;
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat};
use overworld::CpuSheet;
use pk_assets::published::SheetManifest;
use pk_core::grid::{is_low_wall, is_walkable, shape_at, tile_center, Grid};
use pk_core::state::{demo_floor, simulate, Facing, FrameInput, SimState};
use pk_core::tile_shape::{is_round, is_slant, round_center, shape_normal, SHAPE_FULL};

/// legacy constants/world.ts
pub(crate) const WALL_H: f32 = 1.1;
const WALL_LOW: f32 = 0.35;
/// legacy engine/config.ts camera defaults.
const CAM_TILT: f32 = 38.0 * std::f32::consts::PI / 180.0;
const CAM_YAW: f32 = 45.0 * std::f32::consts::PI / 180.0;
const CAM_DIST: f32 = 40.0;
pub(crate) const VIEW_H: f32 = 11.25;

/// The published knight sheets, embedded so native and wasm load identically.
/// The bake pipeline (M0 exit) replaces embedding with per-rung atlases.
const SHEET_S_PNG: &[u8] = include_bytes!("../../../legacy/public/sprites/pinball_knight-S.png");
const SHEET_S_JSON: &str = include_str!("../../../legacy/public/sprites/pinball_knight-S.json");
const SHEET_E_PNG: &[u8] = include_bytes!("../../../legacy/public/sprites/pinball_knight-E.png");
const SHEET_E_JSON: &str = include_str!("../../../legacy/public/sprites/pinball_knight-E.json");
const SHEET_N_PNG: &[u8] = include_bytes!("../../../legacy/public/sprites/pinball_knight-N.png");
const SHEET_N_JSON: &str = include_str!("../../../legacy/public/sprites/pinball_knight-N.json");

/// Boot → title sequence → the game. The intro enters exactly once per
/// launch (the legacy `played` latch is the state machine's shape here).
#[derive(States, Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AppState {
    Intro,
    Dungeon,
    /// The walkable between-floor hub (P6). Entered via the boot gate, or T
    /// in the dungeon (the stand-in for the P5 run flow); DESCEND leaves it.
    Tavern,
}

#[derive(Resource)]
pub struct Sim(pub SimState);

/// Buffered input intent, drained by the sim each fixed tick.
#[derive(Resource, Default)]
struct Intent(FrameInput);

/// Last two sim positions, for overstep interpolation in `Update`.
#[derive(Resource)]
struct RenderPos {
    prev: (f64, f64),
    curr: (f64, f64),
}

/// One authored direction's clips: sheet texture + per-clip cell rects (in UV
/// space) on it, plus the world-space quad aspect of a cell.
pub struct SheetClips {
    pub material: Handle<StandardMaterial>,
    pub idle: Vec<[f32; 4]>, // [u, v, uw, vh]
    pub walk: Vec<[f32; 4]>,
    /// The sprint clip — the intro's ball frames (`E:ball ?? E:run`).
    pub run: Vec<[f32; 4]>,
    pub aspect: f32, // cell w / h
}

#[derive(Resource)]
pub struct KnightArt {
    pub s: SheetClips,
    pub e: SheetClips,
    pub n: SheetClips,
    /// CPU copy of the E sheet for the intro's 2D overworld painter.
    pub e_cpu: CpuSheet,
}

#[derive(Component)]
struct KnightSprite;

#[derive(Component)]
pub struct DungeonCamera;

/// The black wipe the intro fades through; global so the handoff can cross
/// the state transition. Alpha 0 except while the intro is finishing.
#[derive(Component)]
pub struct FadeOverlay;

/// Top-center frame-time readout (ms first — that's the number that matters).
#[derive(Component)]
struct FrameStats;

/// Bottom-right build-age readout. Answers the question a fast edit loop
/// keeps asking: is this window the build I just made, or one I forgot to
/// close? `build.rs` stamps `PK_BUILD_EPOCH` at compile time.
#[derive(Component)]
struct BuildStamp;

/// Unix seconds now — the one clock both targets can read.
fn wall_clock_secs() -> f64 {
    #[cfg(target_arch = "wasm32")]
    {
        js_sys::Date::now() / 1000.0
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0)
    }
}

/// "built 42s ago" / "built 12m ago" / "built 3h 07m ago". Coarse on purpose:
/// the useful signal is fresh-vs-stale, not the exact second.
fn format_build_age(secs: f64) -> String {
    let s = secs.max(0.0) as u64;
    if s < 60 {
        format!("built {s}s ago")
    } else if s < 3600 {
        format!("built {}m ago", s / 60)
    } else {
        format!("built {}h {:02}m ago", s / 3600, (s % 3600) / 60)
    }
}

/// The skip gate, evaluated once at boot. Native reads flags/env; wasm reads
/// the legacy query params, escape hatch and media query off the real window.
fn intro_skip_gate() -> bool {
    #[cfg(target_arch = "wasm32")]
    {
        let eval_bool = |src: &str| {
            js_sys::eval(src)
                .ok()
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
        };
        let search = js_sys::eval("location.search")
            .ok()
            .and_then(|v| v.as_string())
            .unwrap_or_default();
        let reduced = eval_bool(
            "(()=>{try{return matchMedia('(prefers-reduced-motion: reduce)').matches}catch(e){return false}})()",
        );
        let flag = eval_bool("!!window.__skipDungeonIntro");
        pk_core::intro::should_skip_intro(&search, flag, reduced, false)
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let no_intro = std::env::args().any(|a| a == "--no-intro")
            || std::env::var("PK_NO_INTRO")
                .map(|v| v == "1")
                .unwrap_or(false);
        pk_core::intro::should_skip_intro("", no_intro, false, false)
    }
}

/// The dev hatch: boot a dungeon floor without walking the hub. Mirrors
/// `tavern_boot_gate`'s flag styles. `pk-check` uses `?dungeon=1` so the sim
/// and input gates still have a floor to measure.
fn dungeon_boot_gate() -> bool {
    #[cfg(target_arch = "wasm32")]
    {
        js_sys::eval("location.search")
            .ok()
            .and_then(|v| v.as_string())
            .map(|s| s.contains("dungeon=1"))
            .unwrap_or(false)
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        std::env::args().any(|a| a == "--dungeon")
            || std::env::var("PK_SCENE")
                .map(|v| v == "dungeon")
                .unwrap_or(false)
    }
}

fn main() {
    // Hub-first: a skipped intro lands in the tavern, not on a floor. Only
    // the explicit dev hatch opens straight into the dungeon.
    let start = if dungeon_boot_gate() {
        AppState::Dungeon
    } else if tavern::tavern_boot_gate() || intro_skip_gate() {
        AppState::Tavern
    } else {
        AppState::Intro
    };
    let mut app = App::new();
    app.add_plugins(DefaultPlugins.set(WindowPlugin {
        primary_window: Some(Window {
            title: "Pinball Knight (Rust slice)".into(),
            ..default()
        }),
        ..default()
    }))
    .insert_resource(ClearColor(Color::srgb(0.04, 0.04, 0.07)))
    .insert_resource(Time::<Fixed>::from_hz(60.0))
    .init_resource::<Intent>()
    .add_plugins(FrameTimeDiagnosticsPlugin::default())
    .insert_state(start)
    .add_plugins(intro::IntroPlugin)
    .add_plugins(tavern::TavernPlugin)
    .add_plugins(post::PostPlugin)
    .add_plugins(fx::FxPlugin)
    .add_plugins(sfx::SfxPlugin)
    .add_systems(Startup, setup_common)
    // Scene setups are lazy Update systems, not OnEnter: the initial state's
    // OnEnter fires before Startup has applied its commands, so a Res param
    // there fails validation (measured: wasm panic on boot). The
    // resource-existence guards make entry order irrelevant.
    .add_systems(Update, update_frame_stats)
    .add_systems(
        Update,
        setup_dungeon
            .run_if(in_state(AppState::Dungeon))
            .run_if(resource_exists::<KnightArt>)
            .run_if(not(resource_exists::<Sim>)),
    )
    .add_systems(
        Update,
        (gather_input, sync_knight, follow_camera)
            .chain()
            .run_if(in_state(AppState::Dungeon))
            .run_if(resource_exists::<Sim>),
    )
    .add_systems(
        Update,
        dungeon_to_tavern.run_if(in_state(AppState::Dungeon)),
    )
    .add_systems(OnExit(AppState::Dungeon), teardown_dungeon)
    .add_systems(
        FixedUpdate,
        step_sim
            .run_if(in_state(AppState::Dungeon))
            .run_if(resource_exists::<Sim>),
    );
    #[cfg(target_arch = "wasm32")]
    app.add_systems(Update, publish_stats);
    app.run();
}

/// `window.__pk` — the sim's externally readable pulse, and the seed of the
/// legacy `__lab()` debug surface. `scripts/pk-check.mjs` polls it to verify
/// from OUTSIDE the app that the sim ticks at 60 Hz and that input moves the
/// knight. `intro` mirrors the legacy `__dungeonIntroPhase` probe: the phase
/// name while the title sequence plays, null otherwise.
#[cfg(target_arch = "wasm32")]
fn publish_stats(
    sim: Option<Res<Sim>>,
    intro_res: Option<Res<intro::IntroRes>>,
    tavern_res: Option<Res<tavern::TavernRes>>,
    state: Res<State<AppState>>,
    mut frame: Local<u32>,
    mut ticks: Local<u64>,
) {
    // Every 5 frames, not 10: the probe is the only view a harness has, and
    // at a heavy scene's dev-build frame rate a 10-frame cadence goes stale
    // enough (~400 ms) to flake pk-check's closed-loop walk gates.
    *frame += 1;
    if *frame % 5 != 0 {
        return;
    }
    let intro_field = match (*state.get(), &intro_res) {
        (AppState::Intro, Some(i)) => format!("\"{}\"", i.phase_name()),
        _ => "null".into(),
    };
    // The tavern probe — mirrors the legacy `__tavernProbe` surface (pose,
    // focus, open panel) so pk-check can drive the room from outside.
    let tavern_field = match (*state.get(), &tavern_res) {
        (AppState::Tavern, Some(t)) => format!(
            r#"{{"x":{},"z":{},"facing":"{:?}","speed":{},"focus":{},"panel":{}}}"#,
            t.pose.x,
            t.pose.z,
            t.pose.facing,
            t.pose.speed,
            t.focus
                .map(|s| format!("\"{}\"", s.id))
                .unwrap_or("null".into()),
            t.open_panel.is_some(),
        ),
        _ => "null".into(),
    };
    let json = match &sim {
        Some(sim) => {
            let p = &sim.0.player;
            format!(
                r#"{{"tick":{},"x":{},"z":{},"facing":"{:?}","moving":{},"intro":{},"tavern":{}}}"#,
                sim.0.tick, p.x, p.z, p.facing, p.moving, intro_field, tavern_field
            )
        }
        // No dungeon sim (e.g. the tavern owns the screen): keep the tick
        // ADVANCING so pk-check's liveness gate still reads a pulse.
        None => {
            *ticks += 1;
            format!(
                r#"{{"tick":{},"intro":{intro_field},"tavern":{tavern_field}}}"#,
                *ticks
            )
        }
    };
    let _ = js_sys::Reflect::set(
        &js_sys::global(),
        &wasm_bindgen::JsValue::from_str("__pk"),
        &wasm_bindgen::JsValue::from_str(&json),
    );
}

fn decode_sheet(
    png: &[u8],
    json: &str,
    images: &mut Assets<Image>,
    materials: &mut Assets<StandardMaterial>,
    keep_cpu: bool,
) -> (SheetClips, Option<CpuSheet>) {
    let decoded = image::load_from_memory(png)
        .expect("embedded sheet decodes")
        .to_rgba8();
    // The published sheets are high-res masters (~3256×4520, ~59 MB decoded).
    // Uploading three of those exhausts SwiftShader's mappable budget and is
    // waste on any GPU — quarter them at load (nearest). The per-rung bake (M0 exit)
    // replaces this with properly crushed atlases; until then nearest keeps
    // the pixel-art edges.
    let decoded = if decoded.width() > 1600 {
        image::imageops::resize(
            &decoded,
            decoded.width() / 4,
            decoded.height() / 4,
            image::imageops::FilterType::Nearest,
        )
    } else {
        decoded
    };
    let (w, h) = decoded.dimensions();
    let raw = decoded.into_raw();

    let m: SheetManifest = serde_json::from_str(json).expect("embedded manifest parses");
    let (sw, sh) = (m.source[0] as f32, m.source[1] as f32);
    let uv_cells = |clip: &str| -> Vec<[f32; 4]> {
        m.rows
            .iter()
            .filter(|r| r.clip == clip)
            .flat_map(|r| r.cells.iter())
            .map(|c| {
                let [x0, y0, x1, y1] = *c;
                [
                    x0 as f32 / sw,
                    y0 as f32 / sh,
                    (x1 - x0) as f32 / sw,
                    (y1 - y0) as f32 / sh,
                ]
            })
            .collect()
    };
    // Same cells as px rects on the (possibly quartered) decoded image.
    let px_cells = |clip: &str| -> Vec<[u32; 4]> {
        let (fx, fy) = (w as f32 / sw, h as f32 / sh);
        m.rows
            .iter()
            .filter(|r| r.clip == clip)
            .flat_map(|r| r.cells.iter())
            .map(|c| {
                let [x0, y0, x1, y1] = *c;
                [
                    (x0 as f32 * fx) as u32,
                    (y0 as f32 * fy) as u32,
                    (x1 as f32 * fx) as u32,
                    (y1 as f32 * fy) as u32,
                ]
            })
            .collect()
    };
    let cpu = keep_cpu.then(|| {
        // The intro's ball clip: `E:ball ?? E:run` (the published sheets don't
        // author ride forms; the fallback is the legacy line, verbatim).
        let run_px = px_cells("run");
        CpuSheet {
            w,
            h,
            px: raw.clone(),
            run: if run_px.is_empty() {
                px_cells("walk")
            } else {
                run_px
            },
            roll: px_cells("roll"),
        }
    });

    let mut img = Image::new(
        Extent3d {
            width: w,
            height: h,
            depth_or_array_layers: 1,
        },
        TextureDimension::D2,
        raw,
        TextureFormat::Rgba8UnormSrgb,
        RenderAssetUsages::RENDER_WORLD,
    );
    img.sampler = ImageSampler::nearest(); // pixel art stays crisp
    let tex = images.add(img);

    let idle = uv_cells("idle");
    let walk = uv_cells("walk");
    let run = uv_cells("run");
    let first = idle
        .first()
        .or_else(|| walk.first())
        .expect("sheet has idle or walk cells");
    let aspect = (first[2] * sw) / (first[3] * sh);

    let material = materials.add(StandardMaterial {
        base_color_texture: Some(tex),
        unlit: true,
        alpha_mode: AlphaMode::Blend,
        cull_mode: None, // readable when mirrored for W
        ..default()
    });
    (
        SheetClips {
            material,
            idle,
            run: if run.is_empty() { walk.clone() } else { run },
            walk,
            aspect,
        },
        cpu,
    )
}

/// ~4×/s: smoothed frame time in ms (the budget number) + fps for reference.
fn update_frame_stats(
    diagnostics: Res<DiagnosticsStore>,
    time: Res<Time>,
    mut acc: Local<f32>,
    mut q: Query<&mut Text, With<FrameStats>>,
    mut stamp_q: Query<&mut Text, (With<BuildStamp>, Without<FrameStats>)>,
) {
    *acc += time.delta_secs();
    if *acc < 0.25 {
        return;
    }
    *acc = 0.0;
    // Same cadence carries the build age — a string that changes once a
    // minute does not need its own timer.
    if let Ok(mut text) = stamp_q.single_mut() {
        let built: f64 = env!("PK_BUILD_EPOCH").parse().unwrap_or(0.0);
        **text = format_build_age(wall_clock_secs() - built);
    }
    let ms = diagnostics
        .get(&FrameTimeDiagnosticsPlugin::FRAME_TIME)
        .and_then(|d| d.smoothed());
    let fps = diagnostics
        .get(&FrameTimeDiagnosticsPlugin::FPS)
        .and_then(|d| d.smoothed());
    if let (Some(ms), Some(fps), Ok(mut text)) = (ms, fps, q.single_mut()) {
        **text = format!("{ms:.1} ms  ({fps:.0} fps)");
    }
}

/// Spawn the floor plane, wall boxes (Diablo-rule low rims), shaped-tile
/// meshes and arc-guide segments for a grid — shared by the dungeon floor and
/// the intro's title maze. Returns every entity so callers can tag them.
pub(crate) fn spawn_grid_meshes(
    commands: &mut Commands,
    meshes: &mut Assets<Mesh>,
    materials: &mut Assets<StandardMaterial>,
    grid: &Grid,
) -> Vec<Entity> {
    let mut out = Vec::new();

    // ── Floor plane ──
    let (gw, gh) = (grid.w as f32, grid.h as f32);
    out.push(
        commands
            .spawn((
                Mesh3d(meshes.add(Plane3d::default().mesh().size(gw, gh))),
                MeshMaterial3d(materials.add(StandardMaterial {
                    base_color: Color::srgb(0.13, 0.11, 0.10),
                    unlit: true,
                    ..default()
                })),
                Transform::from_xyz(0.0, 0.0, 0.0),
            ))
            .id(),
    );

    // ── Walls: full-height stone, knee-high camera-side rims (the Diablo rule)
    let wall_mat = materials.add(StandardMaterial {
        base_color: Color::srgb(0.34, 0.32, 0.30),
        unlit: true,
        ..default()
    });
    let low_mat = materials.add(StandardMaterial {
        base_color: Color::srgb(0.24, 0.22, 0.21),
        unlit: true,
        ..default()
    });
    let wall_mesh = meshes.add(Cuboid::new(1.0, WALL_H, 1.0));
    let low_mesh = meshes.add(Cuboid::new(1.0, WALL_LOW, 1.0));
    // Shaped tiles get their own meshes below — square boxes would contradict
    // the collider ("see = hit" is the tile-shape contract; these are P3-debt
    // approximations of it, not violations).
    let shaped_mat = materials.add(StandardMaterial {
        base_color: Color::srgb(0.42, 0.36, 0.32),
        unlit: true,
        ..default()
    });
    let wedge_mesh = meshes.add(Cuboid::new(std::f64::consts::SQRT_2 as f32, WALL_H, 0.5));
    let round_mesh = meshes.add(Cylinder::new(1.0, WALL_H));
    let arc_seg_mesh = meshes.add(Cuboid::new(0.8, WALL_H, 0.8));
    for j in 0..grid.h {
        for i in 0..grid.w {
            if is_walkable(grid, i, j) {
                continue;
            }
            let shape = shape_at(grid, i, j);
            let (x, z) = tile_center(grid, i, j);
            if is_slant(shape) {
                // A wedge along the hypotenuse, offset onto the solid side.
                let n = shape_normal(shape).unwrap();
                let yaw = if (n.x > 0.0) == (n.z > 0.0) {
                    std::f32::consts::FRAC_PI_4
                } else {
                    -std::f32::consts::FRAC_PI_4
                };
                out.push(
                    commands
                        .spawn((
                            Mesh3d(wedge_mesh.clone()),
                            MeshMaterial3d(shaped_mat.clone()),
                            Transform::from_xyz(
                                (x - n.x * 0.25) as f32,
                                WALL_H / 2.0,
                                (z - n.z * 0.25) as f32,
                            )
                            .with_rotation(Quat::from_rotation_y(yaw)),
                        ))
                        .id(),
                );
                continue;
            }
            if is_round(shape) {
                // Quarter-disc corner: a radius-1 cylinder on the arc centre;
                // the surplus quarters sink into the solid backing tiles.
                let c = round_center(shape).unwrap();
                let (gw2, gh2) = (f64::from(grid.w) / 2.0, f64::from(grid.h) / 2.0);
                out.push(
                    commands
                        .spawn((
                            Mesh3d(round_mesh.clone()),
                            MeshMaterial3d(shaped_mat.clone()),
                            Transform::from_xyz(
                                (f64::from(i) + c.x - gw2) as f32,
                                WALL_H / 2.0,
                                (f64::from(j) + c.z - gh2) as f32,
                            ),
                        ))
                        .id(),
                );
                continue;
            }
            if shape != SHAPE_FULL {
                continue; // ARC slices render from their feature below
            }
            let low = is_low_wall(grid, i, j);
            let (mesh, mat, hh) = if low {
                (low_mesh.clone(), low_mat.clone(), WALL_LOW / 2.0)
            } else {
                (wall_mesh.clone(), wall_mat.clone(), WALL_H / 2.0)
            };
            out.push(
                commands
                    .spawn((
                        Mesh3d(mesh),
                        MeshMaterial3d(mat),
                        Transform::from_xyz(x as f32, hh, z as f32),
                    ))
                    .id(),
            );
        }
    }
    // Multi-tile arc guides: segment boxes swept along each feature's circle
    // (the collider resolves against the true arc; this is its visual echo).
    let arc_mat = materials.add(StandardMaterial {
        base_color: Color::srgb(0.55, 0.45, 0.28), // brass-ish: the ball guide
        unlit: true,
        ..default()
    });
    for f in &grid.arcs {
        let (gw2, gh2) = (f64::from(grid.w) / 2.0, f64::from(grid.h) / 2.0);
        let segs = ((f.span / 0.2).ceil() as usize).max(4);
        for s in 0..segs {
            let a = f.a0 + f.span * (s as f64 + 0.5) / segs as f64;
            out.push(
                commands
                    .spawn((
                        Mesh3d(arc_seg_mesh.clone()),
                        MeshMaterial3d(arc_mat.clone()),
                        Transform::from_xyz(
                            (f.cx + libm::cos(a) * f.r - gw2) as f32,
                            WALL_H / 2.0,
                            (f.cz + libm::sin(a) * f.r - gh2) as f32,
                        )
                        .with_rotation(Quat::from_rotation_y(-a as f32)),
                    ))
                    .id(),
            );
        }
    }
    out
}

/// What both states need: the camera, the frame-time readout, the knight art
/// and the fade overlay. Runs before the initial state's OnEnter.
fn setup_common(
    mut commands: Commands,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut images: ResMut<Assets<Image>>,
) {
    // ── Frame-time readout, top-center ──
    commands
        .spawn(Node {
            position_type: PositionType::Absolute,
            top: Val::Px(6.0),
            left: Val::Px(0.0),
            width: Val::Percent(100.0),
            justify_content: JustifyContent::Center,
            ..default()
        })
        .with_children(|p| {
            p.spawn((
                Text::new("-- ms"),
                TextFont {
                    font_size: 14.0,
                    ..default()
                },
                TextColor(Color::srgba(1.0, 1.0, 1.0, 0.85)),
                FrameStats,
            ));
        });

    // ── Build age, bottom-right ──
    commands
        .spawn(Node {
            position_type: PositionType::Absolute,
            bottom: Val::Px(6.0),
            right: Val::Px(8.0),
            ..default()
        })
        .with_children(|p| {
            p.spawn((
                Text::new("built --"),
                TextFont {
                    font_size: 12.0,
                    ..default()
                },
                TextColor(Color::srgba(1.0, 1.0, 1.0, 0.55)),
                BuildStamp,
            ));
        });

    // ── The intro's black wipe, above everything, transparent until used ──
    commands.spawn((
        FadeOverlay,
        Node {
            position_type: PositionType::Absolute,
            left: Val::Px(0.0),
            top: Val::Px(0.0),
            width: Val::Percent(100.0),
            height: Val::Percent(100.0),
            ..default()
        },
        BackgroundColor(Color::srgba(0.0, 0.0, 0.0, 0.0)),
        GlobalZIndex(100),
    ));

    // ── Knight billboard art from the real published sheets ──
    let (s, _) = decode_sheet(
        SHEET_S_PNG,
        SHEET_S_JSON,
        &mut images,
        &mut materials,
        false,
    );
    let (e, e_cpu) = decode_sheet(SHEET_E_PNG, SHEET_E_JSON, &mut images, &mut materials, true);
    let (n, _) = decode_sheet(
        SHEET_N_PNG,
        SHEET_N_JSON,
        &mut images,
        &mut materials,
        false,
    );
    commands.insert_resource(KnightArt {
        s,
        e,
        n,
        e_cpu: e_cpu.expect("E sheet keeps a CPU copy"),
    });

    // ── Camera: orthographic, tilt 38°, yaw 45°, 11.25 world-units tall ──
    commands.spawn((
        DungeonCamera,
        Camera3d::default(),
        Tonemapping::None,
        Projection::Orthographic(OrthographicProjection {
            scaling_mode: ScalingMode::FixedVertical {
                viewport_height: VIEW_H,
            },
            ..OrthographicProjection::default_3d()
        }),
        Transform::from_translation(camera_offset()).looking_at(Vec3::ZERO, Vec3::Y),
    ));
}

/// Everything a dungeon visit owns — despawned when the scene is left (the
/// tavern hand-off), so a descend builds a FRESH floor.
#[derive(Component)]
struct DungeonScene;

/// The demo floor, the sim, and the playable knight.
fn setup_dungeon(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    art: Res<KnightArt>,
    mut fade_q: Query<&mut BackgroundColor, With<FadeOverlay>>,
) {
    // The intro's black hold ends the moment the dungeon exists (legacy
    // setIntroFade(0) right after onDone()).
    for mut bg in &mut fade_q {
        bg.0 = Color::srgba(0.0, 0.0, 0.0, 0.0);
    }

    // ── Sim ──
    let (grid, spawn) = demo_floor(7);
    let sim = SimState::new(grid, spawn, 7);
    commands.insert_resource(RenderPos {
        prev: spawn,
        curr: spawn,
    });

    for e in spawn_grid_meshes(&mut commands, &mut meshes, &mut materials, &sim.grid) {
        commands.entity(e).insert(DungeonScene);
    }

    // ── Knight billboard from the real published sheets ──
    let quad_h = 1.15f32;
    let quad_w = quad_h * art.s.aspect;
    commands.spawn((
        DungeonScene,
        KnightSprite,
        Mesh3d(meshes.add(Rectangle::new(quad_w, quad_h))),
        MeshMaterial3d(art.s.material.clone()),
        Transform::from_xyz(spawn.0 as f32, quad_h / 2.0, spawn.1 as f32),
    ));
    commands.insert_resource(Sim(sim));
}

/// Leaving the dungeon tears the floor down completely — Sim included — so
/// the next entry regenerates through `setup_dungeon` (the legacy dungeon
/// tears down between floors; two scenes must not share live state).
fn teardown_dungeon(mut commands: Commands, q: Query<Entity, With<DungeonScene>>) {
    for e in &q {
        commands.entity(e).despawn();
    }
    commands.remove_resource::<Sim>();
    commands.remove_resource::<RenderPos>();
}

/// T enters the tavern from the dungeon — the stand-in for the P5 run flow
/// (death / floor-clear / lobby), which is where `enterTavern` is called
/// from in the legacy game.
fn dungeon_to_tavern(keys: Res<ButtonInput<KeyCode>>, mut next: ResMut<NextState<AppState>>) {
    if keys.just_pressed(KeyCode::KeyT) {
        next.set(AppState::Tavern);
    }
}

/// The camera's offset from whatever it's looking at, at an arbitrary
/// tilt/yaw — the intro sweeps these; the dungeon pins them.
pub(crate) fn camera_offset_angles(tilt: f32, yaw: f32) -> Vec3 {
    let horiz = tilt.cos() * CAM_DIST;
    Vec3::new(yaw.sin() * horiz, tilt.sin() * CAM_DIST, yaw.cos() * horiz)
}

/// The dungeon camera's offset — legacy cameraOffset().
pub(crate) fn camera_offset() -> Vec3 {
    camera_offset_angles(CAM_TILT, CAM_YAW)
}

fn gather_input(keys: Res<ButtonInput<KeyCode>>, mut intent: ResMut<Intent>) {
    let mut x = 0.0;
    let mut z = 0.0;
    // Screen-relative on the 45° yaw: up on the stick is up on screen, which
    // is the world diagonal the camera looks along.
    if keys.pressed(KeyCode::KeyW) || keys.pressed(KeyCode::ArrowUp) {
        x -= 1.0;
        z -= 1.0;
    }
    if keys.pressed(KeyCode::KeyS) || keys.pressed(KeyCode::ArrowDown) {
        x += 1.0;
        z += 1.0;
    }
    if keys.pressed(KeyCode::KeyA) || keys.pressed(KeyCode::ArrowLeft) {
        x -= 1.0;
        z += 1.0;
    }
    if keys.pressed(KeyCode::KeyD) || keys.pressed(KeyCode::ArrowRight) {
        x += 1.0;
        z -= 1.0;
    }
    intent.0 = FrameInput {
        move_x: x,
        move_z: z,
    };
}

fn step_sim(mut sim: ResMut<Sim>, intent: Res<Intent>, mut rp: ResMut<RenderPos>) {
    rp.prev = (sim.0.player.x, sim.0.player.z);
    simulate(&mut sim.0, &intent.0);
    rp.curr = (sim.0.player.x, sim.0.player.z);
}

fn sync_knight(
    time: Res<Time<Fixed>>,
    sim: Res<Sim>,
    art: Res<KnightArt>,
    rp: Res<RenderPos>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut q: Query<(&mut Transform, &mut MeshMaterial3d<StandardMaterial>), With<KnightSprite>>,
    cam: Query<&Transform, (With<DungeonCamera>, Without<KnightSprite>)>,
) {
    let Ok((mut tf, mut mat)) = q.single_mut() else {
        return;
    };
    let a = time.overstep_fraction() as f64;
    let x = rp.prev.0 + (rp.curr.0 - rp.prev.0) * a;
    let z = rp.prev.1 + (rp.curr.1 - rp.prev.1) * a;
    tf.translation.x = x as f32;
    tf.translation.z = z as f32;

    // Billboard: face the camera plane; mirror for the never-authored W.
    if let Ok(cam_tf) = cam.single() {
        tf.rotation = cam_tf.rotation;
    }
    let mirror = sim.0.player.facing == Facing::W;
    tf.scale.x = if mirror { -1.0 } else { 1.0 };

    let clips = match sim.0.player.facing {
        Facing::S => &art.s,
        Facing::N => &art.n,
        Facing::E | Facing::W => &art.e,
    };
    mat.0 = clips.material.clone();

    // 8 fps walk, 4 fps idle — slice timing; real clip timing ports in M2.
    let cells = if sim.0.player.moving {
        &clips.walk
    } else {
        &clips.idle
    };
    if cells.is_empty() {
        return;
    }
    let fps = if sim.0.player.moving { 8 } else { 4 };
    let frame = (sim.0.tick * fps / 60) as usize % cells.len();
    let [u, v, uw, vh] = cells[frame];
    if let Some(m) = materials.get_mut(&clips.material) {
        m.uv_transform = Affine2 {
            matrix2: Mat2::from_diagonal(Vec2::new(uw, vh)),
            translation: Vec2::new(u, v),
        };
    }
}

fn follow_camera(
    rp: Res<RenderPos>,
    time: Res<Time<Fixed>>,
    mut cam: Query<&mut Transform, With<DungeonCamera>>,
) {
    let Ok(mut tf) = cam.single_mut() else { return };
    let a = time.overstep_fraction() as f64;
    let x = (rp.prev.0 + (rp.curr.0 - rp.prev.0) * a) as f32;
    let z = (rp.prev.1 + (rp.curr.1 - rp.prev.1) * a) as f32;
    let target = Vec3::new(x, 0.0, z);
    tf.translation = target + camera_offset();
    tf.look_at(target, Vec3::Y);
}
