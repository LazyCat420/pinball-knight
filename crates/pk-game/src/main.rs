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
//!
//! ## Two lints Bevy makes meaningless
//!
//! A system's parameter list IS its dependency declaration — that is how the
//! scheduler knows what can run in parallel — so "too many arguments" is
//! measuring the wrong thing here, and bundling params into a struct to quiet
//! it would hide the very information the engine reads. `Query<(A, B), (With<C>,
//! Without<D>)>` is likewise a type by construction; aliasing it moves the
//! filter out of the line where the borrow conflict has to be checked, and this
//! shell already hit Bevy's B0001 once for exactly that reason.
#![allow(clippy::too_many_arguments, clippy::type_complexity)]

mod dungeon_render;
mod floor_loading;
mod fx;
mod intro;
mod overworld;
mod post;
mod real_floor;
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
use floor_loading::{FloorLoadingPlugin, PreparedFloor};
use overworld::CpuSheet;
use pk_assets::published::SheetManifest;
use pk_core::state::{simulate, Facing, FrameInput, SimState};
// The loading probe is read by `publish_stats`, which only exists on the web.
#[cfg(target_arch = "wasm32")]
use floor_loading::FloorLoadingRes;
use real_floor::{
    real_floor_request, spawn_real_floor_decor, ActiveFloor, RealFloorBoot, RealFloorFailure,
};

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
    /// The floor is being BUILT. The only state that builds one, and the only
    /// way into `Dungeon` — see `floor_loading`'s header.
    FloorLoading,
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
    // Read ONCE, here, and carried as a resource: `setup_dungeon` runs again
    // after every tavern hand-off, and re-reading the process arguments each
    // time would let one flag mean different things on floor 1 and floor 2.
    let boot = RealFloorBoot(real_floor_request());
    // Hub-first: a skipped intro lands in the tavern, not on a floor. Only
    // the explicit dev hatch opens straight into the dungeon — and asking for
    // a real floor IS asking for a floor, so it opens one rather than dropping
    // you in a hub with a flag that appears to have done nothing.
    let start = if dungeon_boot_gate() || boot.requested() {
        AppState::FloorLoading
    } else if tavern::tavern_boot_gate() || intro_skip_gate() {
        AppState::Tavern
    } else {
        AppState::Intro
    };
    let mut app = App::new();
    app.insert_resource(boot);
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
    .add_plugins(FloorLoadingPlugin)
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
            // THE INVARIANT, as a run condition: no prepared floor, no install.
            // Entering the dungeon by any route that did not pass through
            // `FloorLoading` now does nothing at all, rather than quietly
            // building a floor by a second path.
            .run_if(resource_exists::<PreparedFloor>)
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
    floor_res: Option<Res<ActiveFloor>>,
    floor_err: Option<Res<RealFloorFailure>>,
    floor_timings: Option<Res<FloorTimings>>,
    loading_res: Option<Res<FloorLoadingRes>>,
    state: Res<State<AppState>>,
    mut frame: Local<u32>,
    mut ticks: Local<u64>,
) {
    // Every 5 frames, not 10: the probe is the only view a harness has, and
    // at a heavy scene's dev-build frame rate a 10-frame cadence goes stale
    // enough (~400 ms) to flake pk-check's closed-loop walk gates.
    //
    // ⚠️ EXCEPT IN `FloorLoading`, which publishes EVERY frame. That state lives
    // for ~300 ms and the first five frames of a cold wasm boot — shader
    // compilation included — take longer than that, so on a 5-frame cadence the
    // state was entered, painted, and left before the probe published once. The
    // browser gate read "the loading screen was never seen" over a screen that
    // was genuinely on the display. A transient state must not be invisible
    // because of the sampling rate of the only instrument that can see it.
    *frame += 1;
    let transient = *state.get() == AppState::FloorLoading;
    if !transient && *frame % 5 != 0 {
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
    // The generated floor, when one is installed. `null` on the demo floor —
    // NOT omitted, because `--real-floor` silently doing nothing and the flag
    // not being passed are the two states a gate most needs to tell apart.
    let floor_field = match (&floor_res, &floor_timings) {
        // The timings ride INSIDE the floor payload rather than beside it, so a
        // reader cannot pair this descend's cost with the previous descend's
        // floor — the two resources are inserted and dropped together.
        (Some(f), t) => {
            let body = f.telemetry_json();
            let (prepare, install) = t
                .as_ref()
                .map_or((-1.0, -1.0), |t| (t.prepare_ms, t.install_ms));
            format!(
                "{},\"prepareMs\":{prepare},\"installMs\":{install}}}",
                &body[..body.len() - 1]
            )
        }
        (None, _) => "null".into(),
    };
    // The loading screen, while it is up. `null` otherwise — which is how a
    // browser gate can tell "the screen was skipped" from "the screen is gone
    // because the floor is ready", two states a screenshot cannot separate.
    let loading_field = match (*state.get(), &loading_res) {
        (AppState::FloorLoading, Some(l)) => format!(
            r#"{{"label":"{}","painted":{},"prepareMs":{},"dwellMs":{},"elapsedMs":{},"failed":{}}}"#,
            json_escape(&l.label),
            l.painted,
            l.prepare_ms.unwrap_or(-1.0),
            l.dwell_ms,
            floor_loading::now_ms() - l.entered_ms,
            l.failed,
        ),
        _ => "null".into(),
    };
    let floor_error_field = match &floor_err {
        Some(e) => format!("\"{}\"", json_escape(&e.message)),
        None => "null".into(),
    };
    let json = match &sim {
        Some(sim) => {
            let p = &sim.0.player;
            // ⚠️ OFFSET BY THE SYNTHESISED COUNT, not published raw. `tick` is
            // documented as a PULSE that keeps advancing whether or not a sim
            // exists, and `FloorLoading` broke that: the sim-less counter climbs
            // 1, 2, 3… and then `SimState.tick` starts again at 0, so the series
            // went BACKWARDS across the hand-off. pk-check's liveness gate read
            // "-1 Hz" — measured, on the full run, and it is the reason the
            // whole default suite is worth running for a state-machine change.
            //
            // `*ticks` stops climbing the moment a sim exists, so this is the
            // sim-less count frozen at hand-off plus the sim's own tick: one
            // monotonic series across every state.
            format!(
                r#"{{"tick":{},"x":{},"z":{},"facing":"{:?}","moving":{},"intro":{},"tavern":{},"floor":{},"floorError":{},"loading":{}}}"#,
                *ticks + sim.0.tick,
                p.x,
                p.z,
                p.facing,
                p.moving,
                intro_field,
                tavern_field,
                floor_field,
                floor_error_field,
                loading_field
            )
        }
        // No dungeon sim (e.g. the tavern owns the screen, or a real-floor
        // request failed and there is deliberately no floor): keep the tick
        // ADVANCING so pk-check's liveness gate still reads a pulse.
        None => {
            *ticks += 1;
            format!(
                r#"{{"tick":{},"intro":{intro_field},"tavern":{tavern_field},"floor":{floor_field},"floorError":{floor_error_field},"loading":{loading_field}}}"#,
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

/// The two characters that would break a hand-formatted JSON string, plus the
/// control characters a `FloorBuildError` could plausibly carry (it formats a
/// `reason` that came off a URL). Everything else in the payload is a number or
/// a Rust literal, which is why this is the only escaper in the file.
#[cfg(target_arch = "wasm32")]
fn json_escape(s: &str) -> String {
    s.chars()
        .flat_map(|c| match c {
            '"' => "\\\"".chars().collect::<Vec<_>>(),
            '\\' => "\\\\".chars().collect(),
            '\n' => "\\n".chars().collect(),
            '\r' => "\\r".chars().collect(),
            '\t' => "\\t".chars().collect(),
            c if (c as u32) < 0x20 => format!("\\u{:04x}", c as u32).chars().collect(),
            c => vec![c],
        })
        .collect()
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

/// The dungeon/intro floor geometry — see `dungeon_render`. Re-exported at
/// the crate root because `intro.rs` and the dungeon setup both reach for it
/// by that name; the implementation moved out of `main.rs` when it stopped
/// being a loop and became a cull, a bucketing pass and a mesh merger.
pub(crate) use dungeon_render::spawn_grid_meshes;

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

/// INSTALL the prepared floor, the sim, and the playable knight.
///
/// ⚠️ THIS NO LONGER BUILDS A FLOOR. `floor_loading` does, and it is the only
/// thing that does — see its header for why one writer matters here. Entering
/// this state without a [`PreparedFloor`] therefore does NOTHING, which is the
/// invariant stated as a run condition rather than as a comment: a second route
/// into the dungeon would otherwise silently build a second floor.
///
/// It also cannot fail. Every failure mode that used to live here — a refused
/// request, a declined pipeline, an unstandable floor, a marker off its tile —
/// is now reached before the dungeon exists, so the red card is painted over a
/// loading screen instead of over a half-built room.
fn setup_dungeon(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    art: Res<KnightArt>,
    mut prepared: ResMut<PreparedFloor>,
    mut fade_q: Query<&mut BackgroundColor, With<FadeOverlay>>,
) {
    // The intro's black hold ends the moment the dungeon exists (legacy
    // setIntroFade(0) right after onDone()).
    for mut bg in &mut fade_q {
        bg.0 = Color::srgba(0.0, 0.0, 0.0, 0.0);
    }

    let install_t0 = floor_loading::now_ms();
    let spawn = prepared.spawn;
    let prepare_ms = prepared.prepare_ms;

    // ── Sim ──
    //
    // The grid handed over is a CLONE; `ActiveFloor.track.grid` stays
    // authoritative. See `real_floor`'s header for why that split is worth the
    // copy, and `assert_grid_still_authored` for what enforces it.
    let sim = SimState::new(prepared.grid.clone(), spawn, prepared.seed);
    // TAKEN, not borrowed: the generated floor moves from the prepared resource
    // into `ActiveFloor` below, and one owner at a time is what stops a stale
    // copy of the previous floor answering the next descend's telemetry.
    let real = prepared.real.take();
    if let Some(f) = &real {
        // Checked HERE, where the clone is one line old — a mismatch at install
        // time is a bug in the install, and one later is a bug in the sim. The
        // two want different people looking at them. It is an `error!` and not a
        // failure card because there is no route back to the loading screen from
        // here; the floor built and validated, so a drift now is a bug in this
        // function and belongs in the log with a name on it.
        if let Err(msg) = f.assert_grid_still_authored(&sim.grid) {
            error!("real-floor install: {msg}");
        }
    }
    commands.insert_resource(RenderPos {
        prev: spawn,
        curr: spawn,
    });

    for e in spawn_grid_meshes(&mut commands, &mut meshes, &mut materials, &sim.grid) {
        commands.entity(e).insert(DungeonScene);
    }
    if let Some(f) = &real {
        for e in spawn_real_floor_decor(&mut commands, &mut meshes, &mut materials, f) {
            commands.entity(e).insert(DungeonScene);
        }
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
    // The prepared floor is CONSUMED: it exists to cross one state boundary, and
    // a stale one left behind would be the next descend's floor.
    commands.remove_resource::<PreparedFloor>();
    if let Some(f) = real {
        commands.insert_resource(f);
    }
    commands.insert_resource(FloorTimings {
        prepare_ms,
        install_ms: floor_loading::now_ms() - install_t0,
    });
}

/// What the descend actually cost, both halves, in milliseconds.
///
/// Published on `__pk.floor` rather than logged, because the question it answers
/// — is the loading screen covering work or covering nothing — can only be
/// settled on the target that renders, and the only view into that is the debug
/// surface. `prepare_ms` is generation + validation; `install_ms` is the sim,
/// the mesh build and the GPU upload, which is the half no pk-core measurement
/// can see.
#[derive(Resource, Clone, Copy)]
pub struct FloorTimings {
    pub prepare_ms: f64,
    pub install_ms: f64,
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
    // The generated floor goes with the scene that was standing on it. Left
    // behind, the next descent's telemetry would describe the PREVIOUS floor —
    // and the banner and the probe with it, which is the shape of bug that makes
    // a browser gate report on a screen nobody is looking at.
    commands.remove_resource::<ActiveFloor>();
    // The failure latch is cleared too: a fresh descent gets a fresh attempt,
    // and a request that fails deterministically simply fails again.
    commands.remove_resource::<RealFloorFailure>();
    commands.remove_resource::<FloorTimings>();
    // Belt and braces: `setup_dungeon` consumes the prepared floor, but a
    // dungeon LEFT before it installed one would strand it, and the next
    // descend would install a floor the loading screen never named.
    commands.remove_resource::<PreparedFloor>();
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
