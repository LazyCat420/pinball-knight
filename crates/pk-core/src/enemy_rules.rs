//! THE PER-KIND RULES — what each family does, in the one place both the game
//! and the bestiary read.
//!
//! PORTS: `entities/enemy-rules.ts`

use crate::combo::MOMENTUM_T_FLOOR;
use crate::enemies::{CRYSTAL_GATE_SOFT, GOBLIN_GATE_SOFT, GOLEM_GATE_SOFT, JESTER_GATE_SOFT};
use crate::movement::MovementKind;
use crate::pinball::SECRET_BREAK_SPEED;
use crate::stagger::EnemyKind;

pub const CARD_PINBALL_SPEED: f64 = 8.0;

/// WHICH WAY EACH FAMILY WALKS.
pub const fn movement_by_kind(kind: EnemyKind) -> MovementKind {
    match kind {
        EnemyKind::Zombie => MovementKind::Chase,
        EnemyKind::Spider => MovementKind::Flanker,
        EnemyKind::Brute => MovementKind::Chase,
        EnemyKind::Spitter => MovementKind::Kite,
        EnemyKind::Ghost => MovementKind::Phase,
        EnemyKind::Bat => MovementKind::Orbiter,
        EnemyKind::Slime => MovementKind::Chase,
        EnemyKind::Reaper => MovementKind::Phase,
        EnemyKind::Goblin => MovementKind::Chase,
        EnemyKind::Pin => MovementKind::Inert,
        EnemyKind::Golem => MovementKind::Rooted,
        EnemyKind::Chomper => MovementKind::Rooted,
        EnemyKind::Sporeling => MovementKind::Chase,
        EnemyKind::Jester => MovementKind::Kite,
        EnemyKind::Croaker => MovementKind::Kite,
        EnemyKind::Rotortail => MovementKind::Orbiter,
        EnemyKind::Stiltneck => MovementKind::Kite,
        EnemyKind::FishFeet => MovementKind::Chase,
        EnemyKind::Magnet => MovementKind::Chase,
        EnemyKind::Webspinner => MovementKind::Kite,
        EnemyKind::Hound => MovementKind::Leaper,
        EnemyKind::Bloater => MovementKind::Chase,
        EnemyKind::Necromancer => MovementKind::Kite,
        EnemyKind::Warden => MovementKind::Chase,
        EnemyKind::Wisp => MovementKind::Strafer,
        EnemyKind::Sapper => MovementKind::Ambusher,
        EnemyKind::Crystalback => MovementKind::Chase,
        EnemyKind::Mimic => MovementKind::Chase,
    }
}

/// One family's momentum rule.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MomentumGate {
    pub min_speed: f64,
    pub bar: f64,
    pub soft: f64,
    pub gates_damage: bool,
    pub text: &'static str,
}

pub const fn momentum_gate_for(kind: EnemyKind) -> Option<MomentumGate> {
    match kind {
        EnemyKind::Goblin => Some(MomentumGate {
            min_speed: 0.0,
            bar: MOMENTUM_T_FLOOR,
            soft: GOBLIN_GATE_SOFT,
            gates_damage: true,
            text: "Rubber: a standing poke does nothing at all. Anything carried on momentum lands, and lands harder the faster you arrive.",
        }),
        EnemyKind::Jester => Some(MomentumGate {
            min_speed: 0.0,
            bar: MOMENTUM_T_FLOOR,
            soft: JESTER_GATE_SOFT,
            gates_damage: true,
            text: "Spring-loaded: a standing swing is caught by the coil and THROWN BACK at you. Arrive with momentum and you compress it past its travel — then it lands, and lands harder the faster you came.",
        }),
        EnemyKind::Golem => Some(MomentumGate {
            min_speed: 0.0,
            bar: SECRET_BREAK_SPEED,
            soft: GOLEM_GATE_SOFT,
            gates_damage: true,
            text: "Masonry: below smash-speed (7 u/s) you only chip it — about a quarter of your damage. Above it, every extra unit of speed still pays.",
        }),
        EnemyKind::Chomper => Some(MomentumGate {
            min_speed: 0.0,
            bar: MOMENTUM_T_FLOOR,
            soft: 0.0,
            gates_damage: false,
            text: "Rooted in the chokepoint. Knockback scales with your speed to ×3 at terminal — a hard arrival SHOVES it off the road.",
        }),
        EnemyKind::Crystalback => Some(MomentumGate {
            min_speed: 0.0,
            bar: CARD_PINBALL_SPEED,
            soft: CRYSTAL_GATE_SOFT,
            gates_damage: false,
            text: "A reflector that taxes momentum: ramming it sprays shards back INTO you, and the spray scales with how fast you hit it. A graze throws one; a full ram throws the lot.",
        }),
        _ => None,
    }
}
