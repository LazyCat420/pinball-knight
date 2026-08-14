//! Melee combat timelines, combo chain acceleration, and attack resolution.
//!
//! Port of `legacy/src/game/pinball-knight/constants/player.ts:150-250` and
//! `legacy/src/game/pinball-knight/entities/player.ts:2314-2446`.
//!
//! PORTS: `constants/player.ts:150-250`
//! PORTS-PARTIAL: `entities/player.ts:2314-2446` — melee attack timeline, combo chain, and forward lunge step

use crate::collide::move_circle;
use crate::state::{Facing, Player, PLAYER_R};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MoveTag {
    Light1,
    Light2,
    Finish,
    Surge,
    Heavy,
    Wallride,
    Pounce,
    Wallkick,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MoveTiming {
    pub tag: MoveTag,
    pub windup: f64,
    pub active: f64,
    pub recovery: f64,
    pub damage_mul: f64,
    pub arc_mul: f64,
    pub range_mul: f64,
    pub knockback_mul: f64,
    pub hitstop_mul: f64,
}

pub const LIGHT_1: MoveTiming = MoveTiming {
    tag: MoveTag::Light1,
    windup: 0.10,
    active: 0.05,
    recovery: 0.12,
    damage_mul: 1.0,
    arc_mul: 1.0,
    range_mul: 1.0,
    knockback_mul: 1.0,
    hitstop_mul: 1.0,
};

pub const LIGHT_2: MoveTiming = MoveTiming {
    tag: MoveTag::Light2,
    windup: 0.06,
    active: 0.05,
    recovery: 0.09,
    damage_mul: 1.15,
    arc_mul: 1.15,
    range_mul: 1.05,
    knockback_mul: 1.1,
    hitstop_mul: 1.1,
};

pub const COMBO_FINISH: MoveTiming = MoveTiming {
    tag: MoveTag::Finish,
    windup: 0.11,
    active: 0.07,
    recovery: 0.16,
    damage_mul: 2.0,
    arc_mul: 1.6,
    range_mul: 1.25,
    knockback_mul: 2.0,
    hitstop_mul: 1.8,
};

pub const COMBO_SURGE: MoveTiming = MoveTiming {
    tag: MoveTag::Surge,
    windup: 0.13,
    active: 0.09,
    recovery: 0.20,
    damage_mul: 2.8,
    arc_mul: 1.9,
    range_mul: 1.35,
    knockback_mul: 2.8,
    hitstop_mul: 2.1,
};

pub const HEAVY: MoveTiming = MoveTiming {
    tag: MoveTag::Heavy,
    windup: 0.24,
    active: 0.08,
    recovery: 0.28,
    damage_mul: 2.2,
    arc_mul: 1.5,
    range_mul: 1.15,
    knockback_mul: 2.6,
    hitstop_mul: 1.8,
};

pub const WALLRIDE: MoveTiming = MoveTiming {
    tag: MoveTag::Wallride,
    windup: 0.08,
    active: 0.14,
    recovery: 0.18,
    damage_mul: 1.8,
    arc_mul: 2.0,
    range_mul: 1.3,
    knockback_mul: 1.5,
    hitstop_mul: 1.4,
};

pub const COMBO_CHAIN: [MoveTiming; 4] = [LIGHT_1, LIGHT_2, COMBO_FINISH, COMBO_SURGE];
pub const COMBO_MAX_STEP: u32 = 3;
pub const COMBO_WINDOW: f64 = 0.34;
pub const COMBO_WINDOW_HEFT_MULT: f64 = 0.75;
pub const CHARGE_TIME: f64 = 0.60;
pub const INPUT_BUFFER: f64 = 0.13;
pub const COMBO_RAMP: f64 = 0.92;
pub const COMBO_RAMP_FLOOR: f64 = 0.70;

pub fn scale_move(move_timing: MoveTiming, heft: f64) -> MoveTiming {
    if (heft - 1.0).abs() < 1e-4 {
        return move_timing;
    }
    MoveTiming {
        windup: move_timing.windup * heft,
        recovery: move_timing.recovery * heft,
        ..move_timing
    }
}

/// Facing vector helper: S/N/E/W -> world vector (dx, dz)
pub fn facing_vec(facing: Facing) -> (f64, f64) {
    match facing {
        Facing::S => (0.0, 1.0),
        Facing::N => (0.0, -1.0),
        Facing::E => (1.0, 0.0),
        Facing::W => (-1.0, 0.0),
    }
}

/// Updates melee attack input and state transition
pub fn update_melee(
    player: &mut Player,
    grid: &crate::grid::Grid,
    dt: f64,
    attack_held: bool,
    attack_just_pressed: bool,
    heft: f64,
) {
    let attacking = player.attack_t >= 0.0;
    let can_start_swing = player.cooldown <= 0.0 && (!attacking || player.combo_window_t > 0.0);

    if attack_just_pressed {
        player.attack_buffer_t = INPUT_BUFFER;
    } else {
        player.attack_buffer_t = (player.attack_buffer_t - dt).max(0.0);
    }

    if attack_held {
        if player.charge_t < 0.0 {
            player.charge_t = 0.0;
        }
        player.charge_t += dt;
    }

    // Heavy attack trigger on hold threshold
    if attack_held && player.charge_t >= CHARGE_TIME && can_start_swing {
        player.charge_t = -1.0;
        player.attack_buffer_t = 0.0;
        start_melee(player, grid, scale_move(HEAVY, heft), 0);
        return;
    }

    let want_light = (attack_just_pressed || player.attack_buffer_t > 0.0) && can_start_swing;
    if want_light {
        player.attack_buffer_t = 0.0;
        player.charge_t = -1.0;
        let base = COMBO_CHAIN[player.combo_step.min(COMBO_CHAIN.len() as u32 - 1) as usize];
        let ramp = COMBO_RAMP_FLOOR.max(COMBO_RAMP.powi(player.combo_step as i32));
        let move_timing = scale_move(base, heft * ramp);
        let next_step = if player.combo_step >= COMBO_MAX_STEP {
            0
        } else {
            player.combo_step + 1
        };
        start_melee(player, grid, move_timing, next_step);
    }
}

/// Begins a melee swing: sets the move timeline, step, and steps forward
pub fn start_melee(
    player: &mut Player,
    grid: &crate::grid::Grid,
    move_timing: MoveTiming,
    next_step: u32,
) {
    player.move_timing = Some(move_timing);
    player.combo_step = next_step;
    player.attack_t = 0.0;
    player.did_hit = false;
    player.combo_landed = false;
    player.combo_window_t = 0.0;
    player.cooldown = 0.0;

    let (fx, fz) = facing_vec(player.facing);
    let lunge = match move_timing.tag {
        MoveTag::Surge => 0.60,
        MoveTag::Finish => 0.45,
        MoveTag::Light2 => 0.22,
        MoveTag::Heavy => 0.10,
        _ => 0.14,
    };
    if lunge > 0.0 {
        let res = move_circle(grid, player.x, player.z, PLAYER_R, fx * lunge, fz * lunge);
        player.x = res.x;
        player.z = res.z;
    }
}

/// Ticks active swing timeline, handles active attack hitbox window and recovery
pub fn step_melee_timeline(
    player: &mut Player,
    dt: f64,
    heft: f64,
) -> Option<MoveTiming> {
    if player.attack_t < 0.0 {
        return None;
    }
    let Some(m) = player.move_timing else {
        player.attack_t = -1.0;
        return None;
    };

    player.attack_t += dt;
    player.combo_window_t = (player.combo_window_t - dt).max(0.0);

    let active_start = m.windup;
    let active_end = m.windup + m.active;
    let mut hit_to_resolve = None;

    if !player.did_hit && player.attack_t >= active_start && player.attack_t <= active_end {
        player.did_hit = true;
        hit_to_resolve = Some(m);
    }

    if player.attack_t >= active_end
        && player.combo_window_t <= 0.0
        && player.combo_step <= COMBO_MAX_STEP
        && player.combo_landed
    {
        player.combo_window_t = COMBO_WINDOW * (1.0 + (heft - 1.0) * COMBO_WINDOW_HEFT_MULT);
    }

    if player.attack_t >= m.windup + m.active + m.recovery {
        player.attack_t = -1.0;
        player.move_timing = None;
        if player.combo_window_t <= 0.0 {
            player.combo_step = 0;
        }
    }

    hit_to_resolve
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grid::{set_tile, Grid, T_FLOOR};

    #[test]
    fn combo_chain_progression_and_windup_ramp() {
        let mut grid = Grid::solid(10, 10);
        for i in 1..9 {
            for j in 1..9 {
                set_tile(&mut grid, i, j, T_FLOOR);
            }
        }
        let mut p = Player {
            x: 5.0,
            z: 5.0,
            facing: Facing::S,
            moving: false,
            mom_x: 0.0,
            mom_z: 0.0,
            mom_speed: 0.0,
            bounce_combo: 0.0,
            bounce_combo_t: 0.0,
            sprint_charge: 0.0,
            overcharge: 0.0,
            oil_t: 0.0,
            turbo_t: 0.0,
            spring_t: 0.0,
            iframes: 0.0,
            steer_lock_t: 0.0,
            grab_t: 0.0,
            grab_x: 0.0,
            grab_z: 0.0,
            throw_dir_x: 0.0,
            throw_dir_z: 0.0,
            throw_speed: 0.0,
            rail: crate::rail::fresh_rail(),
            roll_t: -1.0,
            roll_dir_x: 0.0,
            roll_dir_z: 0.0,
            squash_t: 0.0,
            squash_amp: 0.0,
            squash_nx: 0.0,
            squash_nz: 0.0,
            hp: 6,
            max_hp: 6,
            attack_t: -1.0,
            charge_t: -1.0,
            attack_buffer_t: 0.0,
            move_timing: None,
            combo_step: 0,
            combo_window_t: 0.0,
            combo_landed: false,
            did_hit: false,
            cooldown: 0.0,
            rage_t: 0.0,
            stone_t: 0.0,
            shield_t: 0.0,
            flash_t: 0.0,
        };

        // Step 0 -> Light 1
        update_melee(&mut p, &grid, 0.016, false, true, 1.0);
        assert_eq!(p.move_timing.unwrap().tag, MoveTag::Light1);
        assert_eq!(p.combo_step, 1);

        // Step 1 timeline
        let mut hit = None;
        for _ in 0..10 {
            if let Some(m) = step_melee_timeline(&mut p, 0.016, 1.0) {
                hit = Some(m);
            }
        }
        assert!(hit.is_some());
        assert_eq!(hit.unwrap().tag, MoveTag::Light1);
    }
}
