//! **B1 — the sim's performance suite: headless, GPU-free, deterministic.**
//!
//! ```text
//! cargo run --release -p pk-core --example perf_suite            # the table
//! cargo run --release -p pk-core --example perf_suite -- --json  # one row per case
//! cargo run --release -p pk-core --example perf_suite -- --reps 9
//! ```
//!
//! ## Why this exists, and why it is not `cargo bench`
//!
//! Every performance number this project had produced before this file was a
//! *browser* number for a WHOLE FRAME: `pk-check` prints one `render FPS` line,
//! the dungeon banner prints a frame time, and neither has a budget, a history
//! or a breakdown behind it. Nobody could say what the sim costs.
//!
//! Now they can, and the answer reframes the question. The worst tick here — the
//! pinball ride, sub-stepping — is **299 ns**. A frame at the measured 32 fps is
//! **31 ms**. The sim is one part in a hundred thousand of it, and a release
//! wasm build measures 32.1 fps against debug's 31.3, so the build is not it
//! either. **Everything that costs anything is render-side**, and this file's
//! most useful output is the evidence for looking there instead.
//!
//! This measures the half that needs no GPU, which is the half CI can own: the
//! deterministic core. It is an example rather than a `#[bench]` because the
//! bench harness is nightly-only, and rather than criterion because the
//! workspace has no criterion and one dependency is a real cost for a table of
//! medians.
//!
//! ## The three rules this harness is built on
//!
//! 1. **A single number is not a measurement.** Every case is run `--reps`
//!    times and reports median, min, max and the spread as a percentage. On this
//!    box — shared, 24 threads, other agents building — the spread IS the
//!    result: a case whose max is triple its median has not been measured, it
//!    has been sampled during someone else's link step.
//! 2. **No budgets yet, on purpose.** A budget derived from a wish is how
//!    "<30 s bake" and "60 FPS on low-power devices" got into two blueprints and
//!    out again. Record first; set the band from three green baselines; only
//!    then let it gate.
//! 3. **The build is part of the number**, so the header prints the profile and
//!    `--json` carries it on every row. Note that "debug is several times
//!    slower" is an assumption about THIS code, not a law: measured on the whole
//!    frame it was false. Label the profile; do not predict its effect.
//!
//! ## What each case is, and why it is the one worth timing
//!
//! | case | why |
//! |---|---|
//! | `simulate_idle` | the floor of every frame: one tick with no input |
//! | `simulate_walk` | the walking path — accel ramp, floor drag, `move_circle` |
//! | `simulate_pinball` | the RIDE. `move_circle` sub-steps above `MAX_STEP`, so the cost cliff only appears at speed and a walk-only benchmark would never find it |
//! | `move_circle` | the innermost loop of the whole game, called direct |
//! | `build_floor_L{1,3,5}` | the generator, all nine landed passes, per level — nobody knows which pass is expensive and this is the instrument that will say |
//! | `bfs_distances` | the horde's field, rebuilt whenever the target moves |
//! | `flow_step_x1000` | one steering decision, ×1000 — the per-monster per-frame cost, measured before there are 72 monsters to be slow |
//! | `js_pow` / `js_hypot` | **the price of determinism.** Both exist because V8 and libm disagree; the port pays that price on every target and has never once measured it. Printed beside `std` so the ratio is visible |

use std::time::{Duration, Instant};

use pk_core::collide::move_circle;
use pk_core::flow_field::{bfs_distances, flow_step};
use pk_core::grid::{is_walkable, Grid};
use pk_core::jsmath::{js_hypot, js_pow};
use pk_core::maze::floor_spec::{
    build_track_floor_from_spec, derive_floor_spec, validate_runtime_floor,
};
use pk_core::state::{simulate, FrameInput, SimState};

/// One case's timings, in nanoseconds per iteration.
struct Row {
    name: &'static str,
    unit: &'static str,
    /// Per-rep nanoseconds-per-iteration, sorted.
    ns: Vec<f64>,
}

impl Row {
    fn median(&self) -> f64 {
        self.ns[self.ns.len() / 2]
    }
    fn min(&self) -> f64 {
        self.ns[0]
    }
    fn max(&self) -> f64 {
        self.ns[self.ns.len() - 1]
    }
    /// (max - min) / median, as a percentage. The honesty column.
    fn spread(&self) -> f64 {
        100.0 * (self.max() - self.min()) / self.median()
    }
}

