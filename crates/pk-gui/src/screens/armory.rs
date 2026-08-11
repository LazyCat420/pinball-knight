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
//! ## THE COUNTER IS SIZED TO FIT, NOT TRANSCRIBED
//!
//! The first build took the oracle's metrics verbatim — 34px plate rows, 32px
//! set rows, `ROW_H` headings, a 26px icon, 76×22 and 92×22 buttons, a 200×24
//! repair key — because "about right" numbers read as a different game beside
//! the oracle's. That gave a counter 427px tall inside a 338px design box, and
//! the answer to the overflow was the oracle's own: a scroll region.
//!
//! **The player asked for the other answer.** *"We have to keep decreasing the
//! size of the buttons/text of the UI until we can fit it without having to
//! scroll."* So every repeating metric here is now the SMALLEST one that still
//! holds its content, and the whole counter fits the design box with the region
//! inert. What that costs is the transcription; what it buys is a sheet the
//! player can read in one look, with no fold and no hidden rows.
//!
//! Two things did NOT shrink, and both are deliberate. Body text stays at 8 —
//! that is the floor of the baked atlas set (8/16/24/32; see [`crate::font`]),
//! and a size the bake does not ship draws NOTHING, silently. And the 16px
//! title stays 16: it appears once, it is the sheet's identity, and shrinking a
//! heading buys 8 pixels of the ~105 this needed.
//!
//! ## The fit is a gate, not an observation
//!
//! [`content_height`] and [`scroll_body_height`] are what the sheet and the
//! region are sized from, and
//! `the_shipped_counter_never_scrolls_at_any_focus` drives the REAL roster (3
//! plate slots, 4 elemental sets) through the real paint and fails if the
//! offset ever leaves zero. Grow any constant in this file past its budget and
//! that test goes red — which is the only way "it fits" stays true after the
//! next row is added.
//!
//! The region is kept, and it is not dead weight: it is what makes the failure
//! mode of a future fifth set a scrollbar instead of rows painting off the
//! bottom of the window over the room, which is exactly what the player
//! screenshotted.

use crate::im::{
    button, cut_top, focusable, rect, scrim, sheet, text, well, Align, ButtonOpts, Rect, TextOpts,
    UiFrame,
};
use crate::painter::Rgba;
use crate::theme::{Ui, GRID};

