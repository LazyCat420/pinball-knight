/**
 * PICKUP TOASTS + FLOOR TITLES — the transient text layer.
 *
 * Replaces `pickup-toast.ts` and the toast half of `ui.ts`. Like the HUD this
 * screen does NOT pause and never takes input; unlike the HUD it is usually
 * empty, so it costs a loop over an empty array.
 *
 * ── WHY A MODULE-LEVEL QUEUE AND NOT SCREEN STATE ──
 * Toasts are raised from all over the game (loot, the shop, weapon swaps, floor
 * transitions) by code that has no reference to any screen. The DOM version
 * solved that by appending to a well-known element id; the equivalent here is a
 * module the raiser can import and the screen can drain. Same shape, no
 * document.
 *
 * The DOM version rate-limited with a `MAX_ROWS` cap and per-element timeouts.
 * Here the cap is a slice and the timing is wall-clock, so a paused game does
 * not silently expire the toasts it is showing you — which the timeout version
 * did, and is why a card pickup read during a pause could vanish mid-read.
 */
import { UI, GRID } from "../theme";
import { fillRect, rect, strokeRect, text, type UiFrame } from "../im";
import { cardFace, CARD_W, CARD_H } from "../card-face";
import type { CardId } from "../../cards";
import type { UiScreen } from "../stack";

const MAX_ROWS = 4;
const HOLD_MS = 2200;
const CARD_HOLD_MS = 2900;
const FADE_MS = 260;

interface Toast {
  text: string;
  card?: CardId;
  until: number;
}

const queue: Toast[] = [];

/** A plain line of text — pickups, weapon swaps, notes. */
export function pushToast(msg: string): void {
  queue.push({ text: msg, until: performance.now() + HOLD_MS });
  if (queue.length > MAX_ROWS) queue.splice(0, queue.length - MAX_ROWS);
}

/** A card pickup — shows the face next to the note, and holds a little longer. */
export function pushCardToast(id: CardId, note: string): void {
  queue.push({ text: note, card: id, until: performance.now() + CARD_HOLD_MS });
  if (queue.length > MAX_ROWS) queue.splice(0, queue.length - MAX_ROWS);
}

export function clearToasts(): void {
  queue.length = 0;
}

/** A big centred announcement — floor titles, "BOSS", rampage. */
let banner: { title: string; sub: string; until: number } | null = null;
export function pushBanner(title: string, sub = "", ms = 2400): void {
  banner = { title, sub, until: performance.now() + ms };
}

/**
 * FLOATING COMBO NUMBERS.
 *
 * `ui.spawnFloatingCombo` used to append an absolutely-positioned div per hit
 * and animate it with a CSS transition. Here they are a small pool of
 * screen-space numbers that rise and fade — same read, and now inside the pixel
 * pass, so a x7 combo snaps to the gold ramp like everything else instead of
 * being the one un-quantized thing on screen at the loudest moment in the game.
 */
interface Floater {
  text: string;
  x: number;
  y: number;
  born: number;
}
const floaters: Floater[] = [];
const FLOAT_MS = 900;

export function pushFloatingCombo(combo: number, sx: number, sy: number): void {
  floaters.push({ text: `x${combo}`, x: sx, y: sy, born: performance.now() });
  // Bounded: a long chain can raise these faster than they expire, and an
  // unbounded array here would grow for the whole run.
  if (floaters.length > 24) floaters.splice(0, floaters.length - 24);
}

export function clearFloatingCombos(): void {
  floaters.length = 0;
}

const TOAST_W = 260;
const ROW_H = 30;
const CARD_TOAST_H = 54;

export function toastScreen(): UiScreen {
  return {
    id: "toasts",
    pauses: false,
    focus: 0,
    scroll: 0,
    paint(f) {
      const now = performance.now();
      // Expire from the front; the array is in raise order so the oldest is
      // always index 0 and one splice clears every lapsed row.
      while (queue.length && queue[0].until < now) queue.shift();

      let y = f.h - 128;
      for (let i = queue.length - 1; i >= 0; i--) {
        const t = queue[i];
        const left = t.until - now;
        // Fade the last quarter-second rather than popping. Alpha is applied to
        // the whole row via globalAlpha, which is cheap and keeps the palette
        // snap honest — a faded gold is still on the gold ramp.
        const a = Math.max(0, Math.min(1, left / FADE_MS));
        f.g.globalAlpha = a;
        const h = t.card ? CARD_TOAST_H : ROW_H;
        y -= h + 4;
        const r = rect(f.w - TOAST_W - GRID, y, TOAST_W, h);
        fillRect(f, r, UI.well);
        strokeRect(f, r, t.card ? UI.gold : UI.sheetEdge);
        if (t.card) {
          const fw = Math.round((CARD_W / CARD_H) * (h - 8));
          const face = cardFace(t.card);
          if (face) f.g.drawImage(face, r.x + 4, r.y + 4, fw, h - 8);
          text(f, t.text, r.x + fw + 10, r.y + h / 2 - 4, { size: 8, colour: UI.text, max: r.w - fw - 16 });
        } else {
          text(f, t.text, r.x + GRID, r.y + (h - 8) / 2, { size: 8, colour: UI.text, max: r.w - GRID * 2 });
        }
        f.g.globalAlpha = 1;
      }

      // Floating combos: rise 30px over their life and fade out.
      for (let i = floaters.length - 1; i >= 0; i--) {
        const fl = floaters[i];
        const age = (now - fl.born) / FLOAT_MS;
        if (age >= 1) {
          floaters.splice(i, 1);
          continue;
        }
        f.g.globalAlpha = 1 - age;
        text(f, fl.text, fl.x, fl.y - age * 30, { size: 16, colour: UI.gold, align: "center" });
        f.g.globalAlpha = 1;
      }

      if (banner) {
        const left = banner.until - now;
        if (left <= 0) banner = null;
        else {
          f.g.globalAlpha = Math.max(0, Math.min(1, left / 400));
          text(f, banner.title, f.w / 2, f.h * 0.3, { size: 32, colour: UI.gold, align: "center" });
          if (banner.sub) {
            text(f, banner.sub, f.w / 2, f.h * 0.3 + 44, { size: 8, colour: UI.textDim, align: "center" });
          }
          f.g.globalAlpha = 1;
        }
      }
    },
  };
}
