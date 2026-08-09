//! The sim state and step function — the seed of the `state.ts`/`simulate.ts`
//! port. Grows subsystem by subsystem; the shape (one mutable state, one step
//! function with a hand-ordered call sequence) is the architecture decision
//! and does not change.

use crate::collide::{move_circle, MoveResult};
use crate::grid::{set_tile, Grid, T_FLOOR};
use crate::rng::Mulberry32;

/// Fixed sim step — 60 Hz, exactly the legacy `FIXED_STEP`.
pub const DT: f64 = 1.0 / 60.0;

/// legacy constants/player.ts
pub const PLAYER_SPEED: f64 = 4.2; // tiles/sec
pub const PLAYER_R: f64 = 0.3; // collision circle radius

/// Which authored sprite direction the player reads as. W is never authored —
/// the engine mirrors E (a fact carried from the sheet vocabulary).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Facing {
    S,
    N,
    E,
    /// Rendered as E, mirrored.
    W,
}

#[derive(Debug, Clone)]
pub struct Player {
    pub x: f64,
    pub z: f64,
    pub facing: Facing,
    pub moving: bool,
}

/// Per-tick input intent, already normalized by the shell.
#[derive(Debug, Clone, Copy, Default)]
pub struct FrameInput {
    pub move_x: f64,
    pub move_z: f64,
}

#[derive(Debug, Clone)]
pub struct SimState {
    pub grid: Grid,
    pub player: Player,
    pub rng: Mulberry32,
    pub tick: u64,
}

impl SimState {
    pub fn new(grid: Grid, spawn: (f64, f64), seed: u32) -> Self {
        Self {
            grid,
            player: Player {
                x: spawn.0,
                z: spawn.1,
                facing: Facing::S,
                moving: false,
            },
            rng: Mulberry32::new(seed),
            tick: 0,
        }
    }
}

/// One 60 Hz step. Call order grows to mirror legacy `simulate.ts` as
/// subsystems port; today: player movement only.
pub fn simulate(s: &mut SimState, input: &FrameInput) {
    s.tick += 1;

    // sqrt, not hypot: sqrt is IEEE-correctly-rounded on every platform, so
    // the TS fixture exporter (Math.sqrt) matches bit-exactly. hypot
    // implementations differ by ulps between runtimes.
    let len = (input.move_x * input.move_x + input.move_z * input.move_z).sqrt();
    s.player.moving = len > 1e-6;
    if s.player.moving {
        let (mx, mz) = (input.move_x / len, input.move_z / len);
        let MoveResult { x, z, .. } = move_circle(
            &s.grid,
            s.player.x,
            s.player.z,
            PLAYER_R,
            mx * PLAYER_SPEED * DT,
            mz * PLAYER_SPEED * DT,
        );
        s.player.x = x;
        s.player.z = z;
        // Facing follows the dominant input axis; ties keep the E/W row (the
        // sheet vocabulary's richest direction).
        s.player.facing = if mx.abs() >= mz.abs() {
            if mx >= 0.0 {
                Facing::E
            } else {
                Facing::W
            }
        } else if mz >= 0.0 {
            Facing::S
        } else {
            Facing::N
        };
    }
}

/// A deterministic demo floor for the vertical slice: bordered room, carved
/// wander-corridors, scattered pillars. Replaced by the real `maze/` port in
/// M3 — this exists so the slice has something honest to collide with, driven
/// through the same seeded RNG the real generator will use.
pub fn demo_floor(seed: u32) -> (Grid, (f64, f64)) {
    let (w, h) = (25, 25);
    let mut g = Grid::solid(w, h);
    let mut rng = Mulberry32::new(seed);

    // Open interior.
    for j in 1..h - 1 {
        for i in 1..w - 1 {
            set_tile(&mut g, i, j, T_FLOOR);
        }
    }
    // Pillar field: deterministic scatter, denser toward the walls, never on
    // the spawn tile block in the middle.
    for j in 2..h - 2 {
        for i in 2..w - 2 {
            let centre = (i - w / 2).abs() <= 2 && (j - h / 2).abs() <= 2;
            if centre {
                continue;
            }
            if rng.next_f64() < 0.10 {
                set_tile(&mut g, i, j, crate::grid::T_WALL);
            }
        }
    }
    let spawn = crate::grid::tile_center(&g, w / 2, h / 2);
    (g, spawn)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn demo_floor_is_deterministic() {
        let (a, _) = demo_floor(7);
        let (b, _) = demo_floor(7);
        assert_eq!(a.t, b.t);
        let (c, _) = demo_floor(8);
        assert_ne!(a.t, c.t, "different seed must vary the floor");
    }

    #[test]
    fn player_cannot_leave_the_bordered_floor() {
        let (grid, spawn) = demo_floor(7);
        let mut s = SimState::new(grid, spawn, 7);
        // Hold hard east for ten simulated seconds.
        let input = FrameInput {
            move_x: 1.0,
            move_z: 0.0,
        };
        for _ in 0..600 {
            simulate(&mut s, &input);
        }
        let east_limit = f64::from(s.grid.w) / 2.0 - 1.0; // inside the border wall
        assert!(s.player.x < east_limit, "clamped inside the border");
        assert!(!crate::collide::circle_collides(
            &s.grid, s.player.x, s.player.z, PLAYER_R
        ));
        assert_eq!(s.player.facing, Facing::E);
    }
}
