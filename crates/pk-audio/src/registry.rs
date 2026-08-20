//! Audio Patch Audition Registry — Dictionary of all synthesized sound effects and category bindings.
//!
//! PORTS: `sfx/registry.ts`

use crate::bus::SfxCategory;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum SfxPatchName {
    // Combat
    Swing,
    Heavy,
    Hit,
    Hurt,
    Break,
    // Weapons
    Gun,
    Laser,
    Flame,
    Freeze,
    Lightning,
    Hammer,
    Poison,
    Axe,
    Scythe,
    Dagger,
    Spear,
    Bomb,
    // Pinball
    Bump,
    Roll,
    Slingshot,
    Plunger,
    Drain,
    // Monsters
    Spit,
    Growl,
    Screech,
    // World
    Coin,
    DoorOpen,
    // Run
    LevelUp,
}

pub type SfxName = SfxPatchName;
pub type SfxTrigger = fn();

pub const ALL_PATCHES: [SfxPatchName; 28] = [
    SfxPatchName::Swing,
    SfxPatchName::Heavy,
    SfxPatchName::Hit,
    SfxPatchName::Hurt,
    SfxPatchName::Break,
    SfxPatchName::Gun,
    SfxPatchName::Laser,
    SfxPatchName::Flame,
    SfxPatchName::Freeze,
    SfxPatchName::Lightning,
    SfxPatchName::Hammer,
    SfxPatchName::Poison,
    SfxPatchName::Axe,
    SfxPatchName::Scythe,
    SfxPatchName::Dagger,
    SfxPatchName::Spear,
    SfxPatchName::Bomb,
    SfxPatchName::Bump,
    SfxPatchName::Roll,
    SfxPatchName::Slingshot,
    SfxPatchName::Plunger,
    SfxPatchName::Drain,
    SfxPatchName::Spit,
    SfxPatchName::Growl,
    SfxPatchName::Screech,
    SfxPatchName::Coin,
    SfxPatchName::DoorOpen,
    SfxPatchName::LevelUp,
];

pub fn patch_category(patch: SfxPatchName) -> SfxCategory {
    match patch {
        SfxPatchName::Swing
        | SfxPatchName::Heavy
        | SfxPatchName::Hit
        | SfxPatchName::Hurt
        | SfxPatchName::Break => SfxCategory::Combat,

        SfxPatchName::Gun
        | SfxPatchName::Laser
        | SfxPatchName::Flame
        | SfxPatchName::Freeze
        | SfxPatchName::Lightning
        | SfxPatchName::Hammer
        | SfxPatchName::Poison
        | SfxPatchName::Axe
        | SfxPatchName::Scythe
        | SfxPatchName::Dagger
        | SfxPatchName::Spear
        | SfxPatchName::Bomb => SfxCategory::Weapons,

        SfxPatchName::Bump
        | SfxPatchName::Roll
        | SfxPatchName::Slingshot
        | SfxPatchName::Plunger
        | SfxPatchName::Drain => SfxCategory::Pinball,

        SfxPatchName::Spit | SfxPatchName::Growl | SfxPatchName::Screech => SfxCategory::Monsters,

        SfxPatchName::Coin | SfxPatchName::DoorOpen => SfxCategory::World,

        SfxPatchName::LevelUp => SfxCategory::Run,
    }
}

pub fn lookup_patch_by_name(key: &str) -> Option<SfxPatchName> {
    match key {
        "swing" => Some(SfxPatchName::Swing),
        "heavy" => Some(SfxPatchName::Heavy),
        "hit" => Some(SfxPatchName::Hit),
        "hurt" => Some(SfxPatchName::Hurt),
        "break" => Some(SfxPatchName::Break),
        "gun" => Some(SfxPatchName::Gun),
        "laser" => Some(SfxPatchName::Laser),
        "flame" => Some(SfxPatchName::Flame),
        "freeze" => Some(SfxPatchName::Freeze),
        "lightning" => Some(SfxPatchName::Lightning),
        "hammer" => Some(SfxPatchName::Hammer),
        "poison" => Some(SfxPatchName::Poison),
        "axe" => Some(SfxPatchName::Axe),
        "scythe" => Some(SfxPatchName::Scythe),
        "dagger" => Some(SfxPatchName::Dagger),
        "spear" => Some(SfxPatchName::Spear),
        "bomb" => Some(SfxPatchName::Bomb),
        "bump" => Some(SfxPatchName::Bump),
        "roll" => Some(SfxPatchName::Roll),
        "slingshot" => Some(SfxPatchName::Slingshot),
        "plunger" => Some(SfxPatchName::Plunger),
        "drain" => Some(SfxPatchName::Drain),
        "spit" => Some(SfxPatchName::Spit),
        "growl" => Some(SfxPatchName::Growl),
        "screech" => Some(SfxPatchName::Screech),
        "coin" => Some(SfxPatchName::Coin),
        "door_open" => Some(SfxPatchName::DoorOpen),
        "level_up" => Some(SfxPatchName::LevelUp),
        _ => None,
    }
}

pub const SFX_NAMES: &[SfxPatchName] = &ALL_PATCHES;

pub fn play_sfx(_name: SfxName, _arg: f64) {}
