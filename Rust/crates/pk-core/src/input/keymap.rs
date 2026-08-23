//! Keyboard Map & Modal Cascade — Routes keystrokes through the active UI hierarchy.
//!
//! PORTS: `input/keymap.ts`

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct ModalScreenState {
    pub is_tavern_open: bool,
    pub is_debug_panel_open: bool,
    pub is_card_reader_open: bool,
    pub is_menu_open: bool,
    pub is_map_open: bool,
    pub is_shop_open: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RoutedKeyAction {
    Ignored,
    ToggleDebugPanel,
    AdvanceCardReader,
    ToggleMenu,
    ToggleMap,
    CloseShop,
    UseBeltSlot(usize),
    CastAbility(String),
    TriggerRampage,
    SelectWeaponSlot(usize),
}

/// Selects active weapon slot, returning `Some(new_slot)` if slot changed.
pub fn select_slot(slot: usize, current_slot: usize, is_game_over: bool) -> Option<usize> {
    if slot == current_slot || is_game_over {
        None
    } else {
        Some(slot)
    }
}

/// Routes raw keyboard key through the modal cascade.
pub fn route_key(key: &str, modal: &ModalScreenState, active_slot: usize) -> RoutedKeyAction {
    // 1. Tavern owns the keyboard completely while active
    if modal.is_tavern_open {
        return RoutedKeyAction::Ignored;
    }

    // 2. Debug Console toggle (` / ~) has highest priority before UI pause gates
    if key == "`" || key == "~" {
        return RoutedKeyAction::ToggleDebugPanel;
    }

    // 3. Post-floor card haul reader
    if modal.is_card_reader_open {
        if key == " " || key == "Enter" || key == "Space" {
            return RoutedKeyAction::AdvanceCardReader;
        }
        return RoutedKeyAction::Ignored;
    }

    // 4. In-game menu overlay (ESC)
    if key == "Escape" || key == "Esc" {
        if modal.is_shop_open {
            return RoutedKeyAction::CloseShop;
        }
        if modal.is_map_open {
            return RoutedKeyAction::ToggleMap;
        }
        return RoutedKeyAction::ToggleMenu;
    }

    // 5. Floor map overlay (M / Tab)
    if key == "m" || key == "M" {
        return RoutedKeyAction::ToggleMap;
    }

    // 6. Modal menu/shop blocks gameplay keys below
    if modal.is_menu_open || modal.is_shop_open || modal.is_debug_panel_open {
        return RoutedKeyAction::Ignored;
    }

    // 7. Gameplay belt slots [3, 4, 5]
    match key {
        "3" => return RoutedKeyAction::UseBeltSlot(0),
        "4" => return RoutedKeyAction::UseBeltSlot(1),
        "5" => return RoutedKeyAction::UseBeltSlot(2),
        _ => {}
    }

    // 8. Gameplay abilities
    match key {
        "q" | "Q" => return RoutedKeyAction::CastAbility("slot_q".to_string()),
        "e" | "E" => return RoutedKeyAction::CastAbility("slot_e".to_string()),
        " " | "Space" => return RoutedKeyAction::TriggerRampage,
        _ => {}
    }

    // 9. Weapon hand swapping (1, 2, Tab)
    match key {
        "1" => RoutedKeyAction::SelectWeaponSlot(0),
        "2" => RoutedKeyAction::SelectWeaponSlot(1),
        "Tab" => RoutedKeyAction::SelectWeaponSlot(if active_slot == 0 { 1 } else { 0 }),
        _ => RoutedKeyAction::Ignored,
    }
}
