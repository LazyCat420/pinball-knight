//! BESTIARY — "which monster drops what", derived rather than authored.
//!
//! Port of `legacy/src/game/pinball-knight/bestiary.ts` (380 lines).
//!
//! PORTS: `bestiary.ts`

use std::collections::HashMap;

use crate::cards::{self, CardRarity, CARDS};
use crate::constants::enemies::{BESTIARY_AFFINITY_MAX, BESTIARY_AFFINITY_STEP, BESTIARY_MILESTONES};
use crate::reagents::drops_for_kind;
use crate::state::EnemyKind;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct KindInfo {
    pub label: &'static str,
    pub icon: &'static str,
    pub blurb: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MonsterInfo {
    pub kind: &'static str,
    pub label: &'static str,
    pub icon: &'static str,
    pub blurb: &'static str,
}

pub const MONSTER_INFOS: &[MonsterInfo] = &[
    MonsterInfo {
        kind: "zombie",
        label: "Zombie",
        icon: "🧟",
        blurb: "shambles in a drag-limp, aggressive sprint, red claw slash attacks, and blood-splatter collapse",
    },
    MonsterInfo {
        kind: "spider",
        label: "Spider",
        icon: "🕷️",
        blurb: "fast and fragile; spins the silk everything else needs",
    },
    MonsterInfo {
        kind: "brute",
        label: "Brute",
        icon: "🦍",
        blurb: "thick hide, heavy swing, enrages when hurt",
    },
    MonsterInfo {
        kind: "spitter",
        label: "Spitter",
        icon: "🤮",
        blurb: "kites you and lobs acid from range",
    },
    MonsterInfo {
        kind: "ghost",
        label: "Ghost",
        icon: "👻",
        blurb: "drifts through walls; untouchable until it strikes",
    },
    MonsterInfo {
        kind: "bat",
        label: "Bat",
        icon: "🦇",
        blurb: "wobbles in on a drunken line — hard to swat",
    },
    MonsterInfo {
        kind: "slime",
        label: "Slime",
        icon: "🟢",
        blurb: "splits into two fast minis when killed",
    },
    MonsterInfo {
        kind: "sporeling",
        label: "Sporeling",
        icon: "🍄",
        blurb: "a walking fruiting body; it bursts a spore cloud when it dies",
    },
    MonsterInfo {
        kind: "jester",
        label: "Jester",
        icon: "🤡",
        blurb: "fires the plate off its head — and the plate ricochets",
    },
    MonsterInfo {
        kind: "croaker",
        label: "Croaker",
        icon: "🐸",
        blurb: "twin eye-beams; hops knee-high walls and bounces its leap off the rest",
    },
    MonsterInfo {
        kind: "rotortail",
        label: "Rotortail",
        icon: "🪵",
        blurb: "circles overhead and drops timber; a solid hit stalls its rotor",
    },
    MonsterInfo {
        kind: "stiltneck",
        label: "Stiltneck",
        icon: "💣",
        blurb: "slings a lit bomb from nine tiles out — the blast catches its own horde too",
    },
    MonsterInfo {
        kind: "fish_feet",
        label: "Fish Feet",
        icon: "👟",
        blurb: "a smoking fish walking on white Converse sneakers that delivers heavy kick strikes",
    },
    MonsterInfo {
        kind: "reaper",
        label: "Death Dealer",
        icon: "☠️",
        blurb: "cannot be hurt. It only ever gets faster",
    },
    MonsterInfo {
        kind: "goblin",
        label: "Goblin",
        icon: "👺",
        blurb: "kicks you off your line; shrugs off a standing poke",
    },
    MonsterInfo {
        kind: "pin",
        label: "Bowling Pin",
        icon: "🎳",
        blurb: "does not fight. It scores — and it chains",
    },
    MonsterInfo {
        kind: "golem",
        label: "Brick Golem",
        icon: "🗿",
        blurb: "rooted furniture with teeth; needs smash-speed",
    },
    MonsterInfo {
        kind: "chomper",
        label: "Chomper",
        icon: "🪤",
        blurb: "rooted jaws holding a chokepoint",
    },
    MonsterInfo {
        kind: "magnet",
        label: "Magnet Crawler",
        icon: "🧲",
        blurb: "drags your momentum off its line",
    },
    MonsterInfo {
        kind: "webspinner",
        label: "Webspinner",
        icon: "🕸️",
        blurb: "webs you at range and slows the ride",
    },
    MonsterInfo {
        kind: "hound",
        label: "Hound",
        icon: "🐺",
        blurb: "locks a dash and charges the gap",
    },
    MonsterInfo {
        kind: "bloater",
        label: "Bloater",
        icon: "🫧",
        blurb: "bursts into a burning puddle — don't melee it close",
    },
    MonsterInfo {
        kind: "necromancer",
        label: "Necromancer",
        icon: "🕯️",
        blurb: "raises adds faster than you can clear them",
    },
    MonsterInfo {
        kind: "warden",
        label: "Warden",
        icon: "🛡️",
        blurb: "shields everything around it in a pulse",
    },
    MonsterInfo {
        kind: "wisp",
        label: "Wisp",
        icon: "✨",
        blurb: "blinks out of your swing and crackles back",
    },
    MonsterInfo {
        kind: "sapper",
        label: "Sapper",
        icon: "🧨",
        blurb: "closes and detonates",
    },
    MonsterInfo {
        kind: "crystalback",
        label: "Crystalback",
        icon: "🔷",
        blurb: "rooted; shatters into flask glass",
    },
    MonsterInfo {
        kind: "mimic",
        label: "Mimic",
        icon: "🎁",
        blurb: "dormant until you're close enough to regret it",
    },
];

pub fn info_for_kind(kind: &str) -> Option<&'static MonsterInfo> {
    MONSTER_INFOS.iter().find(|m| m.kind == kind)
}

