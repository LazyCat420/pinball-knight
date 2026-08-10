//! `--real-floor` — boot the ported generator instead of `demo_floor(7)`.
//!
//! The dungeon has always rendered a 25×25 bordered room with a pillar scatter,
//! because that is what `pk_core::state::demo_floor` builds and the maze port
//! had nothing to hand it. Nine of twenty-three passes have landed and their
//! output is bit-identical to the legacy oracle at the `plan-doorways` boundary
//! on all ten corpus floors, so the shell can now stand on a real one. Behind a
//! flag, because the floor is nine passes deep and the flag is what says so.
//!
//! ## THREE THINGS THIS DELIBERATELY DOES NOT DO
//!
//! **It does not fall back.** A request that cannot be parsed, a floor the
//! pipeline declines, a floor that validates as unstandable — each one paints a
//! red overlay and leaves the screen empty. The alternative is a dungeon that
//! silently shows the demo floor, which makes every "the real floor looks like
//! the pad arena" report unfalsifiable. That report is exactly why this exists.
//!
//! **It does not stamp `T_STAIRS`.** Pass 21 authors the stairs; pass 14
//! re-picks the endpoints this floor is using. Writing a stairs tile now would
//! be the port running ahead of itself into the one array every digest reads —
//! so the exit is a MARKER ENTITY at the provisional tile, and the banner says
//! "provisional" out loud.
//!
//! **It does not let the sim own the terrain.** `SimState` takes a CLONE of the
//! floor's grid; [`ActiveFloor`] keeps the authoritative one and the digest it
//! was authored with, and [`assert_grid_still_authored`] re-checks it. The sim
//! only reads terrain today — that is a property of today's call chain, not a
//! guarantee, and a collapsing-floor part added later would desynchronise the
//! collider from the renderer with no symptom until a wall stopped being where
//! it looks.
//!
//! ## The flag, three ways
//!
//! | target | request | level | run seed |
//! |---|---|---|---|
//! | wasm   | `?real-floor=1` | `&level=N` | `&seed=N` |
//! | native | `--real-floor`  | `--level N` | `--seed N` |
//! | native | `PK_REAL_FLOOR=1` | `PK_LEVEL=N` | `PK_SEED=N` |
//!
//! The wasm side reads `location.search` through `web_sys::UrlSearchParams` and
//! never `js_sys::eval`. The rest of this shell still evals its query reads (see
//! `intro_skip_gate`); that is debt this module does not inherit, because a
//! string spliced into `eval` is a different class of thing from a typed getter
//! and this one takes numbers straight off the URL.

use bevy::prelude::*;
use pk_core::grid::tile_center;
use pk_core::maze::digest::{digest_grid_state, GridStateDigest};
use pk_core::maze::floor_spec::{
    build_track_floor_from_spec, derive_floor_spec, validate_runtime_floor, FloorBuildError,
    FloorSpec, RuntimeFloorInfo,
};
use pk_core::maze::track_floor::{TrackFloor, PASSES_LANDED};

/// The level a bare `--real-floor` asks for — the floor a run actually opens on.
const DEFAULT_LEVEL: i32 = 1;
/// The run seed a bare `--real-floor` asks for.
const DEFAULT_RUN_SEED: u32 = 1;

/// What was asked for, once it has parsed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RealFloorRequest {
    pub level: i32,
    pub run_seed: u32,
}

/// Why the REQUEST could not be read — strictly the flag layer.
///
/// Deliberately a different enum from [`FloorBuildError`], which is pk-core's
/// and is about geometry. A `?level=banana` and a floor whose spawn is walled in
/// are answered by the same overlay but diagnosed in completely different files,
/// and one enum spanning both would put a `BrowserContextMissing` variant inside
/// the deterministic sim crate.
///
/// ⚠️ NO TARGET CONSTRUCTS ALL FIVE. wasm builds the three query variants,
/// native builds the two argument ones, and the unit tests format every one of
/// them. They are NOT cfg'd apart: the enum is the flag layer's whole
/// vocabulary, and two targets carrying different error shapes is how a
/// browser-only failure path stops being reviewed on the target CI runs. So the
/// lint is switched off once, here, rather than three variants being deleted
/// from each build — measured, because the first attempt cfg'd it for native and
/// the wasm build then warned about the other two.
#[allow(dead_code)]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RealFloorRequestError {
    /// wasm with no `window` — a worker, or a host that did not provide one.
    BrowserContextMissing,
    /// `location.search` would not parse as a query string.
    QueryReadFailed,
    InvalidQuery {
        key: &'static str,
        value: String,
    },
    InvalidCli {
        argument: String,
    },
    InvalidEnvironment {
        key: &'static str,
        value: String,
    },
}

