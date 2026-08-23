// Parity test suite for Central SFX Re-Export Hub.
// Replicates legacy/src/game/pinball-knight/sfx/index.ts

use pk_audio::sfx_hub::Sfx;

#[test]
fn sfx_hub_initializes_fail_silently() {
    let sfx = Sfx::new(false, 1.0);
    // On headless non-windows native, soft backend produces a silent live engine
    assert!(sfx.is_some());
}
