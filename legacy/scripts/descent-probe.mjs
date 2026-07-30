#!/usr/bin/env node
/**
 * IS THE DESCENT SCREEN ACTUALLY ON SCREEN WHILE THE LOOP IS HELD?
 *
 * `gui-shot.mjs --do "__gui.loading()"` proves the screen PAINTS. It cannot
 * prove the thing that was broken, because it pushes the screen with the game
 * idle and the frame loop running normally — which is the one condition a real
 * descent never has. During a descent the loop is deliberately HELD so a floor's
 * pipelines can be compiled in batches (see run/floor-hold.ts), and the bug was
 * that the held loop drew nothing at all: the screen was open, correct, and
 * invisible. Every static screenshot of it looked perfect the whole time.
 *
 * So this measures the property directly, from inside the page:
 *
 *   while `__dungeonHeld()` is true, does `__gui().painted` keep RISING?
 *
 * That counter increments once per composited UI frame. Rising while held means
 * frames carrying the descent screen are reaching the screen. Flat while held
 * means the player is looking at a frozen image — which is the bug, and is what
 * this reports as a failure.
 *
 * It also grabs a screenshot on the first held frame, so there is a picture of
 * the real thing rather than of a posed one.
 *
 *   node scripts/descent-probe.mjs --url http://localhost:5303/dungeon?...
 */
import { chromium } from "playwright";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const { values: a } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:5301/dungeon?no-intro=1&gpu=webgpu" },
    "cdp-port": { type: "string", default: "9345" },
    out: { type: "string", default: "/tmp/descent-held.png" },
    /** Floors to descend into after boot, so the deeper (slower) path is covered too. */
    floor: { type: "string", default: "6" },
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
  if (await cdpAlive()) return;
  const exe = WIN_CHROME.find((p) => existsSync(p));
  if (!exe) throw new Error("no host Chrome — WSL2 headless has no WebGPU adapter");
  const proc = spawn(
    exe,
    [
      "--headless=new",
      `--remote-debugging-port=${PORT}`,
      "--remote-allow-origins=*",
      "--user-data-dir=C:\\Temp\\bdb-gui-shot",
      "--enable-unsafe-webgpu",
      "--window-size=1600,900",
    ],
    { detached: true, stdio: "ignore" },
  );
  proc.unref();
  for (let i = 0; i < 40; i++) {
    if (await cdpAlive()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("host Chrome did not expose CDP");
}

/**
 * The in-page sampler. Installed BEFORE the descent starts, because the whole
 * window it has to observe is the one where nothing else can run.
 */
const INSTALL = () => {
  const w = window;
  // ⚠️ CANCEL THE PREVIOUS TICKER. The first version just started another one,
  // so the second run had TWO samplers pushing a row each per frame and
  // reported 630 held frames for a descent that had 315. Every number after
  // that was doubled — a harness that lies quietly is worse than no harness.
  if (w.__descentProbe?.raf) cancelAnimationFrame(w.__descentProbe.raf);
  w.__descentProbe = { held: [], raf: 0 };
  const tick = () => {
    if (w.__dungeonHeld?.()) {
      const g = w.__gui?.();
      if (g) w.__descentProbe.held.push({ t: Math.round(performance.now()), painted: g.painted, top: g.top });
    }
    w.__descentProbe.raf = requestAnimationFrame(tick);
  };
  w.__descentProbe.raf = requestAnimationFrame(tick);
};

/**
 * ⚠️ THE BAR IS "KEEPS UP", NOT "MOVES AT ALL".
 *
 * `gained > 0` was the first threshold and it PASSED the broken build. Measured
 * against the pre-fix code: 2 composited frames across 508 held ones — the two
 * that `armFloorLoading` happened to squeeze out before the loop took over, and
 * then nothing for the rest of the descent. Two is greater than zero, so the
 * probe declared the descent healthy while the screenshot beside it showed a
 * frozen frame of the previous floor.
 *
 * A UI frame per held frame is what "the screen is live" means, so that is what
 * this asks for. The two populations are not close: ~1.00 fixed, ~0.004 broken.
 */
const KEEPING_UP = 0.5;

function verdict(label, samples) {
  if (!samples.length) return { label, ok: false, why: "never observed the hold — the descent was too fast to sample" };
  const gained = samples[samples.length - 1].painted - samples[0].painted;
  const onLoading = samples.filter((s) => s.top === "floor-loading").length;
  const ratio = gained / samples.length;
  return {
    label,
    ok: ratio >= KEEPING_UP && onLoading === samples.length,
    heldFrames: samples.length,
    paintedGained: gained,
    uiFramesPerHeldFrame: Number(ratio.toFixed(3)),
    heldFramesShowingTheDescentScreen: onLoading,
    why:
      ratio >= KEEPING_UP
        ? `${gained} UI frames composited across ${samples.length} held frames`
        : `the UI painted only ${gained} times across ${samples.length} held frames — the player is looking at a frozen image`,
  };
}

await ensureBrowser();
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const ctx = browser.contexts()[0] ?? (await browser.newContext());
const page = await ctx.newPage();
await page.setViewportSize({ width: 1600, height: 900 });
await page.bringToFront();
await page.goto(a.url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => typeof window.__dungeonStartRun === "function", null, { timeout: 90_000 });

// ── 1. THE FIRST DESCENT ── the one that was black end to end, because the
//     frame loop has not been started yet and the tavern has just disposed the
//     canvas it was rendering into.
await page.evaluate(INSTALL);
await page.evaluate(() => window.__dungeonStartRun?.());
await page.waitForFunction(() => window.__dungeonPlayer()?.active === true, null, { timeout: 90_000 });
// ⚠️ `active` goes true inside buildLevel, which is BEFORE warmFloorPipelines —
// so the hold is still up here. Waiting a flat two seconds and calling it done
// let the boot descent run on into the next measurement, and the screenshot
// meant for floor 6 came back reading DEPTH 1. Wait for the hold to actually
// clear.
await page.waitForFunction(() => window.__dungeonHeld?.() === false, null, { timeout: 90_000 });
const boot = await page.evaluate(() => window.__descentProbe.held);

// ── 2. A DEEPER DESCENT ── the long one, where warmFloorPipelines runs for
//     seconds and the bar has to keep moving. This one enters through
//     `startLevel` rather than `armFloorLoading`, so it covers the other seam.
await page.evaluate(INSTALL);
const shot = page.waitForFunction(() => window.__descentProbe.held.length > 2, null, { timeout: 30_000 });
await page.evaluate((n) => window.__lab?.floor?.(Number(n)), a.floor);
try {
  await shot;
  await page.screenshot({ path: a.out });
  console.log(`▶ wrote ${a.out} — taken DURING the hold`);
} catch {
  console.log("▶ could not catch the hold for a screenshot (descent finished too fast)");
}
await page.waitForFunction(() => window.__dungeonHeld?.() === false, null, { timeout: 90_000 });
const deep = await page.evaluate(() => window.__descentProbe.held);

const results = [verdict("first descent (boot)", boot), verdict(`descent to floor ${a.floor}`, deep)];
for (const r of results) console.log(`${r.ok ? "✔" : "✘"} ${r.label}: ${r.why}`, JSON.stringify(r));

await page.close();
await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
