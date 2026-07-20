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
 *
 * ── Why the drawing code looks the way it does ──────────────────────────────
 * Everything on this canvas is an axis-aligned `fillRect` on integer
 * coordinates. That is not stylistic pedantry: Canvas 2D anti-aliases all path
 * geometry and there is no way to switch that off, so `arc()`, `bezierCurveTo`,
 * a non-integer `strokeRect`, `shadowBlur` and alpha gradients all produce soft
 * fringed edges that read as "blurry PNG" next to the rest of the game's art.
 * `fillRect` at integer coords is the only primitive that is reliably crisp.
 *
 * The consequences are visible throughout:
 *   · The reel drum's "curve" is a stack of HARD bands, not a gradient. Each
 *     band is a solid opaque colour and the top and bottom ones OCCLUDE the
 *     outer symbols, which is what sells a drum going over the horizon.
 *   · Motion blur is a solid bar, not a blur.
 *   · The bezel's chrome is four flat tones (highlight / face / shade / ink)
 *     placed by hand on the edges that would catch light.
 *   · The cabinet lights are 3×3 squares, and "glowing" means swapping the
 *     colour, never lowering the alpha.
 *
 * Sound lives in `./audio.ts` and is wired to the same events the animation
 * uses, so the two can never drift apart.
 */
import { spin, REEL_STRIP, PAYTABLE, type Symbol, type SpinOutcome } from "./slots";
import { drawSymbol as paintSymbol, SYM_GRID, type SymbolInk } from "./symbols";
import { sfxLeverPull, sfxReelSpin, sfxReelStop, sfxNearMiss, sfxWinSmall, sfxJackpotJingle, sfxLose, type ReelSpin } from "./audio";
import type { CasinoGame } from "./index";
import type { RoundResult } from "./table";

/** Seconds each reel spins before it may stop, indexed by reel. */
const STOP_AT = [0.7, 1.25, 1.95];
/** How long the win banner holds before controls unlock. */
const SETTLE_HOLD = 0.9;

/** Rows of symbols visible per reel window. Odd, so one is centred. */
const ROWS = 3;

/** Device pixels per symbol grid cell. Whole number, or the art fringes. */
const SYM_SCALE = 2;
/** Rendered symbol size — 16×16 art at 2× is 32px. */
const SYM_PX = SYM_GRID * SYM_SCALE;

const COL_W = 88;
const ROW_H = 40;
const REEL_GAP = 12;
/** Chrome bezel thickness around the reel bank. */
const BEZEL = 8;

/** How long a landed reel spends overshooting before it settles, in seconds. */
const BOUNCE = 0.16;
/**
 * The overshoot itself, in pixels, one entry per 0.04s frame.
 *
 * A hand-authored 4-frame table rather than a decaying sine. At 40px rows an
 * eased bounce spends most of its life at sub-pixel offsets, which on an
 * integer grid means it either does nothing or snaps — so the frames are
 * chosen directly. Down hard, back past centre, settle.
 */
const BOUNCE_FRAMES = [5, 2, -1, 0];
/** How long a freshly landed cell stays flashed, in seconds. */
const CELL_FLASH = 0.13;

/** Seconds of no activity before the cabinet starts advertising itself. */
const ATTRACT_AFTER = 3.5;

/** ── Cabinet palette ── flat tones, placed by hand. No gradients anywhere. */
const C_BG = "#05070b";
const C_CAB = "#2a3040";
const C_CAB_HI = "#4a5468";
const C_CAB_LO = "#171c28";
const C_CAB_INK = "#0c0f16";
const C_CHROME = "#8f9bb3";
const C_CHROME_HI = "#dce5f2";
const C_CHROME_LO = "#4a5266";
const C_GLASS = "#12161f";
const C_GLASS_LIT = "#1b2231";
const C_WIN = "#f0c040";
const C_WIN_HI = "#fff0b0";
const C_DIM = "#3a4152";
/** Unlit bulb — a dead filament reads warm-grey, not black. */
const C_BULB_OFF = "#4e4636";
const C_BULB_RIM = "#63593f";
const C_TEXT = "#c9c1ad";

