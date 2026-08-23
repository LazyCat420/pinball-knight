//! ARMOR STYLES — elemental plate SETS sold at the Tavern Armorer.
//!
//! Port of `legacy/src/game/pinball-knight/armor-styles.ts` (128 lines).
//!
//! PORTS: `armor-styles.ts`

use std::sync::RwLock;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ArmorStyleId {
    Iron,
    Ice,
    Wind,
    Fire,
    Thunder,
}

impl ArmorStyleId {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Iron => "iron",
            Self::Ice => "ice",
            Self::Wind => "wind",
            Self::Fire => "fire",
            Self::Thunder => "thunder",
        }
    }

    pub fn from_str_id(s: &str) -> Option<Self> {
        match s {
            "iron" => Some(Self::Iron),
            "ice" => Some(Self::Ice),
            "wind" => Some(Self::Wind),
            "fire" => Some(Self::Fire),
            "thunder" => Some(Self::Thunder),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BonusAbsorb {
    pub helmet: i32,
    pub armor: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ArmorStyleDef {
    pub id: ArmorStyleId,
    pub label: &'static str,
    pub icon: &'static str,
    pub price: i64,
    pub swatch: &'static str,
    pub blurb: &'static str,
    pub bonus_absorb: BonusAbsorb,
}

pub const ARMOR_STYLE_IDS: [ArmorStyleId; 5] = [
    ArmorStyleId::Iron,
    ArmorStyleId::Ice,
    ArmorStyleId::Wind,
    ArmorStyleId::Fire,
    ArmorStyleId::Thunder,
];

pub const ELEMENTAL_STYLE_IDS: [ArmorStyleId; 4] = [
    ArmorStyleId::Ice,
    ArmorStyleId::Wind,
    ArmorStyleId::Fire,
    ArmorStyleId::Thunder,
];

pub const ARMOR_STYLES: [(ArmorStyleId, ArmorStyleDef); 5] = [
    (
        ArmorStyleId::Iron,
        ArmorStyleDef {
            id: ArmorStyleId::Iron,
            label: "Crypt Iron",
            icon: "🛡️",
            price: 0,
            swatch: "#8a94a6",
            blurb: "the classic plate you marched in with",
            bonus_absorb: BonusAbsorb {
                helmet: 0,
                armor: 0,
            },
        },
    ),
    (
        ArmorStyleId::Ice,
        ArmorStyleDef {
            id: ArmorStyleId::Ice,
            label: "Glacier Plate",
            icon: "❄️",
            price: 600,
            swatch: "#6fd0e8",
            blurb: "hoarfrost steel, cold-blue sheen",
            bonus_absorb: BonusAbsorb {
                helmet: 2,
                armor: 3,
            },
        },
    ),
    (
        ArmorStyleId::Wind,
        ArmorStyleDef {
            id: ArmorStyleId::Wind,
            label: "Gale Plate",
            icon: "🌪️",
            price: 600,
            swatch: "#8fc46b",
            blurb: "jade-green tempest steel",
            bonus_absorb: BonusAbsorb {
                helmet: 2,
                armor: 3,
            },
        },
    ),
    (
        ArmorStyleId::Fire,
        ArmorStyleDef {
            id: ArmorStyleId::Fire,
            label: "Ember Plate",
            icon: "🔥",
            price: 750,
            swatch: "#f0a63c",
            blurb: "forge-hot plate, ember glow",
            bonus_absorb: BonusAbsorb {
                helmet: 2,
                armor: 3,
            },
        },
    ),
    (
        ArmorStyleId::Thunder,
        ArmorStyleDef {
            id: ArmorStyleId::Thunder,
            label: "Storm Plate",
            icon: "⚡",
            price: 900,
            swatch: "#ffd98a",
            blurb: "storm-slate chased with lightning gold",
            bonus_absorb: BonusAbsorb {
                helmet: 2,
                armor: 3,
            },
        },
    ),
];

pub fn armor_style_def(id: ArmorStyleId) -> ArmorStyleDef {
    for (style_id, def) in ARMOR_STYLES {
        if style_id == id {
            return def;
        }
    }
    ARMOR_STYLES[0].1
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArmorStyleState {
    pub unlocked: Vec<ArmorStyleId>,
    pub active: ArmorStyleId,
}

impl Default for ArmorStyleState {
    fn default() -> Self {
        Self {
            unlocked: vec![ArmorStyleId::Iron],
            active: ArmorStyleId::Iron,
        }
    }
}

static STYLE_STATE: RwLock<Option<ArmorStyleState>> = RwLock::new(None);

pub fn active_style() -> ArmorStyleId {
    let read = STYLE_STATE.read().unwrap();
    if let Some(state) = read.as_ref() {
        state.active
    } else {
        ArmorStyleId::Iron
    }
}

pub fn is_style_unlocked(id: ArmorStyleId) -> bool {
    if id == ArmorStyleId::Iron {
        return true;
    }
    let read = STYLE_STATE.read().unwrap();
    if let Some(state) = read.as_ref() {
        state.unlocked.contains(&id)
    } else {
        false
    }
}

pub fn unlock_style(id: ArmorStyleId) {
    let mut write = STYLE_STATE.write().unwrap();
    let state = write.get_or_insert_with(ArmorStyleState::default);
    if id != ArmorStyleId::Iron && !state.unlocked.contains(&id) {
        state.unlocked.push(id);
    }
    state.active = id;
}

pub fn set_active_style(id: ArmorStyleId) -> bool {
    if !is_style_unlocked(id) {
        return false;
    }
    let mut write = STYLE_STATE.write().unwrap();
    let state = write.get_or_insert_with(ArmorStyleState::default);
    state.active = id;
    true
}

pub fn style_gear_grant(slot: &str, base: i32, id: ArmorStyleId) -> i32 {
    let def = armor_style_def(id);
    match slot {
        "helmet" => base + def.bonus_absorb.helmet,
        "armor" => base + def.bonus_absorb.armor,
        _ => base,
    }
}

pub fn reset_armor_styles_cache() {
    let mut write = STYLE_STATE.write().unwrap();
    *write = None;
}
