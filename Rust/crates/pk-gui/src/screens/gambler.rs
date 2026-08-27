//! THE GAMBLER'S CABINET — "Risk Gold".
//!
//! PORTS: `legacy/src/scenes/tavern/gambler/index.ts` — the cabinet SHELL —
//! over the rules in `pk_core::gambler`, which are complete and carry 250
//! tests of their own.
//!
//!   SLOTS      three weighted reels, stop them or let them fall
//!   ROULETTE   pick a bet, spin the wheel
//!   DARTS      three darts, a moving cursor, a payout band
//!   BLACKJACK  hit, stand, double
//!
//! ## The split this screen must not break
//!
//! The oracle's header states the rule and the reason: *"The shell owns
//! everything about MONEY — it is the only caller of `table.ts`, which is in
//! turn the only thing that touches the wallet — and the games own only their
//! own outcome. A game can be wrong about its animation and it's a cosmetic
//! bug, but a game that could move gold directly would be able to bypass the
//! stake caps and the per-visit round limit."*
//!
//! This port keeps that and pushes it one step further: the SCREEN cannot
//! reach the wallet either. It paints a [`GamblerView`] and reports a
//! [`GamblerAction`]; the tavern shell is the only thing that calls
//! `pk_core::gambler::table`. So the caps live in one place, and a layout
//! mistake here cannot become an economic one.
//!
//! ## Why the game area is 130px and not the oracle's 200
//!
//! The oracle's cabinet is a DOM overlay with its own `requestAnimationFrame`
//! and a 520×200 canvas. This port's vendor box gives 322px of sheet, and the
//! cabinet also needs a picker, a stake row and a control row: at 200 it wants
//! 360 and overflows by 38. At 130 it lands at 296 with 26 spare. What that
//! costs is vertical room in the games' own art — a shorter wheel, a shorter
//! board — and the alternative was the counter not fitting at all.
//!
//! ## The games draw through a PAINT LIST, not a canvas
//!
//! The oracle hands each game a `CanvasRenderingContext2D` and lets it paint.
//! There is no such context here, and handing the screen a painter per game
//! would put four animation loops inside a module whose whole job is layout.
//! Instead the shell resolves the current frame into a [`GamePaint`] — a small
//! list of primitives — and this draws it. The games stay in `pk_core` where
//! their tests are, and this file stays a layout.

use crate::im::{
    blit_pixmap, button, cut_top, fill_rect, focus_ring, focusable, rect, scrim, sheet,
    stroke_rect, text, well, Align, ButtonOpts, Rect, TextOpts, UiFrame,
};
use crate::gambler::pixmap::Pixmap;
use crate::painter::Rgba;
use std::sync::Arc;
use crate::theme::{Ui, GRID};

/// Which game the cabinet is showing. Mirrors `pk_core::gambler::GameId`, kept
/// separate so `pk-gui` stays independent of `pk-core` (see `screens::dealer`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GamblerGame {
    Slots,
    Roulette,
    Darts,
    Blackjack,
}

impl GamblerGame {
    pub const ALL: [GamblerGame; 4] = [
        GamblerGame::Slots,
        GamblerGame::Roulette,
        GamblerGame::Darts,
        GamblerGame::Blackjack,
    ];

    /// ⚠️ `BJACK`, not `BLACKJACK`. Four tabs share 528px, so a tab is 127px
    /// wide and the atlas is fixed-width at 8px/char — `BLACKJACK` is 72px and
    /// fits, but the tab also has to hold a focus ring and 6px of gap, and at
    /// the 2× zoom the counters actually run it is the label that decides
    /// whether the row reads as four keys or one smear.
    pub fn label(self) -> &'static str {
        match self {
            GamblerGame::Slots => "SLOTS",
            GamblerGame::Roulette => "ROULETTE",
            GamblerGame::Darts => "DARTS",
            GamblerGame::Blackjack => "BJACK",
        }
    }
}

