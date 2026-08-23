//! Replay the tavern walk-trace fixture exported by the legacy scene
//! (`legacy/src/game/pinball-knight/port-fixtures.test.ts`, "tavern walk
//! trace") and demand BIT-EXACT f64 equality on pose AND velocity, plus
//! matching facing and station focus per tick.
//!
//! If this fails, fix the port, never the pins.

use pk_core::state::Facing;
use pk_core::tavern::layout::station_at;
use pk_core::tavern::player::{step_tavern_movement, TavernInput, TavernPose};
use serde::Deserialize;

#[derive(Deserialize)]
struct Trace {
    ticks: u32,
    positions: Vec<[f64; 4]>,
    facings: Vec<String>,
    focus: Vec<Option<String>>,
}

/// Must mirror the TS exporter's `tavernAxis` thresholds exactly.
fn tavern_axis(tick: usize) -> (f64, f64) {
    if tick < 120 {
        (0.0, -1.0) // screen-up: NW into the forge quarter
    } else if tick < 200 {
        (1.0, -1.0) // up-right: due north, past the forge counter
    } else if tick < 300 {
        (1.0, 0.0) // right (SPRINTING): NE along the notice board
    } else if tick < 390 {
        (0.0, 1.0) // down: SE, off the board toward the bar
    } else if tick < 470 {
        (-1.0, 0.0) // left: SW into the central table's flank
    } else if tick < 540 {
        (-1.0, -1.0) // up-left: due west, brushing the table
    } else {
        (0.0, 1.0) // down: SE — then a panel freezes the knight
    }
}

fn facing_str(f: Facing) -> &'static str {
    match f {
        Facing::S => "S",
        Facing::N => "N",
        Facing::E => "E",
        Facing::W => "W",
    }
}

#[test]
fn tavern_walk_trace_replays_bit_exact() {
    let path = format!(
        "{}/../../assets/fixtures/tavern-walk-trace.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let text = std::fs::read_to_string(&path).expect(
        "fixture missing — run `RUN_EXPORT=1 scripts/ops/pk-run.sh --class test -- npx vitest run src/game/pinball-knight/port-fixtures.test.ts` in legacy/",
    );
    let trace: Trace = serde_json::from_str(&text).unwrap();
    assert_eq!(trace.ticks, 600);

    let mut p = TavernPose::spawn();
    for tick in 0..600usize {
        let (ax, az) = tavern_axis(tick);
        let input = TavernInput {
            axis_x: ax,
            axis_z: az,
            sprint: (200..300).contains(&tick),
            frozen: tick >= 560,
        };
        step_tavern_movement(&mut p, &input, 1.0 / 60.0);

        let e = &trace.positions[tick];
        assert!(
            p.x == e[0] && p.z == e[1] && p.vx == e[2] && p.vz == e[3],
            "tick {tick}: got ({:?}, {:?}, {:?}, {:?}), want ({:?}, {:?}, {:?}, {:?}) — bit-exact required",
            p.x, p.z, p.vx, p.vz, e[0], e[1], e[2], e[3],
        );
        assert_eq!(
            facing_str(p.facing),
            trace.facings[tick],
            "tick {tick}: facing diverged"
        );
        let focus = station_at(p.x, p.z).map(|s| s.id);
        assert_eq!(
            focus,
            trace.focus[tick].as_deref(),
            "tick {tick}: station focus diverged"
        );
    }
}
