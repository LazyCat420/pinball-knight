#!/usr/bin/env node
/**
 * TAVERN ENTRY STALL — A/B the pipeline warm-up behind `?tavernwarm=`.
 *
 * The claim under test: warming the tavern's pipelines before the first
 * presented frame (src/scenes/tavern/warmup.ts) removes the first-entry
 * freeze that lazy pipeline builds otherwise cause — the same bug family as
 * b4faca5 (window glass) and c3ea5ef (post-intro lights).
 *
 * Both arms run the SAME build with identical instrumentation; the only
 * difference is the URL flag. Runs are INTERLEAVED (A B A B …, and each pair
 * flips order) because this box's load drifts minute to minute.
 *
 * The metric is windowed on the `tavern:first-present` performance mark
 * (core.ts frame()): stalls BEFORE it hide in the renderer-init gap the
 * player already sees as a black screen; long rAF gaps AFTER it are frozen
 * frames of a visible room. Reported per trial:
 *
 *   firstPresent  ms from navigation to the first presented tavern frame
 *   worst         worst rAF gap in the 10 s after first present
 *   stall50       count of gaps ≥ 50 ms in that window
 *   excess33      sum of (gap − 33 ms) over gaps ≥ 33 ms — total visible jank
 *
 * REAL GPU ONLY: WSL Chromium has no WebGPU adapter and silently falls back
 * to WebGL2, which builds different pipelines. Refuses to run without the
 * host browser.
 *
 *   node scripts/tavern-warm-ab.mjs --url http://localhost:5199/dungeon --pairs 3
 */
import { parseArgs } from "node:util";
import { connectRealGpu, closeHostBrowser, rewriteForHostBrowser } from "./lib/host-chrome.mjs";

const { values: a } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:5199/dungeon" },
    pairs: { type: "string", default: "3" },
    "settle-secs": { type: "string", default: "10" },
    "cdp-port": { type: "string", default: process.env.BDB_CDP_PORT ?? "9333" },
  },
});

const PAIRS = Number(a.pairs);
const SETTLE_MS = Number(a["settle-secs"]) * 1000;

/** Injected at document start so it records across the whole boot. */
const PROBE = `(() => {
  const gaps = [];
  let prev = performance.now();
  function tick(now) {
    const gap = now - prev;
    prev = now;
    if (gap > 24) gaps.push([now, gap]);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  window.__abGaps = () => gaps;
})();`;

async function trial(browser, baseUrl, warm) {
  const url = new URL(baseUrl);
  url.searchParams.set("no-intro", "1");
  url.searchParams.set("mute", "1");
  url.searchParams.set("gpu", "webgpu");
  url.searchParams.set("tavernwarm", warm ? "1" : "0");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.addInitScript(PROBE);
  try {
    await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 60_000 });
    // Wait for the first presented tavern frame, then let the room run.
    await page.waitForFunction(
      () => performance.getEntriesByName("tavern:first-present").length > 0,
      null,
      { timeout: 45_000 },
    );
    await page.waitForTimeout(SETTLE_MS);
    const r = await page.evaluate((windowMs) => {
      const mark = performance.getEntriesByName("tavern:first-present")[0].startTime;
      const gaps = window.__abGaps().filter(([t]) => t >= mark && t <= mark + windowMs);
      const worst = gaps.reduce((m, [, g]) => Math.max(m, g), 0);
      const stall50 = gaps.filter(([, g]) => g >= 50).length;
      const excess33 = gaps.filter(([, g]) => g >= 33).reduce((s, [, g]) => s + g - 33, 0);
      const gpu = !!navigator.gpu;
      return { firstPresent: mark, worst, stall50, excess33, gpu, nGaps: gaps.length };
    }, SETTLE_MS);
    if (!r.gpu) throw new Error("page has no navigator.gpu — not the host browser?");
    return r;
  } finally {
    await ctx.close();
  }
}

const browser = await connectRealGpu({ port: Number(a["cdp-port"]) });
if (!browser) {
  console.error("✗ no real-GPU browser — refusing to measure under SwiftShader/WebGL2");
  process.exit(2);
}
const base = rewriteForHostBrowser(a.url);

const results = { warm: [], cold: [] };
try {
  for (let i = 0; i < PAIRS; i++) {
    // Alternate order within each pair so neither arm always pays first-load costs.
    const order = i % 2 === 0 ? [false, true] : [true, false];
    for (const warm of order) {
      const r = await trial(browser, base, warm);
      results[warm ? "warm" : "cold"].push(r);
      console.log(
        `${warm ? "WARM" : "COLD"}  firstPresent=${r.firstPresent.toFixed(0)}ms  worst=${r.worst.toFixed(0)}ms  stall50=${r.stall50}  excess33=${r.excess33.toFixed(0)}ms`,
      );
    }
  }
} finally {
  closeHostBrowser();
}

const med = (xs) => [...xs].sort((p, q) => p - q)[Math.floor(xs.length / 2)];
for (const arm of ["cold", "warm"]) {
  const rs = results[arm];
  console.log(
    `\n${arm.toUpperCase()} median: firstPresent=${med(rs.map((r) => r.firstPresent)).toFixed(0)}ms  worst=${med(rs.map((r) => r.worst)).toFixed(0)}ms  stall50=${med(rs.map((r) => r.stall50))}  excess33=${med(rs.map((r) => r.excess33)).toFixed(0)}ms`,
  );
}
