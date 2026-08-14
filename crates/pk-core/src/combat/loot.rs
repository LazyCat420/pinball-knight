//! Loot rewards, gold multipliers, and corpse decay.
//!
//! PORTS: `entities/combat.ts`, `constants/enemies.ts`

use crate::combo::combo_kill_gold;
use crate::enemies::CORPSE_BUDGET;

pub const GOLD_PER_KILL: i64 = 1;
pub const ULT_CHARGE_PER_KILL: f64 = 0.05;
pub const MANA_PER_KILL: f64 = 1.0;

#[derive(Debug, Clone, PartialEq)]
pub struct Corpse {
    pub id: u32,
    pub x: f64,
    pub z: f64,
    pub facing: u8,
    pub kind_index: usize,
    pub decay_t: f64,
}

#[derive(Debug, Clone, Default)]
pub struct CorpseManager {
    pub corpses: Vec<Corpse>,
}

impl CorpseManager {
    pub fn add_corpse(&mut self, id: u32, x: f64, z: f64, facing: u8, kind_index: usize) {
        if self.corpses.len() >= CORPSE_BUDGET as usize {
            self.corpses.remove(0); // Evict oldest corpse
        }
        self.corpses.push(Corpse {
            id,
            x,
            z,
            facing,
            kind_index,
            decay_t: 12.0,
        });
    }

    pub fn step(&mut self, dt: f64) {
        for c in self.corpses.iter_mut() {
            c.decay_t = (c.decay_t - dt).max(0.0);
        }
        self.corpses.retain(|c| c.decay_t > 0.0);
    }
}

pub fn calculate_kill_reward(combo_count: f64) -> (i64, f64, f64) {
    let gold = i64::from(combo_kill_gold(combo_count));
    (gold, ULT_CHARGE_PER_KILL, MANA_PER_KILL)
}
