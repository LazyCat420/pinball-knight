//! TILE SHAPES — the single source of truth that lets a maze tile be something
//! other than a box. Port of `legacy/.../engine/tile-shape.ts`.
//!
//! The maze grid says only WALL/FLOOR per tile. A parallel `shapes` array lets
//! a WALL tile additionally carry a SHAPE: FULL (default), one of four 45°
//! SLANTs, a ROUND (quarter-disc corner), or an ARC slice of a multi-tile
//! feature. The SAME derivation feeds BOTH the collider and the wall mesh, so
//! what you see and what you hit can never disagree.
//!
//! A SLANT is named by its OPEN (cut) corner, which is ALSO the outward-normal
//! direction and the ricochet direction. Directions: North = −z, South = +z,
//! East = +x, West = −x. NB: this "named by open corner" convention is the
//! INVERSE of `compute_arc_corners`'s crook naming (keyed by the SOLID
//! diagonal).
//!
//! Tile-local coordinates are [0,1]² with the tile's NW corner at (0,0).
//!
//! PORTS: `legacy/.../engine/tile-shape.ts`

pub const SHAPE_FULL: u8 = 0;
pub const SHAPE_SLANT_NE: u8 = 1;
pub const SHAPE_SLANT_NW: u8 = 2;
pub const SHAPE_SLANT_SE: u8 = 3;
pub const SHAPE_SLANT_SW: u8 = 4;
// ROUND_x rounds the same corner a SLANT_x cuts, with a quarter-circle arc
// (radius = 1 tile): solid quarter-DISC centred on the corner OPPOSITE the cut.
pub const SHAPE_ROUND_NE: u8 = 5;
pub const SHAPE_ROUND_NW: u8 = 6;
pub const SHAPE_ROUND_SE: u8 = 7;
pub const SHAPE_ROUND_SW: u8 = 8;
/// One slice of a MULTI-TILE arc feature (radius 2+ sweeping curve). Geometry
/// lives OFF-GRID in `Grid.arcs[Grid.arc_idx[tile]]`; the id says "ask the
/// feature".
pub const SHAPE_ARC: u8 = 9;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Vec2 {
    pub x: f64,
    pub z: f64,
}

pub const fn v2(x: f64, z: f64) -> Vec2 {
    Vec2 { x, z }
}

pub fn is_slant(shape: u8) -> bool {
    (SHAPE_SLANT_NE..=SHAPE_SLANT_SW).contains(&shape)
}

pub fn is_round(shape: u8) -> bool {
    (SHAPE_ROUND_NE..=SHAPE_ROUND_SW).contains(&shape)
}

pub fn is_arc(shape: u8) -> bool {
    shape == SHAPE_ARC
}

/// Any non-FULL shape — transparent to the square sweep.
pub fn is_shaped(shape: u8) -> bool {
    is_slant(shape) || is_round(shape) || is_arc(shape)
}

/// Which corner a ROUND cuts, as the equivalent SLANT id (shared tables).
fn round_to_slant(shape: u8) -> u8 {
    shape - (SHAPE_ROUND_NE - SHAPE_SLANT_NE)
}

/// The ROUND that cuts the same corner as a given SLANT.
pub fn slant_to_round(shape: u8) -> u8 {
    shape + (SHAPE_ROUND_NE - SHAPE_SLANT_NE)
}

// The four unit-cell corners (tile-local).
const NW: Vec2 = v2(0.0, 0.0);
const NE: Vec2 = v2(1.0, 0.0);
const SW: Vec2 = v2(0.0, 1.0);
const SE: Vec2 = v2(1.0, 1.0);

const SQRT1_2: f64 = std::f64::consts::FRAC_1_SQRT_2;

/// The three SOLID corners of a slant tile (cut corner is the one NOT listed).
pub fn shape_corners(shape: u8) -> Option<[Vec2; 3]> {
    match shape {
        SHAPE_SLANT_NE => Some([NW, SW, SE]), // cut NE
        SHAPE_SLANT_NW => Some([NE, SE, SW]), // cut NW
        SHAPE_SLANT_SE => Some([NE, NW, SW]), // cut SE
        SHAPE_SLANT_SW => Some([NE, NW, SE]), // cut SW
        _ => None,
    }
}

