/**
 * UI INPUT — one snapshot per painted frame, edge-triggered.
 *
 * ## Why the UI polls the pad itself
 *
 * The game's pad poller lives inside `simulate()`, and `simulate()` early-
 * returns while the sim is paused — which is exactly when a menu is open. So
 * the gameplay poller is asleep for the entire lifetime of every screen this
 * module serves. There is no conflict to arbitrate: the two pollers are never
 * awake at the same time.
 *
 * That is also why the UI does NOT reuse `TAP_BINDINGS`. Those map the D-pad to
 * belt slots 1-4 and START to "i" — correct during play, meaningless in a menu,
 * where the D-pad has to move a cursor. Rebinding them globally would break
 * gameplay; interpreting them differently based on modality would put a second
 * meaning behind one binding table. A small, separate, explicitly-UI binding
 * set that only runs while a screen is open is the cheaper and clearer answer.
 *
 * ## Everything is an edge
 *
 * The UI repaints every frame while open, so a level-triggered "accept" would
 * fire on every one of them: one press of A would buy sixty skill ranks. Every
 * boolean handed out in `UiInput` is true for exactly one frame. `takeFrame()`
 * is what clears them, so it must be called once per frame and its result used,
 * not sampled twice.
 */
import { screenToUi, type UiSizing } from "./coords";
import { emptyUiInput, type UiInput } from "./im";

/**
 * Normalise a `KeyboardEvent.key` to ONE casing.
 *
 * Every key is lowercased, named keys included. The first cut lowercased only
 * single-character keys and left `"ArrowDown"`/`"Enter"`/`"Escape"` as-is,
 * which meant the nav tables (written in lowercase) matched letters and NOTHING
 * else: the menu opened, painted, held focus — and ignored every arrow, Enter
 * and Escape. Nothing threw, and mouse input still worked, so it read as "the
 * keyboard is not wired up yet" rather than as a one-line casing bug. One rule
 * for every key removes the whole class.
 */
function normKey(key: string): string {
  return key.toLowerCase();
}

/** Held keys, by the normalised `KeyboardEvent.key`. */
const held = new Set<string>();
/**
 * Keys that went down since the last `takeFrame()`, AND HOW MANY TIMES.
 *
 * A Set here loses repeats — see the note on `UiInput.up`. The count is what
 * makes navigation independent of the frame rate.
 */
const tapped = new Map<string, number>();

let pointerClientX = -1;
let pointerClientY = -1;
let pointerMoved = false;
let pointerDown = false;
let pointerPressed = false;
let pointerReleased = false;
let wheelDelta = 0;
let installed = false;

/** Set by the driver so the listeners can cheaply ignore everything while closed. */
let live = false;

export function setUiInputLive(on: boolean): void {
  if (live === on) return;
  live = on;
  if (!on) {
    held.clear();
    tapped.clear();
    pointerDown = false;
    pointerPressed = false;
    pointerReleased = false;
    wheelDelta = 0;
    padPrev = null;
    repeatDir = 0;
  }
}

/**
 * Install the window listeners. Idempotent.
 *
 * These are on `window`, in the CAPTURE phase, and they run before the game's
 * own handlers. While a screen is open the UI owns the keyboard outright and
 * stops propagation — otherwise Esc would both close the menu and be seen by
 * `handleKey`'s gameplay switch, and arrow keys would walk the knight around
 * underneath a paused sheet.
 */