impl std::fmt::Display for RealFloorRequestError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BrowserContextMissing => write!(f, "no browser window to read a query from"),
            Self::QueryReadFailed => write!(f, "location.search would not parse"),
            Self::InvalidQuery { key, value } => write!(f, "?{key}={value} is not a number"),
            Self::InvalidCli { argument } => write!(f, "{argument} is not a number"),
            Self::InvalidEnvironment { key, value } => write!(f, "{key}={value} is not a number"),
        }
    }
}

/// The whole flag layer as one pure function, so it can be tested without a
/// browser, a process or an `App`.
///
/// `None` means "not asked for" and is the only path that leaves the demo floor
/// alone. The three call sites below each turn their platform into these two
/// arguments and then agree by construction.
fn parse_request(
    asked: bool,
    read: impl Fn(&'static str) -> Option<String>,
    bad: impl Fn(&'static str, String) -> RealFloorRequestError,
) -> Option<Result<RealFloorRequest, RealFloorRequestError>> {
    if !asked {
        return None;
    }
    let level = match read("level") {
        None => DEFAULT_LEVEL,
        Some(v) => match v.trim().parse::<i32>() {
            // A level below 1 is clamped by `archetype_for` and `level_cells`
            // rather than rejected, so it would silently build L1 — REFUSED
            // here instead, because a flag that quietly ignores its argument is
            // how "I tested level 0" becomes a false report.
            Ok(n) if n >= 1 => n,
            _ => return Some(Err(bad("level", v))),
        },
    };
    let run_seed = match read("seed") {
        None => DEFAULT_RUN_SEED,
        Some(v) => match v.trim().parse::<u32>() {
            Ok(n) => n,
            _ => return Some(Err(bad("seed", v))),
        },
    };
    Some(Ok(RealFloorRequest { level, run_seed }))
}

/// Read the request off whichever platform this is.
#[cfg(target_arch = "wasm32")]
pub fn real_floor_request() -> Option<Result<RealFloorRequest, RealFloorRequestError>> {
    let Some(win) = web_sys::window() else {
        // Not an error unless the flag was asked for — and it cannot have been,
        // since there is no URL to ask on.
        return None;
    };
    let Ok(search) = win.location().search() else {
        return Some(Err(RealFloorRequestError::BrowserContextMissing));
    };
    let Ok(params) = web_sys::UrlSearchParams::new_with_str(&search) else {
        return Some(Err(RealFloorRequestError::QueryReadFailed));
    };
    // `?real-floor` with no value is as much a request as `?real-floor=1`;
    // `?real-floor=0` is not. Same three-way reading the legacy query flags use.
    let asked = match params.get("real-floor") {
        None => false,
        Some(v) => v != "0" && v != "false",
    };
    parse_request(
        asked,
        |k| params.get(k),
        |key, value| RealFloorRequestError::InvalidQuery { key, value },
    )
}

#[cfg(not(target_arch = "wasm32"))]
pub fn real_floor_request() -> Option<Result<RealFloorRequest, RealFloorRequestError>> {
    let args: Vec<String> = std::env::args().collect();
    let env_asked = std::env::var("PK_REAL_FLOOR")
        .map(|v| v == "1")
        .unwrap_or(false);
    let cli_asked = args.iter().any(|a| a == "--real-floor");
    if !(env_asked || cli_asked) {
        return None;
    }
    // The CLI wins over the environment, because the environment is the thing
    // you forgot was exported.
    let cli = |flag: &'static str| -> Option<String> {
        let want = format!("--{flag}");
        args.iter()
            .position(|a| *a == want)
            .and_then(|k| args.get(k + 1))
            .cloned()
    };
    let env_key = |flag: &'static str| -> &'static str {
        match flag {
            "level" => "PK_LEVEL",
            _ => "PK_SEED",
        }
    };
    // Which source answered decides which error names it, so a bad value points
    // at the place it was actually written.
    let from_cli = std::cell::Cell::new(false);
    let read = |flag: &'static str| -> Option<String> {
        if let Some(v) = cli(flag) {
            from_cli.set(true);
            return Some(v);
        }
        from_cli.set(false);
        std::env::var(env_key(flag)).ok()
    };
    parse_request(cli_asked || env_asked, read, |key, value| {
        if from_cli.get() {
            RealFloorRequestError::InvalidCli {
                argument: format!("--{key} {value}"),
            }
        } else {
            RealFloorRequestError::InvalidEnvironment {
                key: env_key(key),
                value,
            }
        }
    })
}

