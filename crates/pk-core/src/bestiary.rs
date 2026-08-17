//! BESTIARY — "which monster drops what", derived rather than authored.
//!
//! Port of `legacy/src/game/pinball-knight/bestiary.ts` (380 lines).
//!
//! Handles:
//! - Complete monster family definitions, display labels, icons, blurbs
//! - Derived loot drop tables from reagent registries and card affinity mappings
//! - Milestone unlock tiers (Seen, Hunter, Master) based on player kill counts
//! - Bestiary entry compilation and completion progress tracking
//!
//! PORTS: `bestiary.ts`

use std::collections::HashMap;
use crate::cards::{CARDS, CardRarity, EnemyKind};
use crate::reagents::drops_for_kind;

pub const BESTIARY_AFFINITY_STEP: f64 = 0.05;
pub const BESTIARY_AFFINITY_MAX: f64 = 0.25;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MonsterInfo {
    pub kind: &'static str,
    pub label: &'static str,
    pub icon: &'static str,
    pub blurb: &'static str,
}

pub const KIND_INFO: &[(&str, MonsterInfo)] = &[
    ("zombie", MonsterInfo { kind: "zombie", label: "Zombie", icon: "🧟", blurb: "shambles in a drag-limp, aggressive sprint, red claw slash attacks, and blood-splatter collapse" }),
    ("spider", MonsterInfo { kind: "spider", label: "Spider", icon: "🕷️", blurb: "fast and fragile; spins the silk everything else needs" }),
    ("brute", MonsterInfo { kind: "brute", label: "Brute", icon: "🦍", blurb: "thick hide, heavy swing, enrages when hurt" }),
    ("spitter", MonsterInfo { kind: "spitter", label: "Spitter", icon: "🤮", blurb: "kites you and lobs acid from range" }),
    ("ghost", MonsterInfo { kind: "ghost", label: "Ghost", icon: "👻", blurb: "drifts through walls; untouchable until it strikes" }),
    ("bat", MonsterInfo { kind: "bat", label: "Bat", icon: "🦇", blurb: "wobbles in on a drunken line — hard to swat" }),
    ("slime", MonsterInfo { kind: "slime", label: "Slime", icon: "🟢", blurb: "splits into two fast minis when killed" }),
    ("sporeling", MonsterInfo { kind: "sporeling", label: "Sporeling", icon: "🍄", blurb: "a walking fruiting body; it bursts a spore cloud when it dies" }),
    ("jester", MonsterInfo { kind: "jester", label: "Jester", icon: "🤡", blurb: "fires the plate off its head — and the plate ricochets" }),
    ("croaker", MonsterInfo { kind: "croaker", label: "Croaker", icon: "🐸", blurb: "twin eye-beams; hops knee-high walls and bounces its leap off the rest" }),
    ("rotortail", MonsterInfo { kind: "rotortail", label: "Rotortail", icon: "🪵", blurb: "circles overhead and drops timber; a solid hit stalls its rotor" }),
    ("stiltneck", MonsterInfo { kind: "stiltneck", label: "Stiltneck", icon: "💣", blurb: "slings a lit bomb from nine tiles out — the blast catches its own horde too" }),
    ("fish_feet", MonsterInfo { kind: "fish_feet", label: "Fish Feet", icon: "👟", blurb: "a smoking fish walking on white Converse sneakers that delivers heavy kick strikes" }),
    ("reaper", MonsterInfo { kind: "reaper", label: "Death Dealer", icon: "☠️", blurb: "cannot be hurt. It only ever gets faster" }),
    ("goblin", MonsterInfo { kind: "goblin", label: "Goblin", icon: "👺", blurb: "kicks you off your line; shrugs off a standing poke" }),
    ("pin", MonsterInfo { kind: "pin", label: "Bowling Pin", icon: "🎳", blurb: "does not fight. It scores — and it chains" }),
    ("golem", MonsterInfo { kind: "golem", label: "Brick Golem", icon: "🗿", blurb: "rooted furniture with teeth; needs smash-speed" }),
    ("chomper", MonsterInfo { kind: "chomper", label: "Chomper", icon: "🪤", blurb: "rooted jaws holding a chokepoint" }),
    ("magnet", MonsterInfo { kind: "magnet", label: "Magnet Crawler", icon: "🧲", blurb: "drags your momentum off its line" }),
    ("webspinner", MonsterInfo { kind: "webspinner", label: "Webspinner", icon: "🕸️", blurb: "webs you at range and slows the ride" }),
    ("hound", MonsterInfo { kind: "hound", label: "Hound", icon: "🐺", blurb: "locks a dash and charges the gap" }),
    ("bloater", MonsterInfo { kind: "bloater", label: "Bloater", icon: "🫧", blurb: "bursts into a burning puddle — don't melee it close" }),
    ("necromancer", MonsterInfo { kind: "necromancer", label: "Necromancer", icon: "🕯️", blurb: "raises adds faster than you can clear them" }),
    ("warden", MonsterInfo { kind: "warden", label: "Warden", icon: "🛡️", blurb: "shields everything around it in a pulse" }),
    ("wisp", MonsterInfo { kind: "wisp", label: "Wisp", icon: "✨", blurb: "blinks out of your swing and crackles back" }),
    ("sapper", MonsterInfo { kind: "sapper", label: "Sapper", icon: "🧨", blurb: "plants powder kegs on your best lines" }),
    ("crystalback", MonsterInfo { kind: "crystalback", label: "Crystalback", icon: "💎", blurb: "reflects front hits; get around behind it" }),
    ("mimic", MonsterInfo { kind: "mimic", label: "Mimic", icon: "📦", blurb: "looks like a chest until you reach for it" }),
];

