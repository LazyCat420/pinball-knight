//! ⚔️ ACTIVE SKILLS — The Diablo HUD Q/E abilities engine.
//!
//! PORTS: `abilities.ts`
//!
//! Provides the 6 active ability definitions, mana management, ability ranks,
//! 3-beat cast timelines (anticipation -> impact -> recovery), Arcane Pulse expanding
//! shockwaves, Flipper Charge launch momentum, Magnet Aura vortex, Time Crawl,
//! Blade Storm orbiting cleave, and Slick Field oil dispersion.

use crate::collide::move_circle;
use crate::floor_fx::{spawn_floor_fx, FloorFx, FloorFxKind};
use crate::grid::Grid;
use crate::projectiles::Projectile;
use crate::state::Player;
use crate::zombie_ai::{EnemyMode, LiveEnemy};

pub const MANA_MAX_BASE: f64 = 100.0;
pub const MANA_REGEN: f64 = 6.0;
pub const MANA_PER_BOUNCE: f64 = 4.0;
pub const MANA_BOUNCE_MOMENTUM: f64 = 0.5;
pub const ABILITY_RANK_MAX: u32 = 3;
pub const ABILITY_RANK_STEP: f64 = 0.25;
pub const ABILITY_RANK_RULE: u32 = 2;

pub const BLOOD_PRICE_HP: i32 = 1;
pub const CINDER_WAKE_T: f64 = 0.70;
pub const CINDER_WAKE_RADIUS: f64 = 0.65;
pub const CINDER_WAKE_LIFE: f64 = 3.5;

pub const FROST_RUNE_RADIUS: f64 = 0.6;
pub const FROST_RUNE_LIFE: f64 = 6.0;
pub const FROST_RUNE_COUNT: usize = 6;
pub const FROST_RUNE_RING: f64 = 2.2;

pub const TAR_PIT_RADIUS: f64 = 1.1;
pub const TAR_PIT_LIFE: f64 = 10.0;
pub const LIGHTNING_ROD_RADIUS: f64 = 0.8;
pub const LIGHTNING_ROD_LIFE: f64 = 8.0;

pub const ARCANE_PULSE_RADIUS: f64 = 3.2;
pub const ARCANE_PULSE_DAMAGE: f64 = 38.0;
pub const PULSE_WAVE_DUR: f64 = 0.38;

pub const FLIPPER_LAUNCH_SPEED: f64 = 15.0;
pub const FLIPPER_TRAIL_T: f64 = 2.5;
pub const FLIPPER_TRAIL_MIN_SPEED: f64 = 4.0;
pub const FLIPPER_TRAIL_RADIUS: f64 = 0.75;
pub const FLIPPER_TRAIL_LIFE: f64 = 4.0;

pub const MAGNET_AURA_PULL: f64 = 5.5;
pub const MAGNET_FIELD_R: f64 = 4.5;
pub const MAGNET_HORDE_PULL: f64 = 2.8;

pub const BLADESTORM_RADIUS: f64 = 2.0;
pub const BLADESTORM_DAMAGE: f64 = 18.0;
pub const BLADESTORM_TICK: f64 = 0.28;
pub const BLADESTORM_BLADES: usize = 4;
pub const BLADESTORM_SPIN: f64 = 6.28;

pub const OIL_SLICK_RADIUS: f64 = 1.8;
pub const OIL_SLICK_LIFE: f64 = 12.0;
pub const TIMECRAWL_FIELD_R: f64 = 5.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AbilityId {
    FlipperCharge = 0,
    ArcanePulse = 1,
    MagnetAura = 2,
    TimeCrawl = 3,
    BladeStorm = 4,
    SlickField = 5,
}

impl AbilityId {
    pub const ALL: [AbilityId; 6] = [
        AbilityId::FlipperCharge,
        AbilityId::ArcanePulse,
        AbilityId::MagnetAura,
        AbilityId::TimeCrawl,
        AbilityId::BladeStorm,
        AbilityId::SlickField,
    ];

    pub fn as_index(self) -> usize {
        self as usize
    }

    pub fn def(self) -> &'static AbilityDef {
        &ABILITY_DEFS[self.as_index()]
    }

    pub fn from_index(idx: usize) -> Option<Self> {
        match idx {
            0 => Some(AbilityId::FlipperCharge),
            1 => Some(AbilityId::ArcanePulse),
            2 => Some(AbilityId::MagnetAura),
            3 => Some(AbilityId::TimeCrawl),
            4 => Some(AbilityId::BladeStorm),
            5 => Some(AbilityId::SlickField),
            _ => None,
        }
    }
}

