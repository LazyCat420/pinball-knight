/**
 * THE WALKABLE TAVERN'S OWN OVERLAYS, painted.
 *
 * The dungeon's UI moved inside the pixel pass; these four did not, because
 * they belong to the tavern SCENE rather than to the game module — the station
 * prompt, the arrival banner, the run summary and the lobby pill/board. They
 * were the last interface in the app still built out of elements, and they sat
 * on top of the scene's own pixel pass, which is exactly the thing the whole
 * migration exists to stop: readouts that float above the palette snap.
 *
 * They composite through `scenes/tavern/core.ts`'s pass, which already drives
 * `drawUiFrame`, so raising them is just pushing screens.
 *
 * ── WHY THEY ARE ALL IN ONE FILE ──
 * They are small, they share one theme, and three of the four are single
 * widgets. The dungeon's screens each earned their own file by being hundreds
 * of lines; splitting a 40-line banner into its own module would be filing, not
 * structure.
 */
import { UI, GRID, ROW_H } from "../../game/pinball-knight/gui/theme";
import {
  button,
  cutTop,
  fillRect,
  focusRing,
  focusable,
  rect,
  scrim,
  sheet,
  strokeRect,
  text,
  type Rect,
  type UiFrame,
} from "../../game/pinball-knight/gui/im";
import { close, isOpen, push, remove } from "../../game/pinball-knight/gui/stack";
import { GEAR, GEAR_SLOTS } from "../../game/pinball-knight/items";
import { state as dungeonState } from "../../game/pinball-knight/state";
import { getBalance } from "../../utils/gold-wallet";
import type { TavernStats } from "./state";
import { describeParty, type FloorGroup } from "./join-board";
import type { Station } from "./layout";

// ── STATION PROMPT ────────────────────────────────────────────────────────────

let promptStation: Station | null = null;

export interface StationPrompt {
  show(s: Station): void;
  hide(): void;
  dispose(): void;
}

/**
 * The contextual "[E] ALCHEMIST" line.
 *
 * Non-pausing and non-focusable: it is a label, and making it focusable would
 * put it in the tab order of whatever sheet opens over it.
 *
 * `button` is a GETTER, read every paint rather than captured at show(): a pad
 * can be plugged in while the prompt is already up, and a label that names the
 * wrong button is the exact defect this parameter exists to fix. Defaults to
 * the keyboard so a caller that has no input handle still renders something
 * true.
 */
export function createStationPrompt(button: () => string = () => "[E]"): StationPrompt {
  if (!isOpen("station-prompt")) {
    push({
      id: "station-prompt",
      pauses: false,
      focus: 0,
      scroll: 0,
      paint(f) {
        const s = promptStation;
        if (!s) return;
        const accent = `#${s.accent.toString(16).padStart(6, "0")}`;
        const label = `${button()} ${s.label.toUpperCase()}`;
        const w = Math.max(220, label.length * 9 + GRID * 4);
        const r = rect((f.w - w) / 2, f.h - 132, w, 40);
        fillRect(f, r, UI.sheet);
        strokeRect(f, r, accent, 2);
        text(f, label, r.x + r.w / 2, r.y + 8, { size: 8, colour: accent, align: "center" });
        text(f, s.blurb, r.x + r.w / 2, r.y + 24, { size: 8, colour: UI.textDim, align: "center", max: r.w - GRID });
      },
    });
  }
  return {
    show(s) {
      promptStation = s;
    },
    hide() {
      promptStation = null;
    },
    dispose() {
      promptStation = null;
      remove("station-prompt");
    },
  };
}

// ── ARRIVAL BANNER ────────────────────────────────────────────────────────────

let banner: { text: string; sub: string; until: number } | null = null;

/**
 * Announce something transient (pool arrivals/departures).
 *
 * SINGLE SLOT, as the DOM version was and for the same reason: several knights
 * joining at once must not stack overlapping banners. It is also deliberately
 * quieter than the dungeon's centred toast — you are reading vendor panels
 * here, not fighting.
 */
export function showTavernBanner(text_: string, sub = ""): void {
  banner = { text: text_, sub, until: performance.now() + 2600 };
  raiseSceneHud();
}

export function clearTavernBanner(): void {
  banner = null;
}

// ── LOBBY PILL + JOIN BOARD ───────────────────────────────────────────────────

interface LobbyInfo {
  connected: boolean;
  count: number;
  groups?: FloorGroup[];
  resumeFloor?: number;
  descendFloor?: number;
}

let lobby: LobbyInfo = { connected: false, count: 0 };
let onJoinFloor: ((floor: number) => void) | null = null;

export interface LobbyHud {
  update(info: LobbyInfo): void;
  onJoin(fn: (floor: number) => void): void;
  dispose(): void;
}

export function createLobbyHud(): LobbyHud {
  raiseSceneHud();
  return {
    update(info) {
      lobby = info;
    },
    onJoin(fn) {
      onJoinFloor = fn;
    },
    dispose() {
      onJoinFloor = null;
      lobby = { connected: false, count: 0 };
      remove("scene-hud");
    },
  };
}

