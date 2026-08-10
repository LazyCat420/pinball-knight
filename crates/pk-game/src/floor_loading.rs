//! THE ONE DOOR INTO A FLOOR — `Tavern → FloorLoading → Dungeon`.
//!
//! Before this, two places built a floor: the boot gate dropped straight into
//! `AppState::Dungeon` and `setup_dungeon` built one inline, and the tavern's
//! DESCEND board did the same thing by the same route. Both did it INSIDE the
//! frame that had just been asked to draw something else, so the descend was a
//! stall with nothing on screen — and there was no moment in the state machine
//! where a floor was being prepared, which is the moment a loading screen needs
//! to exist in.
//!
//! So `Dungeon` no longer builds anything. It INSTALLS a [`PreparedFloor`], and
//! this state is the only thing that makes one. One writer, and the invariant
//! that goes with it: entering `Dungeon` without a `PreparedFloor` does nothing
//! at all rather than quietly building a second floor by a second route.
//!
//! ## What the loading screen is actually covering — measured, not assumed
//!
//! `cargo run --release -p pk-core --example floor_build_cost`, min of 5 runs:
//!
//! | level | grid   | tiles  | generate | validate | `SimState::new` |
//! |-------|--------|--------|----------|----------|-----------------|
//! | 1     | 75×53  |  3,975 |   3.3 ms |   0.0 ms |          0.0 ms |
//! | 3     | 87×61  |  5,307 |   4.3 ms |   0.0 ms |          0.0 ms |
//! | 10    | 125×89 | 11,125 |   9.0 ms |   0.1 ms |          0.1 ms |
//! | 23    | 193×141| 27,213 |  18.0 ms |   0.1 ms |          0.2 ms |
//!
//! ⚠️ **In a native release build that is one frame, and a loading screen for
//! one frame is theatre.** The honest reasons this state exists anyway, in
//! order of how much they are worth:
//!
//!  1. **The mesh build and the GPU upload are not in that table** and are the
//!     part a browser feels. `__pk.loading.prepareMs` / `installMs` report both
//!     from the real build, so the number stops being a guess — see
//!     [`FloorLoadingRes`].
//!  2. **Nine passes of twenty-three.** The table above is the cost of the
//!     PREFIX that has landed. Fourteen more passes go on top, including the
//!     compaction fixed point, and the architecture that has somewhere to put a
//!     progress beat is cheaper to build now than to retrofit at pass 23.
//!  3. **A debug wasm build is the one everybody actually plays** during the
//!     port, and it is 10-13× the release cost measured above (42-235 ms for
//!     the same rows).
//!
//! Because of (1), [`MIN_DWELL_MS`] exists and is called what it is: theatre,
//! bounded and named, so nobody later mistakes it for work.
//!
//! ## Paint before build, or the screen is never seen
//!
//! Spawning the UI and building the floor in the same frame shows the user
//! nothing: the commands that spawn the card are applied at the end of the
//! frame, and the build blocks before the frame after it ever renders. So the
//! step is a state machine of its own — [`loading_step`] — which is a pure
//! function precisely so the ordering can be tested without standing up an
//! `App`, and which will not say `Build` until the screen has been painted.

use bevy::prelude::*;
use pk_core::grid::Grid;
use pk_core::maze::floor_spec::derive_floor_spec;
use pk_core::state::demo_floor;

use crate::real_floor::{
    build_active_floor, spawn_real_floor_failure, ActiveFloor, RealFloorBoot, RealFloorFailure,
    RealFloorRequest,
};
use crate::AppState;

/// The demo floor's seed, kept where the demo floor is now built rather than
/// left as a bare `7` in `setup_dungeon`.
const DEMO_SEED: u32 = 7;

/// How many frames must be PAINTED before the build is allowed to block.
///
/// One is the number that matters — the card has to reach the screen once — and
/// two is what is used, because the first frame after a state transition is the
/// one Bevy is still applying the transition's commands in. Cheap insurance
/// against a screen that exists in the entity graph and never in a pixel.
const PAINT_FRAMES: u32 = 2;

