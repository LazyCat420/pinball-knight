//! The legacy immediate-mode GUI, ported 1:1 from `legacy/src/game/pinball-knight/gui/`.
//!
//! PORTS: `hud-face.ts`, `gui/im.ts`, `gui/input.ts`, `gui/touch.ts`, `render/remote-party.ts`, `boot/warmup.ts`, `render/arc-lanes.ts`, `render/arc-kickers.ts`, `render/light-crossing.ts`, `render/aim-indicator.ts`, `render/palette-shading.ts`, `render/monster-portrait.ts`, `legacy/src/pixel/pixel-text.ts`, `gui/coords.ts`, `legacy/src/pixel/pixel-font.ts`, `map-overlay.ts`, `hud-meter.ts`, `gui/apply-settings.ts`, `pickup-toast.ts`, `gui/globe-ripple.ts`, `floor-loading.ts`, `pixel-fonts.ts`, `dev/gui-hooks.ts`
//! PORTS-PARTIAL: `gui/layer.ts` - NOT a finished port - 0 of 12 exported names carried over (0%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md
//! PORTS-PARTIAL: `legacy/src/pixel/pixel-canvas.ts` - NOT a finished port - 0 of 6 exported names carried over (0%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md
//! PORTS-PARTIAL: `legacy/src/pixel/pixel-icon.ts` - NOT a finished port - 0 of 4 exported names carried over (0%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md
//! PORTS-PARTIAL: `ui.ts` - NOT a finished port - 0 of 16 exported names carried over (0%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md
//! PORTS-PARTIAL: `hud.ts` - NOT a finished port - 0 of 5 exported names carried over (0%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md
//! PORTS-PARTIAL: `engine/render/sprite.ts` - NOT a finished port - 66 rust code lines against 757 legacy (9%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md
//! PORTS-PARTIAL: `legacy/src/render/backend.ts` - NOT a finished port - 18 rust code lines against 93 legacy (19%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md
//! PORTS-PARTIAL: `legacy/src/scenes/tavern/gambler/roulette-art.ts` - NOT a finished port - 54 rust code lines against 423 legacy (13%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

pub mod apply_settings;
pub mod boot;
pub mod cards;
pub mod coords;
pub mod dev_gui_hooks;
pub mod engine;
pub mod floor_loading;
pub mod font;
pub mod gambler;
pub mod globe_ripple;
pub mod hud_ctrl;
pub mod hud_face;
pub mod hud_meter;
pub mod icons;
pub mod im;
pub mod input;
pub mod layer;
pub mod map_overlay;
pub mod painter;
pub mod palette;
pub mod pickup_toast;
pub mod pixel_canvas;
pub mod pixel_font;
pub mod pixel_fonts;
pub mod pixel_icon;
pub mod pixel_text;
pub mod remote_party;
pub mod render;
pub mod render_backend;
pub mod root;
pub mod screens;
pub mod stack;
pub mod theme;
pub mod touch;
pub mod ui_shim;

pub use apply_settings::*;
pub use boot::*;
pub use coords::*;
pub use dev_gui_hooks::*;
pub use engine::*;
pub use floor_loading::*;
pub use font::Fonts;
pub use gambler::*;
pub use globe_ripple::*;
pub use hud_ctrl::*;
pub use hud_meter::*;
pub use im::{Rect, UiFrame, UiInput};
pub use input::*;
pub use layer::*;
pub use map_overlay::*;
pub use painter::{Painter, Rgba};
pub use pickup_toast::*;
pub use pixel_canvas::*;
pub use pixel_font::*;
pub use pixel_fonts::*;
pub use pixel_icon::*;
pub use pixel_text::*;
pub use remote_party::*;
pub use render::*;
pub use render_backend::*;
pub use stack::{ScreenEntry, UiStack};
pub use touch::*;
