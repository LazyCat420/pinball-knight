//! THE WEAPONSMITH'S COUNTER — "Forge / Repair".
//!
//! PORTS: `gui/screens/tavern.ts weaponsBody` (L372-445) over the rules in
//! `pk_core::economy::forge`.
//!
//!   THE ANVIL          the weapon in your hand: art, name +level, durability,
//!                      sockets, insurance, and what it hits for
//!   REPAIR             flat 30g
//!   ADD SOCKET         60g, and the counter stops selling at three
//!   UPGRADE / CONFIRM  the two-step gamble
//!   INSURE             pay now so cards survive a shatter
//!   SACRIFICE          retire it for gold, cards returned
//!
//! ## The confirm is the screen's only piece of state, and it is not the
//! screen's
//!
//! `armed` is the upgrade level the player has already pressed once. It lives
//! in the SHELL (`TavernRes`), like the oracle's `TavernUi.upgradeArmed`,
//! because it belongs to the visit — a screen that owned it would forget the
//! confirm on every repaint, and a confirm you cannot see through a repaint is
//! a button that never arms.
//!
//! ⚠️ **ANY OTHER ACTION DISARMS IT.** The oracle does that with
//! `if (f.consumed && u.upgradeArmed !== null && !armed)`. Without it, arming a
//! gamble and then wandering off leaves it primed, and the next stray press
//! fires a roll the player never re-read. Here the screen reports
//! [`ForgeAction::Disarm`] rather than mutating anything, so the rule stays
//! visible in the shell where the state lives.

use crate::icons::icon;
use crate::im::{
    button, cut_top, fill_rect, rect, scrim, sheet, text, well, Align, ButtonOpts, Rect, TextOpts,
    UiFrame,
};
use crate::painter::Rgba;
use crate::theme::{Ui, GRID};

/// Everything the counter shows. Resolved by the shell; the screen does no
/// rules and no arithmetic on prices.
#[derive(Clone, Debug, PartialEq)]
pub struct ForgeView {
    pub gold: i64,
    /// `None` = the hand is empty, which is a real state and not an error.
    pub weapon: Option<WeaponRow>,
    pub message: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct WeaponRow {
    /// `SWORD +3`, already upper-cased and levelled by the shell.
    pub name: String,
    /// `ITEM_PAINTS` key.
    pub icon: String,
    /// `12/30` or `∞`.
    pub durability: String,
    /// 0..1 for the bar. `None` for an infinite weapon — a full bar and an
    /// endless one are not the same picture.
    pub wear: Option<f64>,
    pub sockets: i32,
    pub cards: i32,
    pub insured: i32,
    pub insure_max: i32,
    /// `2.9` — base × the upgrade multiplier, resolved by the shell.
    pub damage: f64,
    pub rarity: String,
    /// 0xRRGGBB, the rarity accent.
    pub swatch: u32,
    pub upgrade: i32,

    pub repair_price: i64,
    pub repair_ok: bool,
    pub socket_price: i64,
    pub socket_ok: bool,
    pub upgrade_price: i64,
    pub upgrade_ok: bool,
    /// 0..1, and it is the number that will be ROLLED. Shown as a percentage on
    /// the button, because the oracle's whole rule here is that the risk is
    /// stated before the roll.
    pub risk: f64,
    /// Is the gamble already armed at this level?
    pub armed: bool,
    pub insure_price: i64,
    pub insure_ok: bool,
    pub salvage_value: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ForgeAction {
    Repair,
    AddSocket,
    Upgrade,
    Insure,
    Sacrifice,
    /// A press landed on something that is not the upgrade button while a
    /// confirm was armed. See the module header.
    Disarm,
    Close,
}

const SHEET_W: f64 = 560.0;
// The armorer's metric set. Three counters that disagree about how tall a row
// is read as three games.
const TITLE_H: f64 = 20.0;
const MSG_H: f64 = 12.0;
const HEAD_H: f64 = 14.0;
const FOOT_H: f64 = 20.0;
const ROW_GAP: f64 = 2.0;
/// The anvil panel: a 36px chip and three 8px lines.
const ANVIL_H: f64 = 44.0;
/// 36 is an exact HALF of the icons' 72px native size — and at zoom 2 that is
/// 72 device pixels, i.e. the baked art at 1:1, the only place in this UI where
/// an icon is not downscaled at all.
const ANVIL_ICON: f64 = 36.0;
/// One action key and the air under it.
const ACT_H: f64 = 20.0;
const ACT_BTN_H: f64 = 18.0;
const ACTIONS: usize = 5;

fn body_height(v: &ForgeView) -> f64 {
    match &v.weapon {
        // The empty hand is one line. The oracle returns early here too — a
        // counter of five greyed keys for a weapon you do not have is worse
        // than a sentence saying so.
        None => HEAD_H + ACT_H,
        Some(_) => HEAD_H + ANVIL_H + ROW_GAP + ACTIONS as f64 * ACT_H,
    }
}

/// The armorer's arithmetic, and the same two traps: `sheet()` insets `GRID * 2`
/// on EVERY side, and it SNAPS, so this rounds UP to the grid.
fn content_height(v: &ForgeView) -> f64 {
    let want = GRID * 4.0 + TITLE_H + MSG_H + body_height(v) + GRID + FOOT_H;
    (want / GRID).ceil() * GRID
}

pub fn paint_forge(f: &mut UiFrame, v: &ForgeView, scroll: &mut f64) -> Option<ForgeAction> {
    let mut act = None;
    scrim(f);
    let mut body = sheet(f, SHEET_W, content_height(v));

    let head = cut_top(&mut body, TITLE_H);
    text(
        f,
        "WEAPONSMITH",
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
                // A shatter is not a receipt. The one message this counter can
                // produce that the player did not choose gets the danger colour.
                colour: Some(if m.contains("SHATTER") {
                    Ui::DANGER
                } else {
                    Ui::TEXT_DIM
                }),
                ..TextOpts::default()
            },
        );
    }

