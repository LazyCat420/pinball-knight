//! ITEM ICONS — the port of `gui/icons.ts itemIcon()`.
//!
//! ## Why this is a table of pixels and not a painter
//!
//! `itemIcon(id)` in the oracle is not a lookup: it runs the item's `FramePaint`
//! from `render/cel-painter.ts` through `renderPaintCanvas` — the same palette
//! crush every in-world sprite gets — and then REFRAMES the result, cropping to
//! the opaque bounding box and resampling that square into a 72px chip with
//! smoothing on. Canvas2D compositing plus Skia's filtered resample. Porting it
//! would be a second implementation of the art, drifting forever, so the pixels
//! are baked instead (`legacy/scripts/bake-gui-icons.mjs`, and
//! `docs/src/art/bake.md` for the standing decision).
//!
//! ## Why this is a global and not a resource threaded through the frame
//!
//! The oracle's is a module-level `Map` cache and every screen reaches it by
//! calling `itemIcon(id)`. This is the same shape: one decode of the whole set
//! on first use, behind a `OnceLock`. Threading an `Icons` through `begin_ui`
//! would add an eighth parameter to a function eight call sites already pass
//! seven arguments to, and would buy nothing — the set is immutable, baked, and
//! embedded in the binary.
//!
//! ## The hole this exists to close
//!
//! The armorer shipped with a flat 16px square where the oracle draws the
//! helmet. The player's report was exactly that: *"we still don't see all the
//! armors"* — every row was present; the GEAR was not. The alchemist (24px) and
//! the weapons vendor (36px) have the same hole, so the whole item set is baked
//! rather than the three pieces one counter happens to need.

use std::collections::HashMap;
use std::sync::OnceLock;

use crate::painter::Rgba;

include!(concat!(env!("OUT_DIR"), "/icons_embed.rs"));

/// Every baked icon is this many pixels square — `gui/icons.ts ICON_PX`.
///
/// NOT arbitrary, and the reading side depends on it: [`crate::im::draw_icon`]
/// only ever blits at an exact integer ratio, and 72 divides by 2, 3, 4, 6, 8,
/// 9, 12, 18, 24 and 36 — so an 18px row chip, a 24px row chip and a 36px
/// header chip are all exact downscales at zoom 1, and their doubles are too.
pub const ICON_PX: u32 = 72;

/// One decoded icon: straight-alpha RGBA8, `ICON_PX` square.
pub struct Icon {
    pub w: u32,
    pub h: u32,
    pub rgba: Vec<u8>,
}

impl Icon {
    fn decode(name: &str, bytes: &[u8]) -> Icon {
        let decoder = png::Decoder::new(bytes);
        let mut reader = decoder
            .read_info()
            .unwrap_or_else(|e| panic!("gui icon {name}: bad PNG ({e})"));
        let mut buf = vec![0; reader.output_buffer_size()];
        let info = reader
            .next_frame(&mut buf)
            .unwrap_or_else(|e| panic!("gui icon {name}: bad PNG frame ({e})"));
        assert_eq!(
            info.color_type,
            png::ColorType::Rgba,
            "gui icon {name} must be RGBA8"
        );
        assert_eq!(info.bit_depth, png::BitDepth::Eight);
        buf.truncate(info.buffer_size());
        Icon {
            w: info.width,
            h: info.height,
            rgba: buf,
        }
    }

    /// The pixel at `(x, y)`, straight alpha. Out of bounds is transparent.
    pub fn pixel(&self, x: u32, y: u32) -> Rgba {
        if x >= self.w || y >= self.h {
            return Rgba::TRANSPARENT;
        }
        let i = ((y * self.w + x) * 4) as usize;
        Rgba {
            r: self.rgba[i],
            g: self.rgba[i + 1],
            b: self.rgba[i + 2],
            a: self.rgba[i + 3],
        }
    }
}

fn set() -> &'static HashMap<&'static str, Icon> {
    static SET: OnceLock<HashMap<&'static str, Icon>> = OnceLock::new();
    SET.get_or_init(|| {
        EMBEDDED
            .iter()
            .map(|(name, bytes)| (*name, Icon::decode(name, bytes)))
            .collect()
    })
}

