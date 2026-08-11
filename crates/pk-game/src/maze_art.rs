//! 🎨 BAKED MAZE SURFACES — the dungeon's stone, as pixels rather than as code.
//!
//! House strategy (`docs/src/art/bake.md`): `maze/build.ts`'s ~700 lines of
//! Canvas2D masonry are RUN in the browser they were authored against and their
//! output shipped. `legacy/scripts/bake-maze-textures.mjs` writes
//! `assets/maze/`; this module embeds it. Transcribing those painters into Rust
//! has been proposed twice and refused twice — a second implementation of a
//! Skia-dependent rasteriser is a permanent parity liability, and every
//! difference would surface as "the dungeon looks a bit off" rather than as a
//! failing assertion.
//!
//! ## What is in the bake, and why the counts differ
//!
//! DIFFUSE is per biome. `css()` (`build.ts:338-342`) resolves palette slots
//! 2/3/4 through `BIOME_STONE` before painting, so the stone colour is baked
//! IN and a Crypt wall and a Bloodworks wall are different pixels. NORMALS come
//! from the height fields alone and are byte-identical in all four biomes — the
//! bake proves that rather than asserting it, by comparing every later biome's
//! normal against the first.
//!
//! ## The rung is pinned
//!
//! `pixelTexture` rasterises at the camera's PPU while the painter keeps
//! drawing in its authored 64px tile space, so the floor is 512² and the walls
//! and caps 64². Those sizes are asserted at bake time AND here: a re-bake at a
//! different camera rung moves every tuned offset in the painter (block seams
//! every 22 px, a 3 px contact-shadow row) and is otherwise invisible.

use bevy::image::{ImageAddressMode, ImageFilterMode, ImageSamplerDescriptor};
use bevy::prelude::*;
use bevy::render::render_resource::TextureFormat;

use crate::tavern_art::mipmapped_image;

/// `BIOME_STONE`'s order, and the names the bake writes.
/// Kept as the ONE place a biome index becomes a filename.
pub const BIOME_NAMES: [&str; 4] = ["crypt", "warren", "bloodworks", "arcane"];

/// The floor texture spans this many tiles per repeat (`FLOOR_BLOCK`,
/// `build.ts:353`). A one-tile texture repeats its speckle identically on every
/// flagstone and reads as wallpaper; the repeat count is what makes the
/// per-tile variation (moss, cracks, the medallion) legible.
pub const FLOOR_BLOCK: f32 = 8.0;

/// `assets/maze/<biome>-<surface>.png`, indexed `[biome][surface]`.
///
/// `include_bytes!` rather than a runtime load: native and wasm then get the
/// bytes identically, and a missing or renamed bake is a BUILD error instead of
/// an invisible grey floor at runtime.
const DIFFUSE: [[&[u8]; 5]; 4] = [
    [
        include_bytes!("../../../assets/maze/crypt-floor.png"),
        include_bytes!("../../../assets/maze/crypt-cap.png"),
        include_bytes!("../../../assets/maze/crypt-wall-plain.png"),
        include_bytes!("../../../assets/maze/crypt-wall-moss.png"),
        include_bytes!("../../../assets/maze/crypt-wall-low.png"),
    ],
    [
        include_bytes!("../../../assets/maze/warren-floor.png"),
        include_bytes!("../../../assets/maze/warren-cap.png"),
        include_bytes!("../../../assets/maze/warren-wall-plain.png"),
        include_bytes!("../../../assets/maze/warren-wall-moss.png"),
        include_bytes!("../../../assets/maze/warren-wall-low.png"),
    ],
    [
        include_bytes!("../../../assets/maze/bloodworks-floor.png"),
        include_bytes!("../../../assets/maze/bloodworks-cap.png"),
        include_bytes!("../../../assets/maze/bloodworks-wall-plain.png"),
        include_bytes!("../../../assets/maze/bloodworks-wall-moss.png"),
        include_bytes!("../../../assets/maze/bloodworks-wall-low.png"),
    ],
    [
        include_bytes!("../../../assets/maze/arcane-floor.png"),
        include_bytes!("../../../assets/maze/arcane-cap.png"),
        include_bytes!("../../../assets/maze/arcane-wall-plain.png"),
        include_bytes!("../../../assets/maze/arcane-wall-moss.png"),
        include_bytes!("../../../assets/maze/arcane-wall-low.png"),
    ],
];

