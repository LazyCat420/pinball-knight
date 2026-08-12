//! Sprite/atlas manifest schema — the contract between art tooling and the game.
//!
//! Two formats live here:
//!
//! * [`published`] — the CURRENT format sprite-forge publishes to
//!   `legacy/public/sprites/<name>-<dir>.json`: a matted source sheet plus
//!   cell rects, which the TS game crushes at runtime per camera rung.
//! * [`baked`] — the TARGET format `cargo xtask bake` will emit: pre-packed,
//!   pre-crushed per-rung atlas pages. The Rust game consumes only this; any
//!   art source (TS painters, sprite-forge AI sheets, pixel-trace, hand PNGs,
//!   a future Rust art tool) that emits it can feed the game.
//!
//! PORTS-NOTHING — the Rust-side sprite/atlas manifest SCHEMA — the art contract, no TS counterpart

pub mod published {
    use serde::{Deserialize, Serialize};

    /// `<name>-<dir>.json` next to its matted `<name>-<dir>.png`.
    ///
    /// Field notes from the TS pipeline: `source` is the sheet's [w, h];
    /// `grid` is the detected pixel-grid pitch; `palette` (optional) is the
    /// derived palette appended to the actor's atlas; each row is one clip,
    /// each cell an [x0, y0, x1, y1] rect on the sheet.
    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct SheetManifest {
        pub name: String,
        pub dir: String,
        pub image: String,
        pub source: [u32; 2],
        #[serde(default)]
        pub grid: Option<u32>,
        #[serde(default)]
        pub scale: Option<f64>,
        #[serde(default)]
        pub palette: Option<Vec<String>>,
        pub rows: Vec<ClipRow>,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct ClipRow {
        pub clip: String,
        pub cells: Vec<[u32; 4]>,
    }
}

pub mod baked {
    use serde::{Deserialize, Serialize};
    use std::collections::BTreeMap;

    /// `assets/sprites/rung-<N>/manifest.json`. One per camera rung
    /// (120/108/96/84/72 texels); the game lazy-loads the active rung.
    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct RungManifest {
        pub version: u32,
        pub rung: u32,
        pub pages: Vec<String>,
        /// kind → dir ("S"/"N"/"E") → clip → frames. BTreeMap so serialization
        /// is order-stable (bake output must diff cleanly in git).
        pub sprites: BTreeMap<String, BTreeMap<String, BTreeMap<String, Vec<Frame>>>>,
        /// kind → palette, for the runtime palette-swap shader (tint variants).
        #[serde(default)]
        pub palettes: BTreeMap<String, Vec<String>>,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct Frame {
        pub page: u32,
        /// [x, y, w, h] on the page.
        pub rect: [u32; 4],
        /// Pixel offset of the ground-anchor within the rect.
        pub pivot: [f64; 2],
        /// [left, top, right, bottom] transparent trim removed at pack time.
        pub trim: [u32; 4],
    }
}

#[cfg(test)]
mod tests {
    use super::published::SheetManifest;
    use std::fs;
    use std::path::PathBuf;

    /// Every manifest sprite-forge has ever published must parse. This is the
    /// consumption side of the forge contract — if the forge changes shape,
    /// this fails before the game ever sees it.
    #[test]
    fn parses_every_published_legacy_manifest() {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../legacy/public/sprites");
        let mut parsed = 0;
        for entry in fs::read_dir(&dir).expect("legacy/public/sprites must exist") {
            let path = entry.unwrap().path();
            if path.extension().is_some_and(|e| e == "json") {
                let text = fs::read_to_string(&path).unwrap();
                let m: SheetManifest =
                    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{path:?}: {e}"));
                assert!(!m.rows.is_empty(), "{path:?}: no clip rows");
                parsed += 1;
            }
        }
        assert!(
            parsed >= 19,
            "expected the 19+ published manifests, got {parsed}"
        );
    }
}
