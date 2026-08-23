// Parity test suite for HUD Meter Repaint Cache.
// Replicates legacy/src/game/pinball-knight/hud-meter.ts

use pk_gui::hud_meter::{MeterRepaintCache, METER_SENTINEL_NONE};

#[test]
fn hud_meter_cache_skips_unchanged_repaints() {
    let mut cache = MeterRepaintCache::new();
    assert_eq!(cache.blocks_shown(), METER_SENTINEL_NONE);
    assert!(cache.should_repaint(10));

    cache.set_blocks_shown(10);
    assert_eq!(cache.blocks_shown(), 10);
    assert!(!cache.should_repaint(10));
    assert!(cache.should_repaint(11));
}

#[test]
fn hud_meter_invalidation_forces_subsequent_repaint() {
    let mut cache = MeterRepaintCache::new();
    cache.set_blocks_shown(15);
    assert!(!cache.should_repaint(15));

    cache.invalidate();
    assert_eq!(cache.blocks_shown(), METER_SENTINEL_NONE);
    assert!(cache.should_repaint(15));
}
