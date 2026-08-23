// Parity test suite for Fog of War Exploration.
// Replicates legacy/src/game/pinball-knight/fog.ts

use pk_core::maze::fog::{create_fog, FOG_DIM, FOG_HIDDEN, FOG_SEEN};

#[test]
fn create_fog_initializes_hidden_buffer() {
    let fog = create_fog(10, 10);
    assert_eq!(fog.w, 10);
    assert_eq!(fog.h, 10);
    assert_eq!(fog.v.len(), 100);
    assert_eq!(fog.rev, 0);
    assert_eq!(fog.fog_at(0, 0), FOG_HIDDEN);
    assert_eq!(fog.fog_at(-1, -1), FOG_HIDDEN);
    assert_eq!(fog.fog_at(10, 10), FOG_HIDDEN);
}

#[test]
fn reveal_around_elevates_inner_tiles_and_dims_rim_walls() {
    let mut fog = create_fog(10, 10);

    // Let tile (7, 5) and (3, 5) be walls
    let is_wall = |i: isize, j: isize| -> bool { (i == 7 && j == 5) || (i == 3 && j == 5) };

    fog.reveal_around(&is_wall, 5, 5, 1);
    assert!(fog.rev > 0);

    // Center (5, 5) is within radius 1 -> FOG_SEEN
    assert_eq!(fog.fog_at(5, 5), FOG_SEEN);
    assert_eq!(fog.fog_at(4, 5), FOG_SEEN);
    assert_eq!(fog.fog_at(6, 5), FOG_SEEN);

    // Wall at (7, 5) is at distance 2 (within rim = radius + 1 = 2) -> FOG_DIM
    assert_eq!(fog.fog_at(7, 5), FOG_DIM);

    // Floor tile at (7, 6) is beyond radius 1 and not a wall -> FOG_HIDDEN
    assert_eq!(fog.fog_at(7, 6), FOG_HIDDEN);
}

#[test]
fn explored_fraction_calculates_against_walkable_tiles() {
    let mut fog = create_fog(4, 4); // 16 tiles total

    // 4 tiles are walls (top row)
    let is_wall = |_: isize, j: isize| -> bool { j == 0 };

    // 12 walkable tiles (rows 1..3)
    assert_eq!(fog.explored_fraction(&is_wall), 0.0);

    // Reveal 3 walkable tiles
    fog.raise(0, 1, FOG_SEEN);
    fog.raise(1, 1, FOG_SEEN);
    fog.raise(2, 1, FOG_SEEN);

    // 3 / 12 = 0.25 (25%)
    assert_eq!(fog.explored_fraction(&is_wall), 0.25);
    assert_eq!(fog.explored_count(), 3);
}
