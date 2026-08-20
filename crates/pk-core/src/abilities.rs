//! ACTIVE SKILLS — the abilities the Diablo HUD hangs off.
//!
//! Port of `legacy/src/game/pinball-knight/abilities.ts` (917 lines).
//!
//! PORTS: `abilities.ts`

use std::collections::{HashMap, HashSet};
use std::f64::consts::PI;

pub use crate::constants::skills::*;
use crate::skills::SkillAggregate;

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

pub fn ability_rank(id: AbilityId, ranks: &HashMap<AbilityId, usize>) -> usize {
    (*ranks.get(&id).unwrap_or(&0)).min(ABILITY_RANK_MAX)
}

pub fn ability_rank_cost(rank: usize) -> usize {
    rank + 1
}

pub fn momentum_t(speed: f64) -> f64 {
    if speed <= MOMENTUM_T_FLOOR {
        return 0.0;
    }
    let s = (speed - MOMENTUM_T_FLOOR) / (22.0 - MOMENTUM_T_FLOOR);
    (s / (s + MOMENTUM_T_K * (1.0 - s))).clamp(0.0, 1.0)
}

pub fn ability_power(
    _id: AbilityId,
    rank: usize,
    momentum_ability_power: f64,
    speed: f64,
) -> f64 {
    1.0 + (ABILITY_RANK_STEP * (rank as f64)) + momentum_ability_power * momentum_t(speed)
}

pub fn has_rank_rule(rank: usize) -> bool {
    rank >= ABILITY_RANK_RULE
}

pub type PlayerAbilities = PlayerAbilitiesRuntime;

#[derive(Debug, Clone, PartialEq)]
pub struct PulseWave {
    pub x: f64,
    pub z: f64,
    pub t: f64,
    pub hit_indices: HashSet<usize>,
    pub forked: bool,
    pub crackle_t: f64,
    pub r: f64,
    pub dmg: i32,
}

pub fn pulse_radius(t: f64, max_r: f64) -> f64 {
    let k = (t / PULSE_WAVE_DUR).clamp(0.0, 1.0);
    max_r * (1.0 - (1.0 - k) * (1.0 - k))
}

#[derive(Debug, Clone, PartialEq)]
pub struct CastAnim {
    pub id: AbilityId,
    pub t: f64,
    pub windup: f64,
    pub recover: f64,
    pub x: f64,
    pub z: f64,
    pub power: f64,
    pub fired: bool,
    pub gather_t: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum AbilityEvent {
    CastStarted {
        id: AbilityId,
        windup: f64,
    },
    ImpactFrame {
        id: AbilityId,
        x: f64,
        z: f64,
        power: f64,
    },
    PulseWaveSpawned {
        x: f64,
        z: f64,
        radius: f64,
    },
    DamageDealt {
        target_idx: usize,
        amount: i32,
        dir_x: f64,
        dir_z: f64,
        knockback: f64,
    },
    FloorFxSpawned {
        kind: &'static str,
        x: f64,
        z: f64,
        radius: f64,
        life: f64,
    },
    HostileProjectileShredded {
        x: f64,
        z: f64,
    },
    ItemPulled {
        item_idx: usize,
        step_x: f64,
        step_z: f64,
    },
    HordePulled {
        target_idx: usize,
        step_x: f64,
        step_z: f64,
    },
    BloodPricePaid {
        hp_cost: i32,
    },
}

#[derive(Debug, Clone)]
pub struct AbilityTarget {
    pub idx: usize,
    pub x: f64,
    pub z: f64,
    pub hp: i32,
    pub dead: bool,
}

#[derive(Debug, Clone)]
pub struct AbilityItemTarget {
    pub idx: usize,
    pub x: f64,
    pub z: f64,
    pub is_coin: bool,
    pub blocked: bool,
}

#[derive(Debug, Clone)]
pub struct AbilityProjectileTarget {
    pub idx: usize,
    pub x: f64,
    pub z: f64,
    pub hostile: bool,
    pub alive: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AbilitySlotState {
    pub cd: f64,
    pub max_cd: f64,
}

impl Default for AbilitySlotState {
    fn default() -> Self {
        Self {
            cd: 0.0,
            max_cd: 3.5,
        }
    }
}

impl AbilitySlotState {
    pub fn is_ready(&self) -> bool {
        self.cd <= 0.0
    }

    pub fn trigger(&mut self) -> bool {
        if self.cd <= 0.0 {
            self.cd = self.max_cd.max(1.0);
            true
        } else {
            false
        }
    }

