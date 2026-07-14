/**
 * Phase 0 sandbox HUD.
 *
 * This is a DOM overlay, so it deliberately sits OUTSIDE the pixel pipeline and
 * is not quantized or pixelated. It's a debug panel for judging the art, not
 * part of the art. The real in-game HUD (Phase 3) will be drawn into the render
 * target so it gets the same treatment as everything else.
 */
import { state } from "./state";

const CONTROLS = [
  ["1 / 2 / 3", "idle · walk · attack+death"],
  ["W A S D", "face north / west / south / east"],
  ["Q", "palette quantize"],
  ["F", "ordered dither"],
  ["L", "light the sprites"],
  ["K", "scanlines"],
  ["ESC", "back to the mouse room"],
];

export function createHUD(container: HTMLElement): HTMLDivElement {
  const el = document.createElement("div");
  el.id = "dungeon-hud";
  el.style.cssText = `
    position: fixed; left: 12px; top: 12px; z-index: 10001;
    font: 11px/1.6 ui-monospace, "SF Mono", Menlo, monospace;
    color: #9aa4b4; background: rgba(11, 13, 18, 0.82);
    border: 1px solid #2b303b; border-radius: 4px;
    padding: 10px 12px; pointer-events: none;
    letter-spacing: 0.3px;
  `;
  container.appendChild(el);
  return el;
}

export function updateHUD(el: HTMLDivElement): void {
  const on = (v: boolean) => (v ? '<span style="color:#f0a63c">on</span>' : '<span style="color:#454f5e">off</span>');

  const rows = CONTROLS.map(
    ([key, desc]) =>
      `<div><span style="color:#c8ccd4;display:inline-block;min-width:72px">${key}</span>${desc}</div>`,
  ).join("");

  el.innerHTML = `
    <div style="color:#f0a63c;margin-bottom:6px">🗡️ CRYPT — style sandbox (phase 0)</div>
    ${rows}
    <div style="margin-top:8px;border-top:1px solid #2b303b;padding-top:6px">
      quantize ${on(state.quantize)} ·
      dither ${on(state.dither)} ·
      lit ${on(state.spritesLit)} ·
      scanline ${on(state.scanline)}
    </div>
    <div style="margin-top:4px;color:#454f5e">320×180 · 32 colours · 16px sprites</div>
  `;
}
