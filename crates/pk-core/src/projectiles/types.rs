//! Projectile data structures and stats definitions.
//!
//! PORTS: `constants/enemies.ts`
//! PORTS-PARTIAL: `entities/projectiles.ts` - NOT a finished port - 1 of 13 exported names carried over (8%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

pub const PROJECTILE_Y: f64 = 0.42;
pub const MUZZLE_OFFSET: f64 = 0.35;
pub const HIT_R: f64 = 0.16;
pub const FLAME_BURN_IMMUNITY: f64 = 0.18;
pub const CURVE_ACCEL: f64 = 8.5;

// Enemy projectile stats
pub const SPITTER_GLOB_SPEED: f64 = 5.5;
pub const SPITTER_FIRE_RANGE: f64 = 7.0;
pub const SPITTER_DAMAGE: i32 = 12;

pub const WEB_GLOB_SPEED: f64 = 6.2;

pub const GOLEM_SHARDS: usize = 6;
pub const GOLEM_SHARD_SPEED: f64 = 4.8;
pub const GOLEM_SHARD_DAMAGE: i32 = 16;
pub const GOLEM_SHARD_LIFE: f64 = 1.2;

pub const JESTER_DISC_SPEED: f64 = 6.8;
pub const JESTER_DISC_DAMAGE: i32 = 14;
pub const JESTER_DISC_LIFE: f64 = 2.5;

pub const CROAKER_BEAM_SPEED: f64 = 9.0;
pub const CROAKER_BEAM_DAMAGE: i32 = 20;
pub const CROAKER_FIRE_RANGE: f64 = 8.5;
pub const CROAKER_BEAM_SPREAD: f64 = 0.22;

pub const ROTORTAIL_TIMBER_SPEED: f64 = 5.0;
pub const ROTORTAIL_TIMBER_DAMAGE: i32 = 18;
pub const ROTORTAIL_FIRE_RANGE: f64 = 6.5;

pub const STILTNECK_BOMB_SPEED: f64 = 4.2;
pub const STILTNECK_BOMB_FUSE: f64 = 1.8;
pub const STILTNECK_BLAST_RADIUS: f64 = 2.2;
pub const STILTNECK_BLAST_DAMAGE: i32 = 28;
pub const STILTNECK_BLAST_ENEMY_DAMAGE: i32 = 20;
pub const STILTNECK_BLAST_PUSH: f64 = 8.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectileKind {
    Bullet,
    Arrow,
    Flame,
    Pellet,
    Laser,
    Missile,
    SpitterGlob,
    WebGlob,
    GolemShard,
    JesterDisc,
    CroakerBeam,
    RotortailTimber,
    StiltneckBomb,
}

#[derive(Debug, Clone)]
pub struct Projectile {
    pub id: u64,
    pub kind: ProjectileKind,
    pub x: f64,
    pub z: f64,
    pub vx: f64,
    pub vz: f64,
    pub life: f64,
    pub max_life: f64,
    pub damage: i32,
    pub is_player: bool,
    pub pierce: i32,
    pub curve_rate: f64,
    pub dead: bool,
    pub radius: f64,
}

impl Projectile {
    pub fn new_player_shot(
        id: u64,
        kind: ProjectileKind,
        x: f64,
        z: f64,
        dir_x: f64,
        dir_z: f64,
        speed: f64,
        damage: i32,
        life: f64,
    ) -> Self {
        let len = (dir_x * dir_x + dir_z * dir_z).sqrt().max(1e-6);
        let nx = dir_x / len;
        let nz = dir_z / len;
        Self {
            id,
            kind,
            x: x + nx * MUZZLE_OFFSET,
            z: z + nz * MUZZLE_OFFSET,
            vx: nx * speed,
            vz: nz * speed,
            life,
            max_life: life,
            damage,
            is_player: true,
            pierce: if kind == ProjectileKind::Flame || kind == ProjectileKind::Laser {
                99
            } else {
                0
            },
            curve_rate: 0.0,
            dead: false,
            radius: if kind == ProjectileKind::Flame {
                0.28
            } else {
                HIT_R
            },
        }
    }

    pub fn new_enemy_shot(
        id: u64,
        kind: ProjectileKind,
        x: f64,
        z: f64,
        dir_x: f64,
        dir_z: f64,
        speed: f64,
        damage: i32,
        life: f64,
    ) -> Self {
        let len = (dir_x * dir_x + dir_z * dir_z).sqrt().max(1e-6);
        let nx = dir_x / len;
        let nz = dir_z / len;
        Self {
            id,
            kind,
            x: x + nx * 0.25,
            z: z + nz * 0.25,
            vx: nx * speed,
            vz: nz * speed,
            life,
            max_life: life,
            damage,
            is_player: false,
            pierce: 0,
            curve_rate: 0.0,
            dead: false,
            radius: HIT_R,
        }
    }
}
