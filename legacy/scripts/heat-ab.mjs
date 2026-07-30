#!/usr/bin/env node
/**
 * HEAT SHIMMER A/B — does toggling it actually change the SCENE?
 *
 * The shimmer is the only effect in the game that moves pixels which are not its
 * own: it warps the floor and walls behind and around a flame. So "is it working"
 * cannot be answered by looking at the effect — there is nothing to look at. The
 * only honest test is the same frame with the same fire, shimmer on versus off.
 *
 * Both captures are taken with the fx CLOCK FROZEN. Without that the fire is
 * changing shape between the two shots and the diff measures the flame, not the
 * refraction — the same contaminated-control trap that made the first version of
 * `fx-motion.mjs` meaningless.
 *
 *   node scripts/heat-ab.mjs
 */
import { chromium } from "playwright";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const { values: a } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:5199/dungeon" },
    "cdp-port": { type: "string", default: "9345" },
    out: { type: "string", default: ".fx-motion" },
    /** Minimum mean-abs channel difference for the shimmer to count as visible. */
    thresh: { type: "string", default: "0.25" },
    headed: { type: "boolean", default: false },
  },
});

const PORT = Number(a["cdp-port"]);
const WIN_CHROME = [
  "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
  "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
];
const log = (...m) => console.log(...m);

async function cdpAlive(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

async function connectHostGpu() {
  if (await cdpAlive(PORT)) return chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 120_000 });
  const exe = WIN_CHROME.find((p) => existsSync(p));
  if (!exe) return null;
  const p = spawn(
    exe,
    [
      a.headed ? "--new-window" : "--headless=new",
      "--mute-audio",
      `--remote-debugging-port=${PORT}`,
      "--remote-allow-origins=*",
      "--user-data-dir=C:\\Temp\\bdb-fx-motion",
      "--no-first-run",
      "--no-default-browser-check",
      "--enable-unsafe-webgpu",
      "--enable-features=Vulkan",
      "about:blank",
    ],
    { detached: true, stdio: "ignore" },
  );
  p.unref();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await cdpAlive(PORT)) return chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 120_000 });
  }
  return null;
}

const browser = await connectHostGpu();
if (!browser) {
  console.error("✖ No host browser — WebGPU is unreachable from WSL2 without it.");
  process.exit(2);
}
const ctx = browser.contexts()[0] || (await browser.newContext());
const page = await ctx.newPage();
await page.setViewportSize({ width: 1280, height: 720 });

const errs = [];
page.on("pageerror", (e) => errs.push("PAGEERROR " + String(e.message).slice(0, 200)));
page.on("console", (m) => {
  const t = m.text();
  if (/\/ws|HMR|hot-update/i.test(t)) return;
  if (/error|invalid|not compatible|WGSL/i.test(t)) errs.push(t.slice(0, 200));
});

const url = new URL(a.url);
url.searchParams.set("gpu", "webgpu");
url.searchParams.set("seed", "777");
url.searchParams.set("no-intro", "1");
await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__renderBackendResolved != null, null, { timeout: 60_000 });
const backend = await page.evaluate(() => window.__renderBackendResolved);
if (backend !== "webgpu") {
  console.error(`✖ resolved ${backend}, not webgpu.`);
  process.exit(3);
}
await page.waitForFunction(() => typeof window.__dungeonStartRun === "function", null, { timeout: 60_000 });
await page.evaluate(() => window.__dungeonStartRun());
await page.waitForFunction(() => window.__dungeonPlayer?.()?.active === true, null, { timeout: 90_000 });
await page.waitForTimeout(15_000);
await page.waitForFunction(() => typeof window.__fx === "function", null, { timeout: 10_000 });

