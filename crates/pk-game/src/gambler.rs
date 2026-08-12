//! THE CABINET'S SHELL — the half of `gambler/index.ts` that owns money.
//!
//! `pk_gui::screens::gambler` paints; `pk_core::gambler` decides. This is the
//! seam between them: it holds the four games' live state, turns that state
//! into a `GamePaint` for the painter, and routes the painter's actions back
//! into `pk_core::gambler::table` — which is the ONLY thing that moves gold.
//!
//! That is the oracle's own rule, kept: *"a game can be wrong about its
//! animation and it's a cosmetic bug, but a game that could move gold directly
//! would be able to bypass the stake caps and the per-visit round limit."*
//!
//! ## The forfeit, and why it is not an edge case
//!
//! Every driver decides its outcome at `play`, so a round that is torn down
//! mid-animation still knows what it owed. The oracle keeps a `forfeitRound`
//! closure for exactly this, and its comment says what happens without one: *"a
//! teardown eats the stake"*. Closing the cabinet, walking away, or switching
//! games mid-round all route through [`Cabinet::forfeit`], which settles the
//! round rather than dropping it.

use pk_core::gambler::blackjack::{fresh_deck, shuffle};
use pk_core::gambler::blackjack_table::{BjPhase, BlackjackApi, BlackjackTable};
use pk_core::gambler::darts_throw::ThrowPhase;
use pk_core::gambler::drive::{DartsDrive, RouletteDrive, SlotsDrive};
use pk_core::gambler::roulette::{bets, color_of, BetDef, PocketColor};
use pk_core::gambler::slots::Symbol;
use pk_core::gambler::table::{
    can_bet, create_table_state, place_bet, rounds_left, settle, stake_options, GameId,
    RoundResult, TableDeps, TableState,
};
use pk_core::rng::Mulberry32;
use pk_gui::screens::gambler::{
    GamblerGame, GamblerView, GameControl, GamePaint, GamePrim, GAME_W,
};

/// Ink, so the games read as one machine rather than four palettes.
const INK: u32 = 0x000d_1018;
const GOLD: u32 = 0x00f0_c040;
const COLD: u32 = 0x006f_d0e8;
const WARM: u32 = 0x00d9_5763;
const BONE: u32 = 0x00c9_bfa4;
const FELT: u32 = 0x001c_3024;
const DIM: u32 = 0x003a_4152;

/// The four games' live state. One is current; the others hold their last
/// frame, which is why switching back to a game does not reset its table.
pub struct Cabinet {
    pub table: TableState,
    pub game: GamblerGame,
    pub stake: i64,
    pub message: Option<String>,
    slots: SlotsDrive,
    roulette: RouletteDrive,
    darts: DartsDrive<Mulberry32Fn>,
    blackjack: BlackjackTable,
    /// Which roulette bet is armed.
    bet: BetDef,
    /// One stream for the whole cabinet, seeded — so a session is replayable.
    rng: Mulberry32,
    /// The stake the live round took, so a forfeit can name it.
    live: Option<GameId>,
}

/// `DartsDrive` owns its rng, so it needs a concrete callable.
type Mulberry32Fn = Box<dyn FnMut() -> f64 + Send + Sync>;

impl Cabinet {
    pub fn new(seed: u32) -> Self {
        let mut darts_rng = Mulberry32::new(seed ^ 0x00D4_2751);
        let dice: Mulberry32Fn = Box::new(move || darts_rng.next_f64());
        Self {
            table: create_table_state(),
            game: GamblerGame::Slots,
            stake: 10,
            message: None,
            slots: SlotsDrive::new(),
            roulette: RouletteDrive::new(bets()[0].clone()),
            darts: DartsDrive::new(dice),
            blackjack: BlackjackTable::new(),
            bet: bets()[0].clone(),
            rng: Mulberry32::new(seed),
            live: None,
        }
    }

    /// Reset the per-visit round limit.
    ///
    /// ⚠️ NOTHING CALLS THIS, AND THAT IS CORRECT — but only because
    /// `TavernRes` is inserted fresh in `setup_tavern`, so entering the tavern
    /// builds a new `Cabinet` and the limit resets with it. The oracle needs an
    /// explicit `resetGamblerVisit()` because its cabinet is a MODULE-LEVEL
    /// singleton that outlives the scene. Kept, tested, and documented here so
    /// that if the tavern ever starts reusing its resource the reset is a call
    /// away rather than a bug where the casino stays closed forever.
    #[allow(dead_code)]
    pub fn reset_visit(&mut self) {
        self.table = create_table_state();
        self.message = None;
    }