/// The boot-time answer, evaluated once in `main` and read by every descent.
///
/// A resource rather than a call inside `setup_dungeon`, because `setup_dungeon`
/// runs again after every tavern hand-off and re-reading the process arguments
/// each time would let a flag mean different things on floor 1 and floor 2.
#[derive(Resource)]
pub struct RealFloorBoot(pub Option<Result<RealFloorRequest, RealFloorRequestError>>);

impl RealFloorBoot {
    pub fn requested(&self) -> bool {
        self.0.is_some()
    }
}

/// The floor a dungeon visit is standing on, and the digest it was authored
/// with. THE AUTHORITY — `Sim.0.grid` is a setup-time clone of `track.grid` and
/// is allowed to exist only while the two stay equal.
#[derive(Resource)]
pub struct ActiveFloor {
    pub request: RealFloorRequest,
    pub spec: FloorSpec,
    pub track: TrackFloor,
    pub info: RuntimeFloorInfo,
    /// `digest_grid_state(&track.grid)` at install time. Stored rather than
    /// recomputed at each check so a mutation of the AUTHORITATIVE grid is
    /// caught too — recomputing both sides would compare a drifted grid against
    /// itself and pass.
    pub authored: GridStateDigest,
}

/// A real-floor request that could not be honoured. Its presence is also the
/// latch that stops `setup_dungeon` retrying the same failure every frame.
#[derive(Resource)]
pub struct RealFloorFailure {
    /// Read by the wasm telemetry (`__pk.floorError`). On native the same string
    /// has already gone to the on-screen card, which is why this field has no
    /// native reader and says so rather than being silently trimmed — a browser
    /// gate needs the text, and a struct that carried it only sometimes would be
    /// a payload that is `null` for reasons nobody can see.
    #[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
    pub message: String,
}

/// The marker entity standing in for stairs that pass 21 has not authored yet.
#[derive(Component)]
pub struct GeneratedExitMarker;

/// The top-left `REAL FLOOR …` readout. Its own component so the browser gate
/// can be told a banner exists without scraping pixels.
#[derive(Component)]
pub struct RealFloorBanner;

/// The red failure card.
#[derive(Component)]
pub struct RealFloorErrorOverlay;

/// Derive, build and validate — the whole pk-core round trip in one call.
pub fn build_active_floor(request: RealFloorRequest) -> Result<ActiveFloor, FloorBuildError> {
    let spec = derive_floor_spec(request.level, request.run_seed);
    let track = build_track_floor_from_spec(&spec)?;
    let info = validate_runtime_floor(&track)?;
    let authored = digest_grid_state(&track.grid);
    Ok(ActiveFloor {
        request,
        spec,
        track,
        info,
        authored,
    })
}

impl ActiveFloor {
    /// The on-screen line. Everything a screenshot needs to identify the floor
    /// it is showing, which is the entire point of a debug banner: a screenshot
    /// of an unlabelled maze proves a maze was drawn and not WHICH one.
    pub fn banner(&self) -> String {
        let (sx, sz) = self.info.start_world;
        let (ex, ez) = self.info.provisional_exit_world;
        format!(
            // `x` and not `×`: Bevy's `default_font` has no U+00D7 and drew a
            // tofu box. Caught by LOOKING at the screenshot — every automated
            // gate was green through it, including the one that asserts the
            // banner contains the size string.
            "REAL FLOOR  L{} seed={}  {}  {}x{}  start=({sx:.0},{sz:.0})  \
             exit=({ex:.0},{ez:.0}, provisional)  P{}",
            self.request.level,
            self.request.run_seed,
            self.spec.archetype.label,
            self.spec.w,
            self.spec.h,
            PASSES_LANDED,
        )
    }

