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
 * ── ONE LAYOUT, TWO READERS ──
 * The painter and the hit test MUST agree, and they are the classic place for a
 * one-pixel drift that presents as "the button does nothing near its edge". So
 * there is exactly one `layout()` and both call it. Same rule as `canvasOrigin`
 * in coords.ts, for the same reason.
 *
 * ── WHY ITS OWN LISTENERS ──
 * `gui/input.ts` only captures while a PAUSING screen is open. These controls
 * have to work during play, when nothing is paused, and they write to the
 * `VirtualPad` rather than to `UiInput` — they are an input device, not a
 * widget. So they own a small set of pointer listeners, tracked per
 * `pointerId` so two thumbs work at once.
 */
import { pressKey, type VirtualPad } from "../engine/virtual-pad";
import type { UiSizing } from "./coords";
import { screenToUi } from "./coords";
import { UI } from "./theme";
import { text, type UiFrame } from "./im";
import { isOpen, push, close, type UiScreen } from "./stack";

/** How far the thumb travels for full deflection, in UI pixels. */
const STICK_THROW = 52;
const STICK_R = 46;
/** Clearance above the painted HUD panel. */
const HUD_H = 92;
const GAP = 12;

export interface TouchControls {
  setVisible(v: boolean): void;
  dispose(): void;
}

interface TouchButton {
  id: string;
  label: string;
  /** Hit radius, in UI pixels. */
  r: number;
}

/** THE ONE LAYOUT. Painter and hit test both read this. */
function layout(w: number, h: number): Array<TouchButton & { x: number; y: number }> {
  const bottom = h - HUD_H - GAP;
  return [
    { id: "attack", label: "ATK", r: 44, x: w - 78, y: bottom - 58 },
    { id: "dodge", label: "PULL", r: 34, x: w - 158, y: bottom - 34 },
    { id: "q", label: "Q", r: 28, x: w - 44, y: bottom - 150 },
    { id: "e", label: "E", r: 28, x: w - 112, y: bottom - 172 },
    { id: "sprint", label: "RUN", r: 28, x: w - 190, y: bottom - 120 },
    { id: "map", label: "M", r: 22, x: w - 40, y: 40 },
    { id: "menu", label: "I", r: 22, x: w - 92, y: 40 },
  ];
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
      // The floating stick appears where the thumb landed, which is why it is
      // drawn from live state rather than from `layout()`.
      if (stick.active) {
        ring(f, stick.baseX, stick.baseY, STICK_R, UI.arcane, 0.35);
        const dx = stick.x - stick.baseX;
        const dy = stick.y - stick.baseY;
        const m = Math.hypot(dx, dy);
        const k = m > STICK_THROW ? STICK_THROW / m : 1;
        disc(f, stick.baseX + dx * k, stick.baseY + dy * k, STICK_R / 2, UI.arcane);
      }
      for (const b of layout(f.w, f.h)) {
        const down = pressed.has(b.id);
        disc(f, b.x, b.y, b.r, down ? UI.arcane : UI.well);
        ring(f, b.x, b.y, b.r, UI.arcane, down ? 1 : 0.55);
        text(f, b.label, b.x, b.y - 4, { size: 8, colour: down ? UI.sheet : UI.text, align: "center" });
      }
    },
  };
}

function disc(f: UiFrame, cx: number, cy: number, r: number, css: string): void {
  f.g.fillStyle = css;
  f.g.beginPath();
  f.g.arc(Math.round(cx), Math.round(cy), r, 0, Math.PI * 2);
  f.g.fill();
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

/** True when this looks like a touch device. */
export function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  return "ontouchstart" in window || (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0);
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

  const toUi = (e: PointerEvent): { x: number; y: number } | null => {
    const s = sizingOf();
    if (!s) return null;
    const p = screenToUi(e.clientX, e.clientY, s, window.innerWidth, window.innerHeight);
    return p.inside ? { x: p.x, y: p.y } : null;
  };

  const hold = (id: string, v: boolean): void => {
    if (id === "attack") {
      pad.attack = v;
      if (v) pad.attackTap = true;
    } else if (id === "dodge") {
      pad.dodge = v;
      if (v) pad.dodgeTap = true;
    } else if (id === "sprint") {
      pad.sprint = v;
    } else if (v) {
      // Discrete actions bridge through the game's existing keydown switch,
      // exactly as the gamepad does — ONE definition of what Q/M/I mean.
      pressKey(id);
    }
  };

  const onDown = (e: PointerEvent): void => {
    if (!visible) return;
    const p = toUi(e);
    if (!p) return;
    const s = sizingOf()!;
    for (const b of layout(s.renderW, s.renderH)) {
      if (Math.hypot(p.x - b.x, p.y - b.y) <= b.r) {
        pressed.set(b.id, e.pointerId);
        hold(b.id, true);
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
    stick.x = p.x;
    stick.y = p.y;
    const dx = (stick.x - stick.baseX) / STICK_THROW;
    const dy = (stick.y - stick.baseY) / STICK_THROW;
    const m = Math.hypot(dx, dy);
    const k = m > 1 ? 1 / m : 1;
    pad.moveX = dx * k;
    pad.moveZ = dy * k;
  };

  const onUp = (e: PointerEvent): void => {
    for (const [id, ptr] of pressed) {
      if (ptr === e.pointerId) {
        pressed.delete(id);
        hold(id, false);
      }
    }
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
  window.addEventListener("pointercancel", onUp);

  return {
    setVisible(v) {
      visible = v;
      if (!v) {
        // Releasing on hide matters: a thumb held when the intro takes over
        // would otherwise leave the knight sprinting into a cutscene.
        pressed.clear();
        stick.active = false;
        pad.attack = pad.dodge = pad.sprint = false;
        pad.moveX = pad.moveZ = 0;
      }
    },
    dispose() {
      close("touch");
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      pressed.clear();
      stick.active = false;
    },
  };
}
