/**
 * ON-SCREEN THUMB CONTROLS — painted, not built.
 *
 * The last DOM UI in the game. It was a `pointer-events:none` overlay holding a
 * floating stick and seven round buttons, each a div with a radial-gradient
 * background, positioned off a `--pad-bottom` custom property that tracked the
 * live HUD height by MEASURING `getBoundingClientRect()` on the HUD element
 * every resize.
 *
 * None of that is needed now. The HUD is painted at a height this module can
 * simply import, so the buttons sit above it by construction instead of by
 * measurement — and the measurement was fragile in exactly the way it sounds:
 * it read an element by id, so it silently returned 0 (buttons over the life
 * orb) any time the HUD had not mounted yet.
 *
 * ── ONE LAYOUT, THREE READERS ──
 * The painter, the hit test and `touch-layout.test.ts` MUST agree, and they are
 * the classic place for a one-pixel drift that presents as "the button does
 * nothing near its edge". So the geometry lives in `touch-layout.ts` and all
 * three call it. Same rule as `canvasOrigin` in coords.ts, for the same reason.
 *
 * ── WHY ITS OWN LISTENERS ──
 * `gui/input.ts` only captures while a PAUSING screen is open. These controls
 * have to work during play, when nothing is paused, and they write to the
 * `VirtualPad` rather than to `UiInput` — they are an input device, not a
 * widget. So they own a small set of pointer listeners, tracked per
 * `pointerId` so two thumbs work at once.
 *
 * ⚠️ NONE OF IT WORKS WITHOUT `touch-action: none`. See the block comment in
 * index.html: the browser claims a drag as a pan and fires `pointercancel`
 * after ONE `pointermove`, so the stick moved a single sample and froze, and
 * `pointerup` never arrived so held buttons stayed held. Measured on an
 * emulated iPhone against the deployed build:
 * `down 1, move 1, cancel 1, up 0`. `preventDefault()` in the handler cannot
 * fix it — for touch the browser decides before the listener is consulted.
 */
import { pressKey, type VirtualPad } from "../engine/virtual-pad";
import type { UiSizing } from "./coords";
import { screenToUi } from "./coords";
import { UI } from "./theme";
import { text, type UiFrame } from "./im";
import { isOpen, push, remove, type UiScreen } from "./stack";
import { padHit, padLayout, stickHome, type TouchAction, type TouchButton } from "./touch-layout";

/** How far the thumb travels for full deflection, as a multiple of the stick radius. */
const THROW_PER_R = 1.15;

export interface TouchControls {
  setVisible(v: boolean): void;
  dispose(): void;
}

/** Live state, shared by the painter and the listeners. */
const stick = { active: false, pointer: -1, baseX: 0, baseY: 0, x: 0, y: 0 };
const pressed = new Map<string, number>(); // button id → pointerId
let visible = true;

export function touchScreen(): UiScreen {
  return {
    id: "touch",
    pauses: false,
    focus: 0,
    scroll: 0,
    paint(f) {
      if (!visible) return;
      paintStick(f);
      for (const b of padLayout(f.w, f.h)) paintButton(f, b, pressed.has(b.id));
    },
  };
}

/**
 * The movement stick — a sunken well with a raised cap, so it reads as a
 * physical thumbstick rather than as two flat circles.
 *
 * Drawn at `stickHome` when idle and at the thumb when engaged. The idle draw
 * is the change that makes the screen look like a controller: without it the
 * left half was blank until you touched it, and there was nothing telling a
 * first-time player that half the screen WAS the stick.
 */
function paintStick(f: UiFrame): void {
  const home = stickHome(f.w, f.h);
  const cx = stick.active ? stick.baseX : home.x;
  const cy = stick.active ? stick.baseY : home.y;
  const r = home.r;
  disc(f, cx, cy, r, UI.well, stick.active ? 0.75 : 0.4);
  ring(f, cx, cy, r, UI.sheetEdgeLit, stick.active ? 0.9 : 0.4);

  const throwR = r * THROW_PER_R;
  let dx = 0;
  let dy = 0;
  if (stick.active) {
    dx = stick.x - stick.baseX;
    dy = stick.y - stick.baseY;
    const m = Math.hypot(dx, dy);
    if (m > throwR) {
      dx = (dx / m) * throwR;
      dy = (dy / m) * throwR;
    }
  }
  const capR = Math.round(r * 0.52);
  disc(f, cx + dx, cy + dy, capR, UI.raised, stick.active ? 1 : 0.55);
  ring(f, cx + dx, cy + dy, capR, UI.arcane, stick.active ? 1 : 0.5);
}