/// The floor of how long the screen stays up, in milliseconds.
///
/// ⚠️ THIS IS THEATRE AND IS LABELLED AS SUCH. The measured work is 3-18 ms in
/// release (table in the module header), and a card that appears for 18 ms is a
/// white flash — strictly worse than no card, because a flash reads as a glitch
/// while a beat reads as a transition. 300 ms is about the shortest interval
/// that reads as deliberate.
///
/// It is a FLOOR, never an addition: a prepare that takes 900 ms waits 0 ms
/// extra. And `__pk.loading.prepareMs` reports the real work separately, so a
/// future reader can never mistake this constant for a measurement.
const MIN_DWELL_MS: f64 = 300.0;

/// A DEBUG HOLD on the loading screen, in milliseconds — `?loading-hold-ms=N`,
/// `--loading-hold-ms N`, `PK_LOADING_HOLD_MS=N`.
///
/// ⚠️ THIS EXISTS BECAUSE THE SCREEN WAS OTHERWISE UNPROVABLE, and that is worth
/// writing down. `__pk.loading` reported the state faithfully and the browser
/// gate went green on it — but the SCREENSHOT taken at that moment showed the
/// dungeon. At the debug build's 14 fps the state lives about three frames, so
/// no externally-timed capture can land inside it: by the time a poll observes
/// the state and asks for a picture, the state is over.
///
/// A claim that cannot be photographed is a claim nobody has checked. So the
/// dwell is extendable from outside, the gate holds it for seconds, and the card
/// gets photographed. Same family as `?dungeon=1` and `?autostart=1`: a hatch
/// that exists so a harness can see something a player sees for 300 ms.
///
/// Zero (the default) changes nothing.
pub fn loading_hold_ms() -> f64 {
    let parse = |v: String| v.trim().parse::<f64>().ok().filter(|n| *n >= 0.0);
    #[cfg(target_arch = "wasm32")]
    {
        web_sys::window()
            .and_then(|w| w.location().search().ok())
            .and_then(|q| web_sys::UrlSearchParams::new_with_str(&q).ok())
            .and_then(|p| p.get("loading-hold-ms"))
            .and_then(parse)
            .unwrap_or(0.0)
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let args: Vec<String> = std::env::args().collect();
        args.iter()
            .position(|a| a == "--loading-hold-ms")
            .and_then(|k| args.get(k + 1))
            .cloned()
            .or_else(|| std::env::var("PK_LOADING_HOLD_MS").ok())
            .and_then(parse)
            .unwrap_or(0.0)
    }
}

/// The dwell this run uses: the constant, or the debug hold when it is longer.
#[derive(Resource, Clone, Copy)]
pub struct LoadingDwell(pub f64);

impl Default for LoadingDwell {
    fn default() -> Self {
        Self(MIN_DWELL_MS.max(loading_hold_ms()))
    }
}

/// Milliseconds on a monotonic clock, both targets.
///
/// `performance.now()` rather than `Date.now()` on the web: this measures
/// intervals of tens of milliseconds, and `Date.now()` is millisecond-resolution
/// and free to jump. Falls back to 0.0 rather than panicking — a missing clock
/// should cost the dwell, not the floor.
pub(crate) fn now_ms() -> f64 {
    #[cfg(target_arch = "wasm32")]
    {
        web_sys::window()
            .and_then(|w| w.performance())
            .map(|p| p.now())
            .unwrap_or(0.0)
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs_f64() * 1000.0)
            .unwrap_or(0.0)
    }
}

/// A floor that has been built and is waiting to be installed.
///
/// Carries the grid the sim will step and — when the floor is a generated one —
/// the [`ActiveFloor`] that stays authoritative over it. `setup_dungeon` takes
/// this by value and inserts what it needs; nothing else may construct one.
#[derive(Resource)]
pub struct PreparedFloor {
    pub grid: Grid,
    pub spawn: (f64, f64),
    pub seed: u32,
    /// `None` for the demo floor.
    pub real: Option<ActiveFloor>,
    /// What the work actually cost, milliseconds. Published, not just stored:
    /// it is the number [`MIN_DWELL_MS`] must never be confused with.
    pub prepare_ms: f64,
}

