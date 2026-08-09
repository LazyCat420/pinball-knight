//! Circle-vs-tile-grid collision. No physics engine — a top-down grid maze
//! needs axis-separated sweep-and-clamp, which is deterministic, debuggable
//! and ~60 lines (legacy BLUEPRINT §1.5 for why Rapier stays on the shelf).
//! Full port of `legacy/src/game/pinball-knight/engine/collision.ts`:
//! square sweep + shaped corrective pass (slants, rounds, multi-tile arcs),
//! kick bands, booster lanes, arc corners.
//!
//! Movement is resolved one axis at a time: try the X move, clamp against any
//! wall the circle would enter, then the same for Z. Clamping only the moved
//! axis is what produces wall SLIDING for free.
//!
//! Coordinates are world coords (maze centred on origin, 1 tile = 1 unit).

use crate::grid::{arc_feature_at, arc_index_at, is_walkable, shape_at, surface_at, Grid};
use crate::tile_shape::{
    is_arc, is_shaped, kick_band_at, lane_band_at, lane_tangent, resolve_arc_feature,
    resolve_circle_shape, ShapeHit, SHAPE_FULL,
};

const EPS: f64 = 1e-4;

/// Largest per-step move that keeps the axis sweep tunnel-free (< 1 − 2r).
const MAX_STEP: f64 = 0.4;

/// A kicker-band contact, by identity (mutate cooldown via
/// `grid.arcs[feature].kicks[band]`). The TS returned the band object itself;
/// indices are the borrow-friendly equivalent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KickRef {
    pub feature: usize,
    pub band: usize,
}

/// A booster-lane contact: the band that owns it plus its exit TANGENT, both
/// computed off the arc that answered so the launch follows the visible wall.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LaneHit {
    pub feature: usize,
    pub band: usize,
    pub tx: f64,
    pub tz: f64,
    /// Which ArcFeature this contact belongs to (the raw arc_idx value; -1
    /// when the grid carries none). The RAIL needs it to know it is still on
    /// the SAME curve frame to frame — without an identity, a ball brushing
    /// two different sweeps in quick succession would read as one continuous
    /// ride and keep its accumulated overspeed across a gap.
    pub feature_idx: i32,
    /// True when this face is CONCAVE (solid outside) — the banked racing
    /// line. Only these can be railed: on a convex bulge there is nothing to
    /// lean into.
    pub concave: bool,
}

/// Does a solid tile block the axis-separated square sweep? A shaped tile is
/// TRANSPARENT to the sweep — its geometry is owned solely by the corrective
/// pass; its legs still block via the solid SQUARE neighbours that back them.
fn blocks_square(g: &Grid, i: i32, j: i32) -> bool {
    !is_walkable(g, i, j) && shape_at(g, i, j) == SHAPE_FULL
}

struct ShapeOrArcHit {
    hit: ShapeHit,
    kick: Option<KickRef>,
    lane: Option<LaneHit>,
}

/// Resolve a circle against ONE shaped tile, whatever family: slants and
/// single-tile rounds carry their geometry in the shape id; an ARC slice
/// defers to its multi-tile feature. Every arc slice of one feature resolves
/// against the SAME circle, so overlapping two slices yields one consistent
/// radial answer.
fn resolve_shape_or_arc(
    g: &Grid,
    shape: u8,
    i: i32,
    j: i32,
    gx: f64,
    gz: f64,
    r: f64,
    mx: f64,
    mz: f64,
) -> Option<ShapeOrArcHit> {
    if is_arc(shape) {
        let f = arc_feature_at(g, i, j)?;
        let hit = resolve_arc_feature(f, gx, gz, r)?;
        let fidx = arc_index_at(g, i, j);
        // A sweep can wear BOOSTER RUBBER (KickBand) or be a BOOSTER LANE
        // (LaneBand) — resolved here because only this scope knows WHICH
        // feature answered. A lane also needs the travel direction (mx/mz):
        // it only grabs a ball already moving along its grain.
        let feature = if fidx >= 0 { fidx as usize } else { 0 };
        let lane = lane_band_at(f, gx, gz, mx, mz).map(|li| {
            let (tx, tz) = lane_tangent(f, &f.lanes[li], gx, gz);
            LaneHit {
                feature,
                band: li,
                tx,
                tz,
                feature_idx: fidx,
                // solid_out = solid OUTSIDE = the ball rides the inside = a
                // banked face you can lean into. That is the rail surface.
                concave: f.solid_out,
            }
        });
        let kick = kick_band_at(f, gx, gz).map(|ki| KickRef { feature, band: ki });
        return Some(ShapeOrArcHit { hit, kick, lane });
    }
    resolve_circle_shape(shape, i, j, gx, gz, r).map(|hit| ShapeOrArcHit {
        hit,
        kick: None,
        lane: None,
    })
}

