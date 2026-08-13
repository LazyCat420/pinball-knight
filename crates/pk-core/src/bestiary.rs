//! BESTIARY — "which monster drops what", derived rather than authored.
//!
//! Derived from ENEMY_DROPS (reagents.ts) and ZOMBIE_TYPES (zombie-types.ts).
//!
//! PORTS: `bestiary.ts`

use crate::reagents::{drops_for_kind, ReagentDef, ReagentId};
use crate::zombie_types::{ZombieType, type_hp};

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

#[derive(Debug, Clone, PartialEq)]
pub struct BestiaryDropView {
    pub reagent: ReagentDef,
    pub chance: f64,
}

pub fn bestiary_drops_for(kind: &str) -> Vec<BestiaryDropView> {
    drops_for_kind(kind)
        .iter()
        .map(|d| BestiaryDropView {
            reagent: d.id.def(),
            chance: d.chance,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_monster_info_has_blurb_and_label() {
        for m in MONSTER_INFOS {
            assert!(!m.kind.is_empty());
            assert!(!m.label.is_empty());
            assert!(!m.icon.is_empty());
            assert!(!m.blurb.is_empty());
        }
    }
}
