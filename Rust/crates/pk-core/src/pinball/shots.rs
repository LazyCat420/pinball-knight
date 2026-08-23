//! Pinball shot identity — orbits, rollover lanes, skill shots, and named combo chains.
//!
//! PORTS: `shots.ts`

use std::collections::HashSet;

pub const ORBIT_WINDOW: f64 = 3.5;
pub const ORBIT_GOLD: u32 = 50;
pub const ORBIT_LAP_BONUS: u32 = 100;
pub const LANE_CLEAR_GOLD: u32 = 150;
pub const SKILL_SHOT_WINDOW: f64 = 5.0;
pub const SKILL_SHOT_GOLD: u32 = 250;
pub const NAMED_CHAIN_MAX: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NamedCombo {
    pub name: &'static str,
    pub shots: &'static [&'static str],
    pub gold: u32,
}

pub const NAMED_COMBOS: &[NamedCombo] = &[
    NamedCombo {
        name: "TRIFECTA",
        shots: &["ramp", "orbit", "bank"],
        gold: 300,
    },
    NamedCombo {
        name: "RAMP_RUNNER",
        shots: &["ramp", "orbit"],
        gold: 150,
    },
    NamedCombo {
        name: "BUMPER_CAR",
        shots: &["bumper", "bumper", "bumper"],
        gold: 120,
    },
    NamedCombo {
        name: "TRICK_SHOT",
        shots: &["plunger", "target"],
        gold: 200,
    },
    NamedCombo {
        name: "SLING_KING",
        shots: &["slingshot", "slingshot", "orbit"],
        gold: 180,
    },
];

#[derive(Debug, Clone, PartialEq)]
pub struct ShotTracker {
    pub chain: Vec<String>,
    pub orbits_completed: u32,
    pub orbit_timer: f64,
    pub skill_shot_active: bool,
    pub skill_shot_timer: f64,
    pub paid_combos: HashSet<String>,
}

impl Default for ShotTracker {
    fn default() -> Self {
        Self {
            chain: Vec::with_capacity(NAMED_CHAIN_MAX),
            orbits_completed: 0,
            orbit_timer: 0.0,
            skill_shot_active: true,
            skill_shot_timer: SKILL_SHOT_WINDOW,
            paid_combos: HashSet::new(),
        }
    }
}

impl ShotTracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// Records a shot identity and returns the highest matching named combo completed (if unpaid on this floor).
    pub fn record_shot(&mut self, shot: &str) -> Option<(&'static str, u32)> {
        self.chain.push(shot.to_string());
        if self.chain.len() > NAMED_CHAIN_MAX {
            self.chain.remove(0);
        }

        // Check skill shot on direct target strike from initial launch
        if self.skill_shot_active && shot == "target" {
            self.skill_shot_active = false;
            return Some(("SKILL_SHOT", SKILL_SHOT_GOLD));
        }

        // Evaluate named combos (longest chain first)
        for combo in NAMED_COMBOS {
            let n = combo.shots.len();
            if self.chain.len() >= n {
                let tail = &self.chain[self.chain.len() - n..];
                if tail.iter().zip(combo.shots.iter()).all(|(a, b)| a == *b) {
                    if !self.paid_combos.contains(combo.name) {
                        self.paid_combos.insert(combo.name.to_string());
                        return Some((combo.name, combo.gold));
                    }
                }
            }
        }

        None
    }

    /// Ticks timers for skill shot window and orbit expiration.
    pub fn step(&mut self, dt: f64) {
        if self.skill_shot_active {
            self.skill_shot_timer -= dt;
            if self.skill_shot_timer <= 0.0 {
                self.skill_shot_active = false;
            }
        }

        if self.orbit_timer > 0.0 {
            self.orbit_timer -= dt;
            if self.orbit_timer <= 0.0 {
                self.orbits_completed = 0;
            }
        }
    }

    /// Increments completed orbit laps and resets the decay window.
    pub fn record_orbit_lap(&mut self) -> u32 {
        self.orbits_completed += 1;
        self.orbit_timer = ORBIT_WINDOW;
        ORBIT_GOLD + (self.orbits_completed - 1) * ORBIT_LAP_BONUS
    }
}