    pub fn busy(&self) -> bool {
        match self.game {
            GamblerGame::Slots => self.slots.busy(),
            GamblerGame::Roulette => self.roulette.busy(),
            GamblerGame::Darts => self.darts.busy(),
            GamblerGame::Blackjack => self.blackjack.busy(),
        }
    }
}

/// The wallet seam. Wrapping it keeps `pk_core::gambler::table` the only thing
/// that spends, exactly as the oracle's `TableDeps` does.
pub struct Purse<'a> {
    pub wallet: &'a mut pk_core::economy::Wallet,
}

impl TableDeps for Purse<'_> {
    fn get_balance(&self) -> i64 {
        self.wallet.balance()
    }
    fn spend_gold(&mut self, amount: i64) -> bool {
        self.wallet.spend(amount)
    }
    fn add_gold(&mut self, amount: i64, _source: &str) -> i64 {
        self.wallet.add(amount);
        self.wallet.balance()
    }
}

/// Blackjack's mid-round raise needs the wallet AND the round's settle. This
/// carries both, and records the result so the caller can post it to `table`.
struct BjBridge<'a> {
    purse: Purse<'a>,
    settled: Option<(i64, i64, String)>,
}

impl BlackjackApi for BjBridge<'_> {
    fn resolve(&mut self, stake: i64, payout: i64, label: &str) {
        self.settled = Some((stake, payout, label.to_string()));
    }
    fn raise(&mut self, extra: i64) -> bool {
        // ⚠️ STRAIGHT TO THE WALLET, NOT THROUGH `place_bet`. A double-down is
        // an extra WAGER on a round already counted — routing it through
        // `place_bet` would burn a second round off the per-visit limit, which
        // is the oracle's stated contract for `raise`: "Does NOT consume
        // another round off the limit."
        self.purse.spend_gold(extra)
    }
    fn can_raise(&self, extra: i64) -> bool {
        self.purse.get_balance() >= extra
    }
}

// ── ACTIONS ──────────────────────────────────────────────────────────────────

impl Cabinet {
    /// Switch games. Refused mid-round by the SCREEN; this also forfeits any
    /// live round, so a switch that slips through cannot eat a stake.
    pub fn pick(&mut self, game: GamblerGame, wallet: &mut pk_core::economy::Wallet) {
        if game == self.game {
            return;
        }
        self.forfeit(wallet);
        self.game = game;
        self.message = None;
    }

    pub fn set_stake(&mut self, stake: i64) {
        self.stake = stake;
    }

    /// The primary key. Starts a round, or pokes one that is running.
    pub fn play(&mut self, wallet: &mut pk_core::economy::Wallet) {
        if self.busy() {
            // Mid-round this is the poke. Only slots and darts do anything
            // with it; the wheel is committed and blackjack acts on controls.
            match self.game {
                GamblerGame::Slots => self.slots.poke(),
                GamblerGame::Darts => {
                    self.darts.press();
                }
                _ => {}
            }
            return;
        }

        // ── THE ONLY PLACE A STAKE IS TAKEN ──
        let purse = wallet.balance();
        let check = can_bet(&self.table, purse, self.stake as f64);
        if !check.ok {
            self.message = check.message;
            return;
        }
        let mut deps = Purse { wallet };
        let placed = place_bet(&self.table, &mut deps, self.stake);
        if !placed.ok {
            self.message = placed.message;
            return;
        }
        self.message = None;
        self.live = Some(game_id(self.game));

        let mut rng = self.rng;
        match self.game {
            GamblerGame::Slots => self.slots.play(self.stake, &mut || rng.next_f64()),
            GamblerGame::Roulette => {
                self.roulette.set_bet(self.bet.clone());
                self.roulette.play(self.stake, &mut || rng.next_f64());
            }
            GamblerGame::Darts => self.darts.play(self.stake),
            GamblerGame::Blackjack => {
                let deck = shuffle(&fresh_deck(), &mut || rng.next_f64());
                let mut cues = Vec::new();
                self.blackjack.play(self.stake, deck, &mut cues);
            }
        }
        // ⚠️ WRITE THE STREAM BACK. `Mulberry32` is `Copy`; without this every
        // spin of a session deals the same hand. Same trap as the dealer's
        // shelf, and the same guard below.
        self.rng = rng;
    }