/**
 * A face button or a shoulder pill.
 *
 * The glyphs are drawn rather than typed because the PlayStation shapes are not
 * in the pixel font — and drawing them keeps them crisp at every `u`, where a
 * scaled glyph from an 8px atlas would not be (see the note on missing atlas
 * sizes in `sprite.ts`: text at a size the atlas lacks draws NOTHING, silently).
 */
function paintButton(f: UiFrame, b: TouchButton, down: boolean): void {
  const alpha = down ? 1 : 0.55;
  const face = down ? UI.arcane : UI.well;
  const edge = down ? UI.focus : UI.sheetEdgeLit;

  if (b.shape === "disc") {
    disc(f, b.x, b.y, b.rx, face, down ? 0.95 : 0.45);
    ring(f, b.x, b.y, b.rx, edge, alpha);
    glyph(f, b, down);
    return;
  }
  pill(f, b.x, b.y, b.rx, b.ry, face, down ? 0.95 : 0.4);
  pillRing(f, b.x, b.y, b.rx, b.ry, edge, alpha);
  // 8 is the only size the pixel-font atlas carries for a label this small; a
  // request for any other size draws an empty string with no error.
  text(f, b.label, b.x, b.y - 4, { size: 8, colour: down ? UI.sheet : UI.text, align: "center" });
}

/** The four PlayStation shapes, stroked at a weight that survives the snap. */
function glyph(f: UiFrame, b: TouchButton, down: boolean): void {
  const g = f.g;
  const s = b.rx * 0.5;
  g.save();
  g.strokeStyle = down ? UI.sheet : UI.text;
  g.lineWidth = Math.max(2, Math.round(b.rx / 9));
  g.lineJoin = "round";
  g.beginPath();
  switch (b.glyph) {
    case "triangle":
      g.moveTo(b.x, b.y - s);
      g.lineTo(b.x + s * 0.92, b.y + s * 0.7);
      g.lineTo(b.x - s * 0.92, b.y + s * 0.7);
      g.closePath();
      break;
    case "circle":
      g.arc(b.x, b.y, s * 0.88, 0, Math.PI * 2);
      break;
    case "cross":
      g.moveTo(b.x - s * 0.8, b.y - s * 0.8);
      g.lineTo(b.x + s * 0.8, b.y + s * 0.8);
      g.moveTo(b.x + s * 0.8, b.y - s * 0.8);
      g.lineTo(b.x - s * 0.8, b.y + s * 0.8);
      break;
    default: {
      const q = s * 0.78;
      g.rect(b.x - q, b.y - q, q * 2, q * 2);
      break;
    }
  }
  g.stroke();
  g.restore();
}

function disc(f: UiFrame, cx: number, cy: number, r: number, css: string, alpha: number): void {
  f.g.save();
  f.g.globalAlpha = alpha;
  f.g.fillStyle = css;
  f.g.beginPath();
  f.g.arc(Math.round(cx), Math.round(cy), r, 0, Math.PI * 2);
  f.g.fill();
  f.g.restore();
}

function ring(f: UiFrame, cx: number, cy: number, r: number, css: string, alpha: number): void {
  f.g.save();
  f.g.globalAlpha = alpha;
  f.g.strokeStyle = css;
  f.g.lineWidth = 2;
  f.g.beginPath();
  f.g.arc(Math.round(cx), Math.round(cy), r, 0, Math.PI * 2);
  f.g.stroke();
  f.g.restore();
}