/// The outward unit normal of a slant's hypotenuse (points at the open corner).
pub fn shape_normal(shape: u8) -> Option<Vec2> {
    match shape {
        SHAPE_SLANT_NE => Some(v2(SQRT1_2, -SQRT1_2)),
        SHAPE_SLANT_NW => Some(v2(-SQRT1_2, -SQRT1_2)),
        SHAPE_SLANT_SE => Some(v2(SQRT1_2, SQRT1_2)),
        SHAPE_SLANT_SW => Some(v2(-SQRT1_2, SQRT1_2)),
        _ => None,
    }
}

/// The two neighbour offsets whose walls must be solid to "back" a shape's
/// legs. Depends only on the cut corner, so a ROUND maps to its SLANT.
pub fn shape_backing(shape: u8) -> Option<[Vec2; 2]> {
    let s = if is_round(shape) {
        round_to_slant(shape)
    } else {
        shape
    };
    match s {
        SHAPE_SLANT_NE => Some([v2(-1.0, 0.0), v2(0.0, 1.0)]), // W, S
        SHAPE_SLANT_NW => Some([v2(1.0, 0.0), v2(0.0, 1.0)]),  // E, S
        SHAPE_SLANT_SE => Some([v2(0.0, -1.0), v2(-1.0, 0.0)]), // N, W
        SHAPE_SLANT_SW => Some([v2(0.0, -1.0), v2(1.0, 0.0)]), // N, E
        _ => None,
    }
}

/// Tile-local arc centre for a ROUND (corner OPPOSITE the cut), or None.
pub fn round_center(shape: u8) -> Option<Vec2> {
    match shape {
        SHAPE_ROUND_NE => Some(v2(0.0, 1.0)), // cut NE → centre SW
        SHAPE_ROUND_NW => Some(v2(1.0, 1.0)), // cut NW → centre SE
        SHAPE_ROUND_SE => Some(v2(0.0, 0.0)), // cut SE → centre NW
        SHAPE_ROUND_SW => Some(v2(1.0, 0.0)), // cut SW → centre NE
        _ => None,
    }
}

