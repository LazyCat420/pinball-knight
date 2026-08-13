//! ACTIVE SKILLS — the abilities the Diablo HUD hangs off.
//!
//! PORTS: `abilities.ts`

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum AbilityId {
    Flippercharge,
    Arcanepulse,
    Magnetaura,
    Timecrawl,
    Bladestorm,
    Slickfield,
}

impl AbilityId {
    pub const ALL: [Self; 6] = [
        Self::Flippercharge,
        Self::Arcanepulse,
        Self::Magnetaura,
        Self::Timecrawl,
        Self::Bladestorm,
        Self::Slickfield,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Flippercharge => "flippercharge",
            Self::Arcanepulse => "arcanepulse",
            Self::Magnetaura => "magnetaura",
            Self::Timecrawl => "timecrawl",
            Self::Bladestorm => "bladestorm",
            Self::Slickfield => "slickfield",
        }
    }

    pub fn from_str_id(s: &str) -> Option<Self> {
        match s {
            "flippercharge" => Some(Self::Flippercharge),
            "arcanepulse" => Some(Self::Arcanepulse),
            "magnetaura" => Some(Self::Magnetaura),
            "timecrawl" => Some(Self::Timecrawl),
            "bladestorm" => Some(Self::Bladestorm),
            "slickfield" => Some(Self::Slickfield),
            _ => None,
        }
    }

    pub const fn def(self) -> AbilityDef {
        match self {
            Self::Flippercharge => AbilityDef {
                id: Self::Flippercharge,
                label: "Flipper Charge",
                icon: "🏓",
                cost: 20,
                cooldown: 3.5,
                color: "#f0a63c",
                detail: "Launch forward like a flipper",
            },
            Self::Arcanepulse => AbilityDef {
                id: Self::Arcanepulse,
                label: "Arcane Pulse",
                icon: "✷",
                cost: 35,
                cooldown: 5.0,
                color: "#b06fe8",
                detail: "360° arcane damage burst",
            },
            Self::Magnetaura => AbilityDef {
                id: Self::Magnetaura,
                label: "Magnet Aura",
                icon: "🧲",
                cost: 25,
                cooldown: 7.0,
                color: "#6fd0e8",
                detail: "Pull nearby loot for 4s",
            },
            Self::Timecrawl => AbilityDef {
                id: Self::Timecrawl,
                label: "Time Crawl",
                icon: "⏳",
                cost: 50,
                cooldown: 11.0,
                color: "#bfe8ff",
                detail: "Slow the horde for 3s",
            },
            Self::Bladestorm => AbilityDef {
                id: Self::Bladestorm,
                label: "Blade Storm",
                icon: "🌪️",
                cost: 40,
                cooldown: 9.0,
                color: "#c8ccd4",
                detail: "Orbiting blades for 5s",
            },
            Self::Slickfield => AbilityDef {
                id: Self::Slickfield,
                label: "Slick Field",
                icon: "🛢️",
                cost: 25,
                cooldown: 8.0,
                color: "#8a5fd0",
                detail: "Spill oil — foes skid, the ball glides, fire ignites it",
            },
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AbilityDef {
    pub id: AbilityId,
    pub label: &'static str,
    pub icon: &'static str,
    pub cost: i32,
    pub cooldown: f64,
    pub color: &'static str,
    pub detail: &'static str,
}

pub const ABILITY_RANK_MAX: u32 = 5;
pub const ABILITY_RANK_STEP: f64 = 0.15;

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct AbilitySlotState {
    pub id: Option<AbilityId>,
    pub cooldown_t: f64,
    pub rank: u32,
}

impl AbilitySlotState {
    pub fn is_ready(&self) -> bool {
        self.id.is_some() && self.cooldown_t <= 0.0
    }

    pub fn tick(&mut self, dt: f64) {
        if self.cooldown_t > 0.0 {
            self.cooldown_t = (self.cooldown_t - dt).max(0.0);
        }
    }

    pub fn trigger(&mut self) -> bool {
        if let Some(id) = self.id {
            if self.cooldown_t <= 0.0 {
                let def = id.def();
                self.cooldown_t = def.cooldown;
                return true;
            }
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_abilities_have_positive_cost_and_cooldown() {
        for id in AbilityId::ALL {
            let def = id.def();
            assert!(def.cost > 0);
            assert!(def.cooldown > 0.0);
            assert!(!def.label.is_empty());
        }
    }

    #[test]
    fn ability_slot_state_cooldown_ticks_down() {
        let mut slot = AbilitySlotState {
            id: Some(AbilityId::Flippercharge),
            cooldown_t: 3.5,
            rank: 1,
        };
        assert!(!slot.is_ready());
        slot.tick(3.5);
        assert!(slot.is_ready());
    }
}
