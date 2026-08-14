//! The legacy immediate-mode GUI, ported 1:1 from `legacy/src/game/pinball-knight/gui/`.
//!
//! PORTS: `gui/im.ts`, `gui/input.ts`

pub mod cards;
pub mod font;
pub mod icons;
pub mod im;
pub mod input;
pub mod painter;
pub mod palette;
pub mod root;
pub mod screens;
pub mod stack;
pub mod theme;

pub use font::Fonts;
pub use im::{Rect, UiFrame, UiInput};
pub use input::*;
pub use painter::{Painter, Rgba};
pub use stack::{ScreenEntry, UiStack};
