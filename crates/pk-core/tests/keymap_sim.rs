// Parity test suite for Keyboard Map & Modal Cascade.
// Replicates legacy/src/game/pinball-knight/input/keymap.ts

use pk_core::input::keymap::{route_key, select_slot, ModalScreenState, RoutedKeyAction};

#[test]
fn modal_hierarchy_prioritizes_active_screens_in_correct_order() {
    let mut modal = ModalScreenState::default();

    // 1. Gameplay baseline
    assert_eq!(
        route_key("q", &modal, 0),
        RoutedKeyAction::CastAbility("slot_q".to_string())
    );
    assert_eq!(
        route_key("1", &modal, 0),
        RoutedKeyAction::SelectWeaponSlot(0)
    );
    assert_eq!(
        route_key("Tab", &modal, 0),
        RoutedKeyAction::SelectWeaponSlot(1)
    );

    // 2. Map overlay open -> ESC closes map
    modal.is_map_open = true;
    assert_eq!(route_key("Escape", &modal, 0), RoutedKeyAction::ToggleMap);
    modal.is_map_open = false;

    // 3. Card reader open -> Space advances haul
    modal.is_card_reader_open = true;
    assert_eq!(
        route_key(" ", &modal, 0),
        RoutedKeyAction::AdvanceCardReader
    );
    modal.is_card_reader_open = false;

    // 4. Debug Console toggle has priority over other screens
    assert_eq!(route_key("`", &modal, 0), RoutedKeyAction::ToggleDebugPanel);

    // 5. Tavern owns keyboard completely
    modal.is_tavern_open = true;
    assert_eq!(route_key("q", &modal, 0), RoutedKeyAction::Ignored);
    assert_eq!(route_key("`", &modal, 0), RoutedKeyAction::Ignored);
}

#[test]
fn select_slot_rejects_same_slot_or_game_over() {
    assert_eq!(select_slot(0, 0, false), None);
    assert_eq!(select_slot(1, 0, false), Some(1));
    assert_eq!(select_slot(1, 0, true), None);
}
