/**
 * Tavern-owned overlays.
 *
 * Only the run summary lives here — every commerce panel is the existing,
 * already-tuned vendor UI in `scenes/dungeon/tavern.ts`, opened per-station.
 * The rule is that this scene owns the ROOM and that module owns the ECONOMY.
 */
import { GEAR, GEAR_SLOTS } from "../dungeon/items";
import { state as dungeonState } from "../dungeon/state";
import { getBalance } from "../../utils/gold-wallet";
import type { TavernStats } from "./state";

const GOLD = "#f0c040";
const COLD = "#6fd0e8";

let el: HTMLElement | null = null;
let onClosed: (() => void) | null = null;

export function isRunSummaryOpen(): boolean {
  return el !== null;
}

/** Grades worth celebrating — S and A get the gold treatment, the rest don't. */
function gradeColor(grade: string): string {
  return grade === "S" || grade === "A" ? GOLD : "#c9c1ad";
}

/**
 * The central table's run summary — what you just did, read off the diorama.
 *
 * Deliberately read-only and quick to dismiss: it's a beat of reward pacing on
 * the way to the descend gate, not another menu to manage.
 */
export function showRunSummary(host: HTMLElement, stats: TavernStats, onClose: () => void): void {
  if (el) return;
  onClosed = onClose;

  const gearTxt = GEAR_SLOTS.map((s) => `${GEAR[s].icon} ${dungeonState.gear[s] ?? 0}`).join("&nbsp;&nbsp;");
  const row = (label: string, value: string, color = "#e8e2d4"): string =>
    `<div style="display:flex;justify-content:space-between;gap:24px;padding:7px 0;border-bottom:1px solid #241f2e">
       <span style="color:#9a8f77">${label}</span><b style="color:${color}">${value}</b>
     </div>`;

  el = document.createElement("div");
  el.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:10007",
    "background:rgba(8,6,10,0.72)",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "font:400 13px ui-monospace,Menlo,monospace",
    "color:#e8e2d4",
    "user-select:none",
  ].join(";");
  el.innerHTML = `
    <div style="width:min(420px,92vw);background:#0f1218;border:2px solid ${COLD};box-shadow:0 0 40px rgba(111,208,232,.18);padding:18px 22px">
      <div style="font-family:'Press Start 2P',monospace;font-size:12px;color:${COLD};letter-spacing:1px;margin-bottom:14px">RUN SUMMARY</div>
      ${row("Floor cleared", String(stats.floor), GOLD)}
      ${row("Grade", stats.grade, gradeColor(stats.grade))}
      ${row("Kills", String(stats.kills))}
      ${row("Best combo", `×${stats.bestCombo}`)}
      ${row("Gear", gearTxt)}
      ${row("Purse", `${getBalance()}g`, GOLD)}
      <button data-close style="margin-top:16px;width:100%;padding:10px;background:#1a1f2b;border:2px solid #544e63;color:#e8e2d4;font-family:'Press Start 2P',monospace;font-size:9px;letter-spacing:1px;cursor:pointer">CLOSE  [ESC]</button>
    </div>`;

  el.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    // Click the backdrop or the button — both dismiss, neither is a trap.
    if (t === el || t.hasAttribute("data-close")) closeRunSummary();
  });
  host.appendChild(el);
}

export function closeRunSummary(): void {
  if (!el) return;
  el.remove();
  el = null;
  const done = onClosed;
  onClosed = null;
  done?.();
}
