//! REAGENTS — monster loot materials, the Ragnarok-Online model.
//!
//! In RO a monster drops what it's "made of" (a Poring drops Jellopy, a Golem
//! drops Iron Ore, a Ghoul drops herbs) and you brew those into potions at an
//! Alchemist. We theme our 14 enemy kinds the same way: every EnemyKind maps to
//! the reagent it's built from, and the Tavern Alchemist combines them (+ an
//! Empty Flask catalyst) into potions via recipes.ts.
//!
//! PORTS: `reagents.ts`

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]

pub enum ReagentTier {
    Common,
    Uncommon,
    Rare,
}

impl ReagentTier {
    pub const fn hex(self) -> &'static str {
        match self {
            Self::Common => "#9aa4b4",
            Self::Uncommon => "#4f8fdb",
            Self::Rare => "#a46fe8",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ReagentId {
    Slimegel,
    Batwing,
    Rotflesh,
    Silk,
    Hide,
    Venomsac,
    Goblintooth,
    Steelpin,
    Ironshard,
    Lodestone,
    Fang,
    Glass,
    Ectoplasm,
    Grimbone,
}

impl ReagentId {
    pub const ALL: [Self; 14] = [
        Self::Slimegel,
        Self::Batwing,
        Self::Rotflesh,
        Self::Silk,
        Self::Hide,
        Self::Venomsac,
        Self::Goblintooth,
        Self::Steelpin,
        Self::Ironshard,
        Self::Lodestone,
        Self::Fang,
        Self::Glass,
        Self::Ectoplasm,
        Self::Grimbone,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Slimegel => "slimegel",
            Self::Batwing => "batwing",
            Self::Rotflesh => "rotflesh",
            Self::Silk => "silk",
            Self::Hide => "hide",
            Self::Venomsac => "venomsac",
            Self::Goblintooth => "goblintooth",
            Self::Steelpin => "steelpin",
            Self::Ironshard => "ironshard",
            Self::Lodestone => "lodestone",
            Self::Fang => "fang",
            Self::Glass => "glass",
            Self::Ectoplasm => "ectoplasm",
            Self::Grimbone => "grimbone",
        }
    }

    pub fn from_str_id(s: &str) -> Option<Self> {
        match s {
            "slimegel" => Some(Self::Slimegel),
            "batwing" => Some(Self::Batwing),
            "rotflesh" => Some(Self::Rotflesh),
            "silk" => Some(Self::Silk),
            "hide" => Some(Self::Hide),
            "venomsac" => Some(Self::Venomsac),
            "goblintooth" => Some(Self::Goblintooth),
            "steelpin" => Some(Self::Steelpin),
            "ironshard" => Some(Self::Ironshard),
            "lodestone" => Some(Self::Lodestone),
            "fang" => Some(Self::Fang),
            "glass" => Some(Self::Glass),
            "ectoplasm" => Some(Self::Ectoplasm),
            "grimbone" => Some(Self::Grimbone),
            _ => None,
        }
    }

    pub const fn def(self) -> ReagentDef {
        match self {
            Self::Slimegel => ReagentDef {
                id: Self::Slimegel,
                label: "Slime Gel",
                icon: "🟢",
                tier: ReagentTier::Common,
                color: "#7bd47b",
                description: "jelly from a slime",
            },
            Self::Batwing => ReagentDef {
                id: Self::Batwing,
                label: "Bat Wing",
                icon: "🦇",
                tier: ReagentTier::Common,
                color: "#8f7bd0",
                description: "leathery flyer's wing",
            },
            Self::Rotflesh => ReagentDef {
                id: Self::Rotflesh,
                label: "Rotten Flesh",
                icon: "🧟",
                tier: ReagentTier::Common,
                color: "#8a9a5b",
                description: "scrap of undead meat",
            },
            Self::Silk => ReagentDef {
                id: Self::Silk,
                label: "Sticky Silk",
                icon: "🕸️",
                tier: ReagentTier::Common,
                color: "#dfe7f2",
                description: "spun spider thread",
            },
            Self::Hide => ReagentDef {
                id: Self::Hide,
                label: "Coarse Hide",
                icon: "🐗",
                tier: ReagentTier::Common,
                color: "#a9744f",
                description: "a brute's thick skin",
            },
            Self::Venomsac => ReagentDef {
                id: Self::Venomsac,
                label: "Venom Sac",
                icon: "🟣",
                tier: ReagentTier::Uncommon,
                color: "#a83fd0",
                description: "a spitter's acid gland",
            },
            Self::Goblintooth => ReagentDef {
                id: Self::Goblintooth,
                label: "Goblin Tooth",
                icon: "👺",
                tier: ReagentTier::Uncommon,
                color: "#d0b23f",
                description: "a chipped goblin fang",
            },
            Self::Steelpin => ReagentDef {
                id: Self::Steelpin,
                label: "Steel Pin",
                icon: "📌",
                tier: ReagentTier::Uncommon,
                color: "#b8c0cc",
                description: "hardened bowling steel",
            },
            Self::Ironshard => ReagentDef {
                id: Self::Ironshard,
                label: "Iron Shard",
                icon: "🪨",
                tier: ReagentTier::Uncommon,
                color: "#9a8f77",
                description: "a golem's iron ore",
            },
            Self::Lodestone => ReagentDef {
                id: Self::Lodestone,
                label: "Lodestone",
                icon: "🧲",
                tier: ReagentTier::Uncommon,
                color: "#c0506a",
                description: "a magnet crawler's core",
            },
            Self::Fang => ReagentDef {
                id: Self::Fang,
                label: "Sharp Fang",
                icon: "🦷",
                tier: ReagentTier::Uncommon,
                color: "#e8e0cf",
                description: "a wicked biter's fang",
            },
            Self::Glass => ReagentDef {
                id: Self::Glass,
                label: "Glass Shard",
                icon: "🔷",
                tier: ReagentTier::Uncommon,
                color: "#6fd0e8",
                description: "shatters into flasks",
            },
            Self::Ectoplasm => ReagentDef {
                id: Self::Ectoplasm,
                label: "Cold Ectoplasm",
                icon: "👻",
                tier: ReagentTier::Rare,
                color: "#bfe8ff",
                description: "a ghost's chill residue",
            },
            Self::Grimbone => ReagentDef {
                id: Self::Grimbone,
                label: "Grim Bone",
                icon: "💀",
                tier: ReagentTier::Rare,
                color: "#e8e6df",
                description: "bone of the fallen",
            },
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReagentDef {
    pub id: ReagentId,
    pub label: &'static str,
    pub icon: &'static str,
    pub tier: ReagentTier,
    pub color: &'static str,
    pub description: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DropEntry {
    pub id: ReagentId,
    pub chance: f64,
}

pub fn drops_for_kind(kind: &str) -> &'static [DropEntry] {
    match kind {
        "zombie" => &[DropEntry { id: ReagentId::Rotflesh, chance: 0.28 }],
        "spider" => &[
            DropEntry { id: ReagentId::Silk, chance: 0.18 },
            DropEntry { id: ReagentId::Fang, chance: 0.1 },
        ],
        "brute" => &[
            DropEntry { id: ReagentId::Hide, chance: 0.28 },
            DropEntry { id: ReagentId::Rotflesh, chance: 0.08 },
        ],
        "spitter" => &[DropEntry { id: ReagentId::Venomsac, chance: 0.2 }],
        "ghost" => &[DropEntry { id: ReagentId::Ectoplasm, chance: 0.14 }],
        "bat" => &[DropEntry { id: ReagentId::Batwing, chance: 0.28 }],
        "slime" => &[DropEntry { id: ReagentId::Slimegel, chance: 0.3 }],
        "reaper" => &[DropEntry { id: ReagentId::Grimbone, chance: 0.12 }],
        "goblin" => &[DropEntry { id: ReagentId::Goblintooth, chance: 0.16 }],
        "pin" => &[
            DropEntry { id: ReagentId::Steelpin, chance: 0.14 },
            DropEntry { id: ReagentId::Glass, chance: 0.06 },
        ],
        "golem" => &[
            DropEntry { id: ReagentId::Ironshard, chance: 0.2 },
            DropEntry { id: ReagentId::Glass, chance: 0.1 },
        ],
        "chomper" => &[
            DropEntry { id: ReagentId::Slimegel, chance: 0.14 },
            DropEntry { id: ReagentId::Fang, chance: 0.1 },
        ],
        "magnet" => &[DropEntry { id: ReagentId::Lodestone, chance: 0.16 }],
        "webspinner" => &[DropEntry { id: ReagentId::Silk, chance: 0.28 }],
        "sporeling" => &[
            DropEntry { id: ReagentId::Rotflesh, chance: 0.22 },
            DropEntry { id: ReagentId::Slimegel, chance: 0.12 },
        ],
        "jester" => &[
            DropEntry { id: ReagentId::Steelpin, chance: 0.26 },
            DropEntry { id: ReagentId::Glass, chance: 0.1 },
        ],
        "croaker" => &[
            DropEntry { id: ReagentId::Slimegel, chance: 0.26 },
            DropEntry { id: ReagentId::Glass, chance: 0.12 },
        ],
        "rotortail" => &[
            DropEntry { id: ReagentId::Hide, chance: 0.24 },
            DropEntry { id: ReagentId::Ironshard, chance: 0.12 },
        ],
        "stiltneck" => &[
            DropEntry { id: ReagentId::Ironshard, chance: 0.26 },
            DropEntry { id: ReagentId::Hide, chance: 0.16 },
        ],
        "fish_feet" => &[
            DropEntry { id: ReagentId::Hide, chance: 0.24 },
            DropEntry { id: ReagentId::Fang, chance: 0.12 },
        ],
        "hound" => &[
            DropEntry { id: ReagentId::Fang, chance: 0.24 },
            DropEntry { id: ReagentId::Hide, chance: 0.1 },
        ],
        "bloater" => &[
            DropEntry { id: ReagentId::Venomsac, chance: 0.24 },
            DropEntry { id: ReagentId::Slimegel, chance: 0.14 },
        ],
        "necromancer" => &[
            DropEntry { id: ReagentId::Grimbone, chance: 0.22 },
            DropEntry { id: ReagentId::Ectoplasm, chance: 0.12 },
        ],
        "warden" => &[
            DropEntry { id: ReagentId::Ironshard, chance: 0.2 },
            DropEntry { id: ReagentId::Hide, chance: 0.12 },
        ],
        "wisp" => &[DropEntry { id: ReagentId::Ectoplasm, chance: 0.24 }],
        "sapper" => &[
            DropEntry { id: ReagentId::Lodestone, chance: 0.2 },
            DropEntry { id: ReagentId::Glass, chance: 0.1 },
        ],
        "crystalback" => &[
            DropEntry { id: ReagentId::Glass, chance: 0.3 },
            DropEntry { id: ReagentId::Ironshard, chance: 0.12 },
        ],
        "mimic" => &[
            DropEntry { id: ReagentId::Goblintooth, chance: 0.2 },
            DropEntry { id: ReagentId::Steelpin, chance: 0.12 },
        ],
        _ => &[],
    }
}

pub fn roll_reagent_drops<F: FnMut() -> f64>(
    kind: &str,
    boss: bool,
    drop_mult: Option<f64>,
    mut rand: F,
) -> Vec<ReagentId> {
    let table = drops_for_kind(kind);
    let mut out = Vec::new();
    let mult = drop_mult.unwrap_or(1.0);

    for e in table {
        if rand() < (e.chance * mult).min(1.0) {
            out.push(e.id);
        }
    }
    if boss {
        out.push(ReagentId::Grimbone);
        for e in table {
            if rand() < (e.chance * mult).min(1.0) {
                out.push(e.id);
            }
        }
    }
    out
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_reagent_id_has_a_def() {
        for id in ReagentId::ALL {
            let d = id.def();
            assert_eq!(d.id, id);
            assert!(!d.label.is_empty());
            assert!(!d.icon.is_empty());
            assert!(!d.color.is_empty());
        }
    }

    #[test]
    fn boss_drop_guarantees_grimbone() {
        let drops = roll_reagent_drops("zombie", true, None, || 0.999);
        assert_eq!(drops, vec![ReagentId::Grimbone]);
    }
}
