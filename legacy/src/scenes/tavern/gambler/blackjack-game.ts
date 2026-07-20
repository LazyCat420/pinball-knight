/**
 * BLACKJACK — the playable table. Rules live in `blackjack.ts` and are not
 * touched here; this file is the felt, the cards, the chips and the timing.
 *
 * The only game at the gambler with real DECISIONS, which drives most of what
 * is on screen. Everything here exists to answer one of the three questions a
 * player actually has mid-hand:
 *
 *   "what have I got?"   → both totals printed large, and SOFT totals printed
 *                          as two numbers ("7 / 17"), because a soft 17 and a
 *                          hard 17 are completely different decisions and a
 *                          single number hides that.
 *   "what can I do?"     → HIT / STAND / DOUBLE mirrored on the felt, with
 *                          DOUBLE visibly struck out once it is no longer
 *                          legal. The real buttons are DOM, but a greyed DOM
 *                          button below the canvas is not where the player is
 *                          looking.
 *   "what just happened?"→ distinct treatments per outcome rather than one
 *                          banner with different text: a bust reds out the
 *                          player's cards, a natural gilds them and flashes the
 *                          rail, a push is deliberately flat and grey.
 *
 * ── Timing ──────────────────────────────────────────────────────────────────
 * Nothing is instant. Cards SLIDE from the shoe, one at a time, in the real
 * dealing order (player, dealer, player, dealer). The hole card FLIPS through
 * an edge-on frame instead of swapping texture. The dealer's draws are spaced
 * on a beat with a rising tick. The first version resolved the dealer's whole
 * hand between two frames, which meant the most dramatic part of blackjack —
 * watching the dealer walk up to 17 and maybe past 21 — was invisible.
 *
 * The animation is COSMETIC ONLY. Every card is drawn from the deck at the
 * moment the rules say so and the outcome is settled off `settleHand()`; the
 * slide is just where it is painted on the way to its slot. An animation that
 * could disagree with the payout is the worst bug a card game can have.
 *
 * ── Why every mark is a fillRect ────────────────────────────────────────────
 * Canvas 2D anti-aliases all path geometry with no way to switch it off, so
 * `arc()`, `ctx.rotate()`, `shadowBlur` and alpha gradients all produce soft
 * fringes that read as a blurry PNG next to the rest of the game's art. The
 * betting circle is therefore rasterised by hand (`blackjack-art.ts`), card
 * shadows are hard offset rectangles, and a card sitting at an angle is sheared
 * by whole pixels per scanline (`cards-art.ts`).
 */
import {
  freshDeck,
  shuffle,
  handValue,
  isBlackjack,
  settleHand,
  dealerShouldHit,
  type Card,
} from "./blackjack";
import { drawCard, cardSize } from "./cards-art";
import { drawBettingCircle, drawChipStack, drawShoe, drawChipTray, chipStack } from "./blackjack-art";
import {
  sfxCardDeal,
  sfxHoleFlip,
  sfxChips,
  sfxDouble,
  sfxDealerTick,
  sfxBust,
  sfxBlackjack,
  sfxWin,
  sfxPush,
  sfxLoseHand,
  sfxShuffle,
} from "./blackjack-audio";
import type { CasinoGame, PlayApi } from "./index";

type Phase = "deal" | "player" | "flip" | "dealer" | "done" | "idle";

/** Seconds a card spends sliding out of the shoe. */
const SLIDE = 0.22;
/** Seconds between the two cards of the opening deal. */
const DEAL_GAP = 0.17;
/** Seconds between the dealer's draws, so the reveal has a rhythm. */
const DEAL_BEAT = 0.46;
/** Seconds the hole card spends turning over. */
const FLIP_TIME = 0.34;
/** Seconds the result holds before the table unlocks. */
const SETTLE_HOLD = 2.0;

