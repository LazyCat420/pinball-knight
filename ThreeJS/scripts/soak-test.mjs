#!/usr/bin/env node
/**
 * Heavy Combat Soak Test & Performance Profile against deployed WebGPU build.
 */
import { chromium } from "playwright";

const PORT = Number(process.env.BDB_CDP_PORT ?? "9345");
const URL_TARGET = process.env.TARGET_URL ?? "https://pinballknight.braindeadbot.com/";
const DURATION_S = Number(process.env.SOAK_SECONDS ?? "60");

console.log(`▶ Connecting to host browser over CDP on port ${PORT}...`);
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 120_000 });
const ctx = browser.contexts()[0] || (await browser.newContext());
const page = await ctx.newPage();
await page.setViewportSize({ width: 1280, height: 720 });

const pageErrors = [];
page.on("pageerror", (e) => {
  pageErrors.push(String(e.message));
  console.error("  [pageerror]", String(e.message).slice(0, 160));
});

const url = new URL(URL_TARGET);
url.searchParams.set("gpu", "webgpu");
url.searchParams.set("no-intro", "1");
url.searchParams.set("seed", "777");
url.searchParams.set("profile", "1");

console.log(`▶ Navigating to ${url}...`);
await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => typeof window.__dungeonStartRun === "function", null, { timeout: 60_000 });
await page.evaluate(() => window.__dungeonStartRun());
await page.waitForFunction(() => window.__dungeonPlayer?.()?.active === true, null, { timeout: 90_000 });
await page.evaluate(() => { for (let i = 0; i < 4; i++) window.__gui?.close?.(); });

console.log(`▶ Starting Playtest Bot in combat mode with profiling for ${DURATION_S}s...`);
await page.evaluate((s) => window.__dungeonBot({ mode: "fight", seconds: s, profile: true }), DURATION_S);

// Let the bot play for the requested duration while checking state
const startTime = Date.now();
while (Date.now() - startTime < (DURATION_S + 2) * 1000) {
  const isRunning = await page.evaluate(() => window.__dungeonBotIsRunning?.() ?? false);
  if (!isRunning && Date.now() - startTime > 5000) break;
  await page.waitForTimeout(2000);
}

const report = await page.evaluate(() => window.__dungeonBotStop?.());
const stats = await page.evaluate(() => window.__dungeonStats?.());
const memory = await page.evaluate(() => {
  const perf = window.performance;
  return (perf && (perf).memory) ? {
    usedJSHeapSize: Math.round((perf).memory.usedJSHeapSize / (1024 * 1024)),
    totalJSHeapSize: Math.round((perf).memory.totalJSHeapSize / (1024 * 1024)),
  } : null;
});

console.log("\n════ SOAK TEST REPORT ════");
console.log(`Duration: ${report?.ranSeconds ?? DURATION_S}s`);
console.log(`Decisions: ${report?.decisions ?? 0}`);
console.log(`Kills: ${report?.kills ?? 0}`);
console.log(`Deaths: ${report?.deaths ?? 0}`);
console.log(`Peak Bounce Combo: ${report?.peakCombo ?? 0}`);
console.log(`P95 Frame Time: ${report?.p95FrameMs?.toFixed(2) ?? "N/A"} ms`);
console.log(`Active Enemies at End: ${stats?.enemies?.length ?? 0}`);
console.log(`Active Projectiles at End: ${stats?.projectiles ?? 0}`);
console.log(`Active FloorFx at End: ${stats?.floorFx?.length ?? 0}`);
if (memory) {
  console.log(`JS Heap Used: ${memory.usedJSHeapSize} MB / Total: ${memory.totalJSHeapSize} MB`);
}
console.log(`Errors Encountered: ${pageErrors.length}`);

await page.close();
process.exit(pageErrors.length > 0 ? 1 : 0);