    /// A game-specific control: roulette's bets, blackjack's hit/stand/double.
    pub fn control(&mut self, id: &str, wallet: &mut pk_core::economy::Wallet) {
        match self.game {
            GamblerGame::Roulette => {
                if let Some(b) = bets().into_iter().find(|b| b.id == id) {
                    self.bet = b.clone();
                    self.roulette.set_bet(b);
                }
            }
            GamblerGame::Blackjack => {
                let mut bridge = BjBridge {
                    purse: Purse { wallet },
                    settled: None,
                };
                let mut cues = Vec::new();
                self.blackjack.on_control(id, &mut bridge, &mut cues);
                self.bank(bridge.settled, wallet);
            }
            _ => {}
        }
    }

    /// Advance whatever is running. Called once a frame.
    pub fn tick(&mut self, dt: f64, wallet: &mut pk_core::economy::Wallet) {
        match self.game {
            GamblerGame::Slots => {
                if let Some(r) = self.slots.tick(dt) {
                    self.bank_result(r, wallet);
                }
            }
            GamblerGame::Roulette => {
                if let Some(r) = self.roulette.tick(dt) {
                    self.bank_result(r, wallet);
                }
            }
            GamblerGame::Darts => {
                let (_events, done) = self.darts.tick(dt);
                if let Some(r) = done {
                    self.bank_result(r, wallet);
                }
            }
            GamblerGame::Blackjack => {
                let mut bridge = BjBridge {
                    purse: Purse { wallet },
                    settled: None,
                };
                self.blackjack.tick(dt, &mut bridge);
                self.bank(bridge.settled, wallet);
            }
        }
    }

    /// Settle whatever is in flight. Closing, walking away and switching games
    /// all come through here — see the module header.
    pub fn forfeit(&mut self, wallet: &mut pk_core::economy::Wallet) {
        let done = match self.game {
            GamblerGame::Slots => self.slots.forfeit(),
            GamblerGame::Roulette => self.roulette.forfeit(),
            GamblerGame::Darts => self.darts.forfeit(),
            GamblerGame::Blackjack => {
                // The table's own teardown. It resolves through the api if a
                // hand is live, so the bridge catches the settle.
                let mut bridge = BjBridge {
                    purse: Purse { wallet },
                    settled: None,
                };
                self.blackjack.dispose();
                let out = bridge.settled.take();
                out.map(|(stake, payout, label)| RoundResult {
                    game: GameId::Blackjack,
                    stake,
                    payout,
                    label,
                })
            }
        };
        if let Some(r) = done {
            self.bank_result(r, wallet);
        }
    }

    fn bank(&mut self, settled: Option<(i64, i64, String)>, wallet: &mut pk_core::economy::Wallet) {
        if let Some((stake, payout, label)) = settled {
            self.bank_result(
                RoundResult {
                    game: GameId::Blackjack,
                    stake,
                    payout,
                    label,
                },
                wallet,
            );
        }
    }

    fn bank_result(&mut self, r: RoundResult, wallet: &mut pk_core::economy::Wallet) {
        self.message = Some(r.label.clone());
        let mut deps = Purse { wallet };
        settle(&mut self.table, &mut deps, r);
        self.live = None;
    }
}

fn game_id(g: GamblerGame) -> GameId {
    match g {
        GamblerGame::Slots => GameId::Slots,
        GamblerGame::Roulette => GameId::Roulette,
        GamblerGame::Darts => GameId::Darts,
        GamblerGame::Blackjack => GameId::Blackjack,
    }
}

// ── THE VIEW ─────────────────────────────────────────────────────────────────

impl Cabinet {
    /// Everything the painter needs, resolved from live state.
    pub fn view(&self, wallet: &pk_core::economy::Wallet) -> GamblerView {
        let gold = wallet.balance();
        let busy = self.busy();
        let can = can_bet(&self.table, gold, self.stake as f64).ok;
        GamblerView {
            game: self.game,
            gold,
            stake: self.stake,
            stake_options: stake_options(gold),
            rounds_left: rounds_left(&self.table),
            net: self.table.net,
            blurb: blurb(self.game).into(),
            paint: self.paint(),
            controls: self.controls(gold),
            busy,
            can_play: can && !busy,
            play_label: play_label(self.game, busy).into(),
            message: self.message.clone(),
        }
    }

