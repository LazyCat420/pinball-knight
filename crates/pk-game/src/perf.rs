//! **B2 — the frame-time series, measured IN-ENGINE.**
//!
//! ## Why this exists
//!
//! B1 (`pk-core`'s `perf_suite` example) priced the simulation and the answer
//! reordered the whole performance story: the worst tick in the game — the
//! pinball ride, sub-stepping — is **299 ns**, and a frame at the measured
//! 32 fps is **31 ms**. That is about one part in 100,000. The obvious
//! objection, *a debug Bevy build is several times slower than the shipped one
//! so these are numbers about the build*, was **tested rather than assumed and
//! is false**: a release wasm build measures 32.1 fps against debug's 31.3.
//!
//! So every millisecond that costs anything is render-side, and until this
//! module existed **nothing in this project could see inside it.** The entire
//! performance story was one line of `pk-check` output (`render FPS: 31.3`)
//! with no budget, no history and no scene breakdown.
//!
//! ## The one design decision, and it is not stylistic
//!
//! **This ACCUMULATES every frame and PUBLISHES on a cadence. Never the other
//! way round.** `publish_stats` samples every 5 frames, and this project has
//! already paid for that once: `FloorLoading` lives ~300 ms, the first five
//! frames of a cold wasm boot take longer than that, and the state was entered,
//! painted and left without the probe publishing once — a state invisible to
//! the only instrument that could see it. A *sampled* frame time misses exactly
//! the excursions a budget is about: at a 5-frame cadence a single 200 ms hitch
//! has four chances in five of never being seen, and the p95 it is missing from
//! is the number that decides whether the game feels right.
//!
//! `SnapPeak` learned the same lesson from the other side — a Playwright poll
//! every ~50 ms read one frame in three and reported a peak 7.4× low, which is
//! why the tavern's sprite drift was written off as too small to matter.
//!
//! ## What it reports, and why each column
//!
//! `p50` is the typical frame, `p95` is the one the player notices, `max` is
//! the hitch, and `n` is how many frames the window actually holds — published
//! because **a percentile over 4 frames is not a percentile**, and a reader who
//! cannot see the count cannot tell a quiet measurement from an empty one.
//!
//! Beside them the counts that EXPLAIN a number rather than restate it:
//! entities, drawn meshes, lights and materials. B2's first question is already
//! set by B1 — 31 ms a frame, of which the sim is 0.0003 ms — so the first
//! suspect to price is the post chain at 1920×1080, the one pass that costs the
//! same whether the dungeon has 102 parts on it or none. A scene-count sweep
//! (an empty floor against L5's 121 parts) separates *the room is expensive*
//! from *the chain is*, and that sweep is only readable if the counts ride
//! beside the timings in the same sample.
//!
//! ## What it deliberately does NOT do
//!
//! It does not assert a budget. Three green baselines on a quiet box, then
//! band — a budget with no recorded baseline behind it is a wish, and this
//! project rejected two of those from handed-in blueprints already (`<30 s
//! bake`, `60 FPS on low-power devices`).
//!
//! It does not report a GPU/CPU split yet. Bevy's render diagnostics are behind
//! a feature this workspace does not enable, and inventing the split from
//! wall-clock would be a number worse than no number.
//!
//! PORTS-NOTHING: this is an instrument, not a port. The oracle's own
//! `engine/profiler.ts` is a separate 271-line file and is still NOT STARTED —
//! when it lands it is a peer of this module, not a replacement: it measures
//! the TypeScript frame and this measures the Rust one, and B3's whole job is
//! to put those two numbers side by side on the same scene.

use bevy::prelude::*;

/// How many frames the rolling window holds.
///
/// 240 is four seconds at 60 fps and eight at the 31 fps this build actually
/// runs at — long enough that a p95 has twelve samples above the line, short
/// enough that the window still describes *now* rather than the last minute.
/// A gate that wants a specific interval calls [`PerfWindow::reset`] and reads
/// `n` to prove the interval it got.
pub const WINDOW: usize = 240;

/// The per-frame accumulator. See the module header for why it is not a probe.
#[derive(Resource, Debug)]
pub struct PerfWindow {
    /// Frame durations in ms, oldest-first, capped at [`WINDOW`].
    ms: Vec<f32>,
    /// Total frames observed since the last [`reset`](Self::reset) — NOT
    /// `ms.len()`, which saturates. A reader needs both: `n` says how much of
    /// the window is real, `total` says how long the measurement has run.
    total: u64,
    /// Frames dropped off the front of the window since the last reset.
    dropped: u64,
}

