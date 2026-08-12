//! The legacy immediate-mode GUI, ported 1:1 from `legacy/src/game/pinball-knight/gui/`.
//!
//! ## What this crate is
//!
//! The TS game draws its whole interface with `gui/im.ts` — an immediate-mode
//! toolkit painting onto a hidden Canvas2D sized exactly to the pixel-render
//! grid, which the pixel pass then composites BEFORE the cel grade. This crate
//! is that toolkit on a CPU RGBA buffer: same primitives, same call-order
//! widget identity, same load-bearing draw orders, same `Math.round`.
//!
//! ## What this crate is NOT
//!
//! - Not a Bevy plugin. The shell (`pk-game/src/gui.rs`) owns the texture
//!   upload, the input feed and the schedule; everything here runs under plain
//!   `cargo test -p pk-gui` with no GPU and no window.
//! - Not a font rasteriser. Text blits from browser-baked glyph atlases
//!   (`cargo xtask bake --gui-font`) — the ONLY way to be bit-exact against
//!   the legacy canvas, whose text is Skia's `fillText` raster.
//!
//! ## Porting rules carried from the oracle
//!
//! - `px()` is JS `Math.round` = `floor(v + 0.5)`, NOT Rust's `round` (they
//!   disagree at negative halves, which `focusRing`'s `inset(r, -2)` hits at
//!   screen edges).
//! - `key()` draws face → keyline → bevel-inset-1, in that order. The first
//!   legacy version drew the bevel before the caller's stroke and every button
//!   rendered flat (im.ts:480).
//! - Directional input is a PRESS COUNT, not a boolean — a paused screen has
//!   been measured painting at 2 fps under load, and booleans collapse repeats.
//! - Hit testing happens in CONTENT space (`origin_y`) so scrolled lists don't
//!   answer clicks `offset` pixels off (im.ts's debug-console war story).
//!
//! PORTS: `gui/im.ts`

pub mod cards;
pub mod font;
pub mod icons;
pub mod im;
pub mod painter;
pub mod palette;
pub mod root;
pub mod screens;
pub mod stack;
pub mod theme;

pub use font::Fonts;
pub use im::{Rect, UiFrame, UiInput};
pub use painter::{Painter, Rgba};
pub use stack::{ScreenEntry, UiStack};