/// Sign of the open quadrant (centre → cut corner) — gates the arc to its open
/// side so it never pushes a ball sitting behind a backed leg.
fn round_open(shape: u8) -> Option<Vec2> {
    match shape {
        SHAPE_ROUND_NE => Some(v2(1.0, -1.0)),
        SHAPE_ROUND_NW => Some(v2(-1.0, -1.0)),
        SHAPE_ROUND_SE => Some(v2(1.0, 1.0)),
        SHAPE_ROUND_SW => Some(v2(-1.0, 1.0)),
        _ => None,
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ShapeHit {
    pub nx: f64,
    pub nz: f64,
    pub pen: f64,
}

/// Resolve a circle against a ROUND tile's quarter-disc (radius 1). The
/// contact normal VARIES along the arc — that's the curved ricochet.
fn resolve_circle_arc(
    px: f64,
    pz: f64,
    r: f64,
    cx: f64,
    cz: f64,
    open_x: f64,
    open_z: f64,
) -> Option<ShapeHit> {
    let dx = px - cx;
    let dz = pz - cz;
    let d = crate::jsmath::js_hypot(dx, dz);
    if d < 1e-6 || d >= 1.0 + r {
        return None; // degenerate, or beyond the arc
    }
    if dx * open_x < -1e-6 || dz * open_z < -1e-6 {
        return None; // behind a backed leg
    }
    Some(ShapeHit {
        nx: dx / d,
        nz: dz / d,
        pen: 1.0 + r - d,
    })
}

/// Unified collider for a shaped tile at (i, j): slant → triangle, round →
/// quarter-disc. The one entry point collision calls (arcs defer to their
/// feature there).
pub fn resolve_circle_shape(
    shape: u8,
    i: i32,
    j: i32,
    px: f64,
    pz: f64,
    r: f64,
) -> Option<ShapeHit> {
    if is_slant(shape) {
        let tri = shape_triangle_at(shape, i, j).unwrap();
        return resolve_circle_triangle(v2(px, pz), r, tri[0], tri[1], tri[2]);
    }
    if is_round(shape) {
        let c = round_center(shape).unwrap();
        let o = round_open(shape).unwrap();
        return resolve_circle_arc(px, pz, r, f64::from(i) + c.x, f64::from(j) + c.z, o.x, o.z);
    }
    None
}

// ── MULTI-TILE ARC FEATURES — sweeping curved walls (radius 2+ tiles) ────────

/// One sweeping curved wall: a circular arc of radius `r` tiles centred at a
/// GRID-space point. Angles in the atan2(z, x) frame (0 = east, π/2 = south);
/// solid span [a0, a0+span]; span = 2π means a full round island.
#[derive(Debug, Clone, Default)]
pub struct ArcFeature {
    /// Arc centre in GRID coords.
    pub cx: f64,
    pub cz: f64,
    /// Radius in tiles.
    pub r: f64,
    /// Start angle (radians). Ignored when span ≥ 2π.
    pub a0: f64,
    /// Angular extent (radians, > 0). 2π = full circle.
    pub span: f64,
    /// false = solid INSIDE (convex guide); true = solid OUTSIDE (concave bowl).
    pub solid_out: bool,
    /// Who authored this face ("track"/"island"/"funnel"/"sweep"); absent reads
    /// as sweep — the one that yields (see legacy arc-contract).
    pub owner: Option<&'static str>,
    /// KICKER BANDS strung along this face — the pinball rubber.
    pub kicks: Vec<KickBand>,
    /// BOOSTER LANES strung along this face — rubber THROWS, a lane CARRIES.
    pub lanes: Vec<LaneBand>,
}

/// A live BOOSTER band on an arc face. Sub-span of the owning feature, so mesh
/// and trigger can never disagree. `cooldown_t`/`hit_t` are per-frame scratch
/// with one owner.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct KickBand {
    pub a0: f64,
    pub span: f64,
    /// Re-fire lockout, seconds. >0 = dead rubber.
    pub cooldown_t: f64,
    /// Seconds since the last kick, or <0 for never — drives the flash.
    pub hit_t: f64,
}

/// A live BOOSTER LANE — tangential: roll into the curve WITH its grain and it
/// sweeps you around the bend, faster. One-way by construction.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LaneBand {
    pub a0: f64,
    pub span: f64,
    /// Direction the lane throws: true = increasing angle.
    pub cw: bool,
    pub cooldown_t: f64,
    pub hit_t: f64,
}

const TWO_PI: f64 = std::f64::consts::TAU;

/// Is angle `ang` within [a0, a0+span] (mod 2π)?
pub fn angle_in_span(ang: f64, a0: f64, span: f64) -> bool {
    if span >= TWO_PI - 1e-9 {
        return true;
    }
    let mut rel = (ang - a0) % TWO_PI;
    if rel < 0.0 {
        rel += TWO_PI;
    }
    rel <= span + 1e-9
}

/// Which booster lane (if any, by index) owns the contact at (px,pz), given
/// the ball's momentum: same angular test as kicks PLUS the grain check.
pub fn lane_band_at(f: &ArcFeature, px: f64, pz: f64, mx: f64, mz: f64) -> Option<usize> {
    if f.lanes.is_empty() {
        return None;
    }
    let dx = px - f.cx;
    let dz = pz - f.cz;
    let d = crate::jsmath::js_hypot(dx, dz);
    if d < 1e-6 {
        return None;
    }
    let ang = libm::atan2(dz, dx);
    for (li, l) in f.lanes.iter().enumerate() {
        if l.cooldown_t > 0.0 {
            continue;
        }
        if !angle_in_span(ang, l.a0, l.span) {
            continue;
        }
        // Tangent at contact, pointing the way the lane throws (radial +90°).
        let sign = if l.cw { 1.0 } else { -1.0 };
        let tx = (-dz / d) * sign;
        let tz = (dx / d) * sign;
        if mx * tx + mz * tz <= 0.0 {
            continue; // against the grain — no boost
        }
        return Some(li);
    }
    None
}