/// The loading state's own scratch.
#[derive(Resource)]
pub struct FloorLoadingRes {
    /// Frames this state has been asked to draw.
    ///
    /// ⚠️ ASKED TO DRAW, which is not the same as DREW. See [`ready_ms`].
    pub painted: u32,
    /// When the state was entered. Not the dwell's clock (see [`Self::ready_ms`])
    /// — this is the WHOLE beat, boot stall included, and it is published as
    /// `__pk.loading.elapsedMs` because "how long was the loading screen up" is
    /// the question a human actually asks, and it is not `prepareMs` and not the
    /// dwell.
    #[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
    pub entered_ms: f64,
    /// When the floor finished building — and therefore when the dwell starts.
    ///
    /// ⚠️ NOT `entered_ms`, and the difference is a defect this had and shipped
    /// green for an afternoon. On a COLD wasm boot the first two `Update` runs
    /// are separated by ~2.5 seconds of shader compilation, during which Bevy
    /// has presented nothing. A dwell measured from `entered_ms` was therefore
    /// entirely consumed before the renderer produced its first frame: the probe
    /// reported `painted: 2` and a browser gate believed it, while the
    /// screenshot taken at that exact moment showed the DUNGEON — the first
    /// frame Chrome ever composited for the page was the one after the hand-off.
    ///
    /// Measuring from here makes the beat "300 ms after the floor is ready",
    /// which is both what a loading screen means and a window the renderer is
    /// awake for.
    pub ready_ms: Option<f64>,
    /// Set once the floor is built. `None` while the work is still ahead.
    pub prepare_ms: Option<f64>,
    /// What the card says — derived BEFORE the build, because deriving the spec
    /// is two rng draws and a table lookup, so the screen can name the floor it
    /// is about to make instead of saying "loading".
    ///
    /// Read by the wasm telemetry so a browser gate can assert WHICH floor the
    /// screen named, not merely that a screen existed. Native has no `__pk`.
    #[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
    pub label: String,
    /// True once a failure card has replaced the loading card.
    pub failed: bool,
    /// The dwell this run resolved to, including any debug hold. Published so a
    /// browser gate can tell "the screen is short" from "the hold I passed never
    /// arrived" — two states that look identical from outside, and the second of
    /// which cost an hour before this field existed.
    #[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
    pub dwell_ms: f64,
}

/// What the loading state should do on this frame.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LoadingStep {
    /// Draw, and do nothing else.
    Paint,
    /// The screen has been seen; build the floor now.
    Build,
    /// The floor is ready and the beat has been held; go to the dungeon.
    Handoff,
    /// A failure card is up. Stay here — there is nothing to hand off.
    Halt,
}

/// THE ORDERING CONTRACT, as a pure function so it can be tested without an
/// `App`, a GPU or a browser.
///
/// The three ways this goes wrong, all of which the tests below pin:
///  · building on the entry frame — the card never reaches a pixel;
///  · handing off the moment the build returns — the card flashes;
///  · waiting out the dwell before building — the dwell and the work add up
///    instead of overlapping, and every descend costs 300 ms more than it needs.
pub fn loading_step(
    painted: u32,
    prepared: bool,
    failed: bool,
    elapsed_ms: f64,
    min_dwell_ms: f64,
) -> LoadingStep {
    if failed {
        return LoadingStep::Halt;
    }
    if !prepared {
        // The dwell is NOT waited out first: the work starts as soon as the
        // screen has been seen, and the dwell is checked afterwards against the
        // same clock. A prepare longer than the dwell therefore costs nothing
        // extra at all.
        return if painted >= PAINT_FRAMES {
            LoadingStep::Build
        } else {
            LoadingStep::Paint
        };
    }
    if elapsed_ms >= min_dwell_ms {
        LoadingStep::Handoff
    } else {
        LoadingStep::Paint
    }
}

#[derive(Component)]
struct FloorLoadingScene;

/// The line the card shows. Derived from the spec, which costs two rng draws —
/// so the screen names the floor it is about to build rather than the generic
/// thing every loading screen says.
fn floor_label(request: Option<RealFloorRequest>) -> String {
    match request {
        Some(r) => {
            let spec = derive_floor_spec(r.level, r.run_seed);
            // ASCII separators. The first draft used U+00B7 and the test three
            // screens down caught it — which is the guard doing exactly the job
            // the `87x61` tofu box bought it, one commit earlier and for free.
            format!(
                "DESCENDING  -  FLOOR {}  -  {}",
                r.level, spec.archetype.label
            )
        }
        None => "DESCENDING".to_string(),
    }
}

