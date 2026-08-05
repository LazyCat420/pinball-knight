#!/usr/bin/env node
/** Census: visible meshes per top-level scene child, plus material classes.
 *  Answers "where do the jungle room's draw calls live" with data. */
import { connectRealGpu, closeHostBrowser, rewriteForHostBrowser } from "./lib/host-chrome.mjs";

const browser = await connectRealGpu({ port: 9333 });
if (!browser) process.exit(2);
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
try {
  const url = new URL(rewriteForHostBrowser(process.argv[2] ?? "http://localhost:5231/"));
  url.searchParams.set("no-intro", "1");
  url.searchParams.set("gpu", "webgpu");
  await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(() => performance.getEntriesByName("room:mounted").length > 0, null, { timeout: 60_000 });
  await page.waitForTimeout(3000);
  const r = await page.evaluate(() => {
    const roots = [];
    const mats = {};
    const castCount = { cast: 0, total: 0 };
    for (const child of window.__scene.children) {
      let meshes = 0;
      child.traverse((o) => {
        if (!o.isMesh || o.visible === false) return;
        meshes++;
        castCount.total++;
        if (o.castShadow) castCount.cast++;
        const m = Array.isArray(o.material) ? o.material : [o.material];
        for (const mm of m) mats[mm?.type ?? "?"] = (mats[mm?.type ?? "?"] ?? 0) + 1;
      });
      if (meshes > 0) roots.push([child.name || child.type, meshes]);
    }
    roots.sort((a, b) => b[1] - a[1]);
    return { roots: roots.slice(0, 30), mats, castCount, total: castCount.total };
  });
  console.log(JSON.stringify(r, null, 1));
} finally {
  await ctx.close();
  closeHostBrowser();
}
