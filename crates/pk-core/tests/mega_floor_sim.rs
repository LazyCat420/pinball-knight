// Parity test suite for Mega-Floor Generator.
// Replicates legacy/src/game/pinball-knight/dev/mega-floor.ts

use pk_core::dev::mega_floor::{
    analyze_mega_floor_motifs, build_mega_floor, scale_count, DensityMode, MegaFloorOptions,
};

#[test]
fn build_mega_floor_generates_valid_large_layout() {
    let opts = MegaFloorOptions {
        scale: 2.0,
        density_mode: DensityMode::Shipped,
        level: 3,
        seed: 42,
        cols: None,
        rows: None,
    };

    let floor = build_mega_floor(&opts).expect("mega floor builds");
    assert_eq!(floor.level, 3);
    assert_eq!(floor.run_seed, 42);
    assert!(floor.walkable > 0);
    assert!(floor.grid.w > 0 && floor.grid.h > 0);

    // Deterministic repeatability
    let floor2 = build_mega_floor(&opts).expect("mega floor repeats");
    assert_eq!(floor.grid.t, floor2.grid.t);

    let report = analyze_mega_floor_motifs(&floor);
    assert_eq!(report.walkable_tiles, floor.walkable);
    assert_eq!(scale_count(10, 2.5), 25);
}
