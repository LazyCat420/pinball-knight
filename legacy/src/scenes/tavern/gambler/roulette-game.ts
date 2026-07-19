/**
 * ROULETTE — the playable wheel. Pricing lives in `roulette.ts`.
 *
 * Same contract as slots: the pocket is drawn the instant you commit, and the
 * animation is then steered to land on it. A wheel that spins "honestly" and
 * pays whatever it happens to hit sounds purer, but it means the payout can
 * disagree with the visual on any rounding error — and here it would also make
 * the deceleration curve part of the odds, which is not something you can test.
 *
 * The ball rides the outer rail, bleeds speed, then drops in — a pinball orbit,
 * which is the whole reason this reads as belonging in the tavern.
 */
import { POCKETS, colorOf, settleBet, BETS, type BetDef } from "./roulette";
import type { CasinoGame } from "./index";
import type { RoundResult } from "./table";

/** Seconds of orbit before the ball drops. */
const SPIN_TIME = 2.6;
/** Seconds the result holds before controls unlock. */
const SETTLE_HOLD = 1.0;

const C_RED = "#a8323c";
const C_BLACK = "#1e222c";
const C_GREEN = "#2e7d4f";
const C_RIM = "#544e63";
const C_BALL = "#e8eef7";
const C_WIN = "#f0c040";
const C_TEXT = "#c9d1e0";

const POCKET_FILL: Record<string, string> = { red: C_RED, black: C_BLACK, green: C_GREEN };

export function createRouletteGame(): CasinoGame {
  let t = 0;
  let spinning = false;
  let settleT = 0;
  let pocket = 0;
  let stakeNow = 0;
  let resolveFn: ((r: RoundResult) => void) | null = null;
  /** Which bet the player has selected. Defaults to the simplest one. */
  let bet: BetDef = BETS[0];
  /** Ball angle in radians, integrated so deceleration reads as real. */
  let angle = 0;
  let landedAngle = 0;

  /** Angle of a pocket's centre. Pocket 0 sits at the top. */
  const pocketAngle = (n: number): number => (n / POCKETS) * Math.PI * 2 - Math.PI / 2;

  return {
    id: "roulette",
    name: "ROULETTE",
    blurb: "0-18, single zero · colour/parity/half pay 2x · thirds 3x · a number 18x",

    busy: () => spinning,

    controls: () => BETS.map((b) => ({ id: b.id, label: b.label, on: b.id === bet.id, disabled: spinning })),

    onControl(id): void {
      if (spinning) return;
      const found = BETS.find((b) => b.id === id);
      if (found) bet = found;
    },

    play(stake, api): void {
      pocket = Math.floor(Math.random() * POCKETS);
      stakeNow = stake;
      resolveFn = api.resolve;
      spinning = true;
      t = 0;
      settleT = 0;
      angle = 0;
      // Land exactly on the drawn pocket after a whole number of laps, so the
      // deceleration is cosmetic and can never change the result.
      landedAngle = Math.PI * 2 * 5 + (pocketAngle(pocket) + Math.PI / 2);
    },

    render(ctx, w, h, dt): void {
      t += dt;

      if (spinning) {
        // Ease-out cubic: fast orbit, long tail, drops in at the very end.
        const u = Math.min(1, t / SPIN_TIME);
        const eased = 1 - Math.pow(1 - u, 3);
        angle = landedAngle * eased;
        if (u >= 1) {
          spinning = false;
          settleT = SETTLE_HOLD;
          if (resolveFn) {
            const out = settleBet(bet, pocket);
            resolveFn({
              game: "roulette",
              stake: stakeNow,
              payout: Math.round(stakeNow * out.multiplier),
              label: out.label,
            });
            resolveFn = null;
          }
        }
      } else if (settleT > 0) {
        settleT -= dt;
      }

      ctx.fillStyle = "#05070b";
      ctx.fillRect(0, 0, w, h);

      const cx = Math.round(w * 0.32);
      const cy = Math.round(h / 2);
      const rOuter = Math.min(h * 0.42, w * 0.22);
      const rInner = rOuter * 0.62;

      // ── Pockets ── drawn as wedges, in whole-pixel steps.
      for (let n = 0; n < POCKETS; n++) {
        const a0 = pocketAngle(n) - Math.PI / POCKETS;
        const a1 = pocketAngle(n) + Math.PI / POCKETS;
        const isWin = !spinning && settleT > 0 && n === pocket;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, rOuter, a0, a1);
        ctx.closePath();
        ctx.fillStyle = isWin ? C_WIN : POCKET_FILL[colorOf(n)];
        ctx.fill();
      }

      // Hub, so the wedges read as a wheel rather than a pie chart.
      ctx.beginPath();
      ctx.arc(cx, cy, rInner, 0, Math.PI * 2);
      ctx.fillStyle = "#0d1018";
      ctx.fill();
      ctx.strokeStyle = C_RIM;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Rim
      ctx.beginPath();
      ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
      ctx.strokeStyle = C_RIM;
      ctx.lineWidth = 2;
      ctx.stroke();

      // ── The ball ── a single bright block riding the rail.
      const ballR = rOuter * 0.86;
      const ba = angle - Math.PI / 2;
      const bx = Math.round(cx + Math.cos(ba) * ballR);
      const by = Math.round(cy + Math.sin(ba) * ballR);
      ctx.fillStyle = C_BALL;
      ctx.fillRect(bx - 3, by - 3, 6, 6);

      // Result in the hub, once it settles.
      if (!spinning && settleT > 0) {
        ctx.font = "14px 'Press Start 2P', monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = pocket === 0 ? C_GREEN : colorOf(pocket) === "red" ? C_RED : C_TEXT;
        ctx.fillText(String(pocket), cx, cy);
      }

      // ── Bet panel ── the current selection, and how to change it.
      const px = Math.round(w * 0.58);
      ctx.font = "9px 'Press Start 2P', monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillStyle = "#8a8578";
      ctx.fillText("YOUR BET", px, 26);
      ctx.font = "14px 'Press Start 2P', monospace";
      ctx.fillStyle = C_WIN;
      ctx.fillText(bet.label, px, 44);
      ctx.font = "9px 'Press Start 2P', monospace";
      ctx.fillStyle = C_TEXT;
      ctx.fillText(`PAYS ${bet.pays}x`, px, 68);
      if (!spinning) {
        ctx.fillStyle = "#8a8578";
        ctx.fillText("PICK A BET ABOVE", px, 96);
      }
    },
  };
}