    /// The `__pk.floor` payload. Hand-formatted for the same reason
    /// `publish_stats` is: this crate has no serde derive on Bevy's side and the
    /// payload is read by one consumer whose expectations are in
    /// `scripts/pk-check.mjs`.
    ///
    /// Compiled on both targets and READ only on wasm — the native build has no
    /// `window.__pk` to publish to. Kept out of a `cfg` so its unit test runs on
    /// the CI target, where the browser never does.
    #[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
    pub fn telemetry_json(&self) -> String {
        let i = &self.info;
        let probe = match &i.wall_probe {
            Some(p) => format!(
                r#"{{"from":[{},{}],"input":[{},{}],"ticks":{},"wallTile":[{},{}],"expectedBlockedAxis":"{}","maxAllowedTravel":{}}}"#,
                p.from[0],
                p.from[1],
                p.input[0],
                p.input[1],
                p.ticks,
                p.wall_tile[0],
                p.wall_tile[1],
                p.expected_blocked_axis,
                p.max_allowed_travel
            ),
            None => "null".into(),
        };
        format!(
            r#"{{"source":"track-floor","level":{},"runSeed":{},"floorSeed":{},"pass":{},"w":{},"h":{},"archetype":"{}","tileDigest":{},"startTile":[{},{}],"startWorld":[{},{}],"exitTile":[{},{}],"exitWorld":[{},{}],"pathDistance":{},"firstPathStep":[{},{}],"debugBanner":true,"wallProbe":{probe}}}"#,
            self.request.level,
            self.request.run_seed,
            self.spec.floor_seed,
            PASSES_LANDED,
            self.spec.w,
            self.spec.h,
            self.spec.archetype.id.as_str(),
            self.authored.tiles,
            i.start_tile.i,
            i.start_tile.j,
            i.start_world.0,
            i.start_world.1,
            i.provisional_exit_tile.i,
            i.provisional_exit_tile.j,
            i.provisional_exit_world.0,
            i.provisional_exit_world.1,
            i.path_distance,
            i.first_path_step.0,
            i.first_path_step.1,
        )
    }

    /// Is the sim still stepping the floor that was authored?
    ///
    /// Both sides, against the STORED digest: `sim` must equal what was
    /// installed AND `track.grid` must still equal what it was authored as. A
    /// check that recomputed both and compared them to each other would pass a
    /// mutation applied to both, which is precisely what a shared-`Arc` refactor
    /// would produce.
    pub fn assert_grid_still_authored(&self, sim_grid: &pk_core::grid::Grid) -> Result<(), String> {
        let live = digest_grid_state(&self.track.grid);
        if live != self.authored {
            return Err(format!(
                "the authored floor mutated after install: {:?} → {:?}",
                self.authored, live
            ));
        }
        let mirrored = digest_grid_state(sim_grid);
        if mirrored != self.authored {
            return Err(format!(
                "the sim's grid drifted from the floor: {:?} → {:?}",
                self.authored, mirrored
            ));
        }
        Ok(())
    }

    /// Where the exit marker goes, at the height it reads at from the 38° camera.
    pub fn exit_marker_transform(&self) -> Transform {
        let (x, z) = self.info.provisional_exit_world;
        Transform::from_xyz(x as f32, 0.35, z as f32)
    }

    /// Sanity: the marker's world position must round-trip to the exit TILE, and
    /// survive the `f64 → f32` cast the Bevy transform makes.
    ///
    /// The `f32` half is the part pk-core cannot check, and it is not
    /// hypothetical: at 87×61 the coordinates are small, but a 96-cell floor
    /// reaches ±96 world units where an `f32` still has plenty of mantissa — so
    /// this is a gate that should always pass and would name the day it stops.
    /// Called by `setup_dungeon` at install time, not only from a test.
    pub fn exit_marker_is_on_its_tile(&self) -> bool {
        let t = self.info.provisional_exit_tile;
        let world = self.info.provisional_exit_world;
        let tf = self.exit_marker_transform();
        tile_center(&self.track.grid, t.i, t.j) == world
            && f64::from(tf.translation.x) == world.0
            && f64::from(tf.translation.z) == world.1
    }
}

