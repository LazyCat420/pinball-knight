//! Rolling Cart Merchant Shop Screen — In-dungeon merchant wares list, keyboard digit shortcuts, and purchase confirmations.
//!
//! PORTS: `gui/screens/shop.ts`

pub const WARE_ROW: u32 = 30;
pub const WARE_GAP: u32 = 3;
pub const SHOP_CHROME: u32 = 70; // 30 title + 20 wares heading + 20 footer
pub const SHEET_PAD: u32 = 32; // GRID * 4 = 8 * 4
pub const DESIGN_ROWS: usize = 9;
pub const DESIGN_WIDTH: u32 = 600;

/// Derives sheet height for `n` wares.
pub fn shop_sheet_h(n: usize) -> u32 {
    SHOP_CHROME + (n as u32 * (WARE_ROW + WARE_GAP)) + SHEET_PAD
}

/// The authored design box height: tallest sheet (9 wares) plus margin.
pub fn design_height() -> u32 {
    shop_sheet_h(DESIGN_ROWS) + 16
}

#[derive(Clone, Debug, PartialEq)]
pub struct ShopWareEntry {
    pub id: String,
    pub label: String,
    pub icon: String,
    pub price: u32,
    pub detail: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ShopScreenState {
    pub wares: Vec<ShopWareEntry>,
    pub selected_index: usize,
    pub gold: u32,
}

impl ShopScreenState {
    pub fn new(gold: u32) -> Self {
        let wares = vec![
            ShopWareEntry {
                id: "fists_iron".to_string(),
                label: "Spiked Knuckles".to_string(),
                icon: "fists".to_string(),
                price: 50,
                detail: "Extra melee stagger".to_string(),
            },
            ShopWareEntry {
                id: "sword_iron".to_string(),
                label: "Iron Broadsword".to_string(),
                icon: "sword".to_string(),
                price: 120,
                detail: "High slashing arc".to_string(),
            },
            ShopWareEntry {
                id: "axe_heavy".to_string(),
                label: "Battle Axe".to_string(),
                icon: "axe".to_string(),
                price: 180,
                detail: "Crushes armor shields".to_string(),
            },
            ShopWareEntry {
                id: "laser_kit".to_string(),
                label: "Laser Focusing Lens".to_string(),
                icon: "laser".to_string(),
                price: 250,
                detail: "Piercing beam trajectory".to_string(),
            },
            ShopWareEntry {
                id: "potion_heal".to_string(),
                label: "Crimson Draught".to_string(),
                icon: "potion".to_string(),
                price: 40,
                detail: "Restores 50 HP".to_string(),
            },
            ShopWareEntry {
                id: "potion_mana".to_string(),
                label: "Azure Elixir".to_string(),
                icon: "mana".to_string(),
                price: 60,
                detail: "Refills mana pool".to_string(),
            },
            ShopWareEntry {
                id: "magnet_ring".to_string(),
                label: "Lodestone Ring".to_string(),
                icon: "ring".to_string(),
                price: 200,
                detail: "Triples coin pull aura".to_string(),
            },
        ];

        Self {
            wares,
            selected_index: 0,
            gold,
        }
    }

    /// Selects a row by keyboard digit key [1..9].
    pub fn select_by_digit(&mut self, digit: u8) -> Option<usize> {
        if digit >= 1 && (digit as usize) <= self.wares.len() {
            let idx = (digit - 1) as usize;
            self.selected_index = idx;
            Some(idx)
        } else {
            None
        }
    }

    /// Attempts to purchase the selected item, deducting gold on success.
    pub fn try_buy(&mut self, index: usize) -> bool {
        if let Some(ware) = self.wares.get(index) {
            if self.gold >= ware.price {
                self.gold -= ware.price;
                return true;
            }
        }
        false
    }
}
