//! `constants/render.ts` — every value, against the oracle's own export.
//!
//! The Rust twin of `port-fixtures.test.ts`'s "the render constants match the
//! committed fixture". A table of constants is the one kind of port that can be
//! checked exactly, and until 2026-08-16 it was not checked at all: the module
//! claiming to port this file invented its entire contents (`DESIGN_VIEWPORT_W`,
//! `RUNG_*`, `LIGHT_FALLOFF_*`) and the ledger scored it converted.
//!
//! Two directions, and both matter:
//!
//! - every constant the oracle exports must exist here with the same value —
//!   catches a value transcribed wrong, and a constant never transcribed;
//! - the count must not silently shrink — catches a constant deleted from the
//!   fixture to make this pass.

use std::collections::BTreeMap;
use std::path::Path;

use pk_core::constants::render as r;

fn fixture() -> BTreeMap<String, serde_json::Value> {
    let p = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .expect("workspace root")
        .join("assets/fixtures/constants-render.json");
    let text = std::fs::read_to_string(&p).unwrap_or_else(|e| {
        panic!(
            "{} — regenerate with RUN_EXPORT=1 in legacy/: {e}",
            p.display()
        )
    });
    serde_json::from_str(&text).expect("fixture parses")
}

/// Every name the Rust side carries, paired with the oracle's key for it.
///
/// Spelled out rather than derived: a reflective mapping would have to invent a
/// naming rule, and a rule is exactly how `RENDER_W` became
/// `DESIGN_VIEWPORT_W` in the first place.
fn num_pairs() -> Vec<(&'static str, f64)> {
    vec![
        ("RENDER_W", r::RENDER_W),
        ("RENDER_H", r::RENDER_H),
        ("MAX_RENDER_W", r::MAX_RENDER_W),
        ("MAX_RENDER_H", r::MAX_RENDER_H),
        ("CAMERA_ZOOMS.close", r::CAMERA_ZOOM_CLOSE),
        ("CAMERA_ZOOMS.normal", r::CAMERA_ZOOM_NORMAL),
        ("CAMERA_ZOOMS.wide", r::CAMERA_ZOOM_WIDE),
        ("CAMERA_ZOOMS.wider", r::CAMERA_ZOOM_WIDER),
        ("CAMERA_ZOOMS.widest", r::CAMERA_ZOOM_WIDEST),
        ("PPU", r::PPU),
        ("VIEW_W", r::VIEW_W),
        ("VIEW_H", r::VIEW_H),
        ("CAMERA_TILT", r::CAMERA_TILT),
        ("CAMERA_YAW", r::CAMERA_YAW),
        ("CAMERA_DIST", r::CAMERA_DIST),
        ("ART_PX", r::ART_PX),
        ("SPRITE_PX", r::SPRITE_PX),
        ("SPRITE_PIXEL_GRID", r::SPRITE_PIXEL_GRID),
        ("SPRITE_UNITS", r::SPRITE_UNITS),
        ("CEL_STEPS", r::CEL_STEPS),
        ("CEL_CURVE", r::CEL_CURVE),
        ("CEL_SATURATION", r::CEL_SATURATION),
        ("OUTLINE_EDGE_THRESHOLD", r::OUTLINE_EDGE_THRESHOLD),
        ("AMBIENT_INTENSITY", r::AMBIENT_INTENSITY),
        ("HEMI_INTENSITY", r::HEMI_INTENSITY),
        ("DIR_INTENSITY", r::DIR_INTENSITY),
        ("PLAYER_LAMP_INTENSITY", r::PLAYER_LAMP_INTENSITY),
        ("PLAYER_LAMP_RANGE", r::PLAYER_LAMP_RANGE),
        ("DIR_HEIGHT", r::DIR_HEIGHT),
        ("SHADOW_MAP_SIZE", r::SHADOW_MAP_SIZE as f64),
        ("SHADOW_AREA", r::SHADOW_AREA),
        ("SHADOW_OPACITY", r::SHADOW_OPACITY),
        ("TORCH_LIGHT_POOL", r::TORCH_LIGHT_POOL as f64),
        ("FOG_NEAR", r::FOG_NEAR),
        ("FOG_FAR", r::FOG_FAR),
        ("BLOOM_THRESHOLD", r::BLOOM_THRESHOLD),
        ("BLOOM_STRENGTH", r::BLOOM_STRENGTH),
        ("BLOOM_RADIUS", r::BLOOM_RADIUS),
        ("AO_RADIUS", r::AO_RADIUS),
        ("AO_STRENGTH", r::AO_STRENGTH),
        ("VIGNETTE", r::VIGNETTE),
        ("PILASTER_EVERY", r::PILASTER_EVERY as f64),
        ("BANNER_EVERY", r::BANNER_EVERY as f64),
        ("CLUTTER_EVERY", r::CLUTTER_EVERY as f64),
        ("FLAME_FRAMES", r::FLAME_FRAMES as f64),
        ("FLAME_FPS", r::FLAME_FPS),
        ("MOTE_RATE", r::MOTE_RATE),
        ("FPS_IDLE", r::FPS_IDLE),
        ("FPS_WALK", r::FPS_WALK),
        ("FPS_ATTACK", r::FPS_ATTACK),
        ("FPS_DEATH", r::FPS_DEATH),
        ("FPS_ROLL", r::FPS_ROLL),
        ("FPS_EQUIP", r::FPS_EQUIP),
        ("FPS_FORGE", r::FPS_FORGE),
        ("FPS_RUN", r::FPS_RUN),
        ("FPS_CROUCH", r::FPS_CROUCH),
        ("FPS_WAIT", r::FPS_WAIT),
        ("FPS_WAKE", r::FPS_WAKE),
        ("FPS_STUMBLE", r::FPS_STUMBLE),
        ("RUN_RATE_RAMP", r::RUN_RATE_RAMP),
        ("CAM_DEADZONE", r::CAM_DEADZONE),
        ("CAM_LERP", r::CAM_LERP),
    ]
}

