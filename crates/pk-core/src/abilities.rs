//! ACTIVE SKILLS — the abilities the Diablo HUD hangs off.
//!
//! Port of `legacy/src/game/pinball-knight/abilities.ts` (916 lines).
//!
//! These spend MANA, a pool kept separate from rampage meter.
//! Each skill leans on core machinery:
//! - Flipper Charge injects pinball momentum & turbo
//! - Time Crawl scales horde dt & lays frost runes
//! - Magnet Aura drifts items in
//! - Blade Storm orbits shredding blades
//! - Arcane Pulse expands shockwave with forked lightning crowns
//! - Slick Field lays oil & congeals tar core
//!
//! PORTS: `abilities.ts`, `skills.ts`, `constants/skills.ts`

use crate::marble::PINBALL_MAX_SPEED;
use crate::state::Player;

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

pub const ABILITY_IDS: [AbilityId; 6] = AbilityId::ALL;

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
pub const ABILITY_RANK_RULE: u32 = 2;

pub const MANA_REGEN: f64 = 5.0;
pub const MANA_PER_BOUNCE: f64 = 1.2;
pub const MANA_BOUNCE_MOMENTUM: f64 = 0.4;
pub const DYNAMO_BOUNCE_MULT: f64 = 2.5;
pub const BLOOD_PRICE_HP: f64 = 25.0;

pub const ARCANE_PULSE_RADIUS: f64 = 3.5;
pub const ARCANE_PULSE_DAMAGE: f64 = 40.0;
pub const PULSE_WAVE_DUR: f64 = 0.35;
pub const FLIPPER_LAUNCH_SPEED: f64 = 18.0;
pub const FLIPPER_TRAIL_T: f64 = 1.2;
pub const BLADESTORM_RADIUS: f64 = 2.4;
pub const BLADESTORM_DAMAGE: f64 = 15.0;
pub const BLADESTORM_TICK: f64 = 0.25;
pub const OIL_SLICK_RADIUS: f64 = 2.2;
pub const OIL_SLICK_LIFE: f64 = 6.0;
pub const TAR_PIT_RADIUS: f64 = 1.2;
pub const TAR_PIT_LIFE: f64 = 6.0;
pub const LIGHTNING_ROD_RADIUS: f64 = 2.0;
pub const LIGHTNING_ROD_LIFE: f64 = 5.0;
pub const FROST_RUNE_RADIUS: f64 = 0.8;
pub const FROST_RUNE_LIFE: f64 = 4.0;
pub const FROST_RUNE_COUNT: i32 = 6;
pub const FROST_RUNE_RING: f64 = 2.8;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CastAnimTiming {
    pub windup: f64,
    pub recover: f64,
    pub gather: f64,
    pub flash: f64,
    pub shake: f64,
    pub hitstop: f64,
}

pub fn get_cast_anim(id: AbilityId) -> CastAnimTiming {
    match id {
        AbilityId::Flippercharge => CastAnimTiming {
            windup: 0.08,
            recover: 0.12,
            gather: 1.2,
            flash: 0.1,
            shake: 0.25,
            hitstop: 0.04,
        },
        AbilityId::Arcanepulse => CastAnimTiming {
            windup: 0.22,
            recover: 0.18,
            gather: 2.2,
            flash: 0.2,
            shake: 0.35,
            hitstop: 0.06,
        },
        AbilityId::Magnetaura => CastAnimTiming {
            windup: 0.15,
            recover: 0.15,
            gather: 1.8,
            flash: 0.05,
            shake: 0.1,
            hitstop: 0.0,
        },
        AbilityId::Timecrawl => CastAnimTiming {
            windup: 0.25,
            recover: 0.20,
            gather: 2.5,
            flash: 0.3,
            shake: 0.2,
            hitstop: 0.08,
        },
        AbilityId::Bladestorm => CastAnimTiming {
            windup: 0.18,
            recover: 0.15,
            gather: 1.6,
            flash: 0.15,
            shake: 0.3,
            hitstop: 0.05,
        },
        AbilityId::Slickfield => CastAnimTiming {
            windup: 0.12,
            recover: 0.14,
            gather: 1.4,
            flash: 0.08,
            shake: 0.15,
            hitstop: 0.02,
        },
    }
}