/// One primitive in a game's frame. The shell resolves the game's animation
/// into these; this module knows nothing about reels or wheels.
///
/// Coordinates are in the GAME AREA's own space, `0..GAME_W` × `0..GAME_H`, so
/// a game never has to know where the cabinet put its viewport.
#[derive(Clone, Debug, PartialEq)]
pub enum GamePrim {
    /// A filled rectangle — reel windows, the board, a card back.
    Fill {
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        colour: u32,
    },
    /// A one-pixel outline.
    Stroke {
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        colour: u32,
    },
    /// A sunken panel, the toolkit's own `well`.
    Well { x: f64, y: f64, w: f64, h: f64 },
    /// A pre-rasterised RGBA surface, blitted 1:1 (times the frame's zoom).
    ///
    /// The escape hatch for art the four primitives above cannot express — a
    /// roulette wheel is nothing but circles, and there is no circle here. The
    /// game rasterises into a [`Pixmap`] at UI scale and hands it over; the
    /// integer upscale happens in `blit_rgba`, so the pixel grid survives.
    ///
    /// `Arc` because a 222x110 surface is 98KB and [`GamePaint`] is rebuilt
    /// every frame: the clone has to be a refcount bump, not a memcpy.
    Blit {
        x: f64,
        y: f64,
        img: Arc<Pixmap>,
    },
    /// Text at `size`, anchored left or centred.
    Label {
        x: f64,
        y: f64,
        s: String,
        size: u32,
        colour: u32,
        centre: bool,
    },
}

/// A game's current frame.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct GamePaint {
    pub prims: Vec<GamePrim>,
}

/// One game-specific control — roulette's bet kinds, blackjack's HIT/STAND.
#[derive(Clone, Debug, PartialEq)]
pub struct GameControl {
    /// Opaque to this screen; handed straight back in
    /// [`GamblerAction::Control`].
    pub id: String,
    pub label: String,
    /// Drawn as selected.
    pub on: bool,
    pub disabled: bool,
}

