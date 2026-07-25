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

// ── Pool arrival/departure banner ────────────────────────────────────────────
// The tavern had no transient-message surface at all; the dungeon's `showToast`
// is a full-screen centred overlay bound to the DUNGEON's container, so it
// cannot be reused here (and would be too loud for a lobby anyway — you are
// reading vendor panels, not fighting).
//
// This is the quiet equivalent: a top-centre banner that slides in, holds, and
// leaves. Single-slot like the dungeon's toast, for the same reason — several
// knights joining at once must not stack overlapping banners.
let banner: HTMLDivElement | null = null;
let bannerHide = 0;
let bannerRemove = 0;

/** Announce something transient in the tavern (pool arrivals/departures). */
export function showTavernBanner(host: HTMLElement, text: string, sub = ""): void {
  if (banner) {
    window.clearTimeout(bannerHide);
    window.clearTimeout(bannerRemove);
    banner.remove();
    banner = null;
  }
  const b = document.createElement("div");
  b.style.cssText = `
    position:absolute; top:0; left:50%; transform:translate(-50%,-14px); z-index:10006;
    pointer-events:none; user-select:none; text-align:center;
    padding:9px 20px 10px; border:1px solid rgba(240,192,64,0.35); border-top:none;
    background:linear-gradient(180deg, rgba(11,13,18,0.94), rgba(11,13,18,0.72));
    font:600 13px/1.35 ui-monospace,monospace; letter-spacing:2px; font-variant:small-caps;
    color:${GOLD}; text-shadow:0 0 12px rgba(240,192,64,0.35), 1px 1px 0 #0b0d12;
    opacity:0; transition:opacity .22s ease, transform .22s ease;
  `;
  b.innerHTML = `<div>${text}</div>` + (sub ? `<div style="font-size:11px;letter-spacing:1px;color:#9aa4b4;font-variant:normal;margin-top:3px">${sub}</div>` : "");
  host.appendChild(b);
  banner = b;
  requestAnimationFrame(() => {
    b.style.opacity = "1";
    b.style.transform = "translate(-50%,0)";
  });
  bannerHide = window.setTimeout(() => {
    b.style.opacity = "0";
    b.style.transform = "translate(-50%,-14px)";
    bannerRemove = window.setTimeout(() => {
      b.remove();
      if (banner === b) banner = null;
    }, 260);
  }, 2200);
}

/** Drop any live banner — called on scene teardown so it can't outlive the room. */
export function clearTavernBanner(): void {
  window.clearTimeout(bannerHide);
  window.clearTimeout(bannerRemove);
  banner?.remove();
  banner = null;
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

// ── Pool online indicator ─────────────────────────────────────────────────────
/**
 * A small always-on pill in the tavern hub telling you the game is a shared pool
 * and how many knights are in it right now (including you). No lobby, no ready —
 * it's just presence feedback so "am I connected / is anyone else here" is never
 * a mystery. Shows an OFFLINE state when the socket can't reach the backend.
 */
export interface LobbyHud {
  update(info: { connected: boolean; count: number }): void;
  dispose(): void;
}

export function createLobbyHud(host: HTMLElement): LobbyHud {
  const pill = document.createElement("div");
  pill.style.cssText = [
    "position:absolute",
    "top:14px",
    "right:16px",
    "padding:8px 12px",
    "background:rgba(10,12,16,0.78)",
    "border:2px solid #2c2838",
    "border-radius:4px",
    "font-family:'Press Start 2P',monospace",
    "font-size:9px",
    "letter-spacing:1px",
    "color:#e8e2d4",
    "z-index:10006",
    "pointer-events:none",
    "transition:opacity 200ms linear,border-color 200ms linear",
  ].join(";");
  host.appendChild(pill);

  return {
    update({ connected, count }): void {
      if (connected) {
        pill.style.borderColor = "#50c878";
        pill.innerHTML = `<span style="color:#50c878">●</span> POOL · ${count} ONLINE`;
      } else {
        pill.style.borderColor = "#544e63";
        pill.innerHTML = `<span style="color:#8a8172">○</span> OFFLINE`;
      }
    },
    dispose(): void {
      pill.remove();
    },
  };
}