// One big long-lived fire, the sim paused, and the fx clock FROZEN — so the only
// thing that can differ between the two shots is the warp itself.
const placed = await page.evaluate(() => {
  window.__lab?.clear?.();
  window.__fx.clear();
  window.__fx.spawn("fire", -1.6, 1.6, 2.4, 999);
  window.__fx.pause(true);
  window.__fx.freeze();
  return window.__fx.list();
});
await page.waitForTimeout(2500);
log(`▶ placed: ${JSON.stringify(placed)}`);

mkdirSync(a.out, { recursive: true });

/**
 * Measure only the fire's NEIGHBOURHOOD.
 *
 * A whole-frame diff here is dominated by the torch PointLights, which flicker off
 * `state.elapsed` — and that advances on every rendered frame whether the sim is
 * paused or not, so freezing the fx clock does not still them. Measured at 0.307
 * against a 0.646 signal: real, but only 2x clear, which is not a gate worth
 * having. The shimmer only acts within its own radius, so that is where to look.
 */
const spot = (await page.evaluate(() => window.__fx.screen()))[0];
if (!spot) {
  console.error("✖ the fire did not project to screen — nothing to measure.");
  process.exit(4);
}
const half = Math.max(60, Math.round(spot.px * 1.6));
const CROP = {
  left: Math.max(0, spot.x - half),
  top: Math.max(0, spot.y - half),
  width: Math.min(half * 2, 1280 - Math.max(0, spot.x - half)),
  height: Math.min(half * 2, 720 - Math.max(0, spot.y - half)),
};
log(`▶ measuring a ${CROP.width}x${CROP.height} box at (${CROP.left}, ${CROP.top})`);

const raw = async (buf) =>
  (await sharp(buf).extract(CROP).removeAlpha().raw().toBuffer({ resolveWithObject: true })).data;

await page.evaluate(() => window.__fx.heat(false));
await page.waitForTimeout(400);
const offBuf = await page.screenshot();
writeFileSync(`${a.out}/heat-off.png`, offBuf);

await page.evaluate(() => window.__fx.heat(true));
await page.waitForTimeout(400);
const onBuf = await page.screenshot();
writeFileSync(`${a.out}/heat-on.png`, onBuf);

// And a second OFF shot, as the noise floor: whatever still differs with the
// shimmer disabled is what the measurement cannot attribute to it.
await page.evaluate(() => window.__fx.heat(false));
await page.waitForTimeout(400);
const off2Buf = await page.screenshot();

const [off, on, off2] = [await raw(offBuf), await raw(onBuf), await raw(off2Buf)];
const mad = (A, B) => {
  let s = 0;
  for (let i = 0; i < A.length; i++) s += Math.abs(A[i] - B[i]);
  return s / A.length;
};
const signal = mad(off, on);
const noise = mad(off, off2);
const dropped = await page.evaluate(() => window.__fx.heatDropped());

log("\n═══════════ HEAT SHIMMER A/B ═══════════");
log(`  backend            : ${backend}`);
log(`  OFF → ON  (signal) : ${signal.toFixed(3)}`);
log(`  OFF → OFF (noise)  : ${noise.toFixed(3)}`);
log(`  sources dropped    : ${dropped}`);
log(`  wrote              : ${a.out}/heat-{off,on}.png`);
log("════════════════════════════════════════");
if (errs.length) log("errors:\n  " + [...new Set(errs)].slice(0, 6).join("\n  "));

const fail = [];
if (signal < Number(a.thresh)) fail.push(`toggling the shimmer changed almost nothing (${signal.toFixed(3)} < ${a.thresh}) — it is not reaching the scene taps`);
if (signal < noise * 3) fail.push(`signal ${signal.toFixed(3)} is not clear of the ${noise.toFixed(3)} noise floor`);
if (errs.length) fail.push(`${errs.length} renderer error line(s)`);
if (fail.length) {
  console.error("\n✖ FAILED");
  for (const f of fail) console.error("   • " + f);
  process.exit(1);
}
log("\n✔ The shimmer measurably warps the scene, and only when enabled.");
process.exit(0);
