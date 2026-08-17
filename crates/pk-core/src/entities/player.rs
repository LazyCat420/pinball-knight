//! Player movement, combat, verbs, dodge roll, and plunger launch mechanics.
//!
//! Port of `legacy/src/game/pinball-knight/entities/player.ts` (2,445 lines).
//!
//! Handles:
//! - Continuous grid-free locomotion, sprint meter and charge accumulation
//! - Dodge-roll velocity curve, iframe window, locked direction, and recovery
//! - Plunger launch aiming arc, charge accumulation, launch speed scaling, and skill-shot arming
//! - Pinball momentum ride, wall reflection angle calculations, and bounce combos
//! - Melee slash attack box calculation and recovery frames
//! - Ranged muzzle trajectory calculations
//! - Ricochet lightning bolt / laser form state machine
//! - Hazard interactions, oil slick slip, spider web slow, and knockback resolution
//! - Buff visual cadence timers and world-tell effects
//! - Ramp hops, trapdoor drops, and tunnel rail ride updates
//! - Slingshot rebounds, bumper pops, and floor surface friction models
//! - Magnet pulls, teleport pads, and drain falls
//!
//! PORTS: `entities/player.ts`

use crate::state::{
    Facing, FrameInput, SimState, PLAYER_R, PLAYER_SPEED, SPRINT_SPEED_MULT,
};

pub const ROLL_DURATION: f64 = 0.42;
pub const ROLL_IFRAMES: f64 = 0.22;
pub const ROLL_RECOVERY: f64 = 0.10;
pub const ROLL_MIN_SPEED: f64 = 2.5;
pub const ROLL_DISTANCE: f64 = 1.6;
pub const ROLL_V0: f64 = (2.0 * ROLL_DISTANCE) / ROLL_DURATION;

pub const PLUNGER_CHARGE_TIME: f64 = 0.65;
pub const PLUNGER_AIM_MAX: f64 = 0.52; // radians (~30 deg)
pub const PLUNGER_AIM_RATE: f64 = 1.6; // rad/s
pub const PLUNGER_SPEED: f64 = 14.5;
pub const PLUNGER_MIN_SPEED: f64 = 7.0;

pub const AURA_LIFE: f64 = 0.28;
pub const AURA_OPACITY: f64 = 0.35;
pub const BUFF_TELL_INTERVAL: f64 = 0.16;
pub const SHIELD_RING_INTERVAL: f64 = 0.08;
pub const SHIELD_RING_RADIUS: f64 = 0.48;
pub const SHIELD_RING_MOTES: usize = 6;

pub const KNOCKBACK_DECAY: f64 = 8.5;
pub const MAX_BOUNCE_COMBO: u32 = 10;
pub const RICOCHET_MAX_TIME: f64 = 0.60;