pub struct AbilityDef {
    pub id: AbilityId,
    pub label: &'static str,
    pub icon: &'static str,
    pub cost: f64,
    pub cooldown: f64,
    pub color: u32,
    pub color_str: &'static str,
    pub detail: &'static str,
}

pub const ABILITY_DEFS: [AbilityDef; 6] = [
    AbilityDef {
        id: AbilityId::FlipperCharge,
        label: "Flipper Charge",
        icon: "🏓",
        cost: 20.0,
        cooldown: 3.5,
        color: 0xf0a63c,
        color_str: "#f0a63c",
        detail: "Launch forward like a flipper",
    },
    AbilityDef {
        id: AbilityId::ArcanePulse,
        label: "Arcane Pulse",
        icon: "✷",
        cost: 35.0,
        cooldown: 5.0,
        color: 0xb06fe8,
        color_str: "#b06fe8",
        detail: "360° arcane damage burst",
    },
    AbilityDef {
        id: AbilityId::MagnetAura,
        label: "Magnet Aura",
        icon: "🧲",
        cost: 25.0,
        cooldown: 7.0,
        color: 0x6fd0e8,
        color_str: "#6fd0e8",
        detail: "Pull nearby loot for 4s",
    },
    AbilityDef {
        id: AbilityId::TimeCrawl,
        label: "Time Crawl",
        icon: "⏳",
        cost: 50.0,
        cooldown: 11.0,
        color: 0xbfe8ff,
        color_str: "#bfe8ff",
        detail: "Slow the horde for 3s",
    },
    AbilityDef {
        id: AbilityId::BladeStorm,
        label: "Blade Storm",
        icon: "🌪️",
        cost: 40.0,
        cooldown: 9.0,
        color: 0xc8ccd4,
        color_str: "#c8ccd4",
        detail: "Orbiting blades for 5s",
    },
    AbilityDef {
        id: AbilityId::SlickField,
        label: "Slick Field",
        icon: "🛢️",
        cost: 25.0,
        cooldown: 8.0,
        color: 0x8a5fd0,
        color_str: "#8a5fd0",
        detail: "Spill oil — foes skid, the ball glides",
    },
];

pub struct CastTiming {
    pub windup: f64,
    pub recover: f64,
    pub gather: f64,
    pub flash: f64,
    pub shake: f64,
    pub hitstop: f64,
}

pub fn cast_timing(id: AbilityId) -> CastTiming {
    match id {
        AbilityId::FlipperCharge => CastTiming {
            windup: 0.083,
            recover: 0.12,
            gather: 1.2,
            flash: 0.05,
            shake: 0.25,
            hitstop: 0.04,
        },
        AbilityId::ArcanePulse => CastTiming {
            windup: 0.18,
            recover: 0.22,
            gather: 2.2,
            flash: 0.08,
            shake: 0.35,
            hitstop: 0.06,
        },
        AbilityId::MagnetAura => CastTiming {
            windup: 0.12,
            recover: 0.16,
            gather: 1.8,
            flash: 0.03,
            shake: 0.15,
            hitstop: 0.02,
        },
        AbilityId::TimeCrawl => CastTiming {
            windup: 0.25,
            recover: 0.28,
            gather: 2.5,
            flash: 0.10,
            shake: 0.40,
            hitstop: 0.08,
        },
        AbilityId::BladeStorm => CastTiming {
            windup: 0.15,
            recover: 0.18,
            gather: 1.6,
            flash: 0.05,
            shake: 0.20,
            hitstop: 0.03,
        },
        AbilityId::SlickField => CastTiming {
            windup: 0.14,
            recover: 0.16,
            gather: 1.5,
            flash: 0.04,
            shake: 0.18,
            hitstop: 0.02,
        },
    }
}

#[derive(Debug, Clone)]
pub struct PulseWave {
    pub x: f64,
    pub z: f64,
    pub t: f64,
    pub hit_ids: Vec<u32>,
    pub forked: bool,
    pub crackle_t: f64,
    pub r: f64,
    pub dmg: f64,
}

