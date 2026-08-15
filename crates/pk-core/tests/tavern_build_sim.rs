// Parity test suite for Tavern Room Shell Geometry.
// Replicates legacy/src/scenes/tavern/build.ts

use pk_core::tavern::build::{build_tavern_room, FLAME, STONE, STONE_DK, TIMBER, TIMBER_DK};

#[test]
fn tavern_room_builds_complete_architectural_shell() {
    let room = build_tavern_room();

    // Floor, spine, 4 walls, chimney, mantle, hearth, 4 stairs = 13 boxes
    assert_eq!(room.boxes.len(), 13);

    // Assert key structural components exist
    assert!(room.boxes.iter().any(|b| b.palette_idx == TIMBER_DK)); // Floor
    assert!(room.boxes.iter().any(|b| b.palette_idx == TIMBER)); // Spine / mantle
    assert!(room.boxes.iter().any(|b| b.palette_idx == STONE_DK)); // Back/front walls
    assert!(room.boxes.iter().any(|b| b.palette_idx == STONE)); // Side walls / chimney / stairs
    assert!(room.boxes.iter().any(|b| b.palette_idx == FLAME)); // Ember hearth bed

    // Check light and transition anchor coordinates
    assert_eq!(room.fire_pos, (0.0, 0.5, -5.2));
    assert_eq!(room.stairs_pos, (6.0, 0.0, 4.5));
}
