//! 🎨 BAKED TAVERN ART — the keeper sprites and the ENTER MAZE sign.
//!
//! House strategy (docs/src/art/bake.md): canvas painters are BAKED by the
//! legacy code in headless Chromium, never re-implemented here. `cargo xtask
//! bake --tavern` writes the PNGs this module embeds; they are `include_bytes!`
//! so native and wasm load identically and a missing/renamed bake is a BUILD
//! error rather than an invisible sprite at runtime.

use bevy::asset::RenderAssetUsages;
use bevy::image::ImageSampler;
use bevy::prelude::*;
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat};

/// legacy engine/config.ts `sprite.units` (3/2) — every actor quad is this
/// many world units on a side.
pub const SPRITE_UNITS: f32 = 1.5;

/// The contact blob's quad, legacy sprite.ts:100-104 (`SPRITE_UNITS * 0.62`).
pub const BLOB_UNITS: f32 = SPRITE_UNITS * 0.62;

/// The baked keeper cels — 84×84 each, palette-snapped, ground shadow already
/// painted in (so a keeper gets NO separate blob quad).
const KEEPER_MERCHANT_PNG: &[u8] = include_bytes!("../../../assets/tavern/keeper-merchant.png");
const KEEPER_WITCH_PNG: &[u8] = include_bytes!("../../../assets/tavern/keeper-witch.png");
const KEEPER_MAGICIAN_PNG: &[u8] = include_bytes!("../../../assets/tavern/keeper-magician.png");
const KEEPER_FROG_PNG: &[u8] = include_bytes!("../../../assets/tavern/keeper-frog.png");
const KEEPER_TOUT_PNG: &[u8] = include_bytes!("../../../assets/tavern/keeper-tout.png");
/// The lit marquee legend, alpha background (legacy props.ts:40-110).
const SIGN_ENTER_MAZE_PNG: &[u8] = include_bytes!("../../../assets/tavern/sign-enter-maze.png");

/// Radius-relative alpha stops of the legacy contact blob (sprite.ts:125-142):
/// a pure radial gradient, so Rust generates it instead of baking a file.
const BLOB_STOPS: [(f32, f32); 3] = [(0.0, 0.6), (0.55, 0.32), (1.0, 0.0)];

/// The baked cel for a keeper's `paint_key`, or `None` for a key with no art —
/// missing art is never fatal, the room just loses a body (npcs.ts:184-186).
pub fn keeper_cel(paint_key: &str) -> Option<Image> {
    let png = match paint_key {
        "merchant" => KEEPER_MERCHANT_PNG,
        "witch" => KEEPER_WITCH_PNG,
        "magician" => KEEPER_MAGICIAN_PNG,
        "frog" => KEEPER_FROG_PNG,
        "tout" => KEEPER_TOUT_PNG,
        _ => return None,
    };
    Some(decode_cel(png))
}

/// The "ENTER MAZE" lettering, 1024×220 with an alpha background.
pub fn sign_enter_maze() -> Image {
    decode_cel(SIGN_ENTER_MAZE_PNG)
}

/// Decode a baked PNG into a NEAREST-sampled texture. Authored pixels have to
/// stay square on screen (legacy `celFilters`), so this is never linear.
fn decode_cel(png: &[u8]) -> Image {
    let rgba = image::load_from_memory(png)
        .expect("baked tavern PNG decodes")
        .to_rgba8();
    let (w, h) = rgba.dimensions();
    rgba_image(w, h, rgba.into_raw(), ImageSampler::nearest())
}

/// 64×64 RGBA soft shadow, matching the legacy canvas gradient to ±1/255.
pub fn blob_image() -> Image {
    const N: u32 = 64;
    let half = N as f32 / 2.0;
    let mut data = Vec::with_capacity((N * N * 4) as usize);
    for y in 0..N {
        for x in 0..N {
            let dx = (x as f32 + 0.5 - half) / half;
            let dy = (y as f32 + 0.5 - half) / half;
            let r = (dx * dx + dy * dy).sqrt().min(1.0);
            let a = gradient_alpha(r);
            data.extend_from_slice(&[0, 0, 0, (a * 255.0).round() as u8]);
        }
    }
    // The blob is a smooth gradient, not authored pixels — linear here.
    rgba_image(N, N, data, ImageSampler::linear())
}

/// Wrap raw RGBA8 bytes as a render-world-only sRGB texture.
fn rgba_image(w: u32, h: u32, data: Vec<u8>, sampler: ImageSampler) -> Image {
    let mut img = Image::new(
        Extent3d {
            width: w,
            height: h,
            depth_or_array_layers: 1,
        },
        TextureDimension::D2,
        data,
        TextureFormat::Rgba8UnormSrgb,
        RenderAssetUsages::RENDER_WORLD,
    );
    img.sampler = sampler;
    img
}

/// Canvas gradients interpolate linearly between stops; the colour is
/// constant black, so only alpha moves.
fn gradient_alpha(r: f32) -> f32 {
    let [(r0, a0), (r1, a1), (r2, a2)] = BLOB_STOPS;
    if r <= r1 {
        let t = ((r - r0) / (r1 - r0)).clamp(0.0, 1.0);
        a0 + (a1 - a0) * t
    } else {
        let t = ((r - r1) / (r2 - r1)).clamp(0.0, 1.0);
        a1 + (a2 - a1) * t
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blob_alpha_follows_the_legacy_stops() {
        assert!((gradient_alpha(0.0) - 0.6).abs() < 1e-6);
        assert!((gradient_alpha(0.55) - 0.32).abs() < 1e-6);
        assert!((gradient_alpha(1.0)).abs() < 1e-6);
        // Midway between the first two stops.
        assert!((gradient_alpha(0.275) - 0.46).abs() < 1e-3);
    }

    /// A wrong-path or re-baked-at-the-wrong-size PNG is otherwise INVISIBLE:
    /// `include_bytes!` would still compile against some other file, and the
    /// sprite would just look wrong on screen. Pin the sizes the bake records
    /// in `assets/tavern/bake.json` so the failure lands in the suite instead.
    #[test]
    fn every_baked_png_decodes_at_its_recorded_size() {
        for key in ["merchant", "witch", "magician", "frog", "tout"] {
            let img = keeper_cel(key).unwrap_or_else(|| panic!("{key} has a baked cel"));
            assert_eq!((img.width(), img.height()), (84, 84), "keeper-{key}.png");
        }
        let sign = sign_enter_maze();
        assert_eq!(
            (sign.width(), sign.height()),
            (1024, 220),
            "sign-enter-maze.png"
        );
    }

    /// A paint key with no art drops the body rather than the room.
    #[test]
    fn an_unknown_paint_key_has_no_cel() {
        assert!(keeper_cel("bartender").is_none());
    }

    #[test]
    fn the_blob_is_a_64_square_rgba_texture() {
        let b = blob_image();
        assert_eq!((b.width(), b.height()), (64, 64));
        assert_eq!(b.data.as_ref().map(Vec::len), Some(64 * 64 * 4));
    }
}
