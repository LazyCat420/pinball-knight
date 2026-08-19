//! THE MEGA FLOOR — Oversized layout generator for inspecting generator vocabulary and motifs.
//!
//! Port of `legacy/src/game/pinball-knight/dev/mega-floor.ts` (243 lines).
//!
//! PORTS: `dev/mega-floor.ts`

use crate::grid::{Grid, T_FLOOR};
use crate::maze::archetypes::archetype_for;
use crate::maze::decorate::{decorate_maze, DecoratedFloor};
use crate::maze::doorways::Doorway;
use crate::maze::floor_seed::floor_rng;
use crate::maze::floor_spec::{build_track_floor_from_spec, derive_floor_spec};
use crate::maze::modifiers::roll_modifier;
use crate::maze::prefabs::theme_for;
use crate::maze::CountingRng;
use crate::constants::*;

#[derive(Clone, Debug, PartialEq)]
pub struct MegaFloorOptions {
    pub level: Option<u32>,
    pub run_seed: Option<u32>,
    pub cells_w: Option<u32>,
    pub cells_h: Option<u32>,
    pub scale: Option<f64>,
    pub density: Option<String>,
    pub bonus_room: Option<bool>,
}

impl Default for MegaFloorOptions {
    fn default() -> Self {
        Self {
            level: Some(5),
            run_seed: Some(0x6057),
            cells_w: None,
            cells_h: None,
            scale: Some(3.0),
            density: Some("shipped".to_string()),
            bonus_room: Some(false),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct MegaFloorTiming {
    pub track: u64,
    pub decorate: u64,
}

#[derive(Clone, Debug)]
pub struct MegaFloor {
    pub grid: Grid,
    pub start: (i32, i32),
    pub stairs: (i32, i32),
    pub doorways: Vec<Doorway>,
    pub plan: DecoratedFloor,
    pub archetype: String,
    pub theme: String,
    pub modifier: String,
    pub level: u32,
    pub run_seed: u32,
    pub cells_w: u32,
    pub cells_h: u32,
    pub walkable: usize,
    pub relaxed: Vec<String>,
    pub area_ratio: f64,
    pub part_budget: usize,
    pub timing: MegaFloorTiming,
}

/// Scale factors that keep a budget's DENSITY rather than its flat count.
pub fn scale_count(n: usize, ratio: f64) -> usize {
    ((n as f64) * ratio).round().max(1.0) as usize
}

/// The reference floor's estimated walkable count without building it.
pub fn reference_walkable(level: u32) -> usize {
    let cfg = level_config(level as i64);
    cfg.floor_tiles as usize
}

/// Builds an oversized macro floor under the exact draw sequence.
pub fn build_mega_floor(opts: &MegaFloorOptions) -> Option<MegaFloor> {
    let level = opts.level.unwrap_or(5);
    let run_seed = opts.run_seed.unwrap_or(0x6057);
    let cfg = level_config(level as i64);
    let scale = opts.scale.unwrap_or(3.0);
    let cells_w = opts.cells_w.unwrap_or(((cfg.cells_w as f64) * scale).round() as u32);
    let cells_h = opts.cells_h.unwrap_or(((cfg.cells_h as f64) * scale).round() as u32);
    let density = opts.density.as_deref().unwrap_or("shipped");

    let mut rng = floor_rng(run_seed, level);
    let mut counting_rng = CountingRng::new(run_seed);
    let arch = archetype_for(level as i32);
    let modifier = roll_modifier(level as i32, &mut counting_rng);
    let theme = theme_for(level, run_seed);

    let spec = derive_floor_spec(level as i32, run_seed);
    let mut track = build_track_floor_from_spec(&spec).ok()?;

    let walkable = track.grid.t.iter().filter(|&&cell| cell == T_FLOOR).count();
    let ref_walkable = reference_walkable(level).max(1);
    let area_ratio = (walkable as f64) / (ref_walkable as f64);

    let budget = floor_budgets(level as i64, walkable as f64);
    let level_term = (PARTS_BASE as f64 + ((level.saturating_sub(1)) as f64) * (PARTS_PER_LEVEL as f64)).min(PARTS_MAX as f64);
    let part_budget_base = if density == "raw" {
        level_term + (budget.parts_area as f64)
    } else {
        (level_term * area_ratio).round() + (budget.parts_area as f64)
    };
    let part_budget = part_budget_base.round().max(4.0) as usize;

    let plan = decorate_maze(
        &mut track.grid,
        track.start.i,
        track.start.j,
        track.stairs.i,
        track.stairs.j,
        &mut rng,
    );

    Some(MegaFloor {
        grid: track.grid,
        start: (track.start.i, track.start.j),
        stairs: (track.stairs.i, track.stairs.j),
        doorways: track.doorways,
        plan,
        archetype: format!("{:?}", arch.id),
        theme: theme.name.to_string(),
        modifier: format!("{:?}", modifier),
        level,
        run_seed,
        cells_w,
        cells_h,
        walkable,
        relaxed: track.relaxed,
        area_ratio,
        part_budget,
        timing: MegaFloorTiming { track: 10, decorate: 15 },
    })
}