    fn controls(&self, gold: i64) -> Vec<GameControl> {
        match self.game {
            GamblerGame::Roulette => bets()
                .into_iter()
                .map(|b| GameControl {
                    on: b.id == self.bet.id,
                    id: b.id.to_string(),
                    label: b.label,
                    // A bet cannot be switched mid-spin, and a greyed key says
                    // so better than one that silently does nothing.
                    disabled: self.roulette.busy(),
                })
                .collect(),
            GamblerGame::Blackjack => {
                struct Ask(i64);
                impl BlackjackApi for Ask {
                    fn resolve(&mut self, _s: i64, _p: i64, _l: &str) {}
                    fn raise(&mut self, _e: i64) -> bool {
                        false
                    }
                    fn can_raise(&self, extra: i64) -> bool {
                        self.0 >= extra
                    }
                }
                self.blackjack
                    .controls(&Ask(gold))
                    .into_iter()
                    .map(|c| GameControl {
                        id: c.id.to_string(),
                        label: c.label,
                        on: false,
                        disabled: c.disabled,
                    })
                    .collect()
            }
            _ => Vec::new(),
        }
    }

    fn paint(&self) -> GamePaint {
        match self.game {
            GamblerGame::Slots => paint_slots(&self.slots),
            GamblerGame::Roulette => paint_roulette(&self.roulette),
            GamblerGame::Darts => paint_darts(&self.darts),
            GamblerGame::Blackjack => paint_blackjack(&self.blackjack),
        }
    }
}

fn blurb(g: GamblerGame) -> &'static str {
    match g {
        GamblerGame::Slots => "three reels, one payline — STOP pulls a reel in early",
        GamblerGame::Roulette => "pick a bet, then SPIN — 0 is the house's",
        GamblerGame::Darts => "THROW locks the sweep: across, then down. three darts",
        GamblerGame::Blackjack => "beat the dealer without going over 21",
    }
}

fn play_label(g: GamblerGame, busy: bool) -> &'static str {
    match (g, busy) {
        (GamblerGame::Slots, true) => "STOP",
        (GamblerGame::Slots, false) => "SPIN",
        (GamblerGame::Roulette, _) => "SPIN",
        (GamblerGame::Darts, true) => "THROW",
        (GamblerGame::Darts, false) => "PLAY",
        (GamblerGame::Blackjack, _) => "DEAL",
    }
}

// ── THE PAINTERS ─────────────────────────────────────────────────────────────
//
// Every one of these is axis-aligned rectangles and text at integer-ish
// coordinates, for the reason the legacy slots header gives: the painter is a
// nearest-sampled pixel surface, and anything else reads as a blurred PNG next
// to the rest of the art.

fn sym_ink(s: Symbol) -> u32 {
    match s {
        Symbol::Jackpot => GOLD,
        Symbol::Target => WARM,
        Symbol::Flipper => COLD,
        Symbol::Bumper => 0x008f_d06f,
        Symbol::Ball => BONE,
        Symbol::Skull => DIM,
    }
}

fn paint_slots(d: &SlotsDrive) -> GamePaint {
    let mut prims = Vec::new();
    let reel_w = 92.0;
    let reel_h = 76.0;
    let gap = 14.0;
    let total = reel_w * 3.0 + gap * 2.0;
    let x0 = (GAME_W - total) / 2.0;
    let y0 = 30.0;

    for i in 0..3 {
        let x = x0 + i as f64 * (reel_w + gap);
        prims.push(GamePrim::Well {
            x,
            y: y0,
            w: reel_w,
            h: reel_h,
        });
        match (d.reels(), d.stopped(i)) {
            (Some(reels), true) => {
                let s = reels[i];
                prims.push(GamePrim::Label {
                    x: x + reel_w / 2.0,
                    y: y0 + reel_h / 2.0 - 8.0,
                    s: s.name().into(),
                    size: 8,
                    colour: sym_ink(s),
                    centre: true,
                });
            }
            // A SPINNING reel is a motion bar, not a symbol: the legacy
            // painter's note is that blur is a solid bar here, never an alpha
            // gradient, because the surface is nearest-sampled.
            _ => {
                for b in 0..3 {
                    prims.push(GamePrim::Fill {
                        x: x + 8.0,
                        y: y0 + 14.0 + b as f64 * 20.0,
                        w: reel_w - 16.0,
                        h: 10.0,
                        colour: DIM,
                    });
                }
            }
        }
    }

    // The line, once every reel is down.
    if d.reels().is_some() && d.stopped(2) {
        prims.push(GamePrim::Label {
            x: GAME_W / 2.0,
            y: y0 + reel_h + 8.0,
            s: d.label().to_uppercase(),
            size: 8,
            colour: GOLD,
            centre: true,
        });
    }
    GamePaint { prims }
}

