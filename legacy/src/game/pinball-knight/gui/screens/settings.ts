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
import { CAMERA_ZOOM, CAMERA_ZOOMS, CAMERA_ZOOM_ORDER, VOLUME_STEPS, type CameraZoom } from "../../constants";
import { applySettingsLive } from "../apply-settings";
import { UI, GRID, ROW_H, PAD } from "../theme";
import {
  beginScroll,
  button,
  cutTop,
  cutRight,
  endScroll,
  followFocus,
  heading,
  rect,
  scrim,
  sheet,
  text,
  toggle,
  slider,
  well,
  type Rect,
  type UiFrame,
} from "../im";
import type { UiScreen } from "../stack";
import { pop } from "../stack";

interface Row {
  key: keyof DungeonSettings & string;
  label: string;
  hint: string;
  /** Some rows read inverted — `muted` shows as "Sound FX: ON". */
  invert?: boolean;
  labels?: [string, string];
  /**
   * Which control the row wears. Absent = a toggle.
   *
   * A discriminant rather than a hand-rolled row, deliberately:
   * `settingsContentHeight()` derives the scroll extent from `SOUND.length`, and
   * its own comment warns that the hand-kept mirror is how "a scroll region
   * silently stops reaching its last row". The camera cycler needed hand
   * arithmetic there; this must not.
   */
  kind?: "slider";
}

const SOUND: Row[] = [
  { key: "muted", label: "Sound FX", hint: "every sting is synthesized — this is the only switch", invert: true, labels: ["ON", "MUTED"] },
  { key: "volume", label: "Volume", hint: "independent of the switch above — muting keeps your level", kind: "slider" },
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

  well(f, r);
  const body = { x: r.x + GRID, y: r.y, w: r.w - GRID * 2, h: r.h };
  // Reserve the control's column BEFORE the text is measured. `cutRight` mutates
  // `body`, so the order is load-bearing: cutting after the text is drawn leaves
  // the label and hint sized to the full row and the control lands on top of
  // them. A slider needs more room than a toggle — 56px of track is five cells.
  const knob = cutRight(body, row.kind === "slider" ? 118 : 64);

  text(f, row.label, body.x, body.y + 5, { size: 8, colour: UI.text, max: body.w - GRID });
  text(f, row.hint, body.x, body.y + 17, { size: 8, colour: UI.textDim, max: body.w - GRID });

  if (row.kind === "slider") {
    const cur = s[row.key] as number;
    const next = slider(f, { x: knob.x, y: knob.y + (knob.h - 14) / 2, w: 110, h: 14 }, cur, { steps: VOLUME_STEPS });
    if (next !== cur) {
      saveSettings({ [row.key]: next } as Partial<DungeonSettings>);
      applySettingsLive();
    }
    return;
  }

  const raw = s[row.key] as boolean;
  const on = row.invert ? !raw : raw;

  if (toggle(f, { x: knob.x, y: knob.y + (knob.h - 18) / 2, w: 56, h: 18 }, on, row.labels ?? ["ON", "OFF"])) {
    // Write the RAW value — `invert` is a presentation concern only. Storing the
    // inverted value would silently flip the meaning of the persisted setting
    // for every other reader of settings-save.
    saveSettings({ [row.key]: !raw } as Partial<DungeonSettings>);
    applySettingsLive();
  }
}

/**
 * The camera row — a CYCLER, not a toggle, and the one control here that does
 * not take effect until the page reloads.
 *
 * Both of those are forced by what the setting actually is. `PPU` is the zoom
 * AND the denominator of the sprite grid, so it only has legal values every 8
 * apart (see `CAMERA_ZOOMS`) — a slider would imply a continuum that does not
 * exist and would land the art between texels. And it is resolved at module
 * load, because the sprite atlas is rasterised once from it; changing it live
 * would leave the frustum and the atlas disagreeing about the size of a texel.
 *
 * So the row says so, plainly, and offers the reload rather than leaving the
 * player to work out why the camera did not move. `CAMERA_ZOOM` is the value
 * the RUNNING game booted with; `s.cameraZoom` is the value that will be used
 * next time. Showing both is what makes "pending" legible instead of "broken".
 */
function cameraRow(f: UiFrame, r: Rect): void {
  const s = getSettings();
  const chosen = s.cameraZoom;
  const pending = chosen !== CAMERA_ZOOM;

  well(f, r);
  const body = { x: r.x + GRID, y: r.y, w: r.w - GRID * 2, h: r.h };
  const reload = cutRight(body, pending ? 66 : 0);
  const knob = cutRight(body, 74);

  text(f, "Camera distance", body.x, body.y + 5, { size: 8, colour: UI.text, max: body.w - GRID });
  text(
    f,
    pending ? `${chosen.toUpperCase()} — RELOAD TO APPLY` : `${CAMERA_ZOOMS[chosen]} px per tile · more zoom, fewer texels`,
    body.x,
    body.y + 17,
    { size: 8, colour: pending ? UI.gold : UI.textDim, max: body.w - GRID },
  );

  if (button(f, { x: knob.x, y: knob.y + (knob.h - 18) / 2, w: 70, h: 18 }, chosen.toUpperCase())) {
    const i = CAMERA_ZOOM_ORDER.indexOf(chosen);
    const next: CameraZoom = CAMERA_ZOOM_ORDER[(i + 1) % CAMERA_ZOOM_ORDER.length];
    saveSettings({ cameraZoom: next });
  }
  if (pending && button(f, { x: reload.x, y: reload.y + (reload.h - 18) / 2, w: 62, h: 18 }, "RELOAD", { good: true })) {
    // The run is not lost: the resume-floor system puts the player back on the
    // floor they were on. That is the only reason this is a button and not a
    // warning to go and do it themselves.
    if (typeof location !== "undefined") location.reload();
  }
}

