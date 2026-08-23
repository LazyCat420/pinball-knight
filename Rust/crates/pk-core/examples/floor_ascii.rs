//! Print a generated floor as ASCII, or scan seeds for a short one.
//!
//! ```text
//!   cargo run -p pk-core --example floor_ascii -- --level 1 --seed 1
//!   cargo run -p pk-core --example floor_ascii -- --level 1 --scan 200
//! ```
//!
//! An example, not a test. The parity gate is `maze_pass_digests`; this exists
//! because a digest that matches the oracle says the floor is RIGHT and says
//! nothing about what it LOOKS like, and "the dungeon renders a maze" is a claim
//! about shape.
//!
//! `--scan` answers a different question, and it is the one the browser gate
//! needed: which seed has the shortest walk from the spawn to the exit. A gate
//! that drives the knight to the exit is testing the DESCEND rule, not the
//! player's stamina — so it should be run on the cheapest floor that exercises
//! it, and picking that floor should be a measurement rather than a guess.

use pk_core::grid::{at, is_walkable, Grid, T_CRACKED, T_FLOOR, T_STAIRS};
use pk_core::maze::floor_spec::{
    build_track_floor_from_spec, derive_floor_spec, validate_runtime_floor,
};

fn arg(name: &str, dflt: &str) -> String {
    let args: Vec<String> = std::env::args().collect();
    args.iter()
        .position(|a| a == name)
        .and_then(|k| args.get(k + 1))
        .cloned()
        .unwrap_or_else(|| dflt.to_string())
}

fn glyph(g: &Grid, i: i32, j: i32) -> char {
    match at(g, i, j) {
        T_FLOOR => '.',
        T_STAIRS => '>',
        T_CRACKED => ',',
        _ => '#',
    }
}

fn main() {
    let level: i32 = arg("--level", "1").parse().expect("--level is an integer");
    let scan: i32 = arg("--scan", "0").parse().expect("--scan is an integer");

    if scan > 0 {
        let mut rows: Vec<(i32, u32, i32, usize)> = Vec::new();
        for seed in 1..=scan as u32 {
            let spec = derive_floor_spec(level, seed);
            let Ok(track) = build_track_floor_from_spec(&spec) else {
                continue;
            };
            let Ok(info) = validate_runtime_floor(&track) else {
                continue;
            };
            let turns = info
                .route_to_exit
                .windows(2)
                .filter(|w| w[0] != w[1])
                .count();
            rows.push((info.path_distance, seed, level, turns));
        }
        rows.sort();
        println!("level {level}: {} seeds built and validated", rows.len());
        println!("  {:>6}  {:>6}  {:>6}", "dist", "seed", "turns");
        for (dist, seed, _, turns) in rows.iter().take(10) {
            println!("  {dist:>6}  {seed:>6}  {turns:>6}");
        }
        return;
    }

    let seed: u32 = arg("--seed", "1").parse().expect("--seed is an integer");
    let spec = derive_floor_spec(level, seed);
    let track = match build_track_floor_from_spec(&spec) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("declined: {e:?}");
            std::process::exit(1);
        }
    };
    let info = validate_runtime_floor(&track).ok();

    let g = &track.grid;
    let mut rows: Vec<Vec<char>> = (0..g.h)
        .map(|j| (0..g.w).map(|i| glyph(g, i, j)).collect())
        .collect();
    if let Some(info) = &info {
        // The route first, so the two endpoints paint over it.
        let mut here = info.start_tile;
        for (di, dj) in &info.route_to_exit {
            here.i += di;
            here.j += dj;
            rows[here.j as usize][here.i as usize] = '+';
        }
        rows[info.start_tile.j as usize][info.start_tile.i as usize] = 'S';
        rows[info.provisional_exit_tile.j as usize][info.provisional_exit_tile.i as usize] = 'X';
    }

    let walkable = (0..g.h)
        .flat_map(|j| (0..g.w).map(move |i| (i, j)))
        .filter(|(i, j)| is_walkable(g, *i, *j))
        .count();
    println!(
        "level {level} seed {seed} — {}x{} tiles, {walkable} walkable ({:.1}%)",
        g.w,
        g.h,
        100.0 * walkable as f64 / (g.w * g.h) as f64,
    );
    if let Some(info) = &info {
        println!(
            "S {:?} -> X {:?} (provisional), {} tiles apart",
            (info.start_tile.i, info.start_tile.j),
            (info.provisional_exit_tile.i, info.provisional_exit_tile.j),
            info.path_distance
        );
    }
    for r in rows {
        println!("{}", r.into_iter().collect::<String>());
    }
}