impl Default for PerfWindow {
    fn default() -> Self {
        Self {
            ms: Vec::with_capacity(WINDOW),
            total: 0,
            dropped: 0,
        }
    }
}

impl PerfWindow {
    /// Record one frame. Called from `Last`, every frame, unconditionally.
    pub fn push(&mut self, ms: f32) {
        // A non-finite delta is not a slow frame, it is a broken clock — and
        // one NaN poisons every percentile after it, silently, because NaN
        // compares false against everything a sort asks. Dropped from the
        // window and COUNTED, so "the numbers look fine" cannot be the report
        // when the clock has failed.
        if !ms.is_finite() || ms < 0.0 {
            self.dropped += 1;
            return;
        }
        if self.ms.len() == WINDOW {
            self.ms.remove(0);
        }
        self.ms.push(ms);
        self.total += 1;
    }

    /// Clear the window. A harness calls this to bound a measurement to an
    /// interval it chose, rather than to whatever happened to be in flight.
    pub fn reset(&mut self) {
        self.ms.clear();
        self.total = 0;
        self.dropped = 0;
    }

    /// Frames currently in the window.
    pub fn n(&self) -> usize {
        self.ms.len()
    }

    pub fn total(&self) -> u64 {
        self.total
    }

    pub fn dropped(&self) -> u64 {
        self.dropped
    }

    /// The `q`-th percentile of the window, in ms. `None` on an empty window —
    /// **not** 0.0, which a reader cannot tell from a genuinely free frame.
    ///
    /// Nearest-rank on a sorted copy: no interpolation, so the number returned
    /// is a frame that actually happened. With `WINDOW` at 240 the sort is
    /// ~240 elements once per publish, not once per frame.
    pub fn pct(&self, q: f32) -> Option<f32> {
        if self.ms.is_empty() {
            return None;
        }
        let mut v = self.ms.clone();
        v.sort_by(|a, b| {
            a.partial_cmp(b)
                .expect("non-finite values are refused at push")
        });
        let rank = (q.clamp(0.0, 1.0) * (v.len() - 1) as f32).round() as usize;
        Some(v[rank])
    }

    pub fn max(&self) -> Option<f32> {
        self.ms
            .iter()
            .copied()
            .fold(None, |m: Option<f32>, x| Some(m.map_or(x, |m| m.max(x))))
    }

    pub fn min(&self) -> Option<f32> {
        self.ms
            .iter()
            .copied()
            .fold(None, |m: Option<f32>, x| Some(m.map_or(x, |m| m.min(x))))
    }

    pub fn mean(&self) -> Option<f32> {
        if self.ms.is_empty() {
            return None;
        }
        Some(self.ms.iter().sum::<f32>() / self.ms.len() as f32)
    }
}

/// The scene counts published beside the timings — what a frame was ASKED to
/// draw, so a timing can be explained rather than merely recorded.
#[derive(Resource, Debug, Default, Clone, Copy)]
pub struct SceneCensus {
    pub entities: u32,
    /// Entities carrying a `Mesh3d` — after the merge, so this is closer to a
    /// draw count than an object count. The merge is why: `authored_render`
    /// buckets a whole floor into a handful of meshes, and counting tiles here
    /// would report a number the GPU never sees.
    pub meshes: u32,
    pub lights: u32,
    pub materials: u32,
    /// UI nodes — the GUI layer is an immediate-mode stack that repaints into
    /// a texture, and it cost more than half the frame rate once already
    /// (36 fps → 14) by rebuilding PIXELS rather than widgets.
    pub ui_nodes: u32,
}

pub struct PerfPlugin;

impl Plugin for PerfPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<PerfWindow>()
            .init_resource::<SceneCensus>()
            // `Last`, so the frame being measured is the whole frame: every
            // Update system, the extract, and the render schedule that follows
            // them. Measuring in `Update` would time the half of the frame this
            // module is least interested in.
            .add_systems(Last, (reset_on_scene_change, accumulate, census).chain());
        #[cfg(not(target_arch = "wasm32"))]
        if perf_log_secs().is_some() {
            app.add_systems(Last, log_rows.after(accumulate).after(census));
        }
    }
}