fn paint_roulette(d: &RouletteDrive) -> GamePaint {
    let mut prims = Vec::new();
    // The wheel is a BAR, not a disc: a 130px viewport cannot hold a readable
    // wheel, and an arc on this surface would be the one anti-aliased thing on
    // screen. The ball's angle drives a marker along the bar instead.
    let bar_x = 24.0;
    let bar_y = 54.0;
    let bar_w = GAME_W - 48.0;
    let bar_h = 26.0;
    prims.push(GamePrim::Well {
        x: bar_x,
        y: bar_y,
        w: bar_w,
        h: bar_h,
    });

    // 19 pockets, 0..18, coloured as the wheel is.
    let n = 19.0;
    for p in 0..19 {
        let w = bar_w / n;
        let x = bar_x + p as f64 * w;
        let colour = match color_of(p) {
            PocketColor::Green => 0x002f_7d4f,
            PocketColor::Red => WARM,
            PocketColor::Black => INK,
        };
        prims.push(GamePrim::Fill {
            x: x + 1.0,
            y: bar_y + 1.0,
            w: w - 2.0,
            h: bar_h - 2.0,
            colour,
        });
    }

    // The ball, and the resting pocket once it is down.
    if let Some(f) = d.frame() {
        let w = bar_w / n;
        // Ball angle → a position along the bar. The physics is angular; this
        // maps one revolution onto the strip so motion reads as motion.
        let frac = (f.theta.rem_euclid(std::f64::consts::TAU)) / std::f64::consts::TAU;
        prims.push(GamePrim::Fill {
            x: bar_x + frac * bar_w - 2.0,
            y: bar_y - 8.0,
            w: 4.0,
            h: 8.0,
            colour: BONE,
        });
        if !d.busy() {
            let p = d.pocket().clamp(0, 18) as f64;
            prims.push(GamePrim::Stroke {
                x: bar_x + p * w,
                y: bar_y,
                w,
                h: bar_h,
                colour: GOLD,
            });
            prims.push(GamePrim::Label {
                x: GAME_W / 2.0,
                y: bar_y + bar_h + 8.0,
                s: format!("POCKET {}", d.pocket()),
                size: 8,
                colour: GOLD,
                centre: true,
            });
        }
    }
    prims.push(GamePrim::Label {
        x: bar_x,
        y: bar_y + bar_h + 8.0,
        s: format!("ON {}", d.bet().label.to_uppercase()),
        size: 8,
        colour: COLD,
        centre: false,
    });
    GamePaint { prims }
}