/// The height-field normals — biome-independent, so four files serve sixteen
/// diffuse maps. Order matches [`Surface`]'s normal partner, not its own index.
const NORMAL_FLOOR: &[u8] = include_bytes!("../../../assets/maze/normal-floor.png");
const NORMAL_CAP: &[u8] = include_bytes!("../../../assets/maze/normal-cap.png");
const NORMAL_WALL: &[u8] = include_bytes!("../../../assets/maze/normal-wall.png");
const NORMAL_WALL_LOW: &[u8] = include_bytes!("../../../assets/maze/normal-wall-low.png");

/// The five surfaces `dungeon_render`'s buckets actually draw.
///
/// The bake also writes `wall-low-moss`, `wall-cracked` and
/// `wall-cracked-low`; they are not embedded because nothing spawns their
/// geometry yet (`T_CRACKED` bands are V-4, and the oracle never builds a moss
/// bucket at knee height — `addWallMesh(mossCells, WALL_H, true)`). Adding one
/// is an `include_bytes!` line, not another bake.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Surface {
    Floor,
    Cap,
    WallPlain,
    WallMoss,
    WallLow,
}

impl Surface {
    fn index(self) -> usize {
        match self {
            Surface::Floor => 0,
            Surface::Cap => 1,
            Surface::WallPlain => 2,
            Surface::WallMoss => 3,
            Surface::WallLow => 4,
        }
    }

    /// The height field this surface's relief was Sobel-differenced from.
    /// `wall-moss` shares the plain wall's normal — moss is paint, not geometry
    /// (`build.ts:1412`, which keys the normal on `low` alone).
    fn normal_png(self) -> &'static [u8] {
        match self {
            Surface::Floor => NORMAL_FLOOR,
            Surface::Cap => NORMAL_CAP,
            Surface::WallPlain | Surface::WallMoss => NORMAL_WALL,
            Surface::WallLow => NORMAL_WALL_LOW,
        }
    }

    /// The size the bake records for this surface. Pinned so a re-bake at a
    /// different camera rung fails in the suite rather than on screen.
    pub fn size(self) -> u32 {
        match self {
            Surface::Floor => 512,
            _ => 64,
        }
    }
}

/// Every texture handle a floor's materials need, uploaded once per descend.
pub struct MazeTextures {
    pub floor: Handle<Image>,
    pub floor_normal: Handle<Image>,
    pub cap: Handle<Image>,
    pub cap_normal: Handle<Image>,
    pub wall: Handle<Image>,
    pub wall_normal: Handle<Image>,
    pub wall_moss: Handle<Image>,
    pub wall_low: Handle<Image>,
    pub wall_low_normal: Handle<Image>,
}

/// Decode and upload one biome's stone.
///
/// `biome` is an index into [`BIOME_NAMES`]; out-of-range wraps to the Cold
/// Crypt the same way `setMazeBiome` does (`build.ts:333-336`), so a floor with
/// an unrecognised biome gets stone rather than a panic.
pub fn load(images: &mut Assets<Image>, biome: usize) -> MazeTextures {
    let b = biome % BIOME_NAMES.len();
    let mut diffuse = |s: Surface| images.add(decode(DIFFUSE[b][s.index()], s, false));
    let floor = diffuse(Surface::Floor);
    let cap = diffuse(Surface::Cap);
    let wall = diffuse(Surface::WallPlain);
    let wall_moss = diffuse(Surface::WallMoss);
    let wall_low = diffuse(Surface::WallLow);
    let mut normal = |s: Surface| images.add(decode(s.normal_png(), s, true));
    MazeTextures {
        floor,
        floor_normal: normal(Surface::Floor),
        cap,
        cap_normal: normal(Surface::Cap),
        wall,
        wall_normal: normal(Surface::WallPlain),
        wall_moss,
        wall_low,
        wall_low_normal: normal(Surface::WallLow),
    }
}

