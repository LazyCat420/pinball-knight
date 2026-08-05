#!/usr/bin/env node
/** One-off rig probe for room-bench: what does the page actually report? */
import { connectRealGpu, closeHostBrowser, rewriteForHostBrowser } from "./lib/host-chrome.mjs";

const browser = await connectRealGpu({ port: 9333 });
if (!browser) process.exit(2);
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
await page.addInitScript(`(() => {
  window.__gaps = [];
  let prev = performance.now();
  function tick(now) { window.__gaps.push(now - prev); prev = now; requestAnimationFrame(tick); }
  requestAnimationFrame(tick);
})();`);
try {
  const url = new URL(rewriteForHostBrowser("http://localhost:5231/"));
  url.searchParams.set("no-intro", "1");
  url.searchParams.set("gpu", "webgpu");
  await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(() => performance.getEntriesByName("room:mounted").length > 0, null, { timeout: 60_000 });
  console.log("mounted; settling 20s…");
  await page.waitForTimeout(20_000);
  await page.evaluate(() => (window.__gaps.length = 0));
  await page.waitForTimeout(5_000);
  const r = await page.evaluate(() => {
    const gaps = window.__gaps.slice().sort((a, b) => a - b);
    const info = window.__renderer?.info;
    return {
      backend: window.__renderBackendResolved ?? window.__renderBackend,
      visibility: document.visibilityState,
      hasFocus: document.hasFocus(),
      frames5s: gaps.length,
      p50: gaps[Math.floor(gaps.length / 2)],
      max: gaps[gaps.length - 1],
      infoRender: info ? JSON.parse(JSON.stringify(info.render)) : null,
      infoKeys: info ? Object.keys(info) : null,
      autoReset: info?.autoReset,
      dpr: window.devicePixelRatio,
      size: [innerWidth, innerHeight],
    };
  });
  console.log(JSON.stringify(r, null, 2));
} finally {
  await ctx.close();
  closeHostBrowser();
}
