//! Knight Look — Pure mapping from equipped gear to rendered armor sprite layers.
//!
//! PORTS: `render/knight-look.ts`

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct KnightLook {
    pub helmet: bool,
    pub armor: bool,
    pub boots: bool,
    pub style: Option<String>,
}

pub const FULL_PLATE: KnightLook = KnightLook {
    helmet: true,
    armor: true,
    boots: true,
    style: None,
};

/// Resolves the visible armor layers from durability counters.
pub fn look_from_gear(
    helmet_durability: u32,
    armor_durability: u32,
    boots_durability: u32,
    style: Option<&str>,
) -> KnightLook {
    KnightLook {
        helmet: helmet_durability > 0,
        armor: armor_durability > 0,
        boots: boots_durability > 0,
        style: style.map(|s| s.to_string()),
    }
}

/// Generates a composite cache key for a (weapon, look) sheet instance — e.g. "sword|101|ice".
pub fn look_key(weapon: &str, look: &KnightLook) -> String {
    let h = if look.helmet { 1 } else { 0 };
    let a = if look.armor { 1 } else { 0 };
    let b = if look.boots { 1 } else { 0 };
    let style = look.style.as_deref().unwrap_or("iron");
    format!("{weapon}|{h}{a}{b}|{style}")
}