/** A rounded pill, built from two arcs and a box — no roundRect, for reach. */
function pillPath(f: UiFrame, cx: number, cy: number, rx: number, ry: number): void {
  const g = f.g;
  const x = Math.round(cx - rx);
  const y = Math.round(cy - ry);
  const w = Math.round(rx * 2);
  const h = Math.round(ry * 2);
  const r = Math.min(h / 2, w / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  g.lineTo(x + r, y + h);
  g.arc(x + r, y + r, r, Math.PI / 2, -Math.PI / 2);
  g.closePath();
}

function pill(f: UiFrame, cx: number, cy: number, rx: number, ry: number, css: string, alpha: number): void {
  f.g.save();
  f.g.globalAlpha = alpha;
  f.g.fillStyle = css;
  pillPath(f, cx, cy, rx, ry);
  f.g.fill();
  f.g.restore();
}

function pillRing(f: UiFrame, cx: number, cy: number, rx: number, ry: number, css: string, alpha: number): void {
  f.g.save();
  f.g.globalAlpha = alpha;
  f.g.strokeStyle = css;
  f.g.lineWidth = 2;
  pillPath(f, cx, cy, rx, ry);
  f.g.stroke();
  f.g.restore();
}

/**
 * True when this looks like a touch device.
 *
 * `maxTouchPoints > 0` alone is a false positive on every touchscreen laptop —
 * a mouse user must never get thumb buttons over their game — so a FINE pointer
 * (a mouse or trackpad) vetoes it. A tablet with a stylus still reports a
 * coarse primary pointer, so it is not excluded.
 */
export function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  const touch = "ontouchstart" in window || (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0);
  if (!touch) return false;
  if (typeof window.matchMedia !== "function") return true;
  if (window.matchMedia("(pointer: coarse)").matches) return true;
  return !window.matchMedia("(pointer: fine)").matches;
}

/**
 * Wire the pointer listeners to `pad`.
 *
 * `sizingOf` is injected rather than imported so this stays independent of
 * which pass is running (the dungeon and the walkable tavern each own one).
 */
