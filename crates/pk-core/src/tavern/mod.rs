//! 🍺 THE TAVERN — the walkable between-floor hub (P6).
//!
//! Port of `legacy/src/scenes/tavern/` minus the renderer: the floor plan,
//! the movement step, the diorama read, the keeper idle loops, the camera
//! targeting and the join board are all here, deterministic and testable.
//! The Bevy scene in `pk-game` reads these; it never re-derives them.
//!
//! Deliberately NOT here (shell or later-phase scope, see the port
//! checklist): the WebGPU boot gate/warm pass (`backend-gate.ts`,
//! `warmup.ts`, `boot-notice.ts` — renderer-specific, no Bevy equivalent
//! seam), `presentMode` (Bevy has no skip-present seam), the realtime
//! multiplayer pool (P8), room/prop mesh construction (the shell mirrors
//! `build.ts`/`props.ts` geometry directly), and audio patches (P7).

pub mod camera;
pub mod join_board;
pub mod layout;
pub mod npcs;
pub mod player;
pub mod state;