#[derive(Debug, Clone)]
pub struct CastAnim {
    pub id: AbilityId,
    pub t: f64,
    pub windup: f64,
    pub recover: f64,
    pub x: f64,
    pub z: f64,
    pub power: f64,
    pub fired: bool,
}

#[derive(Debug, Clone)]
pub struct AbilitiesState {
    pub mana: f64,
    pub max_mana: f64,
    pub ability_ranks: [u32; 6],
    pub ability_cds: [f64; 6],
    pub ability_slots: [Option<AbilityId>; 2],
    pub casts: Vec<CastAnim>,
    pub pulse_waves: Vec<PulseWave>,
    pub blade_storm_t: f64,
    pub blade_storm_tick_t: f64,
    pub blade_angle: f64,
    pub magnet_aura_t: f64,
    pub time_crawl_t: f64,
    pub fire_trail_t: f64,
    pub last_combo: f64,
    pub trail_ix: i32,
    pub trail_iz: i32,
}

impl Default for AbilitiesState {
    fn default() -> Self {
        Self {
            mana: MANA_MAX_BASE,
            max_mana: MANA_MAX_BASE,
            ability_ranks: [0; 6],
            ability_cds: [0.0; 6],
            ability_slots: [Some(AbilityId::FlipperCharge), Some(AbilityId::ArcanePulse)],
            casts: Vec::new(),
            pulse_waves: Vec::new(),
            blade_storm_t: 0.0,
            blade_storm_tick_t: 0.0,
            blade_angle: 0.0,
            magnet_aura_t: 0.0,
            time_crawl_t: 0.0,
            fire_trail_t: 0.0,
            last_combo: 0.0,
            trail_ix: -999,
            trail_iz: -999,
        }
    }
}

impl AbilitiesState {
    pub fn rank(&self, id: AbilityId) -> u32 {
        self.ability_ranks[id.as_index()].min(ABILITY_RANK_MAX)
    }

    pub fn has_rank_rule(&self, id: AbilityId) -> bool {
        self.rank(id) >= ABILITY_RANK_RULE
    }

    pub fn ability_power(&self, id: AbilityId, mom_speed: f64) -> f64 {
        let mom_t = (mom_speed / 12.0).clamp(0.0, 1.0);
        1.0 + ABILITY_RANK_STEP * self.rank(id) as f64 + 0.35 * mom_t
    }

    pub fn affordable(&self, id: AbilityId, player_hp: i32, blood_price: bool) -> bool {
        let cost = ABILITY_DEFS[id.as_index()].cost;
        if self.mana >= cost {
            true
        } else {
            blood_price && player_hp > BLOOD_PRICE_HP
        }
    }

    pub fn can_cast(&self, slot: usize, player_hp: i32, blood_price: bool) -> bool {
        if slot >= 2 {
            return false;
        }
        if let Some(id) = self.ability_slots[slot] {
            self.ability_cds[id.as_index()] <= 0.0 && self.affordable(id, player_hp, blood_price)
        } else {
            false
        }
    }

    pub fn cast_ability(
        &mut self,
        slot: usize,
        player: &mut Player,
        blood_price: bool,
    ) -> bool {
        if !self.can_cast(slot, player.hp, blood_price) {
            return false;
        }
        let id = self.ability_slots[slot].unwrap();
        let def = &ABILITY_DEFS[id.as_index()];

        if self.mana < def.cost && blood_price {
            player.hp = (player.hp - BLOOD_PRICE_HP).max(1);
        }
        self.mana = (self.mana - def.cost).max(0.0);
        self.ability_cds[id.as_index()] = def.cooldown;

        let timing = cast_timing(id);
        let power = self.ability_power(id, player.mom_speed);
        self.casts.push(CastAnim {
            id,
            t: 0.0,
            windup: timing.windup,
            recover: timing.recover,
            x: player.x,
            z: player.z,
            power,
            fired: false,
        });
        true
    }