/// Everything the cabinet shows. The shell resolves it.
#[derive(Clone, Debug, PartialEq)]
pub struct GamblerView {
    pub game: GamblerGame,
    pub gold: i64,
    /// The stake the player has selected.
    pub stake: i64,
    /// The legal stakes right now — `table::stake_options`. A purse that
    /// cannot cover the minimum yields an EMPTY list, which is a real state:
    /// the cabinet says so rather than offering a bet that must be refused.
    pub stake_options: Vec<i64>,
    /// Rounds left this visit — `table::rounds_left`.
    pub rounds_left: u32,
    /// Net gold across the visit, for the ticker.
    pub net: i64,
    /// The game's one-line rules blurb.
    pub blurb: String,
    pub paint: GamePaint,
    pub controls: Vec<GameControl>,
    /// Is a round animating? The cabinet locks the picker and the stake row
    /// while it is — but NOT the primary key, which becomes the poke.
    pub busy: bool,
    /// Can a round START — purse, stake and round limit all satisfied.
    pub can_play: bool,
    /// The primary key's label: `SPIN`, `THROW`, `DEAL`… and `STOP` mid-round
    /// for a game whose poke does something.
    pub play_label: String,
    /// The flash line: a refusal, or the last round's result.
    pub message: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GamblerAction {
    /// Switch games. The screen refuses this mid-round.
    Pick(GamblerGame),
    /// Set the stake to this many gold.
    Stake(i64),
    /// Start a round, or POKE one that is already running (stop a reel).
    Play,
    /// A game-specific control was pressed — the id is the game's own.
    Control(String),
    Close,
}

const SHEET_W: f64 = 560.0;
const TITLE_H: f64 = 20.0;
const MSG_H: f64 = 12.0;
const HEAD_H: f64 = 14.0;
const HEAD_GAP: f64 = 4.0;
const FOOT_H: f64 = 20.0;
const TAB_H: f64 = 18.0;
const ROW_H: f64 = 22.0;

/// The games' viewport, in UI pixels. See the header for why it is not the
/// oracle's 200 — at 200 the cabinet overflows the design box by 38px.
pub const GAME_W: f64 = 528.0;
pub const GAME_H: f64 = 130.0;

fn body_height() -> f64 {
    TAB_H + HEAD_GAP          // the game picker
        + ROW_H + HEAD_GAP    // the stake row
        + GAME_H + HEAD_GAP   // the viewport
        + ROW_H // PLAY + the game's own controls
}

/// How tall the sheet wants to be. `sheet()` insets `GRID * 2` on every side
/// and SNAPS its height, so this rounds up to the grid — the same arithmetic
/// every other counter does.
fn content_height() -> f64 {
    let want = GRID * 4.0 + TITLE_H + MSG_H + body_height() + GRID + FOOT_H;
    (want / GRID).ceil() * GRID
}

fn rgba(hex: u32) -> Rgba {
    Rgba {
        r: (hex >> 16) as u8,
        g: (hex >> 8) as u8,
        b: hex as u8,
        a: 255,
    }
}

pub fn paint_gambler(f: &mut UiFrame, v: &GamblerView) -> Option<GamblerAction> {
    let mut act = None;
    scrim(f);
    let mut body = sheet(f, SHEET_W, content_height());

    let head = cut_top(&mut body, TITLE_H);
    text(
        f,
        "RISK GOLD",
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

    // The flash line carries the message; the round counter and the net ticker
    // ride its right end, because all three are one line's worth of state and
    // three lines is 24px this box does not have.
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
    let net = if v.net > 0 {
        format!("UP {}", v.net)
    } else if v.net < 0 {
        format!("DOWN {}", -v.net)
    } else {
        "EVEN".to_string()
    };
    text(
        f,
        &format!("{} LEFT  {net}", v.rounds_left),
        msg.x + msg.w,
        msg.y + 2.0,
        TextOpts {
            size: 8,
            colour: Some(if v.rounds_left == 0 {
                Ui::DANGER
            } else {
                Ui::TEXT_DIM
            }),
            align: Align::Right,
            ..TextOpts::default()
        },
    );

    // Reserve the footer BEFORE the body, so BACK sits in the same place under
    // every game rather than moving with whatever the last row left over.
    let foot_row = rect(body.x, body.y + (body.h - FOOT_H).max(0.0), body.w, FOOT_H);
    body.h = (body.h - (FOOT_H + GRID)).max(HEAD_H);

    // ── THE GAME PICKER ──
    let tabs = cut_top(&mut body, TAB_H);
    let quarter = ((tabs.w - 18.0) / 4.0).floor();
    for (i, id) in GamblerGame::ALL.into_iter().enumerate() {
        // Index arithmetic, and the row is NOT consumed — doing both is what
        // put the alchemist's second tab 266px off the sheet.
        let tr = rect(
            tabs.x + i as f64 * (quarter + 6.0),
            tabs.y,
            quarter,
            TAB_H - 2.0,
        );
        // Focusable even while busy, with the ACTION gated: a tab the pad skips
        // mid-spin is a cabinet that looks hung for the length of an animation.
        let st = focusable(f, &tr, false);
        let on = v.game == id;
        fill_rect(f, &tr, if on { Ui::SHEET_EDGE } else { Ui::WELL });
        stroke_rect(f, &tr, if on { Ui::GOLD } else { Ui::WELL_EDGE }, 1.0);
        text(
            f,
            id.label(),
            tr.x + tr.w / 2.0,
            tr.y + 4.0,
            TextOpts {
                size: 8,
                colour: Some(if on {
                    Ui::GOLD
                } else if v.busy {
                    Ui::TEXT_FAINT
                } else {
                    Ui::TEXT_DIM
                }),
                align: Align::Center,
                ..TextOpts::default()
            },
        );
        if st.focused {
            focus_ring(f, &tr);
        }
        if st.activated && !v.busy {
            act = Some(GamblerAction::Pick(id));
        }
    }
    cut_top(&mut body, HEAD_GAP);

    // ── THE STAKE ROW ──
    let row = cut_top(&mut body, ROW_H);
    text(
        f,
        "STAKE",
        row.x,
        row.y + 6.0,
        TextOpts {
            size: 8,
            colour: Some(Ui::TEXT_DIM),
            ..TextOpts::default()
        },
    );
    if v.stake_options.is_empty() {
        // A purse under the minimum. Saying so beats offering a bet the rules
        // would then have to refuse.
        text(
            f,
            "not enough gold to sit down",
            row.x + 48.0,
            row.y + 6.0,
            TextOpts {
                size: 8,
                colour: Some(Ui::DANGER),
                ..TextOpts::default()
            },
        );
    }
    let mut sx = row.x + 48.0;
    for s in &v.stake_options {
        let br = rect(sx, row.y, 44.0, ROW_H - 4.0);
        let st = focusable(f, &br, false);
        let on = *s == v.stake;
        fill_rect(f, &br, if on { Ui::SHEET_EDGE } else { Ui::WELL });
        stroke_rect(f, &br, if on { Ui::GOLD } else { Ui::WELL_EDGE }, 1.0);
        text(
            f,
            &format!("{s}g"),
            br.x + br.w / 2.0,
            br.y + 5.0,
            TextOpts {
                size: 8,
                colour: Some(if on { Ui::GOLD } else { Ui::TEXT_DIM }),
                align: Align::Center,
                ..TextOpts::default()
            },
        );
        if st.focused {
            focus_ring(f, &br);
        }
        if st.activated && !v.busy {
            act = Some(GamblerAction::Stake(*s));
        }
        sx += 50.0;
    }
    cut_top(&mut body, HEAD_GAP);

    // ── THE VIEWPORT ──
    let view = cut_top(&mut body, GAME_H);
    well(f, &view, None);
    draw_game(f, &view, &v.paint);
    // The blurb sits INSIDE the viewport's top-left: a line of its own costs
    // 14px and every game leaves its top strip empty.
    text(
        f,
        &v.blurb,
        view.x + 4.0,
        view.y + 3.0,
        TextOpts {
            size: 8,
            colour: Some(Ui::TEXT_FAINT),
            max: Some(view.w - 8.0),
            ..TextOpts::default()
        },
    );
    cut_top(&mut body, HEAD_GAP);

    // ── PLAY, AND THE GAME'S OWN CONTROLS ──
    let row = cut_top(&mut body, ROW_H);
    let play = rect(row.x, row.y, 88.0, ROW_H - 2.0);
    if button(
        f,
        &play,
        &v.play_label,
        ButtonOpts {
            // ⚠️ LIVE WHILE BUSY. Mid-round this key is the POKE — it is how a
            // reel is stopped — so it is gated on `can_play` only when no round
            // is running. Greying it during an animation makes slots unplayable
            // as designed.
            disabled: !v.can_play && !v.busy,
            ..ButtonOpts::default()
        },
    ) {
        act = Some(GamblerAction::Play);
    }
    // ⚠️ THE PADDING IS 8, NOT 12, AND THE GAP IS 4, NOT 6.
    //
    // Roulette offers NINE bets (red/black, odd/even, 1-9/10-18, and three
    // sixes). At 12px padding and a 6px gap they need 442px of a 434px row, so
    // `13-18` fell off the end — and the `break` below would have dropped it
    // SILENTLY, leaving a third of the board unreachable with every test green.
    // At 8/4 all nine fit with room to spare. `every_roulette_bet_is_reachable`
    // is the guard; see also the count assert there.
    let mut cx = play.x + play.w + 6.0;
    for c in &v.controls {
        let w = (c.label.chars().count() as f64 * 8.0 + 8.0).max(30.0);
        if cx + w > row.x + row.w {
            // A row that genuinely ran out of sheet clips rather than wrapping.
            // Reaching here means a game offered more controls than the cabinet
            // can show, which is a bug in that game's control list, not a
            // layout choice — the guard test exists to keep it unreachable.
            break;
        }
        let br = rect(cx, row.y, w, ROW_H - 2.0);
        let st = focusable(f, &br, c.disabled);
        fill_rect(f, &br, if c.on { Ui::SHEET_EDGE } else { Ui::WELL });
        stroke_rect(f, &br, if c.on { Ui::GOLD } else { Ui::WELL_EDGE }, 1.0);
        text(
            f,
            &c.label,
            br.x + br.w / 2.0,
            br.y + 5.0,
            TextOpts {
                size: 8,
                colour: Some(if c.disabled {
                    Ui::TEXT_FAINT
                } else if c.on {
                    Ui::GOLD
                } else {
                    Ui::TEXT_DIM
                }),
                align: Align::Center,
                ..TextOpts::default()
            },
        );
        if st.focused {
            focus_ring(f, &br);
        }
        if st.activated {
            act = Some(GamblerAction::Control(c.id.clone()));
        }
        cx += w + 4.0;
    }

    let foot = rect(foot_row.x + foot_row.w - 80.0, foot_row.y, 80.0, foot_row.h);
    if button(f, &foot, "BACK", ButtonOpts::default()) {
        act = Some(GamblerAction::Close);
    }
    act
}

/// Draw a game's frame inside `view`. Every primitive is offset into the
/// viewport and CLIPPED to it, so a game that paints out of bounds cannot
/// scribble over the cabinet's own chrome.
fn draw_game(f: &mut UiFrame, view: &Rect, paint: &GamePaint) {
    let clip = |x: f64, y: f64, w: f64, h: f64| -> Option<Rect> {
        let x0 = (view.x + x).max(view.x);
        let y0 = (view.y + y).max(view.y);
        let x1 = (view.x + x + w).min(view.x + view.w);
        let y1 = (view.y + y + h).min(view.y + view.h);
        (x1 > x0 && y1 > y0).then(|| rect(x0, y0, x1 - x0, y1 - y0))
    };
    for p in &paint.prims {
        match p {
            GamePrim::Fill { x, y, w, h, colour } => {
                if let Some(r) = clip(*x, *y, *w, *h) {
                    fill_rect(f, &r, rgba(*colour));
                }
            }
            GamePrim::Stroke { x, y, w, h, colour } => {
                if let Some(r) = clip(*x, *y, *w, *h) {
                    stroke_rect(f, &r, rgba(*colour), 1.0);
                }
            }
            GamePrim::Well { x, y, w, h } => {
                if let Some(r) = clip(*x, *y, *w, *h) {
                    well(f, &r, None);
                }
            }
            GamePrim::Blit { x, y, img } => {
                // Clipped to the viewport like every other prim, so a game that
                // rasterises a surface bigger than its box cannot paint chrome.
                if let Some(r) = clip(*x, *y, img.w as f64, img.h as f64) {
                    blit_pixmap(f, view.x + x, view.y + y, img, &r);
                }
            }
            GamePrim::Label {
                x,
                y,
                s,
                size,
                colour,
                centre,
            } => {
                // A label is PLACED, not clipped: the toolkit clips glyphs to
                // the frame, and `max` stops a long string running past the
                // viewport's right edge. An anchor outside the viewport is
                // dropped, which is what keeps a rogue label off the chrome.
                if *x >= 0.0 && *x <= view.w && *y >= 0.0 && *y <= view.h {
                    text(
                        f,
                        s,
                        view.x + x,
                        view.y + y,
                        TextOpts {
                            size: *size,
                            colour: Some(rgba(*colour)),
                            align: if *centre { Align::Center } else { Align::Left },
                            max: Some(view.w - x),
                        },
                    );
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::font::Fonts;
    use crate::im::{begin_ui, empty_ui_input, UiInput};
    use crate::painter::Painter;

    fn view(game: GamblerGame) -> GamblerView {
        GamblerView {
            game,
            gold: 1200,
            stake: 25,
            stake_options: vec![5, 10, 25, 50, 100],
            rounds_left: 4,
            net: -30,
            blurb: "three reels, one payline".into(),
            paint: GamePaint {
                prims: vec![
                    GamePrim::Well {
                        x: 20.0,
                        y: 30.0,
                        w: 60.0,
                        h: 60.0,
                    },
                    GamePrim::Label {
                        x: 50.0,
                        y: 50.0,
                        s: "7".into(),
                        size: 16,
                        colour: 0x00f0_c040,
                        centre: true,
                    },
                ],
            },
            controls: vec![
                GameControl {
                    id: "red".into(),
                    label: "RED".into(),
                    on: true,
                    disabled: false,
                },
                GameControl {
                    id: "black".into(),
                    label: "BLACK".into(),
                    on: false,
                    disabled: false,
                },
            ],
            busy: false,
            can_play: true,
            play_label: "SPIN".into(),
            message: None,
        }
    }

    fn paint(v: &GamblerView, focus: i64, input: UiInput) -> Option<GamblerAction> {
        let fonts = Fonts::load_embedded();
        let mut p = Painter::new(600, 338);
        let mut f = begin_ui(&mut p, &fonts, 600.0, 338.0, input, focus, 1);
        paint_gambler(&mut f, v)
    }

    /// THE STANDING INSTRUCTION, PINNED. The cabinet is one fixed layout, so
    /// this is a single number — but it is the number that forced the game
    /// viewport down from the oracle's 200px to 130.
    #[test]
    fn the_cabinet_never_outgrows_the_design_box() {
        assert!(
            content_height() <= 338.0 - GRID * 2.0,
            "the cabinet wants {} of the {} the design box can give",
            content_height(),
            338.0 - GRID * 2.0
        );
    }

    /// A widget's focus rect is where the pad tells the player to look. The
    /// alchemist shipped a tab 266px off the sheet with seven tests green.
    #[test]
    fn every_focusable_lands_on_the_sheet() {
        let x0 = (600.0 - SHEET_W) / 2.0;
        let x1 = x0 + SHEET_W;
        for game in GamblerGame::ALL {
            let v = view(game);
            for focus in 0..30 {
                let fonts = Fonts::load_embedded();
                let mut p = Painter::new(600, 338);
                let mut f = begin_ui(&mut p, &fonts, 600.0, 338.0, empty_ui_input(), focus, 1);
                paint_gambler(&mut f, &v);
                let Some(r) = f.focus_rect else { continue };
                assert!(
                    r.x >= x0 && r.x + r.w <= x1,
                    "{game:?} focus {focus} is at x={}..{} — outside the sheet",
                    r.x,
                    r.x + r.w
                );
                assert!(
                    r.y >= 0.0 && r.y + r.h <= 338.0,
                    "{game:?} focus {focus} is off the window vertically"
                );
            }
        }
    }

    /// The way out must exist. `body_height` budgets FOOT_H for it, and the
    /// dealer shipped that budget with no button behind it.
    #[test]
    fn there_is_a_reachable_back_key() {
        let mut input = empty_ui_input();
        input.accept = true;
        let v = view(GamblerGame::Slots);
        let hit = (0..30).find(|&i| paint(&v, i, input.clone()) == Some(GamblerAction::Close));
        assert!(hit.is_some(), "the cabinet has NO back key at any focus");
    }

    #[test]
    fn the_picker_is_the_first_four_focusables() {
        let mut input = empty_ui_input();
        input.accept = true;
        for (i, g) in GamblerGame::ALL.into_iter().enumerate() {
            assert_eq!(
                paint(&view(GamblerGame::Slots), i as i64, input.clone()),
                Some(GamblerAction::Pick(g))
            );
        }
    }

    /// ⚠️ MID-ROUND THE PICKER AND THE STAKE ROW MUST NOT FIRE.
    ///
    /// They stay FOCUSABLE — a cabinet whose pad dies for the length of a spin
    /// reads as a hang — so the gate is on the action. If a pick landed mid
    /// spin the shell would tear down a game that still owes a `resolve`, and
    /// the stake would be eaten with no round played.
    #[test]
    fn a_busy_cabinet_refuses_picks_and_stakes_but_stays_focusable() {
        let mut input = empty_ui_input();
        input.accept = true;
        let mut v = view(GamblerGame::Slots);
        v.busy = true;
        for i in 0..4 {
            assert_eq!(
                paint(&v, i, input.clone()),
                None,
                "picker {i} fired while busy"
            );
        }
        // …the five stake keys, straight after the four tabs.
        for i in 4..9 {
            assert_eq!(
                paint(&v, i, input.clone()),
                None,
                "stake {i} fired while busy"
            );
        }
        // And every one of them is still reachable.
        for i in 0..9 {
            let fonts = Fonts::load_embedded();
            let mut p = Painter::new(600, 338);
            let mut f = begin_ui(&mut p, &fonts, 600.0, 338.0, empty_ui_input(), i, 1);
            paint_gambler(&mut f, &v);
            assert!(f.focus_rect.is_some(), "focus {i} vanished while busy");
        }
    }

    /// PLAY stays live while busy — that is the POKE (stop a reel). A cabinet
    /// that greyed it mid-spin would make slots unplayable as designed.
    #[test]
    fn play_still_fires_while_busy_because_it_is_the_poke() {
        let mut input = empty_ui_input();
        input.accept = true;
        let mut v = view(GamblerGame::Slots);
        v.busy = true;
        v.can_play = false; // no round can START, but a poke is not a start
        v.play_label = "STOP".into();
        let hit = (0..30).find(|&i| paint(&v, i, input.clone()) == Some(GamblerAction::Play));
        assert!(
            hit.is_some(),
            "PLAY is unreachable mid-round — a reel can never be stopped"
        );
    }

    /// …and it is REFUSED when no round can start and none is running, so a
    /// player out of rounds cannot burn a stake on a table that is closed.
    #[test]
    fn play_is_dead_when_no_round_can_start_and_none_is_running() {
        let mut input = empty_ui_input();
        input.accept = true;
        let mut v = view(GamblerGame::Slots);
        v.busy = false;
        v.can_play = false;
        v.rounds_left = 0;
        for i in 0..30 {
            assert_ne!(
                paint(&v, i, input.clone()),
                Some(GamblerAction::Play),
                "PLAY fired at focus {i} with the table closed"
            );
        }
    }

    #[test]
    fn a_control_reports_its_own_id() {
        let mut input = empty_ui_input();
        input.accept = true;
        let v = view(GamblerGame::Roulette);
        let ids: Vec<String> = (0..30)
            .filter_map(|i| match paint(&v, i, input.clone()) {
                Some(GamblerAction::Control(id)) => Some(id),
                _ => None,
            })
            .collect();
        assert_eq!(ids, vec!["red".to_string(), "black".to_string()]);
    }

    /// A disabled control must never fire. Blackjack's DOUBLE is offered and
    /// greyed when the purse cannot cover it — the oracle's `canRaise` exists
    /// precisely so an unaffordable option is greyed rather than refused after
    /// the press.
    #[test]
    fn a_disabled_control_never_fires() {
        let mut input = empty_ui_input();
        input.accept = true;
        let mut v = view(GamblerGame::Blackjack);
        v.controls = vec![GameControl {
            id: "double".into(),
            label: "DOUBLE".into(),
            on: false,
            disabled: true,
        }];
        for i in 0..30 {
            assert_ne!(
                paint(&v, i, input.clone()),
                Some(GamblerAction::Control("double".into())),
                "a disabled control fired at focus {i}"
            );
        }
    }

    /// ⚠️ EVERY CONTROL A GAME OFFERS MUST BE REACHABLE.
    ///
    /// Roulette offers NINE bets. At the first cut's 12px padding and 6px gap
    /// they wanted 442px of a 434px row, so `13-18` fell off the end — and the
    /// `break` in the control loop drops an overflowing control SILENTLY, so a
    /// third of the board would have been unbettable with every other test
    /// green. This asserts the real labels, at the real widths, all report their
    /// own id.
    #[test]
    fn every_roulette_bet_is_reachable() {
        // `pk_core::gambler::roulette::bets()`, which pk-gui cannot import.
        let labels = [
            ("red", "RED"),
            ("black", "BLACK"),
            ("odd", "ODD"),
            ("even", "EVEN"),
            ("low", "1-9"),
            ("high", "10-18"),
            ("t1", "1-6"),
            ("t2", "7-12"),
            ("t3", "13-18"),
        ];
        let mut v = view(GamblerGame::Roulette);
        v.controls = labels
            .iter()
            .map(|(id, label)| GameControl {
                id: (*id).into(),
                label: (*label).into(),
                on: *id == "red",
                disabled: false,
            })
            .collect();

        let mut input = empty_ui_input();
        input.accept = true;
        let seen: Vec<String> = (0..40)
            .filter_map(|i| match paint(&v, i, input.clone()) {
                Some(GamblerAction::Control(id)) => Some(id),
                _ => None,
            })
            .collect();
        let want: Vec<String> = labels.iter().map(|(id, _)| (*id).to_string()).collect();
        assert_eq!(
            seen, want,
            "a roulette bet was dropped off the control row — it would be unbettable"
        );
    }

    /// An empty purse yields NO stake keys, and the cabinet says why instead of
    /// offering a bet the rules would refuse.
    #[test]
    fn a_purse_under_the_minimum_offers_no_stakes() {
        let mut input = empty_ui_input();
        input.accept = true;
        let mut v = view(GamblerGame::Slots);
        v.stake_options = vec![];
        v.gold = 2;
        for i in 0..30 {
            assert!(
                !matches!(paint(&v, i, input.clone()), Some(GamblerAction::Stake(_))),
                "a stake key existed with no legal stakes, at focus {i}"
            );
        }
    }

    /// ⚠️ A GAME MUST NOT PAINT OVER THE CABINET.
    ///
    /// The prims are in the viewport's own space and are clipped to it. A game
    /// with a bug — a reel at y=-400, a wheel wider than the board — would
    /// otherwise scribble across the purse and the tabs, and the player would
    /// read a rules bug as a corrupted screen.
    #[test]
    fn a_game_painting_out_of_bounds_is_clipped_not_drawn() {
        let fonts = Fonts::load_embedded();
        let mut v = view(GamblerGame::Slots);
        v.paint = GamePaint {
            prims: vec![GamePrim::Fill {
                x: -400.0,
                y: -400.0,
                w: 2000.0,
                h: 2000.0,
                colour: 0x00ff_0000,
            }],
        };
        let mut p = Painter::new(600, 338);
        {
            let mut f = begin_ui(&mut p, &fonts, 600.0, 338.0, empty_ui_input(), -1, 1);
            paint_gambler(&mut f, &v);
        }
        // Row 30 is the title bar, well above the viewport. If the rogue fill
        // reached it, these pixels would be pure red.
        let hit = (0..600).any(|x| {
            let i = (30 * 600 + x) * 4;
            p.buf[i] > 200 && p.buf[i + 1] < 60 && p.buf[i + 2] < 60
        });
        assert!(
            !hit,
            "a game's fill escaped the viewport and reached the title bar"
        );
    }

    /// …and the POSITIVE CONTROL for that clip: an IN-bounds red fill really
    /// does land, so the test above is measuring the clip and not a colour
    /// nothing ever paints.
    #[test]
    fn an_in_bounds_fill_does_reach_the_viewport() {
        let fonts = Fonts::load_embedded();
        let mut v = view(GamblerGame::Slots);
        v.paint = GamePaint {
            prims: vec![GamePrim::Fill {
                x: 0.0,
                y: 0.0,
                w: GAME_W,
                h: GAME_H,
                colour: 0x00ff_0000,
            }],
        };
        let mut p = Painter::new(600, 338);
        {
            let mut f = begin_ui(&mut p, &fonts, 600.0, 338.0, empty_ui_input(), -1, 1);
            paint_gambler(&mut f, &v);
        }
        let red = (0..338).any(|y| {
            (0..600).any(|x| {
                let i = (y * 600 + x) * 4;
                p.buf[i] > 200 && p.buf[i + 1] < 60 && p.buf[i + 2] < 60
            })
        });
        assert!(
            red,
            "an in-bounds fill painted nothing — the clip test proves nothing"
        );
    }

    /// Every character this cabinet can draw must be in the baked atlas — a
    /// glyph the bake does not ship draws NOTHING, silently, and `measure`
    /// returns the monospace advance for it so even measuring looks right.
    #[test]
    fn every_glyph_this_screen_draws_is_in_the_atlas() {
        let fonts = Fonts::load_embedded();
        let atlas = fonts.atlas(8).expect("the 8px atlas is the text floor");
        let v = view(GamblerGame::Slots);
        let mut sources: Vec<String> = vec![
            "RISK GOLD".into(),
            "STAKE".into(),
            "BACK".into(),
            "not enough gold to sit down".into(),
            v.blurb.clone(),
            format!("{}g", v.gold),
            format!("{} LEFT  DOWN 30", v.rounds_left),
            "0 LEFT  EVEN".into(),
            "6 LEFT  UP 40".into(),
        ];
        for g in GamblerGame::ALL {
            sources.push(g.label().to_string());
        }
        for s in &v.stake_options {
            sources.push(format!("{s}g"));
        }
        // Every label the four games can put on the primary key or a control.
        for label in [
            "SPIN", "STOP", "THROW", "DEAL", "HIT", "STAND", "DOUBLE", "RED", "BLACK", "ODD",
            "EVEN", "LOW", "HIGH", "1ST", "2ND", "3RD", "STRAIGHT",
        ] {
            sources.push(label.to_string());
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
}
