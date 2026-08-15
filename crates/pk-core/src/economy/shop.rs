//! The Rolling Cart Merchant + Potion Belt economy.
//!
//! PORTS: `economy/shop.ts`

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ShopEntry {
    pub id: &'static str,
    pub label: &'static str,
    pub icon: &'static str,
    pub price: u32,
    pub detail: &'static str,
}

pub const SHOP_STOCK: [ShopEntry; 7] = [
    ShopEntry {
        id: "health",
        label: "Health",
        icon: "❤️",
        price: 12,
        detail: "Restores missing health instantly",
    },
    ShopEntry {
        id: "shield",
        label: "Shield",
        icon: "🛡️",
        price: 18,
        detail: "8s Temporary barrier absorbing incoming hits",
    },
    ShopEntry {
        id: "ballform",
        label: "Ball Form",
        icon: "🪩",
        price: 24,
        detail: "6s Heavy iron marble with maximum kinetic damage",
    },
    ShopEntry {
        id: "multiball",
        label: "Multi-Ball",
        icon: "🔮",
        price: 26,
        detail: "8s Spawns ghost co-op balls that duplicate your throw",
    },
    ShopEntry {
        id: "curveshot",
        label: "Curve Shot",
        icon: "🌀",
        price: 20,
        detail: "10s High-torque steer bending around obstacles",
    },
    ShopEntry {
        id: "magnetboots",
        label: "Magnet Boots",
        icon: "🧲",
        price: 24,
        detail: "12s Vacuum pulls distant gold and gems directly to you",
    },
    ShopEntry {
        id: "laser",
        label: "Laser",
        icon: "✨",
        price: 30,
        detail: "Ricochet beam vaporization form",
    },
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShopError {
    InsufficientGold { needed: u32, have: u32 },
    InvalidItemIndex(usize),
}

/// Executes a purchase transaction against the rolling cart merchant.
/// Returns the updated gold balance and purchased entry reference on success.
pub fn buy_shop_item(current_gold: u32, item_idx: usize) -> Result<(u32, &'static ShopEntry), ShopError> {
    if item_idx >= SHOP_STOCK.len() {
        return Err(ShopError::InvalidItemIndex(item_idx));
    }

    let entry = &SHOP_STOCK[item_idx];
    if current_gold < entry.price {
        return Err(ShopError::InsufficientGold {
            needed: entry.price,
            have: current_gold,
        });
    }

    let remaining_gold = current_gold - entry.price;
    Ok((remaining_gold, entry))
}