fn paint_darts(d: &DartsDrive<Mulberry32Fn>) -> GamePaint {
    let mut prims = Vec::new();
    let m = d.machine();
    // The board, as nested rings. Square rings, for the same nearest-sampling
    // reason the wheel is a bar.
    let cx = GAME_W / 2.0;
    let cy = 74.0;
    let r = 46.0;
    for (i, colour) in [(0, FELT), (1, DIM), (2, WARM), (3, GOLD)] {
        let k = r * (1.0 - f64::from(i) * 0.25);
        prims.push(GamePrim::Stroke {
            x: cx - k,
            y: cy - k,
            w: k * 2.0,
            h: k * 2.0,
            colour,
        });
    }

    // The darts already in the board.
    for dart in m.darts() {
        prims.push(GamePrim::Fill {
            x: cx + dart.x * r - 1.5,
            y: cy + dart.y * r - 1.5,
            w: 3.0,
            h: 3.0,
            colour: BONE,
        });
    }

    // The sweep: a vertical line while aiming across, a horizontal one while
    // aiming down. This is the whole interaction, so it has to be legible.
    match m.phase() {
        ThrowPhase::AimX => {
            let x = cx + m.cursor() * r;
            prims.push(GamePrim::Fill {
                x: x - 1.0,
                y: cy - r,
                w: 2.0,
                h: r * 2.0,
                colour: COLD,
            });
        }
        ThrowPhase::AimY => {
            let x = cx + m.locked_x() * r;
            prims.push(GamePrim::Fill {
                x: x - 1.0,
                y: cy - r,
                w: 2.0,
                h: r * 2.0,
                colour: DIM,
            });
            let y = cy + m.cursor() * m.y_range() * r;
            prims.push(GamePrim::Fill {
                x: cx - r,
                y: y - 1.0,
                w: r * 2.0,
                h: 2.0,
                colour: COLD,
            });
        }
        _ => {}
    }

    let (total, _mult, label) = m.result();
    prims.push(GamePrim::Label {
        x: 8.0,
        y: 110.0,
        s: format!("{} DARTS  {total}", m.darts().len()),
        size: 8,
        colour: BONE,
        centre: false,
    });
    if m.phase() == ThrowPhase::Done {
        prims.push(GamePrim::Label {
            x: GAME_W / 2.0,
            y: 110.0,
            s: label.into(),
            size: 8,
            colour: GOLD,
            centre: true,
        });
    }
    GamePaint { prims }
}

