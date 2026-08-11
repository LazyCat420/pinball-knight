//! The walkable tavern's own overlays — `legacy/src/scenes/tavern/scene-screens.ts`.
//!
//! Paint functions over plain view structs, so the shell decides what is open
//! and this module stays pure (testable against the baked golden fixtures).
//! The station prompt and run summary are line-for-line ports; the station
//! panel is the port's own composition — the real vendor counters land with
//! P4's economy, but their CHROME (sheet, heading, footer) is the legacy
//! vocabulary already, so the placeholder wears it instead of a flat rect.

use crate::im::{
    button, cut_top, fill_rect, rect, scrim, sheet, stroke_rect, text, wrap, Align, ButtonOpts,
    Rect, TextOpts, UiFrame,
};
use crate::painter::Rgba;
use crate::theme::{Ui, GRID, ROW_H};

/// What a screen needs to know about a station. The shell maps
/// `pk_core::tavern::layout::Station` into this 1:1.
#[derive(Clone, Debug, PartialEq)]
pub struct StationView {
    pub label: String,
    pub blurb: String,
    /// 0xRRGGBB — WARM 0xf0a63c, COLD 0x6fd0e8, GOLD 0xf0c040.
    pub accent: u32,
}

/// The run-summary rows, preformatted by the shell (the fixture pins them, so
/// gear/purse strings never drag game state into this crate).
#[derive(Clone, Debug, PartialEq)]
pub struct SummaryView {
    pub floor: String,
    pub grade: String,
    pub kills: String,
    pub best_combo: String,
    pub gear: String,
    pub purse: String,
}

/// A placeholder vendor/cabinet panel: real chrome, stub body.
#[derive(Clone, Debug, PartialEq)]
pub struct PanelView {
    pub title: String,
    pub blurb: String,
    pub body: String,
    pub accent: u32,
}

/// The screens the tavern shell can stack. `Panel` carries the station index.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TavernScreen {
    StationPrompt,
    RunSummary,
    Panel(u8),
}

/// The contextual "[E] ALCHEMIST" line — scene-screens.ts L66-77, exactly.
/// Non-pausing and non-focusable: it is a label.
pub fn paint_station_prompt(f: &mut UiFrame, s: &StationView) {
    let accent = Rgba::hex(s.accent);
    let label = format!("[E] {}", s.label.to_uppercase());
    let w = 220.0_f64.max(label.chars().count() as f64 * 9.0 + GRID * 4.0);
    let r = rect((f.w - w) / 2.0, f.h - 132.0, w, 40.0);
    fill_rect(f, &r, Ui::SHEET);
    stroke_rect(f, &r, accent, 2.0);
    text(
        f,
        &label,
        r.x + r.w / 2.0,
        r.y + 8.0,
        TextOpts {
            size: 8,
            colour: Some(accent),
            align: Align::Center,
            max: None,
        },
    );
    text(
        f,
        &s.blurb,
        r.x + r.w / 2.0,
        r.y + 24.0,
        TextOpts {
            size: 8,
            colour: Some(Ui::TEXT_DIM),
            align: Align::Center,
            max: Some(r.w - GRID),
        },
    );
}

fn grade_colour(grade: &str) -> Rgba {
    if grade.starts_with('S') {
        Ui::HEADING
    } else if grade.starts_with('A') {
        Ui::GOOD
    } else if grade.starts_with('B') {
        Ui::TEXT
    } else {
        Ui::TEXT_DIM
    }
}

/// The run summary — scene-screens.ts L244-266. Returns true when CLOSE fired.
pub fn paint_run_summary(f: &mut UiFrame, v: &SummaryView) -> bool {
    scrim(f);
    let mut body = sheet(f, 420.0, 300.0);
    text(
        f,
        "RUN SUMMARY",
        body.x,
        body.y,
        TextOpts {
            size: 16,
            colour: Some(Ui::ARCANE),
            align: Align::Left,
            max: None,
        },
    );
    cut_top(&mut body, 34.0);

    let row = |f: &mut UiFrame, body: &mut Rect, label: &str, value: &str, colour: Rgba| {
        let r = cut_top(body, 22.0);
        text(
            f,
            label,
            r.x,
            r.y + 4.0,
            TextOpts {
                size: 8,
                colour: Some(Ui::TEXT_DIM),
                align: Align::Left,
                max: None,
            },
        );
        text(
            f,
            value,
            r.x + r.w,
            r.y + 4.0,
            TextOpts {
                size: 8,
                colour: Some(colour),
                align: Align::Right,
                max: None,
            },
        );
        let rule = rect(r.x, r.y + 19.0, r.w, 1.0);
        fill_rect(f, &rule, Ui::WELL_EDGE);
    };
    row(f, &mut body, "Floor cleared", &v.floor, Ui::GOLD);
    row(f, &mut body, "Grade", &v.grade, grade_colour(&v.grade));
    row(f, &mut body, "Kills", &v.kills, Ui::TEXT);
    row(f, &mut body, "Best combo", &v.best_combo, Ui::TEXT);
    row(f, &mut body, "Gear", &v.gear, Ui::TEXT);
    row(f, &mut body, "Purse", &v.purse, Ui::GOLD);

    // `cutTop` keeps y + h invariant, so this is the CONTENT rect's bottom row —
    // exactly the legacy `rect(body.x, body.y + body.h - ROW_H, …)` after cuts.
    let foot = rect(body.x, body.y + body.h - ROW_H, body.w, ROW_H);
    button(f, &foot, "CLOSE  [ESC]", ButtonOpts::default())
}

/// A station panel in the legacy chrome: scrim → sheet → accent title (16px) →
/// blurb → wrapped body → footer hint. Uses the vendor sheet's design box
/// ({600, 338, max 2}) so it sits at the zoom the real counters will.
/// Returns true when CLOSE fired.
pub fn paint_station_panel(f: &mut UiFrame, v: &PanelView) -> bool {
    scrim(f);
    let mut body = sheet(f, 584.0, 322.0);
    let accent = Rgba::hex(v.accent);
    let full = body;

    let head = cut_top(&mut body, 32.0);
    text(
        f,
        &v.title.to_uppercase(),
        head.x,
        head.y,
        TextOpts {
            size: 16,
            colour: Some(accent),
            align: Align::Left,
            max: Some(head.w),
        },
    );
    let blurb_r = cut_top(&mut body, 18.0);
    text(
        f,
        &v.blurb,
        blurb_r.x,
        blurb_r.y,
        TextOpts {
            size: 8,
            colour: Some(Ui::TEXT_DIM),
            align: Align::Left,
            max: Some(blurb_r.w),
        },
    );
    cut_top(&mut body, GRID);

    let lines = wrap(f, &v.body, body.w, 8);
    for line in lines {
        let r = cut_top(&mut body, 14.0);
        text(
            f,
            &line,
            r.x,
            r.y,
            TextOpts {
                size: 8,
                colour: Some(Ui::TEXT),
                align: Align::Left,
                max: None,
            },
        );
    }

    let foot = rect(full.x, full.y + full.h - ROW_H, full.w, ROW_H);
    button(f, &foot, "CLOSE  [E / ESC]", ButtonOpts::default())
}
