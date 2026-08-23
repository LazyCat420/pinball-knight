// Parity test suite for Debug Console Action Dispatcher.
// Replicates legacy/src/game/pinball-knight/debug-panel.ts

use pk_core::debug::{DebugAction, DebugConsoleState};

#[test]
fn debug_console_manages_god_mode_toggles() {
    let mut console = DebugConsoleState::new();

    assert!(!console.flags.god_mode);
    assert!(console.toggle_god_mode());
    assert!(console.flags.god_mode);
    assert!(!console.toggle_god_mode());
    assert!(!console.flags.god_mode);

    assert!(console.toggle_infinite_mana());
    assert!(console.flags.infinite_mana);

    assert!(console.toggle_no_cooldowns());
    assert!(console.flags.no_cooldowns);
}

#[test]
fn floor_lock_clamps_to_valid_floor_range() {
    let mut console = DebugConsoleState::new();

    console.set_floor_lock(Some(5));
    assert_eq!(console.flags.floor_lock, Some(5));

    console.set_floor_lock(Some(0));
    assert_eq!(console.flags.floor_lock, Some(1));

    console.set_floor_lock(Some(100));
    assert_eq!(console.flags.floor_lock, Some(40));

    console.set_floor_lock(None);
    assert_eq!(console.flags.floor_lock, None);
}

#[test]
fn action_dispatch_logs_commands() {
    let mut console = DebugConsoleState::new();

    console.dispatch(DebugAction::Heal);
    console.dispatch(DebugAction::AddGold(250));
    console.dispatch(DebugAction::GrantXp(1000));
    console.dispatch(DebugAction::GotoFloor(12));
    console.dispatch(DebugAction::GiveWeapon("sword_iron".to_string()));

    assert_eq!(console.log.len(), 5);
    assert!(console.log[0].contains("Player healed"));
    assert!(console.log[1].contains("250 gold"));
    assert!(console.log[2].contains("1000 XP"));
    assert!(console.log[3].contains("floor 12"));
    assert!(console.log[4].contains("sword_iron"));
}