/// The unit TANGENT of lane `l` at contact (px,pz) — the boosted exit
/// direction, from the same circle the collider used.
pub fn lane_tangent(f: &ArcFeature, l: &LaneBand, px: f64, pz: f64) -> (f64, f64) {
    let dx = px - f.cx;
    let dz = pz - f.cz;
    let d = crate::jsmath::js_hypot(dx, dz);
    let d = if d == 0.0 { 1.0 } else { d };
    let sign = if l.cw { 1.0 } else { -1.0 };
    ((-dz / d) * sign, (dx / d) * sign)
}

/// Which kicker band (if any, by index) owns the contact at (px,pz). Keyed off
/// the CONTACT ANGLE — exactly the point resolve_arc_feature pushed along.
pub fn kick_band_at(f: &ArcFeature, px: f64, pz: f64) -> Option<usize> {
    if f.kicks.is_empty() {
        return None;
    }
    let ang = libm::atan2(pz - f.cz, px - f.cx);
    for (ki, k) in f.kicks.iter().enumerate() {
        if k.cooldown_t > 0.0 {
            continue;
        }
        if angle_in_span(ang, k.a0, k.span) {
            return Some(ki);
        }
    }
    None
}

/// Resolve a circle against an arc feature's curved face. Push-out is radial
/// (normal varies along the sweep). Outside the angular span the straight
/// walls own the contact.
pub fn resolve_arc_feature(f: &ArcFeature, px: f64, pz: f64, r: f64) -> Option<ShapeHit> {
    let dx = px - f.cx;
    let dz = pz - f.cz;
    let d = crate::jsmath::js_hypot(dx, dz);
    if d < 1e-6 {
        return None; // degenerate centre
    }
    if f.solid_out {
        // Concave bowl: free space is d ≤ f.r − r; push back toward the centre.
        if d <= f.r - r {
            return None;
        }
        if !angle_in_span(libm::atan2(dz, dx), f.a0, f.span) {
            return None;
        }
        return Some(ShapeHit {
            nx: -dx / d,
            nz: -dz / d,
            pen: d + r - f.r,
        });
    }
    // Convex guide: free space is d ≥ f.r + r; push radially outward.
    if d >= f.r + r {
        return None;
    }
    if !angle_in_span(libm::atan2(dz, dx), f.a0, f.span) {
        return None;
    }
    Some(ShapeHit {
        nx: dx / d,
        nz: dz / d,
        pen: f.r + r - d,
    })
}

/// The three solid-triangle vertices of a slant at tile (i, j), offset into
/// the caller's coordinate space. None for FULL.
pub fn shape_triangle_at(shape: u8, i: i32, j: i32) -> Option<[Vec2; 3]> {
    let tri = shape_corners(shape)?;
    Some([
        v2(f64::from(i) + tri[0].x, f64::from(j) + tri[0].z),
        v2(f64::from(i) + tri[1].x, f64::from(j) + tri[1].z),
        v2(f64::from(i) + tri[2].x, f64::from(j) + tri[2].z),
    ])
}

// ── 2D geometry helpers (x/z plane) — used by collide::resolve_shaped ────────

fn d2(ax: f64, az: f64, bx: f64, bz: f64) -> f64 {
    let dx = ax - bx;
    let dz = az - bz;
    dx * dx + dz * dz
}

