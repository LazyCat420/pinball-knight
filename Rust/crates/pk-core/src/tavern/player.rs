//! The knight, in the tavern. Walk, face, stop at furniture — the movement
//! math of `legacy/src/scenes/tavern/player.ts::updateTavernPlayer`, extracted
//! as a pure fixed-signature step so the legacy fixture exporter and this port
//! drive ONE description of the walk (mirrored in
//! `legacy/src/scenes/tavern/player.ts::stepTavernMovement`).
//!
//! Deliberately NOT the dungeon's 1500-line controller: axis → velocity ramp →
//! rect collision → facing is the whole job.
//!
//! PORTS: `legacy/src/scenes/tavern/player.ts`

use super::layout::{move_in_room, PLAYER_RADIUS, SPAWN};
use crate::jsmath::js_hypot;
use crate::state::Facing;

/// Walk speed, world units/sec — the dungeon's 4.2 plus a margin paid to the
/// tavern's camera lean (see the legacy comment on WALK_SPEED).
pub const WALK_SPEED: f64 = 4.6;
/// Hold shift to cross the room quickly without it feeling like a sprint mechanic.
pub const HURRY_MULT: f64 = 1.5;
/// Acceleration/deceleration, units/sec².
pub const ACCEL: f64 = 34.0;
/// Above this speed the walk clip plays; below it the knight idles.
pub const WALK_CLIP_THRESHOLD: f64 = 0.35;

/// legacy engine/camera.ts: ground-plane direction of "screen up" and
/// "screen right", derived from the engine yaw (45°, `Math.PI / 4`).
const YAW: f64 = std::f64::consts::FRAC_PI_4;

fn screen_up_xz() -> (f64, f64) {
    (-libm::sin(YAW), -libm::cos(YAW))
}
fn screen_right_xz() -> (f64, f64) {
    (libm::cos(YAW), -libm::sin(YAW))
}

/// Screen-space axis → world ground direction (legacy `screenDirToWorld`).
/// +sz is screen-down (toward the camera).
pub fn screen_dir_to_world(sx: f64, sz: f64) -> (f64, f64) {
    let up = screen_up_xz();
    let right = screen_right_xz();
    (sx * right.0 - sz * up.0, sx * right.1 - sz * up.1)
}

/// World ground direction → screen-space axis (legacy `worldDirToScreen`).
pub fn world_dir_to_screen(wx: f64, wz: f64) -> (f64, f64) {
    let up = screen_up_xz();
    let right = screen_right_xz();
    (wx * right.0 + wz * right.1, -(wx * up.0 + wz * up.1))
}

/// legacy engine/render/animator.ts `facingFromVelocity` — hysteresis so
/// diagonal jitter doesn't flap the sheet; sign reversals stay instant.
pub fn facing_from_velocity(vx: f64, vz: f64, fallback: Facing) -> Facing {
    let ax = vx.abs();
    let az = vz.abs();
    if ax < 1e-4 && az < 1e-4 {
        return fallback;
    }
    let vertical = fallback == Facing::S || fallback == Facing::N;
    const MARGIN: f64 = 1.25;
    if vertical && az * MARGIN >= ax && az >= 1e-4 {
        return if vz > 0.0 { Facing::S } else { Facing::N };
    }
    if !vertical && ax * MARGIN >= az && ax >= 1e-4 {
        return if vx > 0.0 { Facing::E } else { Facing::W };
    }
    // The other axis clearly won (or the current one went dead): switch. Ties
    // break toward the vertical axis, which reads better.
    if az >= ax {
        if vz > 0.0 {
            Facing::S
        } else {
            Facing::N
        }
    } else if vx > 0.0 {
        Facing::E
    } else {
        Facing::W
    }
}

/// The tavern knight's pose + velocity — everything one movement step touches.
#[derive(Debug, Clone, PartialEq)]
pub struct TavernPose {
    pub x: f64,
    pub z: f64,
    pub vx: f64,
    pub vz: f64,
    pub facing: Facing,
    /// Current speed, for the walk-cycle rate.
    pub speed: f64,
    /// Animation clock.
    pub anim_t: f64,
}

impl TavernPose {
    /// At the foot of the stair, looking into the room (legacy createTavernPlayer).
    pub fn spawn() -> Self {
        Self {
            x: SPAWN.0,
            z: SPAWN.1,
            vx: 0.0,
            vz: 0.0,
            facing: Facing::N,
            speed: 0.0,
            anim_t: 0.0,
        }
    }
}

