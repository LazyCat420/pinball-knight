// Parity test suite for Best-Depth Persistence Store.
// Replicates legacy/src/game/pinball-knight/best-depth.ts

use pk_core::best_depth::BestDepthStore;

#[test]
fn best_depth_store_tracks_and_updates_personal_records() {
    let mut store = BestDepthStore::new();
    assert_eq!(store.load_best_depth(), 0);

    // Initial floor record set
    let is_record = store.save_best_depth(3);
    assert!(is_record);
    assert_eq!(store.load_best_depth(), 3);

    // Equal or lower floor does not overwrite and returns false
    assert!(!store.save_best_depth(3));
    assert!(!store.save_best_depth(2));
    assert_eq!(store.load_best_depth(), 3);

    // Zero is invalid
    assert!(!store.save_best_depth(0));
    assert_eq!(store.load_best_depth(), 3);

    // Higher floor updates record
    assert!(store.save_best_depth(5));
    assert_eq!(store.load_best_depth(), 5);
}
