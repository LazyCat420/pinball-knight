//! THE ARMORER'S COUNTER — "Manage Loadout".
//!
//! PORTS: `gui/screens/tavern.ts armorBody` (L213-261) and the sheet chrome
//! around it (`tavernScreen`, counter mode).
//!
//! The station existed, the prompt existed, and pressing E opened a panel that
//! said *"The counter opens here once the economy lands (P4)."* — which is why
//! "the Manage Loadout UI is not showing up" was both true and not a bug
//! report anyone could act on: the sheet WAS showing, and it was a promise.
//!
//! This is the sheet the oracle paints, over the rules in
//! `pk_core::economy::armory`. Two sections, in this order:
//!
//!   PLATE                       three rows — icon, label, `n/base`, a price button
//!   REPAIR ALL PLATE — 40g      one wide button
//!   ELEMENTAL SETS              four rows — label, blurb, and WORN / WEAR / price
//!
//! ## The numbers are the oracle's, and they are not decorative
//!
//! Row heights (34 for plate, 32 for a set, 3 of gap, `ROW_H` for a heading),
//! the 26px icon at +4/+4, the label baseline at +5 and the state line at +19,
//! the 76×22 buy button inset 84 from the right edge, the 200×24 repair button,
//! the 92×22 set button inset 100, and `max: r.w - 130` on the blurb so a long
//! one ellipsizes instead of running under the button. Each one is transcribed
//! rather than re-judged: a counter that is "about right" is a counter that
//! reads as a different game beside the oracle's.

use crate::im::{
    button, cut_top, focusable, rect, scrim, sheet, text, well, Align, ButtonOpts, Rect, TextOpts,
    UiFrame,
};
use crate::painter::Rgba;
use crate::theme::{Ui, GRID, ROW_H};

/// One plate row, already resolved by the shell — the screen does no rules.
#[derive(Clone, Debug, PartialEq)]
pub struct PlateRow {
    pub label: String,
    /// Remaining soak.
    pub worn: i32,
    /// What a full piece of this slot holds (`absorb || 1`).
    pub base: i32,
    pub price: i64,
    /// Can the purse afford it right now?
    pub affordable: bool,
}

/// One elemental-set row.
#[derive(Clone, Debug, PartialEq)]
pub struct StyleRow {
    pub label: String,
    pub blurb: String,
    pub price: i64,
    pub owned: bool,
    pub worn: bool,
    pub affordable: bool,
    /// 0xRRGGBB, the set's own plate tone.
    pub swatch: u32,
}

/// Everything the counter shows. Built by the shell from `pk_core::economy`.
#[derive(Clone, Debug, PartialEq)]
pub struct ArmoryView {
    pub gold: i64,
    pub plate: Vec<PlateRow>,
    pub styles: Vec<StyleRow>,
    pub repair_price: i64,
    pub repair_affordable: bool,
    /// The last action's message, flashed under the heading (`say()`).
    pub message: Option<String>,
}

/// What the player just asked for. The screen decides nothing.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ArmoryAction {
    BuyPlate(usize),
    RepairAll,
    BuyStyle(usize),
    WearStyle(usize),
    Close,
}

/// The plate the counter sits on. Wide enough for the longest set blurb at its
/// 130px button gutter.
const SHEET_W: f64 = 560.0;
/// Row heights, from `armorBody`. Named because [`content_height`] and the
/// painter must agree — the oracle guarantees that by MEASURING the previous
/// frame (`measuredH`, "this used to be a hand-written formula per vendor"),
/// and every row here is a fixed height, so computing it from the counts is the
/// same answer without the one-frame lag.
const PLATE_ROW_H: f64 = 34.0;
const STYLE_ROW_H: f64 = 32.0;
const ROW_GAP: f64 = 3.0;
const REPAIR_H: f64 = 30.0;
const FOOT_H: f64 = 26.0;

/// How tall the sheet must be to hold this view.
///
/// ⚠️ **The first build passed a CONSTANT 320 here** and the screenshot showed
/// the last two elemental sets and the BACK button hanging off the bottom of
/// the plate, over the room. A sheet that does not fit its content is a sheet
/// whose size was guessed; the counts are right here, so use them.
fn content_height(v: &ArmoryView) -> f64 {
    ROW_H * 3.0                                              // title, message, PLATE heading
        + v.plate.len() as f64 * (PLATE_ROW_H + ROW_GAP)
        + REPAIR_H
        + ROW_H + GRID                                       // ELEMENTAL SETS heading
        + v.styles.len() as f64 * (STYLE_ROW_H + ROW_GAP)
        + FOOT_H + GRID * 2.0 // BACK, and the plate's own margin
}

