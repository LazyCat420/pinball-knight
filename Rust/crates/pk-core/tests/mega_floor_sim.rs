// Parity test suite for Mega-Floor Generator.
// Replicates legacy/src/game/pinball-knight/dev/mega-floor.ts

use pk_core::dev::mega_floor::{build_mega_floor, MegaFloorOptions};

#[test]
fn build_mega_floor_generates_valid_large_layout() {
    let opts = MegaFloorOptions {
        scale: Some(2.0),
        density: Some("shipped".to_string()),
        level: Some(3),
        run_seed: Some(42),
        ..MegaFloorOptions::default()
    };

    let floor = build_mega_floor(&opts).expect("mega floor builds");
    assert_eq!(floor.level, 3);
    assert_eq!(floor.run_seed, 42);
    assert!(floor.walkable > 0);
    assert!(floor.grid.w > 0 && floor.grid.h > 0);

    // Deterministic repeatability
    let floor2 = build_mega_floor(&opts).expect("mega floor repeats");
    assert_eq!(floor.grid.t, floor2.grid.t);
}
