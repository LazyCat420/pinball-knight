// Parity test suite for Engine Boot Callback Wiring Bus.
// Replicates legacy/src/game/pinball-knight/boot/wiring.ts

use pk_core::boot::wiring::{WiringBus, WiringDeps};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[test]
fn wiring_bus_installs_dev_and_gameplay_dependencies() {
    let mut bus = WiringBus::new();
    let mut deps = WiringDeps::default();

    assert!(!bus.dev_installed);
    assert!(!bus.gameplay_installed);

    bus.install_dev_wiring(&mut deps);
    assert!(bus.dev_installed);

    bus.install_gameplay_wiring(&mut deps);
    assert!(bus.gameplay_installed);
}

#[test]
fn wiring_bus_dispatches_boss_defeat_and_level_up() {
    let mut bus = WiringBus::new();

    let boss_dropped = Arc::new(AtomicBool::new(false));
    let boss_flag = Arc::clone(&boss_dropped);

    let mut deps = WiringDeps::default();
    deps.drop_boss_reward = Some(Box::new(move |_x, _z| {
        boss_flag.store(true, Ordering::SeqCst);
    }));

    bus.install_gameplay_wiring(&mut deps);
    bus.dispatch_boss_defeat(10.0, 20.0);
    assert!(boss_dropped.load(Ordering::SeqCst));

    bus.dispatch_level_up(2, 1);
    assert_eq!(bus.toast_events.len(), 1);
    assert_eq!(bus.toast_events[0].0, "LEVEL 2");
}

#[test]
fn wiring_bus_spawns_coop_ghosts_with_reaper_warning() {
    let mut bus = WiringBus::new();

    let ghost = bus.spawn_ghost_zombie(101, "reaper", 5.0, 5.0, false);
    assert_eq!(ghost.nid, 101);
    assert_eq!(ghost.kind, "reaper");
    assert_eq!(bus.toast_events.len(), 1);
    assert!(bus.toast_events[0].0.contains("DEATH DEALER"));

    let boss_ghost = bus.spawn_ghost_zombie(102, "golem", 10.0, 10.0, true);
    assert_eq!(boss_ghost.scale, 1.55);

    let item_ghost = bus.spawn_ghost_item(201, "card", "spidersilk#4s", 2.0, 3.0);
    assert_eq!(item_ghost.id, "spidersilk#4s");
}
