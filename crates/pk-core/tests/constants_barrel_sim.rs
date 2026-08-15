// Parity test suite for Global Constants Barrel Re-Exports.
// Replicates legacy/src/game/pinball-knight/constants.ts

use pk_core::constants::*;

#[test]
fn constants_barrel_exposes_all_domain_constants() {
    // World constants
    assert_eq!(TILE, 1.0);
    assert_eq!(WALL_H, 1.1);
    assert_eq!(WALL_LOW, 0.35);

    // Audio constants
    assert_eq!(VOLUME_STEPS, 10);

    // Level constants
    assert_eq!(BOSS_FLOORS, [5, 10, 15]);

    // Render constants
    assert_eq!(DESIGN_VIEWPORT_W, 640.0);
    assert_eq!(DESIGN_VIEWPORT_H, 360.0);
    assert_eq!(RUNG_BACKGROUND, 0);

    // Economy constants
    assert_eq!(MERCHANT_FROM_LEVEL, 2);
}
