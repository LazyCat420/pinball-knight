#!/usr/bin/env node
/**
 * WEBGPU ENFORCER — run the app on the real GPU and prove which backend it got.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * `WebGPURenderer` is not "the WebGPU renderer": it has two backends, and when
 * WebGPU is unavailable three.js prints one warning and silently continues on
 * WebGL2. That warning is easy to miss and nothing else in the app changes, so
 * a machine with a perfectly good GPU can spend months quietly rendering
 * through the fallback while everyone assumes otherwise. It already happened
 * here — a headless profiling run reported `getProgramParameter` (a WebGL call)
 * as its top cost, which is only possible on the fallback path.
 *
 * The trap on WSL2 specifically: Playwright's bundled Chromium exposes
 * `navigator.gpu`, so `hasWebGPU()` returns TRUE, but `requestAdapter()`
 * resolves to NULL. The app therefore asks for WebGPU, gets refused, and drops
 * to WebGL2 — while every availability check said yes. Checking for
 * `navigator.gpu` is not a WebGPU check; only an adapter is.
 *
 * So this script drives the HOST's Chrome over CDP (same recipe as
 * playtest.mjs --gpu), which is the only way to reach a real adapter from WSL2,
 * and reports the backend the renderer ACTUALLY resolved rather than the one it
 * requested.
 *
 * ── USAGE ───────────────────────────────────────────────────────────────────
 *
 *   node scripts/webgpu-check.mjs                    # default URL, force WebGPU
 *   node scripts/webgpu-check.mjs --url http://localhost:5199/dungeon
 *   node scripts/webgpu-check.mjs --headed           # watch it run
 *   node scripts/webgpu-check.mjs --allow-webgl      # report only, never fail
 *
 * EXIT CODE IS THE CONTRACT: 0 only when the page rendered through WebGPU.
 * Anything else — WebGL2 fallback, no adapter, no host browser — exits non-zero
 * so this can gate a deploy instead of merely printing at one.
 */
import { chromium } from "playwright";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const { values: a } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:5174/dungeon?no-intro=1" },
    "cdp-port": { type: "string", default: process.env.BDB_CDP_PORT ?? "9345" },
    secs: { type: "string", default: "12" },
    headed: { type: "boolean", default: false },
    /** Report the backend but exit 0 even on WebGL — for local poking. */
    "allow-webgl": { type: "boolean", default: false },
    /** Skip the host browser and use bundled Chromium. Documents the failure
     *  mode rather than hiding it: this WILL fall back on WSL2. */
    "no-host": { type: "boolean", default: false },
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

let spawned = null;

/**
 * Launch (or reuse) the host's Chrome with the debugging port open.
 *
 * `--user-data-dir` is a dedicated profile on purpose: Chrome refuses the
 * debugging port on a profile that is already open in the user's everyday
 * session, and the failure looks like a timeout rather than a conflict.
 */
async function connectHostGpu() {
  if (await cdpAlive(PORT)) {
    log(`▶ reusing CDP browser on :${PORT}`);
    return chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 120_000 });
  }
  const exe = WIN_CHROME.find((p) => existsSync(p));
  if (!exe) return null;

  log(`▶ launching host browser\n    ${exe}`);
  spawned = spawn(
    exe,
    [
      a.headed ? "--new-window" : "--headless=new",
      "--mute-audio",
      `--remote-debugging-port=${PORT}`,
      "--remote-allow-origins=*",
      "--user-data-dir=C:\\Temp\\bdb-webgpu-check",
      "--no-first-run",
      "--no-default-browser-check",
      // Ask for WebGPU explicitly. Harmless where it is already on; the point
      // is that a run which still lands on WebGL cannot blame a missing flag.
      "--enable-unsafe-webgpu",
      "--enable-features=Vulkan",
      "about:blank",
    ],
    { detached: true, stdio: "ignore" },
  );
  spawned.unref();

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await cdpAlive(PORT)) return chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 120_000 });
  }
  return null;
}

/** `?gpu=webgpu` makes the app force the backend instead of auto-selecting. */
function forceWebgpuUrl(raw) {
  const u = new URL(raw);
  u.searchParams.set("gpu", "webgpu");
  return u.toString();
}

const browser = a["no-host"] ? await chromium.launch({ args: ["--enable-unsafe-swiftshader"] }) : await connectHostGpu();

if (!browser) {
  console.error("\n✖ No host browser found and --no-host was not passed.");
  console.error("  WebGPU cannot be verified from WSL2 without the host's Chrome.");
  console.error(`  Looked in:\n    ${WIN_CHROME.join("\n    ")}`);
  process.exit(2);
}

const ctx = browser.contexts()[0] || (await browser.newContext());
const page = await ctx.newPage();
await page.setViewportSize({ width: 1440, height: 900 });

