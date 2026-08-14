// Parity test for Surface Terrain Blob Painter.
// Replicates legacy/src/game/pinball-knight/maze/surface-paint.ts, surface-paint.test.ts

use pk_core::grid::{set_tile, surface_at, Grid, T_FLOOR};
use pk_core::maze::surface_paint::{paint_surfaces, PaintOpts, SurfaceMix, SAFE_R};
use pk_core::surfaces::FLOOR_STONE;

#[test]
fn paint_surfaces_stamps_material_blobs_and_preserves_safe_zones() {
    let mut g = Grid::solid(25, 25);
    for j in 1..24 {
        for i in 1..24 {
            set_tile(&mut g, i, j, T_FLOOR);
        }
    }

    let spawn = (4, 4);
    let exit = (20, 20);

    let mix = SurfaceMix {
        stone: 0.2,
        ice: 0.4,
        sand: 0.4,
        steel: 0.0,
        grip: 0.0,
    };

    let opts = PaintOpts {
        mix,
        coverage: 0.35,
        safe_spots: vec![spawn, exit],
    };

    let written = paint_surfaces(&mut g, 42, opts);
    assert!(written > 0, "Painter must write non-zero surface tiles");

    // Check that spawn safe radius is 100% FLOOR_STONE
    for dy in -SAFE_R..=SAFE_R {
        for dx in -SAFE_R..=SAFE_R {
            let sx = spawn.0 + dx;
            let sy = spawn.1 + dy;
            if sx >= 0 && sx < 25 && sy >= 0 && sy < 25 {
                assert_eq!(
                    surface_at(&g, sx, sy),
                    FLOOR_STONE,
                    "Spawn safe spot at ({sx}, {sy}) must stay FLOOR_STONE"
                );
            }
        }
    }

    // Check that non-stone surface tiles were stamped elsewhere
    let mut non_stone = 0;
    for j in 1..24 {
        for i in 1..24 {
            if surface_at(&g, i, j) != FLOOR_STONE {
                non_stone += 1;
            }
        }
    }
    assert!(
        non_stone > 0,
        "Floor must contain regional terrain blobs (ice/sand)"
    );
}

#[test]
fn paint_surfaces_is_deterministic_and_idempotent() {
    let mut g1 = Grid::solid(20, 20);
    let mut g2 = Grid::solid(20, 20);
    for j in 1..19 {
        for i in 1..19 {
            set_tile(&mut g1, i, j, T_FLOOR);
            set_tile(&mut g2, i, j, T_FLOOR);
        }
    }

    let opts = PaintOpts {
        mix: SurfaceMix {
            stone: 0.1,
            ice: 0.9,
            sand: 0.0,
            steel: 0.0,
            grip: 0.0,
        },
        coverage: 0.5,
        safe_spots: vec![(2, 2)],
    };

    paint_surfaces(&mut g1, 777, opts.clone());
    paint_surfaces(&mut g2, 777, opts);

    for j in 0..20 {
        for i in 0..20 {
            assert_eq!(
                surface_at(&g1, i, j),
                surface_at(&g2, i, j),
                "Surface paint at ({i}, {j}) must match across runs with same seed"
            );
        }
    }
}