/// Closest point on segment a→b to point p.
pub fn closest_on_segment(p: Vec2, a: Vec2, b: Vec2) -> Vec2 {
    let abx = b.x - a.x;
    let abz = b.z - a.z;
    let mut len2 = abx * abx + abz * abz;
    if len2 == 0.0 {
        len2 = 1e-12;
    }
    let t = (((p.x - a.x) * abx + (p.z - a.z) * abz) / len2).clamp(0.0, 1.0);
    v2(a.x + abx * t, a.z + abz * t)
}

/// Is point p inside triangle (a,b,c)? (winding-independent sign test)
pub fn point_in_triangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2) -> bool {
    let d1 = sign(p, a, b);
    let d2s = sign(p, b, c);
    let d3 = sign(p, c, a);
    let has_neg = d1 < 0.0 || d2s < 0.0 || d3 < 0.0;
    let has_pos = d1 > 0.0 || d2s > 0.0 || d3 > 0.0;
    !(has_neg && has_pos)
}

fn sign(p: Vec2, a: Vec2, b: Vec2) -> f64 {
    (p.x - b.x) * (a.z - b.z) - (a.x - b.x) * (p.z - b.z)
}

/// Outward unit normal of edge (a→b) of a triangle whose third vertex is
/// `third` — perpendicular pointing AWAY from the interior.
pub fn edge_outward_normal(a: Vec2, b: Vec2, third: Vec2) -> Vec2 {
    let mut nx = b.z - a.z;
    let mut nz = -(b.x - a.x);
    let mx = third.x - (a.x + b.x) / 2.0;
    let mz = third.z - (a.z + b.z) / 2.0;
    if nx * mx + nz * mz > 0.0 {
        nx = -nx;
        nz = -nz;
    }
    let len = crate::jsmath::js_hypot(nx, nz);
    let len = if len == 0.0 { 1.0 } else { len };
    v2(nx / len, nz / len)
}

/// Resolve a circle (centre p, radius r) against a solid triangle. Push-out
/// normal + penetration, or None if clear.
pub fn resolve_circle_triangle(p: Vec2, r: f64, a: Vec2, b: Vec2, c: Vec2) -> Option<ShapeHit> {
    if point_in_triangle(p, a, b, c) {
        // Centre inside: push out through the nearest edge.
        let edges = [(a, b, c), (b, c, a), (c, a, b)];
        let mut best_dist = f64::INFINITY;
        let mut best_n = v2(0.0, 0.0);
        for (e0, e1, third) in edges {
            let q = closest_on_segment(p, e0, e1);
            let dist = d2(p.x, p.z, q.x, q.z).sqrt();
            if dist < best_dist {
                best_dist = dist;
                best_n = edge_outward_normal(e0, e1, third);
            }
        }
        return Some(ShapeHit {
            nx: best_n.x,
            nz: best_n.z,
            pen: r + best_dist,
        });
    }
    // Outside: closest point over the three edges.
    let edges = [(a, b), (b, c), (c, a)];
    let mut best: Option<Vec2> = None;
    let mut best_d2 = f64::INFINITY;
    for (e0, e1) in edges {
        let q = closest_on_segment(p, e0, e1);
        let dd = d2(p.x, p.z, q.x, q.z);
        if dd < best_d2 {
            best_d2 = dd;
            best = Some(q);
        }
    }
    let best = best?;
    if best_d2 >= r * r {
        return None;
    }
    let mut dist = best_d2.sqrt();
    if dist == 0.0 {
        dist = 1e-6;
    }
    Some(ShapeHit {
        nx: (p.x - best.x) / dist,
        nz: (p.z - best.z) / dist,
        pen: r - dist,
    })
}

#[cfg(test)]
mod tests {
    //! Ported from legacy `engine/tile-shape.test.ts` — pins the orientation
    //! convention, triangle helpers, and circle-vs-triangle resolution.
    use super::*;

    const R2: f64 = SQRT1_2;

    fn close(a: f64, b: f64, places: i32) -> bool {
        (a - b).abs() < 0.5 * 10f64.powi(-places)
    }

