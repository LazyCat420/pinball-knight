//! Jester disc throws and spring pad interactions.
//!
//! PORTS: `render/monsters/jester.ts`

use crate::enemies::*;

#[derive(Debug, Clone, PartialEq)]
pub struct JesterDisc {
    pub id: u64,
    pub x: f64,
    pub z: f64,
    pub vx: f64,
    pub vz: f64,
    pub bounces_left: u32,
    pub life: f64,
    pub damage: i32,
}

impl JesterDisc {
    pub fn new(id: u64, x: f64, z: f64, dir_x: f64, dir_z: f64) -> Self {
        let len = (dir_x * dir_x + dir_z * dir_z).sqrt().max(1e-4);
        Self {
            id,
            x,
            z,
            vx: (dir_x / len) * JESTER_DISC_SPEED,
            vz: (dir_z / len) * JESTER_DISC_SPEED,
            bounces_left: 4,
            life: JESTER_DISC_LIFE,
            damage: JESTER_DISC_DAMAGE,
        }
    }

    pub fn bounce_spring_pad(&mut self, spring_nx: f64, spring_nz: f64, boost_speed: f64) {
        let dot = self.vx * spring_nx + self.vz * spring_nz;
        self.vx = (self.vx - 2.0 * dot * spring_nx) * 1.25;
        self.vz = (self.vz - 2.0 * dot * spring_nz) * 1.25;
        let speed = (self.vx * self.vx + self.vz * self.vz).sqrt();
        if speed < boost_speed {
            self.vx = (self.vx / speed) * boost_speed;
            self.vz = (self.vz / speed) * boost_speed;
        }
    }
}
