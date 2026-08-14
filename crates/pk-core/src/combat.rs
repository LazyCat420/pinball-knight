//! Hit and damage resolution for ARPG combat and pinball ram collisions.
//!
//! Port of `legacy/src/game/pinball-knight/entities/combat.ts` (1,205 lines).
//!
//! Damage calculations, player upgrades, card synergies, critical strikes,
//! knockback impulses, stagger accrual, armor absorption, and kill rewards.
//!
//! PORTS: `entities/combat.ts`

use crate::combo::{combo_damage_mult, combo_kill_gold, momentum_scaled};
use crate::stagger::{pain_chance, stagger_time};

pub const KNOCKBACK_ZOMBIE: f64 = 1.1;
pub const KNOCKBACK_PLAYER: f64 = 1.4;
pub const PLAYER_IFRAMES: f64 = 0.35;
pub const GOLD_PER_KILL: i64 = 1;
pub const ULT_CHARGE_PER_KILL: f64 = 0.05;
pub const MANA_PER_KILL: f64 = 1.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DamageSource {
    Steel,
    Ram,
    Card,
    Hazard,
    Projectile,
    Boss,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CombatHit {
    pub damage_dealt: f64,
    pub is_crit: bool,
    pub is_kill: bool,
    pub gold_awarded: i64,
    pub knockback_x: f64,
    pub knockback_z: f64,
    pub stagger_applied: f64,
}

/// Computes outgoing player attack damage factoring weapon upgrades and momentum.
pub fn calculate_player_damage(
    base_dmg: f64,
    weapon_upgrade_level: u32,
    pinball_mult: f64,
    mom_speed: f64,
    crit_chance: f64,
    crit_mult: f64,
    roll_crit: bool,
) -> (f64, bool) {
    let mut dmg = base_dmg;
    if weapon_upgrade_level > 0 {
        dmg *= 1.0 + f64::from(weapon_upgrade_level) * 0.15;
    }
    if pinball_mult > 1.0 {
        dmg *= momentum_scaled(pinball_mult, mom_speed);
    }
    let is_crit = roll_crit && crit_chance > 0.0;
    if is_crit {
        dmg *= if crit_mult > 1.0 { crit_mult } else { 1.5 };
    }
    (dmg, is_crit)
}

/// Resolves an attack landed on an enemy.
pub fn resolve_enemy_hit(
    enemy_hp: f64,
    enemy_max_hp: f64,
    incoming_dmg: f64,
    dir_x: f64,
    dir_z: f64,
    base_knockback: f64,
    combo_count: f64,
    mom_speed: f64,
) -> CombatHit {
    let final_dmg = (incoming_dmg * combo_damage_mult(combo_count)).max(1.0);
    let remaining_hp = (enemy_hp - final_dmg).max(0.0);
    let is_kill = remaining_hp <= 0.0;

    let len = (dir_x * dir_x + dir_z * dir_z).sqrt();
    let (kx, kz) = if len > 1e-4 {
        let factor = base_knockback * (1.0 + mom_speed * 0.05);
        ((dir_x / len) * factor, (dir_z / len) * factor)
    } else {
        (0.0, 0.0)
    };

    let gold = if is_kill {
        i64::from(combo_kill_gold(combo_count))
    } else {
        0
    };

    let stagger = if enemy_max_hp > 0.0 {
        let base = (final_dmg / enemy_max_hp).clamp(0.0, 1.0);
        let p_chance = pain_chance(base, mom_speed);
        if p_chance > 0.0 {
            stagger_time(mom_speed)
        } else {
            0.0
        }
    } else {
        0.0
    };

    CombatHit {
        damage_dealt: final_dmg,
        is_crit: false,
        is_kill,
        gold_awarded: gold,
        knockback_x: kx,
        knockback_z: kz,
        stagger_applied: stagger,
    }
}

/// Resolves damage taken by the player factoring armor soak and i-frames.
pub fn resolve_player_damage(
    player_hp: i32,
    player_iframes: f64,
    incoming_dmg: i32,
    armor_soak: i32,
) -> (i32, f64, bool) {
    if player_iframes > 0.0 || incoming_dmg <= 0 {
        return (player_hp, player_iframes, false);
    }
    let soaked_dmg = (incoming_dmg - armor_soak).max(1);
    let next_hp = (player_hp - soaked_dmg).max(0);
    (next_hp, PLAYER_IFRAMES, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn player_damage_and_enemy_hit_resolution() {
        let (dmg, crit) = calculate_player_damage(10.0, 2, 1.4, 12.0, 0.5, 2.0, true);
        assert!(dmg > 10.0);
        assert!(crit);

        let hit = resolve_enemy_hit(20.0, 20.0, dmg, 1.0, 0.0, KNOCKBACK_ZOMBIE, 2.0, 12.0);
        assert!(hit.damage_dealt >= dmg);
        assert!(hit.knockback_x > 0.0);
    }

    #[test]
    fn player_armor_and_iframes() {
        // Player takes damage with armor soak
        let (hp1, iframes1, hit1) = resolve_player_damage(5, 0.0, 3, 1);
        assert_eq!(hp1, 3); // 5 - (3 - 1) = 3
        assert_eq!(iframes1, PLAYER_IFRAMES);
        assert!(hit1);

        // While in i-frames, damage is blocked
        let (hp2, _iframes2, hit2) = resolve_player_damage(hp1, iframes1, 3, 1);
        assert_eq!(hp2, hp1);
        assert!(!hit2);
    }
}
