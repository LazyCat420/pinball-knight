//! THE ALCHEMIST'S COUNTER — "Trade".
//!
//! PORTS: `gui/screens/tavern.ts potionsBody` (L135-208) over the rules in
//! `pk_core::economy::alchemist`. Two tabs, because the oracle has two:
//!
//!   THE SHELF    six potions and the Empty Flask — gold in, bottle out
//!   BREW BOOK    the pouch, and sixteen recipes — monster parts in, bottle out
//!
//! ## The brew book is a GRID, and that is a deliberate departure
//!
//! The oracle lists all sixteen recipes as 32px rows and lets the vendor body
//! scroll. Sixteen rows is 352px of content in a 228px view, and no amount of
//! shrinking closes that: at the 8px atlas floor a two-line row cannot go below
//! 22, so the list alone is 352 and the fold is unavoidable.
//!
//! The standing instruction for this UI is *"keep decreasing the size of the
//! buttons/text until we can fit it without having to scroll"*, so the book is
//! laid out the way a book of sixteen small things wants to be laid out: an
//! 8 × 2 grid of icon tiles, with the SELECTED recipe's materials and its BREW
//! key on one detail strip underneath. Everything is on the plate at once, the
//! whole cost of a brew is legible before you press anything, and the pad walks
//! the grid instead of walking off the bottom of the sheet.
//!
//! What that costs is the per-row materials line for the fifteen recipes you
//! are not looking at. What it buys is a book you can see.
//!
//! ## The pouch is icons, not a sentence
//!
//! `potionsBody` prints `REAGENTS.label xN` joined by spaces, ellipsized at the
//! row width — with a full pouch that is fourteen labels in 528 pixels, i.e. a
//! truncated sentence. The reagents all have baked gem icons (they are ground
//! drops), so the pouch is a strip of chips: gem, count. Same information, and
//! it fits.

use crate::icons::icon;
use crate::im::{
    button, cut_top, fill_rect, focus_ring, focusable, rect, scrim, sheet, stroke_rect, text, well,
    Align, ButtonOpts, Rect, TextOpts, UiFrame,
};
use crate::painter::Rgba;
use crate::theme::{Ui, GRID};

/// Which half of the counter is open. The shell owns it — it is a property of
/// this visit, like the oracle's `TavernUi.alchTab`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AlchTab {
    Shelf,
    Brew,
}

/// One shelf row — a potion the counter sells for gold.
#[derive(Clone, Debug, PartialEq)]
pub struct ShelfRow {
    pub label: String,
    pub blurb: String,
    /// `ITEM_PAINTS` key, for the baked icon.
    pub icon: String,
    pub price: i64,
    pub affordable: bool,
    /// How many are already on the belt — a row that says `x2` is the answer to
    /// "did that purchase land", which a flash message has already scrolled past.
    pub on_belt: i32,
}

/// One pouch chip.
#[derive(Clone, Debug, PartialEq)]
pub struct PouchChip {
    pub icon: String,
    pub count: i32,
    pub swatch: u32,
    pub label: String,
}

/// One recipe tile + its detail strip.
#[derive(Clone, Debug, PartialEq)]
pub struct RecipeRow {
    /// `RECIPES[i].id`, handed back with the action so the shell never has to
    /// re-derive which tile was pressed from an index into a filtered list.
    pub id: String,
    pub label: String,
    pub icon: String,
    /// `Slime Gel 1/2  Rotten Flesh 3/1  flask 0/1  40g` — the oracle's own
    /// have/need string, built by the shell because it reads the run's pouch.
    pub needs: String,
    pub craftable: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AlchemistView {
    pub gold: i64,
    pub tab: AlchTab,
    pub shelf: Vec<ShelfRow>,
    pub flask_price: i64,
    pub flask_affordable: bool,
    pub flasks: i32,
    pub pouch: Vec<PouchChip>,
    pub recipes: Vec<RecipeRow>,
    /// Which tile the detail strip is describing.
    pub selected: usize,
    pub message: Option<String>,
}

/// What the player asked for. The screen decides nothing.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AlchemistAction {
    Tab(AlchTab),
    BuyPotion(usize),
    BuyFlask,
    /// A tile was pressed while it was NOT selected — show me this one.
    Select(usize),
    /// The BREW key, or a second press on the selected tile.
    Brew(String),
    Close,
}

