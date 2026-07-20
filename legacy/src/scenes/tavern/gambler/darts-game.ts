/**
 * DARTS — the playable board. Scoring is `darts.ts`, the throw is
 * `darts-throw.ts`, the pixels are `darts-art.ts`; this file is the wiring.
 *
 * ── The house invariant, and how darts meets it ─────────────────────────────
 * `slots-game.ts` states the rule: a game's outcome must never be able to
 * disagree with what it pays. Slots meets it by deciding everything on the
 * lever pull. Darts meets it from the other side and more strictly — nothing is
 * decided in advance at ALL, because the score is read off where the dart
 * physically ended up. `scoreAt` is called once per dart, inside
 * `darts-throw.ts`, on the same coordinate this file then draws the sprite at,
 * and the round total is a sum over those stored hits. The renderer has no
 * scoring code in it and cannot acquire any: it is handed `Hit` objects.
 *
 * That is also why the board is baked by asking `scoreAt` for the colour of
 * every pixel (see `darts-art.ts`) — the picture and the rules are the same
 * function, so "it looked like a treble" and "it scored a treble" are one fact.
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 * The previous version had the right idea and almost none of the execution:
 *   · the dart was pushed into the board on the button press and the 0.28s
 *     "flying" phase drew nothing moving, so the dart teleported and the game
 *     paused for no visible reason;
 *   · it made no sound at all, in a casino where the slot machine has seven cues;
 *   · the sweep started at the same place at the same speed every throw, so the
 *     skill was one memorised beat and then a permanent 180;
 *   · X and Y both swept ±1 — a square aim space over a round board — so
 *     locking X near the rim silently threw the dart away;
 *   · and the whole board was `ctx.arc()`, which anti-aliases.
 */
import { PAYOUT_BANDS, wobbleRadius, DARTS_PER_ROUND } from "./darts";
import { createThrowMachine, type ThrowMachine, type LandedDart } from "./darts-throw";
import { buildBoard, drawDart, drawNumber, hitWire, box, frame, SURROUND_OUT, type CanvasFactory, type OffscreenLike } from "./darts-art";
import { sfxReticleTick, sfxLockAxis, sfxThrow, sfxStick, sfxBullseye, sfxRoundEnd } from "./darts-audio";
import type { CasinoGame } from "./index";
import type { RoundResult } from "./table";

/**
 * Board radius in pixels. Chosen so the SURROUND fits the 200px canvas:
 * 74 × 1.3 = 96, which leaves a 4px margin top and bottom. Sized off the
 * surround rather than the playing area because the numbers live out there and
 * clipping them would cost the board its most legible feature.
 */
const BOARD_R = 74;
/** Board centre. Left-of-centre, leaving the right half for the readout. */
const BOARD_CX = 150;
const BOARD_CY = 100;

/**
 * Where the knight is standing — off the bottom-right, so darts fly up-left.
 *
 * Must stay LEFT of `PANEL_X` and below the canvas. The first version launched
 * from x=330, which is behind the readout panel, and the panel draws last — so
 * the entire flight animation was painted and then immediately covered up, and
 * the dart only became visible for the last frame or two before it stuck.
 */
const LAUNCH_X = 246;
const LAUNCH_Y = 214;

const PANEL_X = 268;

const C_BG = "#05070b";
const C_PANEL = "#10141d";
const C_PANEL_HI = "#232b3a";
const C_BAR = "#6fd0e8";
/** The locked axis. Bright enough to stay readable — it is a commitment the
 * player has already made and needs to keep seeing, not a disabled control. */
const C_BAR_LOCKED = "#5a6478";
const C_GOLD = "#f0c040";
const C_TEXT = "#c9d1e0";
const C_DIM = "#6b7284";
const C_WARN = "#e8804a";
const C_GOOD = "#6ee089";

export interface DartsOptions {
  /** Injected so tests can bake the board on node-canvas. */
  canvasFactory?: CanvasFactory;
  /** Injected so tests can make the hand-wobble deterministic. */
  rng?: () => number;
}

