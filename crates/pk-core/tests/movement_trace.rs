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

/// 8 directions × 75 ticks — must mirror the TS exporter's DIRS exactly.
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

#[test]
fn movement_trace_seed7_replays_bit_exact() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../assets/fixtures/movement-trace-seed7.json"
    );
    let text = std::fs::read_to_string(path).expect(
        "fixture missing — run `RUN_EXPORT=1 npx vitest run src/game/pinball-knight/port-fixtures.test.ts` in legacy/",
    );
    let trace: Trace = serde_json::from_str(&text).unwrap();
    assert_eq!(trace.ticks, 600);

    let (grid, spawn) = demo_floor(trace.seed);
    let mut s = SimState::new(grid, spawn, trace.seed);
    for (tick, expected) in trace.positions.iter().enumerate() {
        let d = DIRS[tick / 75];
        simulate(
            &mut s,
            &FrameInput {
                move_x: d[0],
                move_z: d[1],
            },
        );
        assert!(
            s.player.x == expected[0] && s.player.z == expected[1],
            "tick {tick}: got ({:?}, {:?}), want ({:?}, {:?}) — bit-exact required",
            s.player.x,
            s.player.z,
            expected[0],
            expected[1],
        );
    }
}