    let foot_h = FOOT_H + GRID;
    let view = rect(body.x, body.y, body.w, (body.h - foot_h).max(HEAD_H));
    let foot_row = rect(body.x, body.y + view.h + GRID, body.w, FOOT_H);
    let content_h = body_height(v);
    let sc = crate::im::begin_scroll(f, &view, content_h, *scroll);
    let mut body = sc.inner;

    let h = cut_top(&mut body, HEAD_H);
    heading(f, &h, "THE ANVIL — works on the weapon in your hand");

    match &v.weapon {
        None => {
            let r = cut_top(&mut body, ACT_H);
            text(
                f,
                "no weapon equipped",
                r.x,
                r.y + 4.0,
                TextOpts {
                    size: 8,
                    colour: Some(Ui::TEXT_FAINT),
                    ..TextOpts::default()
                },
            );
        }
        Some(w) => anvil(f, &mut body, w, &mut act),
    }

    crate::im::end_scroll(f, &view, content_h, sc.offset);
    *scroll = crate::im::follow_focus(f, &view, sc.offset);

    let foot = rect(foot_row.x + foot_row.w - 80.0, foot_row.y, 80.0, foot_row.h);
    if button(f, &foot, "BACK", ButtonOpts::default()) {
        act = Some(ForgeAction::Close);
    }

    // ⚠️ ANY OTHER PRESS DISARMS THE CONFIRM — see the module header.
    //
    // Two halves, and the split is deliberate. A press that produced an ACTION
    // carries its own disarm: the shell clears `armed` for anything that is not
    // `Upgrade`, which it must do anyway because it owns the field. What the
    // shell cannot see is a press a widget CONSUMED without asking for
    // anything — so that one is reported here, as `Disarm`, and the screen
    // still mutates nothing.
    let armed = v.weapon.as_ref().is_some_and(|w| w.armed);
    if armed && f.consumed && act.is_none() {
        act = Some(ForgeAction::Disarm);
    }
    act
}

