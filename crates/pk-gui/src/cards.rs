//! CARD FACES — the baked art for `gui/card-face.ts cardFaceAt()`.
//!
//! ## Why this is a table of pixels and not a painter
//!
//! The same standing decision the icons carry, one size up. A card face is
//! `render/holo-card.ts`: 809 lines of deliberate art direction — material
//! stock per monster family, metal frames per rarity, path-drawn emblems, a
//! portrait run through the palette crush and rim-lit, five-stop gradients,
//! rarity pips, a flavour line. It is Canvas2D compositing over gradients, and
//! the pixels ship rather than a second implementation of the art
//! (`docs/src/art/bake.md`, `legacy/scripts/bake-card-faces.mjs`).
//!
//! ## Why a card is not an icon
//!
//! `bake-gui-icons.mjs` excludes card ids on purpose and says why: a card in
//! the UI is not a 72px square chip reframed around a subject, it is a 512×716
//! portrait at a different aspect from a different renderer. Two consequences
//! reach this module:
//!
//! - [`crate::im::draw_icon`] cannot draw one. It is square-only — it derives a
//!   single exact side from `icon.w` and blits `d × d`. A card is 56×78, and
//!   forcing it through that path would either crop the art or square it.
//!   [`draw_card`] is the non-square blit.
//! - There is no single master that downscales exactly. 716/512 does not
//!   survive integer scaling: 3×56 = 168 wide is 235 tall, and 235/3 = 78.33.
//!   The 72px icon chip's trick — one native size that divides exactly into
//!   every display size — has no analogue here.
//!
//! ## What is baked, and what is drawn
//!
//! A card id encodes level and shine (`spidersilk#4s`), so the full face space
//! is 25 bases × 10 levels × 2 finishes = 500. What ships is 100 files, and the
//! split was measured at the size the tavern actually blits, not reasoned about:
//!
//! - **Level is NOT baked.** It moves **0.6%** of a 56px face, against a
//!   positive control of 8.2% for two *different* base cards. Rendered side by
//!   side, levels 1 / 7 / 10 are indistinguishable; the only tell is the level
//!   seal, ~4×5px in the title bar's right margin, which [`level_seal_at`]
//!   places so the port can draw it. The level-scaled STAT TEXT does differ, and
//!   at 56px it is 2px-tall mush no reader can recover a number from.
//! - **Shine IS baked.** It moves **11.7%** — more than swapping to an entirely
//!   different card. It is a sparkle field drawn INSIDE the clipped art window
//!   from the same `rand()` stream the rest of the face consumes, so it is not
//!   an overlay that could be composited on afterwards.
//! - **Both display sizes are baked.** The vendor counters are authored in a
//!   600×338 design box with max zoom 2 (`pk_game::gui`), so a cell is 56 px at
//!   zoom 1 and 112 device px at zoom 2. Rendered side by side, the 112 bake
//!   reads its title and all four stat rows; a 2× nearest blit of the 56 tier is
//!   unreadable. That is `card-face.ts`'s own argument confirmed in pixels — a
//!   card's whole job is carrying a title and stat lines, and a nearest resample
//!   destroys exactly the part that had to be read.
//!
//! PORTS: `gui/card-face.ts`, `render/holo-card.ts`, `gui/card-face.ts`

use std::collections::HashMap;
use std::sync::OnceLock;

include!(concat!(env!("OUT_DIR"), "/cards_embed.rs"));

/// The card aspect, from `render/holo-card.ts`: `CARD_W` 512 × `CARD_H` 716.
pub const CARD_W: u32 = 512;
pub const CARD_H: u32 = 716;

/// The widths the bake ships, ascending. Nothing else may be blitted 1:1.
///
/// 56 is `CARD_SLOT_W` from `gui/screens/tavern.ts`; 112 is that at zoom 2, the
/// vendor sheets' ceiling. A third tier would be 168 for zoom 3, which the
/// vendor counters cannot reach.
pub const WIDTHS: [u32; 2] = [56, 112];

/// The height a face of width `w` will have — `cardFaceHeight()`.
///
/// The port computes this for itself and the bake asserts the canvas it
/// produced matches, so a disagreement is a failed bake rather than a row of
/// cells that are each one pixel out.
pub fn card_face_height(w: u32) -> u32 {
    ((f64::from(CARD_H) / f64::from(CARD_W)) * f64::from(w)).round() as u32
}

/// The largest baked width that fits in `want`, and the width to ask for.
///
/// Unlike [`crate::im::exact_icon_size`] this does NOT scale — it SELECTS. Each
/// tier is a separate filtered downscale from the 512px master, so there is no
/// resampling to do; the only question is which of the two baked tiers to blit
/// 1:1. A `want` below the smallest tier still gets the smallest tier: the
/// alternative is drawing nothing.
pub fn baked_width(want: u32) -> u32 {
    let mut best = WIDTHS[0];
    for w in WIDTHS {
        if w <= want {
            best = w;
        }
    }
    best
}