const SHEET_W: f64 = 560.0;
// The armorer's metric set, unchanged — two counters that disagree about how
// tall a row is read as two games. See `screens/armory.rs` for why each number
// is what it is; the floor everywhere is the 8px atlas.
const TITLE_H: f64 = 20.0;
const MSG_H: f64 = 12.0;
const HEAD_H: f64 = 14.0;
const HEAD_GAP: f64 = 4.0;
const ROW_H: f64 = 22.0;
const ROW_GAP: f64 = 2.0;
const ICON_PX_ROW: f64 = 18.0;
const BTN_W: f64 = 64.0;
const BTN_H: f64 = 16.0;
const BTN_INSET: f64 = BTN_W + GRID;
const FOOT_H: f64 = 20.0;
const TAB_H: f64 = 18.0;

/// The brew grid: eight across, two down, which is exactly the sixteen the
/// oracle's table holds. A seventeenth recipe lands on a third row — and
/// `content_height` accounts for it, so the sheet grows rather than clipping.
const GRID_COLS: usize = 8;
const TILE_H: f64 = 34.0;
/// The strip that describes the selected tile.
const DETAIL_H: f64 = 30.0;

fn grid_rows(n: usize) -> f64 {
    (n as f64 / GRID_COLS as f64).ceil().max(1.0)
}

/// The part between the message line and BACK, per tab.
fn body_height(v: &AlchemistView) -> f64 {
    let tabs = TAB_H + HEAD_GAP;
    match v.tab {
        AlchTab::Shelf => {
            tabs + HEAD_H + (v.shelf.len() + 1) as f64 * (ROW_H + ROW_GAP) // …+1 for the flask
        }
        AlchTab::Brew => {
            tabs + HEAD_H                                        // POUCH
                + ROW_H                                          // the chip strip
                + HEAD_GAP + HEAD_H                              // RECIPES
                + grid_rows(v.recipes.len()) * (TILE_H + ROW_GAP)
                + HEAD_GAP + DETAIL_H
        }
    }
}

/// How tall the sheet wants to be — the armorer's arithmetic, and the same two
/// traps: `sheet()` insets `GRID * 2` on EVERY side (so `GRID * 4`), and it
/// SNAPS its height, so the answer is rounded UP to the grid.
fn content_height(v: &AlchemistView) -> f64 {
    let want = GRID * 4.0 + TITLE_H + MSG_H + body_height(v) + GRID + FOOT_H;
    (want / GRID).ceil() * GRID
}

