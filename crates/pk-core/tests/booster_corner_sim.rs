//! Port of legacy `entities/booster-corner-sim.test.ts` — the END-TO-END
//! booster corner-clip simulation. Unlike the legacy test, which had to
//! reimplement updatePinball's loop around the real handler, this drives the
//! REAL Rust ride (`simulate`) — the whole loop is the ported artifact here,
//! so exercising it directly is strictly stronger than the mirror was.
//!
//! Thresholds are the legacy suite's own; the measured legacy behaviours
//! (ride over in <5s, <10 firings, <20 locked frames, lane carries ≥5 units)
//! are the pinned contract.

use pk_core::grid::{set_tile, Grid, T_FLOOR, T_WALL};
use pk_core::pinball::PINBALL_EXIT_MULT;
use pk_core::pinball::{PartKind, PinballPart};
use pk_core::state::{simulate, FrameInput, SimState, PLAYER_SPEED};

/// A SHARP CORNER — the 2×3 pocket, booster at (2,2) firing EAST into the
/// wall at its right. Open floor north and south.
fn corner_grid() -> Grid {
    let mut g = Grid::solid(5, 5);
    for (i, j) in [(1, 1), (2, 1), (1, 2), (2, 2), (1, 3), (2, 3)] {
        set_tile(&mut g, i, j, T_FLOOR);
    }
    g
}

fn booster_at(g: &Grid, i: i32, j: i32, dir_x: f64, dir_z: f64) -> PinballPart {
    PinballPart::new(
        PartKind::Booster,
        i,
        f64::from(i) + 0.5 - f64::from(g.w) / 2.0,
        f64::from(j) + 0.5 - f64::from(g.h) / 2.0,
        dir_x,
        dir_z,
    )
}

struct RideReport {
    fires: i32,
    ended_at: i32,
    max_d: f64,
    locked_frames: i32,
}

/// Run the REAL ride until the momentum bleeds out or `frames` elapse.
fn ride(mut s: SimState, frames: i32) -> RideReport {
    let origin = (s.player.x, s.player.z);
    let mut fires = 0;
    let mut max_d: f64 = 0.0;
    let mut locked = 0;
    let input = FrameInput::default();
    for f in 0..frames {
        let before = s.player.mom_speed;
        simulate(&mut s, &input);
        if s.player.steer_lock_t > 0.0 {
            locked += 1;
        }
        if s.player.mom_speed > before + 1e-9 {
            fires += 1;
        }
        max_d = max_d.max(libm::hypot(s.player.x - origin.0, s.player.z - origin.1));
        if s.player.mom_speed < PLAYER_SPEED * PINBALL_EXIT_MULT {
            return RideReport {
                fires,
                ended_at: f,
                max_d,
                locked_frames: locked,
            };
        }
    }
    RideReport {
        fires,
        ended_at: -1,
        max_d,
        locked_frames: locked,
    }
}

fn corner_sim() -> SimState {
    let g = corner_grid();
    let pad = booster_at(&g, 2, 2, 1.0, 0.0); // aimed EAST, into the wall
    let (px, pz) = (pad.x, pad.z);
    let mut s = SimState::new(g, (px, pz), 7);
    s.parts.push(pad);
    s.player.mom_x = 1.0;
    s.player.mom_z = 0.0;
    // momSpeed 0 in legacy; the ride only engages once the pad fires. Here
    // `update_pinball` gates on mom_speed > 0, so the pad's first firing
    // happens from the WALKING path (exactly how a cold-start booster works
    // in the real game) — a hair of speed primes the same loop the legacy
    // harness entered at frame 0.
    s.player.mom_speed = 0.0;
    s
}

#[test]
fn the_ride_ends_the_knight_gets_control_back() {
    // 60 simulated seconds. Before the jam guard: endedAt = -1, forever.
    let r = ride(corner_sim(), 3600);
    assert!(
        r.ended_at > -1,
        "ride never ended — the jam guard is not working"
    );
    assert!(
        r.ended_at < 300,
        "ride should end within ~5s, took {} frames",
        r.ended_at
    );
}

#[test]
fn the_trapped_pad_stops_relaunching() {
    // 327 firings before the guard existed.
    let r = ride(corner_sim(), 3600);
    assert!(
        r.fires < 10,
        "pad fired {} times — the jam guard is not standing it down",
        r.fires
    );
}

#[test]
fn hands_steering_back_quickly() {
    // The stutter is measured in steer-lock, not speed: <20 locked frames.
    let r = ride(corner_sim(), 3600);
    assert!(
        r.locked_frames < 20,
        "{} frames of dead stick — reads as the pad fighting the player",
        r.locked_frames
    );
}

/// The regression risk of the jam guard: a REAL booster chain must not read
/// as a jam. A clear 8-tile corridor, three pads down it, all aimed east.
#[test]
fn a_legitimate_booster_lane_still_works() {
    let mut g = Grid::solid(12, 3);
    for i in 1..11 {
        set_tile(&mut g, i, 1, T_FLOOR);
    }
    let pads = [
        booster_at(&g, 2, 1, 1.0, 0.0),
        booster_at(&g, 5, 1, 1.0, 0.0),
        booster_at(&g, 8, 1, 1.0, 0.0),
    ];
    let (px, pz) = (pads[0].x, pads[0].z);
    let mut s = SimState::new(g, (px, pz), 7);
    s.parts.extend(pads);
    s.player.mom_x = 1.0;
    s.player.mom_z = 0.0;
    s.player.mom_speed = 0.0;

    let r = ride(s, 120);
    assert!(
        r.fires >= 3,
        "only {} pads fired — the chain was stood down",
        r.fires
    );
    assert!(
        r.max_d > 5.0,
        "carried only {:.2} units down the lane",
        r.max_d
    );
}

// T_WALL is imported to keep the grid constants in view; Grid::solid fills
// with it already.
#[allow(dead_code)]
const _: u8 = T_WALL;
