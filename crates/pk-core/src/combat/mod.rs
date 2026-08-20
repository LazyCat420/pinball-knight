//! ARPG combat engine, damage scaling, stagger interrupts, and rewards.
//!
//! Port of `legacy/src/game/pinball-knight/entities/combat.ts` (1,205 lines).
//!
//! PORTS: `entities/combat.ts`

pub mod combo;
pub mod damage;
pub mod loot;
pub mod stagger;

pub use combo::{CombatComboState, ComboStage, COMBO_RESET_WINDOW};
pub use damage::CombatHit;
pub use loot::{calculate_kill_reward, Corpse, CorpseManager};
pub use stagger::{pain_base, pain_chance, stagger_time};

use std::collections::HashMap;

use crate::cards::aggregate_cards;
use crate::constants::*;
use crate::economy::forge::{upgrade_damage_mult, Weapon, WeaponId};
use crate::monsters::types::{EnemyKind, EnemyMode, LiveMonster};
use crate::skills::SkillAggregate;
use crate::zombie_types::{type_drop_mult, ZombieType};

pub const FLASH_TIME: f64 = 0.12;
pub const ISO: f64 = std::f64::consts::FRAC_1_SQRT_2;

// Combat & Buff constants
pub const PLAYER_IFRAMES: f64 = 0.65;
pub const GOLD_PER_KILL: i64 = 1;
pub const RAGE_DAMAGE_MULT: f64 = 2.0;
pub const STONESKIN_DAMAGE_MULT: f64 = 0.5;
pub const GREED_GOLD_MULT: f64 = 2.0;
pub const STATIC_ARC_DAMAGE: f64 = 2.0;
pub const STATIC_ARC_RANGE: f64 = 3.2;
pub const MOMENTUM_WEAPON_MAX: f64 = 2.5;
pub const PINBALL_MAX_SPEED: f64 = 24.0;
pub const COMBO_ZONE_CRUISE: usize = 8;
pub const PIN_STRIKE_COUNT: usize = 3;
pub const PIN_STRIKE_GOLD: i64 = 50;
pub const PIN_STRIKE_WINDOW: f64 = 0.9;
pub const XP_KILL: usize = 12;
pub const XP_KILL_BOSS: usize = 150;
pub const BRUTE_KNOCKBACK: f64 = 8.5;
pub const KNOCKBACK_PLAYER: f64 = 4.5;
pub const KNOCKBACK_ZOMBIE: f64 = 2.2;
pub const JESTER_DISC_DAMAGE: i32 = 1;
pub const CROAKER_BEAM_DAMAGE: i32 = 2;
pub const ROTORTAIL_TIMBER_DAMAGE: i32 = 2;
pub const STILTNECK_BLAST_DAMAGE: i32 = 2;

/// Facing → WORLD ground direction vector table.
pub const FACING_VEC: [(f64, f64); 4] = [
    (ISO, -ISO),  // N
    (-ISO, ISO),  // S
    (ISO, ISO),   // E
    (-ISO, -ISO), // W
];

/// Armor absorption result
#[derive(Debug, Clone, PartialEq)]
pub struct AbsorbedDamage {
    pub hp_damage: i32,
    pub destroyed: Vec<String>,
}

/// Route incoming damage through armor (helmet first, then armor).
pub fn absorb_damage(gear: &mut HashMap<String, u32>, damage: i32) -> AbsorbedDamage {
    let mut destroyed = Vec::new();
    let mut remaining = damage;

    for slot in ["helmet", "armor"] {
        if remaining <= 0 {
            break;
        }
        if let Some(dur) = gear.get_mut(slot) {
            if *dur > 0 {
                let soaked = (*dur as i32).min(remaining);
                remaining -= soaked;
                *dur -= soaked as u32;
                if *dur == 0 {
                    destroyed.push(slot.to_string());
                }
            }
        }
    }

    for slot in &destroyed {
        gear.remove(slot);
    }

    AbsorbedDamage {
        hp_damage: remaining,
        destroyed,
    }
}

/// Facing to 2D world movement vector under 45° isometric yaw.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Facing {
    N,
    S,
    E,
    W,
}