/// Paint it, and report the one action taken this frame.
pub fn paint_armory(f: &mut UiFrame, v: &ArmoryView) -> Option<ArmoryAction> {
    let mut act = None;

    // ── Sheet chrome: scrim, plate, title, purse, the message line ──
    //
    // ⚠️ THE SCRIM AND THE SHEET ARE NOT DECORATION. The first build of this
    // counter laid its rows straight onto the frame, and the screenshot showed
    // the walkable tavern between every row — the knight, the pinball table and
    // the hearth reading THROUGH a shop menu. `paint_run_summary` next door had
    // it right; this did not, and no test could see it because every layout
    // assertion was about where the rows are.
    scrim(f);
    let mut body = sheet(f, SHEET_W, content_height(v));
    let head = cut_top(&mut body, ROW_H);
    text(
        f,
        "ARMORER",
        head.x,
        head.y + 4.0,
        TextOpts {
            size: 16,
            colour: Some(Ui::HEADING),
            ..TextOpts::default()
        },
    );
    // The purse is RIGHT-aligned in the same row: every price below is read
    // against it, so it has to be on screen at the same time as the buttons.
    text(
        f,
        &format!("{}g", v.gold),
        head.x + head.w,
        head.y + 4.0,
        TextOpts {
            size: 16,
            colour: Some(Ui::GOLD),
            align: Align::Right,
            ..TextOpts::default()
        },
    );
    let msg = cut_top(&mut body, ROW_H);
    if let Some(m) = &v.message {
        text(
            f,
            m,
            msg.x,
            msg.y + 4.0,
            TextOpts {
                size: 8,
                colour: Some(Ui::TEXT_DIM),
                ..TextOpts::default()
            },
        );
    }

    // ── PLATE ──
    let h = cut_top(&mut body, ROW_H);
    heading(f, &h, "PLATE");
    for (i, row) in v.plate.iter().enumerate() {
        let r = cut_top(&mut body, PLATE_ROW_H);
        well(f, &r, None);
        // The oracle draws `itemIcon(s) ?? glyph("shield", …)` here; the icon
        // set is P3 art, so the slot keeps its 26px square and paints the
        // set's tone into it rather than leaving a hole the layout forgets.
        let chip = rect(r.x + 4.0, r.y + 4.0, 26.0, 26.0);
        crate::im::fill_rect(f, &chip, Ui::WELL_EDGE);
        text(
            f,
            &row.label,
            r.x + 36.0,
            r.y + 5.0,
            TextOpts {
                size: 8,
                colour: Some(Ui::TEXT),
                ..TextOpts::default()
            },
        );
        // full → good, partial → gold, empty → faint. THREE states, and the
        // middle one is the whole point of a consumable.
        let (state, colour) = if row.worn > 0 {
            (
                format!("{}/{}", row.worn, row.base),
                if row.worn >= row.base {
                    Ui::GOOD
                } else {
                    Ui::GOLD
                },
            )
        } else {
            ("none".to_string(), Ui::TEXT_FAINT)
        };
        text(
            f,
            &state,
            r.x + 36.0,
            r.y + 19.0,
            TextOpts {
                size: 8,
                colour: Some(colour),
                ..TextOpts::default()
            },
        );
        if button(
            f,
            &rect(r.x + r.w - 84.0, r.y + 6.0, 76.0, 22.0),
            &format!("{}g", row.price),
            ButtonOpts {
                disabled: !row.affordable,
                ..ButtonOpts::default()
            },
        ) {
            act = Some(ArmoryAction::BuyPlate(i));
        }
        cut_top(&mut body, ROW_GAP);
    }

    let rr = cut_top(&mut body, REPAIR_H);
    if button(
        f,
        &rect(rr.x, rr.y, 200.0, 24.0),
        &format!("REPAIR ALL PLATE — {}g", v.repair_price),
        ButtonOpts {
            disabled: !v.repair_affordable,
            ..ButtonOpts::default()
        },
    ) {
        act = Some(ArmoryAction::RepairAll);
    }

    // ── ELEMENTAL SETS ──
    let h = cut_top(&mut body, ROW_H + GRID);
    heading(f, &h, "ELEMENTAL SETS — permanent unlocks");
    for (i, s) in v.styles.iter().enumerate() {
        let r = cut_top(&mut body, STYLE_ROW_H);
        well(f, &r, None);
        // The swatch is the row's identity — "matches the sprite's plate mid
        // tone", so a player recognises the set they are wearing.
        crate::im::fill_rect(
            f,
            &rect(r.x + 4.0, r.y + 8.0, 4.0, 16.0),
            Rgba::hex(s.swatch),
        );
        text(
            f,
            &s.label,
            r.x + GRID + 4.0,
            r.y + 5.0,
            TextOpts {
                size: 8,
                colour: Some(if s.worn { Ui::GOLD } else { Ui::TEXT }),
                ..TextOpts::default()
            },
        );
        text(
            f,
            &s.blurb,
            r.x + GRID + 4.0,
            r.y + 19.0,
            TextOpts {
                size: 8,
                colour: Some(Ui::TEXT_DIM),
                max: Some(r.w - 130.0),
                ..TextOpts::default()
            },
        );
        let btn = rect(r.x + r.w - 100.0, r.y + 5.0, 92.0, 22.0);
        if s.worn {
            // WORN is a LABEL, and it still takes a focus slot — the oracle
            // calls `focusable(disabled)` so keyboard travel does not silently
            // skip the row you are wearing.
            text(
                f,
                "WORN",
                btn.x + btn.w,
                btn.y + 8.0,
                TextOpts {
                    size: 8,
                    colour: Some(Ui::GOLD),
                    align: Align::Right,
                    ..TextOpts::default()
                },
            );
            focusable(f, &btn, true);
        } else if s.owned {
            if button(f, &btn, "WEAR", ButtonOpts::default()) {
                act = Some(ArmoryAction::WearStyle(i));
            }
        } else if button(
            f,
            &btn,
            &format!("{}g", s.price),
            ButtonOpts {
                disabled: !s.affordable,
                ..ButtonOpts::default()
            },
        ) {
            act = Some(ArmoryAction::BuyStyle(i));
        }
        cut_top(&mut body, ROW_GAP);
    }

    // BACK returns to the walkable room — counter mode's own close, so the
    // scene never has to guess whether the sheet is up. It is cut from the
    // BODY, not placed against the frame: against the frame it lands in the
    // bottom-right corner of the SCREEN, outside the plate it belongs to.
    let foot = cut_top(&mut body, FOOT_H);
    let foot = rect(foot.x + foot.w - 100.0, foot.y, 100.0, FOOT_H);
    if button(f, &foot, "BACK", ButtonOpts::default()) {
        act = Some(ArmoryAction::Close);
    }
    act
}

