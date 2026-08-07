#!/usr/bin/env node
/**
 * Print WHERE a floor's draw calls come from, on the real GPU.
 *
 * `__dungeonDraws()` does the attribution (see `dev/draw-census.ts`); this
 * drives a browser to a live floor, lets the bot play for a few seconds so the
 * camera is somewhere a player would actually be, and prints the table beside
 * the renderer's own `drawCalls` so the two can be compared.
 *
 * Uses the shared host-Chrome helper, which closes the browser it opened — a
 * detached Chrome inherits pk-run's flock fds and holds the whole CPU grant.
 */
import { parseArgs } from "node:util";
import { connectRealGpu, closeHostBrowser, rewriteForHostBrowser } from "./lib/host-chrome.mjs";

const { values: a } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:5199/dungeon?no-intro=1&autostart=1" },
    secs: { type: "string", default: "12" },
    seed: { type: "string", default: "42" },
  },
});

const browser = await connectRealGpu({ port: Number(process.env.BDB_CDP_PORT ?? 9347) });
if (!browser) {
  console.error("✖ no host Chrome — WebGPU is unreachable from WSL2 without it");
  process.exit(2);
}

const ctx = browser.contexts()[0] || (await browser.newContext());
const page = await ctx.newPage();
await page.setViewportSize({ width: 1920, height: 1080 });
page.on("pageerror", (e) => console.error("PAGEERROR:", String(e.message).slice(0, 200)));

const url = new URL(rewriteForHostBrowser(a.url));
url.searchParams.set("gpu", "webgpu");
url.searchParams.set("seed", a.seed);
url.searchParams.set("profile", "1");
console.log("▶", url.toString());
await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.__dungeonDraws, null, { timeout: 60_000 }).catch(() => {});
await page.waitForTimeout(Number(a.secs) * 1000);

const out = await page.evaluate(() => {
  const census = window.__dungeonDraws?.();
  const info = window.__dungeonRenderInfo?.();
  return { census, info, backend: window.__renderBackendResolved ?? "unknown" };
});

if (!out.census) {
  console.error("✖ no census — is a floor loaded?");
  closeHostBrowser();
  process.exit(3);
}

console.log("backend:", out.backend, "| renderer.info:", JSON.stringify(out.info));
console.table(out.census.rows.filter((r) => r.draws > 0 || r.culled > 0).slice(0, 24));
console.log("TOTALS:", JSON.stringify(out.census.totals));
console.log(
  `camera-pass draws ${out.census.totals.draws} + shadow ${out.census.totals.shadow} = ${
    out.census.totals.draws + out.census.totals.shadow
  } (renderer says ${out.info?.drawCalls})`,
);

await page.close();
closeHostBrowser();
process.exit(0);
