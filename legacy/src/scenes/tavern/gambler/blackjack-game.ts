/**
 * BLACKJACK — the playable table. Rules live in `blackjack.ts`.
 *
 * The only game here with real DECISIONS, so it's the only one whose controls
 * change mid-round: HIT / STAND / DOUBLE appear while the hand is live and the
 * shell's PLAY button deals the next hand. It's also the only one that can raise
 * the wager mid-round, which goes through the shell's `raise()` so `table.ts`
 * stays the single thing that touches gold.
 *
 * The dealer's hole card stays face down until the player stands or busts. That
 * concealment is the entire tension of the hand, and it's why the card art needed
 * a back design at all.
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
import type { CasinoGame, PlayApi } from "./index";

type Phase = "idle" | "player" | "dealer" | "done";

/** Seconds between the dealer's draws, so the reveal has a rhythm. */
const DEAL_BEAT = 0.42;
/** Seconds the result holds before the table unlocks. */
const SETTLE_HOLD = 1.6;

const C_FELT = "#12281f";
const C_FELT_EDGE = "#0b1a14";
const C_TEXT = "#c9d1e0";
const C_DIM = "#8a8578";
const C_WIN = "#f0c040";
const C_LOSE = "#c0455a";

export function createBlackjackGame(): CasinoGame {
  let phase: Phase = "idle";
  let deck: Card[] = [];
  let cursor = 0;
  let player: Card[] = [];
  let dealer: Card[] = [];
  let stakeNow = 0;
  let wagered = 0;
  let doubled = false;
  let api: PlayApi | null = null;
  let beat = 0;
  let settleT = 0;
  let resultLabel = "";
  let resultMult = 0;

  const draw = (): Card => deck[cursor++];

  /** Can the player still act on this hand? */
  const canAct = (): boolean => phase === "player" && !handValue(player).bust;

  function finish(): void {
    const s = settleHand(player, dealer);
    resultLabel = s.label;
    resultMult = s.multiplier;
    phase = "done";
    settleT = SETTLE_HOLD;
    api?.resolve({
      game: "blackjack",
      // Report the TOTAL wagered so the shell's net and any RTP read are honest
      // about a double — the extra stake was already taken via raise().
      stake: wagered,
      payout: Math.round(wagered * s.multiplier),
      label: s.label,
    });
    api = null;
  }

  /** Player is done acting — reveal and let the dealer play out. */
  function toDealer(): void {
    if (handValue(player).bust) {
      finish();
      return;
    }
    phase = "dealer";
    beat = DEAL_BEAT;
  }

  return {
    id: "blackjack",
    name: "BLACKJACK",
    blurb: "dealer stands on all 17 · blackjack pays 3:2 · double on your first two cards",

    busy: () => phase === "player" || phase === "dealer",

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
        player.push(draw());
        if (handValue(player).bust) toDealer();
        return;
      }
      if (id === "stand") {
        toDealer();
        return;
      }
      if (id === "double") {
        if (player.length !== 2 || doubled) return;
        // Ask the shell for the extra stake. If the purse can't cover it the
        // hand simply continues undoubled rather than doubling for free.
        if (!api?.raise(stakeNow)) return;
        doubled = true;
        wagered = stakeNow * 2;
        player.push(draw());
        toDealer(); // a double takes exactly one card, then stands
      }
    },

    play(stake, playApi): void {
      deck = shuffle(freshDeck());
      cursor = 0;
      stakeNow = stake;
      wagered = stake;
      doubled = false;
      api = playApi;
      player = [draw(), draw()];
      dealer = [draw(), draw()];
      settleT = 0;
      resultLabel = "";
      resultMult = 0;

      // A natural on either side ends the hand immediately — nobody acts.
      if (isBlackjack(player) || isBlackjack(dealer)) {
        phase = "dealer";
        beat = DEAL_BEAT;
        return;
      }
      phase = "player";
    },

    render(ctx, w, h, dt): void {
      if (phase === "dealer") {
        beat -= dt;
        if (beat <= 0) {
          beat = DEAL_BEAT;
          if (isBlackjack(player) || isBlackjack(dealer)) finish();
          else if (dealerShouldHit(dealer)) dealer.push(draw());
          else finish();
        }
      } else if (phase === "done" && settleT > 0) {
        settleT -= dt;
        if (settleT <= 0) phase = "idle";
      }

      // ── Felt ──
      ctx.fillStyle = C_FELT_EDGE;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = C_FELT;
      ctx.fillRect(4, 4, w - 8, h - 8);

      const size = cardSize(52);
      const gap = 6;
      /** Hide the dealer's hole card until the player is finished. */
      const holeDown = phase === "player";

      const row = (cards: Card[], y: number, hideSecond: boolean): void => {
        const totalW = cards.length * size.w + (cards.length - 1) * gap;
        const x0 = Math.round((w - totalW) / 2) - 60;
        cards.forEach((card, i) => {
          drawCard(ctx, card, x0 + i * (size.w + gap), y, size, !(hideSecond && i === 1));
        });
      };

      ctx.font = "9px 'Press Start 2P', monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";

      // Dealer
      ctx.fillStyle = C_DIM;
      ctx.fillText("DEALER", 14, 12);
      row(dealer, 24, holeDown);

      // Player
      ctx.fillStyle = C_DIM;
      ctx.fillText("YOU", 14, h - 76);
      row(player, h - 64, false);

      // ── Totals ──
      const px = w - 150;
      const pv = handValue(player);
      ctx.textAlign = "left";

      ctx.font = "9px 'Press Start 2P', monospace";
      ctx.fillStyle = C_DIM;
      ctx.fillText("DEALER", px, 12);
      ctx.font = "16px 'Press Start 2P', monospace";
      ctx.fillStyle = C_TEXT;
      // While the hole card is down, only the up-card counts — showing the real
      // total would hand the player the one piece of information the game hides.
      ctx.fillText(holeDown && dealer.length > 0 ? `${handValue([dealer[0]]).total}?` : String(handValue(dealer).total), px, 26);

      ctx.font = "9px 'Press Start 2P', monospace";
      ctx.fillStyle = C_DIM;
      ctx.fillText("YOU", px, h - 76);
      ctx.font = "16px 'Press Start 2P', monospace";
      ctx.fillStyle = pv.bust ? C_LOSE : C_TEXT;
      ctx.fillText(`${pv.total}${pv.soft && !pv.bust ? " S" : ""}`, px, h - 62);

      if (doubled) {
        ctx.font = "8px 'Press Start 2P', monospace";
        ctx.fillStyle = C_WIN;
        ctx.fillText(`DOUBLED ${wagered}g`, px, h - 40);
      }

      // ── Result banner ──
      if (phase === "done" && settleT > 0) {
        ctx.font = "12px 'Press Start 2P', monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = resultMult > 1 ? C_WIN : resultMult === 1 ? C_TEXT : C_LOSE;
        ctx.fillText(resultLabel, w / 2, Math.round(h / 2) - 6);
      } else if (phase === "idle") {
        ctx.font = "9px 'Press Start 2P', monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = C_DIM;
        ctx.fillText("PLAY TO DEAL", w / 2, Math.round(h / 2) - 4);
      }
    },
  };
}
