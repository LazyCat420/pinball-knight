// Parity test suite for Rolling Cart Merchant Shop Screen.
// Replicates legacy/src/game/pinball-knight/gui/screens/shop.ts

use pk_gui::screens::shop::{
    design_height, shop_sheet_h, DESIGN_ROWS, DESIGN_WIDTH, ShopScreenState,
};

#[test]
fn shop_sheet_dimensions_fit_zoom_floor_budget() {
    assert_eq!(DESIGN_ROWS, 9);
    assert_eq!(DESIGN_WIDTH, 600);

    let h = shop_sheet_h(DESIGN_ROWS);
    // 70 + 9 * 33 + 32 = 70 + 297 + 32 = 399
    assert_eq!(h, 399);

    let box_h = design_height();
    assert_eq!(box_h, 415);
    // Must remain under 450px so 900-line canvas maintains 2x scale
    assert!(box_h <= 450);
}

#[test]
fn shop_screen_state_manages_inventory_and_digit_shortcuts() {
    let mut state = ShopScreenState::new(300);
    assert_eq!(state.wares.len(), 7);

    // Digit shortcuts [1..7]
    assert_eq!(state.select_by_digit(1), Some(0));
    assert_eq!(state.selected_index, 0);

    assert_eq!(state.select_by_digit(4), Some(3)); // Laser kit (250 gold)
    assert_eq!(state.selected_index, 3);

    // Purchase laser kit
    assert!(state.try_buy(3));
    assert_eq!(state.gold, 50); // 300 - 250

    // Cannot afford sword_iron (120 gold)
    assert!(!state.try_buy(1));
    assert_eq!(state.gold, 50);

    // Invalid digit shortcut
    assert_eq!(state.select_by_digit(0), None);
    assert_eq!(state.select_by_digit(8), None);
}
