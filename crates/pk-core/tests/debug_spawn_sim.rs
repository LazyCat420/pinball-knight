// Simulation test suite for Debug Spawn Layout.
// Replicates legacy/src/game/pinball-knight/debug-spawn.ts

use pk_core::grid::{Grid, T_FLOOR};
use pk_core::spawn::debug_spawn::{
    free_tile_near, layout_offsets, resolve_spawn_points, SpawnLayout,
};
use std::collections::HashSet;

fn make_test_grid() -> Grid {
    let mut g = Grid::solid(20, 20);
    for j in 1..19 {
        for i in 1..19 {
            g.t[(j * 20 + i) as usize] = T_FLOOR;
        }
    }
    g
}

#[test]
fn layout_offsets_computes_exact_ring_angles() {
    let layout = SpawnLayout {
        count: 4,
        ring: Some(5.0),
        phase: Some(0.0),
    };
    let offsets = layout_offsets(&layout);
    assert_eq!(offsets.len(), 4);
    assert!((offsets[0].di - 5.0).abs() < 1e-6);
    assert!(offsets[0].dj.abs() < 1e-6);
}

#[test]
fn resolve_spawn_points_places_distinct_walkable_tiles() {
    let g = make_test_grid();
    let layout = SpawnLayout {
        count: 6,
        ring: Some(3.0),
        phase: None,
    };
    let points = resolve_spawn_points(&g, 10.0, 10.0, &layout);
    assert_eq!(points.len(), 6);

    let mut seen = HashSet::new();
    for p in &points {
        assert!(seen.insert((p.i, p.j)), "All spawn points must be unique");
    }
}
