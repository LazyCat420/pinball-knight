//! THE MEGA FLOOR — Oversized layout generator for inspecting generator vocabulary and motifs.
//!
//! PORTS: `dev/mega-floor.ts`

use crate::grid::{Grid, T_FLOOR};
use crate::maze::floor_spec::{build_track_floor_from_spec, derive_floor_spec};

#[derive(Clone, Debug)]
pub struct MegaFloorOptions {
    pub scale: f64,
    pub density_mode: &'static str,
    pub level: u32,
    pub seed: u32,
}

impl Default for MegaFloorOptions {
    fn default() -> Self {
        Self {
            scale: 2.0,
            density_mode: "shipped",
            level: 3,
            seed: 42,
        }
    }
}

#[derive(Clone, Debug)]
pub struct MegaFloor {
    pub grid: Grid,
    pub walkable: usize,
    pub archetype: String,
    pub level: u32,
    pub run_seed: u32,
}

/// Builds an oversized macro floor under the exact draw sequence.
pub fn build_mega_floor(opts: &MegaFloorOptions) -> Option<MegaFloor> {
    let spec = derive_floor_spec(opts.level as i32, opts.seed);
    let track = build_track_floor_from_spec(&spec).ok()?;

    let walkable = track
        .grid
        .t
        .iter()
        .filter(|&&cell| cell == T_FLOOR)
        .count();

    Some(MegaFloor {
        grid: track.grid,
        walkable,
        archetype: format!("{:?}", spec.archetype.id),
        level: opts.level,
        run_seed: opts.seed,
    })
}
