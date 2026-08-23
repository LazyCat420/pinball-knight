//! Print one corpus floor's pass records next to the oracle's.
//!
//! `assert_record` compares counts before draws, on purpose — "we carved half
//! the circuit" is a different bug from "the circuit is one tile off". But when
//! the counts are close the DRAW count is the thing you actually want first, and
//! a failing assertion has already stopped by then. This prints the whole row.
//!
//! `cargo run -p pk-core --example pass_report -- [floor-index]`

use pk_core::maze::archetypes::archetype_for;
use pk_core::maze::modifiers::roll_modifier;
use pk_core::maze::track_floor::{build_track_floor, BuildTrackFloorOpts};
use pk_core::maze::{archetypes::windiness_for, floor_rng, record, PassSnapshot};

fn main() {
    let which: usize = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let path = format!(
        "{}/../../assets/fixtures/maze-pass-digests.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let v: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let f = &v["floors"][which];
    let level = f["level"].as_i64().unwrap() as i32;
    let run_seed = f["runSeed"].as_u64().unwrap() as u32;
    let arch = archetype_for(level);

    let mut seen = Vec::new();
    let mut rng = floor_rng(run_seed, level);
    roll_modifier(level, &mut rng);
    let _ = windiness_for(level, arch, &mut rng);
    let mut probe = |s: PassSnapshot<'_>| seen.push(record(&s));
    build_track_floor(
        f["cellsW"].as_i64().unwrap() as i32,
        f["cellsH"].as_i64().unwrap() as i32,
        &mut rng,
        &BuildTrackFloorOpts {
            profile: Some(&arch.track),
            ..Default::default()
        },
        Some(&mut probe),
    );

    println!("L{level} seed {run_seed}");
    println!(
        "{:<22} {:>8} {:>8}  {:>8} {:>8}  {:>10} {:>10}",
        "pass", "draws", "oracle", "walk", "oracle", "t", "oracle"
    );
    for (n, got) in seen.iter().enumerate() {
        let want = &f["passes"][n];
        let mark = |a: bool| if a { " " } else { "*" };
        println!(
            "{:<22} {:>8} {:>8}{} {:>8} {:>8}{} {:>10} {:>10}{}",
            got.pass,
            got.draws,
            want["draws"].as_u64().unwrap(),
            mark(got.draws == want["draws"].as_u64().unwrap()),
            got.walkable,
            want["walkable"].as_u64().unwrap(),
            mark(u64::from(got.walkable) == want["walkable"].as_u64().unwrap()),
            got.t,
            want["t"].as_u64().unwrap(),
            mark(u64::from(got.t) == want["t"].as_u64().unwrap()),
        );
    }
}