function section(f: UiFrame, body: Rect, title: string, rows: Row[]): void {
  heading(f, cutTop(body, ROW_H), title);
  for (const row of rows) {
    // 32, not 40: two 8px lines plus a pixel of air. At the 2x design zoom the
    // sheet is a fixed 424 tall, and six rows at 40 ran the last one under the
    // footer — which is a control the player cannot reach, not a cosmetic
    // overlap.
    settingRow(f, cutTop(body, 32), row);
    cutTop(body, 3);
  }
  cutTop(body, GRID);
}

/**
 * The scrollable height of the settings body, DERIVED from the sections rather
 * than written down, so adding a row cannot make a scrollbar lie. Exported
 * because the menu's OPTIONS tab has to declare the same number to
 * `beginScroll` — two hand-kept copies is how a scroll region silently stops
 * reaching its last row.
 */
export function settingsContentHeight(): number {
  // Mirrors `settingsBody` block for block, in the same order, so the two can be
  // read side by side. The camera block is 32 rather than 35 because it is a
  // single row with no 3px inter-row gap after it — the old expression rounded
  // that up and quietly claimed three pixels of scroll travel into blank space.
  const camera = ROW_H + 32 + GRID;
  const sectionH = (n: number): number => ROW_H + n * 35 + GRID;
  return camera + sectionH(SOUND.length) + sectionH(LOOK.length) + sectionH(CARDS.length);
}

/**
 * Every settings section, painted into `flow` (which is consumed top-down).
 *
 * Split out of `settingsScreen` so the knight menu's OPTIONS tab paints the
 * SAME rows rather than a second copy of them. It has to be the same code: this
 * screen carries the only control for `cameraZoom`, and a duplicate that drifts
 * is how the camera setting would go back to being unreachable.
 */
export function settingsBody(f: UiFrame, flow: Rect): void {
  // CAMERA IS FIRST, and that is not a cosmetic ordering. It was last, under
  // three sections and 340 content pixels, in a scroll view 216 pixels tall —
  // so the one control the player was hunting for ("no way to change the
  // resolution") was the one control that was off the bottom of the sheet until
  // you thought to scroll. A setting below the fold of the screen it lives on is
  // barely better than the unreachable screen it used to live on.
  heading(f, cutTop(flow, ROW_H), "CAMERA");
  cameraRow(f, cutTop(flow, 32));
  cutTop(flow, GRID);
  section(f, flow, "Sound", SOUND);
  section(f, flow, "Pixel look", LOOK);
  section(f, flow, "Cards", CARDS);
}

/**
 * The standalone sheet.
 *
 * The player's route in is the knight menu's OPTIONS tab (Esc → OPTIONS), not
 * this. It stays because `__gui.settings()` photographs it and because the
 * screen predates the tab; if a second route is ever wanted, this is it.
 */
export function settingsScreen(): UiScreen {
  return {
    id: "settings",
    pauses: true,
    focus: 0,
    scroll: 0,
    // See `UiScreen.design`. 800x450 is the design floor every sheet in this
    // game now targets, so on a desktop grid they all come out at 2x and at the
    // SAME zoom as each other — a menu at 1x beside a HUD at 2x reads as two
    // different games stapled together.
    design: { w: 600, h: 338, max: 2 },
    paint(f, self) {
      scrim(f);
      const body = sheet(f, 520, 322);

      const head = cutTop(body, ROW_H + GRID);
      text(f, "SETTINGS", head.x, head.y, { size: 16, colour: UI.gold });

      // Footer pinned to the bottom of the SHEET, taken out of the space before
      // anything flows into it — a footer that drifts up when a section is
      // short reads as a layout bug, and one that gets overrun when a section
      // is added reads as a broken screen. The camera section was the fourth,
      // and the fourth is where this stopped fitting.
      const foot = rect(body.x, body.y + body.h - ROW_H, body.w, ROW_H);
      const view = rect(body.x, body.y, body.w, body.h - ROW_H - GRID);

      const contentH = settingsContentHeight();

      const sc = beginScroll(f, view, contentH, self.scroll);
      settingsBody(f, { ...sc.inner });
      endScroll(f, view, contentH, sc.offset);
      // The region follows the cursor — see `followFocus`. This screen is the
      // reason that helper carries a warning: CAMERA was moved to the top (note
      // above `settingsBody`) because it was below the fold and unreachable, which
      // is a workaround for exactly this, not a fix for it.
      self.scroll = followFocus(f, view, sc.offset);

      text(f, "ESC / B  CLOSE     ↑↓  MOVE     ENTER / A  TOGGLE", foot.x, foot.y + 8, {
        size: 8,
        colour: UI.textFaint,
      });
      if (button(f, { x: foot.x + foot.w - 96, y: foot.y, w: 96, h: ROW_H }, "CLOSE")) pop();
      void PAD;
    },
  };
}
