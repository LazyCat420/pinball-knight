//! THE CARD DEALER'S COUNTER — "Cards".
//!
//! PORTS: `gui/screens/tavern.ts cardsBody` (L264-340) over the rules in
//! `pk_core::economy::dealer`, with the art from `crate::cards`.
//!
//!   THE SHELF    three pulls you cannot choose, and a reroll
//!   YOUR CARDS   the sockets on your weapons, and the stash you feed them from
//!
//! ## Why two tabs, when the oracle has one body
//!
//! The oracle stacks shelf → reroll → one row per weapon → stash grid and wraps
//! the lot in `beginScroll`. Measured against this port's 338px vendor box
//! (`cargo run -p pk-gui --example dealer_fit`), that stack is **372px with a
//! single weapon and a single stash row** — it overflows before the stash has a
//! second row, and a 30-card stash alone wants 384px. The standing instruction
//! is not to scroll, so it splits the way the alchemist's did: a buying half and
//! a managing half.
//!
//! ## Three constraints that fixed the layout, none of them negotiable
//!
//! 1. **The cell cannot shrink below 56.** This is the one that decides the
//!    rest. `cards::baked_width` SELECTS a baked tier, it does not scale — a
//!    48px cell asks for 48 (zoom 1) or 96 (zoom 2) and gets the 56 tier both
//!    times, i.e. a 0.86× / 1.71× resample of art whose whole job is carrying a
//!    title and four stat rows. The two-tier bake exists precisely to prevent
//!    that, so shrinking the cell to buy height would spend the thing the bake
//!    was built to protect. 56 and 112 blit 1:1; nothing else does.
//! 2. **Text under a cell is 7 characters.** The atlas floor is 8px and the
//!    face is fixed-width at 8px/char, so a 56px cell holds `125g` or `MYTHIC`
//!    and cannot hold `SPIDER SILK` (88px) or even `LEGENDARY` (72px). Prices go
//!    under cells; names do not go anywhere. The card face already prints its
//!    own name — that is what the 112px tier is FOR.
//! 3. **Sockets are ONE row, not one row per weapon.** Three weapons at three
//!    sockets is nine cells, which is a row's worth, not three rows' worth. The
//!    weapon is named above its group instead of owning a band. That single
//!    change is what brings the managing half inside the budget; one row per
//!    weapon overflows by 128px even with everything else shrunk.
//!
//! With those, the managing half lands at 324 of the 330 the design box can
//! give — and the PAGER rides on the STASH heading line rather than taking a
//! row of its own, because its own row costs 18px and puts it at 344. Six
//! pixels of headroom is thin, which is why `neither_tab_ever_scrolls` pins it.
//!
//! ## What the player loses, and what they get
//!
//! The oracle shows the whole stash at once by scrolling. This shows eight at a
//! time and pages. That is the trade the no-scroll instruction forces, and the
//! pager states it out loud (`STASH (23) — 1/3`) so a card you cannot see reads
//! as "on another page" rather than as "gone".

use crate::cards;
use crate::im::{
    button, cut_top, draw_card, fill_rect, focus_ring, focusable, rect, scrim, sheet, stroke_rect,
    text, well, Align, ButtonOpts, Rect, TextOpts, UiFrame,
};
use crate::theme::{Ui, GRID};

/// Which half of the counter is open. The shell owns it — a property of this
/// visit, like the oracle's `TavernUi` fields.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DealerTab {
    Shelf,
    Sockets,
    Stash,
}

/// One card on the shelf: what it is, and what it costs.
#[derive(Clone, Debug, PartialEq)]
pub struct OfferCell {
    /// The card's BASE id — `cards::face` wants the base, not the instance.
    pub base: String,
    pub shiny: bool,
    /// 2..=10, or 1 for a plain copy. Only drawn from 2, as the oracle does.
    pub level: i32,
    pub price: i64,
    pub affordable: bool,
}

/// One socket on one weapon — filled or empty.
#[derive(Clone, Debug, PartialEq)]
pub struct SocketCell {
    /// `None` = an empty socket, drawn as a `+` well.
    pub card: Option<StashCell>,
}

/// One card in the stash, or in a socket.
#[derive(Clone, Debug, PartialEq)]
pub struct StashCell {
    pub base: String,
    pub shiny: bool,
    pub level: i32,
}

