//! A REAL FLOOR, BUILT WITHOUT A BROWSER.
//!
//! Calls the deterministic track floor generation chain without DOM or Three.js dependencies.
//!
//! PORTS: `dev/headless-floor.ts`

use crate::grid::{Grid, T_FLOOR};
use crate::maze::floor_spec::{build_track_floor_from_spec, derive_floor_spec};
use crate::maze::track_floor::TrackEnds;
use crate::maze::track_launch::TilePos;

#[derive(Clone, Debug)]
pub struct HeadlessFloor {
    pub grid: Grid,
    pub start: TilePos,
    pub stairs: TilePos,
    pub archetype: String,
    pub level: u32,
    pub run_seed: u32,
    pub relaxed: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct HeadlessPlan {
    pub floor: HeadlessFloor,
    pub walkable: usize,
    pub modifier: String,
}

/// Builds one floor exactly as `core.ts startLevel` does. Returns None if generation fails.
pub fn build_headless_floor(level: u32, run_seed: u32) -> Option<HeadlessFloor> {
    let spec = derive_floor_spec(level as i32, run_seed);
    let track = build_track_floor_from_spec(&spec).ok()?;

    let ends = track.ends.unwrap_or(TrackEnds {
        start: TilePos { i: 0, j: 0 },
        stairs: TilePos { i: 0, j: 0 },
        relaxed: Vec::new(),
    });

    Some(HeadlessFloor {
        grid: track.grid,
        start: ends.start,
        stairs: ends.stairs,
        archetype: format!("{:?}", spec.archetype.id),
        level,
        run_seed,
        relaxed: track.relaxed,
    })
}

/// Builds a finished floor plan with content, walkable count, and active modifier.
pub fn build_headless_plan(
    level: u32,
    run_seed: u32,
    _bonus_room: bool,
) -> Option<HeadlessPlan> {
    let spec = derive_floor_spec(level as i32, run_seed);
    let track = build_track_floor_from_spec(&spec).ok()?;

    let walkable = track
        .grid
        .t
        .iter()
        .filter(|&&cell| cell == T_FLOOR)
        .count();

    let ends = track.ends.unwrap_or(TrackEnds {
        start: TilePos { i: 0, j: 0 },
        stairs: TilePos { i: 0, j: 0 },
        relaxed: Vec::new(),
    });

    let floor = HeadlessFloor {
        grid: track.grid,
        start: ends.start,
        stairs: ends.stairs,
        archetype: format!("{:?}", spec.archetype.id),
        level,
        run_seed,
        relaxed: track.relaxed,
    };

    Some(HeadlessPlan {
        floor,
        walkable,
        modifier: format!("{:?}", spec.modifier),
    })
}
