/**
 * THE IMMEDIATE-MODE UI — paint and interaction in one pass.
 *
 * ## Why immediate mode, when the thing it replaces was retained
 *
 * The DOM menu was retained-mode by necessity: build an element tree, mutate
 * it, and re-`innerHTML` the lot whenever anything changed. That design is the
 * direct cause of the two worst bugs the menu ever had, both still documented
 * in `menu.ts`:
 *
 *   · Widget identity lived in STRING ATTRIBUTES (`data-act`, `data-idx`), so
 *     an empty `data-idx=""` could shadow the act suffix and `spendSkillPoint("")`
 *     failed silently while the re-render happily repainted every affordance.
 *     The tree "selected everything then nothing" and nothing threw.
 *   · Every interaction re-rendered the WHOLE sheet, so transient state
 *     (selection, the armed ABANDON button) had to be hoisted into module-level
 *     `let`s and manually reset.
 *
 * In immediate mode a widget's identity is WHERE IT IS IN THE CALL ORDER. There
 * is no string to typo, no attribute to shadow, and no separate render step to
 * fall out of sync with the state it draws. `if (button(f, r, "Buy")) buy()` is
 * the entire contract.
 *
 * ## The frame
 *
 * One `UiFrame` per painted frame carries the context, the grid size, the input
 * snapshot and the focus cursor. Widgets register themselves in call order as
 * they paint; nav keys move `focus` by index; the NEXT frame renders the new
 * focus. That one-frame lag is invisible at 60Hz and is what lets layout and
 * interaction share a single pass.
 *
 * ## Focus is the point
 *
 * The DOM menus were mouse-only — there was never a way to drive them from a
 * pad, which in a game you play with a pad is a real gap. Here every
 * interactive widget calls `focusable()`, so D-pad/stick navigation is
 * automatic and the mouse simply MOVES the focus rather than bypassing it. One
 * model, both devices, no second code path to keep in sync.
 */
import { UI, GRID, FONT, ROW_H, snap, px } from "./theme";

// ── Geometry ──────────────────────────────────────────────────────────────────

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function rect(x: number, y: number, w: number, h: number): Rect {
  return { x, y, w, h };
}