/// Per-step input, already sampled by the shell.
#[derive(Debug, Clone, Copy, Default)]
pub struct TavernInput {
    /// Screen-relative axis, -1..1 per component (keyboard is ±1).
    pub axis_x: f64,
    pub axis_z: f64,
    pub sprint: bool,
    /// True while a station panel is open OR a one-shot clip owns the knight —
    /// the target velocity is zero but the ramp/collide/speed still run.
    pub frozen: bool,
}

/// One movement step — the exact math of legacy `updateTavernPlayer` (minus
/// the sprite/mesh work). Operation order matters: target from the rotated
/// axis, ramp toward it, move with per-axis blocked-velocity kill, then speed
/// and facing.
pub fn step_tavern_movement(p: &mut TavernPose, input: &TavernInput, dt: f64) {
    let mut tx = 0.0;
    let mut tz = 0.0;
    if !input.frozen && (input.axis_x != 0.0 || input.axis_z != 0.0) {
        // The input axis is SCREEN-relative; under the isometric yaw, screen-up
        // is a world diagonal. MUST go through the same screen_dir_to_world the
        // dungeon uses — a second copy of the maths is how the two scenes ever
        // disagreed (movement.test.ts pins the directions).
        let (wx, wz) = screen_dir_to_world(input.axis_x, input.axis_z);
        let len = {
            let h = js_hypot(wx, wz);
            if h == 0.0 {
                1.0
            } else {
                h
            }
        };
        let speed = WALK_SPEED * if input.sprint { HURRY_MULT } else { 1.0 };
        tx = (wx / len) * speed;
        tz = (wz / len) * speed;
    }

    // Ramp toward the target rather than snapping, so starts and stops have weight.
    let dvx = tx - p.vx;
    let dvz = tz - p.vz;
    let dv_len = js_hypot(dvx, dvz);
    if dv_len > 0.0 {
        let step = dv_len.min(ACCEL * dt);
        p.vx += (dvx / dv_len) * step;
        p.vz += (dvz / dv_len) * step;
    }

    if p.vx != 0.0 || p.vz != 0.0 {
        let want_dx = p.vx * dt;
        let want_dz = p.vz * dt;
        let (mx, mz) = move_in_room(p.x, p.z, p.x + want_dx, p.z + want_dz, PLAYER_RADIUS);
        // Kill the velocity component we just got blocked on — ACHIEVED vs
        // INTENDED, tolerant: keep less than a tenth of what we asked for on an
        // axis and that axis is blocked. Only ever zeroes the BLOCKED axis.
        if (mx - p.x).abs() < want_dx.abs() * 0.1 {
            p.vx = 0.0;
        }
        if (mz - p.z).abs() < want_dz.abs() * 0.1 {
            p.vz = 0.0;
        }
        p.x = mx;
        p.z = mz;
    }

    p.speed = js_hypot(p.vx, p.vz);
    p.anim_t += dt;

    if p.speed > WALK_CLIP_THRESHOLD {
        p.facing = facing_from_velocity(p.vx, p.vz, p.facing);
    }
}

#[cfg(test)]
mod tests {
    //! Direction cases ported from `legacy/src/scenes/tavern/movement.test.ts`.
    use super::*;

    fn unit(v: (f64, f64)) -> (f64, f64) {
        let len = {
            let h = js_hypot(v.0, v.1);
            if h == 0.0 {
                1.0
            } else {
                h
            }
        };
        (v.0 / len, v.1 / len)
    }

    /// The rotation the tavern used to apply, kept so the bug stays pinned.
    fn the_old_broken_way(sx: f64, sz: f64) -> (f64, f64) {
        const ISO: f64 = std::f64::consts::FRAC_1_SQRT_2;
        ((sx - sz) * ISO, (sx + sz) * ISO)
    }

    /// WASD as the input layer reports it: +z is screen-DOWN, toward the camera.
    const KEYS: [(&str, (f64, f64)); 4] = [
        ("W", (0.0, -1.0)),
        ("S", (0.0, 1.0)),
        ("A", (-1.0, 0.0)),
        ("D", (1.0, 0.0)),
    ];

    fn close(a: f64, b: f64, digits: i32) -> bool {
        (a - b).abs() < 0.5 * 10f64.powi(-digits)
    }

    #[test]
    fn sends_each_key_back_to_the_screen_axis_it_was_pressed_on() {
        for (key, axis) in KEYS {
            let w = screen_dir_to_world(axis.0, axis.1);
            let back = unit(world_dir_to_screen(w.0, w.1));
            assert!(close(back.0, axis.0, 6), "{key} screen-x");
            assert!(close(back.1, axis.1, 6), "{key} screen-z");
        }
    }