/// A weapon and its sockets. The weapon is a LABEL over a group of cells, not a
/// row of its own — see the header.
#[derive(Clone, Debug, PartialEq)]
pub struct WeaponGroup {
    /// `SWORD`, already upper-cased by the shell. Drawn at 8px, so it is
    /// clipped to the group's width like everything else here.
    pub name: String,
    pub sockets: Vec<SocketCell>,
}

/// Everything the counter shows. The shell resolves it; the screen does no
/// rules and no arithmetic on prices.
#[derive(Clone, Debug, PartialEq)]
pub struct DealerView {
    pub tab: DealerTab,
    pub gold: i64,
    pub offers: Vec<OfferCell>,
    pub reroll_price: i64,
    pub reroll_ok: bool,
    pub weapons: Vec<WeaponGroup>,
    /// The WHOLE stash. The screen pages it; the shell does not pre-slice, so
    /// `picked` and the action indices stay absolute and a page turn cannot
    /// silently re-point them.
    pub stash: Vec<StashCell>,
    /// Which stash card is picked, as an ABSOLUTE index into `stash`.
    pub picked: Option<usize>,
    /// Which page of the stash is showing, 0-based.
    pub page: usize,
    pub message: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DealerAction {
    Tab(DealerTab),
    /// Buy shelf offer `i`.
    Buy(usize),
    RerollShelf,
    /// Pick (or un-pick) stash card `i` — an ABSOLUTE index into `stash`.
    Pick(usize),
    /// Put the picked card into weapon `w`. The rules pick the free socket.
    Socket(usize),
    /// Pull the card out of weapon `w`, socket `s`.
    Unsocket(usize, usize),
    /// Turn to stash page `p`.
    Page(usize),
}

const SHEET_W: f64 = 560.0;
const TITLE_H: f64 = 20.0;
const MSG_H: f64 = 12.0;
const HEAD_H: f64 = 14.0;
const HEAD_GAP: f64 = 4.0;
const FOOT_H: f64 = 20.0;
const TAB_H: f64 = 18.0;

/// The oracle's own cell (`CARD_SLOT_W`), and the ONLY width that blits 1:1.
/// See constraint 1 in the header before changing it.
const CELL_W: f64 = 56.0;
const CELL_GAP: f64 = 6.0;
/// Under a shelf cell: the price line.
const PRICE_H: f64 = 26.0;
/// Under a socket cell: the weapon's name.
const SOCKET_LABEL_H: f64 = 24.0;
/// Under a stash cell: nothing, but the row needs breathing room.
const STASH_PAD_H: f64 = 18.0;
/// The SOCKETS tab's "what you are holding" strip.
const PICKED_H: f64 = 22.0;

fn cell_h() -> f64 {
    f64::from(cards::card_face_height(CELL_W as u32))
}

/// How many cells fit across the sheet's body.
fn per_row(body_w: f64) -> usize {
    (((body_w + CELL_GAP) / (CELL_W + CELL_GAP)).floor() as usize).max(1)
}

/// The stash page size — the same arithmetic the paint uses, so the pager and
/// the grid cannot disagree about what page a card is on.
pub fn stash_per_page(body_w: f64) -> usize {
    per_row(body_w)
}

fn page_count(n: usize, per: usize) -> usize {
    n.div_ceil(per).max(1)
}

/// The part between the message line and BACK, per tab.
fn body_height(v: &DealerView) -> f64 {
    let tabs = TAB_H + HEAD_GAP;
    match v.tab {
        DealerTab::Shelf => {
            tabs + HEAD_H + cell_h() + PRICE_H + HEAD_GAP + 24.0 // the REROLL button
        }
        // ⚠️ ONE CARD ROW PER TAB, and that is the whole reason there are three.
        // A card cell is 78px tall and cannot shrink (constraint 1), so two card
        // rows plus the sheet's own chrome is 344 against a 322 ceiling — it
        // overflows no matter how the padding is spent. Sockets and stash each
        // get a tab instead, and each lands with 90+px spare.
        DealerTab::Sockets => tabs + HEAD_H + cell_h() + SOCKET_LABEL_H + HEAD_GAP + PICKED_H,
        DealerTab::Stash => tabs + HEAD_H + cell_h() + STASH_PAD_H,
    }
}

/// How tall the sheet wants to be — the alchemist's arithmetic, and the same
/// two traps: `sheet()` insets `GRID * 2` on EVERY side (so `GRID * 4`), and it
/// SNAPS its height, so the answer is rounded UP to the grid.
fn content_height(v: &DealerView) -> f64 {
    let want = GRID * 4.0 + TITLE_H + MSG_H + body_height(v) + GRID + FOOT_H;
    (want / GRID).ceil() * GRID
}

pub fn paint_dealer(f: &mut UiFrame, v: &DealerView) -> Option<DealerAction> {
    let mut act = None;
    scrim(f);
    let mut body = sheet(f, SHEET_W, content_height(v));

    let head = cut_top(&mut body, TITLE_H);
    text(
        f,
        "CARD DEALER",
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

    // ── TABS ──
    let tabs = cut_top(&mut body, TAB_H);
    let third = ((tabs.w - 12.0) / 3.0).floor();
    for (i, (id, label)) in [
        (DealerTab::Shelf, "THE SHELF"),
        (DealerTab::Sockets, "SOCKETS"),
        (DealerTab::Stash, "STASH"),
    ]
    .into_iter()
    .enumerate()
    {
        // ⚠️ THE ROW IS NOT CONSUMED — index arithmetic OR a cursor, never both.
        // The alchemist shipped with its second tab 266px off the sheet because
        // it did both, and every test passed: a focusable is registered wherever
        // it is put, so the pad reported a button no player could see.
        let tr = rect(
            tabs.x + i as f64 * (third + 6.0),
            tabs.y,
            third,
            TAB_H - 2.0,
        );
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
            act = Some(DealerAction::Tab(id));
        }
    }
    cut_top(&mut body, HEAD_GAP);

    match v.tab {
        DealerTab::Shelf => shelf(f, &mut body, v, &mut act),
        DealerTab::Sockets => sockets(f, &mut body, v, &mut act),
        DealerTab::Stash => stash(f, &mut body, v, &mut act),
    }
    act
}

fn heading(f: &mut UiFrame, r: &Rect, s: &str) {
    text(
        f,
        s,
        r.x,
        r.y + 2.0,
        TextOpts {
            size: 8,
            colour: Some(Ui::HEADING),
            ..TextOpts::default()
        },
    );
}

/// Draw one card face into `cell`, or a well if nothing was baked for it.
///
/// The width asked for is the cell in DEVICE pixels, so at zoom 2 a 56px cell
/// selects the 112 tier and the blit stays 1:1 — see `cards::baked_width`.
fn card_at(f: &mut UiFrame, cell: &Rect, base: &str, shiny: bool, level: i32) {
    let want = cards::baked_width((CELL_W * f64::from(f.zoom)) as u32);
    match cards::face(base, shiny, want) {
        Some(face) => draw_card(f, face, cell.x, cell.y, CELL_W),
        // A card the dealer can offer and cannot draw is a hole in the shelf.
        // `well` says "a card belongs here and is missing" rather than painting
        // nothing and reading as an empty slot.
        None => well(f, cell, None),
    }
    // ── THE LEVEL SEAL ──
    // Not baked: level moves 0.6% of a 56px face against an 8.2% control for
    // two DIFFERENT cards, so 25 bases × 10 levels would be 500 files to show
    // what a disc can. Drawn only from 2, as the oracle does — "a Lv 1 plate on
    // every common is noise, not information."
    if level > 1 {
        let (cx, cy, r) = cards::level_seal_at(CELL_W as u32);
        let d = (r * 2.0).max(1.0);
        let seal = rect(cell.x + cx - r, cell.y + cy - r, d, d);
        fill_rect(f, &seal, Ui::WELL);
        stroke_rect(f, &seal, Ui::GOLD, 1.0);
    }
}

fn shelf(f: &mut UiFrame, body: &mut Rect, v: &DealerView, act: &mut Option<DealerAction>) {
    let head = cut_top(body, HEAD_H);
    heading(f, &head, "THE SHELF — three pulls, not your choice");

    let row = cut_top(body, cell_h() + PRICE_H);
    if v.offers.is_empty() {
        text(
            f,
            "sold out — reroll the shelf",
            row.x,
            row.y + 8.0,
            TextOpts {
                size: 8,
                colour: Some(Ui::TEXT_FAINT),
                ..TextOpts::default()
            },
        );
    }
    for (i, o) in v.offers.iter().enumerate() {
        let cell = rect(
            row.x + i as f64 * (CELL_W + CELL_GAP),
            row.y,
            CELL_W,
            cell_h(),
        );
        // Focusable even when unaffordable, with the ACTION gated instead: a
        // greyed widget the pad skips is a price the player cannot read.
        let st = focusable(f, &cell, false);
        card_at(f, &cell, &o.base, o.shiny, o.level);
        text(
            f,
            &format!("{}g", o.price),
            cell.x + cell.w / 2.0,
            cell.y + cell.h + 4.0,
            TextOpts {
                size: 8,
                colour: Some(if o.affordable {
                    Ui::HEADING
                } else {
                    Ui::DANGER
                }),
                align: Align::Center,
                ..TextOpts::default()
            },
        );
        if st.focused {
            focus_ring(f, &cell);
        }
        if st.activated && o.affordable {
            *act = Some(DealerAction::Buy(i));
        }
    }

    cut_top(body, HEAD_GAP);
    let rr = cut_top(body, 24.0);
    if button(
        f,
        &rect(rr.x, rr.y, 200.0, 22.0),
        &format!("REROLL SHELF — {}g", v.reroll_price),
        ButtonOpts {
            disabled: !v.reroll_ok,
            ..ButtonOpts::default()
        },
    ) {
        *act = Some(DealerAction::RerollShelf);
    }
}

fn sockets(f: &mut UiFrame, body: &mut Rect, v: &DealerView, act: &mut Option<DealerAction>) {
    let head = cut_top(body, HEAD_H);
    heading(
        f,
        &head,
        "YOUR WEAPONS — pick in STASH, then press a + slot",
    );

    // ── SOCKETS, ALL WEAPONS ON ONE ROW ──
    // The weapon is a label under its group. One row per weapon overflows the
    // box by 128px; this is the change that makes the tab fit at all.
    let row = cut_top(body, cell_h() + SOCKET_LABEL_H);
    if v.weapons.is_empty() {
        text(
            f,
            "no weapons — nothing to socket into",
            row.x,
            row.y + 8.0,
            TextOpts {
                size: 8,
                colour: Some(Ui::TEXT_FAINT),
                ..TextOpts::default()
            },
        );
    }
    let mut cx = row.x;
    for (wi, w) in v.weapons.iter().enumerate() {
        let group_x = cx;
        for (si, s) in w.sockets.iter().enumerate() {
            let cell = rect(cx, row.y, CELL_W, cell_h());
            let st = focusable(f, &cell, false);
            match &s.card {
                Some(c) => {
                    card_at(f, &cell, &c.base, c.shiny, c.level);
                    if st.activated {
                        *act = Some(DealerAction::Unsocket(wi, si));
                    }
                }
                None => {
                    well(f, &cell, None);
                    text(
                        f,
                        "+",
                        cell.x + cell.w / 2.0,
                        cell.y + cell.h / 2.0 - 8.0,
                        TextOpts {
                            size: 16,
                            colour: Some(Ui::TEXT_FAINT),
                            align: Align::Center,
                            ..TextOpts::default()
                        },
                    );
                    if st.activated {
                        // The screen does not know whether a card is picked —
                        // the shell does, and it says "pick a stash card first".
                        *act = Some(DealerAction::Socket(wi));
                    }
                }
            }
            if st.focused {
                focus_ring(f, &cell);
            }
            cx += CELL_W + CELL_GAP;
        }
        // The weapon's name under its own group, centred on it. Clipped to the
        // group width — at 8px/char a 3-socket group holds 23 characters and a
        // 1-socket group holds 7, so a long name is cut, not overlapped.
        let group_w = (cx - CELL_GAP - group_x).max(CELL_W);
        text(
            f,
            &w.name,
            group_x + group_w / 2.0,
            row.y + cell_h() + 4.0,
            TextOpts {
                size: 8,
                colour: Some(Ui::GOLD),
                align: Align::Center,
                max: Some(group_w),
            },
        );
        // A gap between weapons, so two weapons' sockets do not read as one bank.
        cx += CELL_GAP;
    }

    cut_top(body, HEAD_GAP);

    // ── WHAT YOU ARE HOLDING ──
    // The socket tab and the stash tab are separate plates, so without this the
    // player presses `+` on one screen having chosen a card on another and has
    // to trust their memory. One line, naming the pick, is what makes the two
    // tabs read as one counter.
    let strip = cut_top(body, PICKED_H);
    match v.picked.and_then(|i| v.stash.get(i)) {
        Some(c) => {
            // ⚠️ NO THUMBNAIL HERE, deliberately. The obvious thing is a small
            // card chip beside the label, and the first cut drew one — as an
            // empty `well`, because the strip is 22px and the smallest baked
            // face is 78px tall. It rendered as a black rectangle that reads as
            // a picture that failed to load. There is no tier this size and
            // scaling one is exactly what the two-tier bake forbids, so the
            // line carries the pick in words and nothing pretends to be art.
            let level = if c.level > 1 {
                format!(" Lv{}", c.level)
            } else {
                String::new()
            };
            let shine = if c.shiny { " *" } else { "" };
            text(
                f,
                &format!("HOLDING: {}{level}{shine}", c.base.to_uppercase()),
                strip.x,
                strip.y + 6.0,
                TextOpts {
                    size: 8,
                    colour: Some(Ui::GOLD),
                    max: Some(strip.w),
                    ..TextOpts::default()
                },
            );
        }
        None => {
            text(
                f,
                "holding nothing — pick a card on the STASH tab",
                strip.x,
                strip.y + 6.0,
                TextOpts {
                    size: 8,
                    colour: Some(Ui::TEXT_FAINT),
                    ..TextOpts::default()
                },
            );
        }
    }
}

fn stash(f: &mut UiFrame, body: &mut Rect, v: &DealerView, act: &mut Option<DealerAction>) {
    // ── THE STASH, PAGED ──
    // One row of eight. Two rows is 320 of the 322 the box can give, and two
    // pixels of headroom is not a budget — the pager buys the rest of the
    // stash for one line that shares the heading's row.
    let per = per_row(body.w);
    let pages = page_count(v.stash.len(), per);
    let page = v.page.min(pages - 1);
    let head = cut_top(body, HEAD_H);
    heading(
        f,
        &head,
        &format!("STASH ({}) — pick, then socket it", v.stash.len()),
    );
    if pages > 1 {
        let counter = format!("{}/{}", page + 1, pages);
        let cw = 12.0;
        let cx_right = head.x + head.w;
        let next = rect(cx_right - cw, head.y, cw, HEAD_H - 2.0);
        let prev = rect(cx_right - cw * 2.0 - 44.0, head.y, cw, HEAD_H - 2.0);
        let label = rect(prev.x + cw + 2.0, head.y, 42.0, HEAD_H - 2.0);
        text(
            f,
            &counter,
            label.x + label.w / 2.0,
            label.y + 2.0,
            TextOpts {
                size: 8,
                colour: Some(Ui::TEXT_DIM),
                align: Align::Center,
                ..TextOpts::default()
            },
        );
        for (r, to, glyph) in [
            (prev, page.saturating_sub(1), "<"),
            (next, (page + 1).min(pages - 1), ">"),
        ] {
            let st = focusable(f, &r, false);
            text(
                f,
                glyph,
                r.x + r.w / 2.0,
                r.y + 2.0,
                TextOpts {
                    size: 8,
                    colour: Some(if to == page {
                        Ui::TEXT_FAINT
                    } else {
                        Ui::HEADING
                    }),
                    align: Align::Center,
                    ..TextOpts::default()
                },
            );
            if st.focused {
                focus_ring(f, &r);
            }
            if st.activated && to != page {
                *act = Some(DealerAction::Page(to));
            }
        }
    }

    let row = cut_top(body, cell_h() + STASH_PAD_H);
    if v.stash.is_empty() {
        text(
            f,
            "no cards — buy one from the shelf",
            row.x,
            row.y + 8.0,
            TextOpts {
                size: 8,
                colour: Some(Ui::TEXT_FAINT),
                ..TextOpts::default()
            },
        );
    }
    let start = page * per;
    for (col, i) in (start..(start + per).min(v.stash.len())).enumerate() {
        let c = &v.stash[i];
        let cell = rect(
            row.x + col as f64 * (CELL_W + CELL_GAP),
            row.y,
            CELL_W,
            cell_h(),
        );
        let st = focusable(f, &cell, false);
        card_at(f, &cell, &c.base, c.shiny, c.level);
        // The picked card wears the oracle's gold ring.
        if v.picked == Some(i) {
            stroke_rect(
                f,
                &rect(cell.x - 1.0, cell.y - 1.0, cell.w + 2.0, cell.h + 2.0),
                Ui::GOLD,
                2.0,
            );
        }
        if st.focused {
            focus_ring(f, &cell);
        }
        if st.activated {
            // The ABSOLUTE index, not the column: a page turn must not re-point
            // what the player picked.
            *act = Some(DealerAction::Pick(i));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::font::Fonts;
    use crate::im::{begin_ui, empty_ui_input, UiInput};
    use crate::painter::Painter;

    fn card(base: &str) -> StashCell {
        StashCell {
            base: base.into(),
            shiny: false,
            level: 1,
        }
    }

    fn view(tab: DealerTab) -> DealerView {
        DealerView {
            tab,
            gold: 1200,
            offers: vec![
                OfferCell {
                    base: "spidersilk".into(),
                    shiny: false,
                    level: 1,
                    price: 30,
                    affordable: true,
                },
                OfferCell {
                    base: "goblintooth".into(),
                    shiny: true,
                    level: 4,
                    price: 80,
                    affordable: true,
                },
                OfferCell {
                    base: "worldbreaker".into(),
                    shiny: false,
                    level: 1,
                    price: 5000,
                    affordable: false,
                },
            ],
            reroll_price: 15,
            reroll_ok: true,
            weapons: vec![
                WeaponGroup {
                    name: "SWORD".into(),
                    sockets: vec![
                        SocketCell {
                            card: Some(card("spidersilk")),
                        },
                        SocketCell { card: None },
                    ],
                },
                WeaponGroup {
                    name: "BOW".into(),
                    sockets: vec![SocketCell { card: None }],
                },
            ],
            stash: (0..23).map(|_| card("wispspark")).collect(),
            picked: Some(2),
            page: 0,
            message: None,
        }
    }

    fn paint(v: &DealerView, focus: i64, input: UiInput) -> (Painter, Option<DealerAction>) {
        let fonts = Fonts::load_embedded();
        let mut p = Painter::new(600, 338);
        let act;
        {
            let mut f = begin_ui(&mut p, &fonts, 600.0, 338.0, input, focus, 1);
            act = paint_dealer(&mut f, v);
        }
        (p, act)
    }

    /// THE STANDING INSTRUCTION, PINNED — on BOTH tabs, at the WORST case.
    ///
    /// This is the test the whole layout was designed against, and it is why
    /// the sockets are one row and the pager rides the heading line. One row
    /// per weapon overflows by 128px; a pager on its own row puts the managing
    /// tab at 344 of the 330 available.
    #[test]
    fn neither_tab_ever_fits_worse_than_the_design_box() {
        for tab in [DealerTab::Shelf, DealerTab::Sockets, DealerTab::Stash] {
            let mut v = view(tab);
            // The worst case the rules allow: three weapons at three sockets.
            v.weapons = (0..3)
                .map(|_| WeaponGroup {
                    name: "GREATSWORD".into(),
                    sockets: (0..3).map(|_| SocketCell { card: None }).collect(),
                })
                .collect();
            assert!(
                content_height(&v) <= 338.0 - GRID * 2.0,
                "{tab:?} wants {} of the {} the design box can give",
                content_height(&v),
                338.0 - GRID * 2.0
            );
        }
    }

    /// A widget's focus rect is where the pad tells the player to look. If it
    /// is off the plate, the widget does not exist — the alchemist shipped a
    /// tab 266px off the sheet and seven green tests missed it.
    #[test]
    fn every_focusable_lands_on_the_sheet() {
        let x0 = (600.0 - SHEET_W) / 2.0;
        let x1 = x0 + SHEET_W;
        for tab in [DealerTab::Shelf, DealerTab::Sockets, DealerTab::Stash] {
            let v = view(tab);
            for focus in 0..40 {
                let fonts = Fonts::load_embedded();
                let mut p = Painter::new(600, 338);
                let mut f = begin_ui(&mut p, &fonts, 600.0, 338.0, empty_ui_input(), focus, 1);
                paint_dealer(&mut f, &v);
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
    fn the_tabs_are_the_first_three_focusables_and_they_switch() {
        let mut input = empty_ui_input();
        input.accept = true;
        assert_eq!(
            paint(&view(DealerTab::Shelf), 0, input.clone()).1,
            Some(DealerAction::Tab(DealerTab::Shelf))
        );
        assert_eq!(
            paint(&view(DealerTab::Shelf), 1, input.clone()).1,
            Some(DealerAction::Tab(DealerTab::Sockets))
        );
        assert_eq!(
            paint(&view(DealerTab::Shelf), 2, input.clone()).1,
            Some(DealerAction::Tab(DealerTab::Stash))
        );
    }

    /// Buying is the shelf's whole job, and the offer index must survive the
    /// three tab focusables in front of it.
    #[test]
    fn the_shelf_buys_the_offer_the_pad_is_on() {
        let mut input = empty_ui_input();
        input.accept = true;
        for (focus, want) in [(3, 0usize), (4, 1)] {
            assert_eq!(
                paint(&view(DealerTab::Shelf), focus, input.clone()).1,
                Some(DealerAction::Buy(want)),
                "focus {focus}"
            );
        }
    }

    /// ⚠️ AN UNAFFORDABLE OFFER IS FOCUSABLE AND MUST NOT BUY.
    ///
    /// It stays focusable on purpose — a price the pad skips is a price the
    /// player cannot read — so the gate is on the ACTION. If this ever reports
    /// `Buy`, the counter spends gold the player does not have and the rules
    /// layer is the only thing standing between that and a negative purse.
    #[test]
    fn an_unaffordable_offer_is_reachable_but_does_not_buy() {
        let mut input = empty_ui_input();
        input.accept = true;
        // Offer 2 is the 5000g worldbreaker against a 1200g purse.
        assert_eq!(paint(&view(DealerTab::Shelf), 5, input).1, None);

        // …and it is REACHABLE: something focusable is there.
        let fonts = Fonts::load_embedded();
        let mut p = Painter::new(600, 338);
        let mut f = begin_ui(&mut p, &fonts, 600.0, 338.0, empty_ui_input(), 5, 1);
        paint_dealer(&mut f, &view(DealerTab::Shelf));
        assert!(
            f.focus_rect.is_some(),
            "the unaffordable offer is not focusable"
        );
    }

    /// The picked index is ABSOLUTE. A page turn must not re-point it — page 2
    /// column 0 is stash card 8, not stash card 0.
    #[test]
    fn a_stash_pick_reports_its_absolute_index() {
        let mut input = empty_ui_input();
        input.accept = true;
        let mut v = view(DealerTab::Stash);
        let per = per_row(SHEET_W - GRID * 4.0);

        // 3 tabs + 2 pager keys ⇒ the first stash cell is focus 5.
        let first_stash = 5;
        assert_eq!(
            paint(&v, first_stash, input.clone()).1,
            Some(DealerAction::Pick(0))
        );
        v.page = 1;
        assert_eq!(
            paint(&v, first_stash, input.clone()).1,
            Some(DealerAction::Pick(per)),
            "page 1 column 0 must be stash card {per}, not 0"
        );
    }

    /// The pager only appears when there is more than one page, and a 23-card
    /// stash at 8 per page is three of them.
    #[test]
    fn the_pager_counts_the_pages_it_can_reach() {
        let per = per_row(SHEET_W - GRID * 4.0);
        assert_eq!(per, 8, "the sheet's body holds 8 cells at 56+6");
        assert_eq!(page_count(23, per), 3);
        assert_eq!(page_count(8, per), 1);
        assert_eq!(page_count(0, per), 1, "an empty stash is still one page");

        // With one page there are no pager keys, so the first stash cell moves
        // up by two focus indices.
        let mut v = view(DealerTab::Stash);
        v.stash = vec![card("wispspark")];
        let mut input = empty_ui_input();
        input.accept = true;
        assert_eq!(paint(&v, 3, input).1, Some(DealerAction::Pick(0)));
    }

    /// A page beyond the end must clamp rather than paint an empty grid — the
    /// stash shrinks every time a card is socketed, and the shell's `page` can
    /// outlive the cards that justified it.
    #[test]
    fn a_page_past_the_end_clamps_instead_of_emptying() {
        let mut v = view(DealerTab::Stash);
        v.page = 99;
        let mut input = empty_ui_input();
        input.accept = true;
        // 23 cards, 8 per page ⇒ last page is 2, holding cards 16..23.
        assert_eq!(
            paint(&v, 5, input).1,
            Some(DealerAction::Pick(16)),
            "page 99 must clamp to the last real page"
        );
    }

    /// An empty socket asks the SHELL to socket; a full one unsockets. The
    /// screen does not know whether a card is picked.
    #[test]
    fn sockets_fill_and_empty_from_the_same_row() {
        let mut input = empty_ui_input();
        input.accept = true;
        let v = view(DealerTab::Sockets);
        // 3 tabs, then the sword's two sockets, then the bow's one.
        assert_eq!(
            paint(&v, 3, input.clone()).1,
            Some(DealerAction::Unsocket(0, 0)),
            "the sword's filled socket"
        );
        assert_eq!(
            paint(&v, 4, input.clone()).1,
            Some(DealerAction::Socket(0)),
            "the sword's empty socket"
        );
        assert_eq!(
            paint(&v, 5, input).1,
            Some(DealerAction::Socket(1)),
            "the bow's empty socket"
        );
    }

    /// ⚠️ EVERY CHARACTER THIS SCREEN CAN DRAW MUST BE IN THE ATLAS.
    ///
    /// A glyph the bake does not ship draws NOTHING — no tofu box, no warning,
    /// no failed test. The shiny marker was written as `✦` and would have
    /// shipped as a silent gap: `Fonts::measure` returns the monospace advance
    /// for a missing glyph, so even measuring it looks right. `*` is in the
    /// 100-character set; `✦` and `★` are not.
    ///
    /// This walks the literal text this module can emit, so a future label that
    /// reaches for a nicer bullet fails here instead of on a player's screen.
    #[test]
    fn every_glyph_this_screen_draws_is_in_the_atlas() {
        let fonts = Fonts::load_embedded();
        let atlas = fonts.atlas(8).expect("the 8px atlas is the text floor");
        // The fixed strings, plus the shapes the format!s can produce.
        let mut sources: Vec<String> = vec![
            "CARD DEALER".into(),
            "THE SHELF".into(),
            "SOCKETS".into(),
            "STASH".into(),
            "THE SHELF — three pulls, not your choice".into(),
            "sold out — reroll the shelf".into(),
            "YOUR WEAPONS — pick in STASH, then press a + slot".into(),
            "no weapons — nothing to socket into".into(),
            "holding nothing — pick a card on the STASH tab".into(),
            "no cards — buy one from the shelf".into(),
            "+".into(),
            "<".into(),
            ">".into(),
        ];
        let v = view(DealerTab::Stash);
        sources.push(format!("{}g", v.gold));
        sources.push(format!("REROLL SHELF — {}g", v.reroll_price));
        sources.push(format!("STASH ({}) — pick, then socket it", v.stash.len()));
        sources.push(format!("{}/{}", 1, 3));
        sources.push(format!("HOLDING: {}{}{}", "NECROSIGIL", " Lv7", " *"));
        for w in &v.weapons {
            sources.push(w.name.clone());
        }

        for s in sources {
            for ch in s.chars() {
                assert!(
                    atlas.glyph(ch).is_some(),
                    "{ch:?} (in {s:?}) is not in the baked charset — it would draw NOTHING"
                );
            }
        }
    }

    /// Every card the counter can show must have baked art, or the shelf is a
    /// row of wells. This is the reading half of the bake's drift gate.
    #[test]
    fn every_offer_and_stash_card_has_a_face() {
        let v = view(DealerTab::Stash);
        let want = cards::baked_width(CELL_W as u32);
        for o in &v.offers {
            assert!(
                cards::face(&o.base, o.shiny, want).is_some(),
                "no face for offer {}",
                o.base
            );
        }
        for c in &v.stash {
            assert!(cards::face(&c.base, c.shiny, want).is_some());
        }
    }
}
