//! ☠ THE REAPER KING — The end-of-run boss that gates the exit portal.
//!
//! PORTS: `boss.ts`

use crate::collide::move_circle;
use crate::grid::Grid;
use crate::state::Player;

pub const REAPER_SCALE: f64 = 1.35;
pub const BRUTE_R: f64 = 0.42;
pub const KING_SCALE: f64 = REAPER_SCALE * 1.55;
pub const KING_BODY_R: f64 = BRUTE_R * KING_SCALE * 0.86;

pub const KING_WAKE_TILES: f64 = 26.0;
pub const KING_LEASH_TILES: f64 = 34.0;
pub const KING_HOME_TILES: f64 = 2.5;
pub const KING_RETURN_SPEED: f64 = 0.75;
pub const KING_BASE_SPEED: f64 = 1.8;

pub const SKULL_COUNT: usize = 5;
pub const SKULL_ORBIT_R: f64 = 1.5;
pub const SKULL_ORBIT_SPEED: f64 = 1.1; // rad/s
pub const SKULL_Y: f64 = 1.5;

pub const SLAM_INTERVAL: f64 = 4.2;
pub const SLAM_TELEGRAPH: f64 = 1.1;
pub const SLAM_RADIUS: f64 = 2.4;
pub const SLAM_DAMAGE: i32 = 3;
pub const SLAM_LAUNCH: f64 = 16.0;