/**
 * base / lite / hi / shade / ink per symbol — the five-tone ramp each painter uses.
 *
 * The ramps are HUE-ROTATED, not just lightened and darkened: every `shade` is
 * shifted toward blue and every `hi` toward yellow relative to its `base`. The
 * first version had three tones picked by eye on a lightness slider and every
 * symbol came out looking like a grey shape wearing a colour.
 */
const SYMBOL_INK: Record<Symbol, SymbolInk> = {
  // Chrome: neutral base, cold steel shadow, near-white specular.
  ball: { ink: "#3d4557", shade: "#6b7488", base: "#9aa4b4", lite: "#c4cedd", hi: "#f2f7ff" },
  // Teal: shadow rotates to deep blue-green, highlight to a warm mint.
  bumper: { ink: "#0d2f2b", shade: "#1a6b60", base: "#2e9d8a", lite: "#5fd4bb", hi: "#b6ffe8" },
  // Orange: shadow rotates toward red-brown, highlight toward yellow.
  flipper: { ink: "#4a2a06", shade: "#8a4f10", base: "#c07a1e", lite: "#eaa845", hi: "#ffd98a" },
  // Violet: shadow rotates to indigo, highlight to a pale warm lilac.
  target: { ink: "#241340", shade: "#4e2f8c", base: "#7a4fc0", lite: "#a884e6", hi: "#e0c8ff" },
  // Gold: the widest ramp in the set — it has to out-shine everything else.
  jackpot: { ink: "#5a3d04", shade: "#a87716", base: "#e0a92c", lite: "#f6d05e", hi: "#fff6c4" },
  // Bone, outlined in dried blood. Warm ivory base, COLD blue-grey shadow —
  // the widest hue rotation in the set, and the reason the skull reads as dead
  // rather than merely grey. Painting the whole thing red (the first attempt)
  // buried the eye sockets, which are the only part that carries the meaning.
  skull: { ink: "#2e1620", shade: "#6f7690", base: "#bcb5a4", lite: "#ddd9c7", hi: "#fff8e4" },
};

/** Which cells actually paid, so the win lighting marks the right ones. */
function winningReels(o: SpinOutcome): [boolean, boolean, boolean] {
  const [a, b, c] = o.reels;
  if (o.multiplier <= 0) return [false, false, false];
  if (a === b && b === c) return [true, true, true];
  // Mirrors `score()` in slots.ts, including its precedence — marking the wrong
  // pair when a line matches two ways is exactly the sort of thing that reads
  // as the machine having paid out incorrectly.
  if (o.reels.filter((s) => s === "jackpot").length === 2) {
    return [a === "jackpot", b === "jackpot", c === "jackpot"];
  }
  if (a === b) return [true, true, false];
  if (a === c) return [true, false, true];
  if (b === c) return [false, true, true];
  return [false, false, false];
}

/** A triple of the top symbol — the only outcome that earns the big jingle. */
function isJackpot(o: SpinOutcome): boolean {
  const [a, b, c] = o.reels;
  return a === "jackpot" && b === "jackpot" && c === "jackpot";
}

