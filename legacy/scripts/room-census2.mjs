#!/usr/bin/env node
/** Deep census: for the heavy roots, bucket meshes by name-prefix + transparency. */
import { connectRealGpu, closeHostBrowser, rewriteForHostBrowser } from "./lib/host-chrome.mjs";

const browser = await connectRealGpu({ port: 9333 });
if (!browser) process.exit(2);
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
try {
  const url = new URL(rewriteForHostBrowser("http://localhost:5231/"));
  url.searchParams.set("no-intro", "1");
  url.searchParams.set("gpu", "webgpu");
  await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(() => performance.getEntriesByName("room:mounted").length > 0, null, { timeout: 60_000 });
  await page.waitForTimeout(3000);
  const r = await page.evaluate(() => {
    const out = {};
    const ROOTS = ["fish-tank", "seasonal-window", "kitchen-area", "jungle-rocks", "kaomoji-portrait", "record-player-model", "beer-pong-table", "mouse-hole-group", "door", "record-shelf"];
    for (const root of window.__scene.children) {
      if (!ROOTS.includes(root.name)) continue;
      const buckets = {};
      root.traverse((o) => {
        if (!o.isMesh || o.visible === false) return;
        let anc = o.parent, ancName = "(root)";
        while (anc && anc !== root) { if (anc.name) { ancName = anc.name.replace(/[-_]?\d+$/, ""); break; } anc = anc.parent; }
        const key = ancName + " > " + (o.name || "unnamed").replace(/[-_]?\d+$/, "") + (o.material?.transparent ? " [T]" : "");
        buckets[key] = (buckets[key] ?? 0) + 1;
      });
      out[root.name] = Object.fromEntries(Object.entries(buckets).sort((a, b) => b[1] - a[1]).slice(0, 12));
    }
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
} finally {
  await ctx.close();
  closeHostBrowser();
}
