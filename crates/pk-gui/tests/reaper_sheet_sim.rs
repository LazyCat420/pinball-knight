// Parity test suite for Lazy Reaper Sprite Sheet Cache.
// Replicates legacy/src/game/pinball-knight/render/reaper-sheet.ts

use pk_gui::render::reaper_sheet::ReaperSheetCache;

#[test]
fn reaper_sheet_lazy_initialization_and_memoization() {
    let mut cache = ReaperSheetCache::new();
    assert!(!cache.is_initialized());

    let mut build_count = 0;
    let id1 = cache.get_or_init(|| {
        build_count += 1;
        101
    });

    assert_eq!(id1, 101);
    assert_eq!(build_count, 1);
    assert!(cache.is_initialized());

    // Subsequent access returns cached ID without re-executing builder
    let id2 = cache.get_or_init(|| {
        build_count += 1;
        999
    });

    assert_eq!(id2, 101);
    assert_eq!(build_count, 1);

    // Reset clears cache
    cache.reset();
    assert!(!cache.is_initialized());
}
