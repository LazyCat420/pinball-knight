//! 🔮 MULTI-BALL — The pinball power-up trail follower and echo knights.
//!
//! PORTS: `entities/multiball.ts`

use std::collections::HashMap;
use crate::state::Player;
use crate::zombie_ai::{EnemyMode, LiveEnemy};

pub const MULTIBALL_COUNT: usize = 2;
pub const MULTIBALL_TRAIL_SECONDS: f64 = 1.2;
pub const MULTIBALL_LAGS: [f64; 2] = [0.12, 0.24];
pub const MULTIBALL_SIDE_OFFSET: f64 = 0.55;
pub const MULTIBALL_HEADING_STEP: f64 = 0.04;
pub const MULTIBALL_FOLLOW_RATE: f64 = 18.0;
pub const MULTIBALL_RAM_MULT: f64 = 0.5;
pub const MULTIBALL_RAM_COOLDOWN: f64 = 0.35;
pub const MULTIBALL_OPACITY: f64 = 0.55;
pub const BALL_RAM_KNOCKBACK: f64 = 12.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TrailPoint {
    pub x: f64,
    pub z: f64,
    pub t: f64,
}

pub fn push_trail(
    points: &mut Vec<TrailPoint>,
    x: f64,
    z: f64,
    t: f64,
    max_age: f64,
) {
    points.push(TrailPoint { x, z, t });
    let cutoff = t - max_age;
    while points.len() > 2 && points[1].t <= cutoff {
        points.remove(0);
    }
}

pub fn sample_trail(points: &[TrailPoint], t: f64) -> Option<(f64, f64)> {
    if points.is_empty() {
        return None;
    }
    let first = points[0];
    let last = points[points.len() - 1];
    if t <= first.t {
        return Some((first.x, first.z));
    }
    if t >= last.t {
        return Some((last.x, last.z));
    }
    for i in (1..points.len()).rev() {
        let b = points[i];
        let a = points[i - 1];
        if t >= a.t {
            let span = b.t - a.t;
            let f = if span > 0.0 { (t - a.t) / span } else { 0.0 };
            return Some((a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f));
        }
    }
    Some((first.x, first.z))
}

pub fn echo_target(
    points: &[TrailPoint],
    now: f64,
    lag: f64,
    side: f64,
    heading_step: f64,
) -> Option<(f64, f64)> {
    let at = sample_trail(points, now - lag)?;
    let before = match sample_trail(points, now - lag - heading_step) {
        Some(b) => b,
        None => return Some(at),
    };
    let dx = at.0 - before.0;
    let dz = at.1 - before.1;
    let len = (dx * dx + dz * dz).sqrt();
    if len < 1e-4 {
        return Some(at);
    }
    Some((at.0 + (-dz / len) * side, at.1 + (dx / len) * side))
}

pub fn follow_step(current: f64, target: f64, dt: f64, rate: f64) -> f64 {
    let f = 1.0 - (-rate * dt).exp();
    current + (target - current) * f
}

#[derive(Debug, Clone)]
pub struct EchoKnight {
    pub x: f64,
    pub z: f64,
    pub lag: f64,
    pub side: f64,
    pub hit_cd: HashMap<u32, f64>,
}

#[derive(Debug, Clone, Default)]
pub struct MultiBallSystem {
    pub clock: f64,
    pub trail: Vec<TrailPoint>,
    pub echoes: Vec<EchoKnight>,
    pub duration_t: f64,
}

impl MultiBallSystem {
    pub fn is_active(&self) -> bool {
        self.duration_t > 0.0 && !self.echoes.is_empty()
    }

    pub fn activate(&mut self, player_x: f64, player_z: f64, duration: f64) {
        self.clock = 0.0;
        self.duration_t = duration;
        self.trail.clear();
        self.trail.push(TrailPoint {
            x: player_x,
            z: player_z,
            t: 0.0,
        });
        self.echoes.clear();
        for i in 0..MULTIBALL_COUNT {
            let lag = MULTIBALL_LAGS[i.min(MULTIBALL_LAGS.len() - 1)];
            let side = if i % 2 == 0 { 1.0 } else { -1.0 } * MULTIBALL_SIDE_OFFSET;
            self.echoes.push(EchoKnight {
                x: player_x,
                z: player_z,
                lag,
                side,
                hit_cd: HashMap::new(),
            });
        }
    }

