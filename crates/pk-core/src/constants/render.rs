//! Render pipeline, camera, sprites, lighting, atmosphere and animation timing.
//!
//! ## This module was INVENTED once. Do not let it be again.
//!
//! Until 2026-08-16 this file declared `PORTS: constants/render.ts` while
//! sharing **zero** of that file's 70 exported names. It made up
//! `DESIGN_VIEWPORT_W`, an eleven-rung `RUNG_*` sorting ladder,
//! `LIGHT_FALLOFF_LINEAR`/`_QUADRATIC` and a `calculate_light_attenuation()` —
//! none of which exist anywhere in the oracle — while every real constant
//! (`RENDER_W`, `CAMERA_ZOOMS`, `PPU`, `CEL_STEPS`, `AMBIENT_INTENSITY`,
//! `SHADOW_MAP_SIZE`, `FOG_NEAR`…) was absent. The ledger counted the file as
//! converted because it only ever measured the size of the thing being
//! replaced.
//!
//! A table of constants is the one kind of port that can be checked EXACTLY,
//! so it is: `legacy/…/port-fixtures.test.ts` dumps all 77 values to
//! `assets/fixtures/constants-render.json`, and
//! `crates/pk-core/tests/constants_render.rs` fails if one of them drifts or
//! goes missing. Add a constant here and to the oracle, or the fixture test
//! will tell you which side you forgot.
//!
//! Values are `f64` where the oracle does arithmetic with them and the port's
//! sim is f64-deterministic; the handful that index or count are integers.
//!
//! PORTS: `constants/render.ts`

// ── Render pipeline ─────────────────────────────────────────────────────────

/// The REFERENCE render resolution — the FLOOR, not a fixed size.
///
/// `computeRenderSizing()` derives the real target from the window each resize
/// so the upscale is always a whole number and the image still fills the
/// screen. The player never sees LESS than this much level, and on a window
/// that is not an exact multiple they see somewhat more.
pub const RENDER_W: f64 = 1280.0;
pub const RENDER_H: f64 = 720.0;

/// Ceiling on the derived render target — a field-of-view clamp first, an
/// allocation guard second. `PPU` is pinned, so the render width IS the field
/// of view.
pub const MAX_RENDER_W: f64 = 2160.0;
pub const MAX_RENDER_H: f64 = 1216.0;

// ── Camera ──────────────────────────────────────────────────────────────────

/// The five named zooms, in pixels-per-unit. Ordered by `CAMERA_ZOOM_ORDER`.
pub const CAMERA_ZOOM_CLOSE: f64 = 80.0;
pub const CAMERA_ZOOM_NORMAL: f64 = 72.0;
pub const CAMERA_ZOOM_WIDE: f64 = 64.0;
pub const CAMERA_ZOOM_WIDER: f64 = 56.0;
pub const CAMERA_ZOOM_WIDEST: f64 = 48.0;

/// The order the settings screen cycles them in.
pub const CAMERA_ZOOM_ORDER: [&str; 5] = ["close", "normal", "wide", "wider", "widest"];

pub const CAMERA_ZOOM_DEFAULT: &str = "wider";

/// localStorage key for the settings blob. Kept because the web build shares
/// the oracle's saved settings.
pub const SETTINGS_KEY: &str = "pinball-knight-settings";

/// The live zoom — the default, resolved.
pub const CAMERA_ZOOM: &str = "wider";

/// Pixels per world unit at the live zoom. `VIEW_W`/`VIEW_H` follow from it.
pub const PPU: f64 = 56.0;
pub const VIEW_W: f64 = 22.857_142_857_142_858;
pub const VIEW_H: f64 = 12.857_142_857_142_858;

/// The 38°/45° isometric rig, in radians.
pub const CAMERA_TILT: f64 = 0.663_225_115_757_845_2;
pub const CAMERA_YAW: f64 = 0.785_398_163_397_448_3;
pub const CAMERA_DIST: f64 = 24.0;

// ── Sprites ─────────────────────────────────────────────────────────────────

pub const ART_PX: f64 = 128.0;
pub const SPRITE_PX: f64 = 168.0;
pub const SPRITE_PIXEL_GRID: f64 = 84.0;
pub const SPRITE_UNITS: f64 = 1.5;

// ── Post chain defaults ─────────────────────────────────────────────────────
//
// Quantize / dither / scanline / outline are retired defaults — the plumbing
// survives in `pixel-pass.ts` but ships off. `false` here is the shipped value,
// not an omission.

pub const QUANTIZE_DEFAULT: bool = false;
pub const DITHER_DEFAULT: bool = false;
pub const SCANLINE_DEFAULT: bool = false;
pub const OUTLINE_DEFAULT: bool = false;
pub const CEL_DEFAULT: bool = true;

pub const CEL_STEPS: f64 = 10.0;
pub const CEL_CURVE: f64 = 0.5;
pub const CEL_SATURATION: f64 = 1.15;
pub const OUTLINE_EDGE_THRESHOLD: f64 = 0.4;

