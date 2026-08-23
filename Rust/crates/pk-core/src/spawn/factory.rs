//! The monster factory — every path from "an enemy should exist here" to a
//! `LiveMonster` in `SimState.monsters` or `Zombie` in the horde.
//!
//! Port of `legacy/src/game/pinball-knight/spawn/factory.ts` (526 lines).
//!
//! PORTS: `spawn/factory.ts`

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::RwLock;

use crate::constants::enemies::*;
use crate::grid::{is_walkable, tile_center, world_to_tile, Grid};
use crate::maze::nearest_open_tile;
use crate::maze::track_launch::TilePos;
use crate::monsters::types::{EnemyKind, LiveMonster};
use crate::state::SimState;
use crate::zombie_types::{pick_zombie_type, type_hp, ZombieType};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ExpansionSkinDef {
    pub kind: EnemyKind,
    pub tint: u32,
    pub scale: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ReskinDef {
    pub kind: EnemyKind,
    pub scale: f64,
}

pub const EXPANSION_SKIN: [(EnemyKind, ExpansionSkinDef); 7] = [
    (
        EnemyKind::Bloater,
        ExpansionSkinDef {
            kind: EnemyKind::Bloater,
            tint: 0xb6c24a,
            scale: 1.3,
        },
    ),
    (
        EnemyKind::Necromancer,
        ExpansionSkinDef {
            kind: EnemyKind::Necromancer,
            tint: 0x8a5cd0,
            scale: 1.05,
        },
    ),
    (
        EnemyKind::Warden,
        ExpansionSkinDef {
            kind: EnemyKind::Warden,
            tint: 0x4f8fdb,
            scale: 1.05,
        },
    ),
    (
        EnemyKind::Wisp,
        ExpansionSkinDef {
            kind: EnemyKind::Wisp,
            tint: 0x6fe8e8,
            scale: 0.9,
        },
    ),
    (
        EnemyKind::Sapper,
        ExpansionSkinDef {
            kind: EnemyKind::Sapper,
            tint: 0xf0e05a,
            scale: 0.95,
        },
    ),
    (
        EnemyKind::Crystalback,
        ExpansionSkinDef {
            kind: EnemyKind::Crystalback,
            tint: 0x8fdfff,
            scale: 1.12,
        },
    ),
    (
        EnemyKind::Mimic,
        ExpansionSkinDef {
            kind: EnemyKind::Mimic,
            tint: 0xd9a441,
            scale: 0.8,
        },
    ),
];

pub const RESKIN: [(EnemyKind, ReskinDef); 12] = [
    (EnemyKind::Hound, ReskinDef { kind: EnemyKind::Hound, scale: 1.05 }),
    (EnemyKind::Goblin, ReskinDef { kind: EnemyKind::Goblin, scale: 1.0 }),
    (EnemyKind::Pin, ReskinDef { kind: EnemyKind::Pin, scale: 0.85 }),
    (EnemyKind::Golem, ReskinDef { kind: EnemyKind::Golem, scale: 1.12 }),
    (EnemyKind::Chomper, ReskinDef { kind: EnemyKind::Chomper, scale: 1.1 }),
    (EnemyKind::Magnet, ReskinDef { kind: EnemyKind::Magnet, scale: 0.95 }),
    (EnemyKind::Webspinner, ReskinDef { kind: EnemyKind::Webspinner, scale: 1.05 }),
    (EnemyKind::Jester, ReskinDef { kind: EnemyKind::Jester, scale: 1.0 }),
    (EnemyKind::Croaker, ReskinDef { kind: EnemyKind::Croaker, scale: 1.0 }),
    (EnemyKind::Rotortail, ReskinDef { kind: EnemyKind::Rotortail, scale: 0.95 }),
    (EnemyKind::Stiltneck, ReskinDef { kind: EnemyKind::Stiltneck, scale: 1.0 }),
    (EnemyKind::FishFeet, ReskinDef { kind: EnemyKind::FishFeet, scale: 1.0 }),
];

static ZOMBIE_NID_SEQ: AtomicU32 = AtomicU32::new(0);

#[derive(Clone, Copy, Debug)]
pub struct PendingMini {
    pub x: f64,
    pub z: f64,
    pub speed: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct PendingSummon {
    pub x: f64,
    pub z: f64,
}

static PENDING_MINIS: RwLock<Vec<PendingMini>> = RwLock::new(Vec::new());
static PENDING_SUMMONS: RwLock<Vec<PendingSummon>> = RwLock::new(Vec::new());

pub fn reset_zombie_nid() {
    ZOMBIE_NID_SEQ.store(0, Ordering::SeqCst);
}

pub fn bump_zombie_nid(nid: &str) {
    if let Some(num_str) = nid.strip_prefix('z') {
        if let Ok(n) = num_str.parse::<u32>() {
            let current = ZOMBIE_NID_SEQ.load(Ordering::SeqCst);
            if n >= current {
                ZOMBIE_NID_SEQ.store(n + 1, Ordering::SeqCst);
            }
        }
    }
}

pub fn queue_mini(x: f64, z: f64, speed: f64) {
    let mut write = PENDING_MINIS.write().unwrap();
    write.push(PendingMini { x, z, speed });
}

pub fn queue_summon(x: f64, z: f64) {
    let mut write = PENDING_SUMMONS.write().unwrap();
    write.push(PendingSummon { x, z });
}

pub fn drain_pending_minis(monsters: &mut Vec<LiveMonster>) {
    let mut write = PENDING_MINIS.write().unwrap();
    if write.is_empty() {
        return;
    }
    for spec in write.drain(..) {
        for side in [-1.0, 1.0] {
            let mut mini = LiveMonster::new(
                ZOMBIE_NID_SEQ.fetch_add(1, Ordering::SeqCst),
                EnemyKind::Slime,
                spec.x + side * 0.35,
                spec.z,
            );
            mini.hp = SLIME_MINI_HP as f64;
            mini.max_hp = SLIME_MINI_HP as f64;
            mini.speed = spec.speed * SLIME_MINI_SPEED_MULT;
            mini.radius = ZOMBIE_R * SLIME_MINI_SCALE;
            monsters.push(mini);
        }
    }
}

pub fn drain_pending_summons(monsters: &mut Vec<LiveMonster>, base_speed: f64) {
    let mut write = PENDING_SUMMONS.write().unwrap();
    if write.is_empty() {
        return;
    }
    for spec in write.drain(..) {
        let add = LiveMonster::new(
            ZOMBIE_NID_SEQ.fetch_add(1, Ordering::SeqCst),
            EnemyKind::Zombie,
            spec.x,
            spec.z,
        );
        let mut m = add;
        m.speed = base_speed;
        monsters.push(m);
    }
}

pub fn make_expansion(kind: EnemyKind, x: f64, z: f64, speed: f64) -> Option<LiveMonster> {
    let skin = EXPANSION_SKIN.iter().find(|(k, _)| *k == kind)?.1;
    let mut m = LiveMonster::new(
        ZOMBIE_NID_SEQ.fetch_add(1, Ordering::SeqCst),
        kind,
        x,
        z,
    );
    m.speed = speed;
    m.radius *= skin.scale;
    Some(m)
}

pub fn make_reskin(kind: EnemyKind, x: f64, z: f64, speed: f64) -> Option<LiveMonster> {
    let skin = RESKIN.iter().find(|(k, _)| *k == kind)?.1;
    let mut m = LiveMonster::new(
        ZOMBIE_NID_SEQ.fetch_add(1, Ordering::SeqCst),
        kind,
        x,
        z,
    );
    m.speed = speed;
    m.radius *= skin.scale;
    Some(m)
}

#[derive(Default, Clone, Copy)]
pub struct MakeZombieOpts {
    pub kind: Option<EnemyKind>,
    pub hp: Option<f64>,
    pub max_hp: Option<f64>,
    pub boss: bool,
    pub ztype: Option<ZombieType>,
}

pub fn make_zombie(
    x: f64,
    z: f64,
    speed: f64,
    opts: MakeZombieOpts,
) -> LiveMonster {
    let kind = opts.kind.unwrap_or(EnemyKind::Zombie);
    let nid = ZOMBIE_NID_SEQ.fetch_add(1, Ordering::SeqCst);
    let mut m = LiveMonster::new(nid, kind, x, z);
    m.speed = speed;

    if let Some(hp) = opts.hp {
        m.hp = hp;
    }
    if let Some(max_hp) = opts.max_hp {
        m.max_hp = max_hp;
    }

    if let Some(t) = opts.ztype {
        if t != ZombieType::Shambler {
            let d = t.def();
            m.speed = speed * d.speed_mult;
            if opts.hp.is_none() {
                m.hp = type_hp(m.hp as i32, t) as f64;
            }
            if opts.max_hp.is_none() {
                m.max_hp = type_hp(m.max_hp as i32, t) as f64;
            }
            if (d.scale - 1.0).abs() > 1e-4 {
                m.radius = ZOMBIE_R * d.body_r_mult;
            }
        }
    }

    m
}

pub fn spawn_kind(kind: EnemyKind, x: f64, z: f64, base_speed: f64, level: u32) -> Option<LiveMonster> {
    let lvl = level as i32;
    match kind {
        EnemyKind::Brute => {
            if lvl >= BRUTE_FROM_LEVEL {
                Some(make_zombie(x, z, base_speed * BRUTE_SPEED_FACTOR, MakeZombieOpts { kind: Some(EnemyKind::Brute), ..Default::default() }))
            } else {
                None
            }
        }
        EnemyKind::Spitter => {
            if lvl >= SPITTER_FROM_LEVEL {
                Some(make_zombie(x, z, base_speed * SPITTER_SPEED_FACTOR, MakeZombieOpts { kind: Some(EnemyKind::Spitter), ..Default::default() }))
            } else {
                None
            }
        }
        EnemyKind::Spider => {
            if lvl >= SPIDER_FROM_LEVEL {
                Some(make_zombie(x, z, base_speed * SPIDER_SPEED_FACTOR, MakeZombieOpts { kind: Some(EnemyKind::Spider), ..Default::default() }))
            } else {
                None
            }
        }
        EnemyKind::Ghost => {
            if lvl >= GHOST_FROM_LEVEL {
                Some(make_zombie(x, z, base_speed * GHOST_SPEED_FACTOR, MakeZombieOpts { kind: Some(EnemyKind::Ghost), ..Default::default() }))
            } else {
                None
            }
        }
        EnemyKind::Bat => {
            if lvl >= BAT_FROM_LEVEL {
                Some(make_zombie(x, z, base_speed * BAT_SPEED_FACTOR, MakeZombieOpts { kind: Some(EnemyKind::Bat), ..Default::default() }))
            } else {
                None
            }
        }
        EnemyKind::Slime => {
            if lvl >= SLIME_FROM_LEVEL {
                Some(make_zombie(x, z, base_speed * SLIME_SPEED_FACTOR, MakeZombieOpts { kind: Some(EnemyKind::Slime), ..Default::default() }))
            } else {
                None
            }
        }
        EnemyKind::Sporeling => {
            if lvl >= SPORELING_FROM_LEVEL {
                Some(make_zombie(x, z, base_speed * SPORELING_SPEED_FACTOR, MakeZombieOpts { kind: Some(EnemyKind::Sporeling), ..Default::default() }))
            } else {
                None
            }
        }
        EnemyKind::Jester => {
            if lvl >= JESTER_FROM_LEVEL {
                make_reskin(EnemyKind::Jester, x, z, base_speed * JESTER_SPEED_FACTOR)
            } else {
                None
            }
        }
        EnemyKind::Croaker => {
            if lvl >= CROAKER_FROM_LEVEL {
                make_reskin(EnemyKind::Croaker, x, z, base_speed * CROAKER_SPEED_FACTOR)
            } else {
                None
            }
        }
        EnemyKind::Rotortail => {
            if lvl >= ROTORTAIL_FROM_LEVEL {
                make_reskin(EnemyKind::Rotortail, x, z, base_speed * ROTORTAIL_SPEED_FACTOR)
            } else {
                None
            }
        }
        EnemyKind::Stiltneck => {
            if lvl >= STILTNECK_FROM_LEVEL {
                make_reskin(EnemyKind::Stiltneck, x, z, base_speed * STILTNECK_SPEED_FACTOR)
            } else {
                None
            }
        }
        EnemyKind::FishFeet => make_reskin(EnemyKind::FishFeet, x, z, base_speed * 1.15),
        EnemyKind::Goblin => {
            if lvl >= GOBLIN_FROM_LEVEL {
                make_reskin(EnemyKind::Goblin, x, z, base_speed * GOBLIN_SPEED_FACTOR)
            } else {
                None
            }
        }
        EnemyKind::Chomper => {
            if lvl >= CHOMPER_FROM_LEVEL {
                make_reskin(EnemyKind::Chomper, x, z, 0.0)
            } else {
                None
            }
        }
        EnemyKind::Golem => {
            if lvl >= GOLEM_FROM_LEVEL {
                make_reskin(EnemyKind::Golem, x, z, 0.0)
            } else {
                None
            }
        }
        EnemyKind::Magnet => {
            if lvl >= MAGNET_FROM_LEVEL {
                make_reskin(EnemyKind::Magnet, x, z, base_speed * MAGNET_SPEED_FACTOR)
            } else {
                None
            }
        }
        EnemyKind::Webspinner => {
            if lvl >= WEBSPIN_FROM_LEVEL {
                make_reskin(EnemyKind::Webspinner, x, z, base_speed * WEBSPIN_SPEED_FACTOR)
            } else {
                None
            }
        }
        EnemyKind::Hound => {
            if lvl >= HOUND_FROM_LEVEL {
                make_reskin(EnemyKind::Hound, x, z, base_speed * HOUND_SPEED_FACTOR)
            } else {
                None
            }
        }
        EnemyKind::Bloater => {
            if lvl >= BLOATER_FROM_LEVEL {
                make_expansion(EnemyKind::Bloater, x, z, base_speed * BLOATER_SPEED_FACTOR)
            } else {
                None
            }
        }
        EnemyKind::Necromancer => {
            if lvl >= NECRO_FROM_LEVEL {
                make_expansion(EnemyKind::Necromancer, x, z, base_speed * NECRO_SPEED_FACTOR)
            } else {
                None
            }
        }
        EnemyKind::Warden => {
            if lvl >= WARDEN_FROM_LEVEL {
                make_expansion(EnemyKind::Warden, x, z, base_speed * WARDEN_SPEED_FACTOR)
            } else {
                None
            }
        }
        EnemyKind::Wisp => {
            if lvl >= WISP_FROM_LEVEL {
                make_expansion(EnemyKind::Wisp, x, z, base_speed * WISP_SPEED_FACTOR)
            } else {
                None
            }
        }
        EnemyKind::Sapper => {
            if lvl >= SAPPER_FROM_LEVEL {
                make_expansion(EnemyKind::Sapper, x, z, base_speed * SAPPER_SPEED_FACTOR)
            } else {
                None
            }
        }
        EnemyKind::Crystalback => {
            if lvl >= CRYSTAL_FROM_LEVEL {
                make_expansion(EnemyKind::Crystalback, x, z, 0.0)
            } else {
                None
            }
        }
        EnemyKind::Mimic => {
            if lvl >= MIMIC_FROM_LEVEL {
                make_expansion(EnemyKind::Mimic, x, z, base_speed * MIMIC_SPEED_FACTOR)
            } else {
                None
            }
        }
        _ => None,
    }
}

pub fn spawn_horde_member(
    hash: u32,
    x: f64,
    z: f64,
    base_speed: f64,
    level: u32,
) -> LiveMonster {
    let lvl = level as i32;
    let h = hash as usize;

    if lvl >= BRUTE_FROM_LEVEL && h % BRUTE_RATIO == 0 {
        return make_zombie(x, z, base_speed * BRUTE_SPEED_FACTOR, MakeZombieOpts { kind: Some(EnemyKind::Brute), ..Default::default() });
    }
    if lvl >= SPITTER_FROM_LEVEL && h % SPITTER_RATIO == 1 {
        return make_zombie(x, z, base_speed * SPITTER_SPEED_FACTOR, MakeZombieOpts { kind: Some(EnemyKind::Spitter), ..Default::default() });
    }
    if lvl >= SPIDER_FROM_LEVEL && h % SPIDER_RATIO == 2 {
        return make_zombie(x, z, base_speed * SPIDER_SPEED_FACTOR, MakeZombieOpts { kind: Some(EnemyKind::Spider), ..Default::default() });
    }
    if lvl >= GHOST_FROM_LEVEL && h % GHOST_RATIO == 3 {
        return make_zombie(x, z, base_speed * GHOST_SPEED_FACTOR, MakeZombieOpts { kind: Some(EnemyKind::Ghost), ..Default::default() });
    }
    if lvl >= BAT_FROM_LEVEL && h % BAT_RATIO == 3 {
        return make_zombie(x, z, base_speed * BAT_SPEED_FACTOR, MakeZombieOpts { kind: Some(EnemyKind::Bat), ..Default::default() });
    }
    if lvl >= SLIME_FROM_LEVEL && h % SLIME_RATIO == 4 {
        return make_zombie(x, z, base_speed * SLIME_SPEED_FACTOR, MakeZombieOpts { kind: Some(EnemyKind::Slime), ..Default::default() });
    }
    if lvl >= GOBLIN_FROM_LEVEL && h % GOBLIN_RATIO == 1 {
        if let Some(m) = make_reskin(EnemyKind::Goblin, x, z, base_speed * GOBLIN_SPEED_FACTOR) {
            return m;
        }
    }
    if lvl >= SPORELING_FROM_LEVEL && h % SPORELING_RATIO == 3 {
        return make_zombie(x, z, base_speed * SPORELING_SPEED_FACTOR, MakeZombieOpts { kind: Some(EnemyKind::Sporeling), ..Default::default() });
    }
    if lvl >= CHOMPER_FROM_LEVEL && h % CHOMPER_RATIO == 5 {
        if let Some(m) = make_reskin(EnemyKind::Chomper, x, z, 0.0) {
            return m;
        }
    }
    if lvl >= GOLEM_FROM_LEVEL && h % GOLEM_RATIO == 5 {
        if let Some(m) = make_reskin(EnemyKind::Golem, x, z, 0.0) {
            return m;
        }
    }
    if lvl >= MAGNET_FROM_LEVEL && h % MAGNET_RATIO == 6 {
        if let Some(m) = make_reskin(EnemyKind::Magnet, x, z, base_speed * MAGNET_SPEED_FACTOR) {
            return m;
        }
    }
    if lvl >= ROTORTAIL_FROM_LEVEL && h % ROTORTAIL_RATIO == 6 {
        if let Some(m) = make_reskin(EnemyKind::Rotortail, x, z, base_speed * ROTORTAIL_SPEED_FACTOR) {
            return m;
        }
    }
    if lvl >= STILTNECK_FROM_LEVEL && h % STILTNECK_RATIO == 9 {
        if let Some(m) = make_reskin(EnemyKind::Stiltneck, x, z, base_speed * STILTNECK_SPEED_FACTOR) {
            return m;
        }
    }
    if lvl >= CROAKER_FROM_LEVEL && h % CROAKER_RATIO == 8 {
        if let Some(m) = make_reskin(EnemyKind::Croaker, x, z, base_speed * CROAKER_SPEED_FACTOR) {
            return m;
        }
    }
    if lvl >= JESTER_FROM_LEVEL && h % JESTER_RATIO == 4 {
        if let Some(m) = make_reskin(EnemyKind::Jester, x, z, base_speed * JESTER_SPEED_FACTOR) {
            return m;
        }
    }
    if lvl >= WEBSPIN_FROM_LEVEL && h % WEBSPIN_RATIO == 2 {
        if let Some(m) = make_reskin(EnemyKind::Webspinner, x, z, base_speed * WEBSPIN_SPEED_FACTOR) {
            return m;
        }
    }

    let ztype = pick_zombie_type(hash, level);
    make_zombie(x, z, base_speed, MakeZombieOpts { ztype: Some(ztype), ..Default::default() })
}

pub fn spawn_pin_crew(g: &Grid, centre: TilePos, sim: &mut SimState) {
    let rack: [(f64, f64); 6] = [
        (0.0, 0.0),
        (0.55, -0.35),
        (0.55, 0.35),
        (1.1, -0.7),
        (1.1, 0.0),
        (1.1, 0.7),
    ];
    let (cx, cz) = tile_center(g, centre.i, centre.j);
    let count = PIN_CREW_SIZE.min(rack.len());

    for k in 0..count {
        let px = cx + rack[k].0;
        let pz = cz + rack[k].1;
        let (ti, tj) = world_to_tile(g, px, pz);
        let spot = if is_walkable(g, ti, tj) {
            (px, pz)
        } else if let Some(open) = nearest_open_tile(g, centre.i, centre.j, k + 1, 1) {
            tile_center(g, open.i, open.j)
        } else {
            (cx, cz)
        };

        if let Some(pin) = make_reskin(EnemyKind::Pin, spot.0, spot.1, 0.0) {
            sim.monsters.push(pin);
        }
    }
}
