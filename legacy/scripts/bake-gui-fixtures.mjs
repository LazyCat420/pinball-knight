/**
 * BAKE GUI FIXTURES — golden UI frames from the REAL legacy toolkit.
 *
 *   node scripts/bake-gui-fixtures.mjs              → ../assets/fixtures/gui/
 *   node scripts/bake-gui-fixtures.mjs --out /path
 *
 * Each scene is painted by the ACTUAL legacy code — `gui/im.ts` primitives,
 * and for the tavern overlays the very screens `scene-screens.ts` pushes —
 * onto a canvas sized like the pixel-pass grid, then exported as a PNG plus
 * the exact inputs used. `cargo test -p pk-gui` repaints every scene from
 * `fixtures.json` and compares pixels. Glyphs and positions are integral
 * (im.ts `px()`), so away from the scrim's premultiply-rounding the compare
 * is EXACT.
 *
 * The widget sampler has no legacy twin by definition — it exists to walk
 * every im.ts primitive; its Rust double lives in the pk-gui fixture test and
 * must be kept in lockstep BY HAND. The prompt and run summary are the real
 * screens, driven through the real stack.
 */
import { resolve, join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { arg, bundle, open } from "./lib/card-harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const LEGACY = resolve(HERE, "..");
const out = resolve(arg("out", resolve(LEGACY, "..", "assets", "fixtures", "gui")));
process.chdir(LEGACY);

/** The pinned summary inputs. The page derives the gear/purse strings from the
 * REAL items/wallet code and reports them back for the Rust side. */
const SUMMARY_STATS = { grade: "A", floor: 7, kills: 23, bestCombo: 9 };
const SUMMARY_GEAR = { helmet: 2, armor: 1, boots: 3 };
const SUMMARY_GOLD = 385;

/** Stations to pin — one per accent family (WARM / COLD / GOLD). */
const PROMPT_STATIONS = ["forge", "board", "gambler"];

const js = await bundle(`
import * as im from "./src/game/pinball-knight/gui/im";
import { UI, GRID } from "./src/game/pinball-knight/gui/theme";
import { screens, top, clearScreens } from "./src/game/pinball-knight/gui/stack";
import { createStationPrompt, showRunSummary } from "./src/scenes/tavern/scene-screens";
import { STATIONS } from "./src/scenes/tavern/layout";
import { GEAR, GEAR_SLOTS } from "./src/game/pinball-knight/items";
import { state as dungeonState } from "./src/game/pinball-knight/state";
import { getBalance, addGold, resetWallet } from "./src/utils/gold-wallet";
import { ensurePixelFonts, awaitPixelFonts } from "./src/pixel/pixel-font";
window.__fix = { im, UI, GRID, screens, top, clearScreens, createStationPrompt, showRunSummary,
                 STATIONS, GEAR, GEAR_SLOTS, dungeonState, getBalance, addGold, resetWallet,
                 ensurePixelFonts, awaitPixelFonts };
`);

const html = `<!doctype html><meta charset=utf8>
<title>bake-gui-fixtures</title>
<style>body{margin:0;background:#0b0d12}</style>
<script>${js}</script>
<script>
(async () => {
 try {
  const F = window.__fix;
  const im = F.im;

  F.ensurePixelFonts();
  await F.awaitPixelFonts();
  await document.fonts.ready;
  if (!document.fonts.check("8px 'Press Start 2P'")) {
    throw new Error("Press Start 2P did not load — fixtures would bake a fallback face");
  }

  const scenes = [];
  const png = {};

  function grid(w, h) {
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const g = cv.getContext("2d", { willReadFrequently: true });
    g.clearRect(0, 0, w, h);
    return { cv, g };
  }

  // ── The widget sampler: every primitive, mirrored by hand in Rust ─────────
  function paintWidgets(f) {
    im.scrim(f);
    const body = im.sheet(f, 600, 400);
    im.heading(f, im.cutTop(body, 24), "Widget Sampler");
    im.cutTop(body, 4);
    const r1 = im.cutTop(body, 24);
    im.button(f, im.cutLeft(r1, 150), "BUY");
    im.cutLeft(r1, 8);
    im.button(f, im.cutLeft(r1, 150), "SELL", { danger: true });
    im.cutLeft(r1, 8);
    im.button(f, im.cutLeft(r1, 150), "TAKE", { good: true });
    im.cutTop(body, 8);
    const r2 = im.cutTop(body, 24);
    im.button(f, im.cutLeft(r2, 150), "BROKE", { disabled: true });
    im.cutLeft(r2, 8);
    im.toggle(f, im.cutLeft(r2, 60), true);
    im.cutLeft(r2, 8);
    im.toggle(f, im.cutLeft(r2, 60), false);
    im.cutTop(body, 8);
    const r3 = im.cutTop(body, 24);
    im.slider(f, im.cutLeft(r3, 200), 0.6);
    im.cutTop(body, 8);
    const r4 = im.cutTop(body, 16);
    im.bar(f, im.cutLeft(r4, 200), 0.35);
    im.cutLeft(r4, 16);
    im.pips(f, im.cutLeft(r4, 60), 3, 5);
    im.cutTop(body, 8);
    im.tabs(f, im.cutTop(body, 22), ["ONE", "TWO", "THREE"], 1);
    im.cutTop(body, 8);
    im.textField(f, im.cutTop(body, 22), "KNIGHT");
    im.cursorMark(f, body.x + 4, body.y + 16);
    im.bevel(f, im.rect(body.x + 40, body.y + 8, 40, 20), { sunken: true, weight: 2 });
    im.well(f, im.rect(body.x + 100, body.y + 8, 40, 20), F.UI.wellEdge);
  }

  for (const [name, gw, gh, uw, uh, zoom] of [
    ["widgets", 1280, 720, 1280, 720, 1],
    ["widgets2x", 1280, 720, 640, 360, 2],
  ]) {
    const { cv, g } = grid(gw, gh);
    const f = im.beginUi(g, uw, uh, im.emptyUiInput(), 1, true, zoom);
    paintWidgets(f);
    png[name] = cv.toDataURL("image/png");
    scenes.push({ name, kind: "widgets", gridW: gw, gridH: gh, w: uw, h: uh, zoom, focus: 1 });
  }

  // ── Station prompts: the REAL screen, through the real stack ──────────────
  const prompt = F.createStationPrompt();
  const promptScreen = F.screens().find((s) => s.id === "station-prompt");
  if (!promptScreen) throw new Error("station-prompt did not push");
  for (const id of ${JSON.stringify(PROMPT_STATIONS)}) {
    const s = F.STATIONS.find((st) => st.id === id);
    if (!s) throw new Error("no station " + id);
    prompt.show(s);
    const { cv, g } = grid(1920, 1080);
    const f = im.beginUi(g, 1920, 1080, im.emptyUiInput(), 0, true, 1);
    promptScreen.paint(f, promptScreen);
    png["prompt-" + id] = cv.toDataURL("image/png");
    scenes.push({
      name: "prompt-" + id, kind: "prompt", gridW: 1920, gridH: 1080, w: 1920, h: 1080,
      zoom: 1, focus: 0,
      station: { label: s.label, blurb: s.blurb, accent: s.accent },
    });
  }
  prompt.dispose();

  // ── Run summary: the REAL screen, gear + wallet seeded then read back ─────
  F.resetWallet();
  F.addGold(${SUMMARY_GOLD}, "fixture");
  F.dungeonState.gear = ${JSON.stringify(SUMMARY_GEAR)};
  const stats = ${JSON.stringify(SUMMARY_STATS)};
  F.showRunSummary(stats, () => {});
  const summaryScreen = F.top();
  if (!summaryScreen || summaryScreen.id !== "run-summary") throw new Error("run-summary did not push");
  {
    const { cv, g } = grid(1920, 1080);
    const f = im.beginUi(g, 1920, 1080, im.emptyUiInput(), 0, true, 1);
    summaryScreen.paint(f, summaryScreen);
    png["run-summary"] = cv.toDataURL("image/png");
    scenes.push({
      name: "run-summary", kind: "summary", gridW: 1920, gridH: 1080, w: 1920, h: 1080,
      zoom: 1, focus: 0,
      summary: {
        floor: String(stats.floor),
        grade: stats.grade,
        kills: String(stats.kills),
        bestCombo: "x" + stats.bestCombo,
        gear: F.GEAR_SLOTS.map((s) => F.GEAR[s].label + " " + (F.dungeonState.gear[s] ?? 0)).join("  "),
        purse: F.getBalance() + "g",
      },
    });
  }
  F.clearScreens();

  window.__out = { scenes, png };
 } catch (e) {
  window.__err = String(e && e.stack || e);
 }
 window.__ready = true;
})();
</script>`;

const { browser, page } = await open(html, { width: 800, height: 600, scale: 1 });
const err = await page.evaluate(() => window.__err);
if (err) {
  await browser.close();
  console.error("[bake:gui-fixtures] page failed:\n" + err);
  process.exit(1);
}
const result = await page.evaluate(() => window.__out);
await browser.close();

mkdirSync(out, { recursive: true });

const outputs = {};
for (const [name, dataUrl] of Object.entries(result.png)) {
  const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  writeFileSync(join(out, `${name}.png`), buf);
  outputs[`${name}.png`] = buf.length;
}

let legacyRev = execFileSync("git", ["rev-parse", "HEAD"], { cwd: LEGACY, encoding: "utf8" }).trim();
if (execFileSync("git", ["status", "--porcelain", "--", "src", "scripts"], { cwd: LEGACY, encoding: "utf8" }).trim()) {
  legacyRev += "-dirty";
}
writeFileSync(
  join(out, "fixtures.json"),
  JSON.stringify({ legacyRev, scenes: result.scenes }, null, 1) + "\n",
);

console.log(
  `[bake:gui-fixtures] ${result.scenes.length} scenes → ${out}\n` +
    Object.entries(outputs)
      .map(([f, b]) => `                    ${f.padEnd(20)} ${(b / 1024).toFixed(1)} KB`)
      .join("\n") +
    `\n                    rev ${legacyRev.slice(0, 9)}`,
);
