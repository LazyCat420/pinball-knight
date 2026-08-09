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
    // ── Pinball momentum (legacy freshPlayerFields' momentum block) ──
    pub mom_x: f64,
    pub mom_z: f64,
    pub mom_speed: f64,
    pub bounce_combo: f64,
    pub bounce_combo_t: f64,
    pub overcharge: f64,
    pub oil_t: f64,
    pub turbo_t: f64,
    pub spring_t: f64,
    pub iframes: f64,
    pub steer_lock_t: f64,
    pub grab_t: f64,
    pub grab_x: f64,
    pub grab_z: f64,
    pub throw_dir_x: f64,
    pub throw_dir_z: f64,
    pub throw_speed: f64,
    pub rail: crate::rail::RailState,
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
    /// Wall-clock seconds simulated — `state.elapsed` (spinpad phase reads it).
    pub elapsed: f64,
    // ── Pinball machine state (legacy `state` fields the ride touches) ──
    pub parts: Vec<crate::pinball::PinballPart>,
    pub arc_corners: Vec<crate::collide::ArcCorner>,
    pub combo_zone: crate::combo::ComboZone,
    pub part_combo_hits: i32,
    pub frenzy_paid: bool,
    pub gold_run: i64,
    pub bumpers_lit: i32,
    pub bumper_total: i32,
    pub jackpots: i32,
    // Pocket-rattle guard anchor (module-level in legacy player.ts).
    pub pocket_ax: f64,
    pub pocket_az: f64,
    pub pocket_n: i32,
    pub pocket_t: f64,
    /// Rail gold cadence accumulator (module-level in legacy player.ts).
    pub rail_gold_t: f64,
}

impl SimState {
    pub fn new(grid: Grid, spawn: (f64, f64), seed: u32) -> Self {
        let arc_corners = crate::collide::compute_arc_corners(&grid);
        Self {
            grid,
            player: Player {
                x: spawn.0,
                z: spawn.1,
                facing: Facing::S,
                moving: false,
                mom_x: 0.0,
                mom_z: 0.0,
                mom_speed: 0.0,
                bounce_combo: 0.0,
                bounce_combo_t: 0.0,
                overcharge: 0.0,
                oil_t: 0.0,
                turbo_t: 0.0,
                spring_t: 0.0,
                iframes: 0.0,
                steer_lock_t: 0.0,
                grab_t: 0.0,
                grab_x: 0.0,
                grab_z: 0.0,
                throw_dir_x: 0.0,
                throw_dir_z: 0.0,
                throw_speed: 0.0,
                rail: crate::rail::fresh_rail(),
            },
            rng: Mulberry32::new(seed),
            tick: 0,
            elapsed: 0.0,
            parts: Vec::new(),
            arc_corners,
            combo_zone: crate::combo::ComboZone::Launch,
            part_combo_hits: 0,
            frenzy_paid: false,
            gold_run: 0,
            bumpers_lit: 0,
            bumper_total: 0,
            jackpots: 0,
            pocket_ax: 0.0,
            pocket_az: 0.0,
            pocket_n: 0,
            pocket_t: 0.0,
            rail_gold_t: 0.0,
        }
    }
}

/// One 60 Hz step. Call order grows to mirror legacy `simulate.ts` as
/// subsystems port; today: part timers → momentum ride → else walking.
pub fn simulate(s: &mut SimState, input: &FrameInput) {
    s.tick += 1;
    s.elapsed += DT;

    // Part cooldowns/timers tick first (the legacy parts renderer's job,
    // owned by the sim here — game state must not depend on being drawn).
    crate::pinball::tick_parts(s, DT);

    // The momentum ride owns the player while it lasts.
    if crate::pinball::update_pinball(s, DT, (input.move_x, input.move_z)) {
        s.player.moving = s.player.mom_speed > 0.0;
        return;
    }

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

    // Parts fire from a cold walk too — stepping on a spring/booster STARTS a
    // momentum ride (the machine works without spooling first). `cur_speed` is
    // the instantaneous walk speed; the legacy smoothed curSpeed lands with
    // the full player port (it only changes the oil slick's launch strength).
    let cur_speed = if s.player.moving { PLAYER_SPEED } else { 0.0 };
    crate::pinball::touch_pinball_parts(s, false, cur_speed, (input.move_x, input.move_z));
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
    // ── Shaped court (fixed tiles, AFTER the rng pass so the pillar stream
    // is untouched; mirrored line-for-line in legacy port-fixtures.test.ts).
    use crate::grid::{ensure_arcs, set_shape};
    use crate::tile_shape::{ArcFeature, LaneBand, SHAPE_ARC, SHAPE_ROUND_NE, SHAPE_SLANT_NE};
    // A SLANT_NE deflector west of spawn: walk west along the spawn row and
    // the diagonal shunts you north-east.
    set_tile(&mut g, 6, 12, crate::grid::T_WALL);
    set_shape(&mut g, 6, 12, SHAPE_SLANT_NE);
    set_tile(&mut g, 5, 12, crate::grid::T_WALL); // west backing leg
    set_tile(&mut g, 6, 13, crate::grid::T_WALL); // south backing leg
                                                  // A ROUND_NE quarter-disc east of spawn: the curved ricochet corner.
    set_tile(&mut g, 17, 12, crate::grid::T_WALL);
    set_shape(&mut g, 17, 12, SHAPE_ROUND_NE);
    set_tile(&mut g, 16, 12, crate::grid::T_WALL);
    set_tile(&mut g, 17, 13, crate::grid::T_WALL);
    // A radius-3 convex arc guide in the SE quadrant (span east→south),
    // wearing a booster lane — the pinball ball-guide, laneRoom geometry.
    ensure_arcs(&mut g);
    g.arcs.push(ArcFeature {
        cx: 18.0,
        cz: 18.0,
        r: 3.0,
        a0: 0.0,
        span: std::f64::consts::FRAC_PI_2,
        lanes: vec![LaneBand {
            a0: 0.0,
            span: std::f64::consts::FRAC_PI_2,
            cw: true,
            cooldown_t: 0.0,
            hit_t: -1.0,
        }],
        ..Default::default()
    });
    for j in 18..=21 {
        for i in 18..=21 {
            let d = crate::jsmath::js_hypot(f64::from(i) + 0.5 - 18.0, f64::from(j) + 0.5 - 18.0);
            if d > 2.0 && d < 4.0 {
                set_tile(&mut g, i, j, crate::grid::T_WALL);
                set_shape(&mut g, i, j, SHAPE_ARC);
                let k = (j * w + i) as usize;
                g.arc_idx.as_mut().unwrap()[k] = 0;
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