/// **The exe's capture path**, and it is the one piece B3 called new work
/// rather than wiring.
///
/// `--perf-log [seconds]` (or `PK_PERF_LOG=<seconds>`) makes the native and
/// Windows builds print one [`perf_json`] row to stdout at that interval. The
/// play target is the Windows exe, so the number that decides *does it feel
/// right* is the release exe's frame time — and until this existed there was no
/// way to get one out of it at all. The browser's `__pk.perf` is reachable over
/// CDP; a windowed exe on the host desktop is not, and pasting an on-screen
/// readout into a chat window is not a measurement.
///
/// ⚠️ **THE FLAG EXISTS BECAUSE THE ENV VAR CANNOT REACH THE PLAY TARGET, AND
/// THIS SHIPPED ENV-ONLY FIRST.** `scripts/pk-win.sh run` launches the `.exe`
/// through WSL2 interop with a plain `exec`, and **a WSL-side environment
/// variable does not cross into a Windows process unless it is named in
/// `WSLENV`** — which is empty on this box. So `PK_PERF_LOG=2 pk-win.sh run`
/// starts the game, renders on the host GPU, and prints nothing, for ever. The
/// instrument was unusable on precisely the target it was built for, and the
/// failure is *silence*, which is indistinguishable from "the feature works and
/// the frames are fine".
///
/// The flag has no such problem: `pk-win.sh run` forwards its remaining
/// arguments straight to the game, so the switch travels by the same channel as
/// `--tavern` and `--level`. **When a feature's only control channel is one the
/// launcher does not carry, the feature does not exist on that target.**
///
/// Off unless asked for: a game that writes to stdout every second is a game
/// whose stdout nobody reads.
#[cfg(not(target_arch = "wasm32"))]
fn perf_log_secs() -> Option<f32> {
    let args: Vec<String> = std::env::args().collect();
    let argv: Vec<&str> = args.iter().map(String::as_str).collect();
    let env = std::env::var("PK_PERF_LOG").ok();
    resolve_perf_log(&argv, env.as_deref())
}

