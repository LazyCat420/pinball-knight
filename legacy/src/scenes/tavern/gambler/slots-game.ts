/**
 * SLOTS — the playable machine. Logic lives in `slots.ts`; this is presentation.
 *
 * The outcome is decided the instant you pull, not when the reels stop. That is
 * how real machines work and it matters here for a specific reason: it means the
 * animation can never disagree with the payout. A reel that "lands" somewhere
 * and then pays something else is the single worst bug a slot machine can have.
 *
 * The drama is entirely in the STOP ORDER — reels halt left to right with a gap
 * between each, so a matching first two leaves you watching the third. That gap
 * is the whole game; everything else is decoration.
 */
import { spin, REEL_STRIP, type Symbol, type SpinOutcome } from "./slots";
import { drawSymbol as paintSymbol, SYM_GRID, type SymbolInk } from "./symbols";
import type { CasinoGame } from "./index";
import type { RoundResult } from "./table";

/** Seconds each reel spins before it may stop, indexed by reel. */
const STOP_AT = [0.7, 1.25, 1.95];
/** How long the win banner holds before controls unlock. */
const SETTLE_HOLD = 0.9;

/** Rows of symbols visible per reel window. Odd, so one is centred. */
const ROWS = 3;

const COL_W = 96;
const ROW_H = 46;
const REEL_GAP = 14;

/** Palette, matched to the rest of the tavern. */
const C_FRAME = "#544e63";
const C_WIN = "#f0c040";
const C_DIM = "#3a4152";

/** base / highlight / ink per symbol — the three tones each painter uses. */
const SYMBOL_INK: Record<Symbol, SymbolInk> = {
  ball: { base: "#9aa4b4", hi: "#e8eef7", ink: "#4a5364" },
  bumper: { base: "#2e9d8a", hi: "#7ff0d8", ink: "#123a34" },
  flipper: { base: "#c07a1e", hi: "#f8c66a", ink: "#5a3608" },
  target: { base: "#7a4fc0", hi: "#c9a4f5", ink: "#2e1a52" },
  jackpot: { base: "#e0a92c", hi: "#fff0b0", ink: "#6a4a06" },
  skull: { base: "#8f1f2a", hi: "#d85a64", ink: "#2a0a0e" },
};

/** Device pixels per symbol grid cell. Whole number, or the art fringes. */
const SYM_SCALE = 3;