    pub fn tick(
        &mut self,
        player: &mut Player,
        enemies: &mut [LiveEnemy],
        projectiles: &mut [Projectile],
        floor_fx: &mut Vec<FloorFx>,
        next_fx_id: &mut u64,
        grid: &Grid,
        dt: f64,
    ) {
        // Mana passive regen
        if self.mana < self.max_mana {
            self.mana = (self.mana + MANA_REGEN * dt).min(self.max_mana);
        }

        // Mana from bounce combo
        let combo = player.bounce_combo;
        if combo > self.last_combo && self.mana < self.max_mana {
            let per = MANA_PER_BOUNCE * (1.0 + MANA_BOUNCE_MOMENTUM * (player.mom_speed / 12.0).clamp(0.0, 1.0));
            self.mana = (self.mana + (combo - self.last_combo) * per).min(self.max_mana);
        }
        self.last_combo = combo;

        // Tick cooldowns
        for cd in &mut self.ability_cds {
            if *cd > 0.0 {
                *cd = (*cd - dt).max(0.0);
            }
        }

        // Tick casts in flight
        for i in (0..self.casts.len()).rev() {
            self.casts[i].t += dt;
            if !self.casts[i].fired && self.casts[i].t >= self.casts[i].windup {
                self.casts[i].fired = true;
                let id = self.casts[i].id;
                let power = self.casts[i].power;
                self.fire_ability(id, power, player, floor_fx, next_fx_id);
            }
            if self.casts[i].t >= self.casts[i].windup + self.casts[i].recover {
                self.casts.swap_remove(i);
            }
        }

        // Tick Arcane Pulse waves
        for i in (0..self.pulse_waves.len()).rev() {
            self.pulse_waves[i].t += dt;
            let k = (self.pulse_waves[i].t / PULSE_WAVE_DUR).clamp(0.0, 1.0);
            let current_r = self.pulse_waves[i].r * (1.0 - (1.0 - k) * (1.0 - k));

            let wave_x = self.pulse_waves[i].x;
            let wave_z = self.pulse_waves[i].z;
            let dmg = self.pulse_waves[i].dmg;

            for enemy in enemies.iter_mut() {
                if enemy.mode == EnemyMode::Dead || self.pulse_waves[i].hit_ids.contains(&enemy.id) {
                    continue;
                }
                let dx = enemy.x - wave_x;
                let dz = enemy.z - wave_z;
                let dist = (dx * dx + dz * dz).sqrt();
                if dist <= current_r && dist <= self.pulse_waves[i].r {
                    self.pulse_waves[i].hit_ids.push(enemy.id);
                    let hit_res = crate::combat::resolve_enemy_hit(
                        enemy.hp,
                        enemy.max_hp,
                        dmg,
                        dx,
                        dz,
                        crate::combat::KNOCKBACK_ZOMBIE * 1.8,
                        player.bounce_combo,
                        player.mom_speed,
                    );
                    enemy.hp = (enemy.hp - hit_res.damage_dealt).max(0.0);
                    if hit_res.is_kill {
                        enemy.mode = EnemyMode::Dead;
                    } else {
                        enemy.mode = EnemyMode::Stagger;
                        enemy.stagger_t = 0.4;
                    }
                    enemy.vx += hit_res.knockback_x * 6.0;
                    enemy.vz += hit_res.knockback_z * 6.0;
                }
            }

            if self.pulse_waves[i].t >= PULSE_WAVE_DUR {
                self.pulse_waves.swap_remove(i);
            }
        }

        // Tick Blade Storm
        if self.blade_storm_t > 0.0 {
            self.blade_storm_t = (self.blade_storm_t - dt).max(0.0);
            self.blade_angle += BLADESTORM_SPIN * dt;
            self.blade_storm_tick_t -= dt;
            if self.blade_storm_t > 0.0 && self.blade_storm_tick_t <= 0.0 {
                self.blade_storm_tick_t = BLADESTORM_TICK;
                let bite = BLADESTORM_DAMAGE * self.ability_power(AbilityId::BladeStorm, player.mom_speed);
                for enemy in enemies.iter_mut() {
                    if enemy.mode == EnemyMode::Dead {
                        continue;
                    }
                    let dx = enemy.x - player.x;
                    let dz = enemy.z - player.z;
                    let dist = (dx * dx + dz * dz).sqrt();
                    if dist <= BLADESTORM_RADIUS {
                        let hit_res = crate::combat::resolve_enemy_hit(
                            enemy.hp,
                            enemy.max_hp,
                            bite,
                            dx,
                            dz,
                            crate::combat::KNOCKBACK_ZOMBIE * 0.8,
                            player.bounce_combo,
                            player.mom_speed,
                        );
                        enemy.hp = (enemy.hp - hit_res.damage_dealt).max(0.0);
                        if hit_res.is_kill {
                            enemy.mode = EnemyMode::Dead;
                        }
                    }
                }

                // Rank 2 rule: Shred incoming enemy projectiles
                if self.has_rank_rule(AbilityId::BladeStorm) {
                    for pr in projectiles.iter_mut() {
                        if pr.is_player || pr.dead || pr.life <= 0.0 {
                            continue;
                        }
                        let dx = pr.x - player.x;
                        let dz = pr.z - player.z;
                        if dx * dx + dz * dz <= BLADESTORM_RADIUS * BLADESTORM_RADIUS {
                            pr.life = 0.0;
                            pr.dead = true;
                        }
                    }
                }
            }
        }

        // Tick Magnet Aura
        if self.magnet_aura_t > 0.0 {
            self.magnet_aura_t = (self.magnet_aura_t - dt).max(0.0);
            // Rank 2 rule: Drag living enemies into the vortex
            if self.has_rank_rule(AbilityId::MagnetAura) {
                for enemy in enemies.iter_mut() {
                    if enemy.mode == EnemyMode::Dead {
                        continue;
                    }
                    let dx = player.x - enemy.x;
                    let dz = player.z - enemy.z;
                    let dist = (dx * dx + dz * dz).sqrt();
                    if dist >= 0.6 && dist <= MAGNET_FIELD_R {
                        let step = MAGNET_HORDE_PULL * (1.0 - dist / MAGNET_FIELD_R) * dt;
                        let res = move_circle(grid, enemy.x, enemy.z, enemy.radius, (dx / dist) * step, (dz / dist) * step);
                        enemy.x = res.x;
                        enemy.z = res.z;
                    }
                }
            }
        }

        // Tick Time Crawl
        if self.time_crawl_t > 0.0 {
            self.time_crawl_t = (self.time_crawl_t - dt).max(0.0);
        }

        // Flipper Charge Fire Trail
        if self.fire_trail_t > 0.0 {
            self.fire_trail_t = (self.fire_trail_t - dt).max(0.0);
            if player.mom_speed >= FLIPPER_TRAIL_MIN_SPEED {
                let ix = player.x.floor() as i32;
                let iz = player.z.floor() as i32;
                if ix != self.trail_ix || iz != self.trail_iz {
                    self.trail_ix = ix;
                    self.trail_iz = iz;
                    *next_fx_id += 1;
                    spawn_floor_fx(
                        floor_fx,
                        *next_fx_id,
                        FloorFxKind::Fire,
                        player.x,
                        player.z,
                        FLIPPER_TRAIL_RADIUS,
                        FLIPPER_TRAIL_LIFE,
                        false,
                    );
                }
            }
        }
    }

