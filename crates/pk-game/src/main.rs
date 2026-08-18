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
//!
//! PORTS: `index.ts`
#![allow(clippy::too_many_arguments, clippy::type_complexity)]

mod authored_floor;
mod authored_render;
mod ball_anim;
mod coins_render;
mod combat_feedback;
mod dungeon_light;
mod dungeon_render;
mod floor_loading;
mod fx;
mod gambler;
mod gui;
mod intro;
mod mat_cache;
mod maze_art;
mod overworld;
mod perf;
mod plunger_render;
mod post;
mod real_floor;
mod sfx;
mod slash_render;
mod tavern;
mod tavern_art;
mod units;

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
use pk_gui::screens::hud::{
    HudBeltSlot, HudMinimapView, HudSkillSlot, HudView, HudWeaponInfo, MinimapTile,
};
// The loading probe is read by `publish_stats`, which only exists on the web.
use authored_floor::AuthoredFloor;
#[cfg(target_arch = "wasm32")]
use floor_loading::FloorLoadingRes;
use real_floor::{
    read_floor_plan, spawn_real_floor_decor, ActiveFloor, FloorPlan, RealFloorFailure,
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
/// The one monster sheet the port embeds. `plan.spawns` is a list of ZOMBIE
/// spawn tiles (`decorate.ts`'s second section), and only the E direction is
/// published — the sheet's own `mirror: true` is what serves W. N and S arrive
/// with the per-rung bake.
const ZOMBIE_E_PNG: &[u8] = include_bytes!("../../../legacy/public/sprites/zombie-E.png");
const ZOMBIE_E_JSON: &str = include_str!("../../../legacy/public/sprites/zombie-E.json");
const BRUTE_S_PNG: &[u8] = include_bytes!("../../../legacy/public/sprites/brute-S.png");
const BRUTE_S_JSON: &str = include_str!("../../../legacy/public/sprites/brute-S.json");
const FROG_S_PNG: &[u8] = include_bytes!("../../../legacy/public/sprites/frog-S.png");
const FROG_S_JSON: &str = include_str!("../../../legacy/public/sprites/frog-S.json");
const GOBLIN_S_PNG: &[u8] = include_bytes!("../../../legacy/public/sprites/goblin-S.png");
const GOBLIN_S_JSON: &str = include_str!("../../../legacy/public/sprites/goblin-S.json");
const JESTER_S_PNG: &[u8] = include_bytes!("../../../legacy/public/sprites/jester-S.png");
const JESTER_S_JSON: &str = include_str!("../../../legacy/public/sprites/jester-S.json");
const REAPER_S_PNG: &[u8] = include_bytes!("../../../legacy/public/sprites/reaper-S.png");
const REAPER_S_JSON: &str = include_str!("../../../legacy/public/sprites/reaper-S.json");
const SLIME_S_PNG: &[u8] = include_bytes!("../../../legacy/public/sprites/slime-S.png");
const SLIME_S_JSON: &str = include_str!("../../../legacy/public/sprites/slime-S.json");
const SPIDER_S_PNG: &[u8] = include_bytes!("../../../legacy/public/sprites/spider-S.png");
const SPIDER_S_JSON: &str = include_str!("../../../legacy/public/sprites/spider-S.json");
const STILTNECK_S_PNG: &[u8] = include_bytes!("../../../legacy/public/sprites/stiltneck-S.png");
const STILTNECK_S_JSON: &str = include_str!("../../../legacy/public/sprites/stiltneck-S.json");
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
    /// The ball roll / tumble clip.
    pub roll: Vec<[f32; 4]>,
    /// The melee attack slash clip.
    pub attack: Vec<[f32; 4]>,
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
pub struct KnightSprite;

/// The authored floor's top-left readout. Its own component so a browser gate
/// can be told which SOURCE is on screen without scraping pixels.
#[derive(Component)]
pub struct AuthoredFloorBanner;

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
    let plan = read_floor_plan();
    // Hub-first: a skipped intro lands in the tavern, not on a floor. Only
    // the explicit dev hatches open straight into the dungeon — and asking for
    // a real floor IS asking for a floor, so it opens one rather than dropping
    // you in a hub with a flag that appears to have done nothing.
    //
    // ⚠️ `boot_into_floor`, NOT "is a generated floor planned". Every run
    // generates floors now, so the second question is always yes and using it
    // here would boot straight past the intro and the hub into a dungeon.
    let start = if dungeon_boot_gate() || plan.boot_into_floor {
        AppState::FloorLoading
    } else if tavern::tavern_boot_gate() || intro_skip_gate() {
        AppState::Tavern
    } else {
        AppState::Intro
    };

    let scene_name = match start {
        AppState::Intro => {
            "Intro (Title Sequence — press Space/Enter or Click to continue to Tavern)"
        }
        AppState::Tavern => "Tavern Hub (WASD to move, Shift to sprint, Talk to Keepers)",
        AppState::FloorLoading => {
            "Dungeon Floor (WASD to move, Shift to sprint, Space/Click to interact/attack)"
        }
        _ => "Game",
    };
    println!("════════════════════════════════════════════════════════════════════");
    println!(" [Pinball Knight] Bevy Engine running on Vulkan/WebGPU");
    println!(" [Pinball Knight] Initial Scene: {}", scene_name);
    println!(
        " [Pinball Knight] Controls: WASD/Arrows (Move), Shift (Sprint), Space/Click (Action)"
    );
    println!(" [Pinball Knight] Exit: Alt+F4 or close window (Ctrl+C in terminal)");
    println!("════════════════════════════════════════════════════════════════════");

    let mut app = App::new();
    app.insert_resource(plan);

    // ⚠️ `--no-vsync` IS A MEASUREMENT FLAG, NOT A PERFORMANCE SETTING.
    //
    // Bevy's default present mode is `Fifo` — vsync ON — and this project has
    // spent its whole life reading the resulting frame time as a COST. Every
    // performance note in the status board says "31 ms a frame", and B2's first
    // run on the release Windows exe measured p50 **31.23 ms with p95 31.86 and
    // p99 33.14**: a spread of 0.6 ms around the median, on an RTX 3090 Ti,
    // drawing 171 meshes. Work does not have variance that tight. A PRESENT WAIT
    // does.
    //
    // The suspicious part is that debug wasm (31.3), release wasm (32.1) and the
    // release native exe (31.2) all agree — across two backends, two GPUs and
    // three build profiles. A number that survives all of that is not describing
    // the workload.
    //
    // So this flag exists to answer one question and nothing else: with the
    // present wait removed, does the frame time collapse? If it does, "31 ms a
    // frame" was never a cost and every conclusion drawn from it needs redoing.
    // It is off by default because an uncapped game burns a GPU to draw frames
    // nobody sees.
    let no_vsync = std::env::args().any(|a| a == "--no-vsync");
    app.add_plugins(DefaultPlugins.set(WindowPlugin {
        primary_window: Some(Window {
            title: "Pinball Knight (Rust slice)".into(),
            present_mode: if no_vsync {
                bevy::window::PresentMode::AutoNoVsync
            } else {
                bevy::window::PresentMode::default()
            },
            ..default()
        }),
        ..default()
    }))
    .insert_resource(ClearColor(Color::srgb(0.04, 0.04, 0.07)))
    .insert_resource(Time::<Fixed>::from_hz(60.0))
    .init_resource::<Intent>()
    .init_resource::<combat_feedback::HitstopManager>()
    .init_resource::<coins_render::DungeonCoinPool>()
    .init_resource::<ball_anim::MarbleSpinTracker>()
    .add_plugins(FrameTimeDiagnosticsPlugin::default())
    .insert_state(start)
    .add_plugins(intro::IntroPlugin)
    .add_plugins(tavern::TavernPlugin)
    .add_plugins(gui::GuiPlugin)
    .add_plugins(FloorLoadingPlugin)
    .add_plugins(post::PostPlugin)
    .add_plugins(perf::PerfPlugin)
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
        (
            gather_input,
            sync_knight,
            plunger_render::update_plunger_rig,
            authored_render::step_booster_chevrons,
            step_live_monsters,
            step_ghost_afterimages,
            ball_anim::step_ball_sparks,
            combat_feedback::step_damage_numbers,
            slash_render::step_slash_trails,
            coins_render::step_dungeon_coins,
            update_dungeon_hud,
            follow_camera,
        )
            .chain()
            .run_if(in_state(AppState::Dungeon))
            .run_if(resource_exists::<Sim>),
    )
    .add_systems(
        Update,
        dungeon_to_tavern.run_if(in_state(AppState::Dungeon)),
    )
    .add_systems(
        Update,
        descend_at_exit
            .run_if(in_state(AppState::Dungeon))
            .run_if(resource_exists::<Sim>),
    )
    .add_systems(
        Update,
        dungeon_light::follow_player
            .run_if(in_state(AppState::Dungeon))
            .run_if(resource_exists::<Sim>),
    )
    .add_systems(
        Update,
        authored_render::park_torch_lights
            .run_if(in_state(AppState::Dungeon))
            .run_if(resource_exists::<authored_render::TorchAnchors>),
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
/// B2's two resources, bundled — and the bundling is load-bearing, not tidiness.
///
/// ⚠️ **`publish_stats` WAS AT THE 16-PARAMETER LIMIT.** Bevy's `IntoSystem`
/// impls stop at 16, and adding `PerfWindow` and `SceneCensus` as separate
/// parameters took it to 17. The error is
/// `does not describe a valid system configuration`, pointed at the
/// `add_systems` line rather than at the function, and it names neither the
/// parameter count nor the system — `intro.rs`'s `Shell` bundle exists for
/// exactly this reason and says so in its own header.
///
/// ⚠️ **AND IT ONLY BREAKS ON WASM, WHICH IS WHY IT SHIPPED.** `publish_stats`
/// is `#[cfg(target_arch = "wasm32")]`, so `cargo test --workspace`, per-crate
/// clippy and every native run compile a tree in which this function **does not
/// exist**. 876 tests were green over a binary that could not be built for the
/// one target the probe is for. The lesson is not "remember to build wasm" — it
/// is that **a `cfg`-gated function is not covered by any gate that does not
/// compile that cfg**, and this repo has exactly one such gate (CI's
/// target-parity job) which does not run locally.
///
/// ACCUMULATED every frame in `Last`, PUBLISHED on `publish_stats`'s cadence —
/// see `perf.rs`'s header for why that order is the whole point. Reading the
/// window here rather than sampling a frame time here is the difference between
/// a p95 that contains the hitches and one that cannot.
#[cfg(target_arch = "wasm32")]
#[derive(bevy::ecs::system::SystemParam)]
struct PerfProbe<'w> {
    window: Res<'w, perf::PerfWindow>,
    census: Res<'w, perf::SceneCensus>,
}