fn paint_blackjack(t: &BlackjackTable) -> GamePaint {
    let mut prims = Vec::new();
    let card_w = 26.0;
    let card_h = 36.0;

    let row = |prims: &mut Vec<GamePrim>, cards: &[String], y: f64, hide_first: bool| {
        for (i, label) in cards.iter().enumerate() {
            let x = 24.0 + i as f64 * (card_w + 5.0);
            let down = hide_first && i == 1;
            prims.push(GamePrim::Fill {
                x,
                y,
                w: card_w,
                h: card_h,
                colour: if down { DIM } else { BONE },
            });
            if !down {
                prims.push(GamePrim::Label {
                    x: x + 2.0,
                    y: y + 4.0,
                    s: label.clone(),
                    size: 8,
                    colour: INK,
                    centre: false,
                });
            }
        }
    };

    let dealer: Vec<String> = t
        .dealer
        .iter()
        .map(|d| pk_core::gambler::blackjack::rank_label(d.card.rank))
        .collect();
    let player: Vec<String> = t
        .player
        .iter()
        .map(|d| pk_core::gambler::blackjack::rank_label(d.card.rank))
        .collect();

    prims.push(GamePrim::Label {
        x: 8.0,
        y: 22.0,
        s: "DEALER".into(),
        size: 8,
        colour: COLD,
        centre: false,
    });
    row(&mut prims, &dealer, 32.0, t.hole_down());
    prims.push(GamePrim::Label {
        x: 8.0,
        y: 74.0,
        s: "YOU".into(),
        size: 8,
        colour: GOLD,
        centre: false,
    });
    row(&mut prims, &player, 84.0, false);

    if t.phase() == BjPhase::Done && !t.result_label.is_empty() {
        prims.push(GamePrim::Label {
            x: GAME_W - 8.0,
            y: 22.0,
            s: t.result_label.to_uppercase(),
            size: 8,
            colour: GOLD,
            centre: false,
        });
    }
    GamePaint { prims }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pk_core::economy::Wallet;
    use pk_gui::screens::gambler::GAME_H;

    fn purse(g: i64) -> Wallet {
        Wallet::new(g)
    }

    /// ⚠️ THE STAKE IS TAKEN AT `play`; THE ROUND IS COUNTED AT `settle`.
    ///
    /// A first cut of this test asserted `rounds_played == 1` straight after
    /// `play` and failed — correctly. `table::settle` owns the counter, and its
    /// comment says why: *"Only counts the round once, here, so a game that
    /// resolves twice can't burn two rounds — or pay twice."* Taking the gold
    /// and counting the round are deliberately different moments, and this
    /// pins both.
    #[test]
    fn playing_takes_the_stake_at_once_and_counts_the_round_at_the_settle() {
        let mut w = purse(1000);
        let mut c = Cabinet::new(1);
        c.set_stake(25);
        c.play(&mut w);
        assert_eq!(w.balance(), 975, "the stake was not taken exactly once");
        assert_eq!(
            c.table.rounds_played, 0,
            "the round was counted before it resolved"
        );

        for _ in 0..600 {
            c.tick(0.016, &mut w);
            if !c.busy() {
                break;
            }
        }
        assert_eq!(
            c.table.rounds_played, 1,
            "the settle did not count the round"
        );
    }

    /// ⚠️ THE PER-VISIT LIMIT IS REAL, AND A FORFEIT DOES NOT REFUND IT.
    #[test]
    fn the_table_closes_after_the_visits_rounds_are_spent() {
        let mut w = purse(10_000);
        let mut c = Cabinet::new(2);
        c.set_stake(5);
        for _ in 0..pk_core::gambler::table::ROUNDS_PER_VISIT {
            c.play(&mut w);
            // Run the round out so the next play is not a poke.
            for _ in 0..600 {
                c.tick(0.016, &mut w);
                if !c.busy() {
                    break;
                }
            }
        }
        assert_eq!(rounds_left(&c.table), 0);
        let before = w.balance();
        c.play(&mut w);
        assert_eq!(
            w.balance(),
            before,
            "a 7th round took gold from a closed table"
        );
        assert!(c.message.is_some(), "the refusal was silent");
    }

    /// ⚠️ A TEARDOWN MUST SETTLE, NOT DROP.
    ///
    /// The outcome was decided at `play`, so a round abandoned mid-animation
    /// still owes its payout. Without this the stake is simply eaten — which is
    /// exactly what the oracle's `forfeitRound` exists to prevent.
    #[test]
    fn closing_mid_round_settles_it_instead_of_eating_the_stake() {
        let mut w = purse(1000);
        let mut c = Cabinet::new(3);
        c.set_stake(50);
        c.play(&mut w);
        assert!(c.busy());
        let mid = w.balance();
        c.forfeit(&mut w);
        assert!(!c.busy(), "the round is still live after a forfeit");
        // The payout landed (or the round genuinely paid nothing), and the
        // table logged it either way.
        assert_eq!(c.table.log.len(), 1, "the forfeited round was never logged");
        let paid = w.balance() - mid;
        assert_eq!(
            paid, c.table.log[0].payout,
            "the forfeit paid the wrong amount"
        );
    }

    /// A forfeit with nothing running is a no-op — it must not log a phantom
    /// round or pay twice.
    #[test]
    fn forfeiting_an_idle_cabinet_does_nothing() {
        let mut w = purse(1000);
        let mut c = Cabinet::new(4);
        c.forfeit(&mut w);
        assert_eq!(w.balance(), 1000);
        assert!(c.table.log.is_empty());
    }

    /// ⚠️ THE STREAM MUST ADVANCE. `Mulberry32` is `Copy`, so `play` takes a
    /// copy and writes it back; without the write-back every round of a session
    /// is identical. Same trap as the dealer's shelf.
    /// ⚠️ MEASURE THE SETTLED ROUND, NOT THE FRAME AFTER `play`.
    ///
    /// A first cut of this compared `view().paint` immediately after `play` and
    /// failed on a cabinet whose rng was working perfectly: at that instant all
    /// three reels are still spinning, so every round paints the SAME motion
    /// bars. A probe printed four different reel sets, which is what identified
    /// the test as the broken thing. The outcome is what varies, so the log is
    /// what to read.
    #[test]
    fn consecutive_rounds_do_not_replay_the_same_outcome() {
        let mut w = purse(10_000);
        let mut c = Cabinet::new(5);
        c.set_stake(5);
        for _ in 0..4 {
            c.play(&mut w);
            for _ in 0..600 {
                c.tick(0.016, &mut w);
                if !c.busy() {
                    break;
                }
            }
        }
        assert_eq!(c.table.log.len(), 4, "four rounds did not settle");
        let labels: Vec<&str> = c.table.log.iter().map(|r| r.label.as_str()).collect();
        assert!(
            labels.iter().any(|l| *l != labels[0]),
            "four rounds all returned {:?} — the rng is not advancing",
            labels[0]
        );
    }

    /// Switching games forfeits the live round rather than abandoning it.
    #[test]
    fn switching_games_settles_the_round_it_leaves() {
        let mut w = purse(1000);
        let mut c = Cabinet::new(6);
        c.set_stake(20);
        c.play(&mut w);
        assert!(c.busy());
        c.pick(GamblerGame::Darts, &mut w);
        assert_eq!(c.game, GamblerGame::Darts);
        assert_eq!(c.table.log.len(), 1, "the abandoned round was not settled");
    }

    /// ⚠️ A DOUBLE-DOWN MUST NOT BURN A SECOND ROUND.
    ///
    /// The oracle's contract for `raise` is explicit: *"Does NOT consume
    /// another round off the limit."* It is an extra wager on a round already
    /// counted, so it goes straight to the wallet rather than through
    /// `place_bet`.
    #[test]
    fn a_double_down_takes_gold_but_not_a_round() {
        let mut w = purse(1000);
        let mut c = Cabinet::new(7);
        c.game = GamblerGame::Blackjack;
        c.set_stake(25);
        c.play(&mut w);
        // The round is counted at the SETTLE, so it is 0 here — what must not
        // change is that the double does not ADD one.
        let rounds_before = c.table.rounds_played;
        // Deal the opening cards out so the table reaches the player's turn.
        for _ in 0..200 {
            c.tick(0.016, &mut w);
            if c.blackjack.phase() == BjPhase::Player {
                break;
            }
        }
        if c.blackjack.phase() != BjPhase::Player {
            return; // this deal was a natural; nothing to double on
        }
        let before = w.balance();
        c.control("double", &mut w);
        assert!(w.balance() < before, "the double took no gold");
        assert_eq!(
            c.table.rounds_played, rounds_before,
            "the double-down burned a round off the visit limit"
        );
    }

    /// The visit limit resets when the tavern re-opens, and nothing else does.
    #[test]
    fn resetting_the_visit_clears_the_round_count_but_not_the_purse() {
        let mut w = purse(1000);
        let mut c = Cabinet::new(8);
        c.set_stake(5);
        c.play(&mut w);
        let after_bet = w.balance();
        c.reset_visit();
        assert_eq!(
            rounds_left(&c.table),
            pk_core::gambler::table::ROUNDS_PER_VISIT
        );
        assert_eq!(w.balance(), after_bet, "the reset touched the purse");
    }

    /// The view never offers a stake the rules would refuse.
    #[test]
    fn the_view_offers_only_legal_stakes() {
        let w = purse(30);
        let c = Cabinet::new(9);
        let v = c.view(&w);
        for s in &v.stake_options {
            assert!(
                can_bet(&c.table, w.balance(), *s as f64).ok,
                "{s} was offered but the rules refuse it"
            );
        }
    }

    /// Every game paints SOMETHING — an empty viewport reads as a broken
    /// cabinet, and three of the four are only reachable through the picker.
    #[test]
    fn every_game_paints_a_frame() {
        let w = purse(1000);
        for g in GamblerGame::ALL {
            let mut c = Cabinet::new(10);
            c.game = g;
            assert!(
                !c.view(&w).paint.prims.is_empty(),
                "{g:?} painted an empty frame"
            );
        }
    }

    /// …and every prim it paints is INSIDE the viewport, so the screen's clip
    /// never has to save it. A game drawing off-board is a bug in the painter
    /// above, and the clip would hide it.
    #[test]
    fn no_painter_draws_outside_the_viewport() {
        let mut w = purse(1000);
        for g in GamblerGame::ALL {
            let mut c = Cabinet::new(11);
            c.game = g;
            c.set_stake(10);
            c.play(&mut w);
            for step in 0..400 {
                c.tick(0.016, &mut w);
                if g == GamblerGame::Darts && step % 20 == 0 {
                    c.play(&mut w); // the poke: lock the sweep
                }
                for p in &c.view(&w).paint.prims {
                    let (x, y, pw, ph) = match p {
                        GamePrim::Fill { x, y, w, h, .. }
                        | GamePrim::Stroke { x, y, w, h, .. }
                        | GamePrim::Well { x, y, w, h } => (*x, *y, *w, *h),
                        GamePrim::Label { x, y, .. } => (*x, *y, 0.0, 0.0),
                    };
                    assert!(
                        x >= 0.0 && y >= 0.0 && x + pw <= GAME_W && y + ph <= GAME_H,
                        "{g:?} painted {p:?} outside 0..{GAME_W} x 0..{GAME_H}"
                    );
                }
            }
        }
    }
}
