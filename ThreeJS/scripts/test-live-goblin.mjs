import { chromium } from "playwright";

async function test() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9345");
  const page = await browser.newPage();
  await page.goto("https://pinballknight.braindeadbot.com/?gpu=webgpu&no-intro=1&seed=777&death-debug=1", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.__dungeonStartRun === "function", null, { timeout: 60000 });
  await page.evaluate(() => window.__dungeonStartRun());
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.__dungeonDescend?.());
  // Wait until held is false and isTavern is false
  await page.waitForFunction(() => window.__dungeonHeld?.() === false && !window.__dungeonIsTavern?.(), null, { timeout: 60000 });
  for (let i = 0; i < 4; i++) await page.evaluate(() => window.__gui?.close?.());
  await page.waitForTimeout(2000);

  const isTavern = await page.evaluate(() => window.__dungeonIsTavern ? window.__dungeonIsTavern() : false);
  console.log("Is tavern still open?", isTavern);

  // Clear existing enemies and spawn 1 goblin
  await page.evaluate(() => {
    window.__dungeonDebug?.({ god: true });
    window.__dungeonClear?.();
    window.__dungeonSpawn?.({ kind: "goblin", count: 1, ring: 2 });
  });

  console.log("Before kill:", await page.evaluate(() => window.__dungeonAnim?.()));

  // Damage goblin until dead
  await page.evaluate(() => {
    window.__dungeonKillAll?.();
  });

  console.log("After kill. Monitoring __dungeonAnim() for 2.0 seconds...");
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(100);
    const anims = await page.evaluate(() => window.__dungeonAnim?.());
    const g = anims?.find((a) => a.kind === "goblin") || anims?.[0];
    console.log(`[t = ${i * 100}ms]`, g ? {
      mode: g.mode,
      clip: g.clip,
      frameIdx: g.frameIdx,
      texFrame: g.texFrame,
      finished: g.finished,
      indices: g.indices,
      ticks: g.ticks,
    } : "no actor");
  }

  await page.close();
  await browser.close();
}
test().catch(console.error);
