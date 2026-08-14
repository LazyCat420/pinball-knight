// Parity test suite for Scripted Debug Monster Spawn Layouts.
// Replicates legacy/src/game/pinball-knight/debug-spawn.ts

use pk_core::grid::{Grid, T_FLOOR};
use pk_core::monsters::EnemyKind;
use pk_core::spawn::debug_spawn::{layout_debug_spawns, DebugSpawnSpec, SpawnLayout};

fn make_open_grid(w: i32, h: i32) -> Grid {
    let mut grid = Grid::solid(w, h);
    for j in 1..(h - 1) {
        for i in 1..(w - 1) {
            grid.t[(j * w + i) as usize] = T_FLOOR;
        }
    }
    grid
}

#[test]
fn debug_spawn_layouts_ring_around_center() {
    let grid = make_open_grid(20, 20);

    let spec = DebugSpawnSpec {
        layout: SpawnLayout {
            count: 4,
            ring: Some(2.0),
            phase: Some(0.0),
        },
        kind: EnemyKind::Zombie,
        hp: Some(100),
        aggro: true,
        at: Some((0.0, 0.0)),
    };

    let positions = layout_debug_spawns(&grid, &spec, (0.0, 0.0));
    assert_eq!(positions.len(), 4);

    // Each position should be approx 2.0 units from center (0.0, 0.0)
    for (x, z) in positions {
        let dist = (x * x + z * z).sqrt();
        assert!((dist - 2.0).abs() < 0.001);
    }
}

#[test]
fn debug_spawn_layouts_dense_cluster() {
    let grid = make_open_grid(20, 20);

    let spec = DebugSpawnSpec {
        layout: SpawnLayout {
            count: 5,
            ring: None,
            phase: None,
        },
        kind: EnemyKind::Skeleton,
        hp: None,
        aggro: false,
        at: Some((0.0, 0.0)),
    };

    let positions = layout_debug_spawns(&grid, &spec, (0.0, 0.0));
    assert_eq!(positions.len(), 5);
}