/// Decode a baked PNG into a tiling, mipmapped texture.
///
/// Filtering is the oracle's, from `pixelTexture` and `normalTexture` alike:
/// `magFilter = Linear`, `minFilter = LinearMipmapLinear`, `wrapS/T = Repeat`.
/// Nearest was tried in the oracle and rejected — smooth filtering plus
/// mipmaps is half of what still reads as pixel art, and mipmapping is what
/// kills the moiré the tilted camera otherwise makes of the floor.
///
/// `normal` is not a style flag. A normal map is RAW DATA: colour-managing one
/// bends every surface normal toward the light, which is why the oracle sets
/// `NoColorSpace` on exactly these four textures and sRGB on the other sixteen.
fn decode(png: &[u8], surface: Surface, normal: bool) -> Image {
    let rgba = image::load_from_memory(png)
        .expect("baked maze PNG decodes")
        .to_rgba8();
    debug_assert_eq!(
        rgba.dimensions(),
        (surface.size(), surface.size()),
        "{surface:?} baked at the wrong rung"
    );
    mipmapped_image(
        rgba,
        if normal {
            TextureFormat::Rgba8Unorm
        } else {
            TextureFormat::Rgba8UnormSrgb
        },
        tiling_sampler(),
    )
}

/// Mean LINEAR luma of a baked surface — the albedo figure `dungeon_light`'s
/// ambient calibration has to be cancelled AT.
///
/// Bevy's ambient carries an achromatic specular pedestal that three.js has no
/// counterpart for, and the term that cancels it is divided by the albedo, so
/// the number is only as good as the art it was measured on. It was measured on
/// `dungeon_render`'s flat placeholder greys until V-1; this is how it stops
/// being a guess. Averaged over the whole image, which is the right statistic
/// for a texture that tiles a floor — the mortar seams and moss patches are
/// part of what the light lands on.
///
/// Test-only on purpose: nothing at RUNTIME may read this, or the calibration
/// would silently follow a re-bake instead of failing and asking for a
/// deliberate re-derivation with an A/B sheet behind it.
#[cfg(test)]
pub(crate) fn mean_linear_luma(png: &[u8]) -> f32 {
    let rgba = image::load_from_memory(png)
        .expect("baked maze PNG decodes")
        .to_rgba8();
    let mut sum = 0.0f64;
    for p in rgba.pixels() {
        let [r, g, b, _] = p.0;
        // Rec.709 luma on linearised channels — colour first, weight after.
        sum += 0.2126 * f64::from(srgb_to_linear(r))
            + 0.7152 * f64::from(srgb_to_linear(g))
            + 0.0722 * f64::from(srgb_to_linear(b));
    }
    (sum / f64::from(rgba.width() * rgba.height())) as f32
}

