//! ☠ THE REAPER KING — the end-of-run boss that gates the exit portal.
//!
//! Port of `legacy/src/game/pinball-knight/boss.ts` (773 lines).
//!
//! PORTS: `boss.ts`

use std::f64::consts::TAU;

use crate::collide::move_circle;
use crate::grid::{tile_center, Grid};

// ── Tuning Constants ──────────────────────────────────────────────────────────
pub const REAPER_SCALE: f64 = 1.35;
pub const BRUTE_R: f64 = 0.42;
pub const KING_SCALE: f64 = REAPER_SCALE * 1.55;

/// The king's collider, derived from the same scale as his mesh.
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
pub const SLAM_RADIUS: f64 = 2.6;
pub const SLAM_DAMAGE: i32 = 2;
pub const SLAM_LAUNCH: f64 = 16.0; // u/s knockback

pub const BARRAGE_INTERVAL: f64 = 2.6;
pub const BONE_SPEED: f64 = 9.0; // u/s projectile
pub const BONE_DAMAGE: i32 = 1;
pub const BONE_MAX_DIST: f64 = 16.0;
pub const BONE_HIT_R: f64 = 0.55;

pub const PINBALL_MAX_SPEED: f64 = 28.0;

// ── Types & Structures ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlamPhase {
    Idle,
    Telegraph,
}

