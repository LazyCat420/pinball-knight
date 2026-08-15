// Parity test suite for Monster Card Portrait Cel Renderer.
// Replicates legacy/src/game/pinball-knight/render/monster-portrait.ts

use pk_gui::render::monster_portrait::portrait_spec_for_enemy;

#[test]
fn portrait_spec_covers_all_twenty_one_enemy_kinds() {
    let kinds = [
        "zombie", "spider", "brute", "spitter", "ghost", "bat", "slime", "goblin",
        "pin", "golem", "chomper", "magnet", "webspinner", "reaper", "sporeling",
        "jester", "croaker", "rotortail", "stiltneck", "hound", "fish_feet",
    ];

    for kind in kinds {
        let spec = portrait_spec_for_enemy(kind, 0);
        assert!(!spec.sheet_key.is_empty());
        assert!(spec.scale > 0.0);
    }
}

#[test]
fn reaper_has_bespoke_arcane_tint() {
    let reaper = portrait_spec_for_enemy("reaper", 0);
    assert_eq!(reaper.sheet_key, "reaper");
    assert_eq!(reaper.tint_hex, Some(0x7b1fa2));
    assert_eq!(reaper.scale, 1.25);
}

#[test]
fn zombie_variants_cycle_frame_indices() {
    let z0 = portrait_spec_for_enemy("zombie", 0);
    let z1 = portrait_spec_for_enemy("zombie", 1);
    let z2 = portrait_spec_for_enemy("zombie", 2);
    let z3 = portrait_spec_for_enemy("zombie", 3);
    let z4 = portrait_spec_for_enemy("zombie", 4);

    assert_eq!(z0.frame_idx, 0);
    assert_eq!(z1.frame_idx, 1);
    assert_eq!(z2.frame_idx, 2);
    assert_eq!(z3.frame_idx, 3);
    assert_eq!(z4.frame_idx, 0); // Wraps around
}
