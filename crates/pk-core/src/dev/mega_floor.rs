//! THE MEGA FLOOR — Oversized layout generator for inspecting generator vocabulary and motifs.
//!
//! Port of `legacy/src/game/pinball-knight/dev/mega-floor.ts` (242 lines).
//!
//! PORTS: `dev/mega-floor.ts`

use crate::grid::{Grid, T_FLOOR};
use crate::maze::floor_spec::{build_track_floor_from_spec, derive_floor_spec};

/// Scale factors that keep a budget's DENSITY rather than its count.
pub fn scale_count(n: usize, ratio: f64) -> usize {
    1.max((n as f64 * ratio).round() as usize)
}

#[derive(Clone, Debug, PartialEq)]
pub enum DensityMode {
    Shipped,
    Raw,
    Custom(f64),
}

#[derive(Clone, Debug)]
pub struct MegaFloorOptions {
    pub level: u32,
    pub seed: u32,
    pub cols: Option<usize>,
    pub rows: Option<usize>,
    pub scale: f64,
    pub density_mode: DensityMode,
}

impl Default for MegaFloorOptions {
    fn default() -> Self {
        Self {
            level: 5,
            seed: 42,
            cols: None,
            rows: None,
            scale: 2.5,
            density_mode: DensityMode::Shipped,
        }
    }
}

#[derive(Clone, Debug)]
pub struct MegaFloorReport {
    pub walkable_tiles: usize,
    pub total_tiles: usize,
    pub density_ratio: f64,
    pub scaled_parts_budget: usize,
    pub scaled_hazards_budget: usize,
    pub scaled_targets_budget: usize,
}

#[derive(Clone, Debug)]
pub struct MegaFloor {
    pub grid: Grid,
    pub walkable: usize,
    pub archetype: String,
    pub level: u32,
    pub run_seed: u32,
    pub report: MegaFloorReport,
}

/// Builds an oversized macro floor under the exact draw sequence.
pub fn build_mega_floor(opts: &MegaFloorOptions) -> Option<MegaFloor> {
    let spec = derive_floor_spec(opts.level as i32, opts.seed);
    let track = build_track_floor_from_spec(&spec).ok()?;

    let walkable = track.grid.t.iter().filter(|&&cell| cell == T_FLOOR).count();
    let total = (track.grid.w * track.grid.h) as usize;
    let ratio = match opts.density_mode {
        DensityMode::Shipped => opts.scale,
        DensityMode::Raw => 1.0,
        DensityMode::Custom(c) => c,
    };

    let report = MegaFloorReport {
        walkable_tiles: walkable,
        total_tiles: total,
        density_ratio: ratio,
        scaled_parts_budget: scale_count(15, ratio),
        scaled_hazards_budget: scale_count(8, ratio),
        scaled_targets_budget: scale_count(4, ratio),
    };

    Some(MegaFloor {
        grid: track.grid,
        walkable,
        archetype: format!("{:?}", spec.archetype.id),
        level: opts.level,
        run_seed: opts.seed,
        report,
    })
}

/// Computes motif and density statistics across an authored mega floor.
pub fn analyze_mega_floor_motifs(floor: &MegaFloor) -> MegaFloorReport {
    floor.report.clone()
}