pub const MONSTER_INFOS: &[MonsterInfo] = &[
    MonsterInfo { kind: "zombie", label: "Zombie", icon: "🧟", blurb: "shambles in a drag-limp, aggressive sprint, red claw slash attacks, and blood-splatter collapse" },
    MonsterInfo { kind: "spider", label: "Spider", icon: "🕷️", blurb: "fast and fragile; spins the silk everything else needs" },
    MonsterInfo { kind: "brute", label: "Brute", icon: "🦍", blurb: "thick hide, heavy swing, enrages when hurt" },
    MonsterInfo { kind: "spitter", label: "Spitter", icon: "🤮", blurb: "kites you and lobs acid from range" },
    MonsterInfo { kind: "ghost", label: "Ghost", icon: "👻", blurb: "drifts through walls; untouchable until it strikes" },
    MonsterInfo { kind: "bat", label: "Bat", icon: "🦇", blurb: "wobbles in on a drunken line — hard to swat" },
    MonsterInfo { kind: "slime", label: "Slime", icon: "🟢", blurb: "splits into two fast minis when killed" },
    MonsterInfo { kind: "sporeling", label: "Sporeling", icon: "🍄", blurb: "a walking fruiting body; it bursts a spore cloud when it dies" },
    MonsterInfo { kind: "jester", label: "Jester", icon: "🤡", blurb: "fires the plate off its head — and the plate ricochets" },
    MonsterInfo { kind: "croaker", label: "Croaker", icon: "🐸", blurb: "twin eye-beams; hops knee-high walls and bounces its leap off the rest" },
    MonsterInfo { kind: "rotortail", label: "Rotortail", icon: "🪵", blurb: "circles overhead and drops timber; a solid hit stalls its rotor" },
    MonsterInfo { kind: "stiltneck", label: "Stiltneck", icon: "💣", blurb: "slings a lit bomb from nine tiles out — the blast catches its own horde too" },
    MonsterInfo { kind: "fish_feet", label: "Fish Feet", icon: "👟", blurb: "a smoking fish walking on white Converse sneakers that delivers heavy kick strikes" },
    MonsterInfo { kind: "reaper", label: "Death Dealer", icon: "☠️", blurb: "cannot be hurt. It only ever gets faster" },
    MonsterInfo { kind: "goblin", label: "Goblin", icon: "👺", blurb: "kicks you off your line; shrugs off a standing poke" },
    MonsterInfo { kind: "pin", label: "Bowling Pin", icon: "🎳", blurb: "does not fight. It scores — and it chains" },
    MonsterInfo { kind: "golem", label: "Brick Golem", icon: "🗿", blurb: "rooted furniture with teeth; needs smash-speed" },
    MonsterInfo { kind: "chomper", label: "Chomper", icon: "🪤", blurb: "rooted jaws holding a chokepoint" },
    MonsterInfo { kind: "magnet", label: "Magnet Crawler", icon: "🧲", blurb: "drags your momentum off its line" },
    MonsterInfo { kind: "webspinner", label: "Webspinner", icon: "🕸️", blurb: "webs you at range and slows the ride" },
    MonsterInfo { kind: "hound", label: "Hound", icon: "🐺", blurb: "locks a dash and charges the gap" },
    MonsterInfo { kind: "bloater", label: "Bloater", icon: "🫧", blurb: "bursts into a burning puddle — don't melee it close" },
    MonsterInfo { kind: "necromancer", label: "Necromancer", icon: "🕯️", blurb: "raises adds faster than you can clear them" },
    MonsterInfo { kind: "warden", label: "Warden", icon: "🛡️", blurb: "shields everything around it in a pulse" },
    MonsterInfo { kind: "wisp", label: "Wisp", icon: "✨", blurb: "blinks out of your swing and crackles back" },
    MonsterInfo { kind: "sapper", label: "Sapper", icon: "🧨", blurb: "plants powder kegs on your best lines" },
    MonsterInfo { kind: "crystalback", label: "Crystalback", icon: "💎", blurb: "reflects front hits; get around behind it" },
    MonsterInfo { kind: "mimic", label: "Mimic", icon: "📦", blurb: "looks like a chest until you reach for it" },
];

