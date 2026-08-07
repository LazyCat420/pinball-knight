#!/usr/bin/env node
/**
 * DUMP THE WGSL THREE ACTUALLY GENERATES FROM THIS CODEBASE'S TSL.
 *
 * TSL is not an alternative to WGSL — it is a graph that COMPILES to WGSL, and
 * on the WebGPU backend that compiled WGSL is the only thing the GPU ever sees.
 * So "should the dungeon's shaders be hand-written WGSL instead?" is not a
 * question about taste or about the GPU; it is a question about whether the
 * node builder's output is worse than what a person would write. This reads it.
 *
 * Same host-Chrome-over-CDP recipe as `webgpu-check.mjs`, and for the same
 * reason: Playwright's bundled Chromium on WSL2 exposes `navigator.gpu` but
 * `requestAdapter()` returns null, so the app silently lands on the WebGL2
 * backend — where the node builder emits GLSL and the dump would answer a
 * different question entirely. The script refuses to report on a WebGL run.
 *
 *   node scripts/tsl-wgsl-dump.mjs --url http://localhost:5199/dungeon --out /tmp/wgsl
 */
import { chromium } from "playwright";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { values: a } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:5199/dungeon?no-intro=1" },
    out: { type: "string", default: "/tmp/wgsl-dump" },
    "cdp-port": { type: "string", default: process.env.BDB_CDP_PORT ?? "9346" },
    secs: { type: "string", default: "25" },
  },
});

const PORT = Number(a["cdp-port"]);
const WIN_CHROME = [
  "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
  "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
];

const cdpAlive = async (port) => {
  try {
    return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
};

/**
 * True when THIS run started the browser, and therefore owes closing it.
 *
 * ── THIS IS NOT TIDINESS, IT IS THE CPU BROKER ─────────────────────────────
 * `pk-run.sh` grants a webgpu run 4 threads and 2 core-slots by holding flocks
 * on open file descriptors, and releases them when the holding process dies —
 * there are no pid files and no stale sweep. A DETACHED child inherits those
 * descriptors. So a Chrome spawned here and left running keeps the whole grant
 * after the script exits, and the next thing that needs the box waits 300 s and
 * dies with "the box is full, nothing was started" — which is what it did.
 *
 * Reusing an already-open browser must NOT close it: that one belongs to
 * whoever opened it, and may be a person's window.
 */
let weSpawnedIt = false;

async function connectHostGpu() {
  if (await cdpAlive(PORT)) return chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 120_000 });
  const exe = WIN_CHROME.find((p) => existsSync(p));
  if (!exe) return null;
  weSpawnedIt = true;
  const child = spawn(
    exe,
    [
      "--headless=new",
      "--mute-audio",
      `--remote-debugging-port=${PORT}`,
      "--remote-allow-origins=*",
      "--user-data-dir=C:\\Temp\\bdb-wgsl-dump",
      "--no-first-run",
      "--no-default-browser-check",
      "--enable-unsafe-webgpu",
      "--enable-features=Vulkan",
      "about:blank",
    ],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await cdpAlive(PORT)) return chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 120_000 });
  }
  return null;
}

const browser = await connectHostGpu();
if (!browser) {
  console.error("✖ no host Chrome — WebGPU is unreachable from WSL2 without it");
  process.exit(2);
}

/** Every exit path goes through here, including the failures below. */
async function done(code) {
  try {
    if (weSpawnedIt) await browser.close();
  } catch {
    // A browser that has already gone is the outcome we wanted anyway.
  }
  process.exit(code);
}

const ctx = browser.contexts()[0] || (await browser.newContext());
const page = await ctx.newPage();
await page.setViewportSize({ width: 1280, height: 720 });
page.on("pageerror", (e) => console.error("PAGEERROR:", String(e.message).slice(0, 200)));

const url = new URL(a.url);
url.searchParams.set("gpu", "webgpu");
url.searchParams.set("no-intro", "1");
console.log("▶", url.toString());
await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.__dungeonShaders, null, { timeout: Number(a.secs) * 1000 }).catch(() => {});
await page.waitForTimeout(6000);

const backend = await page.evaluate(() => window.__renderBackendResolved ?? "unknown");
console.log("  backend:", backend);
if (!/webgpu/i.test(String(backend))) {
  console.error("✖ not a WebGPU run — the node builder emits GLSL on the WebGL2 backend, so this dump would be off-topic");
  await done(3);
}

const dump = await page.evaluate(async () => {
  if (!window.__dungeonShaders) return { error: "no __dungeonShaders hook" };
  return window.__dungeonShaders();
});

if (!dump || dump.error) {
  console.error("✖", dump?.error ?? "no dump — is a floor loaded?");
  await done(4);
}

mkdirSync(a.out, { recursive: true });
const rows = [];
for (const [name, s] of Object.entries(dump.shaders)) {
  const file = name.replace(/[^a-z0-9]+/gi, "_");
  writeFileSync(join(a.out, `${file}.frag.wgsl`), s.fragmentShader);
  writeFileSync(join(a.out, `${file}.vert.wgsl`), s.vertexShader);
  rows.push({ name, vertexLines: s.vertex, fragmentLines: s.fragment });
}
writeFileSync(join(a.out, "summary.json"), JSON.stringify({ backend, materialsInScene: dump.materialsInScene, rows }, null, 2));
console.table(rows);
console.log(`distinct materials in the scene: ${dump.materialsInScene}`);
console.log(`written to ${a.out}`);
await page.close();
await done(0);
