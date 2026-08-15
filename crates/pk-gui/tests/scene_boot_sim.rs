// Parity test suite for Dungeon Scene Boot Plan.
// Replicates legacy/src/game/pinball-knight/boot/scene.ts

use pk_gui::boot::scene::{create_dungeon_scene_plan, FOG_FAR, FOG_NEAR};
use pk_gui::palette::PALETTE_HEX;

#[test]
fn dungeon_scene_boot_plan_initializes_with_constants() {
    let plan = create_dungeon_scene_plan();
    assert_eq!(plan.background_color, PALETTE_HEX[0]);
    assert_eq!(plan.fog_color, PALETTE_HEX[0]);
    assert_eq!(plan.fog_near, FOG_NEAR);
    assert_eq!(plan.fog_far, FOG_FAR);
    assert_eq!(plan.initial_biome, 0);
    assert_eq!(plan.camera_aim, [0.0, 0.5, 0.0]);
}