/// The interval rule, as a pure function of the two inputs.
///
/// ⚠️ **THE REAL PATH CALLS THIS — it is not a test-side copy.** A second
/// implementation that a test drives while the shipping code keeps its own is a
/// pair free to drift, and the test cannot see it happen. [`perf_log_secs`] does
/// nothing but read `std::env::args()` and the environment and hand them here,
/// because neither is safe to set from a test: `set_var` is `unsafe` and racy
/// across the threads sharing this test binary.
///
/// The CLI wins over the environment, matching `read_floor_plan`'s precedence —
/// the environment is the thing you forgot was exported.
#[cfg(not(target_arch = "wasm32"))]
fn resolve_perf_log(args: &[&str], env: Option<&str>) -> Option<f32> {
    if let Some(k) = args.iter().position(|a| *a == "--perf-log") {
        // The value is OPTIONAL and is taken only when it actually parses as a
        // positive number. `--perf-log --tavern` must mean "every second, and
        // also open the tavern" — swallowing the next token would eat a flag
        // and leave the caller debugging why the tavern never opened.
        return Some(
            args.get(k + 1)
                .and_then(|v| v.parse::<f32>().ok())
                .filter(|v| *v > 0.0)
                .unwrap_or(1.0),
        );
    }
    // `PK_PERF_LOG=1` is the obvious thing to type and must mean "every
    // second", not "on". A bare `=on`/`=true` gets the same default rather
    // than being silently ignored — an instrument that declines to run because
    // its argument was spelled unexpectedly reads as a broken build.
    match env?.trim() {
        "" | "0" => None,
        "on" | "true" | "yes" => Some(1.0),
        s => s.parse::<f32>().ok().filter(|v| *v > 0.0).or(Some(1.0)),
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn log_rows(
    time: Res<Time>,
    win: Res<PerfWindow>,
    census: Res<SceneCensus>,
    state: Res<bevy::state::state::State<crate::AppState>>,
    mut acc: Local<f32>,
) {
    let every = perf_log_secs().unwrap_or(1.0);
    *acc += time.delta_secs();
    if *acc < every {
        return;
    }
    *acc = 0.0;
    // The SCENE rides on the row. Every scene in this game has a different
    // cost profile — the tavern repaints a GUI texture, the dungeon draws a
    // floor, the intro runs a CPU canvas — and a series that does not say which
    // one it was measuring is a series nobody can compare against another.
    println!(
        r#"PK_PERF {{"scene":"{:?}","t":{:.1},{}"#,
        state.get(),
        time.elapsed_secs(),
        &perf_json(&win, &census)[1..]
    );
}

fn accumulate(time: Res<Time>, mut win: ResMut<PerfWindow>) {
    win.push(time.delta_secs() * 1000.0);
}

/// **A window that spans a scene change describes neither scene.**
///
/// The four scenes have four different cost profiles — the tavern repaints a
/// GUI texture, the dungeon draws a merged floor, the intro runs a CPU canvas
/// — and 240 frames is four seconds, which is long enough to straddle a
/// descend. Without this, the first four seconds of every dungeon carry the
/// tavern's frames inside their own p95, and the p95 of a hand-off is a number
/// about neither room.
///
/// It also makes the two ugliest frames in the game legible instead of
/// contagious: entering a scene compiles pipelines, and on a cold wasm boot
/// Bevy's first two `Update`s can be ~2.5 s apart. Those belong to the scene
/// that paid for them — `total` and `max` still show them — but they must not
/// be smeared across the scene that follows.
fn reset_on_scene_change(
    state: Res<bevy::state::state::State<crate::AppState>>,
    mut win: ResMut<PerfWindow>,
    mut last: Local<Option<crate::AppState>>,
) {
    let now = *state.get();
    if *last != Some(now) {
        // Not on the very first frame: there is nothing to clear, and clearing
        // would only cost a `ResMut` deref that marks the resource changed.
        if last.is_some() {
            win.reset();
        }
        *last = Some(now);
    }
}

fn census(
    mut census: ResMut<SceneCensus>,
    entities: Query<()>,
    meshes: Query<(), With<Mesh3d>>,
    point: Query<(), With<PointLight>>,
    dir: Query<(), With<DirectionalLight>>,
    spot: Query<(), With<SpotLight>>,
    mats: Res<Assets<StandardMaterial>>,
    ui: Query<(), With<Node>>,
) {
    // Written through the resource rather than queried at publish time so the
    // counts belong to the SAME frame as the timing beside them. Pairing a
    // count taken now with a p95 taken over the last four seconds is a real
    // hazard, but pairing it with a count from a different frame is a silly
    // one, and this is the cheap half to get right.
    let next = SceneCensus {
        entities: entities.iter().count() as u32,
        meshes: meshes.iter().count() as u32,
        lights: (point.iter().count() + dir.iter().count() + spot.iter().count()) as u32,
        materials: mats.len() as u32,
        ui_nodes: ui.iter().count() as u32,
    };
    // `ResMut` marks a resource changed on the DEREF, not on a value change —
    // the tavern's repaint skip died on exactly this — so compare first.
    if next.entities != census.entities
        || next.meshes != census.meshes
        || next.lights != census.lights
        || next.materials != census.materials
        || next.ui_nodes != census.ui_nodes
    {
        *census = next;
    }
}

/// The `__pk.perf` payload. One line, so a harness can `JSON.parse` it and a
/// human can read it in a console without unfolding anything.
///
/// Every field that can be absent is `null` rather than a sentinel: `-1` and
/// `0` are both values a frame time could legitimately be near, and a gate that
/// cannot tell "no samples" from "a very fast frame" will eventually report the
/// wrong one. The build's identity rides along because **debug ≠ release ≠ wasm
/// ≠ exe** — four builds, four cost profiles — and a row without its target is
/// not a measurement anyone can reuse.
pub fn perf_json(win: &PerfWindow, census: &SceneCensus) -> String {
    let f = |v: Option<f32>| v.map_or("null".to_string(), |x| format!("{x:.3}"));
    format!(
        r#"{{"n":{},"total":{},"dropped":{},"p50":{},"p95":{},"p99":{},"max":{},"min":{},"mean":{},"entities":{},"meshes":{},"lights":{},"materials":{},"uiNodes":{},"build":"{}","target":"{}"}}"#,
        win.n(),
        win.total(),
        win.dropped(),
        f(win.pct(0.50)),
        f(win.pct(0.95)),
        f(win.pct(0.99)),
        f(win.max()),
        f(win.min()),
        f(win.mean()),
        census.entities,
        census.meshes,
        census.lights,
        census.materials,
        census.ui_nodes,
        if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        },
        BUILD_TARGET,
    )
}

/// Which of the four cost profiles this binary is.
pub const BUILD_TARGET: &str = if cfg!(target_arch = "wasm32") {
    "wasm"
} else if cfg!(target_os = "windows") {
    "windows"
} else {
    "native"
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_window_reports_null_and_not_zero() {
        let w = PerfWindow::default();
        assert_eq!(w.n(), 0);
        assert!(w.pct(0.5).is_none() && w.max().is_none() && w.mean().is_none());
        let j = perf_json(&w, &SceneCensus::default());
        assert!(j.contains(r#""p50":null"#), "{j}");
        assert!(j.contains(r#""max":null"#), "{j}");
        // The distinction this test exists for: a reader must be able to tell
        // "no samples" from "a 0 ms frame".
        assert!(!j.contains(r#""p50":0.000"#), "{j}");
    }

    #[test]
    fn the_percentiles_are_frames_that_happened() {
        let mut w = PerfWindow::default();
        // 101 samples, not 100, so the median is UNAMBIGUOUS: nearest-rank on
        // an even count has to pick a side, and a test that pins which side is
        // testing the rounding rule rather than the percentile. `1..=101` has
        // a real middle element and 51.0 is it.
        for i in 1..=101 {
            w.push(i as f32);
        }
        assert_eq!(w.n(), 101);
        // Nearest-rank on `q * (n-1)`, no interpolation: every answer below is
        // a frame that actually happened, which is the point — an interpolated
        // p95 is a frame time no frame ever had.
        assert_eq!(w.pct(0.0), Some(1.0));
        assert_eq!(w.pct(0.5), Some(51.0));
        assert_eq!(w.pct(0.95), Some(96.0));
        assert_eq!(w.pct(1.0), Some(101.0));
        assert_eq!(w.max(), Some(101.0));
        assert_eq!(w.min(), Some(1.0));
        assert_eq!(w.mean(), Some(51.0));
        // Out-of-range quantiles clamp rather than panic — a caller passing a
        // percent instead of a fraction gets the max, not a crash mid-frame.
        assert_eq!(w.pct(95.0), Some(101.0));
        assert_eq!(w.pct(-1.0), Some(1.0));
    }

    /// **The property the whole module is for.** A hitch inside the window must
    /// survive into `max` and `p99` no matter where it landed — this is the
    /// failure mode a SAMPLED probe has and an accumulator does not.
    #[test]
    fn a_single_hitch_anywhere_in_the_window_is_never_lost() {
        for position in [0usize, 1, 7, 119, 238, 239] {
            let mut w = PerfWindow::default();
            for i in 0..WINDOW {
                w.push(if i == position { 200.0 } else { 16.0 });
            }
            assert_eq!(w.n(), WINDOW);
            assert_eq!(w.max(), Some(200.0), "hitch at {position} was lost");
            assert_eq!(w.pct(1.0), Some(200.0), "hitch at {position} missed p100");
            // And it must NOT drag the typical frame — that is the other half
            // of why p50 and max are both published.
            assert_eq!(w.pct(0.5), Some(16.0), "hitch at {position} moved p50");
        }
        // The contrast, stated as an assertion rather than a comment: a probe
        // that read one frame in five would have seen this hitch four times in
        // five... never. 239 of the 240 offsets are invisible to a 5-frame
        // sampler that happens to be out of phase with it.
        let seen = (0..WINDOW).filter(|i| i % 5 == 0).count();
        assert_eq!(seen, 48, "a 5-frame sampler sees 48 of 240 frames");
    }

    #[test]
    fn the_window_saturates_but_the_total_does_not() {
        let mut w = PerfWindow::default();
        for i in 0..(WINDOW * 2) {
            w.push(i as f32);
        }
        assert_eq!(w.n(), WINDOW, "the window is capped");
        assert_eq!(w.total(), (WINDOW * 2) as u64, "the total is not");
        // It kept the NEWEST frames, which is what makes it describe `now`.
        assert_eq!(w.min(), Some(WINDOW as f32));
        assert_eq!(w.max(), Some((WINDOW * 2 - 1) as f32));
    }

    /// One NaN must not be able to quietly rewrite every percentile after it.
    #[test]
    fn a_broken_clock_is_refused_and_counted_rather_than_averaged_in() {
        let mut w = PerfWindow::default();
        w.push(16.0);
        w.push(f32::NAN);
        w.push(f32::INFINITY);
        w.push(-1.0);
        w.push(18.0);
        assert_eq!(w.n(), 2, "only the finite frames are in the window");
        assert_eq!(w.dropped(), 3, "and the rest are REPORTED, not swallowed");
        assert_eq!(w.min(), Some(16.0));
        assert_eq!(w.max(), Some(18.0));
        assert_eq!(w.mean(), Some(17.0), "the NaN did not reach the average");
        assert!(perf_json(&w, &SceneCensus::default()).contains(r#""dropped":3"#));
    }

    #[test]
    fn a_reset_bounds_the_measurement_to_the_interval_a_harness_chose() {
        let mut w = PerfWindow::default();
        for _ in 0..50 {
            w.push(100.0);
        }
        w.reset();
        assert_eq!((w.n(), w.total(), w.dropped()), (0, 0, 0));
        for _ in 0..10 {
            w.push(16.0);
        }
        assert_eq!(w.max(), Some(16.0), "the pre-reset frames are gone");
        assert_eq!(w.n(), 10, "and `n` proves the interval it actually got");
    }

    /// **The flag must reach the play target, and the env var cannot.**
    ///
    /// This shipped env-only and was unusable on the Windows exe: `pk-win.sh
    /// run` `exec`s the `.exe` through WSL2 interop, and a WSL-side environment
    /// variable does not cross into a Windows process unless it is named in
    /// `WSLENV` — which is empty here. The game rendered on the host GPU and
    /// printed nothing, which looks exactly like a healthy silent build.
    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    fn the_interval_comes_from_the_flag_the_launcher_actually_forwards() {
        // Bare flag → the default second. This is the form `pk-win.sh run
        // --release --perf-log` produces, and the one the env var could not.
        assert_eq!(
            resolve_perf_log(&["pk-game", "--perf-log"], None),
            Some(1.0)
        );
        // With a value.
        assert_eq!(
            resolve_perf_log(&["pk-game", "--perf-log", "2.5"], None),
            Some(2.5)
        );
        // ⚠️ The value is optional, so the next token must NOT be swallowed
        // when it is another flag — otherwise `--perf-log --tavern` silently
        // drops the tavern and the caller debugs the wrong thing.
        assert_eq!(
            resolve_perf_log(&["pk-game", "--perf-log", "--tavern"], None),
            Some(1.0)
        );
        // The CLI beats the environment, which is the thing you forgot was
        // exported.
        assert_eq!(
            resolve_perf_log(&["pk-game", "--perf-log", "3"], Some("9")),
            Some(3.0)
        );
        // Env still works where it CAN be delivered (native runs, CI).
        assert_eq!(resolve_perf_log(&["pk-game"], Some("2")), Some(2.0));
        assert_eq!(resolve_perf_log(&["pk-game"], Some("on")), Some(1.0));
        // Off by default, and explicitly off.
        assert_eq!(resolve_perf_log(&["pk-game"], None), None);
        assert_eq!(resolve_perf_log(&["pk-game"], Some("0")), None);
        assert_eq!(resolve_perf_log(&["pk-game"], Some("")), None);
        // A nonsense value asks for the instrument rather than declining it —
        // a run that goes quiet because an argument was spelled oddly reads as
        // a broken build.
        assert_eq!(resolve_perf_log(&["pk-game"], Some("banana")), Some(1.0));
        // A non-positive interval would print every frame; refuse it.
        assert_eq!(resolve_perf_log(&["pk-game"], Some("-1")), Some(1.0));
        assert_eq!(
            resolve_perf_log(&["pk-game", "--perf-log", "-1"], None),
            Some(1.0)
        );
    }

    /// A row without its target is not a measurement anyone can reuse.
    #[test]
    fn every_row_carries_the_build_it_came_from() {
        let j = perf_json(&PerfWindow::default(), &SceneCensus::default());
        assert!(
            j.contains(r#""build":"debug""#) || j.contains(r#""build":"release""#),
            "{j}"
        );
        assert!(j.contains(&format!(r#""target":"{BUILD_TARGET}""#)), "{j}");
        assert!(["wasm", "windows", "native"].contains(&BUILD_TARGET));
    }
}