impl Facing {
    pub fn vector(self) -> (f64, f64) {
        match self {
            Facing::N => (ISO, -ISO),
            Facing::S => (-ISO, ISO),
            Facing::E => (ISO, ISO),
            Facing::W => (-ISO, -ISO),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DamageSource {
    Steel,
    Bounce,
    Ranged,
}

/// Base bite damage per monster kind.
pub fn damage_for_kind(kind: EnemyKind) -> i32 {
    match kind {
        EnemyKind::Zombie | EnemyKind::Spitter | EnemyKind::Goblin | EnemyKind::Pin
        | EnemyKind::Webspinner | EnemyKind::Sporeling | EnemyKind::FishFeet
        | EnemyKind::Bloater | EnemyKind::Necromancer | EnemyKind::Skeleton | EnemyKind::Witch => ZOMBIE_DAMAGE,
        EnemyKind::Spider | EnemyKind::Hound | EnemyKind::Sapper => SPIDER_DAMAGE,
        EnemyKind::Brute | EnemyKind::Warden | EnemyKind::Mimic | EnemyKind::BossKing => BRUTE_DAMAGE,
        EnemyKind::Ghost | EnemyKind::Wisp => GHOST_DAMAGE,
        EnemyKind::Bat => BAT_DAMAGE,
        EnemyKind::Slime => SLIME_DAMAGE,
        EnemyKind::Reaper => REAPER_DAMAGE,
        EnemyKind::Golem | EnemyKind::Crystalback => GOLEM_DAMAGE,
        EnemyKind::Chomper => CHOMPER_DAMAGE,
        EnemyKind::Magnet => MAGNET_DAMAGE,
        EnemyKind::Jester => JESTER_DISC_DAMAGE,
        EnemyKind::Croaker => CROAKER_BEAM_DAMAGE,
        EnemyKind::Rotortail => ROTORTAIL_TIMBER_DAMAGE,
        EnemyKind::Stiltneck => STILTNECK_BLAST_DAMAGE,
    }
}

/// Momentum scaling helper matching legacy momentumScaled(maxMult, speed).
pub fn momentum_scaled(max_mult: f64, mom_speed: f64) -> f64 {
    if mom_speed <= 0.0 {
        1.0
    } else {
        let t = (mom_speed / PINBALL_MAX_SPEED).clamp(0.0, 1.0);
        1.0 + (max_mult - 1.0) * t
    }
}

/// Combo damage multiplier.
pub fn combo_damage_mult(combo: usize) -> f64 {
    if combo <= COMBO_ZONE_CRUISE {
        1.0
    } else {
        1.0 + ((combo - COMBO_ZONE_CRUISE) as f64 * 0.05).min(1.5)
    }
}

/// Combo window duration in seconds for a given combo count.
pub fn combo_window(combo: usize) -> f64 {
    (2.4 - (combo as f64 * 0.04)).max(0.75)
}

/// Style kill bonus gold per combo count.
pub fn combo_kill_gold(combo: usize) -> i64 {
    if combo < 2 {
        0
    } else {
        ((combo as f64).log2().floor() as i64) * 3
    }
}

/// Calculates outgoing player attack damage (1:1 playerDamage).
pub fn player_damage(
    base_damage: f64,
    weapon: Option<&Weapon>,
    mom_speed: f64,
    has_material: bool,
    bounce_combo: usize,
    rage_t: f64,
    agg_skills: &SkillAggregate,
    crit_roll: f64,
) -> (f64, bool) {
    let mut dmg = base_damage;
    let mut was_crit = false;

    if let Some(w) = weapon {
        if w.upgrade > 0 {
            dmg *= upgrade_damage_mult(w.upgrade);
        }
        if !w.cards.is_empty() {
            let agg = aggregate_cards(&w.cards);
            dmg = dmg * agg.damage_mult + (agg.damage_flat as f64);
            if agg.pinball_mult > 1.0 && mom_speed > 0.0 {
                dmg *= momentum_scaled(agg.pinball_mult, mom_speed);
            }
            if agg.material_mult > 1.0 && has_material {
                dmg *= agg.material_mult;
            }
            if agg.crit_chance > 0.0 && crit_roll < agg.crit_chance {
                dmg *= agg.crit_mult;
                was_crit = true;
            }
        }
        if w.id == WeaponId::WreckingBall && mom_speed > 0.0 {
            dmg *= momentum_scaled(MOMENTUM_WEAPON_MAX, mom_speed);
        }
    }

    dmg *= agg_skills.damage_mult;
    if agg_skills.pinball_damage_mult > 1.0 && mom_speed > 0.0 {
        dmg *= momentum_scaled(agg_skills.pinball_damage_mult, mom_speed);
    }
    if bounce_combo > COMBO_ZONE_CRUISE {
        dmg *= combo_damage_mult(bounce_combo);
    }
    if rage_t > 0.0 {
        dmg *= RAGE_DAMAGE_MULT;
    }

    (dmg, was_crit)
}

/// Backward-compatible calculate_player_damage alias
pub fn calculate_player_damage(
    base_damage: f64,
    weapon: Option<&Weapon>,
    mom_speed: f64,
    has_material: bool,
    bounce_combo: usize,
    rage_t: f64,
    agg_skills: &SkillAggregate,
    crit_roll: f64,
) -> (f64, bool) {
    player_damage(base_damage, weapon, mom_speed, has_material, bounce_combo, rage_t, agg_skills, crit_roll)
}

/// Result of a monster hit resolution.
#[derive(Debug, Clone, PartialEq)]
pub struct MonsterHitResult {
    pub damage_dealt: f64,
    pub killed: bool,
    pub hitstop_t: f64,
    pub shake_t: f64,
    pub was_crit: bool,
    pub refused_by_gate: bool,
    pub gold_awarded: i64,
    pub xp_awarded: usize,
    pub pin_strike_awarded: bool,
}

/// 1:1 damageZombie port.
pub fn damage_zombie(
    monster: &mut LiveMonster,
    damage: f64,
    dir_x: f64,
    dir_z: f64,
    push: f64,
    force: bool,
    source: DamageSource,
    mom_speed: f64,
    greed_t: f64,
    pin_kills_in_window: usize,
    ztype: Option<ZombieType>,
    is_boss: bool,
) -> MonsterHitResult {
    let mut res = MonsterHitResult {
        damage_dealt: 0.0,
        killed: false,
        hitstop_t: 0.0,
        shake_t: 0.0,
        was_crit: false,
        refused_by_gate: false,
        gold_awarded: 0,
        xp_awarded: 0,
        pin_strike_awarded: false,
    };

    if monster.mode == EnemyMode::Dead {
        return res;
    }

    // Death Dealer immunity
    if monster.kind == EnemyKind::Reaper && !force {
        res.refused_by_gate = true;
        return res;
    }

    // Ghost drifting immunity
    if !force && monster.kind == EnemyKind::Ghost && monster.vuln_t <= 0.0 && monster.mode != EnemyMode::Windup {
        res.refused_by_gate = true;
        return res;
    }

    // Subtype bounce exception
    if !force && ztype == Some(ZombieType::Runner) && source == DamageSource::Bounce {
        // Shove lands without damage
        if push > 0.0 {
            let d = (dir_x * dir_x + dir_z * dir_z).sqrt().max(1e-4);
            monster.x += (dir_x / d) * push;
            monster.z += (dir_z / d) * push;
        }
        res.refused_by_gate = true;
        return res;
    }

    let final_damage = damage;

    monster.hp -= final_damage;
    res.damage_dealt = final_damage;
    res.hitstop_t = HITSTOP_HIT;
    res.shake_t = SHAKE_ON_HIT;

    // Push monster
    if push > 0.0 {
        let d = (dir_x * dir_x + dir_z * dir_z).sqrt().max(1e-4);
        monster.x += (dir_x / d) * push;
        monster.z += (dir_z / d) * push;
    }

    if monster.hp <= 0.0 {
        monster.mode = EnemyMode::Dead;
        res.killed = true;
        res.hitstop_t = if is_boss { HITSTOP_KILL * 2.5 } else { HITSTOP_KILL };
        res.shake_t = SHAKE_ON_KILL;

        let greed_mult = if greed_t > 0.0 { GREED_GOLD_MULT } else { 1.0 };
        let drop_mult = ztype.map(type_drop_mult).unwrap_or(1.0);
        let base_gold = ((GOLD_PER_KILL as f64) * greed_mult * drop_mult).round() as i64;
        res.gold_awarded += base_gold.max(1);

        if mom_speed > 0.0 {
            let style_bonus = (combo_kill_gold(pin_kills_in_window) as f64 * greed_mult).floor() as i64;
            res.gold_awarded += style_bonus;
        }

        if monster.kind == EnemyKind::Pin && pin_kills_in_window + 1 >= PIN_STRIKE_COUNT {
            res.pin_strike_awarded = true;
            res.gold_awarded += PIN_STRIKE_GOLD;
        }

        res.xp_awarded = if is_boss { XP_KILL_BOSS } else { XP_KILL };
    }

    res
}

/// Backward-compatible damage_monster alias.
pub fn damage_monster(
    monster: &mut LiveMonster,
    damage: f64,
    dir_x: f64,
    dir_z: f64,
    push: f64,
    force: bool,
    source: DamageSource,
    mom_speed: f64,
    greed_t: f64,
    pin_kills_in_window: usize,
    ztype: Option<ZombieType>,
    is_boss: bool,
) -> MonsterHitResult {
    damage_zombie(monster, damage, dir_x, dir_z, push, force, source, mom_speed, greed_t, pin_kills_in_window, ztype, is_boss)
}

/// 1:1 killZombie port.
pub fn kill_zombie(monster: &mut LiveMonster) {
    monster.mode = EnemyMode::Dead;
    monster.hp = 0.0;
    monster.stagger_t = 0.0;
    monster.windup_t = 0.0;
}

/// Result of player taking damage.
#[derive(Debug, Clone, PartialEq)]
pub struct PlayerHurtResult {
    pub damage_taken: i32,
    pub hp_damage: i32,
    pub died: bool,
    pub iframes: f64,
    pub flash_t: f64,
    pub hitstop_t: f64,
    pub shake_t: f64,
    pub material_drained: bool,
}

/// Applies monster hit damage to the player (1:1 hitPlayer).
pub fn hit_player(
    raw_damage: i32,
    hit_from_x: f64,
    hit_from_z: f64,
    player_x: &mut f64,
    player_z: &mut f64,
    player_hp: &mut i32,
    player_iframes: &mut f64,
    player_flash_t: &mut f64,
    stone_t: f64,
    shield_t: f64,
    is_heavy_hitter: bool,
    gear: &mut HashMap<String, u32>,
    has_diamond_material: bool,
    is_sapper: bool,
) -> Option<PlayerHurtResult> {
    if *player_hp <= 0 || *player_iframes > 0.0 || shield_t > 0.0 {
        return None;
    }

    // Stoneskin mitigation
    let dmg = if stone_t > 0.0 {
        ((raw_damage as f64) * STONESKIN_DAMAGE_MULT).ceil() as i32
    } else {
        raw_damage
    };

    let absorbed = absorb_damage(gear, dmg);
    *player_hp -= absorbed.hp_damage;
    *player_iframes = PLAYER_IFRAMES;
    *player_flash_t = FLASH_TIME;

    // Knockback
    let knockback = if is_heavy_hitter { BRUTE_KNOCKBACK } else { KNOCKBACK_PLAYER };
    let dx = *player_x - hit_from_x;
    let dz = *player_z - hit_from_z;
    let d = (dx * dx + dz * dz).sqrt().max(1e-4);
    *player_x += (dx / d) * knockback;
    *player_z += (dz / d) * knockback;

    let material_drained = is_sapper && !has_diamond_material;

    Some(PlayerHurtResult {
        damage_taken: dmg,
        hp_damage: absorbed.hp_damage,
        died: *player_hp <= 0,
        iframes: PLAYER_IFRAMES,
        flash_t: FLASH_TIME,
        hitstop_t: HITSTOP_HIT,
        shake_t: if absorbed.hp_damage > 0 { 0.25 } else { 0.12 },
        material_drained,
    })
}

/// Backward-compatible hurt_player alias.
pub fn hurt_player(
    raw_damage: i32,
    hit_from_x: f64,
    hit_from_z: f64,
    player_x: &mut f64,
    player_z: &mut f64,
    player_hp: &mut i32,
    player_iframes: &mut f64,
    player_flash_t: &mut f64,
    stone_t: f64,
    shield_t: f64,
    is_heavy_hitter: bool,
    gear: &mut HashMap<String, u32>,
    has_diamond_material: bool,
    is_sapper: bool,
) -> Option<PlayerHurtResult> {
    hit_player(raw_damage, hit_from_x, hit_from_z, player_x, player_z, player_hp, player_iframes, player_flash_t, stone_t, shield_t, is_heavy_hitter, gear, has_diamond_material, is_sapper)
}

/// 1:1 hitPlayerRanged port.
pub fn hit_player_ranged(
    raw_damage: i32,
    src_x: f64,
    src_z: f64,
    player_x: &mut f64,
    player_z: &mut f64,
    player_hp: &mut i32,
    player_iframes: &mut f64,
    player_flash_t: &mut f64,
    stone_t: f64,
    shield_t: f64,
    gear: &mut HashMap<String, u32>,
) -> Option<PlayerHurtResult> {
    if *player_hp <= 0 || *player_iframes > 0.0 || shield_t > 0.0 {
        return None;
    }

    let dmg = if stone_t > 0.0 {
        ((raw_damage as f64) * STONESKIN_DAMAGE_MULT).ceil() as i32
    } else {
        raw_damage
    };

    let absorbed = absorb_damage(gear, dmg);
    *player_hp -= absorbed.hp_damage;
    *player_iframes = PLAYER_IFRAMES;
    *player_flash_t = FLASH_TIME;

    let dx = *player_x - src_x;
    let dz = *player_z - src_z;
    let d = (dx * dx + dz * dz).sqrt().max(1e-4);
    *player_x += (dx / d) * (KNOCKBACK_PLAYER * 0.5);
    *player_z += (dz / d) * (KNOCKBACK_PLAYER * 0.5);

    Some(PlayerHurtResult {
        damage_taken: dmg,
        hp_damage: absorbed.hp_damage,
        died: *player_hp <= 0,
        iframes: PLAYER_IFRAMES,
        flash_t: FLASH_TIME,
        hitstop_t: HITSTOP_HIT,
        shake_t: if absorbed.hp_damage > 0 { 0.2 } else { 0.1 },
        material_drained: false,
    })
}

/// 1:1 webPlayer port.
pub fn web_player(webbed_t: &mut f64, flash_t: &mut f64) {
    *webbed_t = 3.0; // WEB_TIME
    *flash_t = 0.2;
}

/// 1:1 updateFlash port.
pub fn update_flash(flash_t: &mut f64, dt: f64) {
    if *flash_t > 0.0 {
        *flash_t = (*flash_t - dt).max(0.0);
    }
}

/// 1:1 MeleeScale struct.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MeleeScale {
    pub damage_mul: f64,
    pub arc_mul: f64,
    pub range_mul: f64,
    pub knockback_mul: f64,
    pub hitstop_mul: Option<f64>,
}

impl Default for MeleeScale {
    fn default() -> Self {
        Self {
            damage_mul: 1.0,
            arc_mul: 1.0,
            range_mul: 1.0,
            knockback_mul: 1.0,
            hitstop_mul: None,
        }
    }
}

/// 1:1 degradeWeapon port.
pub fn degrade_weapon(w: &mut Weapon) -> bool {
    if let Some(dur) = w.durability.as_mut() {
        if *dur > 0 {
            *dur -= 1;
            *dur <= 0
        } else {
            true
        }
    } else {
        false
    }
}

/// 1:1 wearActiveWeapon port.
pub fn wear_active_weapon(weapon: &mut Option<Weapon>) -> bool {
    if let Some(w) = weapon.as_mut() {
        let broke = degrade_weapon(w);
        if broke {
            *weapon = None;
            true
        } else {
            false
        }
    } else {
        false
    }
}

/// Thunderbolt line-AoE resolution.
pub fn resolve_thunderbolt(
    struck_x: f64,
    struck_z: f64,
    dir_x: f64,
    dir_z: f64,
    monsters: &mut [LiveMonster],
) -> usize {
    let d = (dir_x * dir_x + dir_z * dir_z).sqrt().max(1e-4);
    let nx = dir_x / d;
    let nz = dir_z / d;
    let mut hits = 0;

    for m in monsters.iter_mut() {
        if m.mode == EnemyMode::Dead {
            continue;
        }
        let rx = m.x - struck_x;
        let rz = m.z - struck_z;
        let along = rx * nx + rz * nz;
        if along < -0.4 || along > CARD_BOLT_LENGTH {
            continue;
        }
        let perp = (rx * -nz + rz * nx).abs();
        if perp > CARD_BOLT_HALF_WIDTH {
            continue;
        }
        m.hp -= CARD_BOLT_DAMAGE as f64;
        if m.hp <= 0.0 {
            m.mode = EnemyMode::Dead;
        }
        hits += 1;
    }

    hits
}

/// 1:1 applyCardOnHit port.
pub fn apply_card_on_hit(
    struck: &mut LiveMonster,
    weapon: Option<&Weapon>,
    player_hp: &mut i32,
    player_max_hp: i32,
    venom_coat_t: f64,
    all_monsters: &mut [LiveMonster],
) {
    if let Some(w) = weapon {
        if !w.cards.is_empty() {
            let agg = aggregate_cards(&w.cards);
            if agg.lifesteal > 0 && *player_hp < player_max_hp {
                *player_hp = (*player_hp + agg.lifesteal).min(player_max_hp);
            }
            if agg.bolt {
                resolve_thunderbolt(struck.x, struck.z, 1.0, 0.0, all_monsters);
            }
        }
    }
    if venom_coat_t > 0.0 {
        // Venom coat applies burn/poison DoT
        struck.hp = (struck.hp - 1.0).max(0.0);
    }
}

/// Reset combat juice state.
pub fn reset_combat_juice() {}

/// Tick combat timers.
pub fn tick_combat_timers(_dt: f64) {}

/// Sync actor mesh texel snapping.
pub fn sync_actor_mesh(x: f64, z: f64) -> (f64, f64) {
    let u = (x - z) * ISO;
    let v = (x + z) * ISO;
    let su = (u * 56.0).round() / 56.0;
    let sv = (v * 56.0).round() / 56.0;
    ((sv + su) * ISO, (sv - su) * ISO)
}