    #[test]
    fn does_not_reproduce_the_90_degree_rotation_the_tavern_used_to_have() {
        // W is the clearest single case: under the old maths it walked screen-right.
        let good = unit(screen_dir_to_world(0.0, -1.0));
        let bad = unit(the_old_broken_way(0.0, -1.0));
        assert!(!close(good.0, bad.0, 3));

        // Rotating the correct vector by +90° in XZ, (x, z) -> (-z, x), lands
        // exactly on the old one.
        assert!(close(bad.0, -good.1, 6));
        assert!(close(bad.1, good.0, 6));
    }

    #[test]
    fn keeps_opposite_keys_opposite_and_perpendicular_keys_perpendicular() {
        let w = unit(screen_dir_to_world(0.0, -1.0));
        let s = unit(screen_dir_to_world(0.0, 1.0));
        let d = unit(screen_dir_to_world(1.0, 0.0));

        assert!(close(w.0 + s.0, 0.0, 6));
        assert!(close(w.1 + s.1, 0.0, 6));
        // Perpendicular ⇒ dot product zero.
        assert!(close(w.0 * d.0 + w.1 * d.1, 0.0, 6));
    }

    #[test]
    fn gives_all_eight_keyboard_directions_a_distinct_heading() {
        let combos = [
            (0.0, -1.0),
            (1.0, -1.0),
            (1.0, 0.0),
            (1.0, 1.0),
            (0.0, 1.0),
            (-1.0, 1.0),
            (-1.0, 0.0),
            (-1.0, -1.0),
        ];
        let headings: std::collections::HashSet<String> = combos
            .iter()
            .map(|&(x, z)| {
                let w = unit(screen_dir_to_world(x, z));
                format!("{:.4},{:.4}", w.0, w.1)
            })
            .collect();
        assert_eq!(headings.len(), 8);
    }

    // ── Step semantics (behavioural pins on the extracted step) ──

    const DT: f64 = 1.0 / 60.0;

    #[test]
    fn ramps_to_full_speed_and_stops_with_a_slide() {
        let mut p = TavernPose::spawn();
        let hold = TavernInput {
            axis_x: 0.0,
            axis_z: -1.0, // W: away from the camera, into the room
            ..Default::default()
        };
        // 4.6/34 ≈ 0.135s to full speed — well inside half a second.
        for _ in 0..30 {
            step_tavern_movement(&mut p, &hold, DT);
        }
        assert!((p.speed - WALK_SPEED).abs() < 1e-9, "at full walk speed");
        assert_eq!(p.facing, Facing::N, "W walks away from the camera");

        let release = TavernInput::default();
        step_tavern_movement(&mut p, &release, DT);
        assert!(p.speed < WALK_SPEED, "decelerating");
        assert!(p.speed > 0.0, "but not an instant stop");
        for _ in 0..30 {
            step_tavern_movement(&mut p, &release, DT);
        }
        assert_eq!(p.speed, 0.0, "at rest");
    }

    #[test]
    fn frozen_zeroes_the_target_but_still_decelerates_honestly() {
        let mut p = TavernPose::spawn();
        let hold = TavernInput {
            axis_z: -1.0,
            ..Default::default()
        };
        for _ in 0..30 {
            step_tavern_movement(&mut p, &hold, DT);
        }
        let frozen = TavernInput {
            axis_z: -1.0,
            frozen: true,
            ..Default::default()
        };
        step_tavern_movement(&mut p, &frozen, DT);
        assert!(p.speed < WALK_SPEED, "input ignored while frozen");
    }

    #[test]
    fn sprint_multiplies_the_walk_speed() {
        let mut p = TavernPose::spawn();
        let hurry = TavernInput {
            axis_z: -1.0,
            sprint: true,
            ..Default::default()
        };
        for _ in 0..60 {
            step_tavern_movement(&mut p, &hurry, DT);
        }
        assert!((p.speed - WALK_SPEED * HURRY_MULT).abs() < 1e-9);
    }

    #[test]
    fn brushing_a_counter_keeps_the_free_axis_at_speed() {
        // Stand just south of the central table, push diagonally into it:
        // the z axis blocks, the x axis keeps its velocity (the slide).
        let table = &super::super::layout::OBSTACLES[0];
        let mut p = TavernPose::spawn();
        p.x = table.x - 0.6;
        p.z = table.z + table.d / 2.0 + PLAYER_RADIUS + 0.01;
        // Screen-axis (1, 0) is world (+,-) — east and into the table's face.
        let push = TavernInput {
            axis_x: 1.0,
            ..Default::default()
        };
        for _ in 0..20 {
            step_tavern_movement(&mut p, &push, DT);
        }
        assert_eq!(p.vz, 0.0, "blocked axis killed");
        assert!(p.vx > 0.0, "free axis still moving");
        assert!(p.x > table.x - 0.6, "made progress along the counter");
    }
}