export function installUiInput(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener(
    "keydown",
    (e) => {
      if (!live) return;
      const k = normKey(e.key);
      if (!held.has(k)) tapped.set(k, (tapped.get(k) ?? 0) + 1);
      held.add(k);
      // Tab would move DOM focus out of the canvas and Space would scroll the
      // page; both are meaningful UI keys here.
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );

  window.addEventListener(
    "keyup",
    (e) => {
      const k = normKey(e.key);
      held.delete(k);
      if (live) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );

  window.addEventListener(
    "mousemove",
    (e) => {
      if (!live) return;
      // Only a real move counts. A resting mouse that merely happens to sit over
      // a widget must not keep yanking focus back from the D-pad.
      if (e.clientX !== pointerClientX || e.clientY !== pointerClientY) pointerMoved = true;
      pointerClientX = e.clientX;
      pointerClientY = e.clientY;
    },
    true,
  );

  window.addEventListener(
    "mousedown",
    (e) => {
      if (!live) return;
      pointerClientX = e.clientX;
      pointerClientY = e.clientY;
      pointerDown = true;
      pointerPressed = true;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );

  window.addEventListener(
    "mouseup",
    (e) => {
      if (!live) return;
      pointerDown = false;
      pointerReleased = true;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );

  window.addEventListener(
    "wheel",
    (e) => {
      if (!live) return;
      wheelDelta += e.deltaY;
      e.preventDefault();
    },
    { capture: true, passive: false },
  );

  window.addEventListener("blur", () => {
    held.clear();
    pointerDown = false;
  });
}

// ── Gamepad ───────────────────────────────────────────────────────────────────

/** Xbox-layout indices, matching engine/gamepad.ts's BTN. */
const PAD_A = 0;
const PAD_B = 1;
const PAD_LB = 4;
const PAD_RB = 5;
const PAD_BACK = 8;
const PAD_START = 9;
const PAD_DUP = 12;
const PAD_DDOWN = 13;
const PAD_DLEFT = 14;
const PAD_DRIGHT = 15;

let padPrev: boolean[] | null = null;

/**
 * Stick-held repeat, so holding the stick down walks a long list.
 *
 * A D-pad press is a discrete edge and needs none of this; an analog stick has
 * no edges once deflected, so without a repeat it would move the cursor exactly
 * one row per push-and-release, which feels broken on a 30-row bestiary.
 */
const REPEAT_FIRST_MS = 380;
const REPEAT_NEXT_MS = 110;
let repeatDir = 0;
let repeatAt = 0;

interface PadEdges {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  accept: boolean;
  cancel: boolean;
  nextTab: boolean;
  prevTab: boolean;
}

function readUiPad(nowMs: number): PadEdges {
  const out: PadEdges = { up: false, down: false, left: false, right: false, accept: false, cancel: false, nextTab: false, prevTab: false };
  if (typeof navigator === "undefined" || !navigator.getGamepads) return out;

  // Merge every connected pad, exactly as engine/gamepad.ts does and for the
  // same reason: a stale ghost pad alongside a real one is common on Windows,
  // and picking index 0 can pick the dead one.
  const buttons: boolean[] = [];
  let ax = 0;
  let ay = 0;
  for (const p of navigator.getGamepads()) {
    if (!p || p.connected === false) continue;
    for (let i = 0; i < p.buttons.length; i++) buttons[i] = buttons[i] || (p.buttons[i]?.pressed ?? false);
    if (Math.abs(p.axes[0] ?? 0) > Math.abs(ax)) ax = p.axes[0] ?? 0;
    if (Math.abs(p.axes[1] ?? 0) > Math.abs(ay)) ay = p.axes[1] ?? 0;
  }

  // `padPrev === null` means we have never seen a pad: a button already held at
  // connect time is HELD, not freshly pressed. Same contract as readPad(), and
  // it matters more here — an edge on connect would dismiss a screen the player
  // was reading.
  const edge = (i: number): boolean => padPrev !== null && buttons[i] === true && padPrev[i] !== true;

  out.up = edge(PAD_DUP);
  out.down = edge(PAD_DDOWN);
  out.left = edge(PAD_DLEFT);
  out.right = edge(PAD_DRIGHT);
  out.accept = edge(PAD_A);
  out.cancel = edge(PAD_B) || edge(PAD_START) || edge(PAD_BACK);
  out.prevTab = edge(PAD_LB);
  out.nextTab = edge(PAD_RB);

  // Stick, with repeat. Vertical wins ties so a diagonal does not fire both.
  const DEAD = 0.55;
  const dir = Math.abs(ay) > DEAD ? (ay > 0 ? 2 : 1) : Math.abs(ax) > DEAD ? (ax > 0 ? 4 : 3) : 0;
  if (dir !== repeatDir) {
    repeatDir = dir;
    repeatAt = nowMs + REPEAT_FIRST_MS;
    if (dir === 1) out.up = true;
    else if (dir === 2) out.down = true;
    else if (dir === 3) out.left = true;
    else if (dir === 4) out.right = true;
  } else if (dir !== 0 && nowMs >= repeatAt) {
    repeatAt = nowMs + REPEAT_NEXT_MS;
    if (dir === 1) out.up = true;
    else if (dir === 2) out.down = true;
    else if (dir === 3) out.left = true;
    else if (dir === 4) out.right = true;
  }

  padPrev = buttons;
  return out;
}

// ── The snapshot ──────────────────────────────────────────────────────────────

const NAV_UP = ["arrowup", "w"];
const NAV_DOWN = ["arrowdown", "s"];
const NAV_LEFT = ["arrowleft", "a"];
const NAV_RIGHT = ["arrowright", "d"];
const ACCEPT = ["enter", " "];
const CANCEL = ["escape"];

/** Total presses across a set of synonymous keys (arrows and WASD). */
function tapCount(keys: readonly string[]): number {
  let n = 0;
  for (const k of keys) n += tapped.get(k) ?? 0;
  return n;
}

function anyTapped(keys: readonly string[]): boolean {
  return tapCount(keys) > 0;
}

/**
 * Build this frame's input and clear every edge.
 *
 * Call EXACTLY once per painted frame. Calling it twice hands the second caller
 * an empty snapshot (all edges consumed); not calling it lets taps pile up and
 * fire in a burst when a screen finally opens.
 */
export function takeFrame(sizing: UiSizing, winW: number, winH: number, nowMs: number): UiInput {
  const input = emptyUiInput();
  const pad = readUiPad(nowMs);

  input.up = tapCount(NAV_UP) + (pad.up ? 1 : 0);
  input.down = tapCount(NAV_DOWN) + (pad.down ? 1 : 0);
  input.left = tapCount(NAV_LEFT) + (pad.left ? 1 : 0);
  input.right = tapCount(NAV_RIGHT) + (pad.right ? 1 : 0);
  input.accept = anyTapped(ACCEPT) || pad.accept;
  input.cancel = anyTapped(CANCEL) || pad.cancel;
  // Shift+Tab walks backwards, the convention every other tabbed UI uses.
  const tabTaps = tapped.get("tab") ?? 0;
  input.nextTab = (held.has("shift") ? 0 : tabTaps) + (pad.nextTab ? 1 : 0);
  input.prevTab = (held.has("shift") ? tabTaps : 0) + (pad.prevTab ? 1 : 0);

  input.digit = 0;
  for (let d = 1; d <= 9; d++) {
    if (tapped.has(String(d))) {
      input.digit = d;
      break;
    }
  }

  const p = screenToUi(pointerClientX, pointerClientY, sizing, winW, winH);
  input.pointer.x = p.x;
  input.pointer.y = p.y;
  input.pointer.inside = p.inside && pointerClientX >= 0;
  input.pointer.down = pointerDown;
  input.pointer.pressed = pointerPressed;
  input.pointer.released = pointerReleased;
  input.pointerMoved = pointerMoved;

  // Wheel deltas are in CSS pixels; the UI grid is `scale` times coarser, and a
  // notch of a typical wheel is ~100px. Divide so one notch is a couple of rows
  // rather than half the sheet.
  input.scroll = Math.round(wheelDelta / sizing.scale / 4);

  tapped.clear();
  pointerPressed = false;
  pointerReleased = false;
  pointerMoved = false;
  wheelDelta = 0;
  return input;
}

/** Whether a key is currently held. For chords the snapshot does not model. */
export function uiKeyHeld(key: string): boolean {
  return held.has(key);
}
