//! MONSTER LAB — Developer harness for testing monster spawns, animations, and stats without level gating.
//!
//! PORTS: `dev/monster-lab.ts`

use crate::bestiary::MONSTER_INFOS;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MonsterLabState {
    pub spawn_history: Vec<(String, u32)>,
    pub active_floor: u32,
}

impl MonsterLabState {
    pub fn new() -> Self {
        Self {
            spawn_history: Vec::new(),
            active_floor: 1,
        }
    }

    /// Full monster roster available for spawning.
    pub fn roster(&self) -> Vec<&'static str> {
        MONSTER_INFOS.iter().map(|m| m.kind).collect()
    }

    pub fn is_valid_kind(&self, kind: &str) -> bool {
        MONSTER_INFOS.iter().any(|m| m.kind == kind)
    }

    /// Spawns `count` instances of `kind`, bypassing floor gating.
    pub fn spawn(&mut self, kind: &str, count: u32) -> Result<usize, String> {
        if !self.is_valid_kind(kind) {
            return Err(format!("Unknown monster kind: {}", kind));
        }
        let n = count.max(1);
        self.spawn_history.push((kind.to_string(), n));
        Ok(n as usize)
    }

    /// Clears existing enemies, then spawns 3 of the requested kind (art-QA pose).
    pub fn only(&mut self, kind: &str) -> Result<usize, String> {
        if !self.is_valid_kind(kind) {
            return Err(format!("Unknown monster kind: {}", kind));
        }
        self.spawn_history.clear();
        self.spawn_history.push((kind.to_string(), 3));
        Ok(3)
    }

    /// Spawns ONE of every roster kind in a ring around the player.
    pub fn ring(&mut self) -> Vec<String> {
        self.spawn_history.clear();
        let mut spawned = Vec::new();
        for m in MONSTER_INFOS {
            self.spawn_history.push((m.kind.to_string(), 1));
            spawned.push(m.kind.to_string());
        }
        spawned
    }

    pub fn jump_floor(&mut self, level: u32) {
        self.active_floor = level.max(1);
    }

    pub fn clear(&mut self) {
        self.spawn_history.clear();
    }
}
