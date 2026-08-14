//! Replay the movement-trace fixture exported by the legacy engine
//! (`legacy/src/game/pinball-knight/port-fixtures.test.ts`) and demand
//! BIT-EXACT f64 equality. This is the port-parity pattern every later
//! subsystem follows: TS computes with the real legacy code, Rust replays.
//!
//! If this fails, fix the port, never the pins.

use pk_core::collide::{move_circle, MoveResult};
use pk_core::state::{
    demo_floor, simulate, FrameInput, SimState, DT, MOVE_ACCEL, MOVE_FRICTION, PLAYER_R,
    PLAYER_SPEED, SPRINT_BASE_MULT, SPRINT_RAMP_TIME, SPRINT_SPEED_MULT,
};
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
    let (mut x, mut z) = spawn;
    for (tick, expected) in trace.positions.iter().enumerate() {
        let d = dir_at(tick);
        // The exporter (`port-fixtures.test.ts:142-160`) calls `moveCircle`
        // DIRECTLY at a constant `PLAYER_SPEED` — it never enters `updatePlayer`.
        // So this fixture pins COLLISION, not the walk profile, and the replay
        // must mirror that or it pins two things and can fail for either.
        //
        // ⚠️ It used to run through `simulate()`, which was equivalent only
        // while the walk moved at a flat `PLAYER_SPEED`. The moment the accel/
        // friction ramp landed (`player.ts:2188-2190`, the real walk) this went
        // red at tick 0 — 0.0153 against a wanted 0.07 — and the fixture was
        // right about `moveCircle` and silent about the ramp. Fixing the port to
        // satisfy it would have deleted a correct transcription to please a pin
        // that never measured it.
        let len = (d[0] * d[0] + d[1] * d[1]).sqrt();
        let (mx, mz) = (d[0] / len, d[1] / len);
        let MoveResult { x: nx, z: nz, .. } = move_circle(
            &grid,
            x,
            z,
            PLAYER_R,
            mx * PLAYER_SPEED * DT,
            mz * PLAYER_SPEED * DT,
        );
        x = nx;
        z = nz;
        assert!(
            x == expected[0] && z == expected[1],
            "{fixture} tick {tick}: got ({x:?}, {z:?}), want ({:?}, {:?}) — bit-exact required",
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

/// THE WALK PROFILE, which the collision fixture above deliberately does not
/// pin. Hand-computed from `constants/player.ts` and `player.ts:2188-2190`, so
/// it fails if a constant or the ramp's shape moves.
#[test]
fn the_walk_ramps_toward_its_target_rather_than_snapping() {
    let (grid, spawn) = demo_floor(7);
    let mut s = SimState::new(grid, spawn, 7);
    s.plunger_armed = false;
    let east = FrameInput {
        move_x: 1.0,
        move_z: 0.0,
        sprint: false,
        dodge: false,
    };

    // Tick 1: from a standstill the smoothed speed has had exactly one step of
    // MOVE_ACCEL, so the knight does NOT travel a full PLAYER_SPEED*DT.
    simulate(&mut s, &east);
    let step1 = s.cur_speed;
    assert!(
        (step1 - MOVE_ACCEL * DT).abs() < 1e-12,
        "first step should be MOVE_ACCEL*DT = {}, got {step1}",
        MOVE_ACCEL * DT
    );
    assert!(
        step1 < PLAYER_SPEED,
        "a standing start must not reach full speed in one tick"
    );

    // Held long enough, it converges on the walk speed and STOPS there.
    for _ in 0..120 {
        simulate(&mut s, &east);
    }
    let surface = pk_core::surfaces::floor_surface(pk_core::grid::surface_at(
        &s.grid,
        pk_core::grid::world_to_tile(&s.grid, s.player.x, s.player.z).0,
        pk_core::grid::world_to_tile(&s.grid, s.player.x, s.player.z).1,
    ))
    .walk_mult;
    assert!(
        (s.cur_speed - PLAYER_SPEED * surface).abs() < 1e-9,
        "a sustained walk settles at PLAYER_SPEED*walkMult ({}), got {}",
        PLAYER_SPEED * surface,
        s.cur_speed
    );

    // Releasing decays at MOVE_FRICTION, which is a DIFFERENT rate — the
    // asymmetry is the feel, and equal rates would pass a weaker assertion.
    let before = s.cur_speed;
    simulate(&mut s, &FrameInput::default());
    let drop = before - s.cur_speed;
    assert!(
        (drop - MOVE_FRICTION * DT).abs() < 1e-12,
        "release should decay at MOVE_FRICTION*DT = {}, got {drop}",
        MOVE_FRICTION * DT
    );
    // The asymmetry is load-bearing (a press bites, a release glides), and it
    // is a CONSTANT relationship — so this is a compile-time guard, not a
    // runtime assertion clippy would rightly call constant.
    const _: () = assert!(MOVE_ACCEL != MOVE_FRICTION);
}

/// Sprint spools over the ramp, and it is GATED ON MOVING — a held Shift while
/// standing still charges nothing (`player.ts:2128`).
#[test]
fn sprint_spools_only_while_moving() {
    let (grid, spawn) = demo_floor(7);
    let mut s = SimState::new(grid, spawn, 7);
    s.plunger_armed = false;

    // Shift held, no stick: nothing spools.
    let still = FrameInput {
        move_x: 0.0,
        move_z: 0.0,
        sprint: true,
        dodge: false,
    };
    for _ in 0..60 {
        simulate(&mut s, &still);
    }
    assert_eq!(
        s.player.sprint_charge, 0.0,
        "a held Shift while standing still must not spool the sprint"
    );

    // Shift + stick: fills over SPRINT_RAMP_TIME and clamps at 1.
    let run = FrameInput {
        move_x: 1.0,
        move_z: 0.0,
        sprint: true,
        dodge: false,
    };
    let ticks = (SPRINT_RAMP_TIME / DT).ceil() as usize;
    for _ in 0..ticks {
        simulate(&mut s, &run);
    }
    assert!(
        (s.player.sprint_charge - 1.0).abs() < 1e-9,
        "a full ramp of sustained running should reach charge 1.0, got {}",
        s.player.sprint_charge
    );

    // And it is FASTER than the same walk without Shift.
    let sprint_speed = s.cur_speed;
    let (grid2, spawn2) = demo_floor(7);
    let mut w = SimState::new(grid2, spawn2, 7);
    w.plunger_armed = false;
    let walk = FrameInput {
        move_x: 1.0,
        move_z: 0.0,
        sprint: false,
        dodge: false,
    };
    for _ in 0..ticks {
        simulate(&mut w, &walk);
    }
    assert!(
        sprint_speed > w.cur_speed * 1.5,
        "a full sprint ({sprint_speed}) should clearly outrun the walk ({}) — \
         SPRINT_SPEED_MULT is {SPRINT_SPEED_MULT}, base {SPRINT_BASE_MULT}",
        w.cur_speed
    );
}

/// The grace window HOLDS the spool through a stumble rather than dumping it.
/// Three-way branch: fill / hold / decay. Collapsing hold into decay is what
/// made the ramp read as broken in the oracle's own playtest.
#[test]
fn a_brief_stumble_does_not_erase_the_spool() {
    let (grid, spawn) = demo_floor(7);
    let mut s = SimState::new(grid, spawn, 7);
    s.plunger_armed = false;
    let run = FrameInput {
        move_x: 1.0,
        move_z: 0.0,
        sprint: true,
        dodge: false,
    };
    for _ in 0..60 {
        simulate(&mut s, &run);
    }
    let charged = s.player.sprint_charge;
    assert!(charged > 0.5, "expected a real spool first, got {charged}");

    // Six frames of nothing — well inside SPRINT_GRACE (0.6s = 36 frames).
    for _ in 0..6 {
        simulate(&mut s, &FrameInput::default());
    }
    assert_eq!(
        s.player.sprint_charge, charged,
        "the charge must HOLD through a brief interruption, not decay"
    );

    // Past the grace window it does decay.
    for _ in 0..40 {
        simulate(&mut s, &FrameInput::default());
    }
    assert!(
        s.player.sprint_charge < charged,
        "past SPRINT_GRACE the spool must bleed"
    );
}

/// SAND IS HEAVY UNDERFOOT — the floor scales the ordinary walk, not just the
/// momentum ride (`player.ts:2178-2185`).
///
/// Written after a sabotage survived: the first version of the walk-profile
/// test above ran on the demo floor's spawn tile, which is plain stone
/// (`walk_mult` 1.0), so DELETING the surface term changed nothing and the
/// test passed on a port that ignored the floor entirely. A multiplier of 1.0
/// is not a test of a multiplier.
#[test]
fn sand_slows_the_walk_and_stone_does_not() {
    let settle = |surface: u8| {
        let (mut grid, spawn) = demo_floor(7);
        // Paint the whole floor, so the knight cannot walk off the patch
        // mid-measurement and average two surfaces.
        for j in 0..grid.h {
            for i in 0..grid.w {
                pk_core::grid::set_surface(&mut grid, i, j, surface);
            }
        }
        let mut s = SimState::new(grid, spawn, 7);
        s.plunger_armed = false;
        let east = FrameInput {
            move_x: 1.0,
            move_z: 0.0,
            sprint: false,
            dodge: false,
        };
        for _ in 0..120 {
            simulate(&mut s, &east);
        }
        s.cur_speed
    };

    let stone = settle(pk_core::surfaces::FLOOR_STONE);
    let sand = settle(pk_core::surfaces::FLOOR_SAND);
    let sand_mult = pk_core::surfaces::floor_surface(pk_core::surfaces::FLOOR_SAND).walk_mult;

    assert!(
        sand_mult < 1.0,
        "this test is only meaningful while sand's walk_mult ({sand_mult}) is below 1"
    );
    assert!(
        sand < stone,
        "sand ({sand}) must be slower underfoot than stone ({stone})"
    );
    assert!(
        (sand - stone * sand_mult).abs() < 1e-9,
        "sand should settle at stone*{sand_mult} = {}, got {sand}",
        stone * sand_mult
    );
}