export function hit(r: Rect, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

/** Shrink a rect on all sides. Negative grows it. */
export function inset(r: Rect, by: number): Rect {
  return { x: r.x + by, y: r.y + by, w: r.w - by * 2, h: r.h - by * 2 };
}

/** Take `h` pixels off the top of `r`, mutating `r` to the remainder. */
export function cutTop(r: Rect, h: number): Rect {
  const out = { x: r.x, y: r.y, w: r.w, h };
  r.y += h;
  r.h -= h;
  return out;
}

/** Take `w` pixels off the left of `r`, mutating `r` to the remainder. */
export function cutLeft(r: Rect, w: number): Rect {
  const out = { x: r.x, y: r.y, w, h: r.h };
  r.x += w;
  r.w -= w;
  return out;
}

/** Take `w` pixels off the RIGHT of `r`. For trailing controls on a row. */
export function cutRight(r: Rect, w: number): Rect {
  const out = { x: r.x + r.w - w, y: r.y, w, h: r.h };
  r.w -= w;
  return out;
}

// ── Input ─────────────────────────────────────────────────────────────────────

/**
 * One frame's input, already normalised.
 *
 * Everything here except `pointer.down` is EDGE-TRIGGERED — true on the frame
 * the input began and never again until it is released. The UI is painted every
 * frame while a screen is open, so a level-triggered `accept` would fire sixty
 * times a second and buy sixty skill ranks from one button press. `gui/input.ts`
 * owns the edge detection; widgets just read booleans.
 */
export interface UiInput {
  pointer: { x: number; y: number; inside: boolean; down: boolean; pressed: boolean; released: boolean };
  /** True only if the pointer moved this frame — see `focusFollowsMouse`. */
  pointerMoved: boolean;
  /**
   * Directional input, as a PRESS COUNT for this frame rather than a boolean.
   *
   * Counting is not fussiness. Presses accumulate between painted frames, and
   * the frame rate while a screen is open is neither high nor steady — the sim
   * is paused, so nothing else is driving the loop, and a loaded machine has
   * been measured delivering as few as 2 UI frames a second. A boolean (or the
   * Set that first backed one) silently COLLAPSES every repeat inside one
   * frame: tapping Down three times quickly moved the cursor once, and how many
   * were lost depended on machine load. That is the worst kind of input bug —
   * intermittent, unreproducible, and indistinguishable from a missed keypress.
   */
  up: number;
  down: number;
  left: number;
  right: number;
  nextTab: number;
  prevTab: number;
  /**
   * Activation stays BOOLEAN, deliberately. Losing a repeat here is harmless;
   * double-applying one is not — two accepts in a frame would buy two skill
   * ranks from one perceived press. Collapse is the safe direction for actions
   * and the unsafe direction for navigation, so they differ.
   */
  accept: boolean;
  cancel: boolean;
  /** Wheel/stick scroll in UI pixels for this frame. */
  scroll: number;
  /** Digits 1-9 pressed this frame, or 0. Tab jumps, belt slots, shop rows. */
  digit: number;
}

export function emptyUiInput(): UiInput {
  return {
    pointer: { x: -1, y: -1, inside: false, down: false, pressed: false, released: false },
    pointerMoved: false,
    up: 0,
    down: 0,
    left: 0,
    right: 0,
    nextTab: 0,
    prevTab: 0,
    accept: false,
    cancel: false,
    scroll: 0,
    digit: 0,
  };
}

// ── The frame ─────────────────────────────────────────────────────────────────

export interface UiFrame {
  g: CanvasRenderingContext2D;
  w: number;
  h: number;
  input: UiInput;
  /**
   * Index of the focused widget. Persisted BY THE SCREEN across frames — see
   * `ScreenState.focus` — because it must survive the repaint that a click
   * causes, and because each screen keeps its own cursor.
   */
  focus: number;
  /** Widgets registered so far this frame. Becomes the focus wrap-around count. */
  count: number;
  /** Set when a widget consumed `accept`, so nothing downstream double-fires. */
  consumed: boolean;
  /** Whether the pixel fonts are up yet; text() falls back until they are. */
  fonts: boolean;
  /** Current clip stack depth, for `pushClip`/`popClip` balance assertions. */
  clips: number;
}

export function beginUi(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  input: UiInput,
  focus: number,
  fonts: boolean,
): UiFrame {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.imageSmoothingEnabled = false;
  g.textBaseline = "top";
  return { g, w, h, input, focus, count: 0, consumed: false, fonts, clips: 0 };
}

/**
 * Register an interactive widget and report how it is being addressed.
 *
 * Call order IS identity, so this must be called unconditionally by every
 * interactive widget in a screen, in the same order every frame. A widget that
 * registers only when visible will renumber everything after it and the focus
 * cursor will appear to jump — the immediate-mode equivalent of the shadowed
 * `data-idx`, and the one failure mode this design can still have. Screens that
 * genuinely add/remove rows must reset focus (`clampFocus`) when they do.
 */
export interface WidgetState {
  index: number;
  focused: boolean;
  hovered: boolean;
  /** Activated this frame: pad `accept` while focused, or a click landing on it. */
  activated: boolean;
}

export function focusable(f: UiFrame, r: Rect, opts: { disabled?: boolean } = {}): WidgetState {
  const index = f.count++;
  if (opts.disabled) return { index, focused: false, hovered: false, activated: false };

  const p = f.input.pointer;
  const hovered = p.inside && hit(r, p.x, p.y);

  // THE MOUSE MOVES FOCUS, it does not bypass it. If a click could activate a
  // widget the focus ring is not on, the two input models would disagree about
  // what is selected and a pad user would watch the highlight sit still while
  // things fired elsewhere. Guarded on actual movement so that a resting mouse
  // does not fight the D-pad for the cursor.
  if (hovered && f.input.pointerMoved) f.focus = index;

  const focused = f.focus === index;
  const activated =
    (!f.consumed && focused && f.input.accept) || (hovered && p.pressed);
  if (activated) f.consumed = true;
  return { index, focused, hovered, activated };
}

/**
 * Move the focus cursor and keep it in range.
 *
 * Called AFTER a screen has painted, when `f.count` is the true widget count.
 * Wrapping rather than clamping because a six-tab menu wants Down from the last
 * row to return to the first — a cursor that sticks at the bottom reads as
 * broken input rather than as a boundary.
 */
export function moveFocus(f: UiFrame, delta: number): number {
  if (f.count === 0) return 0;
  return (f.focus + delta + f.count * 2) % f.count;
}

/** Keep a persisted cursor valid when a screen's widget count changes. */
export function clampFocus(focus: number, count: number): number {
  if (count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, focus));
}

