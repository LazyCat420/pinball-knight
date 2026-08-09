//! Circle-vs-tile-grid collision. No physics engine — a top-down grid maze
//! needs axis-separated sweep-and-clamp, which is deterministic, debuggable
//! and ~60 lines (legacy BLUEPRINT §1.5 for why Rapier stays on the shelf).
//! Port of `legacy/src/game/pinball-knight/engine/collision.ts`.
//!
//! Movement is resolved one axis at a time: try the X move, clamp against any
//! wall the circle would enter, then the same for Z. Clamping only the moved
//! axis is what produces wall SLIDING for free — pressing diagonally into a
//! wall glides you along it instead of sticking.
//!
//! Coordinates are world coords (maze centred on origin, 1 tile = 1 unit).
//!
//! PORT STATUS: the square-wall path is complete (sweep, sub-stepping,
//! surfaces, wall contact). Shaped tiles — slants, multi-tile arc sweeps, kick
//! bands, booster lanes — arrive with the tile-shape port (M2); until then
//! every shape id is `SHAPE_FULL` and the shaped branches are unreachable, not
//! removed, so the structure matches the original file section for section.

use crate::grid::{is_walkable, shape_at, surface_at, Grid, SHAPE_FULL};

const EPS: f64 = 1e-4;

/// Largest per-step move that keeps the axis sweep tunnel-free (< 1 − 2r).
const MAX_STEP: f64 = 0.4;

/// Does a solid tile block the axis-separated square sweep? A shaped (slant)
/// tile is TRANSPARENT to the sweep — its diagonal is owned by the shaped
/// resolver alone (M2), so the square clamp must not stop the circle at the
/// cell boundary.
fn blocks_square(g: &Grid, i: i32, j: i32) -> bool {
    !is_walkable(g, i, j) && shape_at(g, i, j) == SHAPE_FULL
}

/// True if a circle at world (x, z) with radius r overlaps any solid tile.
pub fn circle_collides(g: &Grid, x: f64, z: f64, r: f64) -> bool {
    let gx = x + f64::from(g.w) / 2.0;
    let gz = z + f64::from(g.h) / 2.0;
    let i0 = (gx - r).floor() as i32;
    let i1 = (gx + r).floor() as i32;
    let j0 = (gz - r).floor() as i32;
    let j1 = (gz + r).floor() as i32;
    for j in j0..=j1 {
        for i in i0..=i1 {
            if is_walkable(g, i, j) {
                continue;
            }
            if shape_at(g, i, j) != SHAPE_FULL {
                // Shaped tiles resolve against their own geometry (M2).
                continue;
            }
            // Closest point on the tile AABB to the circle centre.
            let cx = gx.clamp(f64::from(i), f64::from(i) + 1.0);
            let cz = gz.clamp(f64::from(j), f64::from(j) + 1.0);
            let dx = gx - cx;
            let dz = gz - cz;
            if dx * dx + dz * dz < r * r {
                return true;
            }
        }
    }
    false
}

/// Which wall the circle is pressed against, and the direction to launch OFF
/// it. Probes the four cardinal offsets a hair (`probe`) beyond the body
/// radius; returns the summed outward NORMAL (pointing AWAY from the wall), or
/// `None` in open floor. A corner sums two normals into a diagonal.
pub fn wall_contact(g: &Grid, x: f64, z: f64, r: f64, probe: f64) -> Option<(f64, f64)> {
    let edge = r + probe;
    let pr = probe;
    let mut nx = 0.0;
    let mut nz = 0.0;
    if circle_collides(g, x + edge, z, pr) {
        nx -= 1.0; // wall to the east → launch west
    }
    if circle_collides(g, x - edge, z, pr) {
        nx += 1.0; // wall to the west → launch east
    }
    if circle_collides(g, x, z + edge, pr) {
        nz -= 1.0; // wall to the south → launch north
    }
    if circle_collides(g, x, z - edge, pr) {
        nz += 1.0; // wall to the north → launch south
    }
    if nx == 0.0 && nz == 0.0 {
        return None;
    }
    let len = libm::hypot(nx, nz);
    let len = if len == 0.0 { 1.0 } else { len };
    Some((nx / len, nz / len))
}