pub const BARRAGE_INTERVAL: f64 = 2.6;
pub const BONE_SPEED: f64 = 9.0;
pub const BONE_DAMAGE: i32 = 1;
pub const BONE_MAX_DIST: f64 = 16.0;
pub const BONE_HIT_R: f64 = 0.55;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlamPhase {
    Idle,
    Telegraph,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Bone {
    pub x: f64,
    pub z: f64,
    pub vx: f64,
    pub vz: f64,
    pub dist: f64,
}

#[derive(Debug, Clone, Default)]
pub struct BossEvents {
    pub slam_telegraphed: bool,
    pub slam_executed: bool,
    pub slam_pos: (f64, f64),
    pub bone_fired: bool,
    pub portal_opened: bool,
}

#[derive(Debug, Clone)]
pub struct BossKingState {
    pub x: f64,
    pub z: f64,
    pub anchor_x: f64,
    pub anchor_z: f64,
    pub hp: i32,
    pub max_hp: i32,
    pub engaged: bool,
    pub returning_home: bool,
    pub slam_t: f64,
    pub slam_phase: SlamPhase,
    pub slam_x: f64,
    pub slam_z: f64,
    pub barrage_t: f64,
    pub skull_angle: f64,
    pub bones: Vec<Bone>,
    pub opened: bool,
    pub portal_rot: f64,
    pub scaled_for: usize,
}

impl BossKingState {
    pub fn new(anchor_x: f64, anchor_z: f64, floor: u32) -> Self {
        let hp = 40 + (floor as i32) * 25;
        Self {
            x: anchor_x,
            z: anchor_z,
            anchor_x,
            anchor_z,
            hp,
            max_hp: hp,
            engaged: false,
            returning_home: false,
            slam_t: SLAM_INTERVAL,
            slam_phase: SlamPhase::Idle,
            slam_x: 0.0,
            slam_z: 0.0,
            barrage_t: BARRAGE_INTERVAL,
            skull_angle: 0.0,
            bones: Vec::new(),
            opened: false,
            portal_rot: 0.0,
            scaled_for: 1,
        }
    }

    pub fn is_active(&self) -> bool {
        !self.opened && self.hp > 0
    }

    pub fn tick_orbit(&mut self, dt: f64) {
        self.skull_angle += SKULL_ORBIT_SPEED * dt;
        while self.skull_angle > std::f64::consts::TAU {
            self.skull_angle -= std::f64::consts::TAU;
        }
        self.slam_t = (self.slam_t - dt).max(0.0);
    }

    pub fn step(
        &mut self,
        player: &mut Player,
        grid: &Grid,
        dt: f64,
        path_distance_to_player: Option<f64>,
    ) -> BossEvents {
        let mut events = BossEvents::default();

        if !self.opened && self.hp <= 0 {
            self.opened = true;
            events.portal_opened = true;
            return events;
        }

        if self.opened {
            self.portal_rot += dt * 1.5;
            self.update_bones(player, dt);
            return events;
        }

        let home_d = ((self.x - self.anchor_x).powi(2) + (self.z - self.anchor_z).powi(2)).sqrt();
        let path_d = path_distance_to_player.unwrap_or(std::f64::INFINITY);

        if !self.engaged {
            if path_d <= KING_WAKE_TILES {
                self.engaged = true;
                self.returning_home = false;
            }
        } else if home_d > KING_LEASH_TILES {
            self.engaged = false;
            self.returning_home = true;
        }

        if !self.engaged {
            if home_d > KING_HOME_TILES {
                let step = KING_BASE_SPEED * KING_RETURN_SPEED * dt;
                let dx = (self.anchor_x - self.x) / home_d;
                let dz = (self.anchor_z - self.z) / home_d;
                let res = move_circle(grid, self.x, self.z, KING_BODY_R, dx * step, dz * step);
                self.x = res.x;
                self.z = res.z;
            }
            self.update_bones(player, dt);
            return events;
        }

        // Active combat hunting
        let target_x = player.x;
        let target_z = player.z;
        let p_dx = target_x - self.x;
        let p_dz = target_z - self.z;
        let p_dist = (p_dx * p_dx + p_dz * p_dz).sqrt().max(1e-4);

        if p_dist > 1.2 {
            let step = KING_BASE_SPEED * dt;
            let res = move_circle(grid, self.x, self.z, KING_BODY_R, (p_dx / p_dist) * step, (p_dz / p_dist) * step);
            self.x = res.x;
            self.z = res.z;
        }

        // Orbit skulls
        self.skull_angle += SKULL_ORBIT_SPEED * dt;
        while self.skull_angle > std::f64::consts::TAU {
            self.skull_angle -= std::f64::consts::TAU;
        }

        // Skull projectile barrage
        self.barrage_t -= dt;
        if self.barrage_t <= 0.0 {
            self.barrage_t = BARRAGE_INTERVAL;
            self.fire_bone(target_x, target_z);
            events.bone_fired = true;
        }
        self.update_bones(player, dt);

        // Tentacle ground slam
        self.slam_t -= dt;
        if self.slam_phase == SlamPhase::Idle && self.slam_t <= SLAM_TELEGRAPH {
            self.slam_phase = SlamPhase::Telegraph;
            self.slam_x = target_x;
            self.slam_z = target_z;
            events.slam_telegraphed = true;
            events.slam_pos = (self.slam_x, self.slam_z);
        }

        if self.slam_phase == SlamPhase::Telegraph && self.slam_t <= 0.0 {
            self.slam_phase = SlamPhase::Idle;
            self.slam_t = SLAM_INTERVAL;
            self.do_slam(player);
            events.slam_executed = true;
            events.slam_pos = (self.slam_x, self.slam_z);
        }

        events
    }

    fn fire_bone(&mut self, target_x: f64, target_z: f64) {
        let dx = target_x - self.x;
        let dz = target_z - self.z;
        let len = (dx * dx + dz * dz).sqrt().max(1e-4);
        self.bones.push(Bone {
            x: self.x,
            z: self.z,
            vx: (dx / len) * BONE_SPEED,
            vz: (dz / len) * BONE_SPEED,
            dist: 0.0,
        });
    }

    fn update_bones(&mut self, player: &mut Player, dt: f64) {
        for i in (0..self.bones.len()).rev() {
            self.bones[i].x += self.bones[i].vx * dt;
            self.bones[i].z += self.bones[i].vz * dt;
            let step = (self.bones[i].vx.powi(2) + self.bones[i].vz.powi(2)).sqrt() * dt;
            self.bones[i].dist += step;

            let p_dx = player.x - self.bones[i].x;
            let p_dz = player.z - self.bones[i].z;
            let hit = (p_dx * p_dx + p_dz * p_dz).sqrt() < BONE_HIT_R;
            if hit {
                if player.iframes <= 0.0 {
                    player.hp = (player.hp - BONE_DAMAGE).max(0);
                    player.iframes = 0.35;
                }
            }

            if hit || self.bones[i].dist > BONE_MAX_DIST {
                self.bones.swap_remove(i);
            }
        }
    }

    fn do_slam(&mut self, player: &mut Player) {
        let dx = player.x - self.slam_x;
        let dz = player.z - self.slam_z;
        let dist = (dx * dx + dz * dz).sqrt();
        if dist <= SLAM_RADIUS {
            if player.iframes <= 0.0 {
                player.hp = (player.hp - SLAM_DAMAGE).max(0);
                player.iframes = 0.35;
            }
            let len = dist.max(1e-4);
            player.mom_x = dx / len;
            player.mom_z = dz / len;
            player.mom_speed = player.mom_speed.max(SLAM_LAUNCH);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grid::{set_tile, Grid, T_FLOOR};

    #[test]
    fn boss_hp_scales_with_floor() {
        let b1 = BossKingState::new(0.0, 0.0, 1);
        let b2 = BossKingState::new(0.0, 0.0, 2);
        assert_eq!(b2.hp - b1.hp, 25);
    }

    #[test]
    fn king_body_r_is_positive() {
        assert!(KING_BODY_R > 0.0);
    }

    #[test]
    fn reaper_king_leash_and_combat() {
        let mut grid = Grid::solid(50, 50);
        for i in 1..49 {
            for j in 1..49 {
                set_tile(&mut grid, i, j, T_FLOOR);
            }
        }
        let mut boss = BossKingState::new(25.0, 25.0, 1);
        let mut player = Player {
            x: 27.0,
            z: 25.0,
            ..Default::default()
        };

        // Within wake distance: boss wakes up
        let events = boss.step(&mut player, &grid, 0.1, Some(5.0));
        assert!(boss.engaged);

        // Step past barrage interval: bone projectile fired
        let mut fired = events.bone_fired;
        for _ in 0..30 {
            let ev = boss.step(&mut player, &grid, 0.1, Some(5.0));
            if ev.bone_fired {
                fired = true;
                break;
            }
        }
        assert!(fired);
        assert!(!boss.bones.is_empty());
    }
}
