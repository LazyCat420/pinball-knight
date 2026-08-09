//! Replay the intro-ball fixture exported by the legacy engine
//! (`legacy/src/game/pinball-knight/port-fixtures.test.ts`) and demand
//! BIT-EXACT f64 equality — the title ricochet bounces off the real ported
//! collision, so the intro's physics can never drift from gameplay's.
//!
//! If this fails, fix the port, never the pins.

use pk_core::intro::{build_title_grid, step_intro_ball, IntroBall};
use serde::Deserialize;

#[derive(Deserialize)]
struct Trace {
    ticks: u32,
    positions: Vec<[f64; 4]>,
    #[serde(rename = "bounceTicks")]
    bounce_ticks: Vec<u32>,
}

#[test]
fn intro_ball_trace_replays_bit_exact() {
    let path = format!(
        "{}/../../assets/fixtures/intro-ball-trace.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let text = std::fs::read_to_string(&path).expect(
        "fixture missing — run `npx vitest run src/game/pinball-knight/port-fixtures.test.ts` in legacy/",
    );
    let trace: Trace = serde_json::from_str(&text).unwrap();
    assert_eq!(trace.ticks, 600);

    let layout = build_title_grid();
    let mut b = IntroBall::at_spawn(&layout);
    let mut bounces = Vec::new();
    for (tick, expected) in trace.positions.iter().enumerate() {
        if step_intro_ball(&layout.grid, &mut b, 1.0 / 120.0) {
            bounces.push(tick as u32);
        }
        assert!(
            b.x == expected[0] && b.z == expected[1] && b.vx == expected[2] && b.vz == expected[3],
            "tick {tick}: got ({:?}, {:?}, {:?}, {:?}), want {:?} — bit-exact required",
            b.x,
            b.z,
            b.vx,
            b.vz,
            expected,
        );
    }
    assert_eq!(bounces, trace.bounce_ticks, "bounce edges must match");
}
