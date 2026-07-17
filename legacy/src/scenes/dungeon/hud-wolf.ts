/**
 * 🔫 THE WOLFENSTEIN HUD — the rampage "combat layer" bar.
 *
 * This is the dark-steel riveted status bar that already lived in ui.ts
 * (createHUD/updateHUD). Under the dual-HUD design it is no longer the default:
 * the Diablo panel owns the isometric view, and this bar slides up ONLY during a
 * rampage. We keep the proven bar-rendering internals in ui.ts and wrap them
 * here to add (a) a slide-in/out show toggle and (b) a face slot for the shared
 * knight portrait, so the same face bridges both HUDs.
 *
 * The face slot is a sibling of the per-frame-rebuilt #dungeon-hud-body, so
 * updateHUD's innerHTML never clobbers the mounted portrait.
 */
import { createHUD, updateHUD } from "./ui";

let wolfEl: HTMLDivElement | null = null;
let faceSlot: HTMLDivElement | null = null;

/** Build the Wolf bar (hidden/slid-down by default — it's rampage-only). */
export function createWolfHUD(container: HTMLElement): HTMLDivElement {
  const el = createHUD(container);
  el.style.transition = "transform 0.2s ease-in";
  el.style.transform = "translateY(110%)"; // parked off-screen until a rampage

  // A centred portrait socket that pokes up above the bar (Doom status-face
  // placement). Absolutely positioned on the bar itself, so it survives every
  // updateHUD innerHTML rebuild of the body.
  const slot = document.createElement("div");
  slot.id = "dungeon-wolf-face-slot";
  // Anchored to the bar's TOP edge (bottom:100%) so it always pokes cleanly
  // above the bar, independent of however tall updateHUD makes the bar.
  slot.style.cssText = `
    position:absolute; left:50%; bottom:calc(100% - 6px); transform:translateX(-50%);
    width:54px; height:54px; border-radius:5px; overflow:hidden;
    border:3px solid #8a94a6; background:#0b0c10;
    box-shadow:0 0 0 2px #171a22, 0 2px 8px rgba(0,0,0,0.7);
    pointer-events:none;`;
  el.appendChild(slot);

  wolfEl = el;
  faceSlot = slot;
  return el;
}

/** The socket the swap controller drops the shared face canvas into. */
export function getWolfFaceSlot(): HTMLDivElement | null {
  return faceSlot;
}

export function getWolfEl(): HTMLDivElement | null {
  return wolfEl;
}

/** Slide the bar up (on) for a rampage, or down (off) back to the iso view. */
export function showWolfHUD(on: boolean): void {
  if (wolfEl) wolfEl.style.transform = on ? "translateY(0)" : "translateY(110%)";
}

/** Repaint the bar's live numbers (delegates to the ui.ts renderer). */
export function updateWolfHUD(): void {
  if (wolfEl) updateHUD(wolfEl);
}

export function disposeWolfHUD(): void {
  wolfEl?.remove();
  wolfEl = null;
  faceSlot = null;
}
