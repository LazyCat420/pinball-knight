// Parity test suite for Knight Sheet LRU Cache.
// Replicates legacy/src/game/pinball-knight/render/knight-sheets.ts

use pk_gui::render::knight_sheets::{KnightSheetCache, SheetConsumer, CACHE_CAP};

#[test]
fn knight_sheet_cache_lru_eviction_and_pinning() {
    let mut cache = KnightSheetCache::new();

    // Pin sheet 0 for the dungeon player
    cache.get_or_insert("sword", "look_0", SheetConsumer::Dungeon);
    assert!(cache.is_cached("sword", "look_0"));

    // Insert 10 more sheets for the tavern (exceeding CACHE_CAP of 10)
    for i in 1..=10 {
        let look = format!("look_{}", i);
        cache.get_or_insert("dagger", &look, SheetConsumer::Tavern);
    }

    assert_eq!(cache.len(), CACHE_CAP);
    // Sheet 0 was pinned by Dungeon consumer, so it MUST survive LRU eviction
    assert!(cache.is_cached("sword", "look_0"));
    // Oldest unpinned sheet (look_1) should be evicted
    assert!(!cache.is_cached("dagger", "look_1"));
    // Most recent sheet (look_10) must be cached
    assert!(cache.is_cached("dagger", "look_10"));
}