export function createSlotsGame(): CasinoGame {
  let t = 0;
  let spinning = false;
  let outcome: SpinOutcome | null = null;
  let stakeNow = 0;
  let lastPayout = 0;
  let resolveFn: ((r: RoundResult) => void) | null = null;
  let settleT = 0;
  /** Per-reel scroll offset while spinning, in symbol units. */
  const offset = [0, 0, 0];
  const speed = [22, 19, 16];

  /** Stop-transition bookkeeping — drives the bounce, the flash and the SFX. */
  const wasStopped = [true, true, true];
  const bounceT = [0, 0, 0];
  const flashT = [0, 0, 0];

  /** Seconds since anything happened. Drives the attract-mode light cycle. */
  let idleT = 0;
  /** 0 = lever up, 1 = fully thrown. Eased back up over the spin. */
  let lever = 0;
  let spinSound: ReelSpin | null = null;
  /** Sparkle positions for a jackpot, fixed at settle so they don't crawl. */
  let sparkles: Array<[number, number]> = [];

  /** Has reel `i` come to rest? */
  const stopped = (i: number): boolean => !spinning || t >= STOP_AT[i];

  const symbolAt = (reel: number, row: number): Symbol => {
    // While spinning, scroll the strip; once stopped, show the outcome centred.
    if (!stopped(reel) || !outcome) {
      const k = Math.floor(offset[reel]) + row;
      return REEL_STRIP[((k % REEL_STRIP.length) + REEL_STRIP.length) % REEL_STRIP.length];
    }
    if (row === 1) return outcome.reels[reel];
    // Neighbours come off the strip around the landed symbol, so the window
    // looks like a real reel rather than three floating symbols.
    const idx = REEL_STRIP.indexOf(outcome.reels[reel]);
    const k = idx + (row - 1);
    return REEL_STRIP[((k % REEL_STRIP.length) + REEL_STRIP.length) % REEL_STRIP.length];
  };

  /** Fill an integer rect. Every single mark on this canvas goes through here. */
  const box = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string): void => {
    ctx.fillStyle = col;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };

  /**
   * A 1px rectangular outline, drawn as four fills.
   *
   * `strokeRect` centres the stroke on the path, so a 1px stroke straddles a
   * pixel boundary and comes out as two half-covered rows unless you offset by
   * 0.5 — and even then it anti-aliases at the corners. Four fills cannot.
   */
  const frame = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    col: string,
    weight = 1,
  ): void => {
    box(ctx, x, y, w, weight, col);
    box(ctx, x, y + h - weight, w, weight, col);
    box(ctx, x, y, weight, h, col);
    box(ctx, x + w - weight, y, weight, h, col);
  };

  /** Text with a hard 1px drop shadow. No `shadowBlur` — that would be soft. */
  const label = (
    ctx: CanvasRenderingContext2D,
    s: string,
    x: number,
    y: number,
    size: number,
    col: string,
    align: CanvasTextAlign = "left",
  ): void => {
    ctx.font = `${size}px 'Press Start 2P', monospace`;
    ctx.textAlign = align;
    ctx.textBaseline = "top";
    ctx.fillStyle = C_CAB_INK;
    ctx.fillText(s, Math.round(x) + 1, Math.round(y) + 1);
    ctx.fillStyle = col;
    ctx.fillText(s, Math.round(x), Math.round(y));
  };

  function drawSymbol(
    ctx: CanvasRenderingContext2D,
    s: Symbol,
    cx: number,
    cy: number,
    lit: boolean,
    blur: number,
  ): void {
    const ox = Math.round(cx - SYM_PX / 2);
    const oy = Math.round(cy - SYM_PX / 2);
    if (blur > 0) {
      // Motion smear as a solid bar, NOT a real blur — softness is exactly what
      // a pixel look cannot have, so a spinning reel gets a hard streak instead.
      // Two tones (core and edge) give it a little form without going soft.
      const b = Math.round(blur);
      box(ctx, ox + SYM_SCALE * 2, oy - b, SYM_PX - SYM_SCALE * 4, SYM_PX + b * 2, SYMBOL_INK[s].shade ?? SYMBOL_INK[s].ink);
      box(ctx, ox + SYM_SCALE * 4, oy - b, SYM_PX - SYM_SCALE * 8, SYM_PX + b * 2, SYMBOL_INK[s].base);
      return;
    }
    if (lit) {
      paintSymbol(ctx, s, SYMBOL_INK[s], ox, oy, SYM_SCALE);
      return;
    }
    // The off-payline rows are dimmed by painting them with a DARKENED RAMP
    // rather than by dropping globalAlpha. Alpha over the drum bands muddies
    // both, and a half-transparent sprite is the one thing that instantly
    // stops reading as pixel art.
    const ink = SYMBOL_INK[s];
    paintSymbol(
      ctx,
      s,
      { ink: ink.ink, shade: ink.ink, base: ink.shade ?? ink.ink, lite: ink.base, hi: ink.lite ?? ink.base },
      ox,
      oy,
      SYM_SCALE,
    );
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

    play(stake, api): void {
      // Decide FIRST. The animation is then guaranteed to show what was paid.
      outcome = spin();
      stakeNow = stake;
      lastPayout = 0;
      resolveFn = api.resolve;
      spinning = true;
      t = 0;
      settleT = 0;
      idleT = 0;
      lever = 1;
      sparkles = [];
      STOP_AT[0] = 0.7;
      STOP_AT[1] = 1.25;
      STOP_AT[2] = 1.95;
      for (let i = 0; i < 3; i++) {
        wasStopped[i] = false;
        bounceT[i] = 0;
        flashT[i] = 0;
      }
      sfxLeverPull();
      spinSound?.stop();
      spinSound = sfxReelSpin();
    },

    dispose(): void {
      // Walking away mid-spin must not leave the whir running under the tavern.
      spinSound?.stop();
      spinSound = null;
    },

    render(ctx, w, h, dt): void {
      t += dt;
      for (let i = 0; i < 3; i++) {
        if (bounceT[i] > 0) bounceT[i] -= dt;
        if (flashT[i] > 0) flashT[i] -= dt;
      }
      if (lever > 0) lever = Math.max(0, lever - dt * 1.6);

      if (spinning) {
        idleT = 0;
        for (let i = 0; i < 3; i++) if (!stopped(i)) offset[i] += speed[i] * dt;

        // Stop transitions — the bounce, the cell flash and the CHUNK all hang
        // off this one edge so the sound can never land on a different frame
        // from the impact that is supposed to have caused it.
        for (let i = 0; i < 3; i++) {
          if (stopped(i) && !wasStopped[i]) {
            wasStopped[i] = true;
            bounceT[i] = BOUNCE;
            flashT[i] = CELL_FLASH;
            sfxReelStop(i);
            // NEAR MISS. Read off the already-decided outcome, never guessed
            // from what happens to be scrolling past — the reels showing a
            // match mid-spin means nothing, and cueing off that would fire the
            // riser on spins that were never close.
            //
            // The `t < STOP_AT[2]` guard matters: `poke()` can pull the third
            // reel's stop forward far enough that reels 1 and 2 land on the
            // same frame, and a riser with nothing left to resolve into is
            // worse than silence.
            if (i === 1 && outcome && outcome.reels[0] === outcome.reels[1] && t < STOP_AT[2]) {
              sfxNearMiss();
            }
          }
        }

        if (stopped(0) && stopped(1) && stopped(2)) {
          spinning = false;
          settleT = SETTLE_HOLD;
          spinSound?.stop();
          spinSound = null;
          if (outcome) {
            if (isJackpot(outcome)) {
              sfxJackpotJingle();
              // Fixed sparkle positions, chosen once. Re-rolling them per frame
              // would give a fizzing static field rather than a few bright
              // points that read as individual pixels catching the light.
              sparkles = [];
              let seed = 1337;
              for (let i = 0; i < 22; i++) {
                seed = (seed * 1103515245 + 12345) & 0x7fffffff;
                const sx = 8 + ((seed >> 7) % (w - 16));
                seed = (seed * 1103515245 + 12345) & 0x7fffffff;
                const sy = 8 + ((seed >> 7) % (h - 16));
                sparkles.push([sx, sy]);
              }
            } else if (outcome.multiplier > 0) {
              sfxWinSmall();
            } else {
              sfxLose();
            }
          }
          if (outcome && resolveFn) {
            const payout = Math.round(stakeNow * outcome.multiplier);
            lastPayout = payout;
            resolveFn({ game: "slots", stake: stakeNow, payout, label: outcome.label });
            resolveFn = null;
          }
        }
      } else if (settleT > 0) {
        settleT -= dt;
        idleT = 0;
      } else {
        idleT += dt;
      }

      const won = !spinning && outcome !== null && outcome.multiplier > 0;
      const jackpot = won && outcome !== null && isJackpot(outcome);
      const wins = outcome ? winningReels(outcome) : ([false, false, false] as [boolean, boolean, boolean]);

      // ── Geometry ── the reel bank first; everything else hangs off it.
      const bankW = COL_W * 3 + REEL_GAP * 2;
      const bankH = ROW_H * ROWS;
      const x0 = Math.floor((w - bankW) / 2);
      const y0 = Math.floor((h - bankH) / 2) + 4;

      // ── Backdrop ──
      box(ctx, 0, 0, w, h, C_BG);

      // ── Cabinet body ── a plate with a lit top edge and a shadowed bottom.
      box(ctx, 3, 3, w - 6, h - 6, C_CAB);
      box(ctx, 3, 3, w - 6, 2, C_CAB_HI);
      box(ctx, 3, 3, 2, h - 6, C_CAB_HI);
      box(ctx, 3, h - 5, w - 6, 2, C_CAB_LO);
      box(ctx, w - 5, 3, 2, h - 6, C_CAB_LO);
      frame(ctx, 1, 1, w - 2, h - 2, C_CAB_INK);

      // Side panels — inset plates flanking the reel bank, so the machine has
      // shoulders instead of the reels floating on a flat field.
      const panelW = x0 - BEZEL - 14;
      for (const px0 of [8, w - 8 - panelW]) {
        box(ctx, px0, 26, panelW, h - 52, C_CAB_LO);
        box(ctx, px0 + 1, 27, panelW - 2, h - 54, C_CAB);
        box(ctx, px0 + 1, 27, panelW - 2, 1, C_CAB_HI);
        // Rivets down the corners.
        for (const ry of [30, h - 28]) {
          box(ctx, px0 + 4, ry, 2, 2, C_CHROME);
          box(ctx, px0 + panelW - 6, ry, 2, 2, C_CHROME);
        }
      }

      // ── Paytable ── printed on the left shoulder, as part of the cabinet.
      // The DOM blurb above the canvas says the same thing in words, but a
      // player looking at the reels is looking at the reels; the prices have to
      // be where the symbols are or they may as well not be anywhere.
      const payX = 8;
      label(ctx, "PAYS", payX + 7, 31, 7, "#6a6558");
      const payRows: Array<[Symbol, number]> = [
        ["jackpot", PAYTABLE.jackpot],
        ["target", PAYTABLE.target],
        ["flipper", PAYTABLE.flipper],
        ["bumper", PAYTABLE.bumper],
        ["ball", PAYTABLE.ball],
      ];
      payRows.forEach(([s, m], i) => {
        const ry = 45 + i * 20;
        box(ctx, payX + 5, ry - 1, panelW - 10, 18, "#0f131c");
        frame(ctx, payX + 5, ry - 1, panelW - 10, 18, C_CAB_INK);
        paintSymbol(ctx, s, SYMBOL_INK[s], payX + 7, ry, 1);
        label(ctx, `x${m}`, payX + panelW - 9, ry + 5, 7, s === "jackpot" ? C_WIN : C_TEXT, "right");
      });

      // ── Right shoulder ── coin slot and payout tray, so the lever has a
      // machine to be attached to rather than a blank panel.
      const rsX = w - 8 - panelW;
      box(ctx, rsX + 10, 44, 30, 8, C_CHROME_LO);
      box(ctx, rsX + 10, 44, 30, 2, C_CHROME);
      box(ctx, rsX + 13, 46, 24, 4, "#04060a");
      label(ctx, "COIN", rsX + 44, 45, 7, "#6a6558");
      const trayY = h - 62;
      box(ctx, rsX + 8, trayY, 44, 26, "#05070b");
      frame(ctx, rsX + 8, trayY, 44, 26, C_CHROME_LO);
      box(ctx, rsX + 8, trayY + 24, 44, 2, C_CHROME);
      // A coin sitting in the tray, but only after the machine has paid one.
      if (lastPayout > 0 && !spinning) {
        box(ctx, rsX + 22, trayY + 16, 8, 6, C_WIN);
        box(ctx, rsX + 22, trayY + 16, 8, 2, C_WIN_HI);
        box(ctx, rsX + 32, trayY + 18, 6, 4, "#a87716");
      }

      // ── Bezel ── the chrome frame around the reel bank.
      const bx = x0 - BEZEL;
      const by = y0 - BEZEL;
      const bw = bankW + BEZEL * 2;
      const bh = bankH + BEZEL * 2;
      box(ctx, bx - 2, by - 2, bw + 4, bh + 4, C_CAB_INK);
      box(ctx, bx, by, bw, bh, C_CHROME);
      // Four flat tones placed on the edges that would catch light. This is the
      // entire "chrome" effect; there is no gradient and there cannot be one.
      box(ctx, bx, by, bw, 2, C_CHROME_HI);
      box(ctx, bx, by, 2, bh, C_CHROME_HI);
      box(ctx, bx, by + bh - 2, bw, 2, C_CHROME_LO);
      box(ctx, bx + bw - 2, by, 2, bh, C_CHROME_LO);
      frame(ctx, bx + 5, by + 5, bw - 10, bh - 10, C_CAB_INK);

      // ── Bezel bulbs ── evenly spaced around the perimeter, on the chrome.
      const bulbs: Array<[number, number]> = [];
      const step = 20;
      for (let x = bx + 6; x <= bx + bw - 9; x += step) {
        bulbs.push([x, by + 2]);
        bulbs.push([x, by + bh - 5]);
      }
      for (let y = by + 12; y <= by + bh - 15; y += step) {
        bulbs.push([bx + 2, y]);
        bulbs.push([bx + bw - 5, y]);
      }
      // Chase on a win, a slow lazy cycle in attract, dark otherwise. "Lit" is
      // a colour swap — dimming with alpha would grey the chrome underneath.
      const chase = Math.floor(t * 16);
      const attract = idleT > ATTRACT_AFTER;
      const drift = Math.floor(t * 4);
      bulbs.forEach(([x, y], i) => {
        let col = C_BULB_OFF;
        if (won) col = (i + chase) % 3 === 0 ? C_WIN_HI : (i + chase) % 3 === 1 ? C_WIN : "#6a5a2a";
        else if (attract) col = (i + drift) % 7 === 0 ? C_WIN : (i + drift) % 7 === 1 ? "#8a7434" : C_BULB_OFF;
        box(ctx, x, y, 3, 3, col);
        box(ctx, x, y, 3, 1, col === C_BULB_OFF ? C_BULB_RIM : C_WIN_HI);
      });

      // ── Reels ──
      for (let r = 0; r < 3; r++) {
        const rx = x0 + r * (COL_W + REEL_GAP);

        // Glass: three flat bands, the payline row lightest.
        box(ctx, rx, y0, COL_W, bankH, C_GLASS);
        box(ctx, rx, y0 + ROW_H, COL_W, ROW_H, C_GLASS_LIT);

        // Bounce offset — applied as whole pixels off a hand-authored table.
        let dy = 0;
        if (bounceT[r] > 0) {
          const fr = Math.min(BOUNCE_FRAMES.length - 1, Math.floor((BOUNCE - bounceT[r]) / (BOUNCE / BOUNCE_FRAMES.length)));
          dy = BOUNCE_FRAMES[fr];
        }

        ctx.save();
        // Integer-aligned rectangular clip: the extra scroll rows must not
        // spill into the bezel. Axis-aligned and on the pixel grid, so it costs
        // nothing in sharpness.
        ctx.beginPath();
        ctx.rect(rx, y0, COL_W, bankH);
        ctx.clip();

        if (!stopped(r)) {
          // Sub-row scroll, rounded to whole pixels — the reel must never land
          // on a half pixel or the smear bars fringe.
          const frac = offset[r] - Math.floor(offset[r]);
          const scroll = Math.round(-frac * ROW_H);
          const blur = Math.min(10, speed[r] * 0.4);
          for (let row = -1; row <= ROWS; row++) {
            const cy = y0 + row * ROW_H + ROW_H / 2 + scroll;
            drawSymbol(ctx, symbolAt(r, row), rx + COL_W / 2, cy, false, blur);
          }
          // ── Travel streaks ── the smear bars alone are flat colour: at this
          // speed they merge into one continuous painted column and stop
          // reading as movement at all. A ladder of hard 1px lines SCROLLING
          // with the reel is what restores the sense of travel, and unlike a
          // real blur it costs nothing in sharpness.
          const phase = Math.floor(offset[r] * ROW_H) % 8;
          for (let sy = y0 - 8 + phase; sy < y0 + bankH; sy += 8) {
            box(ctx, rx + 2, sy, COL_W - 4, 1, "#0a0d14");
          }
        } else {
          for (let row = 0; row < ROWS; row++) {
            const cy = y0 + row * ROW_H + ROW_H / 2 + dy;
            drawSymbol(ctx, symbolAt(r, row), rx + COL_W / 2, cy, row === 1, 0);
          }
        }

        // ── The drum going over the horizon ── hard opaque bands, top and
        // bottom, that CUT INTO the outer symbols. This is what makes the reel
        // read as a cylinder; a gradient would read as fog.
        const bands = ["#070a10", "#0b0e16", "#10151e"];
        bands.forEach((col, i) => {
          box(ctx, rx, y0 + i * 4, COL_W, 4, col);
          box(ctx, rx, y0 + bankH - 4 - i * 4, COL_W, 4, col);
        });
        // Inset shadow down the sides, so each window looks recessed.
        box(ctx, rx, y0, 2, bankH, "#090c13");
        box(ctx, rx + COL_W - 2, y0, 2, bankH, "#0d1119");

        ctx.restore();

        // Freshly landed cell gets a one-off bright inset — the impact read.
        if (flashT[r] > 0) {
          frame(ctx, rx + 2, y0 + ROW_H + 1, COL_W - 4, ROW_H - 2, C_WIN_HI, 2);
        }

        // Winning cells get a lit inset border that holds while the win does.
        if (won && wins[r]) {
          const pulse = Math.floor(t * 8) % 2 === 0;
          frame(ctx, rx + 2, y0 + ROW_H + 1, COL_W - 4, ROW_H - 2, pulse ? C_WIN_HI : C_WIN, 2);
          frame(ctx, rx + 4, y0 + ROW_H + 3, COL_W - 8, ROW_H - 6, pulse ? C_WIN : "#8a6a18", 1);
        }

        // Window frame.
        frame(ctx, rx - 1, y0 - 1, COL_W + 2, bankH + 2, won && wins[r] ? C_WIN : C_CAB_INK);
      }

      // ── The payline ── a 2px bar with stepped arrow nubs at each end, so the
      // eye is told exactly which row is being paid. Arrowheads are pixel
      // staircases, not `lineTo` triangles.
      const lineY = y0 + ROW_H + Math.floor(ROW_H / 2) - 1;
      const lineCol = won ? C_WIN : C_DIM;
      box(ctx, x0 - BEZEL + 3, lineY, bankW + (BEZEL - 3) * 2, 2, lineCol);
      for (let i = 0; i < 4; i++) {
        // Left nub points right, right nub points left.
        box(ctx, x0 - BEZEL - 4 + i, lineY - 3 + i, 2, 8 - i * 2, lineCol);
        box(ctx, x0 + bankW + BEZEL + 2 - i, lineY - 3 + i, 2, 8 - i * 2, lineCol);
      }

      // ── Marquee ── the machine's own status line, above the glass.
      const marqW = bankW + BEZEL * 2;
      box(ctx, bx, 8, marqW, 16, C_CAB_LO);
      frame(ctx, bx, 8, marqW, 16, C_CAB_INK);
      box(ctx, bx + 1, 9, marqW - 2, 1, C_CAB_HI);
      let marquee = "PULL TO PLAY";
      let marqCol = C_TEXT;
      if (spinning) {
        marquee = "GOOD LUCK";
        marqCol = "#6fd0e8";
      } else if (won && settleT > 0 && outcome) {
        marquee = outcome.label;
        marqCol = Math.floor(t * 8) % 2 === 0 ? C_WIN_HI : C_WIN;
      } else if (!won && settleT > 0 && outcome) {
        marquee = outcome.label;
        marqCol = "#8a8578";
      } else if (attract) {
        // Attract mode: alternate the come-on with the top prize.
        marquee = Math.floor(idleT * 0.6) % 2 === 0 ? "PULL TO PLAY" : "3 STARS PAYS 25X";
        marqCol = Math.floor(t * 2) % 2 === 0 ? C_WIN : C_TEXT;
      }
      label(ctx, marquee, w / 2, 12, 8, marqCol, "center");

      // ── Readout ── stake and last win, drawn INSIDE the machine as part of
      // it rather than as HUD text floating over the top.
      const readY = h - 22;
      const readW = 96;
      for (const [rx0, key, val, col] of [
        [bx, "STAKE", stakeNow > 0 ? `${stakeNow}g` : "--", C_TEXT],
        [bx + marqW - readW, "WIN", lastPayout > 0 ? `${lastPayout}g` : "--", lastPayout > 0 ? C_WIN : "#6a6558"],
      ] as Array<[number, string, string, string]>) {
        box(ctx, rx0, readY, readW, 14, "#0a0d14");
        frame(ctx, rx0, readY, readW, 14, C_CHROME_LO);
        box(ctx, rx0 + 1, readY + 1, readW - 2, 1, "#04060a");
        label(ctx, key, rx0 + 4, readY + 4, 7, "#6a6558");
        label(ctx, val, rx0 + readW - 4, readY + 4, 7, col, "right");
      }

      // ── Lever ── on the right shoulder, thrown on play and easing back.
      const levX = w - 22;
      const levTop = 40 + Math.round(lever * 46);
      box(ctx, levX, levTop, 4, h - 56 - (levTop - 40), C_CHROME_LO);
      box(ctx, levX, levTop, 2, h - 56 - (levTop - 40), C_CHROME);
      box(ctx, levX - 3, levTop - 8, 10, 8, "#8f1f2a");
      box(ctx, levX - 3, levTop - 8, 10, 2, "#c94a55");
      box(ctx, levX - 3, levTop - 2, 10, 2, "#5e2030");
      box(ctx, levX - 2, levTop - 7, 3, 2, "#f0a8ac");

      // ── Jackpot celebration ── screen-edge flashes and hard sparkle pixels.
      if (jackpot && settleT > 0) {
        const on = Math.floor(t * 12) % 2 === 0;
        const edge = on ? C_WIN_HI : C_WIN;
        box(ctx, 0, 0, w, 3, edge);
        box(ctx, 0, h - 3, w, 3, edge);
        box(ctx, 0, 0, 3, h, edge);
        box(ctx, w - 3, 0, 3, h, edge);
        sparkles.forEach(([sx, sy], i) => {
          // Each sparkle blinks on its own beat so the field twinkles instead
          // of strobing as one block.
          if ((Math.floor(t * 14) + i) % 4 !== 0) return;
          box(ctx, sx, sy, 2, 2, C_WIN_HI);
          box(ctx, sx - 2, sy, 1, 2, C_WIN);
          box(ctx, sx + 2, sy, 1, 2, C_WIN);
          box(ctx, sx, sy - 2, 2, 1, C_WIN);
          box(ctx, sx, sy + 2, 2, 1, C_WIN);
        });
      }
    },
  };
}