/// Spawn the banner, the exit marker and (on failure) the red card.
///
/// Returns the entities so the caller can tag them with its scene marker —
/// same contract as `spawn_grid_meshes`, so a dungeon teardown cannot miss one.
pub fn spawn_real_floor_decor(
    commands: &mut Commands,
    meshes: &mut Assets<Mesh>,
    materials: &mut Assets<StandardMaterial>,
    floor: &ActiveFloor,
) -> Vec<Entity> {
    // ── The exit marker: a tall amber pillar, unlit so it reads at any angle ──
    let marker = commands
        .spawn((
            GeneratedExitMarker,
            Mesh3d(meshes.add(Cuboid::new(0.5, 0.7, 0.5))),
            MeshMaterial3d(materials.add(StandardMaterial {
                base_color: Color::srgb(1.0, 0.72, 0.18),
                unlit: true,
                ..default()
            })),
            floor.exit_marker_transform(),
        ))
        .id();

    // ── The banner ──
    let banner = commands
        .spawn((
            RealFloorBanner,
            Node {
                position_type: PositionType::Absolute,
                // BELOW the frame-time readout, not beside it. `setup_common`
                // spawns that as a FULL-WIDTH centred row at `top: 6`, so a
                // top-left banner shares the line and this one is long enough to
                // reach the middle: the first screenshot came back reading
                // "start=20.21ms (49 fps)" with both strings drawn over each
                // other. Found by looking at the picture — the gate that checked
                // `debugBanner === true` was green through it.
                top: Val::Px(26.0),
                left: Val::Px(8.0),
                ..default()
            },
            GlobalZIndex(50),
            Text::new(floor.banner()),
            TextFont {
                font_size: 13.0,
                ..default()
            },
            TextColor(Color::srgba(1.0, 0.82, 0.35, 0.95)),
        ))
        .id();

    vec![marker, banner]
}