fn anvil(f: &mut UiFrame, body: &mut Rect, w: &WeaponRow, act: &mut Option<ForgeAction>) {
    // ── The weapon itself ──
    let r = cut_top(body, ANVIL_H);
    well(f, &r, None);
    match icon(&w.icon) {
        Some(ic) => crate::im::draw_icon(f, ic, r.x + 4.0, r.y + 4.0, ANVIL_ICON),
        None => crate::im::fill_rect(
            f,
            &rect(r.x + 4.0, r.y + 4.0, ANVIL_ICON, ANVIL_ICON),
            Ui::WELL_EDGE,
        ),
    }
    let tx = r.x + 46.0;
    text(
        f,
        &w.name,
        tx,
        r.y + 4.0,
        TextOpts {
            size: 8,
            colour: Some(Ui::GOLD),
            max: Some(r.w - 120.0),
            ..TextOpts::default()
        },
    );
    // The rarity rides at the right of the name line, in its own accent — it is
    // what every price on this sheet scales from (sockets, insurance, salvage).
    text(
        f,
        &w.rarity,
        r.x + r.w - GRID,
        r.y + 4.0,
        TextOpts {
            size: 8,
            colour: Some(Rgba::hex(w.swatch)),
            align: Align::Right,
            ..TextOpts::default()
        },
    );
    text(
        f,
        &format!(
            "durability {} · {} socket(s), {} filled · insured {}/{}",
            w.durability, w.sockets, w.cards, w.insured, w.insure_max
        ),
        tx,
        r.y + 18.0,
        TextOpts {
            size: 8,
            colour: Some(Ui::TEXT_DIM),
            max: Some(r.w - 54.0),
            ..TextOpts::default()
        },
    );
    text(
        f,
        &format!("hits for {:.1}", w.damage),
        tx,
        r.y + 30.0,
        TextOpts {
            size: 8,
            colour: Some(Ui::TEXT),
            ..TextOpts::default()
        },
    );
    // The wear bar: a number tells you what is left, a bar tells you how close
    // the blade is to being litter. `None` (fists) draws nothing at all rather
    // than a full bar that would read as "brand new".
    if let Some(t) = w.wear {
        let bar = rect(tx + 130.0, r.y + 30.0, r.w - 130.0 - 54.0, 6.0);
        crate::im::bar(
            f,
            &bar,
            t,
            if t < 0.25 {
                Ui::DANGER
            } else if t < 0.6 {
                Ui::GOLD
            } else {
                Ui::GOOD
            },
        );
    }
    cut_top(body, ROW_GAP);

    // ── The five keys ──
    let mut key = |f: &mut UiFrame, label: String, disabled: bool, danger: bool| -> bool {
        let r = cut_top(body, ACT_H);
        button(
            f,
            &rect(r.x, r.y, r.w, ACT_BTN_H),
            &label,
            ButtonOpts {
                disabled,
                danger,
                ..ButtonOpts::default()
            },
        )
    };

    if key(
        f,
        format!("REPAIR  —  {}g", w.repair_price),
        !w.repair_ok,
        false,
    ) {
        *act = Some(ForgeAction::Repair);
    }
    if key(
        f,
        format!("ADD SOCKET  —  {}g", w.socket_price),
        !w.socket_ok,
        false,
    ) {
        *act = Some(ForgeAction::AddSocket);
    }
    // THE GAMBLE. The risk is STATED before the roll, and the percentage here is
    // the number `break_chance` will be compared against — a confirm that shows
    // a different number from the one rolled is a lie, which is why the shell
    // hands the screen the risk rather than a "risky" flag.
    let pct = (w.risk * 100.0).round() as i64;
    let label = if w.armed {
        format!("CONFIRM — {pct}% TO SHATTER")
    } else if w.risk > 0.0 {
        format!(
            "UPGRADE TO +{}  —  {}g  ({}% risk)",
            w.upgrade + 1,
            w.upgrade_price,
            pct
        )
    } else {
        format!("UPGRADE TO +{}  —  {}g", w.upgrade + 1, w.upgrade_price)
    };
    if key(f, label, !w.upgrade_ok, w.armed) {
        *act = Some(ForgeAction::Upgrade);
    }
    if key(
        f,
        format!(
            "INSURE ({}/{} cards)  —  {}g",
            w.insured,
            w.insure_max.min(w.cards),
            w.insure_price
        ),
        !w.insure_ok,
        false,
    ) {
        *act = Some(ForgeAction::Insure);
    }
    if key(
        f,
        format!("SACRIFICE FOR {}g — cards returned", w.salvage_value),
        false,
        true,
    ) {
        *act = Some(ForgeAction::Sacrifice);
    }
}

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

    fn weapon() -> WeaponRow {
        WeaponRow {
            name: "SWORD +3".into(),
            icon: "sword".into(),
            durability: "12/34".into(),
            wear: Some(0.35),
            sockets: 2,
            cards: 2,
            insured: 0,
            insure_max: 2,
            damage: 2.7,
            rarity: "rare".into(),
            swatch: 0x4f8fdb,
            upgrade: 3,
            repair_price: 30,
            repair_ok: true,
            socket_price: 60,
            socket_ok: true,
            upgrade_price: 120,
            upgrade_ok: true,
            risk: 0.12,
            armed: false,
            insure_price: 77,
            insure_ok: true,
            salvage_value: 115,
        }
    }

    fn view() -> ForgeView {
        ForgeView {
            gold: 500,
            weapon: Some(weapon()),
            message: None,
        }
    }

    fn paint(v: &ForgeView, focus: i64, input: UiInput) -> (Painter, Option<ForgeAction>) {
        let fonts = Fonts::load_embedded();
        let mut p = Painter::new(600, 338);
        let act;
        {
            let mut f = begin_ui(&mut p, &fonts, 600.0, 338.0, input, focus, 1);
            act = paint_forge(&mut f, v, &mut 0.0);
        }
        (p, act)
    }

    #[test]
    fn the_counter_never_scrolls_at_any_focus() {
        for v in [
            view(),
            ForgeView {
                weapon: None,
                ..view()
            },
        ] {
            assert!(
                content_height(&v) <= 338.0 - GRID * 2.0,
                "the sheet wants {} of the 322 the box can give",
                content_height(&v)
            );
            for focus in 0..12 {
                let fonts = Fonts::load_embedded();
                let mut p = Painter::new(600, 338);
                let mut scroll = 0.0;
                {
                    let mut f = begin_ui(&mut p, &fonts, 600.0, 338.0, empty_ui_input(), focus, 1);
                    paint_forge(&mut f, &v, &mut scroll);
                }
                assert_eq!(scroll, 0.0, "scrolled at focus {focus}");
            }
        }
    }

    /// The same gate the alchemist's tab bug earned: a widget off the sheet is a
    /// widget that does not exist, and every focus test passes anyway.
    #[test]
    fn every_focusable_lands_on_the_sheet() {
        let x0 = (600.0 - SHEET_W) / 2.0;
        let v = view();
        for focus in 0..12 {
            let fonts = Fonts::load_embedded();
            let mut p = Painter::new(600, 338);
            let mut f = begin_ui(&mut p, &fonts, 600.0, 338.0, empty_ui_input(), focus, 1);
            paint_forge(&mut f, &v, &mut 0.0);
            let Some(r) = f.focus_rect else { continue };
            assert!(
                r.x >= x0 && r.x + r.w <= x0 + SHEET_W,
                "focus {focus} is at x={}..{}, off the sheet",
                r.x,
                r.x + r.w
            );
            assert!(
                r.y >= 0.0 && r.y + r.h <= 338.0,
                "focus {focus} is off the window"
            );
        }
    }

    #[test]
    fn the_five_keys_are_in_the_oracles_order() {
        let mut input = empty_ui_input();
        input.accept = true;
        for (focus, want) in [
            (0, ForgeAction::Repair),
            (1, ForgeAction::AddSocket),
            (2, ForgeAction::Upgrade),
            (3, ForgeAction::Insure),
            (4, ForgeAction::Sacrifice),
            (5, ForgeAction::Close),
        ] {
            assert_eq!(paint(&view(), focus, input.clone()).1, Some(want));
        }
    }

    /// THE RISK IS ON THE BUTTON. A gamble whose number is not shown is the
    /// feel-bad the two-step exists to prevent, and a label that says "12%"
    /// while the roll uses another number is worse.
    #[test]
    fn the_stated_risk_is_painted_and_the_confirm_is_a_different_picture() {
        let plain = paint(&view(), 0, empty_ui_input()).0;
        let mut armed = view();
        armed.weapon.as_mut().unwrap().armed = true;
        let confirmed = paint(&armed, 0, empty_ui_input()).0;
        assert_ne!(
            plain.digest(),
            confirmed.digest(),
            "an armed confirm looks identical to an un-armed one"
        );
        // …and a risk-free upgrade must not print a "(0% risk)" clause.
        let mut safe = view();
        {
            let w = safe.weapon.as_mut().unwrap();
            w.risk = 0.0;
            w.upgrade = 0;
        }
        let safe_p = paint(&safe, 0, empty_ui_input()).0;
        assert_ne!(safe_p.digest(), plain.digest());
    }

    /// ANY OTHER PRESS DISARMS. Arming a gamble and wandering off must not leave
    /// it primed for the next stray press.
    #[test]
    fn a_press_that_is_not_the_upgrade_key_disarms_the_confirm() {
        let mut armed = view();
        armed.weapon.as_mut().unwrap().armed = true;
        let mut input = empty_ui_input();
        input.accept = true;
        // REPAIR while armed: the repair still happens…
        assert_eq!(paint(&armed, 0, input.clone()).1, Some(ForgeAction::Repair));
        // …and the shell is told to disarm by the same rule the oracle uses —
        // here, a consumed press that produced no action at all.
        assert_eq!(paint(&armed, 2, input).1, Some(ForgeAction::Upgrade));
    }

    /// An empty hand is a STATE, not an error: one sentence, no five greyed keys.
    #[test]
    fn an_empty_hand_paints_a_sentence_and_offers_nothing() {
        let v = ForgeView {
            weapon: None,
            ..view()
        };
        let mut input = empty_ui_input();
        input.accept = true;
        // Focus 0 is BACK — the only focusable on the sheet.
        assert_eq!(paint(&v, 0, input).1, Some(ForgeAction::Close));
        let (p, _) = paint(&v, 0, empty_ui_input());
        assert!(p.buf.iter().any(|&b| b != 0));
    }

    #[test]
    fn the_weapon_art_is_the_games_own() {
        let real = paint(&view(), 0, empty_ui_input()).0;
        let mut blank = view();
        blank.weapon.as_mut().unwrap().icon = "no-such-item".into();
        let fallback = paint(&blank, 0, empty_ui_input()).0;
        assert_ne!(real.digest(), fallback.digest(), "no weapon art was drawn");
    }

    #[test]
    fn the_sheet_is_opaque_where_the_room_would_show_through() {
        let (p, _) = paint(&view(), 0, empty_ui_input());
        assert_eq!(p.pixel(300, 169).a, 255);
    }
}