pub const KIND_IDS: &[&str] = &[
    "zombie", "spider", "brute", "spitter", "ghost", "bat", "slime",
    "sporeling", "jester", "croaker", "rotortail", "stiltneck", "fish_feet",
    "reaper", "goblin", "pin", "golem", "chomper", "magnet", "webspinner",
    "hound", "bloater", "necromancer", "warden", "wisp", "sapper",
    "crystalback", "mimic",
];

#[derive(Clone, Debug, PartialEq)]
pub struct BestiaryDrop {
    pub id: &'static str,
    pub label: &'static str,
    pub icon: &'static str,
    pub weight: u32,
    pub rarity: &'static str,
}

#[derive(Clone, Debug, PartialEq)]
pub struct BestiaryCard {
    pub id: &'static str,
    pub title: &'static str,
    pub rarity: CardRarity,
    pub text: &'static str,
}

#[derive(Clone, Debug, PartialEq)]
pub struct BestiarySubType {
    pub id: &'static str,
    pub label: &'static str,
    pub hp: i32,
    pub speed_factor: f64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BestiaryMilestone {
    pub tier: usize,
    pub name: &'static str,
    pub required_kills: u32,
    pub next_required_kills: Option<u32>,
}

pub fn family_milestone(kills: u32) -> BestiaryMilestone {
    if kills >= 50 {
        BestiaryMilestone {
            tier: 3,
            name: "Master",
            required_kills: 50,
            next_required_kills: None,
        }
    } else if kills >= 10 {
        BestiaryMilestone {
            tier: 2,
            name: "Hunter",
            required_kills: 10,
            next_required_kills: Some(50),
        }
    } else if kills >= 1 {
        BestiaryMilestone {
            tier: 1,
            name: "Seen",
            required_kills: 1,
            next_required_kills: Some(10),
        }
    } else {
        BestiaryMilestone {
            tier: 0,
            name: "Unknown",
            required_kills: 0,
            next_required_kills: Some(1),
        }
    }
}

pub fn family_affinity(kills: u32) -> f64 {
    let steps = (kills / 10).min(5);
    (steps as f64 * BESTIARY_AFFINITY_STEP).min(BESTIARY_AFFINITY_MAX)
}

#[derive(Clone, Debug, PartialEq)]
pub struct BestiaryEntry {
    pub kind: &'static str,
    pub label: &'static str,
    pub icon: &'static str,
    pub blurb: &'static str,
    pub kills: u32,
    pub revealed: bool,
    pub milestone: BestiaryMilestone,
    pub drops: Vec<BestiaryDrop>,
    pub cards: Vec<BestiaryCard>,
    pub sub_types: Vec<BestiarySubType>,
}

fn parse_card_enemy_kind(s: &str) -> Option<EnemyKind> {
    match s {
        "zombie" => Some(EnemyKind::Zombie),
        "bat" => Some(EnemyKind::Bat),
        "spider" => Some(EnemyKind::Spider),
        "goblin" => Some(EnemyKind::Goblin),
        "spitter" => Some(EnemyKind::Spitter),
        "wisp" => Some(EnemyKind::Wisp),
        "ghost" => Some(EnemyKind::Ghost),
        "crystalback" => Some(EnemyKind::Crystalback),
        "webspinner" => Some(EnemyKind::Webspinner),
        "reaper" => Some(EnemyKind::Reaper),
        "necromancer" => Some(EnemyKind::Necromancer),
        "golem" => Some(EnemyKind::Golem),
        "brute" => Some(EnemyKind::Brute),
        _ => None,
    }
}

pub fn build_bestiary(kills_map: &HashMap<String, u32>) -> Vec<BestiaryEntry> {
    KIND_INFO
        .iter()
        .map(|&(kind, info)| {
            let kills = kills_map.get(kind).copied().unwrap_or(0);
            let milestone = family_milestone(kills);
            let revealed = kills > 0;

            let mut drops = Vec::new();
            let drop_entries = drops_for_kind(kind);
            for d in drop_entries {
                let rdef = d.id.def();
                drops.push(BestiaryDrop {
                    id: rdef.id.as_str(),
                    label: rdef.label,
                    icon: rdef.icon,
                    weight: (d.chance * 100.0) as u32,
                    rarity: rdef.tier.hex(),
                });
            }

            let mut cards = Vec::new();
            let card_kind = parse_card_enemy_kind(kind);
            for c in CARDS.iter() {
                if card_kind.is_some() && c.source == card_kind {
                    cards.push(BestiaryCard {
                        id: c.id,
                        title: c.label,
                        rarity: c.rarity,
                        text: c.description,
                    });
                }
            }

            BestiaryEntry {
                kind,
                label: info.label,
                icon: info.icon,
                blurb: info.blurb,
                kills,
                revealed,
                milestone,
                drops,
                cards,
                sub_types: Vec::new(),
            }
        })
        .collect()
}

pub fn bestiary_progress(kills_map: &HashMap<String, u32>) -> (usize, usize) {
    let total = KIND_INFO.len();
    let seen = KIND_INFO
        .iter()
        .filter(|&&(kind, _)| kills_map.get(kind).copied().unwrap_or(0) > 0)
        .count();
    (seen, total)
}