fn bool_pairs() -> Vec<(&'static str, bool)> {
    vec![
        ("QUANTIZE_DEFAULT", r::QUANTIZE_DEFAULT),
        ("DITHER_DEFAULT", r::DITHER_DEFAULT),
        ("SCANLINE_DEFAULT", r::SCANLINE_DEFAULT),
        ("OUTLINE_DEFAULT", r::OUTLINE_DEFAULT),
        ("CEL_DEFAULT", r::CEL_DEFAULT),
        ("BLOOM_DEFAULT", r::BLOOM_DEFAULT),
        ("AO_DEFAULT", r::AO_DEFAULT),
    ]
}

fn str_pairs() -> Vec<(&'static str, &'static str)> {
    let mut v = vec![
        ("CAMERA_ZOOM_DEFAULT", r::CAMERA_ZOOM_DEFAULT),
        ("SETTINGS_KEY", r::SETTINGS_KEY),
        ("CAMERA_ZOOM", r::CAMERA_ZOOM),
    ];
    for (i, name) in r::CAMERA_ZOOM_ORDER.iter().enumerate() {
        v.push(match i {
            0 => ("CAMERA_ZOOM_ORDER.0", name),
            1 => ("CAMERA_ZOOM_ORDER.1", name),
            2 => ("CAMERA_ZOOM_ORDER.2", name),
            3 => ("CAMERA_ZOOM_ORDER.3", name),
            _ => ("CAMERA_ZOOM_ORDER.4", name),
        });
    }
    v
}

#[test]
fn every_transcribed_constant_equals_the_oracle() {
    let f = fixture();
    for (key, got) in num_pairs() {
        let want = f
            .get(key)
            .unwrap_or_else(|| panic!("{key} is not in the oracle's export"))
            .as_f64()
            .unwrap_or_else(|| panic!("{key} is not a number in the oracle"));
        assert_eq!(got, want, "{key}: rust {got} vs oracle {want}");
    }
    for (key, got) in bool_pairs() {
        let want = f
            .get(key)
            .unwrap_or_else(|| panic!("{key} missing"))
            .as_bool();
        assert_eq!(Some(got), want, "{key}");
    }
    for (key, got) in str_pairs() {
        let want = f
            .get(key)
            .unwrap_or_else(|| panic!("{key} missing"))
            .as_str();
        assert_eq!(Some(got), want, "{key}");
    }
}

/// THE COVERAGE HALF. The test above proves every constant we transcribed is
/// right; it says nothing about the ones we never transcribed — which is the
/// failure this whole file exists because of. The oracle exports 77 values;
/// anything not claimed here is named out loud.
#[test]
fn no_constant_in_the_oracle_is_left_untranscribed() {
    let f = fixture();
    let mut claimed: Vec<&str> = Vec::new();
    claimed.extend(num_pairs().iter().map(|(k, _)| *k));
    claimed.extend(bool_pairs().iter().map(|(k, _)| *k));
    claimed.extend(str_pairs().iter().map(|(k, _)| *k));

    let missing: Vec<&String> = f
        .keys()
        .filter(|k| !claimed.contains(&k.as_str()))
        .collect();
    assert!(
        missing.is_empty(),
        "{} oracle constant(s) have no Rust counterpart: {:?}",
        missing.len(),
        missing
    );
    assert_eq!(
        f.len(),
        claimed.len(),
        "the fixture carries {} values and this test claims {}",
        f.len(),
        claimed.len()
    );
}
