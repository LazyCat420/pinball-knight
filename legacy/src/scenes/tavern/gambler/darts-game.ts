/**
 * DARTS — the playable board. Scoring lives in `darts.ts`.
 *
 * Unlike slots and roulette, NOTHING here is decided in advance: the outcome is
 * exactly where you stopped the bars. That is the point — it's the one game in
 * the casino you can actually get good at, and the house-edge gradient says the
 * game that rewards skill should pay the best.
 *
 * The mechanic is two-axis arcade timing: a horizontal bar sweeps, you lock X;
 * a vertical bar sweeps, you lock Y; the dart lands there. Sweep speed scales
 * with the STAKE, so a bigger bet is a physically harder throw — risk you feel
 * in your hands rather than a number you read.
 */
import { scoreAt, payoutFor, sweepSpeed, DARTS_PER_ROUND, WEDGES, WEDGE_COUNT, R_DOUBLE_IN, R_TREBLE_IN, R_TREBLE_OUT, R_OUTER_BULL, R_BULL, type Hit } from "./darts";
import type { CasinoGame } from "./index";
import type { RoundResult } from "./table";

type Phase = "idle" | "aim-x" | "aim-y" | "flying" | "done";

/** Seconds a thrown dart takes to land, before the next throw arms. */
const FLIGHT = 0.28;
/** Seconds the final total holds before controls unlock. */
const SETTLE_HOLD = 1.4;

// Alternating wedges must actually CONTRAST. The first pass used two near
// identical dark browns, so the board read as red/green rings floating on black
// instead of a dartboard. Real boards alternate black and cream — that is the
// pattern the eye recognises.
const C_BOARD_A = "#15100c";
const C_BOARD_B = "#b9a37a";
const C_WIRE = "#2a2420";
const C_DOUBLE = "#a8323c";
const C_TREBLE = "#2e7d4f";
const C_BULL = "#a8323c";
const C_OUTER_BULL = "#2e7d4f";
const C_BAR = "#6fd0e8";
const C_DART = "#f0c040";
const C_TEXT = "#c9d1e0";

