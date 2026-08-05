#!/usr/bin/env node
/**
 * SPRITE IN THE GAME — the only test that judges generated art honestly.
 *
 * A contact sheet says the frames look right. It cannot say whether the
 * walk READS at 84 texels against a real dungeon floor, whether the
 * silhouette survives the palette lock, or whether the loop pops. So this
 * publishes nothing and proves nothing about files: it launches the real
 * dungeon on the real GPU, spawns ONLY that creature (`__lab.only` — the
 * art-QA pose, three of them, un-aggroed so they idle and walk instead of
 * piling onto the knight), and photographs them moving.
 *
 *   node scripts/sprite-shot.mjs --kind croaker
 *   node scripts/sprite-shot.mjs --kind croaker --shots 6 --every 700
 *   node scripts/sprite-shot.mjs --kind croaker --aggro     # make them walk AT you
 *
 * Writes <out>/<kind>-<n>.png plus <kind>-strip.png, and prints the JSON
 * the /forge panel reads.
 *
 * ── WHY A WINDOWS BROWSER ────────────────────────────────────────────────
 * The game resolves to WebGPU, and WSL2 has no GPU path to it: headless
 * chromium falls back to SwiftShader, which renders a DIFFERENT image and
 * invalidates exactly the judgement this script exists to make. Same CDP
 * handshake `fx-shot.mjs` uses — reuse a live browser if one is already
 * listening, otherwise start one on the Windows side.
 */
import { chromium } from "playwright";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { values: a } = parseArgs({
  options: {
    kind: { type: "string" },
    url: { type: "string", default: "http://localhost:5174/dungeon" },
    "cdp-port": { type: "string", default: process.env.BDB_CDP_PORT ?? "9345" },
    shots: { type: "string", default: "5" },
    /** ms between shots — 600 samples a walk cycle at a readable cadence. */
    every: { type: "string", default: "600" },
    /** Aggroed monsters walk toward the knight: motion, but they crowd. */
    aggro: { type: "boolean", default: false },
    count: { type: "string", default: "3" },
    out: { type: "string", default: ".sprite-shot" },
    headed: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});

if (!a.kind) {
  console.error("--kind is required (a game EnemyKind, e.g. croaker)");
  process.exit(2);
}
const PORT = Number(a["cdp-port"]);
const SHOTS = Math.max(1, Math.min(12, Number(a.shots) || 5));
const EVERY = Math.max(120, Number(a.every) || 600);
const log = (...m) => (a.json ? null : console.log(...m));

const WIN_CHROME = [
  "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
  "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
];

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
      "--user-data-dir=C:\\Temp\\bdb-sprite-shot",
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

const fail = (code, msg) => {
  if (a.json) console.log(JSON.stringify({ ok: false, error: msg }));
  else console.error(`✖ ${msg}`);
  process.exit(code);
};

const browser = await connectHostGpu();
if (!browser) fail(2, "no host browser found — WebGPU is not reachable from WSL2 without one");
const ctx = browser.contexts()[0] || (await browser.newContext());
const page = await ctx.newPage();
await page.setViewportSize({ width: 1280, height: 720 });

// `boot/sheets.ts` announces every adopted sheet as
//   [dungeon] <key>: imported art from N sheet(s)
// which is the ONLY honest answer to "did the published art actually reach
// the renderer, or is a painter still drawing this creature". Collected from
// the console rather than through a bespoke hook, because that line already
// exists and a second source of the same truth would drift.
const importLines = [];
page.on("console", (m) => {
  const t = m.text();
  if (t.includes("imported art from")) importLines.push(t.replace(/^\[dungeon\]\s*/, ""));
});

const url = new URL(a.url);
url.searchParams.set("gpu", "webgpu");
url.searchParams.set("seed", "777");
url.searchParams.set("no-intro", "1");
log(`▶ ${url}`);
await page.goto(url.toString(), { waitUntil: "domcontentloaded" });

try {
  await page.waitForFunction(() => window.__renderBackendResolved != null, null, { timeout: 60_000 });
  const backend = await page.evaluate(() => window.__renderBackendResolved);
  if (backend !== "webgpu") fail(3, `resolved ${backend}, not webgpu — the art would not be judged as shipped`);

  await page.waitForFunction(() => typeof window.__dungeonStartRun === "function", null, { timeout: 60_000 });
  // A saved run resumes on its own floor and the spawn would land somewhere
  // unrelated; a fresh run is the only reproducible stage.
  await page.evaluate(() => window.__dungeonFreshRun?.());
  await page.evaluate(() => window.__dungeonStartRun());
  await page.waitForFunction(() => window.__dungeonPlayer?.()?.active === true, null, { timeout: 90_000 });
  // First visit compiles pipelines; shooting before that catches a half-built
  // frame and blames the art for it.
  await page.waitForTimeout(15_000);
  await page.waitForFunction(() => typeof window.__lab === "function", null, { timeout: 15_000 });

  const placed = await page.evaluate(
    ({ kind, count, aggro }) =>
      aggro ? window.__lab.spawn(kind, count, { aggro: true }) : window.__lab.only(kind, count),
    { kind: a.kind, count: Number(a.count) || 3, aggro: a.aggro },
  );
  if (!placed) fail(4, `the game does not know a monster called "${a.kind}" (see __lab.kinds())`);
  log(`▶ placed: ${JSON.stringify(placed)}`);

  const imported = importLines;
  log(imported.length ? `▶ imported art: ${imported.join(" · ")}` : "▶ no imported-art line — this kind is still drawn by its PAINTER");

  mkdirSync(a.out, { recursive: true });
  await page.waitForTimeout(1200);
  const shots = [];
  for (let i = 0; i < SHOTS; i++) {
    const file = join(a.out, `${a.kind}-${i}.png`);
    await page.screenshot({ path: file });
    shots.push(file);
    if (i < SHOTS - 1) await page.waitForTimeout(EVERY);
  }
  log(`▶ ${shots.length} frame(s) → ${a.out}/`);
  if (a.json) console.log(JSON.stringify({ ok: true, kind: a.kind, shots, placed, imported }));
} finally {
  await page.close().catch(() => {});
  // DISCONNECT, don't kill. `browser.close()` on a connectOverCDP handle
  // tears down this client's contexts and drops the socket; the Windows
  // browser keeps running, so the next run reuses it and skips a ~20s cold
  // start. Skipping this call does NOT leak a browser — it leaks THIS
  // process: the live CDP socket holds node's event loop open forever, and
  // a route that spawns this script would then wait on a process that has
  // already done its work and will never exit.
  await browser.close().catch(() => {});
}