    pub fn tick(
        &mut self,
        player: &Player,
        enemies: &mut [LiveEnemy],
        dt: f64,
    ) {
        if self.duration_t <= 0.0 {
            self.echoes.clear();
            return;
        }
        self.duration_t = (self.duration_t - dt).max(0.0);
        if self.duration_t <= 0.0 {
            self.echoes.clear();
            return;
        }

        self.clock += dt;
        push_trail(
            &mut self.trail,
            player.x,
            player.z,
            self.clock,
            MULTIBALL_TRAIL_SECONDS,
        );

        let reach = 0.35 + 0.38 + 0.15;
        let reach_sq = reach * reach;
        let base_damage = 25.0 * MULTIBALL_RAM_MULT;

        for echo in &mut self.echoes {
            if let Some(target) = echo_target(&self.trail, self.clock, echo.lag, echo.side, MULTIBALL_HEADING_STEP) {
                echo.x = follow_step(echo.x, target.0, dt, MULTIBALL_FOLLOW_RATE);
                echo.z = follow_step(echo.z, target.1, dt, MULTIBALL_FOLLOW_RATE);
            }

            // Tick hit cooldowns
            echo.hit_cd.retain(|_, cd| {
                *cd -= dt;
                *cd > 0.0
            });

            // Contact ram vs enemies
            for enemy in enemies.iter_mut() {
                if enemy.mode == EnemyMode::Dead {
                    continue;
                }
                let dx = enemy.x - echo.x;
                let dz = enemy.z - echo.z;
                if dx * dx + dz * dz > reach_sq {
                    continue;
                }
                if echo.hit_cd.contains_key(&enemy.id) {
                    continue;
                }

                let hit_res = crate::combat::resolve_enemy_hit(
                    enemy.hp,
                    enemy.max_hp,
                    base_damage,
                    dx,
                    dz,
                    BALL_RAM_KNOCKBACK * 0.6,
                    player.bounce_combo,
                    player.mom_speed,
                );
                enemy.hp = (enemy.hp - hit_res.damage_dealt).max(0.0);
                if hit_res.is_kill {
                    enemy.mode = EnemyMode::Dead;
                } else {
                    enemy.mode = EnemyMode::Stagger;
                    enemy.stagger_t = 0.3;
                }
                enemy.vx += hit_res.knockback_x * 4.0;
                enemy.vz += hit_res.knockback_z * 4.0;

                echo.hit_cd.insert(enemy.id, MULTIBALL_RAM_COOLDOWN);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trail_sampling_interpolates_smoothly() {
        let mut trail = Vec::new();
        push_trail(&mut trail, 0.0, 0.0, 0.0, 1.0);
        push_trail(&mut trail, 10.0, 0.0, 1.0, 1.0);

        let mid = sample_trail(&trail, 0.5).unwrap();
        assert!((mid.0 - 5.0).abs() < 1e-4);
        assert!((mid.1 - 0.0).abs() < 1e-4);
    }

    #[test]
    fn echo_knights_follow_and_ram_enemies() {
        let mut mb = MultiBallSystem::default();
        mb.activate(0.0, 0.0, 10.0);
        assert_eq!(mb.echoes.len(), 2);

        let player = Player {
            x: 5.0,
            z: 0.0,
            ..Default::default()
        };
        let mut enemies = vec![LiveEnemy::new_by_index(1, 0, 0.2, 0.0)];
        let hp_before = enemies[0].hp;

        // Step multi-ball
        for _ in 0..10 {
            mb.tick(&player, &mut enemies, 0.05);
        }

        assert!(enemies[0].hp < hp_before);
    }
}
