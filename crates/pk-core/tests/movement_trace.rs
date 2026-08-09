//! Replay the movement-trace fixture exported by the legacy engine
//! (`legacy/src/game/pinball-knight/port-fixtures.test.ts`) and demand
//! BIT-EXACT f64 equality. This is the port-parity pattern every later
//! subsystem follows: TS computes with the real legacy code, Rust replays.
//!
//! If this fails, fix the port, never the pins.

use pk_core::state::{demo_floor, simulate, FrameInput, SimState};
use serde::Deserialize;

#[derive(Deserialize)]
struct Trace {
    seed: u32,
    ticks: u32,
    positions: Vec<[f64; 2]>,
}

/// 8 directions × 75 ticks — must mirror the TS exporter's spiralDir exactly.
fn spiral_dir(tick: usize) -> [f64; 2] {
    const DIRS: [[f64; 2]; 8] = [
        [1.0, 0.0],
        [1.0, 1.0],
        [0.0, 1.0],
        [-1.0, 1.0],
        [-1.0, 0.0],
        [-1.0, -1.0],
        [0.0, -1.0],
        [1.0, -1.0],
    ];
    DIRS[tick / 75]
}

/// Routed through the shaped court — must mirror the TS shapedDir thresholds.
fn shaped_dir(tick: usize) -> [f64; 2] {
    if tick < 120 {
        [-1.0, 0.0] // west into the slant court
    } else if tick < 200 {
        [-1.0, 1.0] // press into the diagonal
    } else if tick < 350 {
        [1.0, 0.0] // east across to the round corner
    } else if tick < 450 {
        [1.0, 1.0] // southeast into the arc guide
    } else {
        [0.0, 1.0] // south along it
    }
}

fn replay(fixture: &str, dir_at: fn(usize) -> [f64; 2]) {
    let path = format!(
        "{}/../../assets/fixtures/{fixture}",
        env!("CARGO_MANIFEST_DIR")
    );
    let text = std::fs::read_to_string(&path).expect(
        "fixture missing — run `RUN_EXPORT=1 <metered> npx vitest run src/game/pinball-knight/port-fixtures.test.ts` in legacy/",
    );
    let trace: Trace = serde_json::from_str(&text).unwrap();
    assert_eq!(trace.ticks, 600);

    let (grid, spawn) = demo_floor(trace.seed);
    let mut s = SimState::new(grid, spawn, trace.seed);
    for (tick, expected) in trace.positions.iter().enumerate() {
        let d = dir_at(tick);
        simulate(
            &mut s,
            &FrameInput {
                move_x: d[0],
                move_z: d[1],
            },
        );
        assert!(
            s.player.x == expected[0] && s.player.z == expected[1],
            "{fixture} tick {tick}: got ({:?}, {:?}), want ({:?}, {:?}) — bit-exact required",
            s.player.x,
            s.player.z,
            expected[0],
            expected[1],
        );
    }
}

#[test]
fn movement_trace_seed7_replays_bit_exact() {
    replay("movement-trace-seed7.json", spiral_dir);
}

/// The P1 gate: slant triangle, round quarter-disc and multi-tile arc
/// collision all replay bit-exactly against the legacy engine.
#[test]
fn shaped_trace_seed7_replays_bit_exact() {
    replay("shaped-trace-seed7.json", shaped_dir);
}