// ── Painting primitives ───────────────────────────────────────────────────────

export function fillRect(f: UiFrame, r: Rect, css: string): void {
  f.g.fillStyle = css;
  f.g.fillRect(px(r.x), px(r.y), px(r.w), px(r.h));
}

/**
 * A 1px frame drawn INSIDE the rect.
 *
 * `strokeRect` straddles the path with a 1px line, which puts half a pixel on
 * each side of the boundary — on this grid that is an antialiased two-tone edge
 * that the quantizer then snaps into a visible double line. Four `fillRect`s
 * are unambiguous and cost the same.
 */
export function strokeRect(f: UiFrame, r: Rect, css: string, weight = 1): void {
  const g = f.g;
  g.fillStyle = css;
  const x = px(r.x);
  const y = px(r.y);
  const w = px(r.w);
  const h = px(r.h);
  g.fillRect(x, y, w, weight);
  g.fillRect(x, y + h - weight, w, weight);
  g.fillRect(x, y + weight, weight, h - weight * 2);
  g.fillRect(x + w - weight, y + weight, weight, h - weight * 2);
}

/** A sunken well: dark fill, dark edge. The background for rows and lists. */
export function well(f: UiFrame, r: Rect): void {
  fillRect(f, r, UI.well);
  strokeRect(f, r, UI.wellEdge);
}

/**
 * The focus ring. Drawn OUTSIDE the widget so it never eats a pixel of content,
 * and in the palette's brightest entry so it survives the scanline dimming.
 */
export function focusRing(f: UiFrame, r: Rect): void {
  strokeRect(f, inset(r, -2), UI.focus);
}

export type Align = "left" | "center" | "right";

/**
 * Draw text on the grid.
 *
 * `size` is restricted to the 8px multiples Press Start 2P is designed for.
 * The y is snapped to whole pixels; the x is snapped too unless centring, where
 * a half-pixel is preferable to a visibly off-centre label.
 */
export function text(
  f: UiFrame,
  s: string,
  x: number,
  y: number,
  opts: { size?: 8 | 16 | 24 | 32; colour?: string; align?: Align; max?: number } = {},
): number {
  const g = f.g;
  const size = opts.size ?? 8;
  // Before the woff2 fonts resolve, Press Start 2P falls back to a system face
  // at the same px size — much wider, so labels would overlap. Monospace at the
  // same size is close enough in advance width to keep the layout honest for
  // the handful of frames involved.
  g.font = f.fonts ? FONT.label(size) : `${size}px ui-monospace, monospace`;
  g.fillStyle = opts.colour ?? UI.text;
  let str = s;
  if (opts.max !== undefined) str = ellipsize(f, str, opts.max, size);
  const w = g.measureText(str).width;
  let dx = x;
  if (opts.align === "center") dx = x - w / 2;
  else if (opts.align === "right") dx = x - w;
  g.fillText(str, px(dx), px(y));
  return w;
}

/** Trim with a trailing "…" to fit `max` UI pixels. */
export function ellipsize(f: UiFrame, s: string, max: number, size: 8 | 16 | 24 | 32 = 8): string {
  const g = f.g;
  g.font = f.fonts ? FONT.label(size) : `${size}px ui-monospace, monospace`;
  if (g.measureText(s).width <= max) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (g.measureText(s.slice(0, mid) + "…").width <= max) lo = mid;
    else hi = mid - 1;
  }
  return s.slice(0, lo) + "…";
}