/// True if a circle at world (x, z) with radius r overlaps any solid tile
/// (shape-aware: a slant is tested against its triangle, not its square).
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
            let shape = shape_at(g, i, j);
            if is_shaped(shape) {
                // A static overlap test has no travel direction: a zero vector
                // means no lane can claim the contact, which is right — this
                // asks "am I inside a wall".
                if resolve_shape_or_arc(g, shape, i, j, gx, gz, r, 0.0, 0.0).is_some() {
                    return true;
                }
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
/// it. Probes the four cardinals a hair beyond the body radius; a corner sums
/// two normals into a diagonal.
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

/// CURVED WALLS — a banked corner arc auto-derived from maze topology: a
/// POINT-TRIGGER momentum BANK plus a rendered quarter-cylinder wedge, not a
/// new collider (a grid this tight can't host a real circle-vs-arc solid
/// without sealing 1-wide bends). `d1/d2` are the corner's two OPEN legs;
/// `qi/qj` mark WHICH tile corner the wedge caps. `cooldown_t`/`hit_t` are
/// per-frame scratch, reset when the arc list is rebuilt each level.
#[derive(Debug, Clone, PartialEq)]
pub struct ArcCorner {
    pub cx: f64,
    pub cz: f64,
    pub d1x: f64,
    pub d1z: f64,
    pub d2x: f64,
    pub d2z: f64,
    /// 0 → west edge, 1 → east edge of the tile.
    pub qi: i32,
    /// 0 → north edge, 1 → south edge of the tile.
    pub qj: i32,
    pub cooldown_t: f64,
    pub hit_t: f64,
}

/// Every maze corner that reads as a banked curve: a floor tile with two
/// PERPENDICULAR wall neighbours (solid diagonal between them) whose two open
/// sides — and the far diagonal — are floor. The open-neighbour + far-diagonal
/// gate excludes 1-wide dogleg bends, so a curve never pinches a corridor.
/// A corner where any tile of the 3×3 owns a REAL authored arc face stands
/// down (censused at ~328 corners vs ~84 authored features per floor — this
/// pass would bury the authored geometry otherwise).
pub fn compute_arc_corners(g: &Grid) -> Vec<ArcCorner> {
    let mut out = Vec::new();
    let ox = f64::from(g.w) / 2.0;
    let oz = f64::from(g.h) / 2.0;
    let floor = |i: i32, j: i32| is_walkable(g, i, j);
    let wall = |i: i32, j: i32| !is_walkable(g, i, j);
    // Per crook: two wall dirs, the solid diagonal, the far (open) diagonal,
    // the two open legs, and which tile corner the wedge caps.
    struct Crook {
        wa: (i32, i32),
        wb: (i32, i32),
        diag: (i32, i32),
        opp: (i32, i32),
        l1: (i32, i32),
        l2: (i32, i32),
        qi: i32,
        qj: i32,
    }
    let crooks = [
        Crook {
            wa: (0, -1),
            wb: (1, 0),
            diag: (1, -1),
            opp: (-1, 1),
            l1: (-1, 0),
            l2: (0, 1),
            qi: 1,
            qj: 0,
        }, // NE
        Crook {
            wa: (0, -1),
            wb: (-1, 0),
            diag: (-1, -1),
            opp: (1, 1),
            l1: (1, 0),
            l2: (0, 1),
            qi: 0,
            qj: 0,
        }, // NW
        Crook {
            wa: (0, 1),
            wb: (1, 0),
            diag: (1, 1),
            opp: (-1, -1),
            l1: (-1, 0),
            l2: (0, -1),
            qi: 1,
            qj: 1,
        }, // SE
        Crook {
            wa: (0, 1),
            wb: (-1, 0),
            diag: (-1, 1),
            opp: (1, -1),
            l1: (1, 0),
            l2: (0, -1),
            qi: 0,
            qj: 1,
        }, // SW
    ];
    // "Does any tile of this corner own an arc face" — the crook tested is the
    // FLOOR tile beside a fillet's WALL-side rim.
    let owns_arc = |i: i32, j: i32| -> bool {
        let Some(arr) = &g.arc_idx else { return false };
        for dj in -1..=1 {
            for di in -1..=1 {
                let x = i + di;
                let y = j + dj;
                if x < 0 || y < 0 || x >= g.w || y >= g.h {
                    continue;
                }
                if arr[(y * g.w + x) as usize] >= 0 {
                    return true;
                }
            }
        }
        false
    };
    for j in 1..g.h - 1 {
        for i in 1..g.w - 1 {
            if !floor(i, j) {
                continue;
            }
            if owns_arc(i, j) {
                continue;
            }
            for c in &crooks {
                if wall(i + c.wa.0, j + c.wa.1)
                    && wall(i + c.wb.0, j + c.wb.1)
                    && wall(i + c.diag.0, j + c.diag.1)
                    && floor(i + c.l1.0, j + c.l1.1)
                    && floor(i + c.l2.0, j + c.l2.1)
                    && floor(i + c.opp.0, j + c.opp.1)
                {
                    out.push(ArcCorner {
                        cx: f64::from(i) + 0.5 - ox,
                        cz: f64::from(j) + 0.5 - oz,
                        d1x: f64::from(c.l1.0),
                        d1z: f64::from(c.l1.1),
                        d2x: f64::from(c.l2.0),
                        d2z: f64::from(c.l2.1),
                        qi: c.qi,
                        qj: c.qj,
                        cooldown_t: 0.0,
                        hit_t: -1.0,
                    });
                }
            }
        }
    }
    out
}

/// The resolved position, plus the contact NORMAL if a SHAPED wall was hit —
/// the pinball reflection reads `hit_n` for a diagonal ricochet; every other
/// caller ignores it and takes {x, z}.
#[derive(Debug, Clone, PartialEq)]
pub struct MoveResult {
    pub x: f64,
    pub z: f64,
    pub hit_n: Option<(f64, f64)>,
    /// The BOOSTER band that owned the contact, when `hit_n` came off kicker
    /// rubber on an arc sweep. None for plain stone.
    pub hit_kick: Option<KickRef>,
    /// The BOOSTER LANE that owned the contact, when the ball runs WITH a
    /// curved speed strip — the ricochet becomes a tangential launch instead.
    /// Mutually exclusive with hit_kick in practice.
    pub hit_lane: Option<LaneHit>,
    /// The WALL SURFACE of the tile that actually stopped this move — 0 when
    /// nothing was hit, which is also stone, so the pinball reflection reads
    /// it unconditionally. Reported here because only this code knows WHICH
    /// tile did the stopping.
    pub hit_surface: u8,
}

struct ShapedResolve {
    gx: f64,
    gz: f64,
    nx: f64,
    nz: f64,
    kick: Option<KickRef>,
    lane: Option<LaneHit>,
    surface: u8,
}

/// Push a circle out of every SHAPED tile it overlaps; deepest contact wins.
/// The square sweep leaves shaped tiles alone, so this is their sole collider.
fn resolve_shaped(g: &Grid, gx: f64, gz: f64, r: f64, mx: f64, mz: f64) -> Option<ShapedResolve> {
    let i0 = (gx - r).floor() as i32;
    let i1 = (gx + r).floor() as i32;
    let j0 = (gz - r).floor() as i32;
    let j1 = (gz + r).floor() as i32;
    let mut best: Option<(f64, ShapeOrArcHit, u8)> = None;
    for j in j0..=j1 {
        for i in i0..=i1 {
            let shape = shape_at(g, i, j);
            if !is_shaped(shape) || is_walkable(g, i, j) {
                continue;
            }
            if let Some(hit) = resolve_shape_or_arc(g, shape, i, j, gx, gz, r, mx, mz) {
                // The DEEPEST overlap wins, and its surface rides along with
                // it — the face and the material must come from the same tile
                // or a rubber bend could kick with stone's restitution.
                if best.as_ref().is_none_or(|(pen, _, _)| hit.hit.pen > *pen) {
                    let pen = hit.hit.pen;
                    best = Some((pen, hit, surface_at(g, i, j)));
                }
            }
        }
    }
    let (_, h, surface) = best?;
    Some(ShapedResolve {
        gx: gx + h.hit.nx * (h.hit.pen + EPS),
        gz: gz + h.hit.nz * (h.hit.pen + EPS),
        nx: h.hit.nx,
        nz: h.hit.nz,
        kick: h.kick,
        lane: h.lane,
        surface,
    })
}

struct StepResult {
    gx: f64,
    gz: f64,
    hit_n: Option<(f64, f64)>,
    hit_kick: Option<KickRef>,
    hit_lane: Option<LaneHit>,
    hit_surface: u8,
}

/// One sweep-and-clamp move (square walls) + one corrective shaped pass. Grid
/// coords in/out.
fn move_circle_step(g: &Grid, gx0: f64, gz0: f64, r: f64, dx: f64, dz: f64) -> StepResult {
    let mut gx = gx0;
    // The surface of whichever tile clamped us. Both axes write it; the LAST
    // write wins — arbitrary but DETERMINISTIC (blending two surfaces would
    // make a rubber/mud corner behave like neither).
    let mut hit_surface = 0u8;

    // ── X axis (square walls only; shaped tiles are transparent here) ──
    if dx != 0.0 {
        gx += dx;
        let dir = dx.signum();
        let lead = if dir > 0.0 { gx + r } else { gx - r };
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

    // ── Corrective pass: push out of any shaped tile, capture its normal.
    // The requested move (dx,dz) IS the travel direction at contact — what a
    // booster lane needs to decide the ball runs with its grain.
    if let Some(s) = resolve_shaped(g, gx, gz, r, dx, dz) {
        return StepResult {
            gx: s.gx,
            gz: s.gz,
            hit_n: Some((s.nx, s.nz)),
            hit_kick: s.kick,
            hit_lane: s.lane,
            hit_surface: s.surface,
        };
    }
    StepResult {
        gx,
        gz,
        hit_n: None,
        hit_kick: None,
        hit_lane: None,
        hit_surface,
    }
}

/// Move a circle by (dx, dz), clamping against walls (square tiles) and
/// shaped tiles. Sub-steps when the requested move exceeds the no-tunnel
/// bound (the pinball at terminal speed does ~0.5 units/frame).
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
    let mut hit_kick = None;
    let mut hit_lane = None;
    let mut hit_surface = 0u8;
    for _ in 0..steps {
        let r2 = move_circle_step(g, gx, gz, r, sx, sz);
        gx = r2.gx;
        gz = r2.gz;
        // Surface is kept from any sub-step that touched something,
        // independently of hit_n: a SQUARE wall reports a surface with no
        // normal. Gating on hit_n would make every flat wall stone.
        if r2.hit_surface != 0 {
            hit_surface = r2.hit_surface;
        }
        if r2.hit_n.is_some() {
            hit_n = r2.hit_n; // keep the most recent shaped contact…
            hit_kick = r2.hit_kick; // …and the rubber that went with it
            hit_lane = r2.hit_lane; // …and the lane, likewise
        }
    }
    MoveResult {
        x: gx - f64::from(g.w) / 2.0,
        z: gz - f64::from(g.h) / 2.0,
        hit_n,
        hit_kick,
        hit_lane,
        hit_surface,
    }
}

#[cfg(test)]
mod tests {
    //! Ported from legacy `collision.test.ts` — square-wall, slant, lane and
    //! arc-corner sections. Same rooms, same numbers.
    use super::*;
    use crate::grid::{
        ensure_arcs, set_shape, set_surface, set_tile, tile_center, Grid, T_FLOOR, T_WALL,
    };
    use crate::tile_shape::{ArcFeature, LaneBand, SHAPE_ARC, SHAPE_SLANT_NE};

    const WALL_RUBBER: u8 = 1;
    const WALL_ICE: u8 = 2;
    const R: f64 = 0.3;

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
        let (mut x, mut z) = tile_center(&g, 1, 2);
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
        let (sx, sz) = tile_center(&g, 2, 1);
        let (mut x, mut z) = (sx, sz);
        for _ in 0..40 {
            let r = move_circle(&g, x, z, R, 0.05, -0.05);
            x = r.x;
            z = r.z;
        }
        assert!(x > sx + 1.0);
        assert!((z - sz).abs() < 0.5);
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
                hit_kick: None,
                hit_lane: None,
                hit_surface: 0
            }
        );
    }

    #[test]
    fn reports_the_surface_of_the_square_wall_that_stopped_the_move() {
        let mut g = room();
        set_surface(&mut g, 3, 2, WALL_RUBBER);
        let (x, z) = tile_center(&g, 2, 2);
        assert_eq!(move_circle(&g, x, z, R, 1.2, 0.0).hit_surface, WALL_RUBBER);
    }

    #[test]
    fn reports_zero_when_the_move_touches_nothing() {
        let mut g = room();
        set_surface(&mut g, 3, 2, WALL_RUBBER);
        let (x, z) = tile_center(&g, 1, 1);
        assert_eq!(move_circle(&g, x, z, R, 0.1, 0.0).hit_surface, 0);
    }

    #[test]
    fn reports_the_surface_of_a_shaped_wall_from_the_tile_that_resolved() {
        // Slants resolve by a different path than square walls (the
        // corrective pass) — the two need separate cover.
        let mut g = room();
        set_tile(&mut g, 5, 1, T_WALL);
        set_shape(&mut g, 5, 1, SHAPE_SLANT_NE);
        set_surface(&mut g, 5, 1, WALL_ICE);
        let (x, z) = tile_center(&g, 5, 1);
        let res = move_circle(&g, x, z, R, 0.0, 0.0);
        assert!(res.hit_n.is_some(), "the slant did resolve");
        assert_eq!(res.hit_surface, WALL_ICE);
    }

    #[test]
    fn survives_sub_stepping() {
        let mut g = room();
        set_surface(&mut g, 3, 2, WALL_RUBBER);
        let (x, z) = tile_center(&g, 1, 2);
        assert_eq!(move_circle(&g, x, z, R, 3.5, 0.0).hit_surface, WALL_RUBBER);
    }

    /// A 7×7 open room with a single SLANT_NE wall at (3,3) (world origin),
    /// backed by solid W (2,3) and S (3,4) neighbours.
    fn slant_room() -> Grid {
        let mut g = Grid::solid(7, 7);
        for j in 1..6 {
            for i in 1..6 {
                set_tile(&mut g, i, j, T_FLOOR);
            }
        }
        set_tile(&mut g, 3, 3, T_WALL);
        set_tile(&mut g, 2, 3, T_WALL); // west backing leg
        set_tile(&mut g, 3, 4, T_WALL); // south backing leg
        set_shape(&mut g, 3, 3, SHAPE_SLANT_NE);
        g
    }

    #[test]
    fn slant_is_solid_on_the_cut_off_side_and_open_on_the_ne_side() {
        let g = slant_room(); // tile (3,3) centre is world (0,0)
        assert!(circle_collides(&g, -0.3, 0.3, 0.2)); // SW solid half
        assert!(!circle_collides(&g, 0.3, -0.3, 0.2)); // NE open half
    }

    #[test]
    fn move_into_the_diagonal_pushes_back_along_the_ne_normal() {
        let g = slant_room();
        let res = move_circle(&g, 0.35, -0.35, 0.25, -0.3, 0.3);
        let (nx, nz) = res.hit_n.expect("hit the slant");
        assert!(nx > 0.0 && nz < 0.0, "pushed NE, got ({nx}, {nz})");
        assert!(!circle_collides(&g, res.x, res.z, 0.25));
    }

    #[test]
    fn a_move_that_never_touches_a_slant_reports_no_normal() {
        let g = slant_room();
        assert!(move_circle(&g, 1.2, 1.2, 0.25, 0.1, 0.0).hit_n.is_none());
    }

    /// A big open room with ONE convex arc feature (radius-3 quarter guide at
    /// grid (8,8)) wearing a lane across its span.
    fn lane_room(cw: bool) -> Grid {
        let mut g = Grid::solid(16, 16);
        for j in 1..15 {
            for i in 1..15 {
                set_tile(&mut g, i, j, T_FLOOR);
            }
        }
        ensure_arcs(&mut g);
        g.arcs.push(ArcFeature {
            cx: 8.0,
            cz: 8.0,
            r: 3.0,
            a0: 0.0,
            span: std::f64::consts::FRAC_PI_2,
            lanes: vec![LaneBand {
                a0: 0.0,
                span: std::f64::consts::FRAC_PI_2,
                cw,
                cooldown_t: 0.0,
                hit_t: -1.0,
            }],
            ..Default::default()
        });
        for j in 8..=11 {
            for i in 8..=11 {
                let d = libm::hypot(f64::from(i) + 0.5 - 8.0, f64::from(j) + 0.5 - 8.0);
                if d > 2.0 && d < 4.0 {
                    set_tile(&mut g, i, j, T_WALL);
                    set_shape(&mut g, i, j, SHAPE_ARC);
                    g.arc_idx.as_mut().unwrap()[(j * 16 + i) as usize] = 0;
                }
            }
        }
        g
    }

    /// Drive a circle into the arc face at `ang`, travelling (dx, dz).
    fn probe(g: &Grid, ang: f64, dx: f64, dz: f64) -> MoveResult {
        let r = 3.55;
        let x = 8.0 + ang.cos() * r - f64::from(g.w) / 2.0;
        let z = 8.0 + ang.sin() * r - f64::from(g.h) / 2.0;
        move_circle(g, x, z, R, dx, dz)
    }

    #[test]
    fn reports_a_lane_hit_for_a_ball_running_with_the_grain() {
        let g = lane_room(true);
        let ang = 0.6_f64;
        let tx = -ang.sin();
        let tz = ang.cos();
        let inx = -ang.cos() * 0.35;
        let inz = -ang.sin() * 0.35;
        let res = probe(&g, ang, tx * 0.3 + inx, tz * 0.3 + inz);
        assert!(res.hit_n.is_some());
        let lane = res.hit_lane.expect("lane grabbed the ball");
        assert!(
            (libm::hypot(lane.tx, lane.tz) - 1.0).abs() < 1e-6,
            "unit exit tangent"
        );
        assert!(
            lane.tx * tx + lane.tz * tz > 0.9,
            "points the way the lane throws"
        );
        assert_eq!(lane.feature_idx, 0);
    }

    #[test]
    fn reports_no_lane_for_a_ball_running_against_the_grain() {
        let g = lane_room(true);
        let ang = 0.6_f64;
        let tx = -ang.sin();
        let tz = ang.cos();
        let inx = -ang.cos() * 0.35;
        let inz = -ang.sin() * 0.35;
        let res = probe(&g, ang, -tx * 0.3 + inx, -tz * 0.3 + inz);
        assert!(res.hit_n.is_some(), "still hits the wall");
        assert!(res.hit_lane.is_none(), "but the lane does not grab it");
    }

    #[test]
    fn a_spent_lane_reports_nothing_until_its_cooldown_clears() {
        let mut g = lane_room(true);
        g.arcs[0].lanes[0].cooldown_t = 0.5;
        let ang = 0.6_f64;
        let tx = -ang.sin();
        let tz = ang.cos();
        let res = probe(
            &g,
            ang,
            tx * 0.3 - ang.cos() * 0.35,
            tz * 0.3 - ang.sin() * 0.35,
        );
        assert!(res.hit_n.is_some());
        assert!(res.hit_lane.is_none());
    }

    /// Build a grid from an ASCII map ('.' floor, '#' wall). Row 0 is j=0.
    fn from_ascii(rows: &[&str]) -> Grid {
        let h = rows.len() as i32;
        let w = rows[0].len() as i32;
        let mut g = Grid::solid(w, h);
        for (j, row) in rows.iter().enumerate() {
            for (i, ch) in row.chars().enumerate() {
                if ch == '.' {
                    set_tile(&mut g, i as i32, j as i32, T_FLOOR);
                }
            }
        }
        g
    }

    #[test]
    fn rounds_all_four_inner_corners_of_a_2x2_open_pocket() {
        let g = from_ascii(&["#####", "#####", "#..##", "#..##", "#####"]);
        let arcs = compute_arc_corners(&g);
        assert_eq!(arcs.len(), 4);
        // The NE crook: open legs are West and South.
        let ne = arcs
            .iter()
            .find(|a| a.qi == 1 && a.qj == 0)
            .expect("NE crook");
        let legs: std::collections::HashSet<(i64, i64)> = [
            (ne.d1x as i64, ne.d1z as i64),
            (ne.d2x as i64, ne.d2z as i64),
        ]
        .into();
        assert!(legs.contains(&(-1, 0)), "west leg");
        assert!(legs.contains(&(0, 1)), "south leg");
    }

    #[test]
    fn never_places_a_curve_on_a_1_wide_dogleg_bend() {
        let g = from_ascii(&["####", "#.##", "#..#", "####"]);
        assert!(compute_arc_corners(&g).is_empty());
    }
}
