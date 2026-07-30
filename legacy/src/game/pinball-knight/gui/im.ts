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
  /**
   * Printable characters typed this frame, in order, plus "\b" for backspace.
   *
   * The death screen asks for a leaderboard name, which was an `<input>` in the
   * DOM version — complete with a `keydown` stopPropagation so that typing a
   * name did not walk the knight around behind the death screen. On canvas
   * there is no input element to borrow, so text entry is a widget and this is
   * its feed. Empty on almost every frame.
   */
  typed: string;
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
    typed: "",
  };
}

// ── The frame ─────────────────────────────────────────────────────────────────

export interface UiFrame {
  g: CanvasRenderingContext2D;
  w: number;
  h: number;
  input: UiInput;
  /**
   * Device texels per UI pixel for this screen — see `UiScreen.design`.
   *
   * Screens never read it: `w`/`h` are already in the screen's own units and
   * the context carries the matching transform. It is here so a screen that
   * blits a fixed-size canvas can reason about how big the result really is.
   */
  scale: number;
  /**
   * Y translation currently applied to the context, in UI pixels.
   *
   * ── WHY HIT TESTING NEEDS THIS ──
   * `beginScroll` translates the CONTEXT by `-offset` and hands back an inner
   * rect at `y + offset`, so a widget's rect is in CONTENT space while the
   * pointer arrives in SCREEN space. At offset 0 the two agree, which is
   * exactly why this was invisible: every click worked until the list was
   * scrolled, and then every click was wrong by the scroll amount — hitting
   * the row `offset` pixels above the one under the cursor, or nothing at all.
   * Measured on the debug console, whose monster grid is only reachable by
   * scrolling: the buttons painted, highlighted on hover, and did nothing.
   *
   * `focusable` adds this back before testing, so both live in content space.
   */
  originY: number;
  /**
   * The active clip, in CONTENT space, or null for the whole frame.
   *
   * Drawing is clipped by canvas2D; hit testing is not. Without this a row
   * scrolled just past the top of its viewport still answers to the pointer —
   * an invisible button under the panel's heading.
   */
  clip: Rect | null;
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

/**
 * Start a frame for one screen.
 *
 * `scale` is the screen's zoom (see `UiScreen.design`). It is applied as a
 * CONTEXT TRANSFORM rather than baked into every coordinate, so a screen is
 * written once, in its own units, and the driver decides how many device texels
 * each of those units gets. With `imageSmoothingEnabled` off and whole-number
 * coordinates the result is a nearest-neighbour magnification — one UI pixel is
 * exactly `scale × scale` texels, which is the only way a UI can get physically
 * bigger without getting blurrier.
 */
export function beginUi(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  input: UiInput,
  focus: number,
  fonts: boolean,
  scale = 1,
): UiFrame {
  g.setTransform(scale, 0, 0, scale, 0, 0);
  g.imageSmoothingEnabled = false;
  g.textBaseline = "top";
  return { g, w, h, input, scale, originY: 0, clip: null, focus, count: 0, consumed: false, fonts, clips: 0 };
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
  // Into CONTENT space, where `r` lives — see `UiFrame.originY`. And only if
  // the point is actually inside the region that is DRAWING right now, so a
  // scrolled-away row cannot answer to a click that lands on the chrome above
  // it.
  const py = p.y + f.originY;
  const hovered = p.inside && (f.clip === null || hit(f.clip, p.x, py)) && hit(r, p.x, py);

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

/**
 * THE CHISEL — a two-tone bevel that makes a rect read as raised or sunken.
 *
 * ── WHY THIS IS ITS OWN PRIMITIVE ──
 * It is the single most-repeated shape in an id-software menu and the thing
 * this UI was missing: every panel, key, tab and well was a flat fill with a
 * 1px border, which is why the whole interface read as a terminal window rather
 * than as a machine with parts. A bevel is not decoration here — it is the only
 * cue that says which things you can press.
 *
 * The lit edge goes TOP AND LEFT for a raised surface and bottom-right for a
 * sunken one, which is the convention every one of these menus used because it
 * matches a light source above and behind the player. Getting it backwards does
 * not look "wrong" so much as it makes buttons look like holes, so the two
 * cases are one boolean rather than two call sites that can drift.
 *
 * `weight` is whole pixels, always. A fractional bevel on this surface is not
 * softer, it is a row of pixels that snap to different palette entries — the
 * same trap `strokeRect` documents just above.
 */
export function bevel(f: UiFrame, r: Rect, opts: { sunken?: boolean; weight?: number } = {}): void {
  const g = f.g;
  const w = opts.weight ?? 1;
  const lit = opts.sunken ? UI.bevelShade : UI.bevelLit;
  const shade = opts.sunken ? UI.bevelLit : UI.bevelShade;
  const x = px(r.x);
  const y = px(r.y);
  const rw = px(r.w);
  const rh = px(r.h);
  g.fillStyle = lit;
  g.fillRect(x, y, rw, w); // top
  g.fillRect(x, y, w, rh); // left
  g.fillStyle = shade;
  g.fillRect(x, y + rh - w, rw, w); // bottom
  g.fillRect(x + rw - w, y, w, rh); // right
}

/**
 * A raised key: face, keyline, chiselled edge. Buttons, tabs, plates.
 *
 * Deliberately separate from `sheet` — a control has to sit PROUD of the panel
 * it is on, and the two were the same fill before, distinguishable only by a
 * hairline accent.
 *
 * ⚠️ ORDER MATTERS AND IT IS EASY TO GET BACKWARDS. The first version drew the
 * face, then the bevel, then let the caller stroke its accent colour over the
 * top — and a 1px stroke on the same rect as a 1px bevel overwrites the bevel
 * COMPLETELY. Every button rendered as a flat panel with a coloured outline,
 * which is exactly the look this whole pass exists to replace, and it was
 * invisible in code review because both calls were plainly present and plainly
 * correct on their own. Caught by cropping a screenshot and counting pixels.
 *
 * So the keyline is drawn HERE, on the outer ring, and the chisel goes one
 * pixel in where nothing can land on it.
 */
export function key(f: UiFrame, r: Rect, opts: { face?: string; edge?: string; sunken?: boolean } = {}): void {
  fillRect(f, r, opts.face ?? UI.raised);
  if (opts.edge) strokeRect(f, r, opts.edge);
  bevel(f, opts.edge ? inset(r, 1) : r, { sunken: opts.sunken });
}

/** A sunken well: dark fill, chiselled INWARD. The background for rows and lists. */
export function well(f: UiFrame, r: Rect, edge?: string): void {
  key(f, r, { face: UI.well, sunken: true, ...(edge ? { edge } : {}) });
}

/**
 * THE SELECTOR — a blocky arrowhead pointing at the focused row.
 *
 * Doom's flaming skull and Wolfenstein's gun barrel do the same job: they put
 * the cursor BESIDE the selection instead of drawing a box around it, so the
 * player's eye tracks one moving mark down the list rather than re-finding a
 * rectangle each time. On a scanlined, quantized surface that matters more than
 * it does on a modern one — a 1px ring loses half its pixels to the dim, while
 * a solid triangle is still a solid triangle.
 *
 * Drawn from whole-pixel rows so it stays a crisp staircase at every zoom: no
 * path, no fill rule, nothing that could antialias.
 */
export function cursorMark(f: UiFrame, x: number, cy: number, size = 8): void {
  const g = f.g;
  g.fillStyle = UI.cursor;
  const half = Math.floor(size / 2);
  for (let i = 0; i < half; i++) {
    const h = (i + 1) * 2;
    g.fillRect(px(x + i), px(cy - h / 2), 1, h);
  }
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

// ── Icon blitting ─────────────────────────────────────────────────────────────

/**
 * The largest size ≤ `want` at which `native` divides EXACTLY.
 *
 * ── WHY A FRACTIONAL ICON BLIT IS NOT "SLIGHTLY SOFT" ──
 * The destination has smoothing off, so a non-integer ratio is not a filter at
 * all — it is a nearest-neighbour resample that DELETES whole rows and columns.
 * A 72px sprite drawn at 28 keeps 28 of every 72 rows, so a 1px highlight
 * survives or vanishes depending on its sub-pixel phase and the same icon loses
 * different details in different boxes. This repo has paid for that twice
 * already: the HUD mugshot at 120→72, and the shop icons at 216→28.
 *
 * Snapping DOWN rather than rounding is deliberate — an icon that grew past its
 * box would overlap whatever sits beside it, and a box is a layout promise. The
 * cost is a few pixels of padding, which `drawIcon` centres.
 */
export function exactIconSize(native: number, want: number): number {
  if (native <= 0 || want <= 0) return 0;
  // Upscaling: whole multiples only, for the same reason.
  if (want >= native) return native * Math.max(1, Math.floor(want / native));
  for (let n = Math.ceil(native / want); n <= native; n++) {
    if (native % n === 0) return native / n;
  }
  return 1;
}

/**
 * Draw an icon centred in a square box, at an exact integer ratio.
 *
 * Item sprites and monster chips are 72px native; procedural glyphs are
 * rasterised at the size asked for, so for those `native === want` and the snap
 * is the identity.
 */
export function drawIcon(
  g: CanvasRenderingContext2D,
  icon: HTMLCanvasElement | null,
  x: number,
  y: number,
  size: number,
): void {
  if (!icon) return;
  const d = exactIconSize(icon.width, size);
  if (d <= 0) return;
  g.imageSmoothingEnabled = false;
  g.drawImage(icon, Math.round(x + (size - d) / 2), Math.round(y + (size - d) / 2), d, d);
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
  // Stone plate, chiselled, inside a leather keyline. Three layers rather than
  // the flat fill + hairline this used to be — see `UI.sheet` for why the body
  // moved off near-black and onto the stone ramp.
  fillRect(f, r, UI.sheet);
  bevel(f, inset(r, 1), { weight: 2 });
  strokeRect(f, r, UI.sheetEdge, 1);
  // Corner rivets. Four pixels that do more for "this is a fabricated object"
  // than any amount of border weight — and the only structural use in the game
  // of the one palette entry nothing else names.
  const studs: Array<[number, number]> = [
    [r.x + 4, r.y + 4],
    [r.x + r.w - 6, r.y + 4],
    [r.x + 4, r.y + r.h - 6],
    [r.x + r.w - 6, r.y + r.h - 6],
  ];
  f.g.fillStyle = UI.rivet;
  for (const [sx, sy] of studs) f.g.fillRect(px(sx), px(sy), 2, 2);
  return inset(r, GRID * 2);
}

/**
 * A button.
 *
 * `icon` is the reason this takes options rather than being two functions. A
 * screen that hand-rolls "draw an icon, then draw a label next to it" has to
 * re-derive the inset, the vertical centring and the label's `max` width, and
 * three screens doing that arrived at three different paddings. One widget with
 * an optional mark keeps the whole UI on one metric — and, because the icon
 * shifts the label, an iconned button cannot silently overprint its own art.
 *
 * A button WITH an icon left-aligns its label; without one it centres. Centring
 * a label in the space left over next to a mark reads as a typo, because the
 * text sits at a different x on every row depending on how long it is.
 */
export function button(
  f: UiFrame,
  r: Rect,
  label: string,
  opts: {
    disabled?: boolean;
    danger?: boolean;
    good?: boolean;
    icon?: HTMLCanvasElement | null;
    /** Square edge of the icon box, in UI pixels. Defaults to the row's height. */
    iconSize?: number;
  } = {},
): boolean {
  const st = focusable(f, r, { disabled: opts.disabled });
  const accent = opts.danger ? UI.danger : opts.good ? UI.good : UI.gold;
  const fg = opts.disabled ? UI.textFaint : st.focused ? UI.focus : accent;
  // A disabled control is SUNKEN (you cannot press it), a live one is RAISED,
  // and the focused one lights up in blood. Three states, told by the surface
  // itself rather than by a border colour a scanline can eat.
  if (opts.disabled) well(f, r, UI.wellEdge);
  else key(f, r, { face: st.focused ? UI.selectFace : UI.raised, edge: st.focused ? UI.selectEdge : accent });

  // The selector lives in the button's own left padding, so it costs no layout
  // and cannot overrun a neighbour. It appears on focus; nothing shifts.
  const gutter = 6;
  if (st.focused && !opts.disabled) cursorMark(f, r.x + 2, r.y + r.h / 2);

  if (opts.icon) {
    const size = opts.iconSize ?? Math.max(8, r.h - 6);
    drawIcon(f.g, opts.icon, r.x + gutter + 1, r.y + (r.h - size) / 2, size);
    const tx = r.x + gutter + size + 6;
    text(f, label, tx, r.y + (r.h - 8) / 2, { size: 8, colour: fg, max: r.x + r.w - tx - 4 });
  } else {
    text(f, label, r.x + r.w / 2, r.y + (r.h - 8) / 2, {
      size: 8,
      colour: fg,
      align: "center",
      max: r.w - GRID * 2,
    });
  }
  if (st.focused) focusRing(f, r);
  return st.activated;
}

/** ON/OFF pill. Returns true when it was toggled this frame. */
export function toggle(f: UiFrame, r: Rect, on: boolean, labels: [string, string] = ["ON", "OFF"]): boolean {
  const st = focusable(f, r);
  const fg = on ? UI.good : UI.textDim;
  // ON is a key pushed IN, OFF is one standing proud — the switch reads at a
  // glance from its silhouette, before the label is legible at all.
  const edge = st.focused ? UI.focus : fg;
  if (on) well(f, r, edge);
  else key(f, r, { edge });
  text(f, on ? labels[0] : labels[1], r.x + r.w / 2, r.y + (r.h - 8) / 2, {
    size: 8,
    colour: st.focused ? UI.focus : fg,
    align: "center",
  });
  if (st.focused) focusRing(f, r);
  return st.activated;
}

/**
 * A stepped SLIDER. Returns the new value 0..1 (unchanged if nothing happened).
 *
 * ── BUILT ON `bar()` ON PURPOSE ──────────────────────────────────────────────
 * `bar()` was already the exact rendering this wants — a track of whole lit
 * cells, sized to divide evenly so no cell lands on a fractional pixel. It was
 * simply not interactive. So this is `bar()` plus a focus ring, a knob and an
 * input reading, rather than a second fill routine that would drift from it.
 *
 * ── STEPPED, NOT CONTINUOUS ──────────────────────────────────────────────────
 * The value snaps to `steps` notches. A continuous fader on this surface is a
 * lie: the track is ~100 UI pixels wide and every intermediate position renders
 * as the same cell count, so dragging would move a number nobody can see change.
 * Notches also mean a hand-edited settings blob always lands somewhere legal.
 *
 * ── THE FIRST CONSUMER OF `input.left` / `input.right` ───────────────────────
 * Those two have been populated for both keyboard and pad since the input layer
 * was written, edge-counted like the rest, and read by absolutely nothing. This
 * is the first widget to use them — which is why there is no conflict to resolve
 * with any existing screen.
 *
 * They are PRESS COUNTS, not booleans, and that is load-bearing here for the
 * reason spelled out on `UiInput`: a paused screen can be running at 2 frames a
 * second on a loaded machine, and a boolean would silently collapse three taps
 * into one step. Volume is exactly the control where that feels broken.
 *
 * `accept` steps right and wraps at the top, mirroring the camera-distance
 * cycler in the settings screen, so one control works from keyboard, pad and
 * mouse without a drag gesture — nothing else in this UI drags, and a slider
 * that needed to would be the odd one out.
 */
export function slider(f: UiFrame, r: Rect, value: number, opts: { steps?: number } = {}): number {
  const steps = opts.steps ?? 10;
  const st = focusable(f, r);
  const snap = (v: number) => Math.max(0, Math.min(1, Math.round(v * steps) / steps));
  let out = snap(value);

  if (st.focused) {
    for (let i = 0; i < f.input.left; i++) out = snap(out - 1 / steps);
    for (let i = 0; i < f.input.right; i++) out = snap(out + 1 / steps);
    // Wrap on accept so the control is reachable with one button.
    if (st.activated) out = out >= 1 ? 0 : snap(out + 1 / steps);
  }
  // Click/drag anywhere on the track jumps to that notch. Dragging off the track
  // stops tracking, which is acceptable — see the note above about gestures.
  if (st.hovered && f.input.pointer.down && r.w > 4) {
    out = snap((f.input.pointer.x - r.x) / r.w);
  }

  const track = cutLeft(r, r.w - 34);
  bar(f, track, out, st.focused ? UI.focus : UI.gold);
  if (st.focused) focusRing(f, track);
  // The numeric read-out is not decoration: a row of lit cells at 8px does not
  // tell you WHICH notch is current, and "is it at 6 or 7" is the only question
  // a volume control gets asked.
  text(f, `${Math.round(out * 100)}%`, r.x + r.w, r.y + (r.h - 8) / 2, {
    size: 8,
    colour: st.focused ? UI.focus : UI.textDim,
    align: "right",
  });
  return out;
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

/**
 * A progress/XP bar, filled in BLOCKS rather than as a smooth sweep. `t` is 0..1.
 *
 * The segmentation is the id-software tell — a Doom bar is a row of cells that
 * light up, and it is legible from across a room in a way a continuous fill is
 * not. It also happens to be the honest rendering here: a smooth fill lands on
 * a fractional pixel boundary, and a fractional edge on this surface is a
 * half-lit column that snaps to a different palette entry and shimmers as the
 * value creeps. Whole cells cannot do that.
 *
 * Cells are sized to divide the track EXACTLY, so the last one lands flush with
 * the frame instead of leaving a ragged pixel or two — the same "no fractional
 * blits" rule the icon path already enforces.
 */
export function bar(f: UiFrame, r: Rect, t: number, colour = UI.gold): void {
  well(f, r);
  const inner = inset(r, 2);
  if (inner.w <= 0 || inner.h <= 0) return;
  const frac = Math.max(0, Math.min(1, t));
  // ~5px cells with a 1px gutter, rounded to whatever divides the track evenly.
  const cells = Math.max(1, Math.round(inner.w / 6));
  const cw = inner.w / cells;
  const lit = Math.round(frac * cells);
  for (let i = 0; i < lit; i++) {
    const x = Math.round(inner.x + i * cw);
    const w = Math.round(inner.x + (i + 1) * cw) - x - 1;
    if (w > 0) fillRect(f, rect(x, inner.y, w, inner.h), colour);
  }
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
    // The ACTIVE tab is the one pressed in — a physical selector, so which page
    // you are on is readable without comparing two shades of text.
    if (on) key(f, tr, { face: UI.selectFace, edge: UI.gold, sunken: true });
    else key(f, tr, { edge: UI.wellEdge });
    text(f, labels[i], tr.x + tr.w / 2, tr.y + (tr.h - 8) / 2, {
      size: 8,
      colour: on ? UI.focus : UI.textDim,
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
  const shift = Math.round(next);
  f.g.translate(0, -shift);
  // Hit testing has to move with the paint, or every click inside a scrolled
  // list lands `shift` pixels off — see `UiFrame.originY`. Both are recorded in
  // CONTENT space, matching the rect handed back below.
  f.originY = shift;
  f.clip = rect(r.x, r.y + shift, r.w, r.h);

  // ── THE INNER RECT STARTS AT `r.y`, NOT AT `r.y + shift` ──
  // Offsetting the layout by `+shift` while the context is translated by
  // `-shift` is an exact cancellation: every row lands back where it started
  // and the region NEVER SCROLLS. Everything around it looked healthy —
  // `offset` advanced, the thumb slid down the track, the clamp behaved — so
  // the only symptom was that the bottom of a long list could not be reached
  // by any means. Measured on the debug console (2026-07-29): `__gui().scroll`
  // read 175 while two consecutive screenshots were pixel-identical.
  return { inner: rect(r.x, r.y, r.w, contentH), offset: next };
}

export function endScroll(f: UiFrame, r: Rect, contentH: number, offset: number): void {
  f.g.restore();
  f.clips--;
  f.originY = 0;
  f.clip = null;
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


/**
 * A single-line text field.
 *
 * Deliberately minimal: no selection, no cursor movement, no clipboard. The one
 * place the game asks for text is a leaderboard name of at most `max`
 * characters, and every additional affordance is another thing to get wrong on
 * a surface with no native input. Typing appends, backspace removes, and the
 * field only accepts input while it holds focus — so the same keys are inert
 * everywhere else and cannot leak into gameplay.
 *
 * Returns the (possibly updated) value; the caller owns the storage.
 */
export function textField(f: UiFrame, r: Rect, value: string, opts: { max?: number; upper?: boolean } = {}): string {
  const st = focusable(f, r);
  well(f, r);
  strokeRect(f, r, st.focused ? UI.focus : UI.wellEdge);

  let next = value;
  if (st.focused && f.input.typed) {
    for (const ch of f.input.typed) {
      if (ch === "\b") next = next.slice(0, -1);
      else if (next.length < (opts.max ?? 16)) next += ch;
    }
    if (opts.upper) next = next.toUpperCase();
  }

  const shown = opts.upper ? next.toUpperCase() : next;
  text(f, shown, r.x + 6, r.y + (r.h - 8) / 2, { size: 8, colour: UI.text, max: r.w - 20 });
  // A caret, only while focused. Blinking is deliberately omitted: the UI
  // repaints every frame and a blink would be one more thing pinned to
  // wall-clock time in a screen that pauses the game.
  if (st.focused) {
    const w = f.g.measureText(shown).width;
    fillRect(f, rect(r.x + 6 + w + 2, r.y + (r.h - 10) / 2, 1, 10), UI.focus);
  }
  return next;
}