/**
 * Frames of the slide, as a fraction of the distance travelled.
 *
 * A hand-authored table rather than an easing curve, for the same reason the
 * slot reels have one: an eased slide spends most of its life at sub-pixel
 * offsets, which on an integer grid either does nothing or snaps. Six hard
 * steps, decelerating, is a card skidding to a stop. Anything smoother would
 * need sub-pixel positions, and a card on a half pixel fringes on every edge.
 */
const SLIDE_STEPS = [0, 0.34, 0.62, 0.82, 0.94, 1];

/**
 * Width fractions of the hole card through its flip.
 *
 * Five frames with a genuine EDGE-ON one (0.06) in the middle. A card that
 * merely swaps its texture looks like a bug; a card that narrows to a line and
 * comes back reads as a physical object turning over. The face appears on the
 * frame after the edge, which is the frame the flip sound lands on.
 */
const FLIP_FRAMES = [1, 0.42, 0.06, 0.42, 1];

// ── Palette ──────────────────────────────────────────────────────────────────
// Hue-rotated ramps: felt shadows go blue-green, felt highlights go yellow-
// green, and the rail's lit edge is a warm tan against a cool brown shade.
const C_RAIL = "#3a2a1c";
const C_RAIL_HI = "#6b5236";
const C_RAIL_LO = "#1c1410";
const C_FELT = "#175c3c";
const C_FELT_HI = "#1f7a4c";
const C_FELT_LO = "#0e3d29";
const C_FELT_INK = "#0a2a1d";
const C_PRINT = "#d8c88a";
const C_PRINT_DIM = "#8a9a72";
const C_STITCH = "#e6dcae";

const C_PLATE = "#0c2119";
const C_PLATE_EDGE = "#2c5a42";
const C_TEXT = "#e4ecd8";
const C_DIM = "#7f9384";
const C_WIN = "#f0c040";
const C_WIN_HI = "#fff0b0";
const C_LOSE = "#e0505a";
const C_COOL = "#6fd0e8";

/** A card on the table, with the bookkeeping the animation needs. */
interface Dealt {
  card: Card;
  /** Table clock at which this card started sliding out of the shoe. */
  t0: number;
  /** Has its deal sound fired? */
  sounded: boolean;
  /**
   * Whole-pixel shear, so a hand doesn't look machine-stacked.
   *
   * Deterministic from the slot index rather than random: a card that
   * re-rolled its angle every frame would jitter, and one that re-rolled per
   * hand would make the table look unsteady between rounds.
   */
  lean: number;
}

const LEANS = [0, 2, -2, 1, -1, 2, -2, 0];

/** The rules functions take plain cards; the animation state stays here. */
const plain = (d: Dealt[]): Card[] => d.map((x) => x.card);

