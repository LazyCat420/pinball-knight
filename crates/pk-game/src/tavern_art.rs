//! 🎨 BAKED TAVERN ART — the keeper sprites and the ENTER MAZE sign.
//!
//! House strategy (docs/src/art/bake.md): canvas painters are BAKED by the
//! legacy code in headless Chromium, never re-implemented here. `cargo xtask
//! bake --tavern` writes the PNGs this module embeds. Until they exist the
//! room falls back to tinted boxes, so a missing bake degrades the look
//! rather than breaking the build.

use bevy::prelude::*;

/// Radius-relative alpha stops of the legacy contact blob (sprite.ts:125-142):
/// a pure radial gradient, so Rust generates it instead of baking a file.
const BLOB_STOPS: [(f32, f32); 3] = [(0.0, 0.6), (0.55, 0.32), (1.0, 0.0)];

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
    let mut img = Image::new(
        bevy::render::render_resource::Extent3d {
            width: N,
            height: N,
            depth_or_array_layers: 1,
        },
        bevy::render::render_resource::TextureDimension::D2,
        data,
        bevy::render::render_resource::TextureFormat::Rgba8UnormSrgb,
        bevy::asset::RenderAssetUsages::RENDER_WORLD,
    );
    img.sampler = bevy::image::ImageSampler::linear();
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
}