/// The oracle's `heading()` — a label with a rule under it.
fn heading(f: &mut UiFrame, r: &Rect, s: &str) {
    text(
        f,
        s,
        r.x,
        r.y + 4.0,
        TextOpts {
            size: 8,
            colour: Some(Ui::ARCANE),
            ..TextOpts::default()
        },
    );
    crate::im::fill_rect(f, &rect(r.x, r.y + r.h - 3.0, r.w, 1.0), Ui::SHEET_EDGE_LIT);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::im::{begin_ui, empty_ui_input};
    use crate::painter::Painter;
    use crate::{Fonts, UiInput};

    fn view() -> ArmoryView {
        ArmoryView {
            gold: 500,
            plate: vec![
                PlateRow {
                    label: "Helmet".into(),
                    worn: 0,
                    base: 3,
                    price: 45,
                    affordable: true,
                },
                PlateRow {
                    label: "Armor".into(),
                    worn: 2,
                    base: 5,
                    price: 70,
                    affordable: true,
                },
                PlateRow {
                    label: "Boots".into(),
                    worn: 1,
                    base: 1,
                    price: 40,
                    affordable: true,
                },
            ],
            styles: vec![
                StyleRow {
                    label: "Glacier Plate".into(),
                    blurb: "hoarfrost steel, cold-blue sheen".into(),
                    price: 600,
                    owned: false,
                    worn: false,
                    affordable: false,
                    swatch: 0x6fd0e8,
                },
                StyleRow {
                    label: "Storm Plate".into(),
                    blurb: "storm-slate chased with lightning gold".into(),
                    price: 900,
                    owned: true,
                    worn: true,
                    affordable: false,
                    swatch: 0xffd98a,
                },
            ],
            repair_price: 40,
            repair_affordable: true,
            message: Some("Armor equipped".into()),
        }
    }

    fn paint_with_focus(input: &UiInput, focus: i64) -> (Painter, Option<ArmoryAction>) {
        let fonts = Fonts::load_embedded();
        let mut p = Painter::new(600, 338);
        let act;
        {
            let mut f = begin_ui(&mut p, &fonts, 600.0, 338.0, input.clone(), focus, 1);
            act = paint_armory(&mut f, &view());
        }
        (p, act)
    }

    #[test]
    fn the_counter_paints_something_and_asks_for_nothing_unprompted() {
        // A screen that fires an action with no input is a screen that buys
        // plate the moment it opens.
        let (p, act) = paint_with_focus(&empty_ui_input(), 0);
        assert_eq!(act, None);
        assert!(
            p.buf.iter().any(|&b| b != 0),
            "the counter painted an empty buffer"
        );
    }

    #[test]
    fn the_first_focusable_is_the_first_plate_rows_buy_button() {
        // Driven by FOCUS, not by pixel coordinates. The first draft clicked a
        // hard-coded point and broke the moment the content moved inside its
        // sheet — a test that re-derives the layout is a second copy of the
        // layout, and it drifts. What actually matters here is the ORDER: the
        // plate rows come first, so slot 0's button is focus 0, and keyboard
        // travel through this counter starts on the helmet.
        let mut input = empty_ui_input();
        input.accept = true;
        let (_, act) = paint_with_focus(&input, 0);
        assert_eq!(act, Some(ArmoryAction::BuyPlate(0)));
    }

    #[test]
    fn focus_walks_plate_then_repair_then_the_sets() {
        // Three plate rows (0,1,2), the repair button (3), then the sets. The
        // WORN set still takes an index — it is a disabled focusable, so the
        // cursor does not silently skip the row you are wearing.
        let mut input = empty_ui_input();
        input.accept = true;
        assert_eq!(
            paint_with_focus(&input, 1).1,
            Some(ArmoryAction::BuyPlate(1))
        );
        assert_eq!(
            paint_with_focus(&input, 2).1,
            Some(ArmoryAction::BuyPlate(2))
        );
        assert_eq!(paint_with_focus(&input, 3).1, Some(ArmoryAction::RepairAll));
        // Index 4 is the first set. In this view the purse is 500g and Glacier
        // is 600g, so it is a DISABLED button and accepting on it must do
        // nothing — which is what this originally got wrong, expecting a
        // purchase the player cannot afford. A disabled widget still holds its
        // index; that is why 5 and 6 are where they are.
        assert_eq!(paint_with_focus(&input, 4).1, None, "600g on a 500g purse");
    }

    #[test]
    fn a_set_you_can_afford_is_buyable_at_the_same_index() {
        // The other half of the pair above: same layout, richer purse. Without
        // this, "index 4 does nothing" would pass just as happily if the row
        // had no button at all.
        let mut input = empty_ui_input();
        input.accept = true;
        let fonts = Fonts::load_embedded();
        let mut p = Painter::new(600, 338);
        let mut v = view();
        v.gold = 1200;
        v.styles[0].affordable = true;
        let act;
        {
            let mut f = begin_ui(&mut p, &fonts, 600.0, 338.0, input, 4, 1);
            act = paint_armory(&mut f, &v);
        }
        assert_eq!(act, Some(ArmoryAction::BuyStyle(0)));
    }

    #[test]
    fn a_worn_set_offers_no_button_to_press() {
        // Storm Plate is `worn` (index 1 in the view), so its slot is a WORN
        // label and a disabled focusable. Accepting on it must do nothing at
        // all — not re-wear, not re-buy.
        let mut input = empty_ui_input();
        input.accept = true;
        let (_, act) = paint_with_focus(&input, 5);
        assert_ne!(act, Some(ArmoryAction::WearStyle(1)));
        assert_ne!(act, Some(ArmoryAction::BuyStyle(1)));
    }

    #[test]
    fn the_sheet_is_opaque_where_the_room_would_show_through() {
        // THE DEFECT THE SCREENSHOT FOUND AND NO LAYOUT TEST COULD. Without a
        // scrim and a sheet the counter painted its rows straight onto the
        // frame, and the walkable tavern read THROUGH the gaps between them.
        // Sampled between two plate rows, dead centre.
        let (p, _) = paint_with_focus(&empty_ui_input(), 0);
        let px = p.pixel(300, 169);
        assert_eq!(px.a, 255, "the middle of the counter is see-through");
    }
}