// ── Lighting ────────────────────────────────────────────────────────────────

pub const AMBIENT_INTENSITY: f64 = 3.5;
pub const HEMI_INTENSITY: f64 = 1.1;
pub const DIR_INTENSITY: f64 = 1.5;
pub const PLAYER_LAMP_INTENSITY: f64 = 1.6;
pub const PLAYER_LAMP_RANGE: f64 = 4.5;
pub const DIR_HEIGHT: f64 = 14.0;
pub const SHADOW_MAP_SIZE: u32 = 1024;
pub const SHADOW_AREA: f64 = 16.0;
pub const SHADOW_OPACITY: f64 = 0.42;

/// How many point lights the dungeon may have alive at once. The floor has 41
/// torches and this is 6 — they are a PARKED POOL moved to the nearest
/// torches, never one light per torch.
pub const TORCH_LIGHT_POOL: usize = 6;

// ── Atmosphere ──────────────────────────────────────────────────────────────

pub const FOG_NEAR: f64 = 30.0;
pub const FOG_FAR: f64 = 58.0;
pub const BLOOM_THRESHOLD: f64 = 0.7;
pub const BLOOM_STRENGTH: f64 = 0.9;
pub const BLOOM_RADIUS: f64 = 2.2;
pub const BLOOM_DEFAULT: bool = true;
pub const AO_RADIUS: f64 = 14.0;
pub const AO_STRENGTH: f64 = 0.85;
pub const AO_DEFAULT: bool = true;
pub const VIGNETTE: f64 = 0.32;

// ── Set dressing cadence ────────────────────────────────────────────────────
//
// "Every Nth" along a wall run — read by the decoration pass.

pub const PILASTER_EVERY: i32 = 5;
pub const BANNER_EVERY: i32 = 7;
pub const CLUTTER_EVERY: i32 = 6;

pub const FLAME_FRAMES: i32 = 4;
pub const FLAME_FPS: f64 = 9.0;
pub const MOTE_RATE: f64 = 2.2;

// ── Animation rates, frames per second ──────────────────────────────────────

pub const FPS_IDLE: f64 = 3.0;
pub const FPS_WALK: f64 = 8.0;
pub const FPS_ATTACK: f64 = 12.0;
pub const FPS_DEATH: f64 = 6.0;
pub const FPS_ROLL: f64 = 14.0;
pub const FPS_EQUIP: f64 = 8.0;
pub const FPS_FORGE: f64 = 7.0;
pub const FPS_RUN: f64 = 10.0;
pub const FPS_CROUCH: f64 = 7.0;
pub const FPS_WAIT: f64 = 5.0;
pub const FPS_WAKE: f64 = 10.0;
pub const FPS_STUMBLE: f64 = 9.0;

/// How fast the run cycle ramps up with speed.
pub const RUN_RATE_RAMP: f64 = 0.6;

// ── Camera follow ───────────────────────────────────────────────────────────

pub const CAM_DEADZONE: f64 = 0.7;
pub const CAM_LERP: f64 = 6.0;

/// The live zoom's pixels-per-unit, by name.
///
/// The oracle exports `CAMERA_ZOOMS` as an object and indexes it with the
/// setting; this is that lookup, kept as a function so the five values have one
/// definition rather than a second copy in every caller.
pub fn camera_zoom(name: &str) -> Option<f64> {
    Some(match name {
        "close" => CAMERA_ZOOM_CLOSE,
        "normal" => CAMERA_ZOOM_NORMAL,
        "wide" => CAMERA_ZOOM_WIDE,
        "wider" => CAMERA_ZOOM_WIDER,
        "widest" => CAMERA_ZOOM_WIDEST,
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `VIEW_W`/`VIEW_H` are DERIVED in the oracle (`RENDER_W / PPU`), and a
    /// transcribed derived value is a value free to drift from its own
    /// definition. This is the one relationship the fixture cannot check for
    /// us, because the fixture pins both sides of it.
    #[test]
    fn the_view_is_the_render_size_over_ppu() {
        assert_eq!(VIEW_W, RENDER_W / PPU);
        assert_eq!(VIEW_H, RENDER_H / PPU);
    }

    #[test]
    fn the_default_zoom_resolves_and_is_the_live_one() {
        assert_eq!(camera_zoom(CAMERA_ZOOM_DEFAULT), Some(PPU));
        assert_eq!(CAMERA_ZOOM, CAMERA_ZOOM_DEFAULT);
        assert!(CAMERA_ZOOM_ORDER.contains(&CAMERA_ZOOM_DEFAULT));
        assert_eq!(camera_zoom("nonsense"), None);
    }

    /// The order list must name every zoom exactly once — a settings screen
    /// that cycles a name `camera_zoom` cannot resolve would jam.
    #[test]
    fn every_ordered_zoom_resolves() {
        for name in CAMERA_ZOOM_ORDER {
            assert!(camera_zoom(name).is_some(), "{name} does not resolve");
        }
        assert_eq!(CAMERA_ZOOM_ORDER.len(), 5);
    }
}
