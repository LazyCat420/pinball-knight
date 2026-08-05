#!/usr/bin/env node
/** Screenshot the jungle room on real WebGPU. Usage:
 *    node scripts/room-shot.mjs --flags "merge=off" --out /tmp/room.png */
import { parseArgs } from "node:util";
import { connectRealGpu, closeHostBrowser, rewriteForHostBrowser } from "./lib/host-chrome.mjs";

const { values: a } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:5231/" },
    flags: { type: "string", default: "" },
    out: { type: "string", default: "/tmp/room.png" },
    "settle-secs": { type: "string", default: "8" },
  },
});

const browser = await connectRealGpu({ port: 9333 });
if (!browser) process.exit(2);
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
try {
  const url = new URL(rewriteForHostBrowser(a.url));
  url.searchParams.set("no-intro", "1");
  url.searchParams.set("gpu", "webgpu");
  for (const kv of a.flags.split("&").filter(Boolean)) {
    const [k, v = "1"] = kv.split("=");
    url.searchParams.set(k, v);
  }
  await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(() => performance.getEntriesByName("room:mounted").length > 0, null, { timeout: 60_000 });
  await page.waitForTimeout(Number(a["settle-secs"]) * 1000);
  await page.screenshot({ path: a.out });
  console.log(`✓ ${a.out}`);
} finally {
  await ctx.close();
  closeHostBrowser();
}