/**
 * One screen carries the banner AND the lobby board, because they share the
 * top-right corner and would otherwise have to agree about it across two files.
 *
 * It PAUSES nothing, but the join rows ARE clickable — so it registers
 * focusables. That is the one place in this file where a non-pausing screen
 * takes input, and it works because `focusable()` treats a pointer press as an
 * activation regardless of the focus cursor.
 */
function raiseSceneHud(): void {
  if (isOpen("scene-hud")) return;
  push({
    id: "scene-hud",
    pauses: false,
    focus: 0,
    scroll: 0,
    paint(f, self) {
      // ── Banner ──
      if (banner) {
        const left = banner.until - performance.now();
        if (left <= 0) banner = null;
        else {
          f.g.globalAlpha = Math.min(1, left / 300);
          const w = Math.max(240, banner.text.length * 9 + GRID * 4);
          const r = rect((f.w - w) / 2, 0, w, banner.sub ? 44 : 30);
          fillRect(f, r, UI.sheet);
          strokeRect(f, r, UI.gold);
          text(f, banner.text, r.x + r.w / 2, r.y + 8, { size: 8, colour: UI.gold, align: "center" });
          if (banner.sub) {
            text(f, banner.sub, r.x + r.w / 2, r.y + 24, { size: 8, colour: UI.textDim, align: "center" });
          }
          f.g.globalAlpha = 1;
        }
      }

      // ── Pool pill ──
      const pill = rect(f.w - 180, 14, 164, 26);
      fillRect(f, pill, UI.well);
      strokeRect(f, pill, lobby.connected ? UI.good : UI.textFaint);
      text(
        f,
        lobby.connected ? `POOL · ${lobby.count}` : "OFFLINE",
        pill.x + pill.w / 2,
        pill.y + 9,
        { size: 8, colour: lobby.connected ? UI.good : UI.textFaint, align: "center" },
      );

      // ── "Who's down there" board ──
      const groups = lobby.groups ?? [];
      if (!groups.length) return;
      const board = rect(f.w - 220, 48, 204, 24 + groups.length * 26);
      fillRect(f, board, UI.well);
      strokeRect(f, board, UI.sheetEdge);
      const head = cutTop({ ...board }, 20);
      text(f, "WHO'S DOWN THERE", head.x + GRID, head.y + 6, { size: 8, colour: UI.textDim });

      for (const [i, g] of groups.entries()) {
        const r = rect(board.x + 4, board.y + 22 + i * 26, board.w - 8, 24);
        const st = focusable(f, r);
        fillRect(f, r, UI.sheet);
        strokeRect(f, r, st.focused ? UI.focus : UI.wellEdge);
        text(f, `F${g.floor}`, r.x + 6, r.y + 8, { size: 8, colour: UI.gold });
        text(f, describeParty(g.names), r.x + 36, r.y + 8, { size: 8, colour: UI.text, max: r.w - 44 });
        if (st.activated) onJoinFloor?.(g.floor);
        if (st.focused) focusRing(f, r);
      }
      self.focus = f.focus;
    },
  });
}

// ── RUN SUMMARY ───────────────────────────────────────────────────────────────

export function isRunSummaryOpen(): boolean {
  return isOpen("run-summary");
}

export function closeRunSummary(): void {
  close("run-summary");
}

function gradeColour(grade: string): string {
  return grade.startsWith("S") ? UI.heading : grade.startsWith("A") ? UI.good : grade.startsWith("B") ? UI.text : UI.textDim;
}

export function showRunSummary(stats: TavernStats, onClose: () => void): void {
  if (isOpen("run-summary")) return;
  push({
    id: "run-summary",
    pauses: true,
    focus: 0,
    scroll: 0,
    onClose,
    paint(f: UiFrame, self) {
      scrim(f);
      const body = sheet(f, 420, 300);
      text(f, "RUN SUMMARY", body.x, body.y, { size: 16, colour: UI.arcane });
      cutTop(body, 34);

      const row = (label: string, value: string, colour = UI.text): void => {
        const r: Rect = cutTop(body, 22);
        text(f, label, r.x, r.y + 4, { size: 8, colour: UI.textDim });
        text(f, value, r.x + r.w, r.y + 4, { size: 8, colour, align: "right" });
        fillRect(f, rect(r.x, r.y + 19, r.w, 1), UI.wellEdge);
      };
      row("Floor cleared", String(stats.floor), UI.gold);
      row("Grade", stats.grade, gradeColour(stats.grade));
      row("Kills", String(stats.kills));
      row("Best combo", `x${stats.bestCombo}`);
      row("Gear", GEAR_SLOTS.map((s) => `${GEAR[s].label} ${dungeonState.gear[s] ?? 0}`).join("  "));
      row("Purse", `${getBalance()}g`, UI.gold);

      const foot = rect(body.x, body.y + body.h - ROW_H, body.w, ROW_H);
      if (button(f, foot, "CLOSE  [ESC]")) close("run-summary");
      self.focus = f.focus;
    },
  });
}
