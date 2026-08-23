// Parity test suite for Named Depth Biomes.
// Replicates legacy/src/game/pinball-knight/boot/biomes.ts

use pk_gui::boot::biomes::{biome_for, BIOMES};

#[test]
fn biomes_cycle_every_four_floors_on_fixed_seed() {
    assert_eq!(biome_for(1, 0).name, "The Cold Crypt");
    assert_eq!(biome_for(2, 0).name, "The Rotting Warren");
    assert_eq!(biome_for(3, 0).name, "The Bloodworks");
    assert_eq!(biome_for(4, 0).name, "The Arcane Deep");
    assert_eq!(biome_for(5, 0).name, "The Cold Crypt");
}

#[test]
fn biomes_shuffle_with_run_seed() {
    let seed1_b1 = biome_for(1, 1);
    assert_eq!(seed1_b1.name, "The Rotting Warren");

    let seed2_b1 = biome_for(1, 2);
    assert_eq!(seed2_b1.name, "The Bloodworks");
}

#[test]
fn all_biomes_have_defined_lighting_colors() {
    for b in BIOMES {
        assert!(!b.name.is_empty());
        assert!(!b.flavour.is_empty());
        assert!(b.amb > 0);
        assert!(b.sky > 0);
        assert!(b.ground > 0);
    }
}
