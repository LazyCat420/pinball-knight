//! Pixel parity against the LEGACY toolkit.
//!
//! `node legacy/scripts/bake-gui-fixtures.mjs` paints each scene with the real
//! `gui/im.ts` (and, for the tavern overlays, the real screens pushed through
//! the real stack) and writes a PNG plus the exact inputs. This test repaints
//! every scene with pk-gui and compares byte for byte.
//!
//! The widget sampler has no legacy twin by construction — it exists to walk
//! every primitive, so its Rust double below MUST be kept in lockstep with the
//! `paintWidgets` function in the bake script. The prompt and run summary are
//! the shipping screens and need no double.
//!
//! ## What this corpus does and does not cover (measured, 2026-08-10)
//!
//! All six scenes repaint BIT-EXACT — 0 differing bytes in 9.9M pixels,
//! including the 82% scrim and 16px text. Sabotaged four ways to prove it can
//! fail: reordering `bevel`'s fills (corner ownership) moved 10–160 px;
//! drawing `key`'s keyline over its bevel (the im.ts:480 flat-button bug) moved
//! 820–11,928; shifting `RIVET` one palette index moved 16–64.
//!
//! The fourth sabotage — `px()` as Rust's `round` instead of JS `Math.round` —
//! PASSED, and that is not a gap in the invariant but a gap in this corpus: the
//! two disagree only at exact negative halves, which no fixture scene produces.
//! `theme::tests::px_is_js_math_round_not_rusts` is what guards it. Do not read
//! a green run here as covering that.
//!
//! The three prompt scenes are unmoved by every structural sabotage, correctly:
//! the legacy prompt is a flat fill + a 2px stroke + two lines of text, with no
//! bevel, key or rivet anywhere in it.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use pk_gui::font::Fonts;
use pk_gui::im::*;
use pk_gui::painter::Painter;
use pk_gui::screens::tavern::{paint_run_summary, paint_station_prompt, StationView, SummaryView};
use pk_gui::theme::Ui;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixtures {
    #[allow(dead_code)]
    legacy_rev: String,
    scenes: Vec<Scene>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Scene {
    name: String,
    kind: String,
    grid_w: u32,
    grid_h: u32,
    w: f64,
    h: f64,
    zoom: u32,
    focus: i64,
    station: Option<StationFix>,
    summary: Option<SummaryFix>,
}

#[derive(Deserialize)]
struct StationFix {
    label: String,
    blurb: String,
    accent: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SummaryFix {
    floor: String,
    grade: String,
    kills: String,
    best_combo: String,
    gear: String,
    purse: String,
}

fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../assets/fixtures/gui")
}

fn read_png(path: &Path) -> (u32, u32, Vec<u8>) {
    let file = std::fs::File::open(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    let mut reader = png::Decoder::new(file).read_info().expect("bad PNG");
    let mut buf = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).expect("bad PNG frame");
    assert_eq!(info.color_type, png::ColorType::Rgba);
    buf.truncate(info.buffer_size());
    (info.width, info.height, buf)
}

/// The Rust twin of `paintWidgets` in bake-gui-fixtures.mjs. Keep in lockstep.
fn paint_widgets(f: &mut UiFrame) {
    scrim(f);
    let mut body = sheet(f, 600.0, 400.0);
    let head = cut_top(&mut body, 24.0);
    heading(f, &head, "Widget Sampler", Ui::HEADING);
    cut_top(&mut body, 4.0);

    let mut r1 = cut_top(&mut body, 24.0);
    let b = cut_left(&mut r1, 150.0);
    button(f, &b, "BUY", ButtonOpts::default());
    cut_left(&mut r1, 8.0);
    let b = cut_left(&mut r1, 150.0);
    button(
        f,
        &b,
        "SELL",
        ButtonOpts {
            danger: true,
            ..Default::default()
        },
    );
    cut_left(&mut r1, 8.0);
    let b = cut_left(&mut r1, 150.0);
    button(
        f,
        &b,
        "TAKE",
        ButtonOpts {
            good: true,
            ..Default::default()
        },
    );

    cut_top(&mut body, 8.0);
    let mut r2 = cut_top(&mut body, 24.0);
    let b = cut_left(&mut r2, 150.0);
    button(
        f,
        &b,
        "BROKE",
        ButtonOpts {
            disabled: true,
            ..Default::default()
        },
    );
    cut_left(&mut r2, 8.0);
    let t = cut_left(&mut r2, 60.0);
    toggle(f, &t, true, ("ON", "OFF"));
    cut_left(&mut r2, 8.0);
    let t = cut_left(&mut r2, 60.0);
    toggle(f, &t, false, ("ON", "OFF"));

    cut_top(&mut body, 8.0);
    let mut r3 = cut_top(&mut body, 24.0);
    let s = cut_left(&mut r3, 200.0);
    slider(f, &s, 0.6, 10);

    cut_top(&mut body, 8.0);
    let mut r4 = cut_top(&mut body, 16.0);
    let br = cut_left(&mut r4, 200.0);
    bar(f, &br, 0.35, Ui::GOLD);
    cut_left(&mut r4, 16.0);
    let pr = cut_left(&mut r4, 60.0);
    pips(f, &pr, 3, 5);

    cut_top(&mut body, 8.0);
    let tr = cut_top(&mut body, 22.0);
    tabs(f, &tr, &["ONE", "TWO", "THREE"], 1);

    cut_top(&mut body, 8.0);
    let tf = cut_top(&mut body, 22.0);
    text_field(f, &tf, "KNIGHT", 16, false);

    cursor_mark(f, body.x + 4.0, body.y + 16.0, 8.0);
    bevel(f, &rect(body.x + 40.0, body.y + 8.0, 40.0, 20.0), true, 2.0);
    well(
        f,
        &rect(body.x + 100.0, body.y + 8.0, 40.0, 20.0),
        Some(Ui::WELL_EDGE),
    );
}

struct Diff {
    total: usize,
    /// Pixels differing on any channel, split by whether the GOLDEN pixel was
    /// fully opaque — translucent pixels are where premultiplied-8-bit canvas
    /// storage and float straight-alpha can legitimately disagree by an LSB.
    opaque_bad: usize,
    translucent_bad: usize,
    max_delta: u8,
    first: Option<(u32, u32, [u8; 4], [u8; 4])>,
}

fn compare(golden: &[u8], mine: &[u8], w: u32) -> Diff {
    let mut d = Diff {
        total: golden.len() / 4,
        opaque_bad: 0,
        translucent_bad: 0,
        max_delta: 0,
        first: None,
    };
    for i in (0..golden.len()).step_by(4) {
        let g = [golden[i], golden[i + 1], golden[i + 2], golden[i + 3]];
        let m = [mine[i], mine[i + 1], mine[i + 2], mine[i + 3]];
        if g == m {
            continue;
        }
        let delta = (0..4).map(|k| g[k].abs_diff(m[k])).max().unwrap();
        d.max_delta = d.max_delta.max(delta);
        if g[3] == 255 {
            d.opaque_bad += 1;
        } else {
            d.translucent_bad += 1;
        }
        if d.first.is_none() {
            let p = (i / 4) as u32;
            d.first = Some((p % w, p / w, g, m));
        }
    }
    d
}

#[test]
fn every_baked_scene_repaints_identically() {
    let dir = fixture_dir();
    let json = std::fs::read(dir.join("fixtures.json"))
        .expect("run: node legacy/scripts/bake-gui-fixtures.mjs");
    let fixtures: Fixtures = serde_json::from_slice(&json).expect("fixtures.json");
    let fonts = Fonts::load_embedded();
    let mut report: HashMap<String, String> = HashMap::new();
    let mut failed = Vec::new();

    for scene in &fixtures.scenes {
        let (gw, gh, golden) = read_png(&dir.join(format!("{}.png", scene.name)));
        assert_eq!(
            (gw, gh),
            (scene.grid_w, scene.grid_h),
            "{}: grid mismatch",
            scene.name
        );

        let mut p = Painter::new(gw, gh);
        {
            let mut f = begin_ui(
                &mut p,
                &fonts,
                scene.w,
                scene.h,
                empty_ui_input(),
                scene.focus,
                scene.zoom,
            );
            match scene.kind.as_str() {
                "widgets" => paint_widgets(&mut f),
                "prompt" => {
                    let s = scene
                        .station
                        .as_ref()
                        .expect("prompt scene needs a station");
                    paint_station_prompt(
                        &mut f,
                        &StationView {
                            label: s.label.clone(),
                            blurb: s.blurb.clone(),
                            accent: s.accent,
                        },
                    );
                }
                "summary" => {
                    let s = scene.summary.as_ref().expect("summary scene needs stats");
                    paint_run_summary(
                        &mut f,
                        &SummaryView {
                            floor: s.floor.clone(),
                            grade: s.grade.clone(),
                            kills: s.kills.clone(),
                            best_combo: s.best_combo.clone(),
                            gear: s.gear.clone(),
                            purse: s.purse.clone(),
                        },
                    );
                }
                other => panic!("unknown fixture kind {other}"),
            }
        }

        let d = compare(&golden, &p.buf, gw);
        let line = format!(
            "opaque {} / translucent {} of {} px, max Δ {}",
            d.opaque_bad, d.translucent_bad, d.total, d.max_delta
        );
        // The contract: opaque pixels must be EXACT. Translucent pixels (the
        // scrim, and any antialiased glyph edge) may differ by at most one LSB
        // per channel from canvas's premultiplied 8-bit storage.
        let ok = d.opaque_bad == 0 && (d.translucent_bad == 0 || d.max_delta <= 1);
        if !ok {
            let (x, y, g, m) = d.first.unwrap();
            failed.push(format!(
                "{}: {line}\n    first diff @ ({x},{y}) golden {g:?} mine {m:?}",
                scene.name
            ));
            // Leave the offending repaint on disk for a human to look at.
            let out = std::env::temp_dir().join(format!("pk-gui-{}-rust.raw", scene.name));
            let _ = std::fs::write(out, &p.buf);
        }
        report.insert(scene.name.clone(), line);
    }

    let mut names: Vec<_> = report.keys().cloned().collect();
    names.sort();
    for n in names {
        println!("  {n:16} {}", report[&n]);
    }
    assert!(
        failed.is_empty(),
        "scenes diverged from the legacy paint:\n{}",
        failed.join("\n")
    );
}