pub fn ability_rank(ranks: &[u32; 6], id: AbilityId) -> u32 {
    ranks[id as usize].min(ABILITY_RANK_MAX)
}

pub fn ability_rank_cost(rank: u32) -> u32 {
    rank + 1
}

pub fn ability_power(rank: u32, mom_speed: f64, momentum_ability_power: f64) -> f64 {
    let momentum_t = (mom_speed / PINBALL_MAX_SPEED).clamp(0.0, 1.0);
    1.0 + ABILITY_RANK_STEP * (rank as f64) + momentum_ability_power * momentum_t
}

#[derive(Debug, Clone, PartialEq)]
pub struct PulseWaveState {
    pub x: f64,
    pub z: f64,
    pub t: f64,
    pub r: f64,
    pub dmg: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct InFlightCast {
    pub id: AbilityId,
    pub t: f64,
    pub windup: f64,
    pub recover: f64,
    pub x: f64,
    pub z: f64,
    pub power: f64,
    pub fired: bool,
}

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

#[derive(Debug, Clone, PartialEq)]
pub struct PlayerAbilities {
    pub slot_1: AbilitySlotState,
    pub slot_2: AbilitySlotState,
    pub ranks: [u32; 6],
    pub casts: Vec<InFlightCast>,
    pub pulse_waves: Vec<PulseWaveState>,
    pub time_crawl_t: f64,
    pub magnet_aura_t: f64,
    pub blade_storm_t: f64,
    pub blade_storm_tick_t: f64,
    pub last_combo: i32,
}

impl PlayerAbilities {
    pub fn tick(&mut self, dt: f64) {
        self.slot_1.tick(dt);
        self.slot_2.tick(dt);
        if self.time_crawl_t > 0.0 {
            self.time_crawl_t = (self.time_crawl_t - dt).max(0.0);
        }
        if self.magnet_aura_t > 0.0 {
            self.magnet_aura_t = (self.magnet_aura_t - dt).max(0.0);
        }
        if self.blade_storm_t > 0.0 {
            self.blade_storm_t = (self.blade_storm_t - dt).max(0.0);
        }
    }
}

impl Default for PlayerAbilities {
    fn default() -> Self {
        Self {
            slot_1: AbilitySlotState {
                id: Some(AbilityId::Flippercharge),
                cooldown_t: 0.0,
                rank: 1,
            },
            slot_2: AbilitySlotState {
                id: Some(AbilityId::Arcanepulse),
                cooldown_t: 0.0,
                rank: 1,
            },
            ranks: [1, 1, 0, 0, 0, 0],
            casts: Vec::new(),
            pulse_waves: Vec::new(),
            time_crawl_t: 0.0,
            magnet_aura_t: 0.0,
            blade_storm_t: 0.0,
            blade_storm_tick_t: 0.0,
            last_combo: 0,
        }
    }
}

pub fn get_mana(player: &Player, max_mana: f64) -> f64 {
    player.mana.clamp(0.0, max_mana)
}

pub fn affordable(id: AbilityId, mana: f64, player_hp: f64, blood_price: bool) -> bool {
    let def = id.def();
    if mana >= def.cost as f64 {
        true
    } else {
        blood_price && player_hp > BLOOD_PRICE_HP
    }
}

pub fn can_cast(
    slot: usize,
    abilities: &PlayerAbilities,
    mana: f64,
    player_hp: f64,
    blood_price: bool,
) -> bool {
    let slot_state = match slot {
        0 => &abilities.slot_1,
        1 => &abilities.slot_2,
        _ => return false,
    };
    if let Some(id) = slot_state.id {
        slot_state.cooldown_t <= 0.0 && affordable(id, mana, player_hp, blood_price)
    } else {
        false
    }
}

pub fn casts_in_flight(abilities: &PlayerAbilities) -> usize {
    abilities.casts.len()
}

pub fn reset_ability_scratch(abilities: &mut PlayerAbilities) {
    abilities.casts.clear();
    abilities.pulse_waves.clear();
    abilities.last_combo = 0;
}

pub fn cast_ability(
    slot: usize,
    abilities: &mut PlayerAbilities,
    player: &mut Player,
    blood_price: bool,
    cooldown_mult: f64,
) -> bool {
    let (id, rank) = match slot {
        0 => {
            if let Some(id) = abilities.slot_1.id {
                (id, abilities.slot_1.rank)
            } else {
                return false;
            }
        }
        1 => {
            if let Some(id) = abilities.slot_2.id {
                (id, abilities.slot_2.rank)
            } else {
                return false;
            }
        }
        _ => return false,
    };

    let cd = match slot {
        0 => abilities.slot_1.cooldown_t,
        1 => abilities.slot_2.cooldown_t,
        _ => 1.0,
    };

    if cd > 0.0 || !affordable(id, player.mana, player.hp, blood_price) {
        return false;
    }

    let def = id.def();
    if player.mana < def.cost as f64 {
        player.hp = (player.hp - BLOOD_PRICE_HP).max(1.0);
    }
    player.mana = (player.mana - def.cost as f64).max(0.0);

    let effective_cd = def.cooldown * cooldown_mult;
    match slot {
        0 => abilities.slot_1.cooldown_t = effective_cd,
        1 => abilities.slot_2.cooldown_t = effective_cd,
        _ => {}
    }

    let anim = get_cast_anim(id);
    let power = ability_power(rank, player.mom_speed, 0.0);
    abilities.casts.push(InFlightCast {
        id,
        t: 0.0,
        windup: anim.windup,
        recover: anim.recover,
        x: player.x,
        z: player.z,
        power,
        fired: false,
    });

    true
}

pub fn tick_abilities(
    abilities: &mut PlayerAbilities,
    player: &mut Player,
    max_mana: f64,
    dt: f64,
) {
    abilities.slot_1.tick(dt);
    abilities.slot_2.tick(dt);

    if player.mana < max_mana {
        player.mana = (player.mana + MANA_REGEN * dt).min(max_mana);
    }

    if abilities.time_crawl_t > 0.0 {
        abilities.time_crawl_t = (abilities.time_crawl_t - dt).max(0.0);
    }
    if abilities.magnet_aura_t > 0.0 {
        abilities.magnet_aura_t = (abilities.magnet_aura_t - dt).max(0.0);
    }
    if abilities.blade_storm_t > 0.0 {
        abilities.blade_storm_t = (abilities.blade_storm_t - dt).max(0.0);
    }

    // Tick casts in flight
    for cast in &mut abilities.casts {
        cast.t += dt;
        if !cast.fired && cast.t >= cast.windup {
            cast.fired = true;
            match cast.id {
                AbilityId::Flippercharge => {
                    player.mom_speed = (player.mom_speed + FLIPPER_LAUNCH_SPEED * cast.power)
                        .min(PINBALL_MAX_SPEED);
                }
                AbilityId::Arcanepulse => {
                    abilities.pulse_waves.push(PulseWaveState {
                        x: cast.x,
                        z: cast.z,
                        t: 0.0,
                        r: ARCANE_PULSE_RADIUS * cast.power,
                        dmg: ARCANE_PULSE_DAMAGE * cast.power,
                    });
                }
                AbilityId::Magnetaura => {
                    abilities.magnet_aura_t = 4.0 * cast.power;
                }
                AbilityId::Timecrawl => {
                    abilities.time_crawl_t = 3.0 * cast.power;
                }
                AbilityId::Bladestorm => {
                    abilities.blade_storm_t = 5.0 * cast.power;
                }
                AbilityId::Slickfield => {}
            }
        }
    }
    abilities
        .casts
        .retain(|c| c.t < c.windup + c.recover);

    // Tick pulse waves
    for wave in &mut abilities.pulse_waves {
        wave.t += dt;
    }
    abilities.pulse_waves.retain(|w| w.t < PULSE_WAVE_DUR);
}
