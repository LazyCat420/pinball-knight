//! STAGGER — Doom's pain chance, priced in momentum and paid without dice.
//!
//! PORTS: `entities/stagger.ts`

use crate::combo::momentum_t;
use crate::enemies::{ENTROPY_FULL, STAGGER_SPEED_FLOOR, STAGGER_TIME_MAX, STAGGER_TIME_MIN};
use crate::zombie_types::ZombieType;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum EnemyKind {
    Zombie,
    Spider,
    Brute,
    Spitter,
    Ghost,
    Bat,
    Slime,
    Reaper,
    Goblin,
    Sporeling,
    Jester,
    Croaker,
    Rotortail,
    Stiltneck,
    FishFeet,
    Pin,
    Golem,
    Chomper,
    Magnet,
    Webspinner,
    Hound,
    Bloater,
    Necromancer,
    Warden,
    Wisp,
    Sapper,
    Crystalback,
    Mimic,
}

impl EnemyKind {
    pub const ALL: [Self; 28] = [
        Self::Zombie,
        Self::Spider,
        Self::Brute,
        Self::Spitter,
        Self::Ghost,
        Self::Bat,
        Self::Slime,
        Self::Reaper,
        Self::Goblin,
        Self::Sporeling,
        Self::Jester,
        Self::Croaker,
        Self::Rotortail,
        Self::Stiltneck,
        Self::FishFeet,
        Self::Pin,
        Self::Golem,
        Self::Chomper,
        Self::Magnet,
        Self::Webspinner,
        Self::Hound,
        Self::Bloater,
        Self::Necromancer,
        Self::Warden,
        Self::Wisp,
        Self::Sapper,
        Self::Crystalback,
        Self::Mimic,
    ];

    pub const fn pain_base(self) -> f64 {
        match self {
            Self::Zombie => 0.78,
            Self::Spider => 0.7,
            Self::Brute => 0.2,
            Self::Spitter => 0.65,
            Self::Ghost => 0.3,
            Self::Bat => 0.85,
            Self::Slime => 0.55,
            Self::Reaper => 0.0,
            Self::Goblin => 0.6,
            Self::Sporeling => 0.5,
            Self::Jester => 0.7,
            Self::Croaker => 0.75,
            Self::Rotortail => 0.8,
            Self::Stiltneck => 0.9,
            Self::FishFeet => 0.65,
            Self::Pin => 0.0,
            Self::Golem => 0.05,
            Self::Chomper => 0.15,
            Self::Magnet => 0.55,
            Self::Webspinner => 0.65,
            Self::Hound => 0.45,
            Self::Bloater => 0.4,
            Self::Necromancer => 0.35,
            Self::Warden => 0.25,
            Self::Wisp => 0.7,
            Self::Sapper => 0.6,
            Self::Crystalback => 0.1,
            Self::Mimic => 0.35,
        }
    }
}

pub fn pain_base(kind: EnemyKind, is_boss: bool, ztype: Option<ZombieType>) -> f64 {
    if is_boss {
        return 0.0;
    }
    let fam = kind.pain_base();
    let mult = match ztype {
        Some(t) => t.def().pain_mult,
        None => 1.0,
    };

    fam * mult
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct EntropyHolder {
    pub pain_entropy: f64,
    pub dodge_entropy: f64,
}

pub fn pain_chance(base: f64, impact_speed: f64) -> f64 {
    if base <= 0.0 {
        return 0.0;
    }
    let t = momentum_t(impact_speed);
    (base * (STAGGER_SPEED_FLOOR + (1.0 - STAGGER_SPEED_FLOOR) * t)).clamp(0.0, 1.0)
}

pub fn stagger_time(impact_speed: f64) -> f64 {
    STAGGER_TIME_MIN + (STAGGER_TIME_MAX - STAGGER_TIME_MIN) * momentum_t(impact_speed)
}

pub fn accrue_pain(holder: &mut EntropyHolder, chance: f64) -> bool {
    if chance <= 0.0 {
        return false;
    }
    let e = holder.pain_entropy + chance * ENTROPY_FULL;
    if e >= ENTROPY_FULL {
        holder.pain_entropy = (e - ENTROPY_FULL).min(ENTROPY_FULL - 1e-9);
        true
    } else {
        holder.pain_entropy = e;
        false
    }
}

pub fn accrue_dodge(holder: &mut EntropyHolder, chance: f64) -> bool {
    if chance <= 0.0 {
        return false;
    }
    let e = holder.dodge_entropy + chance * ENTROPY_FULL;
    if e >= ENTROPY_FULL {
        holder.dodge_entropy = (e - ENTROPY_FULL).min(ENTROPY_FULL - 1e-9);
        true
    } else {
        holder.dodge_entropy = e;
        false
    }
}