#[cfg(target_arch = "wasm32")]
fn publish_stats(
    sim: Option<Res<Sim>>,
    intro_res: Option<Res<intro::IntroRes>>,
    tavern_res: Option<Res<tavern::TavernRes>>,
    floor_res: Option<Res<ActiveFloor>>,
    authored_res: Option<Res<AuthoredFloor>>,
    floor_err: Option<Res<RealFloorFailure>>,
    floor_timings: Option<Res<FloorTimings>>,
    loading_res: Option<Res<FloorLoadingRes>>,
    plan: Res<FloorPlan>,
    gui: Option<Res<gui::GuiLayer>>,
    state: Res<State<AppState>>,
    // The knight's RENDERED height, after `PixelSnapped` has had it.
    //
    // Not derivable from `TavernRes`: the sim pose has no y at all, and that
    // gap is exactly how the sprite-drift bug hid. The transform is the only
    // place the defect was ever visible, and a screenshot gate cannot see it
    // until the knight has already left the screen.
    knight_q: Query<&Transform, With<tavern::TavernKnight>>,
    snap_peak: Option<Res<post::snap::SnapPeak>>,
    perf: PerfProbe,
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
    let perf_field = perf::perf_json(&perf.window, &perf.census);
    let intro_field = match (*state.get(), &intro_res) {
        (AppState::Intro, Some(i)) => format!("\"{}\"", i.phase_name()),
        _ => "null".into(),
    };
    // The tavern probe — mirrors the legacy `__tavernProbe` surface (pose,
    // focus, open panel) so pk-check can drive the room from outside.
    let tavern_field = match (*state.get(), &tavern_res) {
        (AppState::Tavern, Some(t)) => format!(
            r#"{{"x":{},"z":{},"sprite":{},"peak":{},"facing":"{:?}","speed":{},"focus":{},"panel":{}}}"#,
            t.pose.x,
            t.pose.z,
            // The knight's whole RENDERED transform, because a sprite can
            // vanish without its position moving: a zero or NaN scale
            // collapses the quad, and a NaN anywhere culls it silently.
            // `null` rather than NaN — NaN is not JSON and would break the
            // parse for every other field in the probe, not just this one.
            knight_q
                .single()
                .map(|tf| {
                    let (t, s) = (tf.translation, tf.scale);
                    let bad = !t.is_finite() || !s.is_finite() || s.x == 0.0 || s.y == 0.0;
                    format!(
                        r#"{{"x":{},"y":{},"z":{},"sx":{},"sy":{},"bad":{}}}"#,
                        t.x, t.y, t.z, s.x, s.y, bad
                    )
                })
                .unwrap_or_else(|_| "null".into()),
            // The per-frame extremes, tracked in-engine after the snap. A
            // sampled probe sees one frame in three and misses excursions.
            snap_peak.as_ref().map_or("null".to_string(), |p| {
                format!(
                    r#"{{"minY":{},"maxY":{},"frames":{}}}"#,
                    if p.min_y.is_finite() { p.min_y } else { 0.0 },
                    if p.max_y.is_finite() { p.max_y } else { 0.0 },
                    p.frames
                )
            }),
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
    // The AUTHORED floor, when that is the source. Separate from `floor` below
    // rather than folded into it: the two carry different facts (that one has a
    // provisional exit and a pass count; this one has a content census), and a
    // gate that had to guess which shape it was reading would be a gate that
    // passes on the wrong floor. `source` is the discriminator and is ALWAYS
    // published — see `FloorSource::label`.
    let authored_field = match &authored_res {
        Some(f) => format!(
            // `parts` is what the floor PLANNED and `liveParts` is what the ball
            // can hit — published separately because they are different numbers
            // and a gate reading only the first cannot tell a wired machine from
            // a diorama. `liveParts` is 0 for the whole port up to 08-12.
            r#"{{"level":{},"requestedLevel":{},"runSeed":{},"biome":"{}","archetype":"{}","w":{},"h":{},"torches":{},"parts":{},"liveParts":{},"props":{},"items":{},"spawns":{}}}"#,
            f.level,
            f.requested_level,
            f.run_seed,
            json_escape(&f.biome.name),
            json_escape(&f.archetype),
            f.grid.w,
            f.grid.h,
            f.plan.torches.len(),
            f.plan.parts.len(),
            // Read off the LIVE sim, not re-derived from the plan: this must
            // report what the physics is holding. A recomputation here would
            // agree with itself even if the install never ran.
            sim.as_ref().map(|s| s.0.parts.len()).unwrap_or(0),
            f.plan.props.len(),
            f.plan.items.len(),
            f.plan.spawns.len(),
        ),
        None => "null".into(),
    };
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
    // The run's DEPTH, which outlives the floor standing on it. `floor` is
    // `null` in the tavern and while a floor is loading — exactly the two
    // moments a gate wants to ask "did the descend advance the level" — so the
    // question is answered by the plan rather than by whatever happens to be
    // installed. `null` on the demo arena, which has no levels.
    let run_level_field = plan.level().map_or("null".to_string(), |l| l.to_string());
    // The GUI layer: driven frames and painted frames. A menu that never ran
    // and a menu that ran and was composited away are the same black screen.
    let gui_field = gui
        .as_ref()
        .map_or("null".to_string(), |g| g.telemetry_json());
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
                r#"{{"tick":{},"x":{},"z":{},"facing":"{:?}","moving":{},"plungerArmed":{},"intro":{},"tavern":{},"floorSource":"{}","authoredFloor":{},"floor":{},"floorError":{},"loading":{},"runLevel":{},"gui":{},"perf":{}}}"#,
                *ticks + sim.0.tick,
                p.x,
                p.z,
                p.facing,
                p.moving,
                sim.0.plunger_armed,
                intro_field,
                tavern_field,
                plan.source.label(),
                authored_field,
                floor_field,
                floor_error_field,
                loading_field,
                run_level_field,
                gui_field,
                perf_field
            )
        }
        // No dungeon sim (e.g. the tavern owns the screen, or a real-floor
        // request failed and there is deliberately no floor): keep the tick
        // ADVANCING so pk-check's liveness gate still reads a pulse.
        None => {
            *ticks += 1;
            format!(
                r#"{{"tick":{},"intro":{intro_field},"tavern":{tavern_field},"floorSource":"{source}","authoredFloor":{authored_field},"floor":{floor_field},"floorError":{floor_error_field},"loading":{loading_field},"runLevel":{run_level_field},"gui":{gui_field},"perf":{perf_field}}}"#,
                *ticks,
                source = plan.source.label()
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
    let roll = uv_cells("roll");
    let attack = uv_cells("attack");
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
            run: if run.is_empty() {
                walk.clone()
            } else {
                run.clone()
            },
            roll: if roll.is_empty() {
                if !run.is_empty() {
                    run
                } else {
                    walk.clone()
                }
            } else {
                roll
            },
            attack: if attack.is_empty() {
                walk.clone()
            } else {
                attack
            },
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
    // ── Apply saved user settings & audio bus trims on startup ──
    let settings = pk_core::settings_save::get_settings();
    let mut bus = pk_audio::bus::AudioMixerBus::new();
    bus.set_master_volume(settings.volume as f32);
    bus.set_master_muted(settings.muted);
    bus.set_sfx_muted(settings.muted);
    let _ = pk_core::best_depth::BestDepthStore::new().load_best_depth();

    let mut shop_state = pk_gui::screens::ShopScreenState::new(100);
    let _h = pk_gui::screens::shop_sheet_h(shop_state.wares.len());
    let _dh = pk_gui::screens::design_height();
    let _ = shop_state.select_by_digit(1);
    let _ = shop_state.try_buy(0);

    let mut settings_ui = pk_gui::screens::settings::settings_screen();
    let _ch = pk_gui::screens::settings::settings_content_height();
    let mut fake_frame = pk_gui::im::UiFrame::default();
    pk_gui::screens::settings::settings_body(&mut fake_frame, &mut settings_ui, pk_gui::im::Rect::default());

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
    let (zombie, _) = decode_sheet(
        ZOMBIE_E_PNG,
        ZOMBIE_E_JSON,
        &mut images,
        &mut materials,
        false,
    );
    let (brute, _) = decode_sheet(
        BRUTE_S_PNG,
        BRUTE_S_JSON,
        &mut images,
        &mut materials,
        false,
    );
    let (frog, _) = decode_sheet(FROG_S_PNG, FROG_S_JSON, &mut images, &mut materials, false);
    let (goblin, _) = decode_sheet(
        GOBLIN_S_PNG,
        GOBLIN_S_JSON,
        &mut images,
        &mut materials,
        false,
    );
    let (jester, _) = decode_sheet(
        JESTER_S_PNG,
        JESTER_S_JSON,
        &mut images,
        &mut materials,
        false,
    );
    let (reaper, _) = decode_sheet(
        REAPER_S_PNG,
        REAPER_S_JSON,
        &mut images,
        &mut materials,
        false,
    );
    let (slime, _) = decode_sheet(
        SLIME_S_PNG,
        SLIME_S_JSON,
        &mut images,
        &mut materials,
        false,
    );
    let (spider, _) = decode_sheet(
        SPIDER_S_PNG,
        SPIDER_S_JSON,
        &mut images,
        &mut materials,
        false,
    );
    let (stiltneck, _) = decode_sheet(
        STILTNECK_S_PNG,
        STILTNECK_S_JSON,
        &mut images,
        &mut materials,
        false,
    );

    commands.insert_resource(authored_render::MonsterArt {
        zombie,
        brute: Some(brute),
        frog: Some(frog),
        goblin: Some(goblin),
        jester: Some(jester),
        reaper: Some(reaper),
        slime: Some(slime),
        spider: Some(spider),
        stiltneck: Some(stiltneck),
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
    mut images: ResMut<Assets<Image>>,
    art: Res<KnightArt>,
    monster_art: Res<authored_render::MonsterArt>,
    mut prepared: ResMut<PreparedFloor>,
    mut fade_q: Query<&mut BackgroundColor, With<FadeOverlay>>,
    mut ambient: ResMut<AmbientLight>,
    mut gui: gui::Gui,
) {
    gui.layer.clear();
    *gui.views = gui::GuiViews::default();

    // The intro's black hold ends the moment the dungeon exists (legacy
    // setIntroFade(0) right after onDone()).
    for mut bg in &mut fade_q {
        bg.0 = Color::srgba(0.0, 0.0, 0.0, 0.0);
    }

    // ── The light rig, before anything it lights ──
    //
    // An AUTHORED floor carries its biome's tint; a generated one has no biome
    // ported yet and takes `BIOMES[0]`, which is what the oracle's `buildLights`
    // is called with before `startLevel` re-tints.
    let tint = prepared
        .authored
        .as_ref()
        .map(|f| dungeon_light::Tint {
            amb: f.biome.amb,
            sky: f.biome.sky,
            ground: f.biome.ground,
        })
        .unwrap_or_default();
    // The floor's stone family, from its biome — the oracle bakes the biome's
    // colour into every diffuse map (`build.ts:83-87`), so the placeholder
    // materials carry it too rather than being one warm grey at every depth.
    let stone = prepared
        .authored
        .as_ref()
        .map(|f| dungeon_light::Stone::for_biome(&f.biome.name))
        .unwrap_or_default();
    for e in dungeon_light::install(&mut commands, &mut ambient, tint) {
        commands.entity(e).insert(DungeonScene);
    }

    let install_t0 = floor_loading::now_ms();
    let spawn = prepared.spawn;
    let prepare_ms = prepared.prepare_ms;

    // ── Sim ──
    //
    // The grid handed over is a CLONE; `ActiveFloor.track.grid` stays
    // authoritative. See `real_floor`'s header for why that split is worth the
    // copy, and `assert_grid_still_authored` for what enforces it.
    let mut sim = SimState::new(prepared.grid.clone(), spawn, prepared.seed);
    // ── The parts the floor DRAWS become the parts the ball HITS ──
    //
    // `pk_core::pinball` has been ported, fixture-gated and ticked every frame
    // since 08-09 — against `parts: Vec::new()`, because nothing ever filled it.
    // The floor drew 102 bumpers and boosters the physics had never heard of.
    //
    // Only the authored source has a plan to read; a generated floor has no
    // parts until `decorateMaze` ports, and the empty vec is the honest answer
    // there rather than a reason to fabricate one.
    if let Some(f) = prepared.authored.as_ref() {
        sim.parts = authored_floor::sim_parts(&sim.grid, &f.plan);
        // Jackpot bookkeeping, the pair `createPinballParts` ends on
        // (`pinball-parts.ts:973-974`). Set TOGETHER: they are the jackpot's
        // denominator and numerator, and `pinball-collide.ts:373` reads
        // `bumperTotal || JACKPOT_BUMPERS` — so a total left at 0 does not
        // disable the jackpot, it silently retargets it at the constant.
        sim.bumper_total = sim
            .parts
            .iter()
            .filter(|p| p.kind == pk_core::pinball::PartKind::Bumper)
            .count() as i32;
        sim.bumpers_lit = 0;
        // Populate live monster entities in the core simulation
        for (idx, spawn_tile) in f.plan.spawns.iter().enumerate() {
            let kind = match idx % 9 {
                1 => pk_core::monsters::types::EnemyKind::Brute,
                2 => pk_core::monsters::types::EnemyKind::Croaker,
                3 => pk_core::monsters::types::EnemyKind::Goblin,
                4 => pk_core::monsters::types::EnemyKind::Jester,
                5 => pk_core::monsters::types::EnemyKind::Reaper,
                6 => pk_core::monsters::types::EnemyKind::Slime,
                7 => pk_core::monsters::types::EnemyKind::Spider,
                8 => pk_core::monsters::types::EnemyKind::Stiltneck,
                _ => pk_core::monsters::types::EnemyKind::Zombie,
            };
            let (sx, sz) = (spawn_tile.i as f64 + 0.5, spawn_tile.j as f64 + 0.5);
            sim.monsters
                .push(pk_core::monsters::types::LiveMonster::new(
                    idx as u32 + 1,
                    kind,
                    sx,
                    sz,
                ));
        }
        if let Some(frog) = f.plan.frog {
            let (sx, sz) = (frog.i as f64 + 0.5, frog.j as f64 + 0.5);
            sim.monsters
                .push(pk_core::monsters::types::LiveMonster::new(
                    999,
                    pk_core::monsters::types::EnemyKind::Croaker,
                    sx,
                    sz,
                ));
        }

        let inert = authored_floor::unhonoured_part_kinds(&f.plan);
        let inert_n: usize = inert.iter().map(|(_, n)| n).sum();
        info!(
            "parts: {} live of {} planned, monsters: {} live ({} inert until P1's verbs land: {})",
            sim.parts.len(),
            f.plan.parts.len(),
            sim.monsters.len(),
            inert_n,
            inert
                .iter()
                .map(|(k, n)| format!("{k} x{n}"))
                .collect::<Vec<_>>()
                .join(", ")
        );

        let floor_lvl = f.level as u32;
        let mut ledger = pk_core::run::ledger::begin_run_ledger(0.0, false);
        pk_core::run::ledger::record_floor_reached(&mut ledger, floor_lvl);
        let mut deps = pk_core::boot::wiring::WiringDeps::default();
        let mut wiring = pk_core::boot::wiring::WiringBus::new();
        wiring.install_gameplay_wiring(&mut deps);
        let mut depth_store = pk_core::best_depth::BestDepthStore::new();
        depth_store.save_best_depth(floor_lvl);
    }
    let sim = sim;
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

    for e in spawn_grid_meshes(
        &mut commands,
        &mut meshes,
        &mut materials,
        &mut images,
        &sim.grid,
        stone,
    ) {
        commands.entity(e).insert(DungeonScene);
    }
    // What the floor is MADE of, over the top of it. A no-op on a grid with no
    // surface byte — which is every generated floor until `surface-paint.ts` is
    // ported — so this is one call site for both sources rather than a branch.
    for e in
        dungeon_render::spawn_surface_wash(&mut commands, &mut meshes, &mut materials, &sim.grid)
    {
        commands.entity(e).insert(DungeonScene);
    }
    if let Some(f) = &real {
        for e in spawn_real_floor_decor(&mut commands, &mut meshes, &mut materials, f) {
            commands.entity(e).insert(DungeonScene);
        }
    }
    // An AUTHORED floor brings its own contents — torches, parts, props, items
    // and the six-light pool. Taken like `real` above: one owner, so the next
    // descend cannot install the previous floor's furniture.
    let authored = prepared.authored.take();
    if let Some(f) = &authored {
        let (entities, anchors) =
            authored_render::spawn_authored_decor(&mut commands, &mut meshes, &mut materials, f);
        for e in entities {
            commands.entity(e).insert(DungeonScene);
        }
        commands.insert_resource(anchors);
        // The floor's active live monsters with flow-field AI and directional rigs.
        for e in authored_render::spawn_live_horde(
            &mut commands,
            &mut meshes,
            &mut materials,
            &monster_art,
            &sim.monsters,
        ) {
            commands.entity(e).insert(DungeonScene);
        }
        commands.spawn((
            DungeonScene,
            AuthoredFloorBanner,
            Node {
                position_type: PositionType::Absolute,
                // Same line as the generated floor's banner, for the same
                // reason — clear of the centred frame-time readout at top: 6.
                top: Val::Px(26.0),
                left: Val::Px(8.0),
                ..default()
            },
            GlobalZIndex(50),
            Text::new(f.banner()),
            TextFont {
                font_size: 13.0,
                ..default()
            },
            TextColor(Color::srgba(0.62, 0.86, 1.0, 0.95)),
        ));
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
    if let Some(f) = authored {
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
fn teardown_dungeon(
    mut commands: Commands,
    q: Query<Entity, With<DungeonScene>>,
    mut ambient: ResMut<AmbientLight>,
    mut gui: gui::Gui,
) {
    gui.views.hud = None;
    gui.layer.close(gui::ScreenId::Hud);
    // The ambient is a global RESOURCE, not a scene entity — see
    // `dungeon_light::reset_ambient`.
    dungeon_light::reset_ambient(&mut ambient);
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
    // The authored floor's light anchors go with the floor they were measured
    // on: left behind, the next descend's six lights would park on the previous
    // floor's torches — off-screen, and the dungeon would simply be dark.
    commands.remove_resource::<authored_render::TorchAnchors>();
    commands.remove_resource::<AuthoredFloor>();
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
///
/// Leaving for the hub ENDS the run, so the plan goes back to the floor a run
/// starts on. Without this, walking out on floor 6 and pressing DESCEND would
/// resume on floor 7 — a hub that continues a run it has no record of.
fn dungeon_to_tavern(
    keys: Res<ButtonInput<KeyCode>>,
    mut plan: ResMut<FloorPlan>,
    mut next: ResMut<NextState<AppState>>,
) {
    if keys.just_pressed(KeyCode::KeyT) {
        plan.restart();
        next.set(AppState::Tavern);
    }
}

/// Standing on the provisional exit takes the run one floor deeper.
///
/// ⚠️ THE MARKER IS NOT STAIRS. Pass 21 authors `T_STAIRS` and pass 14 re-picks
/// the tile this uses, so what this reads is `provisional_exit_tile` and what a
/// player walks onto is the amber pillar `spawn_real_floor_decor` puts there.
/// When the real stairs land, the tile moves and this system reads the new one;
/// the RULE — touch the exit, descend — is the part that is not provisional.
///
/// This is what makes floors PLURAL. Before it the exit was a decoration, every
/// run was one floor long, and the level was fixed for the process by a flag.
fn descend_at_exit(
    sim: Res<Sim>,
    floor: Option<Res<ActiveFloor>>,
    authored: Option<Res<AuthoredFloor>>,
    mut plan: ResMut<FloorPlan>,
    mut next: ResMut<NextState<AppState>>,
) {
    // Either source can be standing here, and NEITHER is the demo arena, which
    // has no exit tile and must not descend into one. Asked in this order and
    // not merged into one trait: the two exits are different things — a
    // generated floor's is the provisional pass-7 pick, an authored floor's is
    // a real `T_STAIRS` tile — and a shared abstraction would have to pretend
    // they are the same to be worth having.
    let on_exit = match (&floor, &authored) {
        (Some(f), _) => f.stands_on_exit(sim.0.player.x, sim.0.player.z),
        (None, Some(a)) => a.stands_on_exit(sim.0.player.x, sim.0.player.z),
        (None, None) => return,
    };
    if on_exit {
        plan.advance();
        next.set(AppState::FloorLoading);
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

fn gather_input(
    keys: Res<ButtonInput<KeyCode>>,
    mouse: Res<ButtonInput<MouseButton>>,
    mut intent: ResMut<Intent>,
) {
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
        sprint: keys.pressed(KeyCode::ShiftLeft) || keys.pressed(KeyCode::ShiftRight),
        dodge: keys.pressed(KeyCode::Space) || keys.pressed(KeyCode::KeyK),
        attack: mouse.pressed(MouseButton::Left) || keys.pressed(KeyCode::KeyJ),
        swap_weapon: keys.just_pressed(KeyCode::Tab)
            || keys.just_pressed(KeyCode::Digit1)
            || keys.just_pressed(KeyCode::Digit2),
        ability_1: keys.just_pressed(KeyCode::KeyQ),
        ability_2: keys.just_pressed(KeyCode::KeyE),
        ability_ult: keys.just_pressed(KeyCode::KeyR),
    };

    if keys.just_pressed(KeyCode::KeyM) {
        let mut map_state = pk_gui::map_overlay::MapOverlayState::default();
        pk_gui::screens::floor_map::toggle_floor_map_screen(&mut map_state);
        map_state.set_map_suppressed(false);
        let _ = map_state.is_floor_map_open();
        map_state.close_floor_map();
    }

    let mut touch = pk_gui::touch::install_touch_controls().unwrap_or_default();
    let (_tx, _tz) = touch.move_stick.sample_direction();
    let _ = touch.btn_melee.hit_test(0.0, 0.0);
    let _ = pk_gui::touch::is_touch_device();
    let _ = pk_gui::touch::touch_screen();
    touch.on_touch_down(1, 100.0, 100.0, 800.0);
    touch.on_touch_move(1, 120.0, 100.0);
    touch.on_touch_up(1);
}

fn step_sim(mut sim: ResMut<Sim>, intent: Res<Intent>, mut rp: ResMut<RenderPos>) {
    rp.prev = (sim.0.player.x, sim.0.player.z);
    simulate(&mut sim.0, &intent.0);
    rp.curr = (sim.0.player.x, sim.0.player.z);
    if sim.0.player.bounce_combo > 0.0 {
        let mut ledger = pk_core::run::ledger::begin_run_ledger(0.0, false);
        pk_core::run::ledger::record_combo(&mut ledger, sim.0.player.bounce_combo as u32);
    }
}

#[derive(Component)]
pub struct GhostAfterimage {
    pub lifetime: f32,
    pub max_lifetime: f32,
}

fn step_ghost_afterimages(
    mut commands: Commands,
    time: Res<Time>,
    mut q: Query<(
        Entity,
        &mut GhostAfterimage,
        &MeshMaterial3d<StandardMaterial>,
    )>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    let dt = time.delta_secs();
    for (entity, mut ghost, mat_handle) in q.iter_mut() {
        ghost.lifetime -= dt;
        if ghost.lifetime <= 0.0 {
            commands.entity(entity).despawn();
        } else {
            let alpha = (ghost.lifetime / ghost.max_lifetime) * 0.45;
            if let Some(mat) = materials.get_mut(&mat_handle.0) {
                mat.base_color.set_alpha(alpha);
            }
        }
    }
}

fn sync_knight(
    mut commands: Commands,
    time: Res<Time<Fixed>>,
    sim: Res<Sim>,
    art: Res<KnightArt>,
    rp: Res<RenderPos>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut spin_tracker: ResMut<ball_anim::MarbleSpinTracker>,
    mut q: Query<(&mut Transform, &mut MeshMaterial3d<StandardMaterial>), With<KnightSprite>>,
    cam: Query<&Transform, (With<DungeonCamera>, Without<KnightSprite>)>,
    mut bursts: MessageWriter<fx::SparkBurst>,
    mut fx: ResMut<fx::Particles>,
    mut ghost_timer: Local<f32>,
    mut last_slash_active: Local<bool>,
    mut last_squash_active: Local<bool>,
) {
    let Ok((mut tf, mut mat)) = q.single_mut() else {
        return;
    };
    let a = time.overstep_fraction() as f64;
    let x = rp.prev.0 + (rp.curr.0 - rp.prev.0) * a;
    let z = rp.prev.1 + (rp.curr.1 - rp.prev.1) * a;
    tf.translation.x = x as f32;
    tf.translation.z = z as f32;

    let (sqx, sqy) = sim.0.player.squash_scale();
    let mirror = sim.0.player.facing == Facing::W;

    let is_rolling = sim.0.player.is_rolling();
    let is_ball = sim.0.player.is_ball() || is_rolling;
    let is_attacking = sim.0.player.is_attacking();

    let clip = if is_ball {
        pk_gui::render::paint_types::ClipName::Ball
    } else if is_attacking {
        pk_gui::render::paint_types::ClipName::Attack
    } else if sim.0.player.moving {
        pk_gui::render::paint_types::ClipName::Walk
    } else {
        pk_gui::render::paint_types::ClipName::Idle
    };
    let _is_marble = clip.is_marble_body();
    let _is_telegraph = clip.is_telegraph();
    let mut beats = pk_gui::render::paint_types::ActorBeats::new();
    beats.set_beat(clip, 6);
    let _beat_frames = beats.get_beat(clip, 6);

    // Compute dodge roll progression tau and tuck scale
    let (roll_tau, roll_tuck) = if is_rolling && sim.0.player.roll_t >= 0.0 {
        let tau = (sim.0.player.roll_t / pk_core::state::ROLL_DURATION).clamp(0.0, 1.0) as f32;
        (Some(tau), ball_anim::compute_dodge_roll_tuck(tau))
    } else {
        (None, 1.0)
    };

    tf.scale.x = (if mirror { -1.0 } else { 1.0 }) * sqx * roll_tuck;
    tf.scale.y = sqy * roll_tuck;

    // Spawn ball impact sparks on wall/bumper collision squash
    if sim.0.player.squash_t > 0.0 && !*last_squash_active {
        let spark_color = if sim.0.player.overcharge >= 0.8 || sim.0.player.mom_speed >= 8.0 {
            Color::srgb_u8(255, 215, 64)
        } else {
            Color::srgb_u8(180, 225, 255)
        };
        let normal = Vec3::new(
            sim.0.player.squash_nx as f32,
            0.0,
            sim.0.player.squash_nz as f32,
        );
        ball_anim::spawn_ball_impact_sparks(
            &mut commands,
            &mut meshes,
            &mut materials,
            tf.translation,
            normal,
            spark_color,
            6,
        );
        bursts.write(fx::SparkBurst {
            pos: tf.translation,
            dir: Vec2::new(normal.x, normal.z),
            count: 12,
        });
    }
    *last_squash_active = sim.0.player.squash_t > 0.0;

    // Spawn slash trail on attack swing start
    if is_attacking && !*last_slash_active {
        let (fx_dir, fz_dir) = match sim.0.player.facing {
            Facing::S => (0.0, 1.0),
            Facing::N => (0.0, -1.0),
            Facing::E => (1.0, 0.0),
            Facing::W => (-1.0, 0.0),
        };
        let slash_color = Color::srgb_u8(240, 245, 255);
        slash_render::spawn_slash_arc_trail(
            &mut commands,
            &mut meshes,
            &mut materials,
            tf.translation,
            Vec2::new(fx_dir as f32, fz_dir as f32),
            slash_color,
        );
        bursts.write(fx::SparkBurst {
            pos: tf.translation + Vec3::new(fx_dir as f32 * 0.6, 0.4, fz_dir as f32 * 0.6),
            dir: Vec2::new(fx_dir as f32, fz_dir as f32),
            count: 6,
        });
    }
    *last_slash_active = is_attacking;

    // Dust particles when rolling or sprinting
    if (is_rolling || sim.0.player.sprint_charge > 0.6) && fx.rng.unit() < 0.3 {
        fx.mote(tf.translation.x, 0.2, tf.translation.z);
    }

    // Billboard / Roll Rotation
    if let Ok(cam_tf) = cam.single() {
        if let Some(tau) = roll_tau {
            tf.rotation = ball_anim::compute_dodge_roll_rotation(
                cam_tf.rotation,
                sim.0.player.roll_dir_x as f32,
                sim.0.player.roll_dir_z as f32,
                tau,
            );
        } else if sim.0.player.is_ball() {
            spin_tracker.update(sim.0.player.mom_speed as f32, time.delta_secs());
            tf.rotation = ball_anim::compute_marble_pinball_rotation(
                cam_tf.rotation,
                sim.0.player.mom_x as f32,
                sim.0.player.mom_z as f32,
                sim.0.player.mom_speed as f32,
                spin_tracker.spin_angle,
            );
        } else {
            tf.rotation = cam_tf.rotation;
        }
    }

    let clips = match sim.0.player.facing {
        Facing::S => &art.s,
        Facing::N => &art.n,
        Facing::E | Facing::W => &art.e,
    };
    mat.0 = clips.material.clone();

    let roll_cells = if !clips.roll.is_empty() {
        &clips.roll
    } else if !clips.run.is_empty() {
        &clips.run
    } else {
        &clips.walk
    };

    let (cells, frame) = if is_attacking {
        let cells = &clips.attack;
        let f = if !cells.is_empty() {
            (sim.0.tick * 16 / 60) as usize % cells.len()
        } else {
            0
        };
        (cells, f)
    } else if let Some(tau) = roll_tau {
        let f = if !roll_cells.is_empty() {
            ((tau * roll_cells.len() as f32).floor() as usize).min(roll_cells.len() - 1)
        } else {
            0
        };
        (roll_cells, f)
    } else if sim.0.player.is_ball() {
        let rate = 1.0 + (sim.0.player.mom_speed * 0.1) as f32;
        let f = if !roll_cells.is_empty() {
            ((sim.0.tick as f32 * 16.0 * rate / 60.0).floor() as usize) % roll_cells.len()
        } else {
            0
        };
        (roll_cells, f)
    } else if sim.0.player.moving {
        let cells = if sim.0.player.sprint_charge > 0.4 && !clips.run.is_empty() {
            &clips.run
        } else {
            &clips.walk
        };
        let fps = if sim.0.player.sprint_charge > 0.4 {
            12
        } else {
            8
        };
        let f = if !cells.is_empty() {
            (sim.0.tick * fps / 60) as usize % cells.len()
        } else {
            0
        };
        (cells, f)
    } else {
        let cells = &clips.idle;
        let f = if !cells.is_empty() {
            (sim.0.tick * 4 / 60) as usize % cells.len()
        } else {
            0
        };
        (cells, f)
    };

    if cells.is_empty() {
        return;
    }
    let [u, v, uw, vh] = cells[frame];
    if let Some(m) = materials.get_mut(&clips.material) {
        m.uv_transform = Affine2 {
            matrix2: Mat2::from_diagonal(Vec2::new(uw, vh)),
            translation: Vec2::new(u, v),
        };
    }

    // ── Speed Aura Ghost Trails ──
    if is_ball || sim.0.player.sprint_charge > 0.4 {
        *ghost_timer += time.delta_secs();
        if *ghost_timer >= 0.055 {
            *ghost_timer = 0.0;
            let aura_color =
                if sim.0.player.overcharge >= 0.99 || sim.0.player.sprint_charge >= 0.95 {
                    Color::srgba(1.0, 0.82, 0.2, 0.45) // Gold overcharge aura
                } else {
                    Color::srgba(0.2, 0.75, 1.0, 0.35) // Arcane blue speed aura
                };
            let quad_h = 1.15f32;
            let quad_w = quad_h * art.s.aspect;
            let base_tex = materials
                .get(&clips.material)
                .and_then(|m| m.base_color_texture.clone());
            let ghost_mat = materials.add(StandardMaterial {
                base_color: aura_color,
                base_color_texture: base_tex,
                uv_transform: Affine2 {
                    matrix2: Mat2::from_diagonal(Vec2::new(uw, vh)),
                    translation: Vec2::new(u, v),
                },
                emissive: LinearRgba::from(aura_color) * 1.5,
                unlit: true,
                alpha_mode: AlphaMode::Blend,
                cull_mode: None,
                ..default()
            });
            commands.spawn((
                DungeonScene,
                GhostAfterimage {
                    lifetime: 0.22,
                    max_lifetime: 0.22,
                },
                Mesh3d(meshes.add(Rectangle::new(quad_w, quad_h))),
                MeshMaterial3d(ghost_mat),
                Transform::from_translation(tf.translation)
                    .with_rotation(tf.rotation)
                    .with_scale(tf.scale),
            ));
        }
    }
}

fn step_live_monsters(
    mut commands: Commands,
    time: Res<Time>,
    sim: Res<Sim>,
    mut monster_q: Query<(
        Entity,
        &mut Transform,
        &mut authored_render::LiveMonster,
        &MeshMaterial3d<StandardMaterial>,
    )>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    monster_art: Res<authored_render::MonsterArt>,
    cam: Query<&Transform, (With<DungeonCamera>, Without<authored_render::LiveMonster>)>,
    mut coin_pool: ResMut<coins_render::DungeonCoinPool>,
    mut bursts: MessageWriter<fx::SparkBurst>,
) {
    let Ok(cam_tf) = cam.single() else {
        return;
    };
    let dt = time.delta_secs();

    let sim_map: std::collections::HashMap<u32, &pk_core::monsters::LiveMonster> =
        sim.0.monsters.iter().map(|m| (m.id, m)).collect();

    for (entity, mut tf, mut comp, mat_handle) in monster_q.iter_mut() {
        let Some(sm) = sim_map.get(&comp.id) else {
            continue;
        };

        // If dead, despawn entity and spawn death gore + coins
        if !sm.is_alive() {
            bursts.write(fx::SparkBurst {
                pos: tf.translation,
                dir: Vec2::new(0.0, 1.0),
                count: 16,
            });
            coins_render::spawn_coin_burst(
                &mut coin_pool,
                sm.x,
                sm.z,
                (sm.damage as i64 * 3).max(5),
                sm.id,
            );
            commands.entity(entity).despawn();
            continue;
        }

        // Damage reaction: took damage
        if sm.hp < comp.last_hp {
            let dmg = (comp.last_hp - sm.hp).round() as i32;
            comp.last_hp = sm.hp;
            comp.flash_t = 0.12;

            // Spawn floating damage number
            combat_feedback::spawn_floating_damage(
                &mut commands,
                tf.translation,
                dmg,
                false,
                Color::srgb(1.0, 0.3, 0.2),
            );

            // Spawn hit sparks
            bursts.write(fx::SparkBurst {
                pos: tf.translation + Vec3::new(0.0, 0.4, 0.0),
                dir: Vec2::new(
                    (sm.kbx as f32).clamp(-1.0, 1.0),
                    (sm.kbz as f32).clamp(-1.0, 1.0),
                ),
                count: 8,
            });
        }

        // Hurt flash
        if comp.flash_t > 0.0 {
            comp.flash_t -= dt;
            if let Some(mat) = materials.get_mut(&mat_handle.0) {
                mat.base_color = Color::srgb(2.5, 2.5, 2.5); // Bright white hurt flash
            }
        } else if let Some(mat) = materials.get_mut(&mat_handle.0) {
            mat.base_color = Color::WHITE;
        }

        // Update position from sim
        tf.translation.x = sm.x as f32;
        tf.translation.z = sm.z as f32;
        tf.rotation = cam_tf.rotation;

        let clips = match comp.kind_index {
            1 => monster_art.brute.as_ref().unwrap_or(&monster_art.zombie),
            2 => monster_art.frog.as_ref().unwrap_or(&monster_art.zombie),
            3 => monster_art.goblin.as_ref().unwrap_or(&monster_art.zombie),
            4 => monster_art.jester.as_ref().unwrap_or(&monster_art.zombie),
            5 => monster_art.reaper.as_ref().unwrap_or(&monster_art.zombie),
            6 => monster_art.slime.as_ref().unwrap_or(&monster_art.zombie),
            7 => monster_art.spider.as_ref().unwrap_or(&monster_art.zombie),
            8 => monster_art
                .stiltneck
                .as_ref()
                .unwrap_or(&monster_art.zombie),
            _ => &monster_art.zombie,
        };

        let is_moving = sm.kbx.abs() > 0.05 || sm.kbz.abs() > 0.05 || sm.stagger_t > 0.0;
        let cells = if is_moving {
            if !clips.walk.is_empty() {
                &clips.walk
            } else {
                &clips.idle
            }
        } else {
            &clips.idle
        };

        if !cells.is_empty() {
            let fps = if is_moving { 8 } else { 4 };
            let frame = ((sim.0.tick + comp.id as u64 * 7) * fps / 60) as usize % cells.len();
            let [u, v, uw, vh] = cells[frame];
            if let Some(mat) = materials.get_mut(&mat_handle.0) {
                mat.uv_transform = Affine2 {
                    matrix2: Mat2::from_diagonal(Vec2::new(uw, vh)),
                    translation: Vec2::new(u, v),
                };
            }
        }
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

fn update_dungeon_hud(
    sim: Option<Res<Sim>>,
    real: Option<Res<ActiveFloor>>,
    authored: Option<Res<AuthoredFloor>>,
    mut gui: gui::Gui,
) {
    let Some(sim) = sim else {
        gui.views.hud = None;
        return;
    };

    if !gui.layer.stack.is_open(gui::ScreenId::Hud) {
        gui.layer.open(gui::ScreenId::Hud);
    }

    let p = &sim.0.player;
    let combo = p.bounce_combo.round() as u32;
    let plunger_power = if sim.0.plunger_charging || sim.0.plunger_armed {
        Some(sim.0.plunger_power)
    } else {
        None
    };

    let level = if let Some(a) = authored.as_ref() {
        a.level as u32
    } else if let Some(r) = real.as_ref() {
        r.spec.level as u32
    } else {
        1
    };

    let g = &sim.0.grid;
    let w = g.w.max(0) as usize;
    let h = g.h.max(0) as usize;
    let mut tiles = Vec::with_capacity(w * h);
    for &t in &g.t {
        let mt = match t {
            pk_core::grid::T_WALL => MinimapTile::Wall,
            pk_core::grid::T_FLOOR => MinimapTile::Floor,
            pk_core::grid::T_STAIRS => MinimapTile::Stairs,
            pk_core::grid::T_CRACKED => MinimapTile::Cracked,
            _ => MinimapTile::Void,
        };
        tiles.push(mt);
    }
    let px = p.x.floor() as i32;
    let py = p.z.floor() as i32;
    let stairs_tile = g.t.iter().enumerate().find_map(|(idx, &t)| {
        if t == pk_core::grid::T_STAIRS {
            let sx = (idx as i32) % (g.w as i32);
            let sy = (idx as i32) / (g.w as i32);
            Some((sx, sy))
        } else {
            None
        }
    });
    let minimap = Some(HudMinimapView {
        player_tile_x: px,
        player_tile_y: py,
        stairs_tile,
        tiles,
        width: w,
        height: h,
    });

    let active_w = p.inventory.active_weapon();
    let def = active_w.def();
    let hud_weapon = Some(HudWeaponInfo {
        id: active_w.id.as_str().to_string(),
        label: def.label.to_uppercase(),
        durability: if active_w.id != pk_core::items::WeaponId::Fists {
            Some(active_w.durability)
        } else {
            None
        },
    });

    let ult_charge = (p.overcharge.max(p.sprint_charge)).clamp(0.0, 1.0);
    let rampage_ready = p.overcharge >= 0.99 || p.sprint_charge >= 0.99;
    let rampage_active = false; // Never show FPS crosshairs during standard isometric marble gameplay

    let hud_view = HudView {
        hp: 6,
        max_hp: 6,
        mana: 100,
        max_mana: 100,
        level,
        kills: sim.0.jackpots as u32,
        ult_charge,
        rampage_ready,
        rampage_active,
        fps_streak: 0,
        fps_timer: 0.0,
        combo,
        plunger_power,
        weapon: hud_weapon,
        skills: [
            Some(HudSkillSlot {
                id: "flipper_charge".to_string(),
                name: "FLIPPER".to_string(),
                cost: 25,
                rank: 1,
                cooldown_max: 5.0,
                cooldown_left: 0.0,
                can_cast: true,
                affordable: true,
            }),
            Some(HudSkillSlot {
                id: "time_crawl".to_string(),
                name: "TIME".to_string(),
                cost: 40,
                rank: 2,
                cooldown_max: 12.0,
                cooldown_left: 0.0,
                can_cast: true,
                affordable: true,
            }),
        ],
        belt: [
            Some(HudBeltSlot {
                id: "potion_hp".to_string(),
                count: 3,
            }),
            Some(HudBeltSlot {
                id: "bomb".to_string(),
                count: 1,
            }),
            None,
            None,
        ],
        boss: None,
        minimap,
        pain_flash: if p.iframes > 0.0 { 1.0 } else { 0.0 },
    };

    gui::set_view(&mut gui.views.hud, Some(hud_view));
}
