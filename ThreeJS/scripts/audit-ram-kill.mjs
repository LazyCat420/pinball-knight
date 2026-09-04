#!/usr/bin/env node
/** Does a pinball RAM actually kill? Spawn one goblin, launch at it, watch hp. */
import { chromium } from "playwright";
const PORT = Number(process.env.BDB_CDP_PORT ?? 9345);
const URLB = process.argv[2] ?? "https://pinballknight.braindeadbot.com/";
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 120_000 });
const ctx = browser.contexts()[0] || (await browser.newContext());
const page = await ctx.newPage();
await page.setViewportSize({ width: 1280, height: 720 });
await page.addInitScript(() => { if (typeof window.process === "undefined") window.process = { env: {} }; });
page.on("console", (m) => { const t = m.text(); if (t.includes("[death:") || t.includes("[momentum")) console.log("  ", t.slice(0, 160)); });
const u = new URL(URLB);
u.searchParams.set("gpu", "webgpu"); u.searchParams.set("no-intro", "1"); u.searchParams.set("seed", "777"); u.searchParams.set("cb", String(Date.now()));
await page.goto(u.toString(), { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => typeof window.__dungeonStartRun === "function", null, { timeout: 60_000 });
await page.evaluate(() => window.__dungeonStartRun());
await page.waitForFunction(() => window.__dungeonPlayer?.()?.active === true, null, { timeout: 90_000 });
await page.evaluate(() => { for (let i = 0; i < 4; i++) window.__gui?.close?.(); });
await page.waitForTimeout(18_000);
for (const mode of ["ram", "melee"]) {
  await page.evaluate(() => { window.__dungeonDebug?.({ god: true }); window.__lab.only("goblin", 1); });
  await page.waitForTimeout(1200);
  const hp0 = await page.evaluate(() => window.__dungeonAnim()[0]?.hp);
  let killed = false, attempts = 0;
  for (let i = 0; i < 40 && !killed; i++) {
    attempts++;
    killed = await page.evaluate((m) => {
      const z = window.__dungeonAnim()[0]; const p = window.__dungeonPlayer();
      if (!z || !p) return true;
      if (z.mode === "dead") return true;
      if (m === "ram") { window.__dungeonLaunch(z.x - p.x, z.z - p.z, 16); }
      else { window.__playerAttack?.(); }
      return false;
    }, mode);
    await page.waitForTimeout(150);
  }
  const st = await page.evaluate(() => { const z = window.__dungeonAnim()[0]; return z ? { hp: z.hp, mode: z.mode, clip: z.clip, tex: z.texFrame } : null; });
  console.log(`${mode.toUpperCase().padEnd(6)} start hp=${hp0} after ${attempts} attempts ->`, JSON.stringify(st));
  await page.evaluate(() => window.__dungeonClear());
  await page.waitForTimeout(500);
}
await page.close(); await browser.close();