/// The red card. Spawned instead of a floor, never alongside one.
pub fn spawn_real_floor_failure(commands: &mut Commands, message: &str) -> Entity {
    commands
        .spawn((
            RealFloorErrorOverlay,
            Node {
                position_type: PositionType::Absolute,
                top: Val::Px(0.0),
                left: Val::Px(0.0),
                width: Val::Percent(100.0),
                height: Val::Percent(100.0),
                justify_content: JustifyContent::Center,
                align_items: AlignItems::Center,
                ..default()
            },
            BackgroundColor(Color::srgba(0.35, 0.03, 0.05, 0.92)),
            GlobalZIndex(90),
        ))
        .with_children(|p| {
            p.spawn((
                Text::new(format!("REAL FLOOR FAILED\n{message}")),
                TextFont {
                    font_size: 18.0,
                    ..default()
                },
                TextColor(Color::srgb(1.0, 0.9, 0.9)),
            ));
        })
        .id()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dungeon_render::plan_walls;
    use pk_core::grid::is_walkable;

    /// The pinned floor, built the way the shell builds it.
    fn pinned() -> ActiveFloor {
        build_active_floor(RealFloorRequest {
            level: 3,
            run_seed: 1,
        })
        .expect("L3 seed 1 builds")
    }

    /// ── THE FLAG LAYER ──────────────────────────────────────────────────────
    ///
    /// Tested through `parse_request` rather than through a browser or a process,
    /// which is the reason it is a pure function taking a reader. The three real
    /// entry points differ only in where the strings come from.
    #[test]
    fn not_asking_for_a_real_floor_leaves_the_demo_floor_alone() {
        let none = parse_request(
            false,
            |_| Some("3".into()),
            |key, value| RealFloorRequestError::InvalidQuery { key, value },
        );
        assert!(none.is_none(), "an unrequested flag must not build a floor");
    }

    #[test]
    fn a_bare_request_takes_the_documented_defaults() {
        let r = parse_request(
            true,
            |_| None,
            |key, value| RealFloorRequestError::InvalidQuery { key, value },
        );
        assert_eq!(
            r,
            Some(Ok(RealFloorRequest {
                level: DEFAULT_LEVEL,
                run_seed: DEFAULT_RUN_SEED
            }))
        );
    }

    /// A junk argument is REFUSED, not rounded down to a default. The difference
    /// matters because the default builds a perfectly good floor, so a lenient
    /// parser turns "I tested level 12" into a screenshot of level 1.
    #[test]
    fn a_bad_argument_is_refused_rather_than_defaulted() {
        let bad = |key, value| RealFloorRequestError::InvalidQuery { key, value };
        for (k, v) in [
            ("level", "banana"),
            ("level", "0"),
            ("level", "-3"),
            ("seed", "x"),
        ] {
            let r = parse_request(true, |want| (want == k).then(|| v.to_string()), bad);
            assert_eq!(
                r,
                Some(Err(RealFloorRequestError::InvalidQuery {
                    key: k,
                    value: v.into()
                })),
                "?{k}={v} should have been refused"
            );
        }
        // …and a good one still parses, so the test above is not passing because
        // everything is refused.
        let ok = parse_request(
            true,
            |k| Some(if k == "level" { "7" } else { "42" }.into()),
            bad,
        );
        assert_eq!(
            ok,
            Some(Ok(RealFloorRequest {
                level: 7,
                run_seed: 42
            }))
        );
    }

    #[test]
    fn every_request_error_says_something() {
        for e in [
            RealFloorRequestError::BrowserContextMissing,
            RealFloorRequestError::QueryReadFailed,
            RealFloorRequestError::InvalidQuery {
                key: "level",
                value: "banana".into(),
            },
            RealFloorRequestError::InvalidCli {
                argument: "--level x".into(),
            },
            RealFloorRequestError::InvalidEnvironment {
                key: "PK_SEED",
                value: "".into(),
            },
        ] {
            assert!(!e.to_string().is_empty(), "{e:?} formats to nothing");
        }
    }

    /// ── THE RENDERER ────────────────────────────────────────────────────────
    ///
    /// The half of the plan a pk-core test cannot reach: an 87×61 generated grid
    /// goes through the SAME `plan_walls` the demo floor does, produces non-empty
    /// buckets, and is not silently clipped to a demo-sized allocation.
    #[test]
    fn the_generated_floor_plans_real_wall_geometry() {
        let floor = pinned();
        let g = &floor.track.grid;
        assert_eq!(
            (g.w, g.h),
            (87, 61),
            "the grid is not the size the spec asked for"
        );

        let plan = plan_walls(g);
        assert!(plan.batched_entities() > 1, "no batched wall entities");
        assert!(plan.stats.wall_tiles > 0, "a floor with no walls");
        // MEASURED, not guessed. This floor plans 1,825 candidate wall tiles and
        // the occlusion cull buries 958 of them (52%), leaving 867 drawn — a
        // yield in the same band as `dungeon_render`'s own two fixtures, which
        // is the point: the generated floor is not a different KIND of input to
        // the renderer. The first version of this assertion demanded the cull
        // keep more than half and failed on the real number; a threshold that
        // has to be relaxed on first contact was never a measurement.
        //
        // The floor is bounded well below the real figure so a corridor-width
        // change does not fail a test about the renderer, and well above zero so
        // an empty room cannot pass.
        assert!(
            plan.stats.drawn > 300,
            "only {} wall tiles survived the cull of {} candidates — this floor would render \
             nearly empty",
            plan.stats.drawn,
            plan.stats.candidates
        );
        // Every candidate is accounted for, so a bucketing change cannot quietly
        // drop a family of walls into neither column.
        assert_eq!(plan.stats.drawn + plan.stats.culled, plan.stats.candidates);
        assert_eq!(plan.stats.tiles, (g.w as usize) * (g.h as usize));
        // At pass 9 no arc has been published (pass 10 does that), so the arc
        // bucket must be EMPTY — a non-empty one would mean the port had run
        // ahead into a pass that has not landed.
        assert!(
            plan.arcs.is_empty() && plan.stats.arc_segments == 0,
            "arc geometry exists at pass {PASSES_LANDED}, before `publish-arcs` has landed"
        );
    }

    /// The marker sits on the exit TILE, and that tile is somewhere a player can
    /// stand — a marker inside stone is worse than no marker, because it reads
    /// as an exit that cannot be reached.
    #[test]
    fn the_exit_marker_lands_on_a_walkable_exit_tile() {
        let floor = pinned();
        assert!(floor.exit_marker_is_on_its_tile());
        let t = floor.info.provisional_exit_tile;
        assert!(is_walkable(&floor.track.grid, t.i, t.j));
        let tf = floor.exit_marker_transform();
        assert_eq!(tf.translation.x, floor.info.provisional_exit_world.0 as f32);
        assert_eq!(tf.translation.z, floor.info.provisional_exit_world.1 as f32);
    }

    /// The banner names the floor on screen. Asserted on CONTENT rather than
    /// length, because the whole job of the banner is that a screenshot says
    /// which floor it is showing.
    #[test]
    fn the_banner_identifies_the_floor_it_is_showing() {
        let floor = pinned();
        let b = floor.banner();
        for want in ["REAL FLOOR", "L3", "seed=1", "87x61", "provisional", "P9"] {
            assert!(b.contains(want), "banner is missing {want:?}: {b}");
        }
        // The archetype, from the table rather than from a literal here — L3 is
        // a Great Hall, and a banner that hard-coded a name would be wrong on
        // four levels out of five.
        assert!(
            b.contains(floor.spec.archetype.label),
            "banner does not name the archetype: {b}"
        );
        // ASCII ONLY. Bevy's `default_font` covers Latin-1 printable and little
        // else; the first version used `×` for the grid size and drew a tofu box
        // on screen while this test — asserting the string contained `87×61` —
        // was green. The test now asserts the PROPERTY that was violated rather
        // than the character that happened to violate it.
        assert!(
            b.is_ascii(),
            "the banner carries a non-ASCII character the default font may not have: {b}"
        );
    }

    /// The telemetry payload is JSON, and it carries what the browser gate reads.
    /// Parsed rather than string-matched: a hand-formatted payload with one
    /// missing brace is a gate that reports "wasm booted" and nothing else.
    #[test]
    fn the_telemetry_payload_parses_and_carries_the_probe() {
        let floor = pinned();
        let v: serde_json::Value =
            serde_json::from_str(&floor.telemetry_json()).expect("__pk.floor is valid JSON");
        assert_eq!(v["source"], "track-floor");
        assert_eq!(v["level"], 3);
        assert_eq!(v["runSeed"], 1);
        assert_eq!(v["debugBanner"], true);
        assert_eq!(v["w"], 87);
        assert_eq!(v["h"], 61);
        assert_eq!(v["startTile"][0], floor.info.start_tile.i);
        assert_eq!(v["startWorld"][0], floor.info.start_world.0);
        assert_eq!(v["pathDistance"], floor.info.path_distance);
        let p = floor
            .info
            .wall_probe
            .as_ref()
            .expect("pinned floor has a probe");
        assert_eq!(v["wallProbe"]["maxAllowedTravel"], p.max_allowed_travel);
        assert_eq!(v["wallProbe"]["ticks"], p.ticks);
        assert_eq!(
            v["wallProbe"]["expectedBlockedAxis"],
            p.expected_blocked_axis
        );
    }

    /// The immutability guard fires when the grid moves, and only then. A guard
    /// that never fails is a guard nobody has armed — measured here rather than
    /// asserted in the doc comment.
    #[test]
    fn the_immutability_guard_passes_a_clone_and_fails_a_mutation() {
        let floor = pinned();
        let clean = floor.track.grid.clone();
        assert!(floor.assert_grid_still_authored(&clean).is_ok());

        let mut dirty = floor.track.grid.clone();
        pk_core::grid::set_tile(&mut dirty, 1, 1, pk_core::grid::T_FLOOR);
        let err = floor
            .assert_grid_still_authored(&dirty)
            .expect_err("a mutated grid must be caught");
        assert!(err.contains("drifted"), "unhelpful message: {err}");
    }
}
