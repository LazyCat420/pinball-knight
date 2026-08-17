//! Player verbs execution (Melee slash, dash dodge roll, plunger launch).
//!
//! PORTS: `entities/movement.ts`

use super::types::*;
use crate::collide::move_circle;
use crate::grid::Grid;
use crate::monsters::types::LiveMonster;

#[derive(Debug, Clone, PartialEq)]
pub struct SlashHit {
    pub monster_id: u32,
    pub damage: f64,
    pub knockback_x: f64,
    pub knockback_z: f64,
}

/// Initiates a melee weapon slash swing.
pub fn trigger_melee_slash(player: &mut PlayerCoreState) -> bool {
    if player.slash.cooldown > 0.0 || player.dash.active {
        return false;
    }
    let (fx, fz) = player.facing.to_vector();
    player.slash.active = true;
    player.slash.timer = 0.12; // active hit window
    player.slash.cooldown = MELEE_COOLDOWN_BASE;
    player.slash.dir_x = fx;
    player.slash.dir_z = fz;
    true
}

/// Advances melee slash arc and checks hitboxes against monsters.
pub fn step_melee_slash(
    player: &mut PlayerCoreState,
    monsters: &mut [LiveMonster],
    dt: f64,
) -> Vec<SlashHit> {
    let mut hits = Vec::new();

    if player.slash.cooldown > 0.0 {
        player.slash.cooldown = (player.slash.cooldown - dt).max(0.0);
    }

    if !player.slash.active {
        return hits;
    }

    player.slash.timer -= dt;
    if player.slash.timer <= 0.0 {
        player.slash.active = false;
    }

    let swing_dir_x = player.slash.dir_x;
    let swing_dir_z = player.slash.dir_z;
    let reach_sq = (player.slash.reach + 0.4) * (player.slash.reach + 0.4);

    for m in monsters.iter_mut() {
        if !m.is_alive() {
            continue;
        }

        let dx = m.x - player.x;
        let dz = m.z - player.z;
        let dist_sq = dx * dx + dz * dz;

        if dist_sq <= reach_sq && dist_sq > 1e-4 {
            let dist = dist_sq.sqrt();
            let nx = dx / dist;
            let nz = dz / dist;

            // Dot product to test if target falls inside the forward swing arc
            let dot = nx * swing_dir_x + nz * swing_dir_z;
            let min_dot = (MELEE_SWING_ARC * 0.5).cos();

            if dot >= min_dot {
                let damage = player.slash.base_damage * (1.0 + player.mom_speed * 0.08);
                m.hp = (m.hp - damage).max(0.0);
                let kb_strength = 6.5 * (1.0 + player.mom_speed * 0.1);
                m.vx = nx * kb_strength;
                m.vz = nz * kb_strength;

                hits.push(SlashHit {
                    monster_id: m.id,
                    damage,
                    knockback_x: nx * kb_strength,
                    knockback_z: nz * kb_strength,
                });
            }
        }
    }

    hits
}

/// Initiates a dodge roll / dash.
pub fn trigger_dash(player: &mut PlayerCoreState, dir_x: f64, dir_z: f64) -> bool {
    if player.dash.cooldown > 0.0 || player.dash.active {
        return false;
    }

    let len = (dir_x * dir_x + dir_z * dir_z).sqrt();
    let (dx, dz) = if len > 1e-4 {
        (dir_x / len, dir_z / len)
    } else {
        player.facing.to_vector()
    };

    player.dash.active = true;
    player.dash.timer = DASH_DURATION;
    player.dash.cooldown = DASH_COOLDOWN;
    player.dash.dir_x = dx;
    player.dash.dir_z = dz;
    player.iframes = DASH_IFRAMES;
    true
}

/// Advances dash movement and obstacle collisions.
pub fn step_dash(player: &mut PlayerCoreState, grid: &Grid, dt: f64) {
    if player.dash.cooldown > 0.0 {
        player.dash.cooldown = (player.dash.cooldown - dt).max(0.0);
    }
    if player.iframes > 0.0 {
        player.iframes = (player.iframes - dt).max(0.0);
    }

    if !player.dash.active {
        return;
    }

    player.dash.timer -= dt;
    if player.dash.timer <= 0.0 {
        player.dash.active = false;
        return;
    }

    let move_dx = player.dash.dir_x * DASH_SPEED * dt;
    let move_dz = player.dash.dir_z * DASH_SPEED * dt;

    let res = move_circle(grid, player.x, player.z, PLAYER_RADIUS, move_dx, move_dz);
    player.x = res.x;
    player.z = res.z;
}

/// Advances plunger tension accumulation and chute release.
pub fn step_plunger(
    player: &mut PlayerCoreState,
    is_holding_launch: bool,
    chute_dir_x: f64,
    chute_dir_z: f64,
    dt: f64,
) -> bool {
    if is_holding_launch {
        player.plunger.pulling = true;
        player.plunger.tension =
            (player.plunger.tension + PLUNGER_PULL_RATE * dt).min(PLUNGER_MAX_TENSION);
        false
    } else if player.plunger.pulling {
        // Released! Launch the player with impulse
        let launch_speed = player.plunger.tension * PLUNGER_MAX_LAUNCH_SPEED;
        player.vx = chute_dir_x * launch_speed;
        player.vz = chute_dir_z * launch_speed;
        player.mom_speed = launch_speed;
        player.pinball_mode = true;
        player.plunger.pulling = false;
        player.plunger.tension = 0.0;
        player.plunger.launched = true;
        true
    } else {
        false
    }
}