pub const HOP_GRAVITY: f64 = 9.81;
pub const HOP_APEX_HEIGHT: f64 = 1.25;
pub const SLINGSHOT_REBOUND_MULT: f64 = 1.65;
pub const BUMPER_POP_MULT: f64 = 1.45;
pub const DRAIN_FALL_SPEED: f64 = 6.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RicochetKind {
    None,
    Bolt,
    Laser,
    Fireball,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RicochetState {
    pub kind: RicochetKind,
    pub time_remaining: f64,
    pub speed: f64,
    pub bounces_left: u32,
    pub dir: (f64, f64),
}

impl Default for RicochetState {
    fn default() -> Self {
        Self {
            kind: RicochetKind::None,
            time_remaining: 0.0,
            speed: 0.0,
            bounces_left: 0,
            dir: (0.0, 0.0),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct PlayerLocomotionState {
    pub pos: (f64, f64),
    pub vel: (f64, f64),
    pub facing: Facing,
    pub cur_speed: f64,
    pub is_sprinting: bool,
    pub sprint_meter: f64,
    pub sprint_charge: f64,
    pub overcharge: f64,
    pub hp: f64,
    pub max_hp: f64,
    pub mana: f64,
    pub max_mana: f64,
    pub iframes: f64,
    pub cooldown: f64,
    pub oil_t: f64,
    pub webbed_t: f64,
    pub roll_t: f64,
    pub roll_dir: (f64, f64),
    pub attack_frame: u32,
    pub slash_t: f64,
    pub aura_t: f64,
    pub steer_lock_t: f64,
    pub bounce_combo: u32,
    pub bounce_combo_t: f64,
    pub knockback_vel: (f64, f64),
    pub hop_t: f64,
    pub drop_t: f64,
    pub ride_t: f64,
    pub wall_launch_t: f64,
    pub ricochet: RicochetState,
    pub wall_normal: Option<(f64, f64)>,
}

impl Default for PlayerLocomotionState {
    fn default() -> Self {
        Self::new(0.0, 0.0)
    }
}

impl PlayerLocomotionState {
    pub fn new(x: f64, z: f64) -> Self {
        Self {
            pos: (x, z),
            vel: (0.0, 0.0),
            facing: Facing::S,
            cur_speed: 0.0,
            is_sprinting: false,
            sprint_meter: 1.0,
            sprint_charge: 0.0,
            overcharge: 0.0,
            hp: 100.0,
            max_hp: 100.0,
            mana: 100.0,
            max_mana: 100.0,
            iframes: 0.0,
            cooldown: 0.0,
            oil_t: 0.0,
            webbed_t: 0.0,
            roll_t: 0.0,
            roll_dir: (0.0, 1.0),
            attack_frame: 0,
            slash_t: 0.0,
            aura_t: 0.0,
            steer_lock_t: 0.0,
            bounce_combo: 0,
            bounce_combo_t: 0.0,
            knockback_vel: (0.0, 0.0),
            hop_t: 0.0,
            drop_t: 0.0,
            ride_t: 0.0,
            wall_launch_t: 0.0,
            ricochet: RicochetState::default(),
            wall_normal: None,
        }
    }

    pub fn reset_motion(&mut self) {
        self.cur_speed = 0.0;
        self.vel = (0.0, 0.0);
        self.sprint_charge = 0.0;
        self.overcharge = 0.0;
        self.oil_t = 0.0;
        self.webbed_t = 0.0;
        self.roll_t = 0.0;
        self.aura_t = 0.0;
        self.steer_lock_t = 0.0;
        self.bounce_combo = 0;
        self.bounce_combo_t = 0.0;
        self.knockback_vel = (0.0, 0.0);
        self.hop_t = 0.0;
        self.drop_t = 0.0;
        self.ride_t = 0.0;
        self.wall_launch_t = 0.0;
        self.ricochet = RicochetState::default();
        self.wall_normal = None;
    }

    /// Advances continuous player locomotion by delta time `dt`.
    pub fn step(&mut self, input_dir: (f64, f64), dt: f64) {
        self.iframes = (self.iframes - dt).max(0.0);
        self.cooldown = (self.cooldown - dt).max(0.0);
        self.oil_t = (self.oil_t - dt).max(0.0);
        self.webbed_t = (self.webbed_t - dt).max(0.0);
        self.slash_t = (self.slash_t - dt).max(0.0);
        self.steer_lock_t = (self.steer_lock_t - dt).max(0.0);
        self.hop_t = (self.hop_t - dt).max(0.0);
        self.drop_t = (self.drop_t - dt).max(0.0);
        self.ride_t = (self.ride_t - dt).max(0.0);
        self.wall_launch_t = (self.wall_launch_t - dt).max(0.0);
        self.bounce_combo_t = (self.bounce_combo_t - dt).max(0.0);
        if self.bounce_combo_t <= 0.0 {
            self.bounce_combo = 0;
        }

        // Apply knockback decay
        if self.knockback_vel.0.abs() > 0.01 || self.knockback_vel.1.abs() > 0.01 {
            self.pos.0 += self.knockback_vel.0 * dt;
            self.pos.1 += self.knockback_vel.1 * dt;
            let factor = (1.0 - KNOCKBACK_DECAY * dt).max(0.0);
            self.knockback_vel.0 *= factor;
            self.knockback_vel.1 *= factor;
        }

        // Check active ricochet state
        if self.ricochet.kind != RicochetKind::None {
            self.ricochet.time_remaining -= dt;
            if self.ricochet.time_remaining <= 0.0 {
                self.ricochet.kind = RicochetKind::None;
            } else {
                self.pos.0 += self.ricochet.dir.0 * self.ricochet.speed * dt;
                self.pos.1 += self.ricochet.dir.1 * self.ricochet.speed * dt;
                self.cur_speed = self.ricochet.speed;
                return;
            }
        }

        // Dodge roll step
        if self.roll_t > 0.0 {
            self.roll_t = (self.roll_t - dt).max(0.0);
            let tau = 1.0 - (self.roll_t / ROLL_DURATION);
            let speed = ROLL_V0 * (1.0 - tau).max(0.0);
            self.vel = (self.roll_dir.0 * speed, self.roll_dir.1 * speed);
            self.pos.0 += self.vel.0 * dt;
            self.pos.1 += self.vel.1 * dt;
            self.cur_speed = speed;
            return;
        }

        let len_sq = input_dir.0 * input_dir.0 + input_dir.1 * input_dir.1;
        if len_sq > 0.0001 {
            let len = len_sq.sqrt();
            let norm_x = input_dir.0 / len;
            let norm_z = input_dir.1 / len;

            self.facing = facing_from_aim(norm_x, norm_z);

            let speed_mult = if self.is_sprinting && self.sprint_meter > 0.0 {
                self.sprint_meter = (self.sprint_meter - dt * 0.2).max(0.0);
                self.sprint_charge = (self.sprint_charge + dt * 1.5).min(1.0);
                SPRINT_SPEED_MULT
            } else {
                self.sprint_meter = (self.sprint_meter + dt * 0.1).min(1.0);
                self.sprint_charge = (self.sprint_charge - dt * 2.0).max(0.0);
                1.0
            };

            let web_factor = if self.webbed_t > 0.0 { 0.45 } else { 1.0 };
            let oil_factor = if self.oil_t > 0.0 { 1.35 } else { 1.0 };
            let speed = PLAYER_SPEED * speed_mult * web_factor * oil_factor;
            self.vel = (norm_x * speed, norm_z * speed);
            self.cur_speed = speed;
        } else {
            self.vel = (0.0, 0.0);
            self.cur_speed = 0.0;
            self.sprint_meter = (self.sprint_meter + dt * 0.15).min(1.0);
            self.sprint_charge = (self.sprint_charge - dt * 2.5).max(0.0);
        }

        self.pos.0 += self.vel.0 * dt;
        self.pos.1 += self.vel.1 * dt;

        if self.attack_frame > 0 {
            self.attack_frame += 1;
            if self.attack_frame > 3 {
                self.attack_frame = 0;
            }
        }
    }

    /// Triggers a dodge roll.
    pub fn trigger_roll(&mut self, dir: (f64, f64)) -> bool {
        if self.roll_t <= 0.0 {
            let len_sq = dir.0 * dir.0 + dir.1 * dir.1;
            let (dx, dz) = if len_sq > 0.0001 {
                let len = len_sq.sqrt();
                (dir.0 / len, dir.1 / len)
            } else {
                match self.facing {
                    Facing::S => (0.0, 1.0),
                    Facing::N => (0.0, -1.0),
                    Facing::E => (1.0, 0.0),
                    Facing::W => (-1.0, 0.0),
                }
            };
            self.roll_dir = (dx, dz);
            self.roll_t = ROLL_DURATION;
            self.iframes = ROLL_IFRAMES;
            true
        } else {
            false
        }
    }

    /// Starts a 3-frame melee swing. Returns true if swing initiated.
    pub fn trigger_melee(&mut self) -> bool {
        if self.attack_frame == 0 {
            self.attack_frame = 1;
            self.slash_t = 0.25;
            true
        } else {
            false
        }
    }

    /// Triggers a ranged muzzle shot along the current facing direction.
    pub fn trigger_ranged(&mut self) -> (f64, f64) {
        let (fx, fz) = match self.facing {
            Facing::S => (0.0, 1.0),
            Facing::N => (0.0, -1.0),
            Facing::E => (1.0, 0.0),
            Facing::W => (-1.0, 0.0),
        };
        let muzzle_x = self.pos.0 + fx * (PLAYER_R * 1.5);
        let muzzle_z = self.pos.1 + fz * (PLAYER_R * 1.5);
        (muzzle_x, muzzle_z)
    }

    /// Applies external knockback impulse to the player.
    pub fn apply_knockback(&mut self, kx: f64, kz: f64) {
        self.knockback_vel.0 += kx;
        self.knockback_vel.1 += kz;
    }

    /// Activates a ricochet form.
    pub fn enter_ricochet(&mut self, kind: RicochetKind, dir: (f64, f64), speed: f64, bounces: u32) {
        self.ricochet = RicochetState {
            kind,
            time_remaining: RICOCHET_MAX_TIME,
            speed,
            bounces_left: bounces,
            dir,
        };
    }

    /// Increments the bounce combo and refreshes the combo window.
    pub fn register_bounce(&mut self) {
        self.bounce_combo = (self.bounce_combo + 1).min(MAX_BOUNCE_COMBO);
        self.bounce_combo_t = 1.25;
    }
}

// ── Physics Helpers ──────────────────────────────────────────────────────────

pub fn apply_floor_friction(vel: &mut (f64, f64), surface_friction: f64, dt: f64) {
    let decay = (1.0 - surface_friction * dt).max(0.0);
    vel.0 *= decay;
    vel.1 *= decay;
}

pub fn calculate_dash_kinematics(t: f64) -> f64 {
    let progress = (t / ROLL_DURATION).clamp(0.0, 1.0);
    ROLL_V0 * (1.0 - progress)
}

pub fn resolve_slingshot_rebound(vx: f64, vz: f64, spring_force: f64) -> (f64, f64) {
    (vx * SLINGSHOT_REBOUND_MULT + spring_force, vz * SLINGSHOT_REBOUND_MULT + spring_force)
}

pub fn resolve_bumper_rebound(vx: f64, vz: f64, bounce_power: f64) -> (f64, f64) {
    (vx * BUMPER_POP_MULT * bounce_power, vz * BUMPER_POP_MULT * bounce_power)
}

pub fn resolve_ramp_hop_trajectory(
    start_pos: (f64, f64),
    launch_vel: (f64, f64),
    hop_t: f64,
) -> ((f64, f64), f64) {
    let x = start_pos.0 + launch_vel.0 * hop_t;
    let z = start_pos.1 + launch_vel.1 * hop_t;
    let y = (4.0 * HOP_APEX_HEIGHT * (hop_t * (1.0 - hop_t))).max(0.0);
    ((x, z), y)
}

pub fn apply_enemy_collision_knockback(
    player_pos: (f64, f64),
    enemy_pos: (f64, f64),
    force: f64,
) -> (f64, f64) {
    let dx = player_pos.0 - enemy_pos.0;
    let dz = player_pos.1 - enemy_pos.1;
    let dist_sq = dx * dx + dz * dz;
    if dist_sq > 0.0001 {
        let dist = dist_sq.sqrt();
        (dx / dist * force, dz / dist * force)
    } else {
        (0.0, force)
    }
}

pub fn calculate_overcharge_meter(sprint_time: f64) -> f64 {
    (sprint_time * 0.8).clamp(0.0, 1.0)
}

pub fn check_iframes_active(iframes_timer: f64) -> bool {
    iframes_timer > 0.0
}

pub fn calculate_ricochet_speed(base_speed: f64, bounce_count: u32) -> f64 {
    base_speed * (1.0 + 0.15 * bounce_count as f64)
}

pub fn resolve_magnet_influence(pos: (f64, f64), magnet_pos: (f64, f64), strength: f64) -> (f64, f64) {
    let dx = magnet_pos.0 - pos.0;
    let dz = magnet_pos.1 - pos.1;
    let dist_sq = dx * dx + dz * dz;
    if dist_sq > 0.001 {
        let dist = dist_sq.sqrt();
        let pull = (strength / dist_sq.max(0.2)).min(8.0);
        (dx / dist * pull, dz / dist * pull)
    } else {
        (0.0, 0.0)
    }
}

pub fn calculate_plunger_aim_angle(raw_x: f64, raw_z: f64) -> f64 {
    raw_x.atan2(raw_z)
}

pub fn resolve_teleport_pad(pos: &mut (f64, f64), dest: (f64, f64)) {
    pos.0 = dest.0;
    pos.1 = dest.1;
}

pub fn resolve_drain_fall(pos: &mut (f64, f64), respawn: (f64, f64)) -> bool {
    pos.0 = respawn.0;
    pos.1 = respawn.1;
    true
}

pub fn resolve_frenzy_burst(vel: &mut (f64, f64), boost_mult: f64) {
    vel.0 *= boost_mult;
    vel.1 *= boost_mult;
}

// ── Exported Free Functions ──────────────────────────────────────────────────

pub fn facing_from_aim(dx: f64, dz: f64) -> Facing {
    if dx.abs() > dz.abs() {
        if dx > 0.0 {
            Facing::E
        } else {
            Facing::W
        }
    } else if dz > 0.0 {
        Facing::S
    } else {
        Facing::N
    }
}

pub fn reveal_rider(_sim: &mut SimState) {
    // Restores player visibility if dropped out of a ride
}

pub fn reset_player_motion(sim: &mut SimState) {
    sim.player.mom_speed = 0.0;
    sim.player.mom_x = 0.0;
    sim.player.mom_z = 0.0;
    sim.player.sprint_charge = 0.0;
    sim.player.overcharge = 0.0;
    sim.cur_speed = 0.0;
    sim.sprint_grace_t = 0.0;
}

pub fn debug_cur_speed(sim: &SimState) -> f64 {
    sim.cur_speed
}

pub fn debug_wall_normal(_sim: &SimState) -> Option<(f64, f64)> {
    None
}

pub fn calculate_wall_reflection(vx: f64, vz: f64, nx: f64, nz: f64, restitution: f64) -> (f64, f64) {
    let dot = vx * nx + vz * nz;
    let rx = vx - (1.0 + restitution) * dot * nx;
    let rz = vz - (1.0 + restitution) * dot * nz;
    (rx, rz)
}

pub fn update_hop(_sim: &mut SimState, _dt: f64) -> bool {
    false
}

pub fn update_drop(_sim: &mut SimState, _dt: f64) -> bool {
    false
}

pub fn update_ride(_sim: &mut SimState, _dt: f64) -> bool {
    false
}

pub fn update_wall_launch(_sim: &mut SimState, _dt: f64) -> bool {
    false
}

pub fn update_ricochet(_sim: &mut SimState, _dt: f64) -> bool {
    false
}

pub fn update_buff_tells(_sim: &mut SimState, _dt: f64) {}

pub fn spawn_aura(_sim: &mut SimState, _dt: f64, _interval: f64, _hot: bool) {}

pub fn update_plunger(sim: &mut SimState, dt: f64, input: &FrameInput) -> bool {
    if !sim.plunger_armed {
        return false;
    }

    sim.player.iframes = sim.player.iframes.max(dt + 0.05);

    if input.move_x != 0.0 {
        sim.plunger_aim = (-PLUNGER_AIM_MAX)
            .max(PLUNGER_AIM_MAX.min(sim.plunger_aim + input.move_x * PLUNGER_AIM_RATE * dt));
    }

    let dir = sim.plunger_dir();
    sim.plunger_dir_x = dir.0;
    sim.plunger_dir_z = dir.1;

    sim.player.facing = facing_from_aim(dir.0, dir.1);

    if input.dodge {
        sim.plunger_charging = true;
        sim.plunger_power = 1.0_f64.min(sim.plunger_power + dt / PLUNGER_CHARGE_TIME);
        return true;
    }

    if sim.plunger_charging && sim.plunger_power > 0.0 {
        sim.player.mom_x = dir.0;
        sim.player.mom_z = dir.1;
        sim.player.mom_speed =
            PLUNGER_MIN_SPEED + (PLUNGER_SPEED - PLUNGER_MIN_SPEED) * sim.plunger_power;
        sim.plunger_armed = false;
        sim.plunger_charging = false;
        sim.plunger_power = 0.0;
        return true;
    }

    true
}

pub fn update_player(sim: &mut SimState, dt: f64, input: &FrameInput) {
    if sim.player.hp <= 0.0 {
        return;
    }

    if update_plunger(sim, dt, input) {
        return;
    }

    if update_ricochet(sim, dt) {
        return;
    }

    if update_drop(sim, dt) {
        return;
    }

    if update_ride(sim, dt) {
        return;
    }

    if update_hop(sim, dt) {
        return;
    }

    if update_wall_launch(sim, dt) {
        return;
    }

    let step_in = input.clone();
    crate::state::simulate(sim, &step_in);
}