export function createDartsGame(opts: DartsOptions = {}): CasinoGame {
  const machine: ThrowMachine = createThrowMachine(opts.rng);
  let stakeNow = 0;
  let resolveFn: ((r: RoundResult) => void) | null = null;
  let board: OffscreenLike | null = null;
  /** Seconds since the round ended, for the result banner. */
  let bannerT = 0;
  let banner: { total: number; mult: number; label: string } | null = null;

  function ensureBoard(): OffscreenLike {
    if (!board) board = buildBoard(BOARD_R, opts.canvasFactory);
    return board;
  }

  /** Board coords (units of radius) → canvas pixels. */
  const toPx = (x: number, y: number): [number, number] => [
    Math.round(BOARD_CX + x * BOARD_R),
    Math.round(BOARD_CY + y * BOARD_R),
  ];

  /** React to what the machine just did. The ONLY place audio is triggered. */
  function handle(events: ReturnType<ThrowMachine["press"]>): void {
    for (const e of events) {
      if (e.type === "tick") sfxReticleTick(machine.phase() === "aim-x" ? "x" : "y");
      else if (e.type === "lock-x") sfxLockAxis();
      else if (e.type === "release") sfxThrow();
      else if (e.type === "land") {
        const d = e.dart;
        sfxStick(d.hit.ring === "miss" ? "miss" : hitWire(d.x, d.y, BOARD_R) ? "wire" : "board");
        if (d.hit.ring === "bull") sfxBullseye();
      } else if (e.type === "round-done") {
        banner = { total: e.total, mult: e.mult, label: e.label };
        bannerT = 0;
        sfxRoundEnd(e.mult);
        // The payout is derived from the same total the scoreboard is showing,
        // which is the sum of the hits stored on the darts in the board.
        resolveFn?.({
          game: "darts",
          stake: stakeNow,
          payout: Math.round(stakeNow * e.mult),
          label: `${e.total} — ${e.label}`,
        });
        resolveFn = null;
      }
    }
  }

  return {
    id: "darts",
    name: "DARTS",
    blurb: "lock the aim, then the throw · 3 darts · 55 pushes, 155 pays 2x · big bets shake your hand",

    busy: () => machine.busy(),

    poke(): void {
      handle(machine.press());
    },

    play(stake, api): void {
      stakeNow = stake;
      resolveFn = api.resolve;
      banner = null;
      bannerT = 0;
      machine.begin(stake);
    },

    render(ctx, w, h, dt): void {
      handle(machine.tick(dt));
      if (banner) bannerT += dt;

      ctx.imageSmoothingEnabled = false;
      box(ctx, 0, 0, w, h, C_BG);

      drawBoard(ctx);
      drawStuckDarts(ctx, machine.darts());
      drawFlight(ctx, machine);
      drawReticles(ctx, machine);
      drawPanel(ctx, w, h, machine, stakeNow, banner, bannerT);
    },
  };

  // ── Drawing ───────────────────────────────────────────────────────────────

  function drawBoard(ctx: CanvasRenderingContext2D): void {
    const bmp = ensureBoard();
    const pad = Math.ceil(BOARD_R * SURROUND_OUT);
    // Integer blit, smoothing already off: 1:1 pixels, no resample.
    ctx.drawImage(bmp as unknown as CanvasImageSource, BOARD_CX - pad, BOARD_CY - pad);
  }

  function drawStuckDarts(ctx: CanvasRenderingContext2D, darts: readonly LandedDart[]): void {
    for (const d of darts) {
      const [px, py] = toPx(d.x, d.y);
      drawDart(ctx, px, py, d.lean, 1);
    }
  }

  /**
   * The dart in the air.
   *
   * A parabola from the knight's hand to the landing point, with the sprite
   * growing as it arrives. The trail is three HARD dashes rather than a blur,
   * for the same reason the slot reels smear with a solid bar: an alpha trail
   * would be the only soft thing on the canvas.
   */
  function drawFlight(ctx: CanvasRenderingContext2D, m: ThrowMachine): void {
    const f = m.flight();
    if (!f) return;
    const [tx, ty] = toPx(f.dart.x, f.dart.y);

    const at = (p: number): [number, number] => {
      const x = LAUNCH_X + (tx - LAUNCH_X) * p;
      const y = LAUNCH_Y + (ty - LAUNCH_Y) * p;
      // Lift, peaking at the middle of the flight — the arc that gives it weight.
      return [Math.round(x), Math.round(y - Math.sin(Math.PI * p) * 30)];
    };

    // Trail, drawn as flat dashes in two fixed tones (never alpha).
    for (let i = 3; i >= 1; i--) {
      const p = f.p - i * 0.075;
      if (p <= 0) continue;
      const [x, y] = at(p);
      box(ctx, x - 1, y, i === 1 ? 4 : 3, 1, i === 1 ? "#7a6a3a" : "#3c3a2c");
    }

    const [x, y] = at(f.p);
    drawDart(ctx, x, y, f.dart.lean, 0.5 + f.p * 0.5);
  }

  /**
   * The aim reticles.
   *
   * The Y bar is drawn only across the CHORD it can actually sweep, which is
   * the visible half of the `yHalfRange` fix: the player can see that locking X
   * near the rim has left them a short, fast window, instead of finding out by
   * throwing the dart into the wall.
   */
  function drawReticles(ctx: CanvasRenderingContext2D, m: ThrowMachine): void {
    const phase = m.phase();
    if (phase !== "aim-x" && phase !== "aim-y") return;

    const liveX = phase === "aim-x" ? m.cursor() : m.lockedX();
    const [bx] = toPx(liveX, 0);
    const top = BOARD_CY - BOARD_R - 6;
    const bot = BOARD_CY + BOARD_R + 6;

    // Vertical: live while aiming, dimmed once locked.
    box(ctx, bx, top, 1, bot - top, phase === "aim-x" ? C_BAR : C_BAR_LOCKED);
    // Chunky end caps, so the bar has a graspable head at speed.
    box(ctx, bx - 2, top - 4, 5, 4, phase === "aim-x" ? C_BAR : C_BAR_LOCKED);
    box(ctx, bx - 2, bot, 5, 4, phase === "aim-x" ? C_BAR : C_BAR_LOCKED);

    if (phase === "aim-y") {
      const range = m.yRange();
      const [, y0] = toPx(0, -range);
      const [, y1] = toPx(0, range);
      const [lx] = toPx(liveX - range, 0);
      const [rx] = toPx(liveX + range, 0);
      const left = Math.max(BOARD_CX - BOARD_R - 6, Math.min(lx, bx - 20));
      const right = Math.min(BOARD_CX + BOARD_R + 6, Math.max(rx, bx + 20));

      // The travel the bar has available — a dotted guide, so the window's
      // length is legible before the bar has finished crossing it.
      ctx.fillStyle = "#1d2432";
      for (let y = y0; y <= y1; y += 3) ctx.fillRect(bx - 3, y, 7, 1);

      const [, by] = toPx(0, m.cursor());
      box(ctx, left, by, right - left, 1, C_BAR);
      box(ctx, left - 4, by - 2, 4, 5, C_BAR);
      box(ctx, right, by - 2, 4, 5, C_BAR);

      // The crosshair: the actual aim point, before the hand wobbles it.
      box(ctx, bx - 1, by - 1, 3, 3, "#ffffff");
      box(ctx, bx, by, 1, 1, C_BAR);
    }
  }

  function drawPanel(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    m: ThrowMachine,
    stake: number,
    result: { total: number; mult: number; label: string } | null,
    resultAge: number,
  ): void {
    const phase = m.phase();
    const darts = m.darts();
    const total = m.total();

    box(ctx, PANEL_X, 6, w - PANEL_X - 6, h - 12, C_PANEL);
    frame(ctx, PANEL_X, 6, w - PANEL_X - 6, h - 12, C_PANEL_HI);

    const x = PANEL_X + 10;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    // ── Dart counter, as three pips: countable at a glance, which "2/3" is not.
    ctx.font = "8px 'Press Start 2P', monospace";
    ctx.fillStyle = C_DIM;
    ctx.fillText("DART", x, 16);
    for (let i = 0; i < DARTS_PER_ROUND; i++) {
      const thrown = i < darts.length;
      const active = i === darts.length && m.busy();
      box(ctx, x + 44 + i * 9, 15, 7, 7, thrown ? C_GOLD : active ? C_BAR : "#2a3140");
    }

    // ── The running total, in the big pixel digits.
    ctx.fillStyle = C_DIM;
    ctx.font = "8px 'Press Start 2P', monospace";
    ctx.fillText("TOTAL", x, 34);
    drawNumber(ctx, total, x + 52, 28, total >= 55 ? C_GOOD : C_TEXT, 3);

    // ── What each dart actually hit.
    ctx.font = "8px 'Press Start 2P', monospace";
    let ly = 54;
    for (const d of darts) {
      ctx.fillStyle = d.hit.ring === "miss" ? C_WARN : d.hit.ring === "treble" || d.hit.ring === "bull" ? C_GOOD : C_TEXT;
      ctx.fillText(d.hit.label, x, ly);
      ctx.fillStyle = C_DIM;
      ctx.fillText(String(d.hit.points), x + 130, ly);
      ly += 11;
    }

    // ── The payout ladder, with the band the current total sits in marked.
    // Shown DURING the round on purpose: the player is choosing how much risk
    // to take on dart three and cannot do that without knowing the next rung.
    // Sits below the three hit lines (54 / 65 / 76 plus descender). The first
    // layout put the header at 80 and "DOUBLE 18" collided with it.
    const ladderY = 100;
    ctx.font = "8px 'Press Start 2P', monospace";
    ctx.fillStyle = C_DIM;
    ctx.fillText("PAYS", x, ladderY - 12);
    const liveBand = PAYOUT_BANDS.find((z) => total >= z.min);
    for (let i = 0; i < PAYOUT_BANDS.length; i++) {
      const b = PAYOUT_BANDS[i];
      const y = ladderY + i * 11;
      const on = b === liveBand;
      if (on) box(ctx, x - 4, y - 2, 168, 11, "#20293a");
      ctx.fillStyle = on ? C_GOLD : C_DIM;
      ctx.fillText(b.min > 0 ? `${b.min}+` : "—", x, y);
      ctx.fillText(b.label, x + 40, y);
      ctx.fillText(b.mult > 0 ? `${b.mult}x` : "0", x + 132, y);
    }

    // ── Prompt / hand-steadiness / result banner.
    const py = h - 28;
    ctx.font = "8px 'Press Start 2P', monospace";
    if (result && resultAge < 3) {
      ctx.fillStyle = result.mult > 1 ? C_GOOD : result.mult > 0 ? C_TEXT : C_WARN;
      ctx.fillText(`${result.total} — ${result.label}`, x, py);
      ctx.fillStyle = C_GOLD;
      ctx.fillText(`${result.mult}x`, x + 150, py);
    } else if (phase === "aim-x") {
      ctx.fillStyle = C_BAR;
      ctx.fillText("PLAY = LOCK AIM", x, py);
    } else if (phase === "aim-y") {
      ctx.fillStyle = C_BAR;
      ctx.fillText("PLAY = THROW", x, py);
    } else if (phase === "idle") {
      ctx.fillStyle = C_DIM;
      ctx.fillText("PLAY TO THROW", x, py);
    }

    // How shaky the hand is at this stake — the risk the player is taking on,
    // stated in words, because a scatter radius is not something you can feel
    // until after it has cost you a round.
    if (stake > 0 && m.busy()) {
      const wob = wobbleRadius(stake, m.dartIndex());
      // Banded so the three words map onto the stake ladder the player can
      // actually pick: 5–10g STEADY, 25–50g UNSTEADY, 100g SHAKING.
      const steady = wob < 0.05 ? "STEADY" : wob < 0.105 ? "UNSTEADY" : "SHAKING";
      ctx.fillStyle = wob < 0.05 ? C_GOOD : wob < 0.105 ? C_GOLD : C_WARN;
      ctx.fillText(`HAND: ${steady}`, x, py - 13);
    }
  }

}