fn enter_floor_loading(mut commands: Commands, boot: Res<RealFloorBoot>, dwell: Res<LoadingDwell>) {
    // A malformed request has no spec to name, so the card stays generic and the
    // failure below replaces it two frames later.
    let request = match &boot.0 {
        Some(Ok(r)) => Some(*r),
        _ => None,
    };
    let label = floor_label(request);

    commands.insert_resource(FloorLoadingRes {
        painted: 0,
        entered_ms: now_ms(),
        ready_ms: None,
        prepare_ms: None,
        label: label.clone(),
        failed: false,
        dwell_ms: dwell.0,
    });

    commands
        .spawn((
            FloorLoadingScene,
            Node {
                position_type: PositionType::Absolute,
                left: Val::Px(0.0),
                top: Val::Px(0.0),
                width: Val::Percent(100.0),
                height: Val::Percent(100.0),
                justify_content: JustifyContent::Center,
                align_items: AlignItems::Center,
                flex_direction: FlexDirection::Column,
                row_gap: Val::Px(14.0),
                ..default()
            },
            // Opaque, and dark enough that the torn-down tavern behind it is
            // gone rather than dimmed — a translucent card over a half-despawned
            // room is how a loading screen reads as a bug.
            BackgroundColor(Color::srgb(0.03, 0.03, 0.05)),
            GlobalZIndex(80),
        ))
        .with_children(|p| {
            p.spawn((
                Text::new(label),
                TextFont {
                    font_size: 22.0,
                    ..default()
                },
                TextColor(Color::srgba(1.0, 0.84, 0.42, 0.96)),
            ));
            p.spawn((
                Text::new("building the floor"),
                TextFont {
                    font_size: 13.0,
                    ..default()
                },
                TextColor(Color::srgba(0.85, 0.85, 0.9, 0.55)),
            ));
        });
}

/// One frame of the loading state: paint, then build, then hand off.
fn advance_floor_loading(
    mut commands: Commands,
    mut res: ResMut<FloorLoadingRes>,
    boot: Res<RealFloorBoot>,
    dwell: Res<LoadingDwell>,
    prepared: Option<Res<PreparedFloor>>,
    mut next: ResMut<NextState<AppState>>,
) {
    res.painted += 1;
    // Measured from when the floor became READY, not from when the state was
    // entered — see `FloorLoadingRes::ready_ms`. Before the build there is no
    // dwell to serve, so the elapsed value here is irrelevant and is 0.
    let elapsed = res.ready_ms.map_or(0.0, |t| now_ms() - t);
    match loading_step(
        res.painted,
        prepared.is_some(),
        res.failed,
        elapsed,
        dwell.0,
    ) {
        LoadingStep::Paint | LoadingStep::Halt => {}
        LoadingStep::Build => {
            let t0 = now_ms();
            match prepare_floor(&boot) {
                Ok(mut floor) => {
                    let done = now_ms();
                    floor.prepare_ms = done - t0;
                    res.prepare_ms = Some(floor.prepare_ms);
                    res.ready_ms = Some(done);
                    commands.insert_resource(floor);
                }
                Err(message) => {
                    // The card is REPLACED, not stacked on: the loading card is
                    // opaque and would otherwise sit over the failure.
                    let e = spawn_real_floor_failure(&mut commands, &message);
                    commands.entity(e).insert(FloorLoadingScene);
                    commands.insert_resource(RealFloorFailure { message });
                    res.failed = true;
                }
            }
        }
        LoadingStep::Handoff => next.set(AppState::Dungeon),
    }
}

/// Build whatever floor the boot gate asked for. THE ONLY floor build site.
fn prepare_floor(boot: &RealFloorBoot) -> Result<PreparedFloor, String> {
    let real = match &boot.0 {
        None => None,
        Some(Err(e)) => return Err(e.to_string()),
        Some(Ok(req)) => {
            let f = build_active_floor(*req).map_err(|e| e.to_string())?;
            // The one number pk-core cannot check: the exit marker's world
            // position after the `f64 → f32` cast this crate makes.
            if !f.exit_marker_is_on_its_tile() {
                return Err(format!(
                    "the exit marker at {:?} does not land on tile {:?}",
                    f.info.provisional_exit_world, f.info.provisional_exit_tile
                ));
            }
            Some(f)
        }
    };
    Ok(match real {
        Some(f) => PreparedFloor {
            grid: f.track.grid.clone(),
            spawn: f.info.start_world,
            seed: f.spec.floor_seed,
            real: Some(f),
            prepare_ms: 0.0,
        },
        None => {
            let (grid, spawn) = demo_floor(DEMO_SEED);
            PreparedFloor {
                grid,
                spawn,
                seed: DEMO_SEED,
                real: None,
                prepare_ms: 0.0,
            }
        }
    })
}

