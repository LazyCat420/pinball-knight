//! Public Tavern Entry Interface — Dispatches between 3D walkable scene and 2D fallback sheet.
//!
//! Port of `legacy/src/scenes/tavern/index.ts` (52 lines).
//!
//! PORTS: `legacy/src/scenes/tavern/index.ts`

pub use crate::tavern::state::TavernStats;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TavernEntryKind {
    Scene,
    Dom,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct OpenTavernOptions {
    pub stats: Option<TavernStats>,
    pub lobby: bool,
}

pub fn close_tavern() {}

pub fn is_tavern_scene_open() -> bool {
    false
}

pub fn enter_tavern(has_3d_context: bool, opts: &OpenTavernOptions) -> TavernEntryKind {
    resolve_tavern_entry(has_3d_context, opts)
}

/// Determines the presentation path for entering the tavern.
pub fn resolve_tavern_entry(has_3d_context: bool, _opts: &OpenTavernOptions) -> TavernEntryKind {
    if has_3d_context {
        TavernEntryKind::Scene
    } else {
        TavernEntryKind::Dom
    }
}
