//! Bit-exact replay of the PINBALL golden trace — the momentum ride at speed
//! through the shaped court, computed by the legacy engine's real pieces
//! (`legacy/.../port-fixtures.test.ts` pinballTrace) and pinned in
//! `assets/fixtures/pinball-trace-seed7.json`.
//!
//! Every f64 must match EXACTLY. If this fails, fix the port, never the pin.

use pk_core::state::{demo_floor, simulate, FrameInput, SimState};

#[derive(serde::Deserialize)]
struct Fixture {
    seed: u32,
    ticks: usize,
    launch: Launch,
    positions: Vec<(f64, f64, f64)>,
}

#[derive(serde::Deserialize)]
struct Launch {
    #[serde(rename = "momX")]
    mom_x: f64,
    #[serde(rename = "momZ")]
    mom_z: f64,
    #[serde(rename = "momSpeed")]
    mom_speed: f64,
}

fn pinball_steer(tick: usize) -> (f64, f64) {
    if tick < 120 {
        (0.0, 0.0)
    } else if tick < 240 {
        (1.0, 1.0)
    } else if tick < 400 {
        (1.0, 0.0)
    } else {
        (0.0, 1.0)
    }
}

#[test]
fn pinball_trace_replays_bit_exact() {
    let json = include_str!("../../../assets/fixtures/pinball-trace-seed7.json");
    let fx: Fixture = serde_json::from_str(json).expect("fixture parses");
    assert_eq!(fx.ticks, 600);

    let (grid, spawn) = demo_floor(fx.seed);
    let mut s = SimState::new(grid, spawn, fx.seed);
    s.plunger_armed = false;
    s.player.mom_x = fx.launch.mom_x;
    s.player.mom_z = fx.launch.mom_z;
    s.player.mom_speed = fx.launch.mom_speed;

    let mut max_speed: f64 = 0.0;
    for (tick, &(ex, ez, espeed)) in fx.positions.iter().enumerate() {
        let (ix, iz) = pinball_steer(tick);
        let input = FrameInput {
            move_x: ix,
            move_z: iz,
            sprint: false,
            dodge: false,
        };
        // ⚠️ THE FIXTURE'S WALKING BRANCH IS A FLAT `PLAYER_SPEED`.
        //
        // `port-fixtures.test.ts:442-450` says so in its own comment ("walking
        // mirror (same as trace())"): once the ride ends it calls `moveCircle`
        // at a constant speed, exactly as the collision traces do. The REAL
        // walk ramps through `curSpeed` (`player.ts:2188-2190`), so replaying
        // this fixture through `simulate` would compare the ported ramp against
        // a mirror that has none — it diverged at tick 466, the first walking
        // tick after the ride stops, by 0.055 tiles.
        //
        // Pinned to the fixture's own assumption rather than weakened: what
        // this fixture gates is the RIDE, and the ride is untouched by the ramp.
        // The walk profile has its own tests in `movement_trace.rs`.
        s.cur_speed = pk_core::state::PLAYER_SPEED;
        simulate(&mut s, &input);
        max_speed = max_speed.max(s.player.mom_speed);
        assert!(
            s.player.x == ex && s.player.z == ez && s.player.mom_speed == espeed,
            "tick {tick}: rust ({}, {}, v={}) != legacy ({ex}, {ez}, v={espeed})",
            s.player.x,
            s.player.z,
            s.player.mom_speed
        );
    }
    // Same coverage pin as the TS side: the trace genuinely rode the machine.
    assert!(max_speed > 10.0, "trace never reached pinball speed");
}