pub fn paint_alchemist(
    f: &mut UiFrame,
    v: &AlchemistView,
    scroll: &mut f64,
) -> Option<AlchemistAction> {
    let mut act = None;
    scrim(f);
    let mut body = sheet(f, SHEET_W, content_height(v));

    let head = cut_top(&mut body, TITLE_H);
    text(
        f,
        "ALCHEMIST",
        head.x,
        head.y + 2.0,
        TextOpts {
            size: 16,
            colour: Some(Ui::HEADING),
            ..TextOpts::default()
        },
    );
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

    // The region is kept for the same reason the armorer keeps it: it is what
    // makes a seventeenth recipe a scrollbar instead of a row painted over the
    // room. At the shipped tables it never engages.
    let foot_h = FOOT_H + GRID;
    let view = rect(body.x, body.y, body.w, (body.h - foot_h).max(HEAD_H));
    let foot_row = rect(body.x, body.y + view.h + GRID, body.w, FOOT_H);
    let content_h = body_height(v);
    let sc = crate::im::begin_scroll(f, &view, content_h, *scroll);
    let mut body = sc.inner;

    // ── TABS ──
    let tabs = cut_top(&mut body, TAB_H);
    let half = ((tabs.w - 6.0) / 2.0).floor();
    for (i, (id, label)) in [(AlchTab::Shelf, "THE SHELF"), (AlchTab::Brew, "BREW BOOK")]
        .into_iter()
        .enumerate()
    {
        // ⚠️ THE ROW MUST NOT BE CONSUMED. This laid the tabs out from `tabs.x`
        // AND `cut_left`-ed the row by the same width each pass, so the second
        // tab was placed at `x + 2 * (half + 6)` — off the sheet entirely. The
        // screenshot showed ONE tab and a counter with no way to reach the brew
        // book at all. Index arithmetic OR a cursor; never both.
        let tr = rect(tabs.x + i as f64 * (half + 6.0), tabs.y, half, TAB_H - 2.0);
        let st = focusable(f, &tr, false);
        let on = v.tab == id;
        fill_rect(f, &tr, if on { Ui::SHEET_EDGE } else { Ui::WELL });
        stroke_rect(f, &tr, if on { Ui::GOLD } else { Ui::WELL_EDGE }, 1.0);
        text(
            f,
            label,
            tr.x + tr.w / 2.0,
            tr.y + 4.0,
            TextOpts {
                size: 8,
                colour: Some(if on { Ui::GOLD } else { Ui::TEXT_DIM }),
                align: Align::Center,
                ..TextOpts::default()
            },
        );
        if st.focused {
            focus_ring(f, &tr);
        }
        if st.activated {
            act = Some(AlchemistAction::Tab(id));
        }
    }
    cut_top(&mut body, HEAD_GAP);

    match v.tab {
        AlchTab::Shelf => shelf(f, &mut body, v, &mut act),
        AlchTab::Brew => brew_book(f, &mut body, v, &mut act),
    }

    crate::im::end_scroll(f, &view, content_h, sc.offset);
    *scroll = crate::im::follow_focus(f, &view, sc.offset);

    let foot = rect(foot_row.x + foot_row.w - 80.0, foot_row.y, 80.0, foot_row.h);
    if button(f, &foot, "BACK", ButtonOpts::default()) {
        act = Some(AlchemistAction::Close);
    }
    act
}

