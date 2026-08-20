// The constants barrel re-exports every domain module.
// Oracle: legacy/src/game/pinball-knight/constants.ts
//
// ⚠️ REWRITTEN 2026-08-16. This test used to assert `DESIGN_VIEWPORT_W == 640`,
// `RUNG_BACKGROUND == 0` and `BOSS_FLOORS == [5,10,15]` — three values that
// exist NOWHERE in the oracle. It was green the whole time, because a test that
// asserts invented constants back to the module that invented them cannot fail.
// The render half now goes through `constants_render.rs`, which checks against
// the oracle's own exported values; what stays here is only what the oracle
// really exports, each verified by hand against its source file.

use pk_core::constants::*;

#[test]
fn constants_barrel_exposes_all_domain_constants() {
    // constants/world.ts:9,19,20
    assert_eq!(TILE, 1.0);
    assert_eq!(WALL_H, 1.1);
    assert_eq!(WALL_LOW, 0.35);

    // constants/audio.ts:20
    assert_eq!(VOLUME_STEPS, 10);

    // constants/economy.ts:14
    assert_eq!(MERCHANT_FROM_LEVEL, 2);

    // constants/render.ts — the reference render size, not a viewport the port
    // made up. Full coverage of this module is in tests/constants_render.rs.
    assert_eq!(pk_core::constants::render::RENDER_W, 1280.0);
    assert_eq!(pk_core::constants::render::RENDER_H, 720.0);
    assert_eq!(pk_core::constants::render::PPU, 56.0);
}
