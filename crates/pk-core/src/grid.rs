//! TILE GRID — the substrate every spatial system in the engine reads.
//! Port of `legacy/src/game/pinball-knight/engine/grid.ts`.
//!
//! The split is between the DATA STRUCTURE (a row-major tile array plus its
//! accessors and world mapping) and the GENERATION of a maze into it (M3).
//! Deliberately render-free: this and `collide` are the sim's real test
//! surface, exactly as in the TS original.

pub const T_WALL: u8 = 0;
pub const T_FLOOR: u8 = 1;
pub const T_STAIRS: u8 = 2;
/// A CRACKED wall — solid to collision like any wall, but pinball momentum past
/// SECRET_BREAK_SPEED shatters it. Placed on walls separating two corridors so
/// every break opens a real shortcut.
pub const T_CRACKED: u8 = 3;

/// Shape id 0 = a plain square wall. The full shape vocabulary (slants, arcs,
/// kick bands, lanes — tile-shape.ts) ports in M2; until then every wall is
/// square and the collision paths that read shapes see only `SHAPE_FULL`.
pub const SHAPE_FULL: u8 = 0;

#[derive(Clone, Debug)]
pub struct Grid {
    pub w: i32,
    pub h: i32,
    /// Row-major tiles, `t[(j * w + i) as usize]`.
    pub t: Vec<u8>,
    /// Row-major per-tile SHAPE ids, same layout as `t`. Default 0 =
    /// `SHAPE_FULL`, so a grid that never assigns shapes behaves as before.
    /// Only meaningful on WALL tiles; walkability ignores it.
    pub shapes: Vec<u8>,
    /// Row-major per-tile SURFACE ids — what the tile is MADE OF. `None` so
    /// hand-built test grids don't have to carry it; absent reads as 0, the
    /// neutral surface, so physics never branches on absence.
    pub surfaces: Option<Vec<u8>>,
}

impl Grid {
    /// A w×h grid of solid wall, no shapes, no surfaces.
    pub fn solid(w: i32, h: i32) -> Self {
        let n = (w * h) as usize;
        Self {
            w,
            h,
            t: vec![T_WALL; n],
            shapes: vec![SHAPE_FULL; n],
            surfaces: None,
        }
    }
}

pub fn idx(g: &Grid, i: i32, j: i32) -> usize {
    (j * g.w + i) as usize
}

/// Tile lookup. Out of bounds reads as wall, so callers never bounds-check.
pub fn at(g: &Grid, i: i32, j: i32) -> u8 {
    if i < 0 || j < 0 || i >= g.w || j >= g.h {
        return T_WALL;
    }
    g.t[idx(g, i, j)]
}

pub fn set_tile(g: &mut Grid, i: i32, j: i32, v: u8) {
    if i < 0 || j < 0 || i >= g.w || j >= g.h {
        return;
    }
    let k = idx(g, i, j);
    g.t[k] = v;
}

pub fn is_walkable(g: &Grid, i: i32, j: i32) -> bool {
    let t = at(g, i, j);
    t == T_FLOOR || t == T_STAIRS
}

/// The Diablo rule, isometric edition: the camera sits to the world's
/// south-east, so a wall occludes corridors to its NORTH and WEST. Floor on
/// either of those sides makes it a camera-side rim rendered knee-high. One
/// predicate, two readers (renderer + croaker hop rules), no way to disagree.
pub fn is_low_wall(g: &Grid, i: i32, j: i32) -> bool {
    if is_walkable(g, i, j) {
        return false;
    }
    is_walkable(g, i, j - 1) || is_walkable(g, i - 1, j)
}

/// Per-tile shape. Out of bounds → 0 (`SHAPE_FULL`).
pub fn shape_at(g: &Grid, i: i32, j: i32) -> u8 {
    if i < 0 || j < 0 || i >= g.w || j >= g.h {
        return 0;
    }
    g.shapes[idx(g, i, j)]
}

pub fn set_shape(g: &mut Grid, i: i32, j: i32, v: u8) {
    if i < 0 || j < 0 || i >= g.w || j >= g.h {
        return;
    }
    let k = idx(g, i, j);
    g.shapes[k] = v;
}

/// Per-tile surface id. Out of bounds, or a grid carrying no surface array,
/// reads as 0 — the neutral surface in both vocabularies (`is_walkable`
/// decides whether a byte means a wall or floor surface).
pub fn surface_at(g: &Grid, i: i32, j: i32) -> u8 {
    let Some(s) = &g.surfaces else { return 0 };
    if i < 0 || j < 0 || i >= g.w || j >= g.h {
        return 0;
    }
    s[idx(g, i, j)]
}

pub fn set_surface(g: &mut Grid, i: i32, j: i32, v: u8) {
    if i < 0 || j < 0 || i >= g.w || j >= g.h {
        return;
    }
    let n = (g.w * g.h) as usize;
    let k = idx(g, i, j);
    g.surfaces.get_or_insert_with(|| vec![0; n])[k] = v;
}

/// World mapping: the maze is centred on the origin, one tile = one world
/// unit, so tile (i, j) occupies [i - w/2, i+1 - w/2] × [j - h/2, j+1 - h/2].
pub fn tile_center(g: &Grid, i: i32, j: i32) -> (f64, f64) {
    (
        f64::from(i) + 0.5 - f64::from(g.w) / 2.0,
        f64::from(j) + 0.5 - f64::from(g.h) / 2.0,
    )
}

pub fn world_to_tile(g: &Grid, x: f64, z: f64) -> (i32, i32) {
    (
        (x + f64::from(g.w) / 2.0).floor() as i32,
        (z + f64::from(g.h) / 2.0).floor() as i32,
    )
}
