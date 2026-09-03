import { chromium } from "playwright";

async function test() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9345");
  const page = browser.contexts()[0].pages()[0];
  await page.goto("https://pinballknight.braindeadbot.com/?gpu=webgpu&no-intro=1&autostart=1&seed=777&death-debug=1", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__dungeonPlayer?.()?.active === true, null, { timeout: 60000 });
  for (let i = 0; i < 4; i++) await page.evaluate(() => window.__gui?.close?.());
  await page.waitForFunction(() => window.__dungeonHeld?.() === false, null, { timeout: 60000 });
  await page.waitForTimeout(2000);

  console.log("Status after warmup:", await page.evaluate(() => ({
    held: window.__dungeonHeld?.(),
    tavern: window.__dungeonIsTavern?.() ?? window.__dungeonTavern?.(),
    player: !!window.__dungeonPlayer?.(),
  })));

  // Clear and spawn goblin
  await page.evaluate(() => {
    window.__dungeonClear?.();
    window.__dungeonSpawn?.({ kind: "goblin", count: 1, ring: 2 });
  });
  await page.waitForTimeout(500);

  const initial = await page.evaluate(() => window.__dungeonAnim?.()[0]);
  console.log("Initial goblin:", initial);

  // Kill goblin
  await page.evaluate(() => window.__dungeonKill?.("goblin", 1));

  console.log("Monitoring death progression:");
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(80);
    const snap = await page.evaluate(() => {
      const g = window.__dungeonAnim?.()[0];
      if (!g) return null;
      return {
        mode: g.mode,
        clip: g.clip,
        facing: g.facing,
        frameIdx: g.frameIdx,
        texFrame: g.texFrame,
        finished: g.finished,
        ticks: g.ticks?.ticks,
      };
    });
    console.log(`[t = ${i * 80}ms]`, snap);
  }

  await browser.close();
}
test().catch(console.error);
