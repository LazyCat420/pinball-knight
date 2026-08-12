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
//!
//! ⚠️ `camera.ts` DOES NOT EXIST. This list used to name it, because the Rust
//! module is `tavern/camera.rs` and the file name was assumed from the module
//! name. The camera math's real source is `core.ts`, which `camera.rs` cites
//! itself (as PARTIAL — it is ten lines of a 906-line file). The citation went
//! unnoticed because the dangling check exempted every path starting with
//! `legacy/`; see `xtask/src/coverage.rs`.
//!
//! PORTS: `legacy/src/scenes/tavern/layout.ts`, `legacy/src/scenes/tavern/player.ts`,
//! `legacy/src/scenes/tavern/npcs.ts`, `legacy/src/scenes/tavern/join-board.ts`

pub mod camera;
pub mod join_board;
pub mod layout;
pub mod npcs;
pub mod player;
pub mod state;
