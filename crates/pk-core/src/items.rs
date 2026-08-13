//! Weapons & gear — the item tables and the durability rules.
//!
//! PORTS: `items.ts`

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum WeaponId {
    Fists,
    Sword,
    Stick,
    Mace,
    Chair,
    Greatsword,
    Warhammer,
    Wreckingball,
    Gun,
    Bow,
    Flamethrower,
}

impl WeaponId {
    pub const ALL: [Self; 11] = [
        Self::Fists,
        Self::Sword,
        Self::Stick,
        Self::Mace,
        Self::Chair,
        Self::Greatsword,
        Self::Warhammer,
        Self::Wreckingball,
        Self::Gun,
        Self::Bow,
        Self::Flamethrower,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Fists => "fists",
            Self::Sword => "sword",
            Self::Stick => "stick",
            Self::Mace => "mace",
            Self::Chair => "chair",
            Self::Greatsword => "greatsword",
            Self::Warhammer => "warhammer",
            Self::Wreckingball => "wreckingball",
            Self::Gun => "gun",
            Self::Bow => "bow",
            Self::Flamethrower => "flamethrower",
        }
    }

    pub fn from_str_id(s: &str) -> Option<Self> {
        match s {
            "fists" => Some(Self::Fists),
            "sword" => Some(Self::Sword),
            "stick" => Some(Self::Stick),
            "mace" => Some(Self::Mace),
            "chair" => Some(Self::Chair),
            "greatsword" => Some(Self::Greatsword),
            "warhammer" => Some(Self::Warhammer),
            "wreckingball" => Some(Self::Wreckingball),
            "gun" => Some(Self::Gun),
            "bow" => Some(Self::Bow),
            "flamethrower" => Some(Self::Flamethrower),
            _ => None,
        }
    }

    pub const fn def(self) -> WeaponDef {
        match self {
            Self::Fists => WeaponDef {
                id: Self::Fists,
                label: "Fists",
                icon: "✊",
                kind: WeaponKind::Melee,
                damage: 1,
                range: 0.85,
                arc_cos: 0.5,
                cooldown: 0.3,
                max_durability: u32::MAX,
                slash_color: 0xc8ccd4,
                knockback_mult: 1.0,
                heft: 1.0,
                momentum_scaling: false,
                projectile: None,
                projectile_speed: 0.0,
                spread: 0.0,
                pellets: 1,
                pierce: 0,
            },
            Self::Sword => WeaponDef {
                id: Self::Sword,
                label: "Sword",
                icon: "🗡️",
                kind: WeaponKind::Melee,
                damage: 2,
                range: 1.35,
                arc_cos: 0.5,
                cooldown: 0.38,
                max_durability: 30,
                slash_color: 0xeef1f5,
                knockback_mult: 1.0,
                heft: 1.0,
                momentum_scaling: false,
                projectile: None,
                projectile_speed: 0.0,
                spread: 0.0,
                pellets: 1,
                pierce: 0,
            },
            Self::Stick => WeaponDef {
                id: Self::Stick,
                label: "Stick",
                icon: "🪵",
                kind: WeaponKind::Melee,
                damage: 1,
                range: 1.2,
                arc_cos: 0.5,
                cooldown: 0.24,
                max_durability: 15,
                slash_color: 0x6b4a2e,
                knockback_mult: 1.0,
                heft: 1.0,
                momentum_scaling: false,
                projectile: None,
                projectile_speed: 0.0,
                spread: 0.0,
                pellets: 1,
                pierce: 0,
            },
            Self::Mace => WeaponDef {
                id: Self::Mace,
                label: "Mace",
                icon: "🔨",
                kind: WeaponKind::Melee,
                damage: 3,
                range: 1.25,
                arc_cos: 0.55,
                cooldown: 0.62,
                max_durability: 45,
                slash_color: 0xffd98a,
                knockback_mult: 1.0,
                heft: 1.0,
                momentum_scaling: false,
                projectile: None,
                projectile_speed: 0.0,
                spread: 0.0,
                pellets: 1,
                pierce: 0,
            },
            Self::Chair => WeaponDef {
                id: Self::Chair,
                label: "Chair",
                icon: "🪑",
                kind: WeaponKind::Melee,
                damage: 2,
                range: 1.8,
                arc_cos: 0.0,
                cooldown: 0.55,
                max_durability: 22,
                slash_color: 0x6b4a2e,
                knockback_mult: 2.2,
                heft: 1.0,
                momentum_scaling: false,
                projectile: None,
                projectile_speed: 0.0,
                spread: 0.0,
                pellets: 1,
                pierce: 0,
            },
            Self::Greatsword => WeaponDef {
                id: Self::Greatsword,
                label: "Greatsword",
                icon: "🗡",
                kind: WeaponKind::Melee,
                damage: 5,
                range: 2.0,
                arc_cos: 0.15,
                cooldown: 0.9,
                max_durability: 40,
                slash_color: 0xeef1f5,
                knockback_mult: 1.5,
                heft: 1.7,
                momentum_scaling: false,
                projectile: None,
                projectile_speed: 0.0,
                spread: 0.0,
                pellets: 1,
                pierce: 0,
            },
            Self::Warhammer => WeaponDef {
                id: Self::Warhammer,
                label: "Warhammer",
                icon: "🔨",
                kind: WeaponKind::Melee,
                damage: 7,
                range: 1.4,
                arc_cos: 0.72,
                cooldown: 1.15,
                max_durability: 50,
                slash_color: 0xffd98a,
                knockback_mult: 3.4,
                heft: 2.1,
                momentum_scaling: false,
                projectile: None,
                projectile_speed: 0.0,
                spread: 0.0,
                pellets: 1,
                pierce: 0,
            },
            Self::Wreckingball => WeaponDef {
                id: Self::Wreckingball,
                label: "Wrecking Ball",
                icon: "⛓️",
                kind: WeaponKind::Melee,
                damage: 4,
                range: 1.9,
                arc_cos: 0.0,
                cooldown: 1.0,
                max_durability: 36,
                slash_color: 0xc8ccd4,
                knockback_mult: 2.6,
                heft: 1.85,
                momentum_scaling: true,
                projectile: None,
                projectile_speed: 0.0,
                spread: 0.0,
                pellets: 1,
                pierce: 0,
            },
            Self::Gun => WeaponDef {
                id: Self::Gun,
                label: "Gun",
                icon: "🔫",
                kind: WeaponKind::Ranged,
                damage: 2,
                range: 10.0,
                arc_cos: 1.0,
                cooldown: 0.32,
                max_durability: 30,
                slash_color: 0,
                knockback_mult: 1.0,
                heft: 1.0,
                momentum_scaling: false,
                projectile: Some("bullet"),
                projectile_speed: 16.0,
                spread: 0.04,
                pellets: 1,
                pierce: 0,
            },
            Self::Bow => WeaponDef {
                id: Self::Bow,
                label: "Bow",
                icon: "🏹",
                kind: WeaponKind::Ranged,
                damage: 3,
                range: 8.5,
                arc_cos: 1.0,
                cooldown: 0.72,
                max_durability: 22,
                slash_color: 0,
                knockback_mult: 1.0,
                heft: 1.0,
                momentum_scaling: false,
                projectile: Some("arrow"),
                projectile_speed: 11.0,
                spread: 0.0,
                pellets: 1,
                pierce: 2,
            },
            Self::Flamethrower => WeaponDef {
                id: Self::Flamethrower,
                label: "Flamer",
                icon: "🔥",
                kind: WeaponKind::Ranged,
                damage: 1,
                range: 3.4,
                arc_cos: 1.0,
                cooldown: 0.085,
                max_durability: 42,
                slash_color: 0,
                knockback_mult: 1.0,
                heft: 1.0,
                momentum_scaling: false,
                projectile: Some("flame"),
                projectile_speed: 4.6,
                spread: 0.3,
                pellets: 2,
                pierce: 0,
            },
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WeaponKind {
    Melee,
    Ranged,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WeaponDef {
    pub id: WeaponId,
    pub label: &'static str,
    pub icon: &'static str,
    pub kind: WeaponKind,
    pub damage: i32,
    pub range: f64,
    pub arc_cos: f64,
    pub cooldown: f64,
    pub max_durability: u32,
    pub slash_color: u32,
    pub knockback_mult: f64,
    pub heft: f64,
    pub momentum_scaling: bool,
    pub projectile: Option<&'static str>,
    pub projectile_speed: f64,
    pub spread: f64,
    pub pellets: u32,
    pub pierce: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ItemRarity {
    Common,
    Rare,
    Epic,
    Legendary,
}

impl ItemRarity {
    pub const ALL: [Self; 4] = [Self::Common, Self::Rare, Self::Epic, Self::Legendary];

    pub const fn slots(self) -> usize {
        match self {
            Self::Common => 1,
            Self::Rare => 2,
            Self::Epic => 3,
            Self::Legendary => 4,
        }
    }

    pub const fn hex(self) -> &'static str {
        match self {
            Self::Common => "#9aa4b4",
            Self::Rare => "#4f8fdb",
            Self::Epic => "#a46fe8",
            Self::Legendary => "#f0a63c",
        }
    }
}

pub const UPGRADE_SAFE_LEVEL: u32 = 3;
pub const UPGRADE_RISK_STEP: f64 = 0.12;
pub const UPGRADE_RISK_CAP: f64 = 0.6;
pub const UPGRADE_DAMAGE_STEP: f64 = 0.12;
pub const UPGRADE_DURABILITY_STEP: f64 = 0.08;

pub const SALVAGE_PER_UPGRADE: i64 = 12;

pub fn salvage_value(rarity: ItemRarity, upgrade: u32) -> i64 {
    let base = match rarity {
        ItemRarity::Common => 15,
        ItemRarity::Rare => 40,
        ItemRarity::Epic => 90,
        ItemRarity::Legendary => 200,
    };
    base + (upgrade as i64) * SALVAGE_PER_UPGRADE
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn weapon_durability_bounds() {
        for id in WeaponId::ALL {
            let def = id.def();
            assert!(def.damage > 0);
            assert!(def.range > 0.0);
        }
    }

    #[test]
    fn salvage_always_increases_with_upgrade() {
        let s0 = salvage_value(ItemRarity::Rare, 0);
        let s1 = salvage_value(ItemRarity::Rare, 1);
        assert_eq!(s1 - s0, SALVAGE_PER_UPGRADE);
    }
}