/// The resolved position, plus contact data. `hit_n` is populated only by
/// shaped walls (M2); `hit_surface` is the material of whichever tile stopped
/// the move — 0 when nothing was hit, which is also stone, so the pinball
/// reflection can read it unconditionally.
#[derive(Debug, Clone, PartialEq)]
pub struct MoveResult {
    pub x: f64,
    pub z: f64,
    pub hit_n: Option<(f64, f64)>,
    pub hit_surface: u8,
}

struct StepResult {
    gx: f64,
    gz: f64,
    hit_n: Option<(f64, f64)>,
    hit_surface: u8,
}

/// One sweep-and-clamp move (square walls). Grid coords in/out. Sub-stepping
/// in `move_circle` keeps each call within the no-tunnel bound.
fn move_circle_step(g: &Grid, gx0: f64, gz0: f64, r: f64, dx: f64, dz: f64) -> StepResult {
    let mut gx = gx0;
    // The surface of whichever tile clamped us. Both axes write it; the LAST
    // write wins, which for a corner impact means the Z wall decides. That is
    // arbitrary but it must be DETERMINISTIC — blending two surfaces would
    // make a corner between rubber and mud behave like neither.
    let mut hit_surface = 0u8;

    // ── X axis (square walls only; shaped tiles are transparent here) ──
    if dx != 0.0 {
        gx += dx;
        let dir = dx.signum();
        let lead = if dir > 0.0 { gx + r } else { gx - r }; // the circle's leading edge
        let ti = lead.floor() as i32;
        let j0 = (gz0 - r + EPS).floor() as i32;
        let j1 = (gz0 + r - EPS).floor() as i32;
        for j in j0..=j1 {
            if blocks_square(g, ti, j) {
                gx = if dir > 0.0 {
                    f64::from(ti) - r - EPS
                } else {
                    f64::from(ti) + 1.0 + r + EPS
                };
                hit_surface = surface_at(g, ti, j);
                break;
            }
        }
    }

    // ── Z axis (against the already-resolved X) ──
    let mut gz = gz0;
    if dz != 0.0 {
        gz += dz;
        let dir = dz.signum();
        let lead = if dir > 0.0 { gz + r } else { gz - r };
        let tj = lead.floor() as i32;
        let i0 = (gx - r + EPS).floor() as i32;
        let i1 = (gx + r - EPS).floor() as i32;
        for i in i0..=i1 {
            if blocks_square(g, i, tj) {
                gz = if dir > 0.0 {
                    f64::from(tj) - r - EPS
                } else {
                    f64::from(tj) + 1.0 + r + EPS
                };
                hit_surface = surface_at(g, i, tj);
                break;
            }
        }
    }

    // Corrective shaped pass (slants/arcs) lands with tile-shape in M2.
    StepResult {
        gx,
        gz,
        hit_n: None,
        hit_surface,
    }
}

/// Move a circle by (dx, dz), clamping against walls. Sub-steps when the
/// requested move exceeds the no-tunnel bound (the pinball at terminal speed
/// does ~0.5 units/frame), so the sweep stays correct at any speed.
pub fn move_circle(g: &Grid, x: f64, z: f64, r: f64, dx: f64, dz: f64) -> MoveResult {
    let mut gx = x + f64::from(g.w) / 2.0;
    let mut gz = z + f64::from(g.h) / 2.0;
    let dist = libm::hypot(dx, dz);
    let steps = if dist > MAX_STEP {
        (dist / MAX_STEP).ceil() as i32
    } else {
        1
    };
    let sx = dx / f64::from(steps);
    let sz = dz / f64::from(steps);
    let mut hit_n = None;
    let mut hit_surface = 0u8;
    for _ in 0..steps {
        let r2 = move_circle_step(g, gx, gz, r, sx, sz);
        gx = r2.gx;
        gz = r2.gz;
        // Surface is kept from any sub-step that touched something,
        // independently of hit_n: a SQUARE wall reports a surface with no
        // normal. Gating this on hit_n would silently make every flat wall in
        // the game stone.
        if r2.hit_surface != 0 {
            hit_surface = r2.hit_surface;
        }
        if r2.hit_n.is_some() {
            hit_n = r2.hit_n;
        }
    }
    MoveResult {
        x: gx - f64::from(g.w) / 2.0,
        z: gz - f64::from(g.h) / 2.0,
        hit_n,
        hit_surface,
    }
}