fn exit_floor_loading(mut commands: Commands, q: Query<Entity, With<FloorLoadingScene>>) {
    for e in &q {
        commands.entity(e).despawn();
    }
    commands.remove_resource::<FloorLoadingRes>();
}

pub struct FloorLoadingPlugin;

impl Plugin for FloorLoadingPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<LoadingDwell>()
            .add_systems(OnEnter(AppState::FloorLoading), enter_floor_loading)
            .add_systems(
                Update,
                advance_floor_loading
                    .run_if(in_state(AppState::FloorLoading))
                    // The initial state's `OnEnter` fires before `Startup` has
                    // applied its commands, so this can be scheduled before its
                    // own resource exists — the same trap `setup_dungeon`
                    // documents.
                    .run_if(resource_exists::<FloorLoadingRes>),
            )
            .add_systems(OnExit(AppState::FloorLoading), exit_floor_loading);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// THE THREE ORDERINGS, one test each, and each one fails for a defect
    /// somebody would otherwise ship.
    #[test]
    fn the_screen_is_painted_before_the_build_blocks() {
        // Entry frame and the one after it: draw only.
        assert_eq!(
            loading_step(1, false, false, 0.0, MIN_DWELL_MS),
            LoadingStep::Paint
        );
        assert_eq!(
            loading_step(PAINT_FRAMES - 1, false, false, 0.0, MIN_DWELL_MS),
            LoadingStep::Paint
        );
        // The frame the card has provably reached: build.
        assert_eq!(
            loading_step(PAINT_FRAMES, false, false, 0.0, MIN_DWELL_MS),
            LoadingStep::Build
        );
    }

    /// The dwell is served AFTER the floor is ready, and is a beat rather than a
    /// budget: it starts at `ready_ms` and its whole job is to keep the card on
    /// a renderer that is by then awake.
    #[test]
    fn the_dwell_is_served_after_the_floor_is_ready() {
        // Ready, beat not yet served — hold.
        assert_eq!(
            loading_step(9, true, false, MIN_DWELL_MS - 1.0, MIN_DWELL_MS),
            LoadingStep::Paint
        );
        // Beat served — go.
        assert_eq!(
            loading_step(9, true, false, MIN_DWELL_MS, MIN_DWELL_MS),
            LoadingStep::Handoff
        );
        // ⚠️ AND TIME SPENT BEFORE THE FLOOR IS READY MUST NOT COUNT. This is
        // the defect that shipped green for an afternoon: on a cold wasm boot
        // the first two `Update`s are ~2.5 s apart (shader compilation), so a
        // dwell clocked from state ENTRY was fully spent before the renderer had
        // presented anything and the card was never seen. The caller now passes
        // an elapsed measured from `ready_ms`, and `elapsed` is defined as 0
        // while `prepared` is false — so no amount of pre-build time can serve
        // the beat.
        for slow_boot in [0.0, 2_500.0, 60_000.0] {
            assert_eq!(
                loading_step(2, false, false, slow_boot, MIN_DWELL_MS),
                LoadingStep::Build,
                "{slow_boot} ms of boot must still reach the build, never the hand-off"
            );
        }
    }

    /// A failure halts and never hands off — the "no silent fallback" rule
    /// stated at the level of the state machine rather than only in the shell.
    #[test]
    fn a_failure_halts_instead_of_entering_the_dungeon() {
        for painted in [0, 1, 2, 50] {
            for prepared in [false, true] {
                assert_eq!(
                    loading_step(painted, prepared, true, 10_000.0, MIN_DWELL_MS),
                    LoadingStep::Halt,
                    "painted={painted} prepared={prepared}"
                );
            }
        }
    }

    /// A zero dwell still paints first. The dwell and the paint gate are
    /// independent, and a future tuning of one must not silently disable the
    /// other — which is exactly what a single combined `elapsed > X` check would
    /// have done.
    #[test]
    fn tuning_the_dwell_to_zero_does_not_disable_the_paint_gate() {
        assert_eq!(loading_step(0, false, false, 0.0, 0.0), LoadingStep::Paint);
        assert_eq!(
            loading_step(PAINT_FRAMES, false, false, 0.0, 0.0),
            LoadingStep::Build
        );
        assert_eq!(
            loading_step(PAINT_FRAMES, true, false, 0.0, 0.0),
            LoadingStep::Handoff
        );
    }

    /// The hold only ever LENGTHENS the beat — a hatch that could shorten it
    /// below the constant would be a way to make the screen unseeable, which is
    /// the opposite of what it is for.
    #[test]
    fn the_debug_hold_can_only_lengthen_the_dwell() {
        // `loading_hold_ms` reads the process, which a test cannot set safely
        // alongside other tests, so the composition rule is asserted directly —
        // it is the whole of what `LoadingDwell::default` does.
        for hold in [0.0, 1.0, MIN_DWELL_MS - 1.0, MIN_DWELL_MS, 5_000.0] {
            assert!(
                MIN_DWELL_MS.max(hold) >= MIN_DWELL_MS,
                "a hold of {hold} shortened the dwell"
            );
        }
        assert_eq!(MIN_DWELL_MS.max(0.0), MIN_DWELL_MS, "no hold, no change");
        assert_eq!(MIN_DWELL_MS.max(5_000.0), 5_000.0, "a long hold wins");
    }

    /// The card names the floor BEFORE it is built — which is only honest if
    /// deriving the label costs nothing like building the floor.
    #[test]
    fn the_card_names_the_floor_it_is_about_to_build() {
        let l = floor_label(Some(RealFloorRequest {
            level: 3,
            run_seed: 1,
        }));
        assert!(l.contains("FLOOR 3"), "{l}");
        assert!(l.contains("The Great Hall"), "{l}");
        assert!(l.is_ascii(), "the default font may not have this: {l}");
        // No request (the demo floor) still gets a card, and one that does not
        // claim a level it does not have.
        let d = floor_label(None);
        assert!(d.contains("DESCENDING") && !d.contains("FLOOR"), "{d}");
    }

    /// The demo floor still comes out of the ONE build site, so `--real-floor`
    /// off is a different floor and not a different code path.
    #[test]
    fn the_one_build_site_makes_both_kinds_of_floor() {
        let demo = prepare_floor(&RealFloorBoot(None)).expect("the demo floor builds");
        assert!(demo.real.is_none());
        assert_eq!((demo.grid.w, demo.grid.h), (25, 25), "the demo arena");
        assert_eq!(demo.seed, DEMO_SEED);

        let real = prepare_floor(&RealFloorBoot(Some(Ok(RealFloorRequest {
            level: 3,
            run_seed: 1,
        }))))
        .expect("the generated floor builds");
        let f = real.real.as_ref().expect("a generated floor is carried");
        assert_eq!((real.grid.w, real.grid.h), (87, 61));
        assert_eq!(real.spawn, f.info.start_world);
        assert_eq!(real.seed, f.spec.floor_seed);
        // The grid handed to the sim is a CLONE of the authoritative one, and
        // equal to it at hand-off.
        assert!(f.assert_grid_still_authored(&real.grid).is_ok());
    }

    /// A refused request never produces a floor — the failure reaches the state
    /// machine as an `Err`, not as a default floor.
    #[test]
    fn a_refused_request_yields_no_floor_at_all() {
        // `let Err(..) else` rather than `expect_err`: the Ok side carries a
        // `PreparedFloor`, which owns a whole grid and has no business deriving
        // `Debug` just so a test can format the value it must never see.
        let Err(e) = prepare_floor(&RealFloorBoot(Some(Err(
            crate::real_floor::RealFloorRequestError::InvalidQuery {
                key: "level",
                value: "banana".into(),
            },
        )))) else {
            panic!("a refused request must not build a floor");
        };
        assert!(e.contains("banana"), "the card would not say why: {e}");
    }
}