/** Word-wrap into lines that fit `max` pixels. Returns the lines. */
export function wrap(f: UiFrame, s: string, max: number, size: 8 | 16 | 24 | 32 = 8): string[] {
  const g = f.g;
  g.font = f.fonts ? FONT.label(size) : `${size}px ui-monospace, monospace`;
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (g.measureText(next).width <= max || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// ── Widgets ───────────────────────────────────────────────────────────────────

/** The full-screen dim behind a modal sheet. */
export function scrim(f: UiFrame): void {
  fillRect(f, rect(0, 0, f.w, f.h), UI.scrim);
}

/**
 * A modal sheet, centred, on the grid.
 *
 * Returns the CONTENT rect (inside the frame and padding). Sizes are snapped so
 * the sheet's edges land on grid lines — an odd-width sheet centred on an
 * even-width grid puts its border on a half pixel and the frame renders two
 * pixels thick down one side only.
 */
export function sheet(f: UiFrame, w: number, h: number): Rect {
  const sw = snap(Math.min(w, f.w - GRID * 2));
  const sh = snap(Math.min(h, f.h - GRID * 2));
  const r = rect(snap((f.w - sw) / 2), snap((f.h - sh) / 2), sw, sh);
  fillRect(f, r, UI.sheet);
  strokeRect(f, r, UI.sheetEdge, 2);
  // A one-pixel lit edge along the top and left reads as a bevel and separates
  // the sheet from the scrim without a drop shadow (which cannot survive the
  // palette snap — a soft shadow becomes visible banding).
  f.g.fillStyle = UI.sheetEdgeLit;
  f.g.fillRect(px(r.x + 2), px(r.y + 2), px(r.w - 4), 1);
  f.g.fillRect(px(r.x + 2), px(r.y + 2), 1, px(r.h - 4));
  return inset(r, GRID * 2);
}

export function button(
  f: UiFrame,
  r: Rect,
  label: string,
  opts: { disabled?: boolean; danger?: boolean; good?: boolean } = {},
): boolean {
  const st = focusable(f, r, { disabled: opts.disabled });
  const accent = opts.danger ? UI.danger : opts.good ? UI.good : UI.gold;
  const fg = opts.disabled ? UI.textFaint : accent;
  fillRect(f, r, opts.disabled ? UI.well : UI.sheet);
  strokeRect(f, r, fg);
  text(f, label, r.x + r.w / 2, r.y + (r.h - 8) / 2, {
    size: 8,
    colour: fg,
    align: "center",
    max: r.w - GRID,
  });
  if (st.focused) focusRing(f, r);
  return st.activated;
}

/** ON/OFF pill. Returns true when it was toggled this frame. */
export function toggle(f: UiFrame, r: Rect, on: boolean, labels: [string, string] = ["ON", "OFF"]): boolean {
  const st = focusable(f, r);
  const fg = on ? UI.good : UI.textDim;
  fillRect(f, r, UI.well);
  strokeRect(f, r, fg);
  text(f, on ? labels[0] : labels[1], r.x + r.w / 2, r.y + (r.h - 8) / 2, {
    size: 8,
    colour: fg,
    align: "center",
  });
  if (st.focused) focusRing(f, r);
  return st.activated;
}

/** A rank meter: `filled` of `total` small squares, laid along the row. */
export function pips(f: UiFrame, r: Rect, filled: number, total: number): void {
  const size = 6;
  const gap = 2;
  for (let i = 0; i < total; i++) {
    const pr = rect(r.x + i * (size + gap), r.y + (r.h - size) / 2, size, size);
    fillRect(f, pr, i < filled ? UI.gold : UI.well);
    strokeRect(f, pr, i < filled ? UI.heading : UI.wellEdge);
  }
}

/** A labelled progress/XP bar. `t` is 0..1. */
export function bar(f: UiFrame, r: Rect, t: number, colour = UI.gold): void {
  well(f, r);
  const inner = inset(r, 1);
  const w = Math.max(0, Math.min(1, t)) * inner.w;
  if (w > 0) fillRect(f, rect(inner.x, inner.y, Math.round(w), inner.h), colour);
}

/** A section heading with a rule above it. */
export function heading(f: UiFrame, r: Rect, s: string, colour = UI.heading): void {
  fillRect(f, rect(r.x, r.y, r.w, 1), UI.sheetEdge);
  text(f, s.toUpperCase(), r.x, r.y + 8, { size: 8, colour });
}

/**
 * A horizontal tab strip. Returns the newly selected index, or `active`.
 *
 * Tabs register as focusables like everything else, so a pad can walk onto them;
 * `nextTab`/`prevTab` (Tab / shoulder buttons) also cycle them from anywhere in
 * the screen, which is how the DOM menu behaved and is worth keeping.
 */
export function tabs(f: UiFrame, r: Rect, labels: readonly string[], active: number): number {
  let next = active;
  const tw = Math.floor(r.w / labels.length);
  for (let i = 0; i < labels.length; i++) {
    const tr = rect(r.x + i * tw, r.y, tw - 2, r.h);
    const st = focusable(f, tr);
    const on = i === active;
    fillRect(f, tr, on ? UI.sheetEdge : UI.well);
    strokeRect(f, tr, on ? UI.gold : UI.wellEdge);
    text(f, labels[i], tr.x + tr.w / 2, tr.y + (tr.h - 8) / 2, {
      size: 8,
      colour: on ? UI.gold : UI.textDim,
      align: "center",
      max: tr.w - 4,
    });
    if (st.focused) focusRing(f, tr);
    if (st.activated) next = i;
  }
  // Counted, so holding a shoulder button through a slow frame does not drop
  // steps. `+ labels.length * n` keeps the modulo positive for any count.
  if (f.input.nextTab) next = (next + f.input.nextTab) % labels.length;
  if (f.input.prevTab) next = (next - f.input.prevTab + labels.length * (f.input.prevTab + 1)) % labels.length;
  if (f.input.digit >= 1 && f.input.digit <= labels.length) next = f.input.digit - 1;
  return next;
}

// ── Scrolling ─────────────────────────────────────────────────────────────────

/**
 * A clipped, scrollable region.
 *
 * This is the piece the DOM sheets got for free (`overflow:auto`) and the piece
 * the port genuinely needs: at 8px on a 720-line grid, the bestiary and the
 * skill tree do not fit on one screen, so a canvas UI without scrolling would
 * simply lose content off the bottom. Returns the inner rect to paint into,
 * already translated by the scroll offset.
 *
 * `contentH` is what the caller intends to draw. The offset is clamped here so
 * a screen whose content shrinks (a stash emptying) cannot leave the view
 * scrolled past the end showing blank space.
 */
export function beginScroll(f: UiFrame, r: Rect, contentH: number, offset: number): { inner: Rect; offset: number } {
  const max = Math.max(0, contentH - r.h);
  let next = Math.max(0, Math.min(max, offset));
  const p = f.input.pointer;
  if (p.inside && hit(r, p.x, p.y)) next = Math.max(0, Math.min(max, next + f.input.scroll));

  f.g.save();
  f.clips++;
  f.g.beginPath();
  f.g.rect(px(r.x), px(r.y), px(r.w), px(r.h));
  f.g.clip();
  f.g.translate(0, -Math.round(next));

  return { inner: rect(r.x, r.y + Math.round(next), r.w, contentH), offset: next };
}

export function endScroll(f: UiFrame, r: Rect, contentH: number, offset: number): void {
  f.g.restore();
  f.clips--;
  // The scrollbar is a bare 2px track — a real one would need hit testing and
  // drag, and a pad user can never touch it. It exists only to say "there is
  // more", which is the one thing losing `overflow:auto` actually cost.
  if (contentH <= r.h) return;
  const trackX = r.x + r.w - 2;
  fillRect(f, rect(trackX, r.y, 2, r.h), UI.well);
  const thumbH = Math.max(GRID, (r.h / contentH) * r.h);
  const thumbY = r.y + (offset / (contentH - r.h)) * (r.h - thumbH);
  fillRect(f, rect(trackX, Math.round(thumbY), 2, Math.round(thumbH)), UI.textDim);
}

/**
 * Keep the focused widget visible.
 *
 * Without this, D-pad navigation walks the cursor off the bottom of a scroll
 * region and the highlight vanishes while the input still works — which reads
 * exactly like the UI has frozen. Called by screens that scroll, with the rect
 * of the widget that currently has focus.
 */
export function scrollToShow(view: Rect, widget: Rect, offset: number): number {
  const top = widget.y - view.y;
  const bottom = top + widget.h;
  if (top < offset) return Math.max(0, top - ROW_H);
  if (bottom > offset + view.h) return bottom - view.h + ROW_H;
  return offset;
}