/// One decoded card face: straight-alpha RGBA8.
pub struct CardFace {
    pub w: u32,
    pub h: u32,
    pub rgba: Vec<u8>,
}

impl CardFace {
    fn decode(name: &str, bytes: &[u8]) -> CardFace {
        let decoder = png::Decoder::new(bytes);
        let mut reader = decoder
            .read_info()
            .unwrap_or_else(|e| panic!("card face {name}: bad PNG ({e})"));
        let mut buf = vec![0; reader.output_buffer_size()];
        let info = reader
            .next_frame(&mut buf)
            .unwrap_or_else(|e| panic!("card face {name}: bad PNG frame ({e})"));
        assert_eq!(
            info.color_type,
            png::ColorType::Rgba,
            "card face {name} must be RGBA8"
        );
        assert_eq!(info.bit_depth, png::BitDepth::Eight);
        buf.truncate(info.buffer_size());
        CardFace {
            w: info.width,
            h: info.height,
            rgba: buf,
        }
    }
}

fn set() -> &'static HashMap<&'static str, CardFace> {
    static SET: OnceLock<HashMap<&'static str, CardFace>> = OnceLock::new();
    SET.get_or_init(|| {
        EMBEDDED
            .iter()
            .map(|(name, bytes)| (*name, CardFace::decode(name, bytes)))
            .collect()
    })
}

/// The baked file stem for a card: `<base>[-shiny]-<width>`.
pub fn face_key(base: &str, shiny: bool, width: u32) -> String {
    format!("{base}{}-{width}", if shiny { "-shiny" } else { "" })
}

/// The face for a card BASE at a baked width, or `None` if nothing was baked.
///
/// `base` is the id up to `#` — `pk_core::cards::card_base`. Passing a full
/// instance id (`spidersilk#4s`) finds nothing, which is deliberate: the level
/// is not baked and silently ignoring the suffix would hide that from the one
/// caller who got it wrong.
///
/// `None` is a real answer and callers draw their own fallback — the oracle's
/// `cardFaceAt` returns `null` off-DOM and every call site has a `well()` for
/// it. They must not paint a hole and call it a card.
pub fn face(base: &str, shiny: bool, width: u32) -> Option<&'static CardFace> {
    set().get(face_key(base, shiny, width).as_str())
}

/// Every baked file stem, sorted. For diagnostics and the drift test.
pub fn keys() -> Vec<&'static str> {
    let mut v: Vec<&'static str> = EMBEDDED.iter().map(|(n, _)| *n).collect();
    v.sort_unstable();
    v
}