fn shelf(f: &mut UiFrame, body: &mut Rect, v: &AlchemistView, act: &mut Option<AlchemistAction>) {
    let h = cut_top(body, HEAD_H);
    heading(f, &h, "SHELF — potions go straight to the belt");
    for (i, row) in v.shelf.iter().enumerate() {
        let r = cut_top(body, ROW_H);
        well(f, &r, None);
        chip(f, &r, &row.icon);
        // The count rides with the LABEL rather than in its own column: it is
        // an attribute of the bottle, and a column of mostly-blank counts is
        // 40 pixels of nothing on a sheet that has none to spare.
        let label = if row.on_belt > 0 {
            format!("{}  x{}", row.label, row.on_belt)
        } else {
            row.label.clone()
        };
        text(
            f,
            &label,
            r.x + 24.0,
            r.y + 2.0,
            TextOpts {
                size: 8,
                colour: Some(if row.on_belt > 0 { Ui::GOOD } else { Ui::TEXT }),
                max: Some(r.w - BTN_INSET - 28.0),
                ..TextOpts::default()
            },
        );
        text(
            f,
            &row.blurb,
            r.x + 24.0,
            r.y + 12.0,
            TextOpts {
                size: 8,
                colour: Some(Ui::TEXT_DIM),
                max: Some(r.w - BTN_INSET - 28.0),
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
            *act = Some(AlchemistAction::BuyPotion(i));
        }
        cut_top(body, ROW_GAP);
    }

    // The Empty Flask is not a potion and is not in `POTION_STOCK`; it is the
    // catalyst every brew needs, and the oracle gives it its own row under the
    // shelf for that reason.
    let r = cut_top(body, ROW_H);
    well(f, &r, None);
    chip(f, &r, "glass");
    text(
        f,
        &format!("Empty Flask  x{}", v.flasks),
        r.x + 24.0,
        r.y + 2.0,
        TextOpts {
            size: 8,
            colour: Some(Ui::TEXT),
            ..TextOpts::default()
        },
    );
    text(
        f,
        "the catalyst every brew needs",
        r.x + 24.0,
        r.y + 12.0,
        TextOpts {
            size: 8,
            colour: Some(Ui::TEXT_DIM),
            max: Some(r.w - BTN_INSET - 28.0),
            ..TextOpts::default()
        },
    );
    if button(
        f,
        &rect(r.x + r.w - BTN_INSET, r.y + 3.0, BTN_W, BTN_H),
        &format!("{}g", v.flask_price),
        ButtonOpts {
            disabled: !v.flask_affordable,
            ..ButtonOpts::default()
        },
    ) {
        *act = Some(AlchemistAction::BuyFlask);
    }
    cut_top(body, ROW_GAP);
}

fn brew_book(
    f: &mut UiFrame,
    body: &mut Rect,
    v: &AlchemistView,
    act: &mut Option<AlchemistAction>,
) {
    let h = cut_top(body, HEAD_H);
    heading(
        f,
        &h,
        &format!(
            "POUCH — {} flask{}",
            v.flasks,
            if v.flasks == 1 { "" } else { "s" }
        ),
    );
    let strip = cut_top(body, ROW_H);
    if v.pouch.is_empty() {
        text(
            f,
            "no reagents — the pouch fills from what you kill",
            strip.x,
            strip.y + 6.0,
            TextOpts {
                size: 8,
                colour: Some(Ui::TEXT_FAINT),
                ..TextOpts::default()
            },
        );
    } else {
        // Chips, not a sentence: fourteen `Label xN` pairs do not fit in 528px
        // and the oracle's own row ellipsizes them away.
        let w = 38.0;
        for (i, p) in v.pouch.iter().enumerate() {
            let x = strip.x + i as f64 * w;
            if x + w > strip.x + strip.w {
                break;
            }
            match icon(&p.icon) {
                Some(ic) => crate::im::draw_icon(f, ic, x, strip.y + 2.0, ICON_PX_ROW),
                None => fill_rect(
                    f,
                    &rect(x + 4.0, strip.y + 6.0, 10.0, 10.0),
                    Rgba::hex(p.swatch),
                ),
            }
            text(
                f,
                &format!("{}", p.count),
                x + 20.0,
                strip.y + 8.0,
                TextOpts {
                    size: 8,
                    colour: Some(Ui::TEXT),
                    ..TextOpts::default()
                },
            );
        }
    }

    cut_top(body, HEAD_GAP);
    let h = cut_top(body, HEAD_H);
    heading(f, &h, "RECIPES — pick one to see what it takes");

    // ── THE GRID ──
    let cell_w = (body.w / GRID_COLS as f64).floor();
    let mut row_rect = rect(body.x, body.y, body.w, 0.0);
    for (i, r) in v.recipes.iter().enumerate() {
        if i % GRID_COLS == 0 {
            row_rect = cut_top(body, TILE_H);
            cut_top(body, ROW_GAP);
        }
        let col = (i % GRID_COLS) as f64;
        let cell = rect(row_rect.x + col * cell_w, row_rect.y, cell_w - 2.0, TILE_H);
        // A tile is FOCUSABLE even when it cannot be brewed — the whole point
        // of the book is to read what a brew would cost before you can afford
        // it, and a disabled tile the cursor skips is a recipe you cannot look
        // up. `focusable(disabled: false)` with the ACTION gated instead.
        let st = focusable(f, &cell, false);
        let on = i == v.selected;
        if on {
            fill_rect(f, &cell, Ui::SELECT_FACE);
        } else {
            well(f, &cell, None);
        }
        stroke_rect(
            f,
            &cell,
            if on {
                Ui::SELECT_EDGE
            } else if r.craftable {
                Ui::GOOD
            } else {
                Ui::WELL_EDGE
            },
            1.0,
        );
        match icon(&r.icon) {
            Some(ic) => crate::im::draw_icon(
                f,
                ic,
                cell.x + (cell.w - ICON_PX_ROW) / 2.0,
                cell.y + 2.0,
                ICON_PX_ROW,
            ),
            None => fill_rect(
                f,
                &rect(cell.x + (cell.w - 10.0) / 2.0, cell.y + 6.0, 10.0, 10.0),
                Ui::WELL_EDGE,
            ),
        }
        // Two characters of the label under the tile: at 8px a 64px cell holds
        // eight, and eight characters of "Magnet Boots" is a different word.
        // The name belongs to the detail strip; the tile is the picture.
        text(
            f,
            &r.label.chars().take(7).collect::<String>(),
            cell.x + cell.w / 2.0,
            cell.y + TILE_H - 10.0,
            TextOpts {
                size: 8,
                colour: Some(if r.craftable {
                    Ui::TEXT
                } else {
                    Ui::TEXT_FAINT
                }),
                align: Align::Center,
                max: Some(cell.w - 2.0),
            },
        );
        if st.focused {
            focus_ring(f, &cell);
        }
        if st.activated {
            // First press selects, second brews — one key does both, and a tile
            // you have not read cannot be brewed by accident.
            *act = Some(if on {
                AlchemistAction::Brew(r.id.clone())
            } else {
                AlchemistAction::Select(i)
            });
        }
    }

    // ── THE DETAIL STRIP ──
    cut_top(body, HEAD_GAP);
    let d = cut_top(body, DETAIL_H);
    well(f, &d, None);
    let Some(sel) = v.recipes.get(v.selected) else {
        return;
    };
    text(
        f,
        &sel.label,
        d.x + GRID,
        d.y + 4.0,
        TextOpts {
            size: 8,
            colour: Some(Ui::TEXT),
            max: Some(d.w - BTN_INSET - 24.0),
            ..TextOpts::default()
        },
    );
    text(
        f,
        &sel.needs,
        d.x + GRID,
        d.y + 16.0,
        TextOpts {
            size: 8,
            colour: Some(if sel.craftable {
                Ui::TEXT_DIM
            } else {
                Ui::DANGER
            }),
            max: Some(d.w - BTN_INSET - 24.0),
            ..TextOpts::default()
        },
    );
    if button(
        f,
        &rect(d.x + d.w - BTN_INSET, d.y + 7.0, BTN_W, BTN_H),
        "BREW",
        ButtonOpts {
            disabled: !sel.craftable,
            ..ButtonOpts::default()
        },
    ) {
        *act = Some(AlchemistAction::Brew(sel.id.clone()));
    }
}

/// An 18px item chip at the left of a row — the armorer's metric.
fn chip(f: &mut UiFrame, r: &Rect, id: &str) {
    let x = r.x + 2.0;
    let y = r.y + 2.0;
    match icon(id) {
        Some(ic) => crate::im::draw_icon(f, ic, x, y, ICON_PX_ROW),
        None => fill_rect(f, &rect(x, y, ICON_PX_ROW, ICON_PX_ROW), Ui::WELL_EDGE),
    }
}

/// `heading()` — a label with a rule under it, at the compact metric.
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
    fill_rect(f, &rect(r.x, r.y + r.h - 2.0, r.w, 1.0), Ui::SHEET_EDGE_LIT);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::im::{begin_ui, empty_ui_input};
    use crate::painter::Painter;
    use crate::{Fonts, UiInput};

    fn view(tab: AlchTab) -> AlchemistView {
        AlchemistView {
            gold: 500,
            tab,
            shelf: ["Health", "Rage", "Haste", "Shield", "Freeze", "Ball Form"]
                .iter()
                .enumerate()
                .map(|(i, l)| ShelfRow {
                    label: (*l).into(),
                    blurb: "restores 3 hearts".into(),
                    icon: ["health", "rage", "haste", "shield", "freeze", "ballform"][i].into(),
                    price: 15 + i as i64 * 10,
                    affordable: true,
                    on_belt: 0,
                })
                .collect(),
            flask_price: 8,
            flask_affordable: true,
            flasks: 2,
            pouch: vec![PouchChip {
                icon: "slimegel".into(),
                count: 3,
                swatch: 0x7bd47b,
                label: "Slime Gel".into(),
            }],
            recipes: (0..16)
                .map(|i| RecipeRow {
                    id: format!("r{i}"),
                    label: format!("Recipe {i}"),
                    icon: "health".into(),
                    needs: "Slime Gel 3/2  Rotten Flesh 1/1  flask 2/1".into(),
                    craftable: i % 2 == 0,
                })
                .collect(),
            selected: 0,
            message: Some("Health → belt".into()),
        }
    }

    fn paint(v: &AlchemistView, focus: i64, input: UiInput) -> (Painter, Option<AlchemistAction>) {
        let fonts = Fonts::load_embedded();
        let mut p = Painter::new(600, 338);
        let act;
        {
            let mut f = begin_ui(&mut p, &fonts, 600.0, 338.0, input, focus, 1);
            act = paint_alchemist(&mut f, v, &mut 0.0);
        }
        (p, act)
    }

    /// THE STANDING INSTRUCTION, PINNED — on BOTH tabs, at every focus index.
    /// The brew book is the reason the grid exists: sixteen 22px rows is 352px
    /// of content in a 228px view, and this is what says so out loud.
    #[test]
    fn neither_tab_ever_scrolls_at_any_focus() {
        for tab in [AlchTab::Shelf, AlchTab::Brew] {
            let v = view(tab);
            assert!(
                content_height(&v) <= 338.0 - GRID * 2.0,
                "{tab:?} wants {} of the 322 the design box can give",
                content_height(&v)
            );
            for focus in 0..30 {
                let fonts = Fonts::load_embedded();
                let mut p = Painter::new(600, 338);
                let mut scroll = 0.0;
                {
                    let mut f = begin_ui(&mut p, &fonts, 600.0, 338.0, empty_ui_input(), focus, 1);
                    paint_alchemist(&mut f, &v, &mut scroll);
                }
                assert_eq!(scroll, 0.0, "{tab:?} scrolled at focus {focus}");
            }
        }
    }

    /// THE DEFECT THE SCREENSHOT FOUND AND SEVEN GREEN TESTS DID NOT.
    ///
    /// The tab row was laid out from an index AND advanced with `cut_left`, so
    /// the BREW BOOK tab was placed 266px past where it belonged — off the
    /// sheet, off the window. Every test still passed: `focusable` registers a
    /// widget wherever it is, so focus 1 dutifully reported `Tab(Brew)` for a
    /// button no player could see, and the counter shipped with no way to reach
    /// half of itself.
    ///
    /// A widget's focus rect is where the pad tells the player to look. If it is
    /// off the plate, the widget does not exist. This walks every focus index on
    /// both tabs and asserts the rect is ON the sheet — the general form of the
    /// bug, not a check for this one tab.
    #[test]
    fn every_focusable_lands_on_the_sheet() {
        let x0 = (600.0 - SHEET_W) / 2.0;
        let x1 = x0 + SHEET_W;
        for tab in [AlchTab::Shelf, AlchTab::Brew] {
            let v = view(tab);
            for focus in 0..30 {
                let fonts = Fonts::load_embedded();
                let mut p = Painter::new(600, 338);
                let mut f = begin_ui(&mut p, &fonts, 600.0, 338.0, empty_ui_input(), focus, 1);
                paint_alchemist(&mut f, &v, &mut 0.0);
                // `focusable` returns EARLY for a disabled widget, before it
                // records the rect — so `None` here is "nothing focusable at
                // this index, or it is greyed", not a failure.
                let Some(r) = f.focus_rect else { continue };
                assert!(
                    r.x >= x0 && r.x + r.w <= x1,
                    "{tab:?} focus {focus} is at x={}..{} — outside the sheet ({x0}..{x1})",
                    r.x,
                    r.x + r.w
                );
                assert!(
                    r.y >= 0.0 && r.y + r.h <= 338.0,
                    "{tab:?} focus {focus} is off the window vertically"
                );
            }
        }
    }

    #[test]
    fn the_tabs_are_the_first_two_focusables_and_they_switch() {
        let mut input = empty_ui_input();
        input.accept = true;
        assert_eq!(
            paint(&view(AlchTab::Shelf), 0, input.clone()).1,
            Some(AlchemistAction::Tab(AlchTab::Shelf))
        );
        assert_eq!(
            paint(&view(AlchTab::Shelf), 1, input).1,
            Some(AlchemistAction::Tab(AlchTab::Brew))
        );
    }

    #[test]
    fn the_shelf_buys_the_row_the_cursor_is_on() {
        let mut input = empty_ui_input();
        input.accept = true;
        // 2 tabs, then a button per shelf row.
        assert_eq!(
            paint(&view(AlchTab::Shelf), 2, input.clone()).1,
            Some(AlchemistAction::BuyPotion(0))
        );
        assert_eq!(
            paint(&view(AlchTab::Shelf), 4, input.clone()).1,
            Some(AlchemistAction::BuyPotion(2))
        );
        // …and the flask sits after the six.
        assert_eq!(
            paint(&view(AlchTab::Shelf), 8, input).1,
            Some(AlchemistAction::BuyFlask)
        );
    }

    /// FIRST PRESS SELECTS, SECOND BREWS. A tile that brewed on the first press
    /// would spend reagents the player has not seen the cost of — the detail
    /// strip is the only place the materials are written down.
    #[test]
    fn a_tile_selects_before_it_brews() {
        let mut input = empty_ui_input();
        input.accept = true;
        let v = view(AlchTab::Brew);
        // 2 tabs, then the tiles. Tile 0 is selected in this fixture.
        assert_eq!(
            paint(&v, 2, input.clone()).1,
            Some(AlchemistAction::Brew("r0".into())),
            "the selected tile brews"
        );
        assert_eq!(
            paint(&v, 3, input).1,
            Some(AlchemistAction::Select(1)),
            "an unselected tile is a look, not a brew"
        );
    }

    /// An uncraftable recipe must still be READABLE — that is what the book is
    /// for — but its BREW key is dead.
    #[test]
    fn an_uncraftable_recipe_can_be_read_but_not_brewed() {
        let mut v = view(AlchTab::Brew);
        v.selected = 1; // craftable: false in the fixture
        let mut input = empty_ui_input();
        input.accept = true;
        // The last focusable is the detail strip's BREW key: 2 tabs + 16 tiles.
        let (_, act) = paint(&v, 18, input);
        assert_eq!(act, None, "a disabled BREW fired");
    }

    #[test]
    fn the_counter_paints_and_asks_for_nothing_unprompted() {
        for tab in [AlchTab::Shelf, AlchTab::Brew] {
            let (p, act) = paint(&view(tab), 0, empty_ui_input());
            assert_eq!(act, None);
            assert!(p.buf.iter().any(|&b| b != 0), "{tab:?} painted nothing");
            // …and the sheet is opaque where the room would otherwise show.
            assert_eq!(
                p.pixel(300, 169).a,
                255,
                "the middle of the sheet is see-through"
            );
        }
    }

    /// The tiles are the game's own art. Same difference test the armorer uses:
    /// paint with real ids and with unbaked ones, and the pictures must differ.
    #[test]
    fn the_rows_and_tiles_paint_real_icons() {
        for tab in [AlchTab::Shelf, AlchTab::Brew] {
            let real = paint(&view(tab), 0, empty_ui_input()).0;
            let mut blank = view(tab);
            for r in &mut blank.shelf {
                r.icon = "no-such-item".into();
            }
            for r in &mut blank.recipes {
                r.icon = "no-such-item".into();
            }
            for c in &mut blank.pouch {
                c.icon = "no-such-item".into();
            }
            let fallback = paint(&blank, 0, empty_ui_input()).0;
            assert_ne!(real.digest(), fallback.digest(), "{tab:?} draws no icons");
        }
    }
}
