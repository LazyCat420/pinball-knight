#!/usr/bin/env node
/**
 * SCREENSHOT THE IN-GAME UI, on a real WebGPU adapter.
 *
 * The DOM overlays could be inspected in devtools. The canvas UI cannot, so
 * every visual claim about it has to come from a picture taken through the
 * actual pixel pass — that is the entire point of moving it in there, and it is
 * also the only way to see whether the palette snap, the dither and the
 * scanlines are doing what we think to 8px text.
 *
 * Same CDP recipe as scripts/webgpu-check.mjs and playtest.mjs --gpu: WSL2's
 * headless Chromium has no WebGPU adapter, so we drive the HOST's Chrome.
 *
 *   node scripts/gui-shot.mjs --do "__gui.settings()" --out /tmp/settings.png
 *   node scripts/gui-shot.mjs --do "__gui.probe()"    --out /tmp/probe.png
 */
import { chromium } from "playwright";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const { values: a } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:5301/dungeon?no-intro=1&gpu=webgpu" },
    "cdp-port": { type: "string", default: "9345" },
    do: { type: "string", default: "__gui.settings()" },
    out: { type: "string", default: "/tmp/gui-shot.png" },
    /** Extra ms to wait after the action, for anything that animates in. */
    settle: { type: "string", default: "700" },
    /** Seconds to let the game boot before acting. */
    boot: { type: "string", default: "14" },
    /** Keys to press after the action, comma separated: "ArrowDown,Enter". */
    keys: { type: "string" },
    /** Also dump the UI layer's own canvas, unmodified by the pass. */
    "layer-out": { type: "string" },
  },
});

const PORT = Number(a["cdp-port"]);
const WIN_CHROME = [
  "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
  "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
];

async function cdpAlive() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

async function ensureBrowser() {
  if (await cdpAlive()) {
    console.log(`▶ reusing CDP browser on :${PORT}`);
    return null;
  }
  const exe = WIN_CHROME.find((p) => existsSync(p));
  if (!exe) throw new Error("no host Chrome found — WSL2 headless has no WebGPU adapter, so this cannot run on bundled Chromium");
  const proc = spawn(exe, [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    "--remote-allow-origins=*",
    "--user-data-dir=C:\\Temp\\bdb-gui-shot",
    "--enable-unsafe-webgpu",
    "--window-size=1600,900",
  ], { detached: true, stdio: "ignore" });
  proc.unref();
  for (let i = 0; i < 40; i++) {
    if (await cdpAlive()) return proc;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("host Chrome did not expose CDP");
}

await ensureBrowser();
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const ctx = browser.contexts()[0] ?? (await browser.newContext());
const page = await ctx.newPage();
await page.setViewportSize({ width: 1600, height: 900 });
// A BACKGROUNDED page has its requestAnimationFrame throttled to a crawl, and
// the UI is driven from the render loop — so a background page delivers one or
// two UI frames a second and swallows most input. Measured: the same three
// keypresses moved the cursor 0, 1 or 3 rows depending on whether this page
// happened to be frontmost, which looks exactly like a flaky input bug in the
// game. It is a harness artefact; keep the page in front.
await page.bringToFront();

const logs = [];
page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));

await page.goto(a.url, { waitUntil: "domcontentloaded" });

/**
 * ENTER THE MAZE PROPERLY.
 *
 * `/dungeon` does NOT drop you in the maze — it loads the arcade hub, whose
 * "ENTER MAZE" sign starts the run. Screenshotting after a fixed sleep gets you
 * a lovely picture of the hub and a UI layer that never painted, because the
 * dungeon's pixel pass (the thing that composites the UI) does not exist yet.
 * That is a very convincing false negative. `playtest.mjs` solves it with
 * `__dungeonStartRun()`; same recipe here.
 */
await page.waitForFunction(() => typeof window.__dungeonPlayer === "function", null, { timeout: 90_000 });
if (!(await page.evaluate(() => window.__dungeonPlayer()?.active === true))) {
  await page.evaluate(() => window.__dungeonStartRun?.());
}
await page.waitForFunction(() => window.__dungeonPlayer()?.active === true, null, { timeout: 90_000 });
await page.waitForTimeout(Number(a.boot) * 1000);

const backend = await page.evaluate(() => window.__renderBackendResolved ?? "unknown");
if (backend !== "webgpu") {
  console.error(`✘ resolved backend is ${backend}, not webgpu — refusing to judge the UI on the fallback path`);
  process.exit(2);
}

const ok = await page.evaluate((expr) => {
  try {
    // eslint-disable-next-line no-eval
    return String(eval(expr));
  } catch (e) {
    return `THREW: ${e.message}`;
  }
}, a.do);
console.log(`▶ ${a.do} → ${ok}`);

// Real key presses, through the browser's own event path. The UI listens on
// `window` in the CAPTURE phase, so a synthetic `dispatchEvent` would exercise
// a different path than a player does — and in particular would not prove that
// the UI's preventDefault actually stops the key reaching the gameplay handler.
if (a.keys) {
  for (const k of a.keys.split(",")) {
    await page.keyboard.press(k.trim());
    await page.waitForTimeout(140);
  }
  console.log(`▶ pressed ${a.keys}`);
}

await page.waitForTimeout(Number(a.settle));
// Read the counters AFTER the settle, not before it. Sampling them in the same
// tick as the action always reports `painted: 0` — the driver has not had a
// frame yet — which reads as "the UI never painted" and is simply too early.
const stats = await page.evaluate(() => (window.__gui ? window.__gui() : null));
console.log(`▶ gui after settle: ${JSON.stringify(stats)}`);
await page.screenshot({ path: a.out });
console.log(`▶ wrote ${a.out}  (backend=${backend})`);

// The LAYER, dumped straight off its canvas. This is the one measurement that
// separates "the UI never painted" from "the UI painted and the composite ate
// it" — two bugs with identical symptoms (a blank screen) and completely
// different fixes.
if (a["layer-out"]) {
  const url = await page.evaluate(() => (window.__gui ? window.__gui.shot() : null));
  if (!url) console.log("▶ no layer canvas");
  else {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(a["layer-out"], Buffer.from(url.split(",")[1], "base64"));
    console.log(`▶ wrote layer ${a["layer-out"]}`);
  }
}

const interesting = logs.filter((l) => /error|warn|gui|backend/i.test(l)).slice(-12);
if (interesting.length) console.log("console:\n  " + interesting.join("\n  "));

await page.close();
await browser.close();
