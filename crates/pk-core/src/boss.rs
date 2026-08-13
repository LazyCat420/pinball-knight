//! ☠ THE REAPER KING — the end-of-run boss that gates the exit portal.
//!
//! PORTS: `boss.ts`

pub const REAPER_SCALE: f64 = 1.35;
pub const BRUTE_R: f64 = 0.42;
pub const KING_SCALE: f64 = REAPER_SCALE * 1.55;
pub const KING_BODY_R: f64 = BRUTE_R * KING_SCALE * 0.86;

pub const KING_WAKE_TILES: f64 = 26.0;
pub const KING_LEASH_TILES: f64 = 34.0;
pub const KING_HOME_TILES: f64 = 2.5;
pub const KING_RETURN_SPEED: f64 = 0.75;

pub const SKULL_COUNT: usize = 5;
pub const SKULL_ORBIT_R: f64 = 1.5;
pub const SKULL_ORBIT_SPEED: f64 = 1.1; // rad/s
pub const SKULL_Y: f64 = 1.5;

pub const SLAM_INTERVAL: f64 = 4.2;
pub const SLAM_TELEGRAPH: f64 = 1.1;
pub const SLAM_RADIUS: f64 = 2.4;
pub const SLAM_DAMAGE: i32 = 3;

#[derive(Debug, Clone)]
pub struct BossKingState {
    pub x: f64,
    pub z: f64,
    pub anchor_x: f64,
    pub anchor_z: f64,
    pub hp: i32,
    pub max_hp: i32,
    pub aggro: bool,
    pub returning_home: bool,
    pub slam_t: f64,
    pub skull_angle: f64,
    pub skull_cooldown_t: f64,
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
            aggro: false,
            returning_home: false,
            slam_t: 0.0,
            skull_angle: 0.0,
            skull_cooldown_t: 0.0,
        }
    }

    pub fn tick_orbit(&mut self, dt: f64) {
        self.skull_angle += SKULL_ORBIT_SPEED * dt;
        while self.skull_angle > std::f64::consts::TAU {
            self.skull_angle -= std::f64::consts::TAU;
        }
        self.slam_t += dt;
        if self.slam_t >= SLAM_INTERVAL {
            self.slam_t = 0.0;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