export function createBlackjackGame(): CasinoGame {
  let phase: Phase = "idle";
  let deck: Card[] = [];
  let cursor = 0;
  let player: Dealt[] = [];
  let dealer: Dealt[] = [];
  let stakeNow = 0;
  let wagered = 0;
  let doubled = false;
  let api: PlayApi | null = null;
  /** Seconds since the round started. Drives every deal animation. */
  let clock = 0;
  let beat = 0;
  let flipT = 0;
  let settleT = 0;
  let resultLabel = "";
  let resultMult = 0;
  let outcome = "";
  /** Dealer cards drawn since the reveal — drives the rising draw tick. */
  let dealerDraws = 0;
  /** Guards the once-per-round contract on `resolve`. */
  let resolved = true;
  /** Has the flip cue fired for this reveal? */
  let flipSounded = false;
  /** Set while the table is dark, so the felt still says something. */
  let idleT = 0;

  const draw = (): Card => deck[cursor++];

  const deal = (into: Dealt[], at: number): void => {
    into.push({ card: draw(), t0: at, sounded: false, lean: LEANS[into.length % LEANS.length] });
  };

  /** Can the player still act on this hand? */
  const canAct = (): boolean => phase === "player" && !handValue(plain(player)).bust;

  /** True once every card on the table has finished sliding. */
  const settled = (): boolean =>
    [...player, ...dealer].every((d) => clock >= d.t0 + SLIDE);

  function finish(): void {
    const s = settleHand(plain(player), plain(dealer));
    resultLabel = s.label;
    resultMult = s.multiplier;
    outcome = s.outcome;
    phase = "done";
    settleT = SETTLE_HOLD;

    // One cue per outcome CLASS, not per label — the player should be able to
    // tell a push from a loss with their eyes shut.
    if (s.outcome === "player-bust") sfxBust();
    else if (s.outcome === "player-blackjack") sfxBlackjack();
    else if (s.multiplier > 1) sfxWin();
    else if (s.multiplier === 1) sfxPush();
    else sfxLoseHand();

    // `resolved` makes the once-per-round contract explicit rather than relying
    // on `api` having been nulled. Both guards stay: settling twice would burn
    // a second round off the per-visit limit and could pay the hand twice.
    if (!resolved) {
      resolved = true;
      api?.resolve({
        game: "blackjack",
        // Report the TOTAL wagered so the shell's net and any RTP read are
        // honest about a double — the extra stake was already taken via raise().
        stake: wagered,
        payout: Math.round(wagered * s.multiplier),
        label: s.label,
      });
    }
    api = null;
  }

  /**
   * Player is done acting — turn the hole card over, then let the dealer play.
   *
   * `extra` buys time for a card that is still in the air (the one that busted
   * the hand, or the one taken on a double) to land BEFORE the reveal starts.
   * Turning the hole card over on top of a card mid-slide reads as two
   * unrelated things happening at once.
   */
  function toReveal(extra = 0): void {
    phase = "flip";
    flipT = FLIP_TIME + extra;
    flipSounded = false;
  }

  return {
    id: "blackjack",
    name: "BLACKJACK",
    blurb: "dealer stands on all 17 · blackjack pays 3:2 · double on your first two cards",

    busy: () => phase === "deal" || phase === "player" || phase === "flip" || phase === "dealer",

    controls() {
      if (phase !== "player") return [];
      const two = player.length === 2;
      return [
        { id: "hit", label: "HIT" },
        { id: "stand", label: "STAND" },
        // Double is only legal on the opening two cards, and only if the purse
        // can cover a second stake — the shell's raise() is the authority.
        { id: "double", label: `DOUBLE +${stakeNow}g`, disabled: !two || doubled },
      ];
    },

    onControl(id): void {
      if (!canAct()) return;
      if (id === "hit") {
        deal(player, clock);
        // A bust ends the hand without the dealer ever drawing — but the card
        // that busted still has to land, and the hole card still turns over, or
        // the player never sees what they were up against.
        if (handValue(plain(player)).bust) toReveal(SLIDE);
        return;
      }
      if (id === "stand") {
        toReveal();
        return;
      }
      if (id === "double") {
        if (player.length !== 2 || doubled) return;
        // Ask the shell for the extra stake. If the purse can't cover it the
        // hand simply continues undoubled rather than doubling for free.
        if (!api?.raise(stakeNow)) return;
        doubled = true;
        wagered = stakeNow * 2;
        sfxDouble();
        deal(player, clock);
        // A double takes exactly one card, then stands.
        toReveal(SLIDE);
      }
    },

    play(stake, playApi): void {
      deck = shuffle(freshDeck());
      cursor = 0;
      stakeNow = stake;
      wagered = stake;
      doubled = false;
      api = playApi;
      resolved = false;
      player = [];
      dealer = [];
      clock = 0;
      flipT = 0;
      settleT = 0;
      dealerDraws = 0;
      resultLabel = "";
      resultMult = 0;
      outcome = "";
      idleT = 0;

      // Real dealing order: player, dealer, player, dealer. The hole card is
      // the LAST one out of the shoe, which is why it's the one left face down.
      deal(player, 0);
      deal(dealer, DEAL_GAP);
      deal(player, DEAL_GAP * 2);
      deal(dealer, DEAL_GAP * 3);

      sfxShuffle();
      sfxChips(chipStack(stake).length);
      phase = "deal";
    },

    render(ctx, w, h, dt): void {
      clock += dt;

      // ── Phase clock ──
      if (phase === "deal") {
        if (settled()) {
          // A natural on either side ends the hand immediately — nobody acts,
          // but the hole card must still be turned over to show why.
          if (isBlackjack(plain(player)) || isBlackjack(plain(dealer))) toReveal();
          else phase = "player";
        }
      } else if (phase === "flip") {
        flipT -= dt;
        // The cue fires when the card actually STARTS turning, not when the
        // phase was entered — those are different moments whenever a card was
        // still sliding in.
        if (!flipSounded && flipT <= FLIP_TIME) {
          flipSounded = true;
          sfxHoleFlip();
        }
        if (flipT <= 0) {
          if (handValue(plain(player)).bust) finish();
          else {
            phase = "dealer";
            beat = DEAL_BEAT;
          }
        }
      } else if (phase === "dealer") {
        beat -= dt;
        if (beat <= 0 && settled()) {
          beat = DEAL_BEAT;
          if (isBlackjack(plain(player)) || isBlackjack(plain(dealer))) finish();
          else if (dealerShouldHit(plain(dealer))) {
            deal(dealer, clock);
            dealerDraws++;
            sfxDealerTick(dealerDraws);
          } else finish();
        }
      } else if (phase === "done" && settleT > 0) {
        settleT -= dt;
        if (settleT <= 0) phase = "idle";
      } else if (phase === "idle") {
        idleT += dt;
      }

      // ── Primitives ──
      const box = (x: number, y: number, bw: number, bh: number, col: string): void => {
        ctx.fillStyle = col;
        ctx.fillRect(Math.round(x), Math.round(y), Math.round(bw), Math.round(bh));
      };
      /** A 1px outline as four fills — `strokeRect` straddles the pixel grid. */
      const frame = (x: number, y: number, bw: number, bh: number, col: string, weight = 1): void => {
        box(x, y, bw, weight, col);
        box(x, y + bh - weight, bw, weight, col);
        box(x, y, weight, bh, col);
        box(x + bw - weight, y, weight, bh, col);
      };
      /** Text with a hard 1px drop shadow. No `shadowBlur` — that would be soft. */
      const label = (s: string, x: number, y: number, size: number, col: string, align: CanvasTextAlign = "left"): void => {
        ctx.font = `${size}px 'Press Start 2P', monospace`;
        ctx.textAlign = align;
        ctx.textBaseline = "top";
        ctx.fillStyle = C_FELT_INK;
        ctx.fillText(s, Math.round(x) + 1, Math.round(y) + 1);
        ctx.fillStyle = col;
        ctx.fillText(s, Math.round(x), Math.round(y));
      };

      // ── Layout ──
      const size = cardSize(50);
      const gap = 4;
      const pitch = size.w + gap;
      const SHOE = { x: 6, y: 8, w: 44, h: 52 };
      const cardX = 74;
      const dealerY = 14;
      const playerY = 104;
      const panelX = 376;
      const panelW = w - panelX - 6;
      // The betting spot sits UNDER the player's opening two cards, the way it
      // does on a real table. Parked out in the middle of the felt it read as
      // unrelated to the hand above it.
      const circleX = 130;
      const circleY = 174;
      /** Where a card leaves the shoe — its delivery lip, not its centre. */
      const lip = { x: SHOE.x + SHOE.w - 12, y: SHOE.y + SHOE.h - 16 };

      // ── Rail and felt ──
      box(0, 0, w, h, C_RAIL);
      box(0, 0, w, 2, C_RAIL_HI);
      box(0, 0, 2, h, C_RAIL_HI);
      box(0, h - 2, w, 2, C_RAIL_LO);
      box(w - 2, 0, 2, h, C_RAIL_LO);
      box(4, 4, w - 8, h - 8, C_FELT);
      // Felt light: a lit band under the top rail, shadow along the bottom. Two
      // flat tones, since a gradient here would be the only soft thing on the
      // table and would show as banding at this palette depth anyway.
      box(4, 4, w - 8, 3, C_FELT_HI);
      box(4, h - 7, w - 8, 3, C_FELT_LO);
      frame(4, 4, w - 8, h - 8, C_FELT_INK);

      // ── Printed rules ──
      // The arc a real table has, and it says what this game ACTUALLY does:
      // `dealerShouldHit()` stands on all 17 including soft, so the classic
      // "DEALER MUST HIT SOFT 17" would be a printed lie. The stakes here are
      // real — a player who reads that and expects the dealer to hit a soft 17
      // is playing a different game from the one the code runs.
      label("BLACKJACK PAYS 3 TO 2", w / 2 - 60, 72, 8, C_PRINT, "center");
      label("DEALER STANDS ON ALL 17", w / 2 - 60, 86, 7, C_PRINT_DIM, "center");
      // Hairlines above and below the print, following the arc of the table.
      for (const [ly, col] of [[68, C_PRINT_DIM], [98, C_PRINT_DIM]] as Array<[number, string]>) {
        for (let i = 0; i < 21; i++) {
          // A shallow arc, stepped by hand: the ends drop away from the centre.
          const d = i - 10;
          const dip = Math.round((d * d) / 22);
          box(w / 2 - 60 - 100 + i * 10, ly + (ly < 80 ? dip : -dip), 6, 1, col);
        }
      }

      // The rest of the house rules, printed small on the apron where a real
      // table prints them. Also all true of `blackjack.ts`: one deck, reshuffled
      // every round, and neither split nor insurance is implemented. Printing
      // the ABSENCES matters as much as the payouts — a player expecting to
      // split a pair of eights needs to find that out before they bet, not
      // after they are dealt them.
      label("SINGLE DECK", 270, 168, 7, C_PRINT_DIM, "center");
      label("NO SPLITS - NO INSURANCE", 270, 180, 7, C_PRINT_DIM, "center");

      // ── Fixtures ──
      drawShoe(ctx, SHOE.x, SHOE.y, SHOE.w, SHOE.h);
      drawChipTray(ctx, 8, 168, 58, 24);

      // ── Betting circle and the player's bet ──
      drawBettingCircle(ctx, circleX, circleY, 17, C_PRINT_DIM, C_STITCH);
      if (phase !== "idle" && wagered > 0) {
        // The bet as CHIPS, in denomination colours — a player who has seen a
        // chip before can read the size of the bet without a number.
        drawChipStack(ctx, circleX, circleY + 10, wagered);
        label(`${wagered}g`, circleX + 26, circleY - 3, 7, doubled ? C_WIN : C_PRINT);
      } else {
        label("BET", circleX, circleY - 3, 7, C_PRINT_DIM, "center");
      }

      // ── Cards ──
      /**
       * Where a card is drawn on its way in.
       *
       * Position is quantised to `SLIDE_STEPS` and then rounded, so the card is
       * only ever on whole pixels. Interpolating smoothly would put it on half
       * pixels for most of the slide and fringe every edge of the art.
       */
      const slot = (d: Dealt, i: number, y: number): { x: number; y: number; arrived: boolean } => {
        const tx = cardX + i * pitch;
        const p = (clock - d.t0) / SLIDE;
        if (p >= 1) return { x: tx, y, arrived: true };
        if (p <= 0) return { x: lip.x, y: lip.y, arrived: false };
        const k = SLIDE_STEPS[Math.min(SLIDE_STEPS.length - 1, Math.floor(p * SLIDE_STEPS.length))];
        return {
          x: Math.round(lip.x + (tx - lip.x) * k),
          y: Math.round(lip.y + (y - lip.y) * k),
          arrived: false,
        };
      };

      const pv = handValue(plain(player));
      const bust = pv.bust;
      const natural = outcome === "player-blackjack";
      /** Ring the player's cards when the hand is decided. */
      const playerRing = phase === "done" ? (bust ? C_LOSE : natural ? C_WIN_HI : resultMult > 1 ? C_WIN : null) : null;

      /** The hole card is face down until the flip finishes. */
      const flipFrame = (): number => {
        if (phase === "player" || phase === "deal") return 0;
        if (phase !== "flip") return FLIP_FRAMES.length - 1;
        // The flip runs at the END of `flipT` so a bust card can land first.
        const into = FLIP_TIME - Math.min(FLIP_TIME, flipT);
        return Math.min(FLIP_FRAMES.length - 1, Math.floor((into / FLIP_TIME) * FLIP_FRAMES.length));
      };
      const hf = flipFrame();
      const holeDown = hf < Math.floor(FLIP_FRAMES.length / 2);

      const row = (hand: Dealt[], y: number, hole: boolean, ring: string | null): void => {
        hand.forEach((d, i) => {
          const at = slot(d, i, y);
          // A card in flight has no shadow — a shadow pinned under a moving
          // object is what makes cheap animation look pasted on.
          const isHole = hole && i === 1;
          drawCard(ctx, d.card, at.x, at.y, size, {
            faceUp: !(isHole && holeDown),
            lean: at.arrived ? d.lean : 0,
            squeeze: isHole && phase === "flip" ? FLIP_FRAMES[hf] : 1,
            shadow: at.arrived,
            outline: at.arrived ? ring : null,
          });
          if (!d.sounded && clock >= d.t0) {
            d.sounded = true;
            sfxCardDeal();
          }
        });
      };

      row(dealer, dealerY, true, null);
      row(player, playerY, false, playerRing);

      label("DEALER", cardX, 5, 7, C_PRINT_DIM);
      label("YOU", cardX, 95, 7, C_PRINT_DIM);

      // ── Readouts ──
      const plate = (y: number, ph: number, title: string): void => {
        box(panelX, y, panelW, ph, C_PLATE);
        frame(panelX, y, panelW, ph, C_PLATE_EDGE);
        box(panelX + 1, y + 1, panelW - 2, 1, "#123527");
        label(title, panelX + 5, y + 4, 7, C_DIM);
      };

      /**
       * A total, printed as TWO numbers when the hand is soft.
       *
       * "7 / 17" rather than "17 S". A soft 17 is the hand where basic strategy
       * says hit and a hard 17 is the hand where it says stand, so which one
       * the player is holding is the single most decision-relevant fact on the
       * table — and an "S" suffix makes them do the subtraction themselves.
       */
      const totalText = (cards: Card[]): string => {
        // An empty hand scores 0, and a table showing "0 / 0" before the first
        // deal reads as broken rather than as waiting.
        if (cards.length === 0) return "--";
        const v = handValue(cards);
        if (v.soft && !v.bust) return `${v.total - 10} / ${v.total}`;
        return String(v.total);
      };

      plate(8, 48, "DEALER");
      const dShown = holeDown && dealer.length > 0 ? `${handValue([dealer[0].card]).total} + ?` : totalText(plain(dealer));
      const dv = handValue(plain(dealer));
      label(dShown, panelX + 5, 24, dShown.length > 6 ? 12 : 16, holeDown ? C_COOL : dv.bust ? C_LOSE : C_TEXT);
      if (!holeDown && dv.bust) label("BUST", panelX + panelW - 5, 14, 7, C_LOSE, "right");

      plate(60, 48, "YOU");
      const pShown = totalText(plain(player));
      label(pShown, panelX + 5, 76, pShown.length > 6 ? 12 : 16, bust ? C_LOSE : C_TEXT);
      if (bust) label("BUST", panelX + panelW - 5, 66, 7, C_LOSE, "right");
      else if (isBlackjack(plain(player)) && !holeDown) label("21!", panelX + panelW - 5, 66, 7, C_WIN, "right");

      plate(112, 34, "WAGER");
      label(wagered > 0 ? `${wagered}g` : "--", panelX + 5, 128, 12, doubled ? C_WIN : C_TEXT);
      if (doubled) label("x2", panelX + panelW - 5, 130, 7, C_WIN, "right");

      // ── The move plate ── HIT / STAND / DOUBLE mirrored on the felt.
      plate(150, 44, "YOUR MOVE");
      if (phase === "player") {
        const twoCards = player.length === 2 && !doubled;
        const opts: Array<[string, boolean]> = [["HIT", true], ["STAND", true], ["DOUBLE", twoCards]];
        opts.forEach(([name, live], i) => {
          const oy = 166 + i * 9;
          // "Available" is a colour swap plus a strike-through, never a lower
          // alpha — a half-transparent label over the plate muddies both.
          label(name, panelX + 12, oy, 7, live ? C_TEXT : "#4a5a50");
          if (!live) box(panelX + 11, oy + 3, 40, 1, "#4a5a50");
          // A blinking caret on the row the eye should start at.
          if (i === 0 && Math.floor(clock * 3) % 2 === 0) label(">", panelX + 5, oy, 7, C_WIN);
        });
      } else {
        const waiting =
          phase === "deal" ? "DEALING" :
          phase === "flip" ? "REVEALING" :
          phase === "dealer" ? "DEALER DRAWS" :
          phase === "done" ? "HAND OVER" : "PLACE YOUR BET";
        label(waiting, panelX + 5, 166, 7, phase === "dealer" ? C_COOL : C_DIM);
        if (phase === "dealer") {
          // A ticking row of pips, so the dealer's beat is visible as well as
          // audible — the pause between draws should read as deliberate.
          for (let i = 0; i < 3; i++) {
            const on = Math.floor(clock * 4) % 3 === i;
            box(panelX + 6 + i * 8, 180, 5, 5, on ? C_COOL : "#1d4536");
          }
        }
      }

      // ── The result ─────────────────────────────────────────────────────────
      // A plate on the felt rather than bare text, and a different TREATMENT
      // per outcome rather than the same banner in three colours.
      if (phase === "done" && settleT > 0) {
        const win = resultMult > 1;
        const push = resultMult === 1;
        const col = win ? C_WIN : push ? C_TEXT : C_LOSE;
        const bw = Math.min(300, 26 + resultLabel.length * 10);
        const bx = Math.round(w / 2 - 60 - bw / 2);
        const by = 68;
        box(bx + 3, by + 3, bw, 30, C_FELT_INK);
        box(bx, by, bw, 30, C_PLATE);
        frame(bx, by, bw, 30, col, 2);
        // A natural gets the plate PULSING; everything else holds steady. The
        // rarest outcome should be the only one that moves.
        const pulse = natural && Math.floor(clock * 8) % 2 === 0;
        label(resultLabel, bx + bw / 2, by + 11, 9, pulse ? C_WIN_HI : col, "center");

        if (natural) {
          // Rail flash — the only screen-wide effect in the game, reserved for
          // the one outcome that pays 3:2.
          const edge = Math.floor(clock * 12) % 2 === 0 ? C_WIN_HI : C_WIN;
          box(0, 0, w, 2, edge);
          box(0, h - 2, w, 2, edge);
          box(0, 0, 2, h, edge);
          box(w - 2, 0, 2, h, edge);
        }
      } else if (phase === "idle") {
        const blink = Math.floor(idleT * 1.5) % 2 === 0;
        label(blink ? "PLACE YOUR BET" : "TABLE OPEN", w / 2 - 60, 118, 8, blink ? C_PRINT : C_PRINT_DIM, "center");
      }
    },
  };
}
