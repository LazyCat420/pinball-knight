/**
 * TOUCH CONTROLS — the on-screen pad for phones and tablets.
 *
 * Layout follows the convention every mobile ARPG converged on, for the reason
 * they converged on it: thumbs rest at the bottom corners and cannot see what
 * they are covering.
 *
 *   LEFT  a FLOATING stick — it appears wherever your thumb lands in the left
 *         half, so there is no small fixed target to miss while dodging. Analog,
 *         so a short push walks.
 *   RIGHT the action cluster: a big ATTACK, and PULL (dodge — and HOLD is the
 *         plunger, exactly like Space), with the two skills above them.
 *   TOP   a slim strip for the things you press between fights: belt slots, map,
 *         menu, weapon swap.
 *
 * Everything writes into the same `VirtualPad` a gamepad does, so nothing
 * downstream knows or cares which one is driving.
 *
 * Two details that matter more than they look:
 *  · `touch-action: none` + `preventDefault` on the controls, or Safari steals
 *    the drags for scroll/zoom and the stick dies mid-swipe.
 *  · every button tracks its OWN pointer id. Without that, a second thumb
 *    landing on ATTACK while the first holds PULL cancels the pull — which is
 *    precisely the plunger, the one control that must survive a second touch.
 */
import { pressKey, type VirtualPad } from "./virtual-pad";

/** Radius of the floating stick, in CSS px. */
const STICK_R = 62;
/** How far the thumb must travel for full deflection. */
const STICK_THROW = 52;
/** Gap between the action cluster and the top of the HUD bar. */
const HUD_GAP = 12;

/**
 * How tall the Diablo HUD currently is.
 *
 * The action buttons MUST sit above it. The HUD is `position:fixed; bottom:0`
 * and the touch overlay renders on a higher layer, so buttons anchored to
 * `bottom: 0` would simply cover the life orb, the mana orb and the whole belt
 * — the exact readouts a player needs mid-fight. Measured rather than
 * hard-coded because the bar's height changes with its content.
 */
function hudHeight(): number {
  if (typeof document === "undefined") return 0;
  const hud = document.getElementById("dungeon-hud-diablo");
  return hud ? hud.getBoundingClientRect().height : 0;
}

/** True when this looks like a touch device. */
export function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  return "ontouchstart" in window || (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0);
}

const BTN_CSS = `
  position:absolute; display:flex; align-items:center; justify-content:center;
  border-radius:50%; border:2px solid rgba(111,208,232,0.55);
  background:radial-gradient(circle at 35% 30%, rgba(47,111,143,0.85), rgba(10,14,20,0.82));
  color:#d7f0ff; font-family:ui-monospace,Menlo,monospace; font-weight:700;
  text-shadow:0 1px 0 rgba(0,0,0,0.8); user-select:none; -webkit-user-select:none;
  touch-action:none; pointer-events:auto;`;

interface PadButton {
  el: HTMLElement;
  /** The pointer currently holding it, or -1. Per-button so two thumbs work. */
  pointer: number;
}

export interface TouchControls {
  /** The root overlay, so a caller can hide it (e.g. during the intro). */
  root: HTMLElement;
  setVisible(v: boolean): void;
  dispose(): void;
}

/**
 * Build the overlay and wire it to `pad`. Returns null when there is no
 * document (headless) — the caller treats that as "no touch controls".
 */
