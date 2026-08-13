//! RECIPES — the Alchemist's brew book (Ragnarok "Prepare Potion" model).
//!
//! A recipe turns monster REAGENTS (reagents.ts) plus an Empty Flask catalyst
//! (state.flasks) into a potion (items.ts POTIONS). Rarer reagents gate stronger
//! brews — the same escalation RO uses (Red Herb → Red Potion; White Herb, Blue
//! Herb → the strong stuff). Brewing lives at the Tavern Alchemist (tavern.ts);
//! this file is just the pure table + the can-afford / consume arithmetic.
//!
//! PORTS: `recipes.ts`

use std::collections::BTreeMap;
use crate::reagents::{ReagentId, ReagentTier};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum RecipeId {
    Flask,
    Health,
    Haste,
    Rage,
    Shield,
    Curveshot,
    Magnetboots,
    Ballform,
    Freeze,
    Multiball,
    Regen,
    Venomcoat,
    Stoneskin,
    Static,
    Greed,
    Elixir,
}

impl RecipeId {
    pub const ALL: [Self; 16] = [
        Self::Flask,
        Self::Health,
        Self::Haste,
        Self::Rage,
        Self::Shield,
        Self::Curveshot,
        Self::Magnetboots,
        Self::Ballform,
        Self::Freeze,
        Self::Multiball,
        Self::Regen,
        Self::Venomcoat,
        Self::Stoneskin,
        Self::Static,
        Self::Greed,
        Self::Elixir,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Flask => "flask",
            Self::Health => "health",
            Self::Haste => "haste",
            Self::Rage => "rage",
            Self::Shield => "shield",
            Self::Curveshot => "curveshot",
            Self::Magnetboots => "magnetboots",
            Self::Ballform => "ballform",
            Self::Freeze => "freeze",
            Self::Multiball => "multiball",
            Self::Regen => "regen",
            Self::Venomcoat => "venomcoat",
            Self::Stoneskin => "stoneskin",
            Self::Static => "static",
            Self::Greed => "greed",
            Self::Elixir => "elixir",
        }
    }

    pub const fn def(self) -> RecipeDef {
        match self {
            Self::Flask => RecipeDef {
                id: Self::Flask,
                label: "Empty Flask",
                icon: "🧴",
                output: "flask",
                inputs: &[(ReagentId::Glass, 3)],
                flasks: 0,
                gold: 0,
                tier: ReagentTier::Uncommon,
            },
            Self::Health => RecipeDef {
                id: Self::Health,
                label: "Health",
                icon: "❤️",
                output: "health",
                inputs: &[(ReagentId::Slimegel, 2), (ReagentId::Rotflesh, 1)],
                flasks: 1,
                gold: 0,
                tier: ReagentTier::Common,
            },
            Self::Haste => RecipeDef {
                id: Self::Haste,
                label: "Haste",
                icon: "⚡",
                output: "haste",
                inputs: &[(ReagentId::Batwing, 2)],
                flasks: 1,
                gold: 0,
                tier: ReagentTier::Common,
            },
            Self::Rage => RecipeDef {
                id: Self::Rage,
                label: "Rage",
                icon: "💢",
                output: "rage",
                inputs: &[(ReagentId::Venomsac, 1), (ReagentId::Hide, 1)],
                flasks: 1,
                gold: 0,
                tier: ReagentTier::Uncommon,
            },
            Self::Shield => RecipeDef {
                id: Self::Shield,
                label: "Shield",
                icon: "🛡️",
                output: "shield",
                inputs: &[(ReagentId::Ironshard, 1), (ReagentId::Lodestone, 1)],
                flasks: 1,
                gold: 0,
                tier: ReagentTier::Uncommon,
            },
            Self::Curveshot => RecipeDef {
                id: Self::Curveshot,
                label: "Curve Shot",
                icon: "🌀",
                output: "curveshot",
                inputs: &[(ReagentId::Silk, 1), (ReagentId::Fang, 1)],
                flasks: 1,
                gold: 0,
                tier: ReagentTier::Uncommon,
            },
            Self::Magnetboots => RecipeDef {
                id: Self::Magnetboots,
                label: "Magnet Boots",
                icon: "🧲",
                output: "magnetboots",
                inputs: &[(ReagentId::Lodestone, 2)],
                flasks: 1,
                gold: 0,
                tier: ReagentTier::Uncommon,
            },
            Self::Ballform => RecipeDef {
                id: Self::Ballform,
                label: "Ball Form",
                icon: "🪩",
                output: "ballform",
                inputs: &[
                    (ReagentId::Ironshard, 1),
                    (ReagentId::Lodestone, 1),
                    (ReagentId::Steelpin, 1),
                ],
                flasks: 1,
                gold: 0,
                tier: ReagentTier::Uncommon,
            },
            Self::Freeze => RecipeDef {
                id: Self::Freeze,
                label: "Freeze",
                icon: "❄️",
                output: "freeze",
                inputs: &[(ReagentId::Ectoplasm, 1), (ReagentId::Silk, 2)],
                flasks: 1,
                gold: 0,
                tier: ReagentTier::Rare,
            },
            Self::Multiball => RecipeDef {
                id: Self::Multiball,
                label: "Multi-Ball",
                icon: "🔮",
                output: "multiball",
                inputs: &[(ReagentId::Lodestone, 1), (ReagentId::Ectoplasm, 1)],
                flasks: 1,
                gold: 0,
                tier: ReagentTier::Rare,
            },
            Self::Regen => RecipeDef {
                id: Self::Regen,
                label: "Regen Salve",
                icon: "🧪",
                output: "regen",
                inputs: &[(ReagentId::Slimegel, 3)],
                flasks: 1,
                gold: 0,
                tier: ReagentTier::Common,
            },
            Self::Venomcoat => RecipeDef {
                id: Self::Venomcoat,
                label: "Venom Coat",
                icon: "☠️",
                output: "venomcoat",
                inputs: &[(ReagentId::Venomsac, 2)],
                flasks: 1,
                gold: 0,
                tier: ReagentTier::Uncommon,
            },
            Self::Stoneskin => RecipeDef {
                id: Self::Stoneskin,
                label: "Stoneskin",
                icon: "🪨",
                output: "stoneskin",
                inputs: &[(ReagentId::Ironshard, 2), (ReagentId::Lodestone, 1)],
                flasks: 1,
                gold: 0,
                tier: ReagentTier::Uncommon,
            },
            Self::Static => RecipeDef {
                id: Self::Static,
                label: "Static Charge",
                icon: "⚡",
                output: "static",
                inputs: &[(ReagentId::Lodestone, 2), (ReagentId::Steelpin, 1)],
                flasks: 1,
                gold: 0,
                tier: ReagentTier::Uncommon,
            },
            Self::Greed => RecipeDef {
                id: Self::Greed,
                label: "Greed Draught",
                icon: "💰",
                output: "greed",
                inputs: &[(ReagentId::Goblintooth, 3)],
                flasks: 1,
                gold: 0,
                tier: ReagentTier::Uncommon,
            },
            Self::Elixir => RecipeDef {
                id: Self::Elixir,
                label: "Elixir of Life",
                icon: "🌟",
                output: "elixir",
                inputs: &[
                    (ReagentId::Grimbone, 1),
                    (ReagentId::Ectoplasm, 1),
                    (ReagentId::Slimegel, 2),
                ],
                flasks: 2,
                gold: 40,
                tier: ReagentTier::Rare,
            },
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RecipeDef {
    pub id: RecipeId,
    pub label: &'static str,
    pub icon: &'static str,
    pub output: &'static str,
    pub inputs: &'static [(ReagentId, u32)],
    pub flasks: u32,
    pub gold: i64,
    pub tier: ReagentTier,
}

pub type Pouch = BTreeMap<ReagentId, u32>;

pub fn can_craft(r: &RecipeDef, pouch: &Pouch, flasks: u32, gold: i64) -> bool {
    if flasks < r.flasks {
        return false;
    }
    if gold < r.gold {
        return false;
    }
    for &(id, need) in r.inputs {
        if pouch.get(&id).copied().unwrap_or(0) < need {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_recipe_defines_a_valid_output() {
        for id in RecipeId::ALL {
            let r = id.def();
            assert!(!r.label.is_empty());
            assert!(!r.output.is_empty());
            assert!(!r.inputs.is_empty());
        }
    }

    #[test]
    fn flask_requires_zero_flasks_to_craft() {
        let r = RecipeId::Flask.def();
        assert_eq!(r.flasks, 0);
        let mut p = Pouch::new();
        p.insert(ReagentId::Glass, 3);
        assert!(can_craft(&r, &p, 0, 0));
    }
}
