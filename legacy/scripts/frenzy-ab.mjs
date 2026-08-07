#!/usr/bin/env node
/**
 * FRENZY SCREEN-FX A/B — the SAME frame at several combo intensities.
 *
 * The vignette pull and the chromatic-aberration fringe only exist mid-combo,
 * which is exactly where no screenshot and no headless run ever sits. That is
 * how the aberration managed to render NOTHING for months: it split the albedo
 * buffer, the palette snap that consumed the albedo retired on 2026-08-03, and
 * from then on the effect was computed, ramped every frame, and multiplied by
 * zero. Nothing in the suite could see it, because at combo 0 the correct
 * output and the broken output are the same image.
 *
 * So: pin the intensity (`__dungeonFrenzy`), freeze the visual clock
 * (`__fx.freeze()`, the same control heat-ab.mjs uses so the fire is not
 * changing shape between shots), and take one page's worth of frames that
 * differ ONLY by the effect under test.
 *
 *   node scripts/frenzy-ab.mjs --port 5199 --out /tmp/frenzy
 */
import { chromium } from "playwright";
import { parseArgs } from "node:util";
import { mkdirSync } from "node:fs";
import { connectRealGpu, closeHostBrowser, rewriteForHostBrowser } from "./lib/host-chrome.mjs";

const { values: a } = parseArgs({
  options: {
    port: { type: "string", default: "5199" },
    seed: { type: "string", default: "2" },
    out: { type: "string", default: "/tmp/frenzy" },
    boot: { type: "string", default: "8" },
  },
});

/** 0 is the control: it must be pixel-identical to the shipped frame. */
const LEVELS = [0, 0.35, 0.7, 1];

const browser = await connectRealGpu({ port: Number(process.env.BDB_CDP_PORT ?? 9348) });
if (!browser) {
  console.error("✖ no host Chrome — WebGPU is unreachable from WSL2 without it");
  process.exit(2);
}

const ctx = browser.contexts()[0] ?? (await browser.newContext());
const page = await ctx.newPage();
await page.setViewportSize({ width: 1600, height: 900 });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));

const url = rewriteForHostBrowser(
  `http://localhost:${a.port}/dungeon?no-intro=1&autostart=1&gpu=webgpu&seed=${a.seed}`,
);
console.log("▶", url);
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => typeof window.__dungeonPlayer === "function", null, { timeout: 120_000 });
if (!(await page.evaluate(() => window.__dungeonPlayer()?.active === true))) {
  await page.evaluate(() => window.__dungeonStartRun?.());
}
await page.waitForFunction(() => window.__dungeonPlayer()?.active === true, null, { timeout: 120_000 });
await page.waitForTimeout(Number(a.boot) * 1000);

const backend = await page.evaluate(() => window.__renderBackendResolved ?? "unknown");
if (backend !== "webgpu") {
  console.error(`✘ backend is ${backend}, not webgpu — refusing to judge a look on the fallback`);
  closeHostBrowser();
  process.exit(1);
}

// THE CONTROL: without it the fire and particles move between shots and every
// difference reads as the effect. Same trap heat-ab.mjs documents.
await page.evaluate(() => window.__fx?.freeze?.());
await page.waitForTimeout(400);

mkdirSync(a.out, { recursive: true });
for (const v of LEVELS) {
  const ok = await page.evaluate((x) => {
    if (typeof window.__dungeonFrenzy !== "function") return false;
    window.__dungeonFrenzy(x);
    return true;
  }, v);
  if (!ok) {
    console.error("✘ __dungeonFrenzy is not reachable — is this build current?");
    closeHostBrowser();
    process.exit(3);
  }
  // The uniform reaches the screen on the next presented frame, and poking it
  // does not itself request one.
  await page.waitForTimeout(500);
  const file = `${a.out}/frenzy-${String(v).replace(".", "_")}.png`;
  await page.screenshot({ path: file });
  console.log(`  ${String(v).padEnd(5)} → ${file}`);
}

await page.evaluate(() => window.__dungeonFrenzy?.(null));
if (errs.length) console.error("page errors:", errs.slice(0, 3));
await page.close();
closeHostBrowser();
process.exit(0);
