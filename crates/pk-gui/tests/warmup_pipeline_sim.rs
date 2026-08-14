// Parity test suite for Floor Pipeline Warmup Scheduler.
// Replicates legacy/src/game/pinball-knight/boot/warmup.ts

use pk_gui::boot::warmup::WarmupScheduler;

#[test]
fn warmup_scheduler_decomposes_large_groups_into_leaves() {
    let mut scheduler = WarmupScheduler::new();

    // Small group -> kept as 1 unit
    scheduler.add_group("props", 10);
    assert_eq!(scheduler.units.len(), 1);

    // Large group -> split into 20 units
    scheduler.add_group("dungeon_walls", 20);
    assert_eq!(scheduler.units.len(), 21);
}

#[test]
fn warmup_scheduler_ticks_monotonically_to_completion() {
    let mut scheduler = WarmupScheduler::new();
    scheduler.add_representative_pool_reveals();

    let total = scheduler.units.len();
    assert!(total > 0);

    let mut last_progress = 0.0;
    while let Some(prog) = scheduler.tick() {
        assert!(prog >= last_progress);
        last_progress = prog;
    }

    assert_eq!(last_progress, 1.0);
    assert!(scheduler.is_complete());
}