export function createSlotsGame(): CasinoGame {
  let t = 0;
  let spinning = false;
  let outcome: SpinOutcome | null = null;
  let stakeNow = 0;
  let resolveFn: ((r: RoundResult) => void) | null = null;
  let settleT = 0;
  /** Per-reel scroll offset while spinning, in symbol units. */
  const offset = [0, 0, 0];
  const speed = [22, 19, 16];

  /** Has reel `i` come to rest? */
  const stopped = (i: number): boolean => !spinning || t >= STOP_AT[i];

  const symbolAt = (reel: number, row: number): Symbol => {
    // While spinning, scroll the strip; once stopped, show the outcome centred.
    if (!stopped(reel) || !outcome) {
      const k = Math.floor(offset[reel] + row);
      return REEL_STRIP[((k % REEL_STRIP.length) + REEL_STRIP.length) % REEL_STRIP.length];
    }
    if (row === 1) return outcome.reels[reel];
    // Neighbours come off the strip around the landed symbol, so the window
    // looks like a real reel rather than three floating symbols.
    const idx = REEL_STRIP.indexOf(outcome.reels[reel]);
    const k = idx + (row - 1);
    return REEL_STRIP[((k % REEL_STRIP.length) + REEL_STRIP.length) % REEL_STRIP.length];
  };

  function drawSymbol(ctx: CanvasRenderingContext2D, s: Symbol, cx: number, cy: number, lit: boolean, blur: number): void {
    const size = SYM_GRID * SYM_SCALE;
    const ox = Math.round(cx - size / 2);
    const oy = Math.round(cy - size / 2);
    ctx.save();
    ctx.globalAlpha = lit ? 1 : 0.45;
    if (blur > 0) {
      // Motion smear as a solid bar, NOT a real blur — softness is exactly what
      // a pixel look cannot have, so a spinning reel gets a hard streak instead.
      ctx.globalAlpha *= 0.5;
      ctx.fillStyle = SYMBOL_INK[s].base;
      ctx.fillRect(ox + SYM_SCALE * 2, oy - blur, size - SYM_SCALE * 4, size + blur * 2);
      ctx.restore();
      return;
    }
    paintSymbol(ctx, s, SYMBOL_INK[s], ox, oy, SYM_SCALE);
    ctx.restore();
  }

  return {
    id: "slots",
    name: "SLOTS",
    blurb: "three of a kind pays · any pair pays small · three jackpots pays 25x",

    busy: () => spinning,

    poke(): void {
      // Slamming the button while the reels turn is a slot-machine reflex, so
      // honour it: bring the next unstopped reel forward rather than ignoring it.
      if (!spinning) return;
      for (let i = 0; i < 3; i++) {
        if (t < STOP_AT[i]) {
          STOP_AT[i] = Math.max(t + 0.08, STOP_AT[i] - 0.35);
          break;
        }
      }
    },

    play(stake, resolve): void {
      // Decide FIRST. The animation is then guaranteed to show what was paid.
      outcome = spin();
      stakeNow = stake;
      resolveFn = resolve;
      spinning = true;
      t = 0;
      settleT = 0;
      STOP_AT[0] = 0.7;
      STOP_AT[1] = 1.25;
      STOP_AT[2] = 1.95;
    },

    render(ctx, w, h, dt): void {
      t += dt;

      if (spinning) {
        for (let i = 0; i < 3; i++) if (!stopped(i)) offset[i] += speed[i] * dt;
        if (stopped(0) && stopped(1) && stopped(2)) {
          spinning = false;
          settleT = SETTLE_HOLD;
          if (outcome && resolveFn) {
            const payout = Math.round(stakeNow * outcome.multiplier);
            resolveFn({ game: "slots", stake: stakeNow, payout, label: outcome.label });
            resolveFn = null;
          }
        }
      } else if (settleT > 0) {
        settleT -= dt;
      }

      ctx.fillStyle = "#05070b";
      ctx.fillRect(0, 0, w, h);

      const totalW = COL_W * 3 + REEL_GAP * 2;
      const x0 = Math.floor((w - totalW) / 2);
      const y0 = Math.floor((h - ROW_H * ROWS) / 2);
      const won = !spinning && outcome !== null && outcome.multiplier > 0;
      const flashOn = won && Math.floor(t * 6) % 2 === 0;

      for (let r = 0; r < 3; r++) {
        const rx = x0 + r * (COL_W + REEL_GAP);

        // Window
        ctx.fillStyle = "#12161f";
        ctx.fillRect(rx, y0, COL_W, ROW_H * ROWS);

        for (let row = 0; row < ROWS; row++) {
          const cy = y0 + row * ROW_H + ROW_H / 2;
          const centre = row === 1;
          const blur = stopped(r) ? 0 : Math.min(10, speed[r] * 0.4);
          drawSymbol(ctx, symbolAt(r, row), rx + COL_W / 2, cy, centre, blur);
        }

        // Frame — lights up on a win.
        ctx.strokeStyle = flashOn ? C_WIN : C_FRAME;
        ctx.lineWidth = 2;
        ctx.strokeRect(rx + 1, y0 + 1, COL_W - 2, ROW_H * ROWS - 2);
      }

      // The payline across the centre row — where the game is actually decided.
      const lineY = y0 + ROW_H + ROW_H / 2;
      ctx.strokeStyle = won ? C_WIN : C_DIM;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0 - 8, lineY + 0.5);
      ctx.lineTo(x0 + totalW + 8, lineY + 0.5);
      ctx.stroke();

      if (won && settleT > 0) {
        ctx.font = "12px 'Press Start 2P', monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = C_WIN;
        ctx.fillText(outcome!.label, w / 2, 10);
      }
    },
  };
}
