//! Procedural floor authoring pipeline — everything that decides what the floor IS,
//! before any of it is committed to the world.
//!
//! Port of `legacy/src/game/pinball-knight/spawn/floor-authoring.ts` (389 lines).
//!
//! PORTS: `spawn/floor-authoring.ts`

use crate::boot::biomes::{biome_for, Biome};
use crate::constants::floor_budgets;
use crate::constants::level::{level_config, LevelConfig};
use crate::constants::maze::TRACK_FIRST;
use crate::constants::skills::{PARTS_BASE, PARTS_MAX, PARTS_PER_LEVEL};
use crate::grid::Grid;
use crate::maze::archetypes::{archetype_for, windiness_for, FloorArchetype};
use crate::maze::decorate::{decorate_maze, LevelPlan, PrefabAnchor, Room};
use crate::maze::floor_metrics::walkable_count;
use crate::maze::floor_rng;
use crate::maze::lamp_puzzle::{author_lamp_puzzle, lamp_count_for, LampPuzzlePlan};
use crate::maze::modifiers::{roll_modifier, ModifierId};
use crate::maze::prefabs::{theme_for, theme_index_for};
use crate::maze::surface_paint::{paint_surfaces, PaintOpts};
use crate::maze::track_floor::{build_track_floor, BuildTrackFloorOpts, TrackFloor};
use crate::maze::track_launch::TilePos;
use crate::maze::track_socket::near_sealed;
use crate::secrets::{prune_sealed_bands, stamp_secret_bands};
use crate::spawn::factory::reset_zombie_nid;

#[derive(Debug)]
pub struct AuthoredFloor {
    pub level: i32,
    pub cfg: LevelConfig,
    pub biome: &'static Biome,
    pub arch: &'static FloorArchetype,
    pub modifier: ModifierId,
    pub bonus_room: bool,
    pub track: Option<TrackFloor>,
    pub grid: Grid,
    pub plan: LevelPlan,
    pub lamp_puzzle_plan: Option<LampPuzzlePlan>,
}

pub fn author_floor(level: i32, run_seed: u32, bonus_room: bool) -> AuthoredFloor {
    reset_zombie_nid();

    let cfg = level_config(level as i64);
    let biome = biome_for(level as u32, run_seed);
    let _theme_idx = theme_index_for(level as u32, run_seed);

    let mut rng = floor_rng(run_seed, level);
    let arch = archetype_for(level);
    let modifier = roll_modifier(level, &mut rng);
    let windiness = windiness_for(level, arch, &mut rng);

    let _theme = theme_for(level as u32, run_seed);

    let track = if TRACK_FIRST {
        build_track_floor(
            cfg.cells_w as i32,
            cfg.cells_h as i32,
            &mut rng,
            &BuildTrackFloorOpts {
                profile: Some(&arch.track),
                density: Some(windiness.clamp(0.35, 0.85)),
                ..Default::default()
            },
            None,
        )
    } else {
        None
    };

    let mut grid: Grid;
    let endpoints: Option<crate::maze::decorate::Endpoints>;
    let rooms: Vec<Room> = Vec::new();
    let _anchors: Vec<PrefabAnchor> = Vec::new();

    if let Some(ref t) = track {
        grid = t.grid.clone();
        endpoints = Some(crate::maze::decorate::Endpoints {
            start: t.start,
            stairs: t.stairs,
        });
    } else {
        let w = (cfg.cells_w * 2 + 1) as i32;
        let h = (cfg.cells_h * 2 + 1) as i32;
        grid = Grid::solid(w, h);
        endpoints = None;
    }

    if let Some(ref t) = track {
        let grid_snap = grid.clone();
        let mask_snap = t.mask.clone();
        let mut draw_fn = || rng.next_f64();
        let avoid_fn = move |i: i32, j: i32| near_sealed(&grid_snap, &mask_snap, i, j);
        stamp_secret_bands(
            &mut grid,
            &mut draw_fn,
            cfg.secrets as usize,
            None,
            Some(&avoid_fn),
        );
    }

    let walkable = walkable_count(&grid);
    let budget = floor_budgets(level as i64, walkable as f64);
    let mod_data = modifier.data();
    let part_budget: f64 = ((PARTS_BASE + (level as usize - 1) * PARTS_PER_LEVEL).min(PARTS_MAX) as f64) + (budget.parts_area as f64);

    let zombie_count = (1.0_f64).max((budget.zombies as f64 * mod_data.horde_mult).round()) as usize;
    let torch_count = (4.0_f64).max((budget.torches as f64 * mod_data.torch_mult).round()) as usize;
    let parts_count = (4.0_f64).max((part_budget * mod_data.part_mult).round()) as usize;

    let mut inner_rng = crate::rng::Mulberry32::new(run_seed.wrapping_add(level as u32));
    let mut plan = decorate_maze(
        &mut grid,
        &mut inner_rng,
        zombie_count,
        torch_count,
        parts_count,
        rooms,
    );

    if let Some(ep) = endpoints {
        plan.start = ep.start;
        plan.stairs = ep.stairs;
    }

    let mut secrets_vec: Vec<TilePos> = plan
        .cracked_walls
        .iter()
        .map(|&(i, j)| TilePos { i, j })
        .collect();
    prune_sealed_bands(&mut grid, &mut secrets_vec);
    plan.cracked_walls = secrets_vec.into_iter().map(|p| (p.i, p.j)).collect();

    let mut occupied = std::collections::HashSet::new();
    occupied.insert((plan.start.i, plan.start.j));
    occupied.insert((plan.stairs.i, plan.stairs.j));
    for p in &plan.parts {
        occupied.insert((p.i, p.j));
    }
    for s in &plan.monster_spawns {
        occupied.insert((s.i, s.j));
    }
    for it in &plan.items {
        occupied.insert((it.i, it.j));
    }
    for pr in &plan.props {
        occupied.insert((pr.i, pr.j));
    }
    for t in &plan.torches {
        occupied.insert((t.i, t.j));
    }

    let mut puzzle_rng = crate::rng::Mulberry32::new(run_seed ^ (level as u32 * 0x45d9f3b));
    let lamp_puzzle_plan = author_lamp_puzzle(
        &grid,
        (plan.start.i, plan.start.j),
        |i, j| occupied.contains(&(i, j)),
        &mut puzzle_rng,
        lamp_count_for(level as u32) as usize,
    );

    if let Some(ref lpp) = lamp_puzzle_plan {
        for l in &lpp.lamps {
            plan.parts.push(crate::maze::decorate::PinballPartSpot {
                i: l.0,
                j: l.1,
                kind: "lamp".to_string(),
                dir_i: 0,
                dir_j: 0,
                dir2_i: 0,
                dir2_j: 0,
                spine: false,
                chain: false,
            });
        }
    }

    let surface_seed = run_seed ^ ((level as u32).wrapping_mul(0x85ebca6b));
    let surface_safe = vec![
        (plan.start.i, plan.start.j),
        (plan.stairs.i, plan.stairs.j),
    ];

    paint_surfaces(
        &mut grid,
        surface_seed,
        PaintOpts {
            coverage: mod_data.surface_coverage,
            safe_spots: surface_safe,
            ..Default::default()
        },
    );

    AuthoredFloor {
        level,
        cfg,
        biome,
        arch,
        modifier,
        bonus_room,
        track,
        grid,
        plan,
        lamp_puzzle_plan,
    }
}
