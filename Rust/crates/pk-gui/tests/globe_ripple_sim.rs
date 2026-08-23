// Parity test suite for HUD Globe Ripple Store.
// Replicates legacy/src/game/pinball-knight/gui/globe-ripple.ts

use pk_gui::globe_ripple::{GlobeRippleStore, GlobeType, RIPPLE_DURATION_MS};

#[test]
fn globe_ripple_tracks_and_decays_correctly() {
    let mut store = GlobeRippleStore::new();

    // Untriggered
    assert_eq!(store.amount(GlobeType::Life, 1000.0), 0.0);
    assert_eq!(store.amount(GlobeType::Mana, 1000.0), 0.0);

    // Trigger life at t = 1000ms
    store.trigger(GlobeType::Life, 1000.0);
    assert!((store.amount(GlobeType::Life, 1000.0) - 1.0).abs() < 1e-6);
    assert_eq!(store.amount(GlobeType::Mana, 1000.0), 0.0);

    // Half duration t = 1210ms
    let half_life = store.amount(GlobeType::Life, 1000.0 + RIPPLE_DURATION_MS / 2.0);
    assert!((half_life - 0.5).abs() < 1e-6);

    // Expired t = 1420ms
    assert_eq!(
        store.amount(GlobeType::Life, 1000.0 + RIPPLE_DURATION_MS),
        0.0
    );

    // Beyond expiration t = 1500ms
    assert_eq!(store.amount(GlobeType::Life, 1500.0), 0.0);
}