export function createDartsGame(): CasinoGame {
  let phase: Phase = "idle";
  let t = 0;
  let stakeNow = 0;
  let speed = 1;
  let resolveFn: ((r: RoundResult) => void) | null = null;

  let aimX = 0;
  let aimY = 0;
  let flightT = 0;
  let settleT = 0;

  /** Darts thrown this round, in board coords with their score. */
  const thrown: Array<{ x: number; y: number; hit: Hit }> = [];

  /** Triangle wave in -1..1 — a bar that sweeps across and back. */
  const sweep = (): number => {
    const u = (t * speed) % 2;
    return u < 1 ? u * 2 - 1 : 3 - u * 2;
  };

  function finishRound(): void {
    phase = "done";
    settleT = SETTLE_HOLD;
    const total = thrown.reduce((n, d) => n + d.hit.points, 0);
    const { mult, label } = payoutFor(total);
    resolveFn?.({
      game: "darts",
      stake: stakeNow,
      payout: Math.round(stakeNow * mult),
      label: `${total} — ${label}`,
    });
    resolveFn = null;
  }

  return {
    id: "darts",
    name: "DARTS",
    blurb: "lock X, then Y · three darts · 30 pushes, 100+ pays 4x · bigger bets sweep faster",

    busy: () => phase !== "idle" && phase !== "done",

    /**
     * The primary button IS the throw control, so every press during a round
     * arrives here — the shell routes to `poke` whenever the game is busy.
     */
    poke(): void {
      if (phase === "aim-x") {
        aimX = sweep();
        phase = "aim-y";
        t = 0;
        return;
      }
      if (phase === "aim-y") {
        aimY = sweep();
        // Land the dart. Board coords are in units of the board radius, and the
        // bars sweep -1..1, so the aim maps straight onto the board.
        const hit = scoreAt(aimX, aimY);
        thrown.push({ x: aimX, y: aimY, hit });
        phase = "flying";
        flightT = FLIGHT;
      }
    },

    play(stake, resolve): void {
      stakeNow = stake;
      resolveFn = resolve;
      speed = sweepSpeed(stake);
      thrown.length = 0;
      aimX = 0;
      aimY = 0;
      t = 0;
      settleT = 0;
      phase = "aim-x";
    },

    render(ctx, w, h, dt): void {
      t += dt;

      if (phase === "flying") {
        flightT -= dt;
        if (flightT <= 0) {
          if (thrown.length >= DARTS_PER_ROUND) finishRound();
          else {
            phase = "aim-x";
            t = 0;
          }
        }
      } else if (phase === "done" && settleT > 0) {
        settleT -= dt;
        if (settleT <= 0) phase = "idle";
      }

      ctx.fillStyle = "#05070b";
      ctx.fillRect(0, 0, w, h);

      const cx = Math.round(w * 0.34);
      const cy = Math.round(h / 2);
      const R = Math.floor(Math.min(h * 0.44, w * 0.22));

      // ── Board ── wedges first, then the scoring rings over them.
      for (let i = 0; i < WEDGE_COUNT; i++) {
        const a0 = ((i - 0.5) / WEDGE_COUNT) * Math.PI * 2 - Math.PI / 2;
        const a1 = ((i + 0.5) / WEDGE_COUNT) * Math.PI * 2 - Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R, a0, a1);
        ctx.closePath();
        ctx.fillStyle = i % 2 === 0 ? C_BOARD_A : C_BOARD_B;
        ctx.fill();

        // Double and treble bands, alternating red/green like a real board.
        for (const [rIn, rOut] of [
          [R_DOUBLE_IN, 1],
          [R_TREBLE_IN, R_TREBLE_OUT],
        ] as const) {
          ctx.beginPath();
          ctx.arc(cx, cy, R * rOut, a0, a1);
          ctx.arc(cx, cy, R * rIn, a1, a0, true);
          ctx.closePath();
          ctx.fillStyle = i % 2 === 0 ? C_DOUBLE : C_TREBLE;
          ctx.fill();
        }
      }

      // Wire spokes — what makes it read as a dartboard rather than a target.
      ctx.strokeStyle = C_WIRE;
      ctx.lineWidth = 1;
      for (let i = 0; i < WEDGE_COUNT; i++) {
        const a = ((i + 0.5) / WEDGE_COUNT) * Math.PI * 2 - Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * R * R_OUTER_BULL, cy + Math.sin(a) * R * R_OUTER_BULL);
        ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        ctx.stroke();
      }

      // Bulls
      ctx.beginPath();
      ctx.arc(cx, cy, R * R_OUTER_BULL, 0, Math.PI * 2);
      ctx.fillStyle = C_OUTER_BULL;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, R * R_BULL, 0, Math.PI * 2);
      ctx.fillStyle = C_BULL;
      ctx.fill();

      // ── Darts already thrown ──
      for (const d of thrown) {
        const dx = Math.round(cx + d.x * R);
        const dy = Math.round(cy + d.y * R);
        ctx.fillStyle = "#05070b";
        ctx.fillRect(dx - 3, dy - 3, 6, 6);
        ctx.fillStyle = C_DART;
        ctx.fillRect(dx - 2, dy - 2, 4, 4);
      }

      // ── Aim bars ──
      if (phase === "aim-x" || phase === "aim-y" || phase === "flying") {
        const live = sweep();
        // Horizontal: sweeping while aiming X, then frozen at the locked value.
        const lockedX = phase === "aim-x" ? live : aimX;
        const bx = Math.round(cx + lockedX * R);
        ctx.fillStyle = phase === "aim-x" ? C_BAR : "#3a4152";
        ctx.fillRect(bx - 1, cy - R - 10, 2, R * 2 + 20);

        if (phase !== "aim-x") {
          const lockedY = phase === "aim-y" ? live : aimY;
          const by = Math.round(cy + lockedY * R);
          ctx.fillStyle = phase === "aim-y" ? C_BAR : "#3a4152";
          ctx.fillRect(cx - R - 10, by - 1, R * 2 + 20, 2);
        }
      }

      // ── Readout ──
      const px = Math.round(w * 0.62);
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.font = "9px 'Press Start 2P', monospace";

      ctx.fillStyle = "#8a8578";
      ctx.fillText(`DART ${Math.min(thrown.length + (phase === "done" ? 0 : 1), DARTS_PER_ROUND)}/${DARTS_PER_ROUND}`, px, 24);

      const total = thrown.reduce((n, d) => n + d.hit.points, 0);
      ctx.font = "16px 'Press Start 2P', monospace";
      ctx.fillStyle = C_DART;
      ctx.fillText(String(total), px, 42);

      ctx.font = "9px 'Press Start 2P', monospace";
      ctx.fillStyle = C_TEXT;
      let ly = 68;
      for (const d of thrown) {
        ctx.fillText(d.hit.label, px, ly);
        ly += 14;
      }

      if (phase === "aim-x" || phase === "aim-y") {
        ctx.fillStyle = C_BAR;
        ctx.fillText(phase === "aim-x" ? "PLAY = LOCK X" : "PLAY = LOCK Y", px, 140);
      } else if (phase === "idle") {
        ctx.fillStyle = "#8a8578";
        ctx.fillText("PLAY TO THROW", px, 140);
      }
    },
  };
}