    #[test]
    fn classifies_slants_vs_full() {
        assert!(!is_slant(SHAPE_FULL));
        for s in [
            SHAPE_SLANT_NE,
            SHAPE_SLANT_NW,
            SHAPE_SLANT_SE,
            SHAPE_SLANT_SW,
        ] {
            assert!(is_slant(s));
            assert!(shape_corners(s).is_some());
        }
        assert!(shape_corners(SHAPE_FULL).is_none());
        assert!(shape_normal(SHAPE_FULL).is_none());
    }

    #[test]
    fn names_a_slant_by_its_open_corner() {
        assert_eq!(shape_normal(SHAPE_SLANT_NE), Some(v2(R2, -R2)));
        assert_eq!(shape_normal(SHAPE_SLANT_NW), Some(v2(-R2, -R2)));
        assert_eq!(shape_normal(SHAPE_SLANT_SE), Some(v2(R2, R2)));
        assert_eq!(shape_normal(SHAPE_SLANT_SW), Some(v2(-R2, R2)));
    }

    #[test]
    fn the_cut_corner_is_not_among_the_solid_vertices() {
        let tri = shape_corners(SHAPE_SLANT_NE).unwrap();
        assert!(!tri.iter().any(|v| v.x == 1.0 && v.z == 0.0));
    }

    #[test]
    fn offsets_the_triangle_into_the_callers_space() {
        let tri = shape_triangle_at(SHAPE_SLANT_NE, 5, 7).unwrap();
        for v in tri {
            assert!((5.0..=6.0).contains(&v.x));
            assert!((7.0..=8.0).contains(&v.z));
        }
        assert!(shape_triangle_at(SHAPE_FULL, 0, 0).is_none());
    }

    #[test]
    fn point_in_triangle_and_edge_normal() {
        let a = v2(0.0, 0.0);
        let b = v2(0.0, 1.0);
        let c = v2(1.0, 1.0); // SLANT_NE solid triangle
        assert!(point_in_triangle(v2(0.3, 0.6), a, b, c));
        assert!(!point_in_triangle(v2(0.8, 0.2), a, b, c));
        let n = edge_outward_normal(a, c, b);
        assert!(close(n.x, R2, 5) && close(n.z, -R2, 5));
    }

    #[test]
    fn resolve_circle_triangle_cases() {
        let tri = shape_triangle_at(SHAPE_SLANT_NE, 0, 0).unwrap();
        // Clear of the triangle.
        assert!(resolve_circle_triangle(v2(0.9, 0.1), 0.2, tri[0], tri[1], tri[2]).is_none());
        // Grazing the hypotenuse → pushed out along the NE normal.
        let hit = resolve_circle_triangle(v2(0.6, 0.4), 0.3, tri[0], tri[1], tri[2]).unwrap();
        assert!(close(hit.nx, R2, 3) && close(hit.nz, -R2, 3));
        assert!(hit.pen > 0.0);
        assert!(close(hit.pen, 0.3 - 0.2 / std::f64::consts::SQRT_2, 2));
        // Centre INSIDE the solid → out through the nearest face, pen > r.
        let hit = resolve_circle_triangle(v2(0.3, 0.6), 0.2, tri[0], tri[1], tri[2]).unwrap();
        assert!(close(hit.nx, R2, 3) && close(hit.nz, -R2, 3));
        assert!(hit.pen > 0.2);
    }

    #[test]
    fn rounds_classify_and_share_backing_with_matching_slant() {
        assert!(is_round(SHAPE_ROUND_SE));
        assert!(!is_slant(SHAPE_ROUND_SE));
        assert!(is_shaped(SHAPE_ROUND_SE));
        assert!(is_shaped(SHAPE_SLANT_SE));
        assert!(!is_shaped(SHAPE_FULL));
        assert_eq!(shape_backing(SHAPE_ROUND_SE), shape_backing(SHAPE_SLANT_SE));
        assert_eq!(slant_to_round(SHAPE_SLANT_NE), SHAPE_ROUND_NE);
        assert_eq!(round_center(SHAPE_ROUND_NE), Some(v2(0.0, 1.0)));
    }