/// Run `body` `reps` times, `iters` iterations each, and keep ns-per-iteration.
///
/// One untimed warm-up rep first: the first pass through a case pays for cold
/// caches and, on the floor builder, for the allocator's first big growth. That
/// cost is real but it is not the steady state a budget is about, and including
/// it inflates the spread column that is supposed to detect box noise.
fn bench(
    name: &'static str,
    unit: &'static str,
    reps: usize,
    iters: u32,
    mut body: impl FnMut(),
) -> Row {
    for _ in 0..iters.min(4) {
        body();
    }
    let mut ns = Vec::with_capacity(reps);
    for _ in 0..reps {
        let t0 = Instant::now();
        for _ in 0..iters {
            body();
        }
        let d: Duration = t0.elapsed();
        ns.push(d.as_secs_f64() * 1e9 / f64::from(iters));
    }
    ns.sort_by(|a, b| a.partial_cmp(b).expect("no NaN in a duration"));
    Row { name, unit, ns }
}

fn arg_usize(name: &str, default: usize) -> usize {
    let mut it = std::env::args();
    while let Some(a) = it.next() {
        if a == name {
            return it.next().and_then(|v| v.parse().ok()).unwrap_or(default);
        }
    }
    default
}

/// The profile this binary was compiled with — the row's most important label.
const PROFILE: &str = if cfg!(debug_assertions) {
    "debug"
} else {
    "release"
};

/// A real floor to walk on: L3 seed 1, the same floor every A/B sheet uses.
///
/// The spawn comes from `validate_runtime_floor`, which is the shell's own
/// route to a start position — a hand-derived tile centre would be timing the
/// sim on a tile the game never opens on.
fn corpus_floor() -> (Grid, (f64, f64), (i32, i32)) {
    let spec = derive_floor_spec(3, 1);
    let floor = build_track_floor_from_spec(&spec).expect("L3 seed 1 builds");
    let info = validate_runtime_floor(&floor).expect("L3 seed 1 is standable");
    (
        floor.grid,
        info.start_world,
        (info.start_tile.i, info.start_tile.j),
    )
}

