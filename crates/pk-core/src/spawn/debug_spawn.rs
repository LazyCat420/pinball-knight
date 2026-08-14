//! Scripted debug monster spawn layouts for test harnesses and combat debuggers.
//!
//! PORTS: `debug-spawn.ts`

use std::f64::consts::PI;
use crate::grid::{is_walkable, world_to_tile, Grid};
use crate::monsters::EnemyKind;

#[derive(Debug, Clone, PartialEq)]
pub struct SpawnLayout {
    pub count: u32,
    pub ring: Option<f64>,
    pub phase: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DebugSpawnSpec {
    pub layout: SpawnLayout,
    pub kind: EnemyKind,
    pub hp: Option<i32>,
    pub aggro: bool,
    pub at: Option<(f64, f64)>,
}

impl Default for DebugSpawnSpec {
    fn default() -> Self {
        Self {
            layout: SpawnLayout {
                count: 1,
                ring: None,
                phase: None,
            },
            kind: EnemyKind::Zombie,
            hp: None,
            aggro: true,
            at: None,
        }
    }
}

/// Generates a list of walkable world positions for the requested debug spawn spec.
pub fn layout_debug_spawns(
    grid: &Grid,
    spec: &DebugSpawnSpec,
    default_center: (f64, f64),
) -> Vec<(f64, f64)> {
    let center = spec.at.unwrap_or(default_center);
    let count = spec.layout.count;
    if count == 0 {
        return Vec::new();
    }

    let mut out = Vec::with_capacity(count as usize);

    if let Some(radius) = spec.layout.ring {
        if radius > 0.0 {
            // Ring layout: evenly spaced around circle
            let phase = spec.layout.phase.unwrap_or(0.0);
            let angle_step = (PI * 2.0) / count as f64;

            for i in 0..count {
                let angle = phase + angle_step * i as f64;
                let candidate_x = center.0 + angle.cos() * radius;
                let candidate_z = center.1 + angle.sin() * radius;

                let (ti, tj) = world_to_tile(grid, candidate_x, candidate_z);
                if is_walkable(grid, ti, tj) {
                    out.push((candidate_x, candidate_z));
                } else {
                    // Fallback to center if obstacle blocks ring tile
                    out.push(center);
                }
            }
            return out;
        }
    }

    // Dense cluster layout: concentric spiral outwards from center
    let (center_ti, center_tj) = world_to_tile(grid, center.0, center.1);
    if is_walkable(grid, center_ti, center_tj) {
        out.push(center);
    }

    let mut r: i32 = 1;
    while out.len() < count as usize && r <= 8 {
        for di in -r..=r {
            for dj in -r..=r {
                if di.abs() == r || dj.abs() == r {
                    let ti = center_ti + di;
                    let tj = center_tj + dj;
                    if is_walkable(grid, ti, tj) {
                        let wx = center.0 + di as f64;
                        let wz = center.1 + dj as f64;
                        out.push((wx, wz));
                        if out.len() == count as usize {
                            return out;
                        }
                    }
                }
            }
        }
        r += 1;
    }

    out
}
