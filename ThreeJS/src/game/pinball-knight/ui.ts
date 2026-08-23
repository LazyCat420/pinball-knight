/**
 * UI ENTRY POINTS — a DOM-free shim.
 *
 * This file used to be 865 lines of overlays: the HUD, toasts, the game-over
 * screen, the shop, the boss bar, the plunger meter, the FPS overlay and the
 * floating combo numbers, all built as absolutely-positioned elements stacked
 * on the canvas. Every one of them now paints inside the pixel pass.
 *
 * It survives as a shim rather than being deleted because roughly a dozen
 * gameplay modules import `showToast` / `showPickupNote` from here, and those
 * call sites are about GAME EVENTS, not about presentation — `boss.ts` wanting
 * to announce a boss should not have to know which screen shows it. So the
 * names stay and the implementations forward.
 *
 * The functions that are now no-ops are marked as such individually. They are
 * not dead: their CALLERS are load-bearing (`core.ts` is at its decomposition
 * ratchet and cannot absorb the edits to remove them), and each one used to
 * create or mutate an element that the painted HUD now draws from state every
 * frame. There is simply nothing left for them to do.
 */
import { pushBanner, pushFloatingCombo, pushToast, clearFloatingCombos } from "./gui/screens/toasts";

export interface ShopEntry {
  id: string;
  label: string;
  icon: string;
  price: number;
  detail: string;
}

/** A centred announcement — floor titles, boss arrivals, level-ups. */
export function showToast(text: string, subtext = ""): void {
  pushBanner(text, subtext);
}

/** A small corner note — pickups, weapon swaps. */
export function showPickupNote(text: string): void {
  pushToast(text);
}

/** Rising combo number at a screen position. */
export function spawnFloatingCombo(combo: number, sx: number, sy: number): void {
  pushFloatingCombo(combo, sx, sy);
}

export function disposeFloatingCombos(): void {
  clearFloatingCombos();
}

/**
 * ── NO-OPS: everything below is painted by `gui/screens/hud.ts` from state ──
 * Each of these used to build or poke a DOM node. The painted HUD reads the
 * same state directly every frame, so there is no node to build and nothing to
 * push. Kept so their call sites (mostly in `core.ts` and `fps.ts`) compile
 * unchanged.
 */
/* eslint-disable @typescript-eslint/no-unused-vars */
export function ensureWolfFonts(..._a: unknown[]): void {}
export function createHUD(..._a: unknown[]): HTMLDivElement | null {
  return null;
}
export function updateHUD(..._a: unknown[]): void {}
export function createFpsOverlay(..._a: unknown[]): HTMLDivElement | null {
  return null;
}
export function setFpsOverlay(..._a: unknown[]): void {}
export function updateFpsStreak(..._a: unknown[]): void {}
export function flashFpsMuzzle(..._a: unknown[]): void {}
export function createBossBar(..._a: unknown[]): HTMLDivElement | null {
  return null;
}
export function updateBossBar(..._a: unknown[]): void {}
export function createPlungerMeter(..._a: unknown[]): HTMLDivElement | null {
  return null;
}
export function updatePlungerMeter(..._a: unknown[]): void {}
export function showControlsHint(..._a: unknown[]): void {}