/// The icon for an item id, or `None` when nothing was baked for it.
///
/// `None` is a real answer, exactly as it is in the oracle (`itemIcon` returns
/// `null` for an id with no `FramePaint`), and callers draw their fallback —
/// they must not paint a hole and call it an icon.
pub fn icon(id: &str) -> Option<&'static Icon> {
    set().get(id)
}

/// Every baked id, sorted. For diagnostics and the drift test.
pub fn ids() -> Vec<&'static str> {
    let mut v: Vec<&'static str> = EMBEDDED.iter().map(|(n, _)| *n).collect();
    v.sort_unstable();
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The bake's own manifest, as text. Read at COMPILE time from the asset
    /// directory `build.rs` scanned — but parsed independently of it.
    const MANIFEST: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../assets/gui/icons/icons.json"
    ));

    fn manifest_files() -> Vec<String> {
        let v: serde_json::Value = serde_json::from_str(MANIFEST).expect("icons.json");
        v["files"]
            .as_array()
            .expect("icons.json files[]")
            .iter()
            .map(|s| s.as_str().expect("file name").to_string())
            .collect()
    }

    /// THE DRIFT GATE. `build.rs` derives the embedded set from the DIRECTORY;
    /// the bake writes what it produced into `icons.json`. Neither reads the
    /// other, so a stale PNG left behind by a renamed item, or a file the bake
    /// wrote and the build script never saw, shows up here as a set difference
    /// rather than as a hole in a menu three weeks later.
    #[test]
    fn every_baked_icon_is_embedded_and_nothing_else_is() {
        let embedded = ids();
        let manifest = manifest_files();
        assert_eq!(
            embedded,
            manifest.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
            "the embedded icon set and the bake's manifest disagree — \
             re-run legacy/scripts/bake-gui-icons.mjs"
        );
    }

    /// What the counters draw today. `icon()` returning `None` is a legal
    /// answer, so a missing gear piece would be a silently empty chip.
    #[test]
    fn the_gear_the_armorer_shows_is_present_and_square() {
        for id in ["helmet", "armor", "boots"] {
            let ic = icon(id).unwrap_or_else(|| panic!("no baked icon for {id}"));
            assert_eq!((ic.w, ic.h), (ICON_PX, ICON_PX), "{id} is not ICON_PX");
            let painted = ic.rgba.chunks_exact(4).filter(|p| p[3] > 8).count();
            assert!(
                painted > 200,
                "{id} has only {painted} opaque pixels — an empty chip"
            );
        }
    }

    /// ⚠️ THE FIRST BAKE OF THIS SET WAS GREY, AND NOTHING FAILED.
    ///
    /// `engine/palette-source.ts` defaults to a 16-step greyscale until the
    /// game installs Cold Crypt at dungeon boot, so a harness that paints
    /// without booting quantizes every sprite against the fallback — "a bug
    /// that renders, so it would not announce itself", in that module's own
    /// words. 51 icons shipped as white diamonds and grey flasks.
    ///
    /// The bake script now calls `installPalette()` and gates on three colour
    /// probes. This is the same gate on the READING side, so the greyscale
    /// cannot come back through a re-bake by another route.
    #[test]
    fn the_icons_carry_the_palette_and_are_not_greyscale() {
        let spread = |id: &str| -> u8 {
            let ic = icon(id).expect(id);
            ic.rgba
                .chunks_exact(4)
                .filter(|p| p[3] >= 128)
                .map(|p| p[..3].iter().max().unwrap() - p[..3].iter().min().unwrap())
                .max()
                .unwrap_or(0)
        };
        for (id, note) in [
            ("health", "#d95763 liquid"),
            ("haste", "#6fd0e8 liquid"),
            ("coin", "flame gold"),
        ] {
            assert!(
                spread(id) > 12,
                "{id} ({note}) is greyscale — the bake ran without installPalette()"
            );
        }
    }
}