/** Everything three.js or the app says about the backend. */
const backendLines = [];
page.on("console", (m) => {
  const t = m.text();
  if (/\[backend\]|WebGPU|WebGL2 backend|WebGPUBackend|WebGLBackend/i.test(t)) backendLines.push(t.slice(0, 160));
});
page.on("pageerror", (e) => backendLines.push("PAGEERROR: " + e.message.slice(0, 160)));

const url = forceWebgpuUrl(a.url);
log(`▶ ${url}`);
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(Number(a.secs) * 1000);

/**
 * Ask the PAGE what it is running on.
 *
 * The renderer's own `backend` object is the authority — `navigator.gpu` only
 * says the browser has an entry point, and an adapter only says one could have
 * been acquired. Neither tells you what three.js settled on. `isWebGPUBackend`
 * is the flag three.js sets on the resolved backend itself.
 */
const verdict = await page.evaluate(async () => {
  const out = { hasGpuEntry: !!navigator.gpu, adapter: null, backend: null, how: null, requested: window.__renderBackend ?? null };
  try {
    const ad = await navigator.gpu?.requestAdapter();
    out.adapter = ad ? (ad.info ? `${ad.info.vendor}/${ad.info.architecture}` : "adapter (no info)") : "NULL — refused";
  } catch (e) {
    out.adapter = "error: " + String(e.message || e).slice(0, 60);
  }
  // THE AUTHORITY is what the app publishes after `renderer.init()` resolves
  // (see reportResolvedBackend in src/render/backend.ts). The renderer itself
  // is a local inside initApp — not a window global — so scanning for it finds
  // nothing and reports a false "unknown". Ask the app instead.
  if (window.__renderBackendResolved) {
    out.backend = window.__renderBackendResolved;
    out.how = "window.__renderBackendResolved";
    return out;
  }

  // Fallback for a build that predates that global: scan for the renderer.
  const looksLikeRenderer = (v) => v && typeof v === "object" && typeof v.render === "function" && "backend" in v;
  for (const k of Object.keys(window)) {
    let v;
    try { v = window[k]; } catch { continue; }
    if (looksLikeRenderer(v)) {
      const b = v.backend;
      out.backend = b?.isWebGPUBackend ? "webgpu" : b?.isWebGLBackend ? "webgl" : (b?.constructor?.name ?? "unknown");
      out.how = `window.${k}.backend`;
      break;
    }
  }
  return out;
});

// Last-resort read of the console, for a build without the resolved global.
// Order matters: a WebGL2 fallback warning beats a success line, because the
// warning is the thing that would be there when both somehow appear.
const fromLogs = backendLines.some((l) => /running under WebGL2 backend/i.test(l))
  ? "webgl"
  : backendLines.some((l) => /resolved WEBGPU/i.test(l))
    ? "webgpu"
    : null;
const backend = verdict.backend ?? fromLogs ?? "unknown";

log("");
log("═══════════════ BACKEND REPORT ═══════════════");
log(`  navigator.gpu present : ${verdict.hasGpuEntry ? "yes" : "NO"}`);
log(`  adapter               : ${verdict.adapter}`);
// SELECTED vs RESOLVED is the entire point of this report. The app writes
// __renderBackend when it CHOOSES; three.js may then refuse and fall back. A
// run that selected webgpu and resolved webgl is precisely the silent failure.
log(`  app selected          : ${(verdict.requested ?? "?").toUpperCase()}`);
log(`  RENDERER RESOLVED     : ${backend.toUpperCase()}${verdict.how ? `   (${verdict.how})` : fromLogs ? "   (from three.js warning)" : ""}`);
if (verdict.requested === "webgpu" && backend === "webgl") {
  log("  ⚠ SELECTED WEBGPU BUT RESOLVED WEBGL — the silent fallback fired.");
}
log("══════════════════════════════════════════════");
if (backendLines.length) {
  log("\nconsole:");
  for (const l of [...new Set(backendLines)]) log("   " + l);
}

if (spawned) {
  await page.close().catch(() => {});
  await browser.close().catch(() => {});
} else {
  await page.close().catch(() => {});
}

if (backend === "webgpu") {
  log("\n✔ WebGPU confirmed.");
  process.exit(0);
}

log(`\n✖ NOT running on WebGPU — resolved backend: ${backend}.`);
if (verdict.adapter === "NULL — refused") {
  log("  requestAdapter() returned null: this browser exposes navigator.gpu but");
  log("  has no usable adapter. That is the WSL2/bundled-Chromium trap — run");
  log("  against the HOST browser (the default here), not bundled Chromium.");
}
process.exit(a["allow-webgl"] ? 0 : 1);