pub const KIND_IDS: [EnemyKind; 16] = [
    EnemyKind::Zombie,
    EnemyKind::Spider,
    EnemyKind::Brute,
    EnemyKind::Spitter,
    EnemyKind::Ghost,
    EnemyKind::Bat,
    EnemyKind::Slime,
    EnemyKind::Sporeling,
    EnemyKind::Jester,
    EnemyKind::Croaker,
    EnemyKind::Rotortail,
    EnemyKind::Stiltneck,
    EnemyKind::FishFeet,
    EnemyKind::Reaper,
    EnemyKind::Goblin,
    EnemyKind::Pin,
];

#[derive(Clone, Debug, PartialEq)]
pub struct BestiaryDrop {
    pub id: String,
    pub label: String,
    pub icon: String,
    pub color: String,
    pub chance: f64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BestiaryCard {
    pub id: &'static str,
    pub label: String,
    pub icon: String,
    pub rarity: CardRarity,
    pub hex: String,
    pub description: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BestiarySubType {
    pub id: String,
    pub label: String,
    pub cards: Vec<BestiaryCard>,
    pub hp: i32,
    pub notes: Vec<String>,
    pub kills: usize,
    pub seen: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BestiaryMilestone {
    pub tier: usize,
    pub to_next: Option<i32>,
    pub next: Option<i32>,
    pub affinity: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct BestiaryEntry {
    pub kind: EnemyKind,
    pub label: String,
    pub icon: String,
    pub blurb: String,
    pub kills: usize,
    pub seen: bool,
    pub drops: Vec<BestiaryDrop>,
    pub cards: Vec<BestiaryCard>,
    pub sub_types: Vec<BestiarySubType>,
    pub mechanics: Vec<String>,
    pub milestone: BestiaryMilestone,
    pub ram_kills: usize,
    pub best_combo: usize,
}

/// The card-affinity multiplier a family's kill count has earned, ≥ 1.0.
pub fn family_affinity(kills: usize) -> f64 {
    let mut tier = 0;
    for &m in &BESTIARY_MILESTONES {
        if kills as i32 >= m {
            tier += 1;
        }
    }
    (1.0 + tier as f64 * BESTIARY_AFFINITY_STEP).min(BESTIARY_AFFINITY_MAX)
}

/// What a family's kill count has bought in milestones.
pub fn family_milestone(kills: usize) -> BestiaryMilestone {
    let mut tier = 0;
    for &m in &BESTIARY_MILESTONES {
        if kills as i32 >= m {
            tier += 1;
        }
    }
    let next = if tier < BESTIARY_MILESTONES.len() {
        Some(BESTIARY_MILESTONES[tier])
    } else {
        None
    };
    let to_next: Option<i32> = next.map(|n| (n - kills as i32).max(0));
    BestiaryMilestone {
        tier,
        next,
        to_next,
        affinity: family_affinity(kills),
    }
}

/// Helper for looking up KindInfo.
pub fn kind_info_for(kind: EnemyKind) -> KindInfo {
    if let Some(info) = info_for_kind(kind.as_str()) {
        KindInfo {
            label: info.label,
            icon: info.icon,
            blurb: info.blurb,
        }
    } else {
        KindInfo {
            label: "Unknown",
            icon: "❓",
            blurb: "a mysterious creature of the crypt",
        }
    }
}

/// Convert state::EnemyKind to cards::EnemyKind if present.
fn to_cards_kind(kind: EnemyKind) -> Option<cards::EnemyKind> {
    match kind {
        EnemyKind::Zombie => Some(cards::EnemyKind::Zombie),
        EnemyKind::Bat => Some(cards::EnemyKind::Bat),
        EnemyKind::Spider => Some(cards::EnemyKind::Spider),
        EnemyKind::Goblin => Some(cards::EnemyKind::Goblin),
        EnemyKind::Spitter => Some(cards::EnemyKind::Spitter),
        EnemyKind::Ghost => Some(cards::EnemyKind::Ghost),
        EnemyKind::Reaper => Some(cards::EnemyKind::Reaper),
        EnemyKind::Brute => Some(cards::EnemyKind::Brute),
        _ => None,
    }
}

/// Build cards for a given enemy kind.
fn cards_for(kind: EnemyKind) -> Vec<BestiaryCard> {
    let target = to_cards_kind(kind);
    CARDS
        .iter()
        .filter(|c| target.is_some() && c.source == target)
        .map(|c| BestiaryCard {
            id: c.id,
            label: c.label.to_string(),
            icon: c.icon.to_string(),
            rarity: c.rarity,
            hex: c.rarity.hex().to_string(),
            description: c.description.to_string(),
        })
        .collect()
}

/// Build reagent drops for a given enemy kind.
fn drops_for(kind: EnemyKind) -> Vec<BestiaryDrop> {
    let mut out = Vec::new();
    let kind_str = kind.as_str();
    for entry in drops_for_kind(kind_str) {
        let def = entry.id.def();
        out.push(BestiaryDrop {
            id: entry.id.as_str().to_string(),
            label: def.label.to_string(),
            icon: def.icon.to_string(),
            color: def.color.to_string(),
            chance: entry.chance,
        });
    }
    out
}

/// Build the whole bestiary from the live tables + the run's kill tally.
pub fn build_bestiary(kills: &HashMap<String, usize>) -> Vec<BestiaryEntry> {
    KIND_IDS
        .iter()
        .map(|&kind| {
            let n = kills.get(kind.as_str()).copied().unwrap_or(0);
            let info = kind_info_for(kind);
            BestiaryEntry {
                kind,
                label: info.label.to_string(),
                icon: info.icon.to_string(),
                blurb: info.blurb.to_string(),
                kills: n,
                seen: n > 0,
                drops: drops_for(kind),
                cards: cards_for(kind),
                sub_types: Vec::new(),
                mechanics: vec![info.blurb.to_string()],
                milestone: family_milestone(n),
                ram_kills: kills.get(&format!("{}#ram", kind.as_str())).copied().unwrap_or(0),
                best_combo: kills.get(&format!("{}#combo", kind.as_str())).copied().unwrap_or(0),
            }
        })
        .collect()
}

/// How much of the bestiary the player has actually uncovered.
pub fn bestiary_progress(kills: &HashMap<String, usize>) -> (usize, usize) {
    let seen = KIND_IDS
        .iter()
        .filter(|k| kills.get(k.as_str()).copied().unwrap_or(0) > 0)
        .count();
    (seen, KIND_IDS.len())
}