export function createTouchControls(container: HTMLElement, pad: VirtualPad): TouchControls | null {
  if (typeof document === "undefined") return null;

  const root = document.createElement("div");
  root.id = "dungeon-touch";
  // Below the HUD's own z-index band, above the canvas. `pointer-events:none`
  // on the root so the bare regions between controls still reach the game
  // (tap-to-attack on the world keeps working).
  root.style.cssText = `
    position:absolute; inset:0; z-index:10040; pointer-events:none;
    touch-action:none; -webkit-tap-highlight-color:transparent;`;
  // Everything in the action cluster is positioned off --pad-bottom, which
  // tracks the live HUD height (see hudHeight) so the thumb buttons never sit
  // on top of the orbs.
  const layout = (): void => root.style.setProperty("--pad-bottom", `${hudHeight() + HUD_GAP}px`);
  layout();
  window.addEventListener("resize", layout);
  window.addEventListener("orientationchange", layout);

  // ── Floating move stick (left half) ──
  const stickBase = document.createElement("div");
  stickBase.style.cssText = `
    position:absolute; width:${STICK_R * 2}px; height:${STICK_R * 2}px; border-radius:50%;
    border:2px solid rgba(111,208,232,0.35); background:rgba(10,14,20,0.35);
    display:none; pointer-events:none;`;
  const stickNub = document.createElement("div");
  stickNub.style.cssText = `
    position:absolute; width:${STICK_R}px; height:${STICK_R}px; border-radius:50%;
    background:radial-gradient(circle at 35% 30%, rgba(111,208,232,0.9), rgba(47,111,143,0.7));
    border:2px solid rgba(215,240,255,0.5); display:none; pointer-events:none;`;
  root.append(stickBase, stickNub);

  let stickPointer = -1;
  let stickCx = 0;
  let stickCy = 0;

  const showStick = (x: number, y: number): void => {
    stickBase.style.left = `${x - STICK_R}px`;
    stickBase.style.top = `${y - STICK_R}px`;
    stickBase.style.display = "block";
    stickNub.style.display = "block";
    moveStick(x, y);
  };
  function moveStick(x: number, y: number): void {
    const dx = x - stickCx;
    const dy = y - stickCy;
    const m = Math.hypot(dx, dy);
    const clamped = Math.min(m, STICK_THROW);
    const ux = m > 0 ? dx / m : 0;
    const uy = m > 0 ? dy / m : 0;
    stickNub.style.left = `${stickCx + ux * clamped - STICK_R / 2}px`;
    stickNub.style.top = `${stickCy + uy * clamped - STICK_R / 2}px`;
    const mag = clamped / STICK_THROW;
    pad.moveX = ux * mag;
    pad.moveZ = uy * mag;
  }
  const hideStick = (): void => {
    stickPointer = -1;
    stickBase.style.display = "none";
    stickNub.style.display = "none";
    pad.moveX = 0;
    pad.moveZ = 0;
  };

  // The stick catcher covers the left half BELOW the top strip, so a thumb can
  // land anywhere down there and get a stick under it.
  const stickZone = document.createElement("div");
  stickZone.style.cssText = `position:absolute; left:0; top:15%; width:45%; bottom:var(--pad-bottom); pointer-events:auto; touch-action:none;`;
  root.appendChild(stickZone);

  const onZoneDown = (e: PointerEvent): void => {
    if (stickPointer !== -1) return;
    e.preventDefault();
    stickPointer = e.pointerId;
    stickCx = e.clientX;
    stickCy = e.clientY;
    showStick(e.clientX, e.clientY);
  };
  const onZoneMove = (e: PointerEvent): void => {
    if (e.pointerId !== stickPointer) return;
    e.preventDefault();
    moveStick(e.clientX, e.clientY);
  };
  const onZoneUp = (e: PointerEvent): void => {
    if (e.pointerId !== stickPointer) return;
    hideStick();
  };
  stickZone.addEventListener("pointerdown", onZoneDown);
  window.addEventListener("pointermove", onZoneMove, { passive: false });
  window.addEventListener("pointerup", onZoneUp);
  window.addEventListener("pointercancel", onZoneUp);

  // ── Action buttons ──
  const buttons: PadButton[] = [];
  const cleanups: Array<() => void> = [];

  /**
   * `hold` receives the held state (attack/dodge want it); `tap` fires once on
   * press (skills, belt). A button may do both — ATTACK taps AND holds, because
   * a tap is a light swing and a hold is a charge.
   */
  function addButton(
    label: string,
    css: string,
    opts: { hold?: (v: boolean) => void; tap?: () => void; font?: number },
  ): void {
    const el = document.createElement("div");
    el.textContent = label;
    el.style.cssText = `${BTN_CSS} font-size:${opts.font ?? 15}px; ${css}`;
    const b: PadButton = { el, pointer: -1 };
    buttons.push(b);
    const down = (e: PointerEvent): void => {
      if (b.pointer !== -1) return;
      e.preventDefault();
      e.stopPropagation();
      b.pointer = e.pointerId;
      el.style.filter = "brightness(1.6)";
      opts.tap?.();
      opts.hold?.(true);
    };
    const up = (e: PointerEvent): void => {
      if (e.pointerId !== b.pointer) return;
      b.pointer = -1;
      el.style.filter = "";
      opts.hold?.(false);
    };
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    cleanups.push(() => {
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    });
    root.appendChild(el);
  }

  // Right cluster. ATTACK is the biggest and lowest — the thumb's home position.
  addButton("⚔", "right:26px; bottom:var(--pad-bottom); width:92px; height:92px;", {
    font: 30,
    hold: (v) => {
      pad.attack = v;
      if (v) pad.attackTap = true;
    },
  });
  // PULL is the plunger AND the roll: hold to draw back, release to launch.
  addButton("PULL", "right:126px; bottom:calc(var(--pad-bottom) + 30px); width:74px; height:74px;", {
    font: 13,
    hold: (v) => {
      pad.dodge = v;
      if (v) pad.dodgeTap = true;
    },
  });
  addButton("Q", "right:36px; bottom:calc(var(--pad-bottom) + 108px); width:60px; height:60px;", { font: 20, tap: () => pressKey("q") });
  addButton("E", "right:110px; bottom:calc(var(--pad-bottom) + 124px); width:60px; height:60px;", { font: 20, tap: () => pressKey("e") });
  // Sprint sits under the left thumb's reach, opposite the stick hand.
  addButton("⏩", "left:22px; bottom:var(--pad-bottom); width:62px; height:62px;", {
    font: 20,
    hold: (v) => {
      pad.sprint = v;
    },
  });

  // ── Top strip: the between-fights buttons ──
  const strip = document.createElement("div");
  strip.style.cssText = `position:absolute; left:50%; top:8px; transform:translateX(-50%);
    display:flex; gap:6px; pointer-events:none;`;
  root.appendChild(strip);
  const stripBtn = (label: string, key: string): void => {
    const el = document.createElement("div");
    el.textContent = label;
    el.style.cssText = `${BTN_CSS} position:relative; width:38px; height:34px; border-radius:8px; font-size:13px;`;
    const down = (e: PointerEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      el.style.filter = "brightness(1.6)";
      pressKey(key);
      setTimeout(() => (el.style.filter = ""), 120);
    };
    el.addEventListener("pointerdown", down);
    cleanups.push(() => el.removeEventListener("pointerdown", down));
    strip.appendChild(el);
  };
  stripBtn("1", "1");
  stripBtn("2", "2");
  stripBtn("3", "3");
  stripBtn("4", "4");
  stripBtn("⇄", "Tab");
  stripBtn("🗺", "m");
  stripBtn("☰", "i");

  container.appendChild(root);

  return {
    root,
    setVisible(v: boolean) {
      root.style.display = v ? "" : "none";
      if (!v) {
        hideStick();
        pad.attack = false;
        pad.dodge = false;
        pad.sprint = false;
      }
    },
    dispose() {
      window.removeEventListener("resize", layout);
      window.removeEventListener("orientationchange", layout);
      stickZone.removeEventListener("pointerdown", onZoneDown);
      window.removeEventListener("pointermove", onZoneMove);
      window.removeEventListener("pointerup", onZoneUp);
      window.removeEventListener("pointercancel", onZoneUp);
      for (const c of cleanups) c();
      root.remove();
    },
  };
}
