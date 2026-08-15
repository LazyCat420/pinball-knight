// Parity test suite for Rolling Cart Merchant Economy.
// Replicates legacy/src/game/pinball-knight/economy/shop.ts

use pk_core::economy::shop::{buy_shop_item, ShopError, SHOP_STOCK};

#[test]
fn shop_stock_has_exact_seven_items() {
    assert_eq!(SHOP_STOCK.len(), 7);
    assert_eq!(SHOP_STOCK[0].id, "health");
    assert_eq!(SHOP_STOCK[0].price, 12);
    assert_eq!(SHOP_STOCK[6].id, "laser");
    assert_eq!(SHOP_STOCK[6].price, 30);
}

#[test]
fn shop_purchase_deducts_gold_correctly() {
    let starting_gold = 50;

    // Buy Health potion (12g)
    let (remaining, item) = buy_shop_item(starting_gold, 0).expect("purchase should succeed");
    assert_eq!(remaining, 38);
    assert_eq!(item.id, "health");

    // Buy Laser (30g) with remaining gold
    let (final_gold, laser) = buy_shop_item(remaining, 6).expect("purchase should succeed");
    assert_eq!(final_gold, 8);
    assert_eq!(laser.id, "laser");
}

#[test]
fn shop_purchase_rejects_insufficient_gold() {
    let starting_gold = 10;
    let res = buy_shop_item(starting_gold, 0); // Health costs 12

    assert_eq!(
        res,
        Err(ShopError::InsufficientGold {
            needed: 12,
            have: 10
        })
    );
}

#[test]
fn shop_purchase_rejects_invalid_index() {
    let res = buy_shop_item(100, 99);
    assert_eq!(res, Err(ShopError::InvalidItemIndex(99)));
}
