/**
 * SETTINGS — the first screen to live inside the game.
 *
 * Chosen as the P0 proof deliberately: it is pure toggles over persisted state,
 * so it exercises the whole path (stack → input → focus → widgets → layer →
 * composite) without needing a single icon, card face or scroll region. If this
 * screen is crisp, on-palette, and drivable from a pad, the foundation is real.
 *
 * It is also the screen where the pixel pass being in the loop is VISIBLE:
 * toggling Palette quantize or Scanlines now changes the menu you are toggling
 * them in. Under the DOM version the settings claimed to control a look the
 * settings panel itself was exempt from.
 */
import { getSettings, saveSettings, type DungeonSettings } from "../../settings-save";
import { applySettingsLive } from "../apply-settings";
import { UI, GRID, ROW_H, PAD } from "../theme";
import { button, cutTop, cutRight, heading, rect, scrim, sheet, text, toggle, well, type Rect, type UiFrame } from "../im";
import type { UiScreen } from "../stack";
import { pop } from "../stack";

interface Row {
  key: keyof DungeonSettings & string;
  label: string;
  hint: string;
  /** Some rows read inverted — `muted` shows as "Sound FX: ON". */
  invert?: boolean;
  labels?: [string, string];
}

const SOUND: Row[] = [
  { key: "muted", label: "Sound FX", hint: "every sting is synthesized — this is the only switch", invert: true, labels: ["ON", "MUTED"] },
];

const LOOK: Row[] = [
  { key: "quantize", label: "Palette quantize", hint: "snap colours to the 32-colour palette" },
  { key: "dither", label: "Dither", hint: "ordered dithering between palette steps" },
  { key: "scanline", label: "Scanlines", hint: "CRT scanline overlay" },
  { key: "outline", label: "Outline", hint: "depth-edge ink outline" },
];

const CARDS: Row[] = [
  { key: "haulReveal", label: "Floor haul screen", hint: "read every card you found when the floor ends", labels: ["ON", "OFF"] },
];

/** One settings row: label + hint on the left, a toggle pinned right. */
function settingRow(f: UiFrame, r: Rect, row: Row): void {
  const s = getSettings();
  const raw = s[row.key] as boolean;
  const on = row.invert ? !raw : raw;

  well(f, r);
  const body = { x: r.x + GRID, y: r.y, w: r.w - GRID * 2, h: r.h };
  const knob = cutRight(body, 64);

  text(f, row.label, body.x, body.y + 6, { size: 8, colour: UI.text, max: body.w - GRID });
  text(f, row.hint, body.x, body.y + 20, { size: 8, colour: UI.textDim, max: body.w - GRID });

  if (toggle(f, { x: knob.x, y: knob.y + (knob.h - 20) / 2, w: 56, h: 20 }, on, row.labels ?? ["ON", "OFF"])) {
    // Write the RAW value — `invert` is a presentation concern only. Storing the
    // inverted value would silently flip the meaning of the persisted setting
    // for every other reader of settings-save.
    saveSettings({ [row.key]: !raw } as Partial<DungeonSettings>);
    applySettingsLive();
  }
}

function section(f: UiFrame, body: Rect, title: string, rows: Row[]): void {
  heading(f, cutTop(body, ROW_H), title);
  for (const row of rows) {
    settingRow(f, cutTop(body, 40), row);
    cutTop(body, 4);
  }
  cutTop(body, GRID);
}

export function settingsScreen(): UiScreen {
  return {
    id: "settings",
    pauses: true,
    focus: 0,
    scroll: 0,
    paint(f, self) {
      scrim(f);
      const body = sheet(f, 560, 480);

      const head = cutTop(body, ROW_H + GRID);
      text(f, "SETTINGS", head.x, head.y, { size: 16, colour: UI.gold });

      section(f, body, "Sound", SOUND);
      section(f, body, "Pixel look", LOOK);
      section(f, body, "Cards", CARDS);

      // Footer pinned to the bottom of the sheet, not to the flow — a footer
      // that drifts up when a section is short reads as a layout bug.
      const foot = rect(body.x, body.y + body.h - ROW_H, body.w, ROW_H);
      text(f, "ESC / B  CLOSE     ↑↓  MOVE     ENTER / A  TOGGLE", foot.x, foot.y + 8, {
        size: 8,
        colour: UI.textFaint,
      });
      if (button(f, { x: foot.x + foot.w - 96, y: foot.y, w: 96, h: ROW_H }, "CLOSE")) pop();
      void self;
      void PAD;
    },
  };
}