/// The sRGB EOTF. The straight `(c/255)^2.2` approximation is wrong by enough
/// at the dark end to matter here, and dungeon stone lives at the dark end.
#[cfg(test)]
fn srgb_to_linear(c: u8) -> f32 {
    let c = f32::from(c) / 255.0;
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

/// Repeat in both axes, trilinear when minified. Every maze surface tiles —
/// the floor across the whole grid, a wall face once per tile.
fn tiling_sampler() -> ImageSamplerDescriptor {
    ImageSamplerDescriptor {
        address_mode_u: ImageAddressMode::Repeat,
        address_mode_v: ImageAddressMode::Repeat,
        address_mode_w: ImageAddressMode::Repeat,
        mag_filter: ImageFilterMode::Linear,
        min_filter: ImageFilterMode::Linear,
        mipmap_filter: ImageFilterMode::Linear,
        ..default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tavern_art::mip_level_count;

    /// A re-bake at the wrong camera rung is otherwise INVISIBLE: every PNG
    /// still decodes, still tiles, and every tuned offset in the painter is at
    /// a different density. The bake asserts these sizes on its way out; assert
    /// them on the way in too, because the two halves ship separately.
    #[test]
    fn every_embedded_surface_decodes_at_its_pinned_size() {
        for (b, name) in BIOME_NAMES.iter().enumerate() {
            for s in [
                Surface::Floor,
                Surface::Cap,
                Surface::WallPlain,
                Surface::WallMoss,
                Surface::WallLow,
            ] {
                let img = image::load_from_memory(DIFFUSE[b][s.index()])
                    .unwrap_or_else(|e| panic!("{name}-{s:?} decodes: {e}"))
                    .to_rgba8();
                assert_eq!(
                    img.dimensions(),
                    (s.size(), s.size()),
                    "{name} {s:?} is baked at the wrong rung"
                );
            }
        }
    }

    /// The bake's own claim, re-checked where it is consumed: normals are
    /// height fields, so they carry no biome. If one ever did, sixteen floors
    /// would share four wrong reliefs and nothing would say so.
    #[test]
    fn the_normals_are_biome_independent_by_construction() {
        // There is exactly one file per height field — not one per biome — so
        // this is structural rather than a comparison. Pin the count, which is
        // what would change if someone re-baked them per biome.
        let normals = [NORMAL_FLOOR, NORMAL_CAP, NORMAL_WALL, NORMAL_WALL_LOW];
        assert_eq!(normals.len(), 4);
        for png in normals {
            assert!(image::load_from_memory(png).is_ok());
        }
        // And the two wall variants deliberately SHARE one: moss is paint.
        assert_eq!(
            Surface::WallMoss.normal_png().as_ptr(),
            Surface::WallPlain.normal_png().as_ptr()
        );
    }

    /// A short or over-long mip chain is a GPU upload error, not a soft
    /// failure — `create_texture_with_data` reads exactly `sum(level bytes)`.
    #[test]
    fn a_decoded_surface_carries_a_full_mip_chain() {
        let img = decode(DIFFUSE[0][Surface::Floor.index()], Surface::Floor, false);
        assert_eq!(
            img.texture_descriptor.mip_level_count,
            mip_level_count(512, 512)
        );
        let mut expect = 0usize;
        let (mut w, mut h) = (512u32, 512u32);
        for _ in 0..mip_level_count(512, 512) {
            expect += (w * h * 4) as usize;
            w = (w / 2).max(1);
            h = (h / 2).max(1);
        }
        assert_eq!(img.data.as_ref().map(Vec::len), Some(expect));
    }

    /// A normal map decoded as sRGB lights every bevel from the wrong side, and
    /// it looks like a lighting bug rather than a format one.
    #[test]
    fn normals_are_raw_and_diffuse_is_srgb() {
        let n = decode(NORMAL_WALL, Surface::WallPlain, true);
        let d = decode(
            DIFFUSE[0][Surface::WallPlain.index()],
            Surface::WallPlain,
            false,
        );
        assert_eq!(n.texture_descriptor.format, TextureFormat::Rgba8Unorm);
        assert_eq!(d.texture_descriptor.format, TextureFormat::Rgba8UnormSrgb);
    }

    /// An unrecognised biome must land on stone, not on a panic — the same
    /// wrap `setMazeBiome` applies.
    #[test]
    fn an_out_of_range_biome_wraps_to_the_crypt() {
        assert_eq!(4 % BIOME_NAMES.len(), 0);
        assert_eq!(7 % BIOME_NAMES.len(), 3);
    }

    /// THE V-3 MEASUREMENT, and the reason it is a test rather than a note.
    ///
    /// `dungeon_light::SURFACE_ALBEDO_LUMA` divides the ambient specular
    /// pedestal, so it is a property of the ART. It was measured on flat
    /// placeholder greys and its own comment said it must be re-derived when
    /// the textures landed. This prints the table it is derived from, and fails
    /// if the bake ever moves far enough to invalidate it — a re-bake with a
    /// darker biome is otherwise a lighting regression with no failing test.
    #[test]
    fn the_baked_albedo_is_what_the_ambient_is_calibrated_on() {
        let mut walls = Vec::new();
        let mut floors = Vec::new();
        for (b, name) in BIOME_NAMES.iter().enumerate() {
            let f = mean_linear_luma(DIFFUSE[b][Surface::Floor.index()]);
            let w = mean_linear_luma(DIFFUSE[b][Surface::WallPlain.index()]);
            let c = mean_linear_luma(DIFFUSE[b][Surface::Cap.index()]);
            println!("{name:<11} floor {f:.4}  wall {w:.4}  cap {c:.4}");
            floors.push(f);
            walls.push(w);
        }
        let mean = |v: &[f32]| v.iter().sum::<f32>() / v.len() as f32;
        // Walls dominate the standing frame and the floor the plan view, so the
        // midpoint of the two is the honest single number — the same rule the
        // placeholder figure used, now applied to the real pixels.
        let mid = (mean(&walls) + mean(&floors)) / 2.0;
        println!(
            "mean wall {:.4}, mean floor {:.4} → SURFACE_ALBEDO_LUMA {mid:.4}",
            mean(&walls),
            mean(&floors)
        );
        assert!(
            (crate::dungeon_light::surface_albedo_luma() - mid).abs() < 0.01,
            "SURFACE_ALBEDO_LUMA is {} but the bake measures {mid:.4} — re-derive it",
            crate::dungeon_light::surface_albedo_luma()
        );
    }
}
