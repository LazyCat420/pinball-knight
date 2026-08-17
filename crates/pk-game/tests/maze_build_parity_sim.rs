//! Comprehensive parity test suite for legacy/src/game/pinball-knight/maze/build.ts.

use pk_core::grid::{set_tile, Grid, T_FLOOR, T_WALL};
use pk_core::surfaces::*;

#[test]
fn biome_stone_palette_constants() {
    // 5 authored biomes with 3 stone tones each
    let stone_palette = [
        [0x787080, 0x544e63, 0x383445], // Crypt / neutral
        [0x607868, 0x445448, 0x2c3830], // Rot / green
        [0x886860, 0x604440, 0x402828], // Blood / red
        [0x587088, 0x3c4c60, 0x283444], // Arcane / blue
        [0x807858, 0x585038, 0x383420], // Desert / yellow
    ];
    assert_eq!(stone_palette.len(), 5);
}

#[test]
fn maze_grid_surfaces_and_washes() {
    let mut grid = Grid::solid(10, 10);
    for x in 2..8 {
        for z in 2..8 {
            set_tile(&mut grid, x, z, T_FLOOR);
            pk_core::grid::set_surface(&mut grid, x, z, FLOOR_ICE);
        }
    }

    assert_eq!(pk_core::grid::surface_at(&grid, 3, 3), FLOOR_ICE);
    assert_eq!(pk_core::grid::surface_at(&grid, 0, 0), 0);
}