fn main() {
    let reps = arg_usize("--reps", 5).max(1);
    let json = std::env::args().any(|a| a == "--json");

    let (grid, spawn, (si, sj)) = corpus_floor();
    let walkable = {
        let mut n = 0u32;
        for j in 0..grid.h {
            for i in 0..grid.w {
                if is_walkable(&grid, i, j) {
                    n += 1;
                }
            }
        }
        n
    };
    let dist = bfs_distances(&grid, si, sj);

    let mut rows = Vec::new();

    // ── The sim, one tick at a time, in the three regimes it has ──
    let idle = FrameInput {
        move_x: 0.0,
        move_z: 0.0,
        sprint: false,
        dodge: false,
    };
    let walking = FrameInput {
        move_x: 1.0,
        move_z: 0.0,
        sprint: false,
        dodge: false,
    };
    {
        let mut s = SimState::new(grid.clone(), spawn, 1);
        rows.push(bench("simulate_idle", "tick", reps, 20_000, || {
            simulate(&mut s, &idle);
        }));
    }
    {
        let mut s = SimState::new(grid.clone(), spawn, 1);
        rows.push(bench("simulate_walk", "tick", reps, 20_000, || {
            simulate(&mut s, &walking);
        }));
    }
    {
        // THE RIDE. `move_circle` sub-steps whenever the step exceeds MAX_STEP,
        // so this is the only case that exercises the sub-stepping loop — a
        // walk-speed benchmark reports a cost the game does not pay in the
        // moment that matters.
        // `update_pinball` gates on `mom_speed > 0` — the direction is a unit
        // vector and the speed is the scalar the ride runs on.
        let mut s = SimState::new(grid.clone(), spawn, 1);
        s.player.mom_x = 0.929;
        s.player.mom_z = 0.371;
        s.player.mom_speed = 18.0;
        // PROVE the case rides before timing it. `update_pinball` returns at its
        // first line when `mom_speed <= 0`, so a setup that does not arm the
        // ride produces a plausible number for the wrong branch — the walking
        // path, timed under a pinball label. One tick, and the position has to
        // move by more than a walk could.
        {
            let (x0, z0) = (s.player.x, s.player.z);
            simulate(&mut s, &idle);
            let step = js_hypot(s.player.x - x0, s.player.z - z0);
            assert!(
                step > 0.1,
                "simulate_pinball is not riding: the knight moved {step:.4} \
                 units in one tick with mom_speed {} — timing this would report \
                 the walking branch under a pinball name",
                s.player.mom_speed
            );
        }
        rows.push(bench("simulate_pinball", "tick", reps, 20_000, || {
            // Re-arm whenever the ride bleeds out. Friction and wall hits drain
            // `mom_speed` within a few hundred ticks, and without this the case
            // silently becomes `simulate_idle` with extra steps — a benchmark
            // that stops exercising its subject partway through reports the
            // average of two different things.
            if s.player.mom_speed < 8.0 {
                s.player.mom_x = 0.929;
                s.player.mom_z = 0.371;
                s.player.mom_speed = 18.0;
            }
            simulate(&mut s, &idle);
        }));
    }

    // ── The innermost loop, called direct ──
    rows.push(bench("move_circle", "call", reps, 200_000, || {
        std::hint::black_box(move_circle(
            &grid,
            std::hint::black_box(spawn.0),
            spawn.1,
            0.28,
            0.11,
            0.07,
        ));
    }));

    // ── The generator: all nine landed passes, per level ──
    for level in [1i32, 3, 5] {
        let name: &'static str = match level {
            1 => "build_floor_L1",
            3 => "build_floor_L3",
            _ => "build_floor_L5",
        };
        // The spec is derived OUTSIDE the timed body on purpose: it draws from
        // the floor rng, and re-deriving it per iteration would time the rng
        // stream rather than the passes. `build_track_floor_from_spec` clones
        // the stream, so the same spec builds the same floor every iteration.
        let spec = derive_floor_spec(level, 1);
        rows.push(bench(name, "floor", reps, 8, || {
            std::hint::black_box(build_track_floor_from_spec(&spec).is_ok());
        }));
    }

    // ── The horde's steering, before there is a horde ──
    rows.push(bench("bfs_distances", "field", reps, 40, || {
        std::hint::black_box(bfs_distances(&grid, si, sj));
    }));
    rows.push(bench("flow_step_x1000", "1k steps", reps, 200, || {
        for k in 0..1000i32 {
            let i = (si + k % 17 - 8).clamp(0, grid.w - 1);
            let j = (sj + k % 13 - 6).clamp(0, grid.h - 1);
            std::hint::black_box(flow_step(&grid, &dist, i, j));
        }
    }));

    // ── The price of determinism ──
    rows.push(bench("js_pow", "call", reps, 500_000, || {
        std::hint::black_box(js_pow(std::hint::black_box(1.37), 1.35));
    }));
    rows.push(bench("std_powf", "call", reps, 500_000, || {
        std::hint::black_box(f64::powf(std::hint::black_box(1.37), 1.35));
    }));
    rows.push(bench("js_hypot", "call", reps, 500_000, || {
        std::hint::black_box(js_hypot(std::hint::black_box(0.31), 0.47));
    }));
    rows.push(bench("std_hypot", "call", reps, 500_000, || {
        std::hint::black_box(f64::hypot(std::hint::black_box(0.31), 0.47));
    }));

    if json {
        println!("{{");
        println!("  \"profile\": \"{PROFILE}\",");
        println!("  \"reps\": {reps},");
        println!("  \"floor\": {{ \"level\": 3, \"seed\": 1, \"w\": {}, \"h\": {}, \"walkable\": {walkable} }},", grid.w, grid.h);
        println!("  \"cases\": [");
        for (n, r) in rows.iter().enumerate() {
            println!(
                "    {{ \"name\": \"{}\", \"unit\": \"{}\", \"median_ns\": {:.1}, \"min_ns\": {:.1}, \"max_ns\": {:.1}, \"spread_pct\": {:.1} }}{}",
                r.name,
                r.unit,
                r.median(),
                r.min(),
                r.max(),
                r.spread(),
                if n + 1 == rows.len() { "" } else { "," }
            );
        }
        println!("  ]");
        println!("}}");
        return;
    }

    println!(
        "PK PERF SUITE — {PROFILE} build, {reps} reps, L3 seed 1 ({}x{}, {walkable} walkable)\n",
        grid.w, grid.h
    );
    println!(
        "{:<18} {:>12} {:>12} {:>12} {:>8}  unit",
        "case", "median", "min", "max", "spread"
    );
    for r in &rows {
        println!(
            "{:<18} {:>12} {:>12} {:>12} {:>7.0}%  per {}",
            r.name,
            human(r.median()),
            human(r.min()),
            human(r.max()),
            r.spread(),
            r.unit
        );
    }
    println!(
        "\nspread = (max-min)/median across reps. On a SHARED box a case with a\n\
         large spread has not been measured — re-run it when the box is quiet.\n\
         No budgets are asserted: record three green baselines first, then band."
    );
    if PROFILE == "debug" {
        println!(
            "\n⚠️  DEBUG BUILD. These numbers are several times the shipped cost and\n\
             must never be compared against a release row. Re-run with --release."
        );
    }
}

/// ns → the largest unit that keeps the number readable.
fn human(ns: f64) -> String {
    if ns >= 1e9 {
        format!("{:.2} s", ns / 1e9)
    } else if ns >= 1e6 {
        format!("{:.2} ms", ns / 1e6)
    } else if ns >= 1e3 {
        format!("{:.2} us", ns / 1e3)
    } else {
        format!("{ns:.1} ns")
    }
}