/// One plate row, already resolved by the shell — the screen does no rules.
#[derive(Clone, Debug, PartialEq)]
pub struct PlateRow {
    pub label: String,
    /// The item id its sprite is filed under — `GearSlot::item_id`, which is
    /// the same key `ITEM_PAINTS` and the baked icon set use.
    pub icon: String,
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
/// button gutter.
const SHEET_W: f64 = 560.0;

// ── THE COMPACT METRICS ──────────────────────────────────────────────────────
//
// Every row here is a FIXED height, so [`content_height`] computes from the
// counts what the oracle gets by measuring the previous frame (`measuredH`,
// "this used to be a hand-written formula per vendor") — the same answer
// without the one-frame lag, and the reason the painter and the sizer cannot
// drift apart.
//
// The floor on all of them is one number: **8px text**. A row carrying two
// stacked lines cannot go below 2 + 8 + 2 + 8 + 2 = 22, and that is what the
// two row heights are. A single-line row (a heading, a button) is 8 plus its
// air.

/// Title + purse. 16px type with 2 of air above and below.
const TITLE_H: f64 = 20.0;
/// The `say()` flash line — 8px type, and it is often empty.
const MSG_H: f64 = 12.0;
/// A section heading: 8px type, its rule, and 2 of air.
const HEAD_H: f64 = 14.0;
/// The air over the second heading, so the sets read as a new block. Was `GRID`.
const HEAD_GAP: f64 = 4.0;
/// Icon, label, state line. Two 8px lines at 2/12 with 2 of bottom air.
const PLATE_ROW_H: f64 = 22.0;
/// The gear chip inside a plate row. 18 is an exact quarter of the icons' 72px
/// native size (and 36 device pixels at zoom 2), where 16 would snap down to
/// 12 — see [`crate::im::draw_icon`]. The oracle's chip is 26 in a 34px row.
const ICON_PX_ROW: f64 = 18.0;
/// Swatch, label, blurb. Same two-line budget.
const STYLE_ROW_H: f64 = 22.0;
/// Between rows. Below 2 the wells merge into one long trough.
const ROW_GAP: f64 = 2.0;
const REPAIR_H: f64 = 22.0;
const FOOT_H: f64 = 20.0;

/// Every row button on the counter. 64 wide holds `1200g` (5 chars = 40px)
/// inside `button()`'s own `GRID * 2` text inset with room to spare; 16 tall is
/// the 8px label plus its 4/4 air, and it is the shortest key the focus ring
/// still reads as a ring rather than as a line.
const BTN_W: f64 = 64.0;
const BTN_H: f64 = 16.0;
/// Right-hand gutter: the button, plus `GRID` of air off the well's edge.
const BTN_INSET: f64 = BTN_W + GRID;
/// The repair key. It carries the longest label on the sheet — "REPAIR ALL
/// PLATE — 40g" is 22 chars = 176px, and `button()` ellipsizes at `w - 16`, so
/// anything under 192 would silently eat the price.
const REPAIR_W: f64 = 200.0;
const REPAIR_BTN_H: f64 = 18.0;

/// How tall the sheet WANTS to be. It gets this or the screen, whichever is
/// smaller — `sheet()` clamps — and the difference is what the region scrolls.
/// At the compact metrics the real roster wants 320 of the design box's 322, so
/// the clamp does not bite and the region never engages.
///
/// ⚠️ **The first build passed a CONSTANT 320 here** and the screenshot showed
/// the last two elemental sets and the BACK button hanging off the bottom of
/// the plate, over the room. Computing it from the counts fixed the SIZE and
/// not the overflow: at the counter's design box (600×338, `gui.rs`) three
/// plate rows and four sets wanted 427, `sheet()` clamped the plate to 322, and
/// the rows kept painting past the bottom edge of the window because nothing
/// clipped them. See [`scroll_body_height`].
///
/// ⚠️ **`GRID * 4`, not `GRID * 2`.** `sheet()` returns `inset(r, GRID * 2)` —
/// which takes the margin off the TOP and the BOTTOM. Counting it once asks for
/// a plate 8px too short and hands the region a view 8px smaller than the sizer
/// believed, i.e. a scrollbar on a counter that fits.
///
/// And the answer is rounded UP to the grid because `sheet()` SNAPS its height
/// (`snap` is `Math.round` on GRID, which rounds DOWN as often as up): asking
/// for 314 gets a 312-tall plate, and those two pixels are two pixels of view
/// the content is entitled to.
fn content_height(v: &ArmoryView) -> f64 {
    let want = GRID * 4.0                                    // the plate's margins
        + TITLE_H + MSG_H                                    // title, message
        + scroll_body_height(v)
        + GRID + FOOT_H; // the air over BACK, and BACK
    (want / GRID).ceil() * GRID
}

/// The part that SCROLLS: everything between the message line and BACK.
///
/// The title, the purse and BACK stay outside the region deliberately — the
/// oracle keeps its vendor bar and its footer out of `beginScroll` too. A purse
/// that scrolls off is a purse you cannot read the prices against, and a BACK
/// button below the fold is how a sheet becomes a trap.
fn scroll_body_height(v: &ArmoryView) -> f64 {
    HEAD_H                                                   // PLATE heading
        + v.plate.len() as f64 * (PLATE_ROW_H + ROW_GAP)
        + REPAIR_H
        + HEAD_GAP + HEAD_H                                  // ELEMENTAL SETS heading
        + v.styles.len() as f64 * (STYLE_ROW_H + ROW_GAP)
}

/// Paint it, and report the one action taken this frame.
///
/// `scroll` is the region's offset, owned by the caller's `ScreenEntry` and
/// updated here — the same contract as the oracle's `UiScreen.scroll`.
pub fn paint_armory(f: &mut UiFrame, v: &ArmoryView, scroll: &mut f64) -> Option<ArmoryAction> {
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
    let head = cut_top(&mut body, TITLE_H);
    text(
        f,
        "ARMORER",
        head.x,
        head.y + 2.0,
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
        head.y + 2.0,
        TextOpts {
            size: 16,
            colour: Some(Ui::GOLD),
            align: Align::Right,
            ..TextOpts::default()
        },
    );
    let msg = cut_top(&mut body, MSG_H);
    if let Some(m) = &v.message {
        text(
            f,
            m,
            msg.x,
            msg.y + 2.0,
            TextOpts {
                size: 8,
                colour: Some(Ui::TEXT_DIM),
                ..TextOpts::default()
            },
        );
    }

    // ── THE SCROLLING MIDDLE ──
    //
    // BACK is reserved off the BOTTOM first, so the region gets what is left
    // rather than what it wants. Everything below is painted into `body`,
    // which is now the region's CONTENT rect — taller than the view whenever
    // the counter has more rows than the box, which the oracle says is every
    // counter it has ("the Alchemist paints to y=380 in a 338-tall box").
    //
    // The GRID of clear air under the region is not padding for its own sake:
    // the fold cuts a row mid-height, and with BACK flush against it the button
    // reads as sitting ON the half-row rather than under the list. Measured on
    // the counter screenshot — "Storm Plate" was clipped at the fold and BACK
    // overlapped its price.
    let foot_h = FOOT_H + GRID;
    let view = rect(body.x, body.y, body.w, (body.h - foot_h).max(HEAD_H));
    let foot_row = rect(body.x, body.y + view.h + GRID, body.w, FOOT_H);
    let content_h = scroll_body_height(v);
    let sc = crate::im::begin_scroll(f, &view, content_h, *scroll);
    let mut body = sc.inner;

    // ── PLATE ──
    let h = cut_top(&mut body, HEAD_H);
    heading(f, &h, "PLATE");
    for (i, row) in v.plate.iter().enumerate() {
        let r = cut_top(&mut body, PLATE_ROW_H);
        well(f, &r, None);
        // THE GEAR ITSELF — `itemIcon(s)`, baked from the game's own
        // `FramePaint` (see [`crate::icons`]). This chip WAS a flat square of
        // `WELL_EDGE`, and the player's report was exactly that: "we still
        // don't see all the armors". The rows were all there; the armour was
        // not.
        //
        // 18 and not 16: the icons are 72px native and `draw_icon` only blits
        // at exact ratios, so 18 is a clean quarter (and 36 device pixels at
        // zoom 2) where 16 would have been snapped down to 12.
        let chip = rect(r.x + 2.0, r.y + 2.0, ICON_PX_ROW, ICON_PX_ROW);
        match crate::icons::icon(&row.icon) {
            Some(ic) => crate::im::draw_icon(f, ic, chip.x, chip.y, chip.w),
            // The oracle falls back to `glyph("shield", …)`. The procedural
            // glyph set is not baked yet, so an unbaked id gets the well it
            // always had — visibly a hole, which is the honest answer.
            None => crate::im::fill_rect(f, &chip, Ui::WELL_EDGE),
        }
        text(
            f,
            &row.label,
            r.x + 24.0,
            r.y + 2.0,
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
            r.x + 24.0,
            r.y + 12.0,
            TextOpts {
                size: 8,
                colour: Some(colour),
                ..TextOpts::default()
            },
        );
        if button(
            f,
            &rect(r.x + r.w - BTN_INSET, r.y + 3.0, BTN_W, BTN_H),
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
        &rect(rr.x, rr.y + 2.0, REPAIR_W, REPAIR_BTN_H),
        &format!("REPAIR ALL PLATE — {}g", v.repair_price),
        ButtonOpts {
            disabled: !v.repair_affordable,
            ..ButtonOpts::default()
        },
    ) {
        act = Some(ArmoryAction::RepairAll);
    }

    // ── ELEMENTAL SETS ──
    // The gap is cut SEPARATELY from the heading row: `heading()` paints from
    // the top of the rect it is given, so folding the air into its height would
    // put the label back where it was and only move the rule.
    cut_top(&mut body, HEAD_GAP);
    let h = cut_top(&mut body, HEAD_H);
    heading(f, &h, "ELEMENTAL SETS — permanent unlocks");
    for (i, s) in v.styles.iter().enumerate() {
        let r = cut_top(&mut body, STYLE_ROW_H);
        well(f, &r, None);
        // The swatch is the row's identity — "matches the sprite's plate mid
        // tone", so a player recognises the set they are wearing.
        crate::im::fill_rect(
            f,
            &rect(r.x + 3.0, r.y + 4.0, 3.0, 14.0),
            Rgba::hex(s.swatch),
        );
        text(
            f,
            &s.label,
            r.x + 12.0,
            r.y + 2.0,
            TextOpts {
                size: 8,
                colour: Some(if s.worn { Ui::GOLD } else { Ui::TEXT }),
                ..TextOpts::default()
            },
        );
        text(
            f,
            &s.blurb,
            r.x + 12.0,
            r.y + 12.0,
            TextOpts {
                size: 8,
                colour: Some(Ui::TEXT_DIM),
                // Ellipsize BEFORE the button gutter: the blurb starts 12 in,
                // the key's left edge is `BTN_INSET` off the right, and 4 of
                // clear air between them is what stops a long blurb reading as
                // if it runs under the price.
                max: Some(r.w - BTN_INSET - 16.0),
                ..TextOpts::default()
            },
        );
        let btn = rect(r.x + r.w - BTN_INSET, r.y + 3.0, BTN_W, BTN_H);
        if s.worn {
            // WORN is a LABEL, and it still takes a focus slot — the oracle
            // calls `focusable(disabled)` so keyboard travel does not silently
            // skip the row you are wearing.
            text(
                f,
                "WORN",
                btn.x + btn.w,
                btn.y + 4.0,
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

    // The region closes BEFORE the footer paints, or BACK would be clipped and
    // would scroll away with the rows.
    crate::im::end_scroll(f, &view, content_h, sc.offset);

    // ── THE REGION FOLLOWS THE CURSOR ──
    // The wheel only moves it while the pointer is inside, and this counter is
    // played on a pad. Without this the D-pad walks the focus ring off the
    // bottom, the highlight vanishes, and Enter fires a button nobody can see —
    // which reads as the UI having frozen rather than as a scroll bug. Called
    // AFTER the body painted and with the SAME `view`, because `focus_rect` is
    // in content space and `view` is in screen space.
    *scroll = crate::im::follow_focus(f, &view, sc.offset);

    // BACK returns to the walkable room — counter mode's own close, so the
    // scene never has to guess whether the sheet is up. It is cut from the
    // BODY, not placed against the frame: against the frame it lands in the
    // bottom-right corner of the SCREEN, outside the plate it belongs to.
    let foot = rect(foot_row.x + foot_row.w - 80.0, foot_row.y, 80.0, foot_row.h);
    if button(f, &foot, "BACK", ButtonOpts::default()) {
        act = Some(ArmoryAction::Close);
    }
    act
}

/// The oracle's `heading()` — a label with a rule under it.
///
/// In a 14-tall row the label owns 2..10 and the rule sits at 12, so there is
/// one clear pixel between the glyph box and the line. At the oracle's `+4` and
/// `h - 3` the rule would have landed INSIDE the type.
fn heading(f: &mut UiFrame, r: &Rect, s: &str) {
    text(
        f,
        s,
        r.x,
        r.y + 2.0,
        TextOpts {
            size: 8,
            colour: Some(Ui::ARCANE),
            ..TextOpts::default()
        },
    );
    crate::im::fill_rect(f, &rect(r.x, r.y + r.h - 2.0, r.w, 1.0), Ui::SHEET_EDGE_LIT);
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
                    icon: "helmet".into(),
                    worn: 0,
                    base: 3,
                    price: 45,
                    affordable: true,
                },
                PlateRow {
                    label: "Armor".into(),
                    icon: "armor".into(),
                    worn: 2,
                    base: 5,
                    price: 70,
                    affordable: true,
                },
                PlateRow {
                    label: "Boots".into(),
                    icon: "boots".into(),
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
            act = paint_armory(&mut f, &view(), &mut 0.0);
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
            act = paint_armory(&mut f, &v, &mut 0.0);
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

    /// A counter with more rows than its box — which the shipped one has, and
    /// the two-set fixture above does not.
    fn tall_view() -> ArmoryView {
        let mut v = view();
        for (n, b) in [
            ("Gale Plate", "jade-green tempest steel"),
            ("Ember Plate", "forge-red plate, coal-warm"),
            ("Umbral Plate", "night-black, drinks the torchlight"),
        ] {
            v.styles.push(StyleRow {
                label: n.into(),
                blurb: b.into(),
                price: 750,
                owned: false,
                worn: false,
                // AFFORDABLE, and that is load-bearing for the follow test:
                // `focusable` returns early for a disabled widget, BEFORE it
                // records `focus_rect`, so a cursor parked on a greyed row has
                // no rect for the region to follow. Harmless in play —
                // `move_focus` steps over disabled rows so the cursor never
                // rests on one — but a fixture of unaffordable sets measures
                // nothing and reads as "scrolling is broken".
                affordable: true,
                swatch: 0x8a7d6b,
            });
        }
        v
    }

    fn paint_view(v: &ArmoryView, focus: i64, scroll: &mut f64) -> Painter {
        let fonts = Fonts::load_embedded();
        let mut p = Painter::new(600, 338);
        {
            let mut f = begin_ui(&mut p, &fonts, 600.0, 338.0, empty_ui_input(), focus, 1);
            paint_armory(&mut f, v, scroll);
        }
        p
    }

    /// The LAST focusable index: 3 plate buttons, the repair key, then a slot
    /// per set.
    fn last_focus(v: &ArmoryView) -> i64 {
        (v.plate.len() + 1 + v.styles.len() - 1) as i64
    }

    /// Does this fixture overflow its box?
    ///
    /// Answered by the PAINT — park the cursor on the bottom widget and ask
    /// whether the region had to move to reach it. A formula here would be a
    /// second copy of the layout, and the layout is what these tests exist to
    /// pin; the copy would agree with a broken painter.
    fn overflows(v: &ArmoryView) -> bool {
        let mut scroll = 0.0;
        paint_view(v, last_focus(v), &mut scroll);
        scroll > 0.0
    }

    /// THE REAL COUNTER: three plate slots (`GEAR_SLOTS`) and four elemental
    /// sets (`ELEMENTAL_STYLE_IDS`, pinned at 4 by its own test in
    /// `pk_core::economy::armory` — pk-gui cannot see that crate, which is why
    /// the count is restated here rather than imported).
    ///
    /// Everything is AFFORDABLE on purpose. `focusable` returns early for a
    /// disabled widget, before it records `focus_rect`, so a greyed row cannot
    /// be followed — and a fit test walking a roster of unaffordable rows would
    /// report "never scrolled" no matter how far off the plate they painted.
    fn shipped_view() -> ArmoryView {
        let mut v = view();
        v.gold = 5_000;
        for row in &mut v.plate {
            row.affordable = true;
        }
        v.styles = [
            (
                "Glacier Plate",
                "hoarfrost steel, cold-blue sheen",
                0x6fd0e8,
            ),
            (
                "Storm Plate",
                "storm-slate chased with lightning gold",
                0xffd98a,
            ),
            ("Gale Plate", "jade-green tempest steel", 0x8fe3a8),
            ("Ember Plate", "forge-red plate, coal-warm", 0xe8794a),
        ]
        .into_iter()
        .map(|(label, blurb, swatch)| StyleRow {
            label: label.into(),
            blurb: blurb.into(),
            price: 600,
            owned: false,
            worn: false,
            affordable: true,
            swatch,
        })
        .collect();
        v
    }

    /// THE ASK, PINNED. *"Keep decreasing the size of the buttons/text of the
    /// UI until we can fit it without having to scroll."*
    ///
    /// The counter the game actually opens must never move its region — not on
    /// the first row, not on the last, not anywhere between. Walking every
    /// focus rather than only the last is what catches a metric that grows the
    /// MIDDLE of the sheet: `follow_focus` only reports a widget it had to
    /// chase, so a bottom-anchored check can be satisfied by a layout that
    /// clips a row nobody parks on.
    ///
    /// Grow any constant in this file past its budget and this goes red. That
    /// is the point: "it fits" is a property with a test, not a screenshot from
    /// one afternoon.
    #[test]
    fn the_shipped_counter_never_scrolls_at_any_focus() {
        let v = shipped_view();
        for focus in 0..=last_focus(&v) {
            let mut scroll = 0.0;
            paint_view(&v, focus, &mut scroll);
            assert_eq!(
                scroll,
                0.0,
                "focus {focus} of {} pushed the region off the top — \
                 the counter does not fit its design box",
                last_focus(&v)
            );
        }
        assert!(
            !overflows(&v),
            "the shipped roster overflows the 600x338 design box"
        );
        // …and it fits with the sheet INSIDE the box rather than clamped to it,
        // which is the difference between "fits" and "was cut down to size".
        assert!(
            content_height(&v) <= 338.0 - GRID * 2.0,
            "the sheet wants {} of the 322 the design box can give it",
            content_height(&v)
        );
    }

    /// A counter with more rows than the WINDOW, not merely more than the
    /// region. See [`nothing_paints_below_the_plate_when_the_counter_is_taller_than_its_box`]
    /// for why the distinction is the whole test.
    fn flooded_view() -> ArmoryView {
        let mut v = tall_view();
        let extra: Vec<StyleRow> = (0..8)
            .map(|i| StyleRow {
                label: format!("Spare Plate {i}"),
                blurb: "a set that exists to overrun the box".into(),
                price: 750,
                owned: false,
                worn: false,
                affordable: true,
                swatch: 0x8a7d6b,
            })
            .collect();
        v.styles.extend(extra);
        v
    }

    /// THE DEFECT THE PLAYER SCREENSHOTTED. `content_height` sized the sheet
    /// from the counts, `sheet()` clamped that to the screen, and the rows kept
    /// painting past the clamped plate — off the bottom of the window, over the
    /// room. Every layout test passed, because they all assert where rows are
    /// and none asked whether the last one is on the plate.
    ///
    /// ⚠️ THE FIXTURE HAD TO GROW WHEN THE METRICS SHRANK. At the old 34px
    /// rows, five sets overran the window and this saw it. At 22px they overrun
    /// the REGION by 18px and stop well inside the plate — so the same fixture
    /// would have gone on passing with the clip deleted, which is a test that
    /// has quietly stopped testing. `flooded_view` is 13 sets: unclipped it
    /// paints to y≈470 in a 338-tall window, so pulling `begin_scroll` out
    /// turns this red. Verified by doing exactly that.
    #[test]
    fn nothing_paints_below_the_plate_when_the_counter_is_taller_than_its_box() {
        let v = flooded_view();
        assert!(
            overflows(&v),
            "the fixture fits, so this test cannot see the defect"
        );
        let p = paint_view(&v, 0, &mut 0.0);

        // The sheet is centred and clamped to `h - GRID*2`, so with overflow it
        // is 322 tall at y=8 and everything below y=330 is scrim.
        let sheet_bottom = 338 - 8;
        let mut below = std::collections::BTreeSet::new();
        for y in (sheet_bottom + 1)..338 {
            for x in 0..600 {
                let px = p.pixel(x, y);
                below.insert((px.r, px.g, px.b, px.a));
            }
        }
        assert_eq!(
            below.len(),
            1,
            "{} distinct colours below the plate — content is painting off the sheet",
            below.len()
        );
    }

    /// The region has to MOVE, or clipping it just hides the rows instead of
    /// letting the pad reach them: the D-pad walks the ring off the bottom, the
    /// highlight vanishes, and Enter fires a button nobody can see.
    ///
    /// Focus 0 is the first plate row (top of the region) and the last focusable
    /// is the final set's button, far below the fold.
    #[test]
    fn the_region_follows_the_focus_cursor_past_the_fold() {
        let v = tall_view();
        let mut top = 0.0;
        paint_view(&v, 0, &mut top);
        assert_eq!(top, 0.0, "the first row needs no scroll");

        // 3 plate + repair = 4 focusables before the sets; the last set's
        // button is the final one.
        let mut bottom = 0.0;
        paint_view(&v, last_focus(&v), &mut bottom);
        assert!(
            bottom > 0.0,
            "focus walked below the fold and the region did not follow it"
        );
    }

    /// …and it must not run past the end. `begin_scroll` clamps to
    /// `content - view`; a region that scrolls into void shows a blank sheet
    /// with a scrollbar thumb sized for content that is not there.
    #[test]
    fn the_region_cannot_scroll_past_its_content() {
        let v = tall_view();
        let mut wild = 10_000.0;
        paint_view(&v, 0, &mut wild);

        // The reference is BEHAVIOURAL, not a second copy of the layout:
        // parking the cursor on the last button scrolls the minimum that brings
        // the bottom of the content into view, which is the maximum offset the
        // region has any business holding. A clamp is right if 10,000 lands
        // within a row of that; it is broken if it lands anywhere near 10,000.
        let mut bottom = 0.0;
        paint_view(&v, last_focus(&v), &mut bottom);
        assert!(bottom > 0.0, "a fixture that overflows must scroll at all");
        assert!(
            wild <= bottom + STYLE_ROW_H,
            "clamped to {wild}, and the end of the content is {bottom}"
        );
    }

    /// THE SECOND THING THE PLAYER REPORTED: *"we still don't see all the
    /// armors."* Every row was on the plate and the gear was a flat square.
    ///
    /// Driven by DIFFERENCE rather than by sampling a hard-coded chip: paint
    /// the counter once with the real ids and once with ids nothing is baked
    /// for, and the two frames must not be the same picture. A coordinate probe
    /// would re-derive the layout (and go stale with it); this asks the only
    /// question that matters — is the gear on the sheet, or is it the fallback?
    #[test]
    fn the_plate_rows_paint_the_gear_and_not_a_hole() {
        let real = paint_view(&shipped_view(), 0, &mut 0.0);
        let mut blank = shipped_view();
        for row in &mut blank.plate {
            row.icon = "no-such-item".into();
        }
        let fallback = paint_view(&blank, 0, &mut 0.0);
        assert_ne!(
            real.digest(),
            fallback.digest(),
            "the counter paints the same thing with and without an icon id — \
             the gear is not being drawn"
        );
        // …and the icons are the game's own art, not a tint: the helmet chip
        // has to carry more than the two tones a well and its edge can make.
        for id in ["helmet", "armor", "boots"] {
            assert!(
                crate::icons::icon(id).is_some(),
                "no baked icon for {id} — the fixture above proves nothing"
            );
        }
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
