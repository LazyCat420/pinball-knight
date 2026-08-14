//! Laser Mark Field — crossed sparks stamped along a ricochet trajectory.
//!
//! PORTS: `fx/pools/laser-mark-field.ts`

use std::f32::consts::PI;

pub const MARK_CAP: usize = 48;
pub const MARK_LIFE: f32 = 0.3;
pub const MARK_STEPS: [f32; 4] = [3.0, 1.4, 0.7, 0.3];

#[derive(Debug, Clone, PartialEq)]
pub struct LaserMark {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub dir_x: f32,
    pub dir_z: f32,
    pub size: f32,
    pub roll: f32,
    pub age: f32,
    pub tint: [f32; 3],
    pub alive: bool,
}

impl Default for LaserMark {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            z: 0.0,
            dir_x: 1.0,
            dir_z: 0.0,
            size: 0.5,
            roll: 0.0,
            age: 0.0,
            tint: [1.0, 1.0, 1.0],
            alive: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LaserMarkField {
    pub marks: Vec<LaserMark>,
    pub head: usize,
    pub count: usize,
    pub roll_phase: f32,
}

impl Default for LaserMarkField {
    fn default() -> Self {
        Self {
            marks: vec![LaserMark::default(); MARK_CAP],
            head: 0,
            count: 0,
            roll_phase: 0.0,
        }
    }
}

impl LaserMarkField {
    pub fn new() -> Self {
        Self::default()
    }

    /// Stamps a crossed spark mark at the given position oriented along the velocity vector.
    pub fn stamp(
        &mut self,
        x: f32,
        y: f32,
        z: f32,
        dir_x: f32,
        dir_z: f32,
        size: f32,
        tint: [f32; 3],
    ) {
        let slot = self.head;
        self.head = (self.head + 1) % MARK_CAP;
        if self.count < MARK_CAP {
            self.count += 1;
        }

        self.roll_phase += PI * 0.25; // alternates between + and x

        let mark = &mut self.marks[slot];
        mark.x = x;
        mark.y = y;
        mark.z = z;
        mark.dir_x = dir_x;
        mark.dir_z = dir_z;
        mark.size = size;
        mark.roll = self.roll_phase;
        mark.age = 0.0;
        mark.tint = tint;
        mark.alive = true;
    }

    /// Ticks active marks, advancing age and expiring stamps after MARK_LIFE.
    pub fn step(&mut self, dt: f32) {
        for mark in &mut self.marks {
            if mark.alive {
                mark.age += dt;
                if mark.age >= MARK_LIFE {
                    mark.alive = false;
                }
            }
        }
    }

    /// Returns all live marks along with their current brightness multipliers.
    pub fn live_marks(&self) -> Vec<(&LaserMark, f32)> {
        let mut out = Vec::new();
        for mark in &self.marks {
            if mark.alive {
                let progress = (mark.age / MARK_LIFE).clamp(0.0, 0.999);
                let step_idx = (progress * MARK_STEPS.len() as f32).floor() as usize;
                let brightness = MARK_STEPS[step_idx.min(MARK_STEPS.len() - 1)];
                out.push((mark, brightness));
            }
        }
        out
    }
}
