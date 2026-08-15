// Parity test suite for Audio Patch Audition Registry.
// Replicates legacy/src/game/pinball-knight/sfx/registry.ts

use pk_audio::bus::SfxCategory;
use pk_audio::registry::{lookup_patch_by_name, patch_category, ALL_PATCHES, SfxPatchName};

#[test]
fn sfx_registry_contains_all_twenty_eight_patches() {
    assert_eq!(ALL_PATCHES.len(), 28);
}

#[test]
fn patch_name_lookup_and_category_mapping() {
    // Combat
    assert_eq!(lookup_patch_by_name("swing"), Some(SfxPatchName::Swing));
    assert_eq!(patch_category(SfxPatchName::Swing), SfxCategory::Combat);

    // Weapons
    assert_eq!(lookup_patch_by_name("laser"), Some(SfxPatchName::Laser));
    assert_eq!(patch_category(SfxPatchName::Laser), SfxCategory::Weapons);

    // Pinball
    assert_eq!(lookup_patch_by_name("bump"), Some(SfxPatchName::Bump));
    assert_eq!(patch_category(SfxPatchName::Bump), SfxCategory::Pinball);

    // Monsters
    assert_eq!(lookup_patch_by_name("spit"), Some(SfxPatchName::Spit));
    assert_eq!(patch_category(SfxPatchName::Spit), SfxCategory::Monsters);

    // World
    assert_eq!(lookup_patch_by_name("coin"), Some(SfxPatchName::Coin));
    assert_eq!(patch_category(SfxPatchName::Coin), SfxCategory::World);

    // Run
    assert_eq!(lookup_patch_by_name("level_up"), Some(SfxPatchName::LevelUp));
    assert_eq!(patch_category(SfxPatchName::LevelUp), SfxCategory::Run);

    // Invalid lookup
    assert_eq!(lookup_patch_by_name("non_existent"), None);
}
