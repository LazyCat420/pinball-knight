#!/usr/bin/env node
/**
 * FX CONTACT SHEET — a full-frame look at the elemental decals, on a real GPU.
 *
 * `fx-motion.mjs` proves the effects MOVE. It cannot tell you whether they look
 * right, because it deliberately measures a tiny magnified crop with the sim
 * paused. Judging art from that crop is misleading in both directions: a 2.3x
 * blow-up exaggerates every stray pixel, and a tight box hides how the effect
 * sits against the floor around it.
 *
 * So this is the companion: one seeded floor, `__fx.grid()` or `__fx.pair()`, and
 * a FULL FRAME at the real presented resolution — which is the only size at
 * which the pixel pass's dither and palette snap look the way a player sees them.
 *
 *   node scripts/fx-shot.mjs                       # every kind, contact sheet
 *   node scripts/fx-shot.mjs --pair fire,slick     # two, side by side
 *   node scripts/fx-shot.mjs --kind fire --zoom 3  # one, with a magnified inset
 */
import { chromium } from "playwright";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import sharp from "sharp";

const { values: a } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:5199/dungeon" },
    "cdp-port": { type: "string", default: process.env.BDB_CDP_PORT ?? "9345" },
    /** Comma-separated pair, e.g. "fire,slick". */
    pair: { type: "string" },
    /** A single kind, centred. */
    kind: { type: "string" },
    /** Magnified inset factor for --kind. */
    zoom: { type: "string", default: "0" },
    out: { type: "string", default: ".fx-motion" },
    tag: { type: "string", default: "sheet" },
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
  if (await cdpAlive(PORT)) {
    log(`▶ reusing CDP browser on :${PORT}`);
    return chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 120_000 });
  }
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
  console.error("✖ No host browser found — WebGPU is not reachable from WSL2 without it.");
  process.exit(2);
}
const ctx = browser.contexts()[0] || (await browser.newContext());
const page = await ctx.newPage();
await page.setViewportSize({ width: 1280, height: 720 });

const url = new URL(a.url);
url.searchParams.set("gpu", "webgpu");
url.searchParams.set("seed", "777"); // pins maze AND biome — unseeded is not comparable
url.searchParams.set("no-intro", "1");
log(`▶ ${url}`);
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
await page.waitForTimeout(15_000); // first-visit pipeline compile
await page.waitForFunction(() => typeof window.__fx === "function", null, { timeout: 10_000 });

const placed = await page.evaluate(
  ({ pair, kind }) => {
    window.__lab?.clear?.();
    window.__fx.clear();
    if (pair) return window.__fx.pair(pair[0], pair[1], 3.2);
    if (kind) return window.__fx.spawn(kind, 0, 2.4, 1.5, 999);
    return window.__fx.grid(3.2);
  },
  { pair: a.pair ? a.pair.split(",") : null, kind: a.kind ?? null },
);
log(`▶ placed: ${JSON.stringify(placed)}`);
// Let the grow-in pop settle so the sheet shows the steady-state look.
await page.waitForTimeout(2000);

mkdirSync(a.out, { recursive: true });
const full = `${a.out}/${a.tag}-full.png`;
await page.screenshot({ path: full });
log(`▶ wrote ${full}`);

if (a.kind && Number(a.zoom) > 0) {
  const spot = (await page.evaluate(() => window.__fx.screen()))[0];
  if (spot) {
    const half = Math.max(40, Math.round(spot.px * 1.2));
    const buf = await page.screenshot({
      clip: {
        x: Math.max(0, spot.x - half),
        y: Math.max(0, spot.y - half),
        width: half * 2,
        height: half * 2,
      },
    });
    const z = Number(a.zoom);
    const inset = `${a.out}/${a.tag}-inset.png`;
    // NEAREST on purpose: any smoothing here would invent colours that are not
    // in the palette and misrepresent what the pass actually presented.
    await sharp(buf).resize(half * 2 * z, half * 2 * z, { kernel: "nearest" }).toFile(inset);
    log(`▶ wrote ${inset} (${z}x nearest)`);
  }
}

log(`\n✔ backend ${backend}`);
process.exit(0);