#[cfg(test)]
mod tests {
    //! Ported from legacy `collision.test.ts` — the square-wall cases (shaped
    //! and lane cases follow their machinery in M2). Same room, same numbers.
    use super::*;
    use crate::grid::{set_surface, set_tile, tile_center, Grid, T_FLOOR, T_WALL};

    const WALL_RUBBER: u8 = 1; // value irrelevant; only identity is asserted

    /// A 7x5 room: solid border, open interior, one pillar at (3,2).
    fn room() -> Grid {
        let mut g = Grid::solid(7, 5);
        for j in 1..4 {
            for i in 1..6 {
                set_tile(&mut g, i, j, T_FLOOR);
            }
        }
        set_tile(&mut g, 3, 2, T_WALL); // pillar
        g
    }

    const R: f64 = 0.3;

    #[test]
    fn detects_overlap_with_walls_and_clear_space() {
        let g = room();
        let (ox, oz) = tile_center(&g, 1, 1);
        assert!(!circle_collides(&g, ox, oz, R));
        let (px, pz) = tile_center(&g, 3, 2);
        assert!(circle_collides(&g, px, pz, R));
    }

    #[test]
    fn cannot_walk_through_a_wall() {
        let g = room();
        let (mut x, mut z) = tile_center(&g, 1, 2); // pillar two tiles east
        for _ in 0..100 {
            let r = move_circle(&g, x, z, R, 0.05, 0.0);
            x = r.x;
            z = r.z;
        }
        let pillar_west_edge = 3.0 - f64::from(g.w) / 2.0;
        assert!(x <= pillar_west_edge - R + 1e-3);
        assert!(!circle_collides(&g, x, z, R));
    }

    #[test]
    fn slides_along_a_wall_on_diagonal_input() {
        let g = room();
        let (sx, sz) = tile_center(&g, 2, 1); // against the north border wall
        let (mut x, mut z) = (sx, sz);
        for _ in 0..40 {
            let r = move_circle(&g, x, z, R, 0.05, -0.05);
            x = r.x;
            z = r.z;
        }
        assert!(x > sx + 1.0); // kept moving east...
        assert!((z - sz).abs() < 0.5); // ...while the wall held north
        assert!(!circle_collides(&g, x, z, R));
    }

    #[test]
    fn a_zero_move_is_a_no_op() {
        let g = room();
        let (x, z) = tile_center(&g, 1, 1);
        let r = move_circle(&g, x, z, R, 0.0, 0.0);
        assert_eq!(
            r,
            MoveResult {
                x,
                z,
                hit_n: None,
                hit_surface: 0
            }
        );
    }

    #[test]
    fn reports_the_surface_of_the_square_wall_that_stopped_the_move() {
        let mut g = room();
        set_surface(&mut g, 3, 2, WALL_RUBBER); // the pillar
        let (x, z) = tile_center(&g, 2, 2);
        let r = move_circle(&g, x, z, R, 1.2, 0.0); // drive east into it
        assert_eq!(r.hit_surface, WALL_RUBBER);
    }

    #[test]
    fn reports_zero_when_the_move_touches_nothing() {
        let mut g = room();
        set_surface(&mut g, 3, 2, WALL_RUBBER);
        let (x, z) = tile_center(&g, 1, 1);
        assert_eq!(move_circle(&g, x, z, R, 0.1, 0.0).hit_surface, 0);
    }

    #[test]
    fn survives_sub_stepping_a_fast_move_keeps_the_surface_it_struck() {
        // A pinball at speed ALWAYS sub-steps, so losing the surface across
        // sub-steps would mean surfaces only ever worked while walking.
        let mut g = room();
        set_surface(&mut g, 3, 2, WALL_RUBBER);
        let (x, z) = tile_center(&g, 1, 2);
        assert_eq!(move_circle(&g, x, z, R, 3.5, 0.0).hit_surface, WALL_RUBBER);
    }

    #[test]
    fn wall_contact_reports_the_outward_normal() {
        let g = room();
        // Pressed against the pillar's west face → normal points west (-x).
        let pillar_west_edge = 3.0 - f64::from(g.w) / 2.0;
        let n = wall_contact(
            &g,
            pillar_west_edge - R - 1e-3,
            0.5 - 5.0 / 2.0 + 2.0,
            R,
            0.05,
        );
        let (nx, nz) = n.expect("touching the pillar");
        assert!(
            nx < -0.9,
            "normal points away from the east wall, got ({nx}, {nz})"
        );
    }
}