    pub fn tick(&mut self, dt: f64) {
        if self.cd > 0.0 {
            self.cd = (self.cd - dt).max(0.0);
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlayerAbilitiesRuntime {
    pub mana: f64,
    pub hp: i32,
    pub x: f64,
    pub z: f64,
    pub mom_x: f64,
    pub mom_z: f64,
    pub mom_speed: f64,
    pub facing_x: f64,
    pub facing_z: f64,
    pub turbo_t: f64,
    pub iframes: f64,
    pub fire_trail_t: f64,
    pub slow_t: f64,
    pub time_crawl_t: f64,
    pub slot_1: AbilitySlotState,
    pub slot_2: AbilitySlotState,
    pub magnet_aura_t: f64,
    pub blade_storm_t: f64,
    pub blade_storm_tick_t: f64,
    pub blade_angle: f64,
    pub flash_t: f64,
    pub bounce_combo: usize,
    pub last_combo: usize,
    pub ability_slots: [Option<AbilityId>; 2],
    pub ability_cd: HashMap<AbilityId, f64>,
    pub ability_ranks: HashMap<AbilityId, usize>,
    pub casts: Vec<CastAnim>,
    pub pulse_waves: Vec<PulseWave>,
    pub trail_ix: i32,
    pub trail_iz: i32,
    pub trail_ghost_t: f64,
    pub magnet_pulse_t: f64,
    pub crawl_smear_t: f64,
}

impl Default for PlayerAbilitiesRuntime {
    fn default() -> Self {
        Self {
            mana: MANA_MAX as f64,
            hp: 6,
            x: 0.0,
            z: 0.0,
            mom_x: 0.0,
            mom_z: 1.0,
            mom_speed: 0.0,
            facing_x: 0.0,
            facing_z: 1.0,
            turbo_t: 0.0,
            iframes: 0.0,
            fire_trail_t: 0.0,
            slow_t: 0.0,
            time_crawl_t: 0.0,
            slot_1: AbilitySlotState { cd: 0.0, max_cd: 3.5 },
            slot_2: AbilitySlotState { cd: 0.0, max_cd: 11.0 },
            magnet_aura_t: 0.0,
            blade_storm_t: 0.0,
            blade_storm_tick_t: 0.0,
            blade_angle: 0.0,
            flash_t: 0.0,
            bounce_combo: 0,
            last_combo: 0,
            ability_slots: [Some(AbilityId::Flippercharge), Some(AbilityId::Arcanepulse)],
            ability_cd: HashMap::new(),
            ability_ranks: HashMap::new(),
            casts: Vec::new(),
            pulse_waves: Vec::new(),
            trail_ix: i32::MIN,
            trail_iz: i32::MIN,
            trail_ghost_t: 0.0,
            magnet_pulse_t: 0.0,
            crawl_smear_t: 0.0,
        }
    }
}

impl PlayerAbilitiesRuntime {
    pub fn tick_simple(&mut self, dt: f64) {
        self.slot_1.tick(dt);
        self.slot_2.tick(dt);
        if self.time_crawl_t > 0.0 {
            self.time_crawl_t = (self.time_crawl_t - dt).max(0.0);
        }
        if self.slow_t > 0.0 {
            self.slow_t = (self.slow_t - dt).max(0.0);
        }
    }
    pub fn player_mana_max(&self, agg: &SkillAggregate) -> f64 {
        ((MANA_MAX + agg.mana_max_flat).max(MANA_POOL_FLOOR)) as f64
    }

    pub fn affordable(&self, id: AbilityId, agg: &SkillAggregate) -> bool {
        let cost = id.def().cost as f64;
        if self.mana >= cost {
            return true;
        }
        agg.blood_price && self.hp > BLOOD_PRICE_HP
    }

    pub fn can_cast(&self, slot: usize, agg: &SkillAggregate) -> bool {
        if slot >= 2 {
            return false;
        }
        let id = match self.ability_slots[slot] {
            Some(i) => i,
            None => return false,
        };
        let cd = *self.ability_cd.get(&id).unwrap_or(&0.0);
        cd <= 0.0 && self.affordable(id, agg)
    }

    pub fn cast_ability(
        &mut self,
        slot: usize,
        agg: &SkillAggregate,
        events: &mut Vec<AbilityEvent>,
    ) -> bool {
        if !self.can_cast(slot, agg) {
            return false;
        }
        let id = self.ability_slots[slot].unwrap();
        let def = id.def();

        if self.mana < def.cost as f64 {
            self.hp -= BLOOD_PRICE_HP;
            events.push(AbilityEvent::BloodPricePaid {
                hp_cost: BLOOD_PRICE_HP,
            });
        }
        self.mana = (self.mana - def.cost as f64).max(0.0);
        self.ability_cd
            .insert(id, def.cooldown * agg.cooldown_mult);

        let rank = ability_rank(id, &self.ability_ranks);
        let power = ability_power(id, rank, agg.momentum_ability_power, self.mom_speed);
        let anim = cast_anim_for(id.as_str()).unwrap_or(CAST_ANIM_FLIPPERCHARGE);

        self.casts.push(CastAnim {
            id,
            t: 0.0,
            windup: anim.windup,
            recover: anim.recover,
            x: self.x,
            z: self.z,
            power,
            fired: false,
            gather_t: 0.0,
        });

        events.push(AbilityEvent::CastStarted {
            id,
            windup: anim.windup,
        });
        true
    }

    pub fn fire_ability(
        &mut self,
        id: AbilityId,
        power: f64,
        events: &mut Vec<AbilityEvent>,
    ) {
        let anim = cast_anim_for(id.as_str()).unwrap_or(CAST_ANIM_FLIPPERCHARGE);
        if anim.flash > 0.0 {
            self.flash_t = self.flash_t.max(anim.flash);
        }

        let rank = ability_rank(id, &self.ability_ranks);
        events.push(AbilityEvent::ImpactFrame {
            id,
            x: self.x,
            z: self.z,
            power,
        });

        match id {
            AbilityId::Flippercharge => {
                let (fx, fz) = if self.mom_speed > 0.0 {
                    (self.mom_x, self.mom_z)
                } else {
                    (self.facing_x, self.facing_z)
                };
                let len = fx.hypot(fz).max(1e-6);
                self.mom_x = fx / len;
                self.mom_z = fz / len;
                self.mom_speed = self
                    .mom_speed
                    .max((FLIPPER_LAUNCH_SPEED * power).min(22.0));
                self.turbo_t = self.turbo_t.max(0.9 * power);
                self.iframes = self
                    .iframes
                    .max(if has_rank_rule(rank) { 0.9 * power } else { 0.35 });
                self.fire_trail_t = FLIPPER_TRAIL_T * power;
                self.trail_ix = self.x.floor() as i32;
                self.trail_iz = self.z.floor() as i32;
            }
            AbilityId::Arcanepulse => {
                let r = ARCANE_PULSE_RADIUS * (1.0 + (power - 1.0) * 0.25);
                let dmg = (ARCANE_PULSE_DAMAGE as f64 * power).round() as i32;
                self.pulse_waves.push(PulseWave {
                    x: self.x,
                    z: self.z,
                    t: 0.0,
                    hit_indices: HashSet::new(),
                    forked: false,
                    crackle_t: 0.0,
                    r,
                    dmg,
                });
                events.push(AbilityEvent::PulseWaveSpawned {
                    x: self.x,
                    z: self.z,
                    radius: r,
                });
                if has_rank_rule(rank) {
                    events.push(AbilityEvent::FloorFxSpawned {
                        kind: "rod",
                        x: self.x,
                        z: self.z,
                        radius: LIGHTNING_ROD_RADIUS,
                        life: LIGHTNING_ROD_LIFE * power,
                    });
                }
            }
            AbilityId::Magnetaura => {
                self.magnet_aura_t = 4.0 * power;
                self.magnet_pulse_t = 0.0;
            }
            AbilityId::Timecrawl => {
                self.slow_t = 3.0 * power;
                self.crawl_smear_t = 0.0;
                if has_rank_rule(rank) {
                    for k in 0..FROST_RUNE_COUNT {
                        let a = (k as f64 / FROST_RUNE_COUNT as f64) * PI * 2.0;
                        events.push(AbilityEvent::FloorFxSpawned {
                            kind: "frost",
                            x: self.x + a.cos() * FROST_RUNE_RING,
                            z: self.z + a.sin() * FROST_RUNE_RING,
                            radius: FROST_RUNE_RADIUS,
                            life: FROST_RUNE_LIFE * power,
                        });
                    }
                }
            }
            AbilityId::Bladestorm => {
                self.blade_storm_t = 5.0 * power;
                self.blade_storm_tick_t = 0.0;
                self.blade_angle = 0.0;
            }
            AbilityId::Slickfield => {
                events.push(AbilityEvent::FloorFxSpawned {
                    kind: "oil",
                    x: self.x,
                    z: self.z,
                    radius: OIL_SLICK_RADIUS * (1.0 + (power - 1.0) * 0.4),
                    life: OIL_SLICK_LIFE * power,
                });
                if has_rank_rule(rank) {
                    events.push(AbilityEvent::FloorFxSpawned {
                        kind: "tar",
                        x: self.x,
                        z: self.z,
                        radius: TAR_PIT_RADIUS,
                        life: TAR_PIT_LIFE * power,
                    });
                }
            }
        }
    }

    pub fn tick(
        &mut self,
        dt: f64,
        agg: &SkillAggregate,
        targets: &mut [AbilityTarget],
        ground_items: &mut [AbilityItemTarget],
        projectiles: &mut [AbilityProjectileTarget],
    ) -> Vec<AbilityEvent> {
        let mut events = Vec::new();
        let max_mana = self.player_mana_max(agg);
        let mom_t = momentum_t(self.mom_speed);

        // Passive mana regen (disabled under Dynamo keystone)
        if !agg.dynamo && self.mana < max_mana {
            self.mana = (self.mana + MANA_REGEN * dt).min(max_mana);
        }

        // Table mana battery on bounces
        if self.bounce_combo > self.last_combo && self.mana < max_mana {
            let per = MANA_PER_BOUNCE
                * (1.0 + MANA_BOUNCE_MOMENTUM * mom_t)
                * (if agg.dynamo { DYNAMO_BOUNCE_MULT } else { 1.0 });
            self.mana = (self.mana + (self.bounce_combo - self.last_combo) as f64 * per).min(max_mana);
        }
        self.last_combo = self.bounce_combo;

        // Cooldown decay with Overdrive momentum scaling
        let cd_rate = 1.0 + agg.momentum_cooldown_rate * mom_t;
        for cd in self.ability_cd.values_mut() {
            if *cd > 0.0 {
                *cd = (*cd - dt * cd_rate).max(0.0);
            }
        }

        // Cast animation ticking
        let mut i = 0;
        while i < self.casts.len() {
            self.casts[i].t += dt;
            if !self.casts[i].fired {
                if self.casts[i].t >= self.casts[i].windup {
                    self.casts[i].fired = true;
                    let id = self.casts[i].id;
                    let power = self.casts[i].power;
                    self.fire_ability(id, power, &mut events);
                }
                i += 1;
                continue;
            }
            if self.casts[i].t >= self.casts[i].windup + self.casts[i].recover {
                self.casts.remove(i);
            } else {
                i += 1;
            }
        }

        // Pulse wave propagation & damage
        let mut pi = 0;
        while pi < self.pulse_waves.len() {
            let w = &mut self.pulse_waves[pi];
            w.t += dt;
            let current_r = pulse_radius(w.t, w.r);

            for target in targets.iter_mut() {
                if target.dead || w.hit_indices.contains(&target.idx) {
                    continue;
                }
                let dx = target.x - w.x;
                let dz = target.z - w.z;
                let d = dx.hypot(dz);
                if d <= current_r && d <= w.r {
                    w.hit_indices.insert(target.idx);
                    let inv = if d > 0.0 { d } else { 1.0 };
                    events.push(AbilityEvent::DamageDealt {
                        target_idx: target.idx,
                        amount: w.dmg,
                        dir_x: dx / inv,
                        dir_z: dz / inv,
                        knockback: 6.0,
                    });
                    target.hp -= w.dmg;
                    if target.hp <= 0 {
                        target.dead = true;
                    }
                }
            }

            if self.pulse_waves[pi].t >= PULSE_WAVE_DUR {
                self.pulse_waves.remove(pi);
            } else {
                pi += 1;
            }
        }

        // Cinder Wake keystone
        if agg.cinder_wake && mom_t >= CINDER_WAKE_T {
            let ix = self.x.floor() as i32;
            let iz = self.z.floor() as i32;
            if ix != self.trail_ix || iz != self.trail_iz {
                self.trail_ix = ix;
                self.trail_iz = iz;
                events.push(AbilityEvent::FloorFxSpawned {
                    kind: "fire",
                    x: self.x,
                    z: self.z,
                    radius: CINDER_WAKE_RADIUS,
                    life: CINDER_WAKE_LIFE,
                });
            }
        }

        // Flipper charge fire trail
        if self.fire_trail_t > 0.0 {
            self.fire_trail_t = (self.fire_trail_t - dt).max(0.0);
            if self.mom_speed >= FLIPPER_TRAIL_MIN_SPEED {
                let ix = self.x.floor() as i32;
                let iz = self.z.floor() as i32;
                if ix != self.trail_ix || iz != self.trail_iz {
                    self.trail_ix = ix;
                    self.trail_iz = iz;
                    events.push(AbilityEvent::FloorFxSpawned {
                        kind: "fire",
                        x: self.x,
                        z: self.z,
                        radius: FLIPPER_TRAIL_RADIUS,
                        life: FLIPPER_TRAIL_LIFE,
                    });
                }
            } else if self.mom_speed <= 0.01 {
                self.fire_trail_t = 0.0;
            }
        }

        // Time Crawl decay
        if self.slow_t > 0.0 {
            self.slow_t = (self.slow_t - dt).max(0.0);
        }

        // Magnet aura pulling
        if self.magnet_aura_t > 0.0 {
            self.magnet_aura_t = (self.magnet_aura_t - dt).max(0.0);
            let magnet_rank = ability_rank(AbilityId::Magnetaura, &self.ability_ranks);

            if has_rank_rule(magnet_rank) {
                for target in targets.iter_mut() {
                    if target.dead {
                        continue;
                    }
                    let dx = self.x - target.x;
                    let dz = self.z - target.z;
                    let d = dx.hypot(dz);
                    if d >= 0.6 && d <= MAGNET_FIELD_R {
                        let step = MAGNET_HORDE_PULL * (1.0 - d / MAGNET_FIELD_R) * dt;
                        events.push(AbilityEvent::HordePulled {
                            target_idx: target.idx,
                            step_x: (dx / d) * step,
                            step_z: (dz / d) * step,
                        });
                    }
                }
            }

            for item in ground_items.iter_mut() {
                if item.is_coin || item.blocked {
                    continue;
                }
                let dx = self.x - item.x;
                let dz = self.z - item.z;
                let d = dx.hypot(dz);
                if d > 0.0 {
                    let step = (MAGNET_AURA_PULL * dt).min(d);
                    item.x += (dx / d) * step;
                    item.z += (dz / d) * step;
                    events.push(AbilityEvent::ItemPulled {
                        item_idx: item.idx,
                        step_x: (dx / d) * step,
                        step_z: (dz / d) * step,
                    });
                }
            }
        }

        // Blade storm
        if self.blade_storm_t > 0.0 {
            self.blade_storm_t = (self.blade_storm_t - dt).max(0.0);
            self.blade_angle += BLADESTORM_SPIN * dt;
            self.blade_storm_tick_t -= dt;

            if self.blade_storm_t > 0.0 && self.blade_storm_tick_t <= 0.0 {
                self.blade_storm_tick_t = BLADESTORM_TICK;
                let blade_rank = ability_rank(AbilityId::Bladestorm, &self.ability_ranks);
                let power = ability_power(
                    AbilityId::Bladestorm,
                    blade_rank,
                    agg.momentum_ability_power,
                    self.mom_speed,
                );
                let bite = (BLADESTORM_DAMAGE as f64 * power).round() as i32;

                for target in targets.iter_mut() {
                    if target.dead {
                        continue;
                    }
                    let dx = target.x - self.x;
                    let dz = target.z - self.z;
                    let d = dx.hypot(dz);
                    if d <= BLADESTORM_RADIUS {
                        let inv = if d > 0.0 { d } else { 1.0 };
                        events.push(AbilityEvent::DamageDealt {
                            target_idx: target.idx,
                            amount: bite,
                            dir_x: dx / inv,
                            dir_z: dz / inv,
                            knockback: 3.0,
                        });
                        target.hp -= bite;
                        if target.hp <= 0 {
                            target.dead = true;
                        }
                    }
                }

                if has_rank_rule(blade_rank) {
                    for proj in projectiles.iter_mut() {
                        if !proj.hostile || !proj.alive {
                            continue;
                        }
                        let dx = proj.x - self.x;
                        let dz = proj.z - self.z;
                        if dx * dx + dz * dz <= BLADESTORM_RADIUS * BLADESTORM_RADIUS {
                            proj.alive = false;
                            events.push(AbilityEvent::HostileProjectileShredded {
                                x: proj.x,
                                z: proj.z,
                            });
                        }
                    }
                }
            }
        }

        events
    }
}