    fn fire_ability(
        &mut self,
        id: AbilityId,
        power: f64,
        player: &mut Player,
        floor_fx: &mut Vec<FloorFx>,
        next_fx_id: &mut u64,
    ) {
        match id {
            AbilityId::FlipperCharge => {
                let (fx, fz) = if player.mom_speed > 0.0 {
                    (player.mom_x, player.mom_z)
                } else {
                    crate::melee::facing_vec(player.facing)
                };
                let len = (fx * fx + fz * fz).sqrt().max(1e-4);
                player.mom_x = fx / len;
                player.mom_z = fz / len;
                player.mom_speed = player.mom_speed.max(FLIPPER_LAUNCH_SPEED * power);
                player.iframes = player.iframes.max(if self.has_rank_rule(AbilityId::FlipperCharge) {
                    0.9 * power
                } else {
                    0.35
                });
                self.fire_trail_t = FLIPPER_TRAIL_T * power;
                self.trail_ix = player.x.floor() as i32;
                self.trail_iz = player.z.floor() as i32;
            }
            AbilityId::ArcanePulse => {
                let r = ARCANE_PULSE_RADIUS * (1.0 + (power - 1.0) * 0.25);
                self.pulse_waves.push(PulseWave {
                    x: player.x,
                    z: player.z,
                    t: 0.0,
                    hit_ids: Vec::new(),
                    forked: false,
                    crackle_t: 0.0,
                    r,
                    dmg: ARCANE_PULSE_DAMAGE * power,
                });
                if self.has_rank_rule(AbilityId::ArcanePulse) {
                    *next_fx_id += 1;
                    spawn_floor_fx(
                        floor_fx,
                        *next_fx_id,
                        FloorFxKind::Rod,
                        player.x,
                        player.z,
                        LIGHTNING_ROD_RADIUS,
                        LIGHTNING_ROD_LIFE * power,
                        false,
                    );
                }
            }
            AbilityId::MagnetAura => {
                self.magnet_aura_t = 4.0 * power;
            }
            AbilityId::TimeCrawl => {
                self.time_crawl_t = 3.0 * power;
                if self.has_rank_rule(AbilityId::TimeCrawl) {
                    for k in 0..FROST_RUNE_COUNT {
                        let a = (k as f64 / FROST_RUNE_COUNT as f64) * std::f64::consts::TAU;
                        *next_fx_id += 1;
                        spawn_floor_fx(
                            floor_fx,
                            *next_fx_id,
                            FloorFxKind::Frost,
                            player.x + a.cos() * FROST_RUNE_RING,
                            player.z + a.sin() * FROST_RUNE_RING,
                            FROST_RUNE_RADIUS,
                            FROST_RUNE_LIFE * power,
                            false,
                        );
                    }
                }
            }
            AbilityId::BladeStorm => {
                self.blade_storm_t = 5.0 * power;
                self.blade_storm_tick_t = 0.0;
                self.blade_angle = 0.0;
            }
            AbilityId::SlickField => {
                *next_fx_id += 1;
                spawn_floor_fx(
                    floor_fx,
                    *next_fx_id,
                    FloorFxKind::Oil,
                    player.x,
                    player.z,
                    OIL_SLICK_RADIUS * (1.0 + (power - 1.0) * 0.4),
                    OIL_SLICK_LIFE * power,
                    false,
                );
                if self.has_rank_rule(AbilityId::SlickField) {
                    *next_fx_id += 1;
                    spawn_floor_fx(
                        floor_fx,
                        *next_fx_id,
                        FloorFxKind::Tar,
                        player.x,
                        player.z,
                        TAR_PIT_RADIUS,
                        TAR_PIT_LIFE * power,
                        false,
                    );
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grid::{set_tile, Grid, T_FLOOR};
    use crate::state::{Facing, DT};

    #[test]
    fn flipper_charge_launches_and_ignites_trail() {
        let mut grid = Grid::solid(20, 20);
        for i in 1..19 {
            for j in 1..19 {
                set_tile(&mut grid, i, j, T_FLOOR);
            }
        }
        let mut player = Player {
            x: 5.0,
            z: 5.0,
            facing: Facing::E,
            ..Default::default()
        };
        let mut abilities = AbilitiesState::default();
        let mut enemies = Vec::new();
        let mut projs = Vec::new();
        let mut fx_pool = Vec::new();
        let mut next_fx_id = 1;

        // Cast slot 0 (Flipper Charge)
        assert!(abilities.cast_ability(0, &mut player, false));
        assert_eq!(abilities.mana, MANA_MAX_BASE - 20.0);
        assert!(abilities.ability_cds[AbilityId::FlipperCharge.as_index()] > 0.0);

        // Step through wind-up
        for _ in 0..10 {
            abilities.tick(&mut player, &mut enemies, &mut projs, &mut fx_pool, &mut next_fx_id, &grid, DT);
        }

        // Verify launch speed and fire trail
        assert!(player.mom_speed >= FLIPPER_LAUNCH_SPEED);
        assert!(player.iframes > 0.0);
        assert!(abilities.fire_trail_t > 0.0);
    }

    #[test]
    fn arcane_pulse_damages_foes_in_expanding_wave() {
        let mut grid = Grid::solid(20, 20);
        for i in 1..19 {
            for j in 1..19 {
                set_tile(&mut grid, i, j, T_FLOOR);
            }
        }
        let mut player = Player {
            x: 5.0,
            z: 5.0,
            ..Default::default()
        };
        let mut abilities = AbilitiesState::default();
        abilities.ability_slots[0] = Some(AbilityId::ArcanePulse);
        let mut enemies = vec![LiveEnemy::new_by_index(1, 0, 6.5, 5.0)];
        let initial_hp = enemies[0].hp;
        let mut projs = Vec::new();
        let mut fx_pool = Vec::new();
        let mut next_fx_id = 1;

        assert!(abilities.cast_ability(0, &mut player, false));

        // Step past wind-up and through pulse expansion
        for _ in 0..20 {
            abilities.tick(&mut player, &mut enemies, &mut projs, &mut fx_pool, &mut next_fx_id, &grid, DT);
        }

        // Verify enemy took arcane damage
        assert!(enemies[0].hp < initial_hp);
    }
}