    #[test]
    fn round_resolves_radially_and_only_on_the_open_side() {
        // ROUND_NE at tile (0,0): centre SW (0,1), open quadrant (+x,−z).
        // A point on the open side inside radius 1+r gets a radial push.
        let hit = resolve_circle_shape(SHAPE_ROUND_NE, 0, 0, 0.8, 0.4, 0.2).unwrap();
        let d = crate::jsmath::js_hypot(0.8, 0.4 - 1.0);
        assert!(close(hit.pen, 1.0 + 0.2 - d, 9));
        assert!(hit.nx > 0.0 && hit.nz < 0.0); // radial, toward the open NE
                                               // Behind a backed leg (negative x from centre): no push.
        assert!(resolve_circle_shape(SHAPE_ROUND_NE, 0, 0, -0.2, 0.4, 0.2).is_none());
    }

    #[test]
    fn arc_feature_convex_and_concave() {
        let f = ArcFeature {
            cx: 8.0,
            cz: 8.0,
            r: 3.0,
            a0: 0.0,
            span: TWO_PI,
            ..Default::default()
        };
        // Convex: inside the guard band → pushed outward.
        let hit = resolve_arc_feature(&f, 8.0 + 3.1, 8.0, 0.3).unwrap();
        assert!(hit.nx > 0.99 && close(hit.pen, 3.0 + 0.3 - 3.1, 9));
        // Far outside: clear.
        assert!(resolve_arc_feature(&f, 8.0 + 3.4, 8.0, 0.05).is_none());
        // Concave bowl: outside the free disc → pushed back toward centre.
        let bowl = ArcFeature {
            solid_out: true,
            ..ArcFeature {
                cx: 8.0,
                cz: 8.0,
                r: 3.0,
                a0: 0.0,
                span: TWO_PI,
                ..Default::default()
            }
        };
        let hit = resolve_arc_feature(&bowl, 8.0 + 2.9, 8.0, 0.3).unwrap();
        assert!(hit.nx < -0.99 && close(hit.pen, 2.9 + 0.3 - 3.0, 9));
        assert!(resolve_arc_feature(&bowl, 8.0 + 2.0, 8.0, 0.3).is_none());
    }

    #[test]
    fn angle_span_wraps() {
        assert!(angle_in_span(0.1, 0.0, 0.5));
        assert!(!angle_in_span(1.0, 0.0, 0.5));
        // Wrap across ±π.
        assert!(angle_in_span(-3.1, 3.0, 0.5));
        // Full circle spans everything.
        assert!(angle_in_span(2.0, 0.0, TWO_PI));
    }

    #[test]
    fn lane_grain_and_kick_bands() {
        let mut f = ArcFeature {
            cx: 8.0,
            cz: 8.0,
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
            kicks: vec![KickBand {
                a0: 0.0,
                span: std::f64::consts::FRAC_PI_2,
                cooldown_t: 0.0,
                hit_t: -1.0,
            }],
            ..Default::default()
        };
        let ang = 0.6_f64;
        let (px, pz) = (8.0 + ang.cos() * 3.2, 8.0 + ang.sin() * 3.2);
        // With the grain (cw = increasing angle → tangent (-sin, cos)).
        assert_eq!(lane_band_at(&f, px, pz, -ang.sin(), ang.cos()), Some(0));
        // Against the grain: nothing.
        assert_eq!(lane_band_at(&f, px, pz, ang.sin(), -ang.cos()), None);
        // Tangent is unit and along the grain.
        let (tx, tz) = lane_tangent(&f, &f.lanes[0].clone(), px, pz);
        assert!(close(crate::jsmath::js_hypot(tx, tz), 1.0, 6));
        assert!(tx * -ang.sin() + tz * ang.cos() > 0.9);
        // Kick band answers at the contact angle; cooldown silences it.
        assert_eq!(kick_band_at(&f, px, pz), Some(0));
        f.kicks[0].cooldown_t = 0.5;
        assert_eq!(kick_band_at(&f, px, pz), None);
    }
}
