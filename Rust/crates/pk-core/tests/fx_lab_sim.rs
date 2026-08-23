// Parity test suite for FX Lab Developer Workbench.
// Replicates legacy/src/game/pinball-knight/dev/fx-lab.ts

use pk_core::dev::fx_lab::{FxLabState, FX_ROSTER};

#[test]
fn fx_lab_spawning_and_clock_freeze() {
    let mut lab = FxLabState::new();
    assert!(!lab.clock_frozen);

    // Freeze clock control
    lab.freeze();
    assert!(lab.clock_frozen);
    lab.thaw();
    assert!(!lab.clock_frozen);

    // Spawn single decal
    let count = lab.spawn("fire", 1.0, 2.0).expect("fire decal spawns");
    assert_eq!(count, 1);
    assert_eq!(lab.decals[0].kind, "fire");

    // Grid lattice contact sheet
    let grid_count = lab.grid();
    assert_eq!(grid_count, FX_ROSTER.len());

    // Pair comparison
    lab.pair("fire", "slick").expect("pair spawns");
    assert_eq!(lab.decals.len(), 2);
    assert_eq!(lab.decals[0].kind, "fire");
    assert_eq!(lab.decals[1].kind, "slick");
}