/// Where the level seal sits on a face of width `w`, as `(cx, cy, r)` in UI px.
///
/// From `holo-card.ts`'s own geometry: the seal is a disc of radius 17 centred
/// at `(W - PAD - 20, TITLE_Y + 44)` on the 512px master, with `PAD` 22 and
/// `TITLE_Y` 30 — so `(470, 74)` r17, scaled by `w / 512`.
///
/// The oracle draws it only from level 2: "a Lv 1 plate on every common is
/// noise, not information." Callers keep that rule; this only says WHERE.
pub fn level_seal_at(w: u32) -> (f64, f64, f64) {
    let s = f64::from(w) / f64::from(CARD_W);
    (
        (f64::from(CARD_W) - 22.0 - 20.0) * s,
        (30.0 + 44.0) * s,
        17.0 * s,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The bake's own manifest, as text. Read at COMPILE time from the asset
    /// directory `build.rs` scanned — but parsed independently of it.
    const MANIFEST: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../assets/gui/cards/cards.json"
    ));

    fn manifest(field: &str) -> serde_json::Value {
        let v: serde_json::Value = serde_json::from_str(MANIFEST).expect("cards.json");
        v[field].clone()
    }

    fn manifest_files() -> Vec<String> {
        manifest("files")
            .as_array()
            .expect("cards.json files[]")
            .iter()
            .map(|s| s.as_str().expect("file name").to_string())
            .collect()
    }

    /// THE DRIFT GATE, the same one the icons carry. `build.rs` derives the
    /// embedded set from the DIRECTORY; the bake writes what it produced into
    /// `cards.json`. Neither reads the other, so a mismatch means a file was
    /// added or lost outside the bake — a generated catalog is a cache with no
    /// invalidation unless something checks it.
    #[test]
    fn embedded_set_matches_the_bake_manifest() {
        assert_eq!(
            keys(),
            manifest_files(),
            "assets/gui/cards drifted from cards.json — re-run legacy/scripts/bake-card-faces.mjs"
        );
    }

    /// The widths this module will blit must be the widths the bake produced.
    /// If they disagree, `face()` returns `None` for every lookup and the whole
    /// dealer is wells — a hole that would read as "the screen is unfinished".
    #[test]
    fn widths_match_the_bake() {
        let baked: Vec<u32> = manifest("widths")
            .as_array()
            .expect("cards.json widths[]")
            .iter()
            .map(|v| v.as_u64().expect("width") as u32)
            .collect();
        assert_eq!(baked, WIDTHS.to_vec());
    }

    /// Every card, in both finishes, at every width. The shelf is three cards
    /// wide, so one missing face is a third of the counter.
    #[test]
    fn every_card_has_both_finishes_at_every_width() {
        let cards = manifest("cards").as_u64().expect("cards.json cards") as usize;
        assert_eq!(keys().len(), cards * 2 * WIDTHS.len());

        // Derive the base list from the keys themselves rather than trusting a
        // count: a set that is the right SIZE and the wrong SHAPE passes a
        // count check.
        let suffix = format!("-{}", WIDTHS[0]);
        let mut bases: Vec<&str> = keys()
            .into_iter()
            .filter_map(|k| k.strip_suffix(&suffix))
            .filter(|k| !k.ends_with("-shiny"))
            .collect();
        bases.sort_unstable();
        bases.dedup();
        assert_eq!(bases.len(), cards);
        for b in bases {
            for shiny in [false, true] {
                for w in WIDTHS {
                    assert!(
                        face(b, shiny, w).is_some(),
                        "no baked face for {b} shiny={shiny} at {w}"
                    );
                }
            }
        }
    }

    /// The pixels that exist must have the aspect the layout derives.
    #[test]
    fn every_face_has_the_height_the_layout_computes() {
        for k in keys() {
            let (stem, w) = k.rsplit_once('-').expect("width suffix");
            let w: u32 = w.parse().expect("numeric width");
            let shiny = stem.ends_with("-shiny");
            let base = stem.strip_suffix("-shiny").unwrap_or(stem);
            let f = face(base, shiny, w).expect("baked");
            assert_eq!(f.w, w, "{k} width");
            assert_eq!(f.h, card_face_height(w), "{k} height");
        }
    }

    /// A full instance id finds nothing. The level is not baked, and quietly
    /// stripping the suffix would hide the one caller who forgot to.
    #[test]
    fn an_instance_id_is_not_a_face_key() {
        assert!(face("spidersilk", false, 56).is_some());
        assert!(face("spidersilk#4s", false, 56).is_none());
        assert!(face("spidersilk#4", false, 56).is_none());
    }

    /// Shiny and plain are DIFFERENT pixels. If the bake ever emitted the same
    /// image twice, every rarity tell in the game would still look present in a
    /// file listing and be missing on screen.
    #[test]
    fn shiny_is_not_the_same_image_as_plain() {
        for w in WIDTHS {
            let plain = face("spidersilk", false, w).expect("plain");
            let shiny = face("spidersilk", true, w).expect("shiny");
            assert_ne!(
                plain.rgba, shiny.rgba,
                "shiny face at {w} is a copy of the plain one"
            );
        }
    }

    /// `baked_width` SELECTS a tier; it never invents one.
    #[test]
    fn baked_width_selects_a_real_tier() {
        assert_eq!(baked_width(56), 56);
        assert_eq!(baked_width(111), 56);
        assert_eq!(baked_width(112), 112);
        // Above the top tier, stay at the top tier — the bake has nothing more.
        assert_eq!(baked_width(400), 112);
        // Below the bottom tier, still the bottom tier: drawing something small
        // beats drawing nothing.
        assert_eq!(baked_width(10), 56);
    }

    /// The seal lands in the title bar's right margin, on the card.
    ///
    /// ⚠️ It is NOT wholly above the art window, and a first version of this
    /// test asserted that it was and failed. On the 512px master the seal is a
    /// disc of radius 17 centred at y=74, so it spans y 57..91 while the art
    /// window starts at y=88 — it overlaps the window's top edge by 3px, sitting
    /// proud of the bevel. That is the oracle's own composition (`holo-card.ts`
    /// draws the seal AFTER the window, inside the same clip), not a rounding
    /// artefact, so the test pins the overlap rather than forbidding it.
    #[test]
    fn the_level_seal_sits_in_the_title_bar() {
        for w in WIDTHS {
            let (cx, cy, r) = level_seal_at(w);
            assert!(
                cx + r <= f64::from(w),
                "seal runs off the right edge at {w}"
            );
            assert!(
                cx - r > f64::from(w) * 0.5,
                "seal is not in the RIGHT margin at {w}"
            );
            assert!(cy - r > 0.0, "seal runs off the top at {w}");
            // Centred ABOVE the art window's top edge, overlapping it slightly —
            // proud of the bevel, exactly as on the master.
            let art_top = f64::from(card_face_height(w)) * (88.0 / f64::from(CARD_H));
            assert!(cy < art_top, "seal centre is inside the art window at {w}");
            assert!(
                cy + r > art_top,
                "seal no longer meets the window bevel at {w}"
            );
        }
    }
}