export function installTouchControls(pad: VirtualPad, sizingOf: () => UiSizing | null): TouchControls | null {
  if (typeof window === "undefined") return null;
  // The screen is raised HERE rather than by the caller. Painting and input are
  // one feature — a caller that installed the listeners and forgot the screen
  // would give the player invisible buttons, which is worse than none.
  if (!isOpen("touch")) push(touchScreen());
  // A fresh install starts shown. This is module state, so without the reset a
  // dispose() while hidden (the intro takes over, the player quits) left the
  // next run's pad invisible AND inert, with nothing on screen to say why.
  visible = true;
  pressed.clear();
  stick.active = false;
  stick.pointer = -1;

  /**
   * Window point → UI pixels.
   *
   * CLAMPED rather than rejected when the point falls outside the canvas: a
   * thumb that slides into a letterbox bar mid-drag used to return null, and
   * the stick froze at whatever it last read — which reads as the controls
   * sticking, not as a coordinate check. `onDown` still requires a real hit
   * (see `inside` there), because a press in the bars should not arm anything.
   */
  const toUi = (e: PointerEvent): { x: number; y: number; inside: boolean } | null => {
    const s = sizingOf();
    if (!s) return null;
    const p = screenToUi(e.clientX, e.clientY, s, window.innerWidth, window.innerHeight);
    return {
      x: Math.max(0, Math.min(s.renderW, p.x)),
      y: Math.max(0, Math.min(s.renderH, p.y)),
      inside: p.inside,
    };
  };

  const hold = (action: TouchAction, v: boolean): void => {
    switch (action) {
      case "attack":
        pad.attack = v;
        if (v) pad.attackTap = true;
        return;
      case "dodge":
        pad.dodge = v;
        if (v) pad.dodgeTap = true;
        return;
      // The flipper needs its HELD state as well as its edge — a held flipper
      // stays up and cradles (flippers.ts) — which is exactly why gamepad.ts
      // keeps circle out of its tap table too.
      case "flip":
        pad.flip = v;
        if (v) pad.flipTap = true;
        return;
      case "sprint":
        pad.sprint = v;
        return;
      default:
        // Discrete actions bridge through the game's existing keydown switch,
        // exactly as the gamepad does — ONE definition of what Q/R/M/I mean.
        if (v) pressKey(DISCRETE[action]);
    }
  };

  const onDown = (e: PointerEvent): void => {
    if (!visible) return;
    const p = toUi(e);
    if (!p || !p.inside) return;
    const s = sizingOf()!;
    for (const b of padLayout(s.renderW, s.renderH)) {
      if (padHit(b, p.x, p.y)) {
        pressed.set(b.id, e.pointerId);
        hold(b.action, true);
        e.preventDefault();
        return;
      }
    }
    // Left half and not on a button: raise the floating stick here.
    if (p.x < s.renderW / 2 && !stick.active) {
      stick.active = true;
      stick.pointer = e.pointerId;
      stick.baseX = stick.x = p.x;
      stick.baseY = stick.y = p.y;
      e.preventDefault();
    }
  };

  const onMove = (e: PointerEvent): void => {
    if (e.pointerId !== stick.pointer || !stick.active) return;
    const p = toUi(e);
    if (!p) return;
    const s = sizingOf()!;
    stick.x = p.x;
    stick.y = p.y;
    const throwR = stickHome(s.renderW, s.renderH).r * THROW_PER_R;
    const dx = (stick.x - stick.baseX) / throwR;
    const dy = (stick.y - stick.baseY) / throwR;
    const m = Math.hypot(dx, dy);
    const k = m > 1 ? 1 / m : 1;
    pad.moveX = dx * k;
    pad.moveZ = dy * k;
  };

  const onUp = (e: PointerEvent): void => {
    // The layout is re-derived to turn an id back into its action. It can fail
    // — a pointerup can arrive after the pass is gone (a resize, a floor load,
    // the run ending) — and a release that cannot be resolved must still
    // RELEASE. A stuck `attack` is a knight who never stops swinging, and no
    // second event is coming to clear it.
    const s = sizingOf();
    const byId = s ? new Map(padLayout(s.renderW, s.renderH).map((b) => [b.id, b] as const)) : null;
    let unresolved = false;
    for (const [id, ptr] of pressed) {
      if (ptr !== e.pointerId) continue;
      pressed.delete(id);
      const b = byId?.get(id);
      if (b) hold(b.action, false);
      else unresolved = true;
    }
    if (unresolved) pad.attack = pad.dodge = pad.flip = pad.sprint = false;
    if (e.pointerId === stick.pointer) {
      stick.active = false;
      stick.pointer = -1;
      pad.moveX = 0;
      pad.moveZ = 0;
    }
  };

  window.addEventListener("pointerdown", onDown, { passive: false });
  window.addEventListener("pointermove", onMove, { passive: false });
  window.addEventListener("pointerup", onUp);
  // `pointercancel` is not an edge case on touch — it is what the browser
  // sends when it decides the gesture was a scroll. `touch-action: none` in
  // index.html is what stops that happening; this is the release path for when
  // it happens anyway (an incoming call, a system gesture from the edge).
  window.addEventListener("pointercancel", onUp);

  return {
    setVisible(v) {
      visible = v;
      if (!v) {
        // Releasing on hide matters: a thumb held when the intro takes over
        // would otherwise leave the knight sprinting into a cutscene.
        pressed.clear();
        stick.active = false;
        stick.pointer = -1;
        pad.attack = pad.dodge = pad.sprint = pad.flip = false;
        pad.moveX = pad.moveZ = 0;
      }
    },
    dispose() {
      remove("touch");
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      pressed.clear();
      stick.active = false;
      stick.pointer = -1;
      pad.attack = pad.dodge = pad.sprint = pad.flip = false;
      pad.moveX = pad.moveZ = 0;
    },
  };
}

/**
 * The key each discrete action synthesises.
 *
 * Copied from `gamepad.ts`'s TAP_BINDINGS on purpose rather than imported: that
 * table is indexed by a Gamepad button number, which the touch pad has no
 * concept of. `touch-layout.test.ts` asserts the two agree, so the duplication
 * cannot drift silently.
 */
const DISCRETE: Record<TouchAction, string> = {
  attack: "",
  dodge: "",
  flip: "",
  sprint: "",
  rampage: "r",
  skillQ: "q",
  skillE: "e",
  map: "m",
  menu: "i",
};