#[derive(Debug, Clone, PartialEq)]
pub struct OrbitingSkull {
    pub phase: f64,
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BoneProjectile {
    pub x: f64,
    pub z: f64,
    pub vx: f64,
    pub vz: f64,
    pub dist: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SlamTelegraph {
    pub x: f64,
    pub z: f64,
    pub timer: f64,
    pub opacity: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PortalState {
    pub x: f64,
    pub z: f64,
    pub scale: f64,
    pub rotation: f64,
    pub opacity: f64,
}

/// The boss aux state a floor authority streams to replicas each snapshot.
#[derive(Debug, Clone, PartialEq)]
pub struct BossAux {
    pub bones: Vec<(f64, f64)>,
    pub slam: Option<(f64, f64, f64)>, // (x, z, t)
    pub portal: Option<(f64, f64)>,
    pub alive: bool,
    pub engaged: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BossState {
    pub x: f64,
    pub z: f64,
    pub hp: i32,
    pub max_hp: i32,
    pub speed: f64,
    pub body_r: f64,
    pub aggro: bool,
    pub anchor: (f64, f64),
    pub engaged: bool,
    pub skulls: Vec<OrbitingSkull>,
    pub bones: Vec<BoneProjectile>,
    pub slam_t: f64,
    pub slam_phase: SlamPhase,
    pub slam_x: f64,
    pub slam_z: f64,
    pub telegraph: Option<SlamTelegraph>,
    pub barrage_t: f64,
    pub orbit_t: f64,
    pub portal: Option<PortalState>,
    pub opened: bool,
    pub scaled_for: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub enum BossEvent {
    PlayerHitRanged { damage: i32, x: f64, z: f64 },
    PlayerHitSlam { damage: i32, launch_x: f64, launch_z: f64, launch_speed: f64 },
    BoneFired { x: f64, z: f64 },
    SlamTelegraphed { x: f64, z: f64 },
    SlamImpact { x: f64, z: f64 },
    PortalOpened { x: f64, z: f64 },
    KingStirsToast,
}

// ── Implementation ────────────────────────────────────────────────────────────

impl BossState {
    pub fn new(anchor_x: f64, anchor_z: f64, hp: i32) -> Self {
        let mut skulls = Vec::with_capacity(SKULL_COUNT);
        for i in 0..SKULL_COUNT {
            let phase = (i as f64 / SKULL_COUNT as f64) * TAU;
            skulls.push(OrbitingSkull {
                phase,
                x: anchor_x + phase.cos() * SKULL_ORBIT_R,
                y: SKULL_Y,
                z: anchor_z + phase.sin() * SKULL_ORBIT_R,
            });
        }

        Self {
            x: anchor_x,
            z: anchor_z,
            hp,
            max_hp: hp,
            speed: 2.8,
            body_r: KING_BODY_R,
            aggro: false,
            anchor: (anchor_x, anchor_z),
            engaged: false,
            skulls,
            bones: Vec::new(),
            slam_t: SLAM_INTERVAL,
            slam_phase: SlamPhase::Idle,
            slam_x: 0.0,
            slam_z: 0.0,
            telegraph: None,
            barrage_t: BARRAGE_INTERVAL,
            orbit_t: 0.0,
            portal: None,
            opened: false,
            scaled_for: 1,
        }
    }

    pub fn is_active(&self) -> bool {
        !self.opened && self.hp > 0
    }

    pub fn is_engaged(&self) -> bool {
        self.engaged && !self.opened
    }

    pub fn scale_for_knights(&mut self, knights: usize) -> bool {
        let n = knights.max(1);
        if n == self.scaled_for {
            return false;
        }
        let factor = n as f64 / self.scaled_for as f64;
        let mh = self.max_hp.max(1);
        self.max_hp = 1.max((mh as f64 * factor).round() as i32);
        self.hp = self.max_hp.min(1.max((self.hp as f64 * factor).round() as i32));
        self.scaled_for = n;
        true
    }

    pub fn update(
        &mut self,
        dt: f64,
        player_pos: (f64, f64),
        player_visible: bool,
        path_dist: Option<f64>,
        grid: Option<&Grid>,
    ) -> Vec<BossEvent> {
        let mut events = Vec::new();

        if !self.opened && self.hp <= 0 {
            self.open_portal(grid, &mut events);
            return events;
        }

        if self.opened {
            self.update_portal(dt);
            self.update_bones(dt, player_pos, &mut events);
            return events;
        }

        let bx = self.x;
        let bz = self.z;
        let target = player_pos;

        // ── THE LEASH ──
        let home_d = (bx - self.anchor.0).hypot(bz - self.anchor.1);
        let path_d = path_dist.unwrap_or(f64::INFINITY);

        if !self.engaged {
            if path_d <= KING_WAKE_TILES && player_visible {
                self.engaged = true;
                events.push(BossEvent::KingStirsToast);
            }
        } else if home_d > KING_LEASH_TILES {
            self.engaged = false;
        }
        self.aggro = self.engaged;

        // ── RETURNING ──
        if !self.engaged && home_d > KING_HOME_TILES {
            let step = self.speed * KING_RETURN_SPEED * dt;
            let dir_x = (self.anchor.0 - bx) / home_d;
            let dir_z = (self.anchor.1 - bz) / home_d;
            if let Some(g) = grid {
                let res = move_circle(g, bx, bz, self.body_r, dir_x * step, dir_z * step);
                self.x = res.x;
                self.z = res.z;
            } else {
                self.x += dir_x * step;
                self.z += dir_z * step;
            }
        }

        // ── Skull ring wheels around king ──
        self.orbit_t += dt * SKULL_ORBIT_SPEED;
        for s in &mut self.skulls {
            let a = self.orbit_t + s.phase;
            s.x = self.x + a.cos() * SKULL_ORBIT_R;
            s.y = SKULL_Y + (a * 2.0).sin() * 0.12;
            s.z = self.z + a.sin() * SKULL_ORBIT_R;
        }

        // ── DISENGAGED ──
        if !self.engaged {
            self.update_bones(dt, player_pos, &mut events);
            return events;
        }

        // ── Skull barrage ──
        self.barrage_t -= dt;
        if self.barrage_t <= 0.0 && !self.skulls.is_empty() {
            self.barrage_t = BARRAGE_INTERVAL;
            self.fire_bone(target, &mut events);
        }
        self.update_bones(dt, player_pos, &mut events);

        // ── Tentacle slam cycle ──
        self.slam_t -= dt;
        if self.slam_phase == SlamPhase::Idle && self.slam_t <= SLAM_TELEGRAPH {
            self.slam_phase = SlamPhase::Telegraph;
            self.slam_x = target.0;
            self.slam_z = target.1;
            self.telegraph = Some(SlamTelegraph {
                x: target.0,
                z: target.1,
                timer: self.slam_t,
                opacity: 0.5,
            });
            events.push(BossEvent::SlamTelegraphed {
                x: target.0,
                z: target.1,
            });
        }

        if self.slam_phase == SlamPhase::Telegraph {
            if let Some(t) = &mut self.telegraph {
                t.timer = self.slam_t;
                t.opacity = 0.35 + ((self.slam_t * 10.0).sin()).abs() * 0.4;
            }
            if self.slam_t <= 0.0 {
                self.do_slam(player_pos, &mut events);
            }
        }

        events
    }

    pub fn fire_bone(&mut self, target: (f64, f64), events: &mut Vec<BossEvent>) {
        let dx = target.0 - self.x;
        let dz = target.1 - self.z;
        let len = dx.hypot(dz).max(1e-4);
        self.bones.push(BoneProjectile {
            x: self.x,
            z: self.z,
            vx: (dx / len) * BONE_SPEED,
            vz: (dz / len) * BONE_SPEED,
            dist: 0.0,
        });
        events.push(BossEvent::BoneFired {
            x: self.x,
            z: self.z,
        });
    }

    pub fn update_bones(
        &mut self,
        dt: f64,
        player_pos: (f64, f64),
        events: &mut Vec<BossEvent>,
    ) {
        let mut i = self.bones.len();
        while i > 0 {
            i -= 1;
            let b = &mut self.bones[i];
            b.x += b.vx * dt;
            b.z += b.vz * dt;
            let step = b.vx.hypot(b.vz) * dt;
            b.dist += step;

            let hit = (player_pos.0 - b.x).hypot(player_pos.1 - b.z) < BONE_HIT_R;
            if hit {
                events.push(BossEvent::PlayerHitRanged {
                    damage: BONE_DAMAGE,
                    x: b.x,
                    z: b.z,
                });
            }

            if hit || b.dist > BONE_MAX_DIST {
                self.bones.swap_remove(i);
            }
        }
    }

    pub fn do_slam(&mut self, player_pos: (f64, f64), events: &mut Vec<BossEvent>) {
        let sx = self.slam_x;
        let sz = self.slam_z;
        self.telegraph = None;
        self.slam_phase = SlamPhase::Idle;
        self.slam_t = SLAM_INTERVAL;

        events.push(BossEvent::SlamImpact { x: sx, z: sz });

        let dx = player_pos.0 - sx;
        let dz = player_pos.1 - sz;
        let dist = dx.hypot(dz);
        if dist <= SLAM_RADIUS {
            let len = dist.max(1e-4);
            events.push(BossEvent::PlayerHitSlam {
                damage: SLAM_DAMAGE,
                launch_x: dx / len,
                launch_z: dz / len,
                launch_speed: SLAM_LAUNCH,
            });
        }
    }

    pub fn open_portal(&mut self, grid: Option<&Grid>, events: &mut Vec<BossEvent>) {
        if self.opened {
            return;
        }
        self.opened = true;
        self.skulls.clear();
        self.telegraph = None;

        let portal_pos = if let Some(g) = grid {
            tile_center(g, (self.anchor.0.round() as i32).max(0), (self.anchor.1.round() as i32).max(0))
        } else {
            self.anchor
        };

        self.portal = Some(PortalState {
            x: portal_pos.0,
            z: portal_pos.1,
            scale: 0.01,
            rotation: 0.0,
            opacity: 0.85,
        });

        events.push(BossEvent::PortalOpened {
            x: portal_pos.0,
            z: portal_pos.1,
        });
    }

    pub fn update_portal(&mut self, dt: f64) {
        if let Some(p) = &mut self.portal {
            p.rotation += dt * 1.5;
            p.scale = (p.scale + dt * 2.0).min(1.0);
        }
    }

    pub fn net_state(&self) -> BossAux {
        BossAux {
            bones: self
                .bones
                .iter()
                .map(|b| ((b.x * 50.0).round() / 50.0, (b.z * 50.0).round() / 50.0))
                .collect(),
            slam: if self.slam_phase == SlamPhase::Telegraph {
                Some((self.slam_x, self.slam_z, self.slam_t))
            } else {
                None
            },
            portal: self.portal.as_ref().map(|p| (p.x, p.z)),
            alive: !self.opened,
            engaged: self.engaged,
        }
    }
}

// ── Global Convenience Helpers ────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
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
        while self.skull_angle > TAU {
            self.skull_angle -= TAU;
        }
        self.slam_t += dt;
    }
}

pub fn spawn_boss(anchor_x: f64, anchor_z: f64, hp: i32) -> BossState {
    BossState::new(anchor_x, anchor_z, hp)
}

pub fn boss_active(boss: Option<&BossState>) -> bool {
    boss.map_or(false, |b| b.is_active())
}

pub fn boss_engaged(boss: Option<&BossState>) -> bool {
    boss.map_or(false, |b| b.is_engaged())
}
