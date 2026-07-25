#!/usr/bin/env node
/**
 * Headless playtest runner — boots the game in a real browser, turns the bot
 * loose, and prints what happened. This is the piece that lets a soak test run
 * unattended (in CI, or while you do something else) instead of needing someone
 * to hold a controller.
 *
 *   pnpm playtest                              30s mixed run, bundled Chromium
 *   pnpm playtest --mode bounce --secs 120 --profile
 *   pnpm playtest:gpu --profile                REAL GPU timings (see below)
 *   pnpm playtest --max-frame-ms 20            fail if p95 frame exceeds 20ms
 *
 * EXIT CODE is the point for CI: non-zero when the bot got stuck, the game threw,
 * or the frame budget was missed. A green run means the game survived N seconds
 * of continuous adversarial input without wedging.
 *
 * ── TWO RENDERING BACKENDS ──────────────────────────────────────────────────
 *
 * DEFAULT (`--gpu` off): Playwright's bundled Chromium with SwiftShader, a
 * SOFTWARE rasterizer. Correctness, stuck-detection and crash-hunting are fully
 * valid here; absolute frame times are not. Use it in CI.
 *
 * REAL GPU (`--gpu`): drives the HOST's Chrome over CDP, so frames render on the
 * actual graphics card and the profiler numbers are real. On WSL2 this launches
 * Windows Chrome and connects back through the loopback port. Use it whenever
 * you care about ms.
 *
 * The runner LABELS which backend produced a run and refuses to enforce
 * --max-frame-ms against software rendering unless you pass --force-budget,
 * because a SwiftShader p95 would fail a budget no real player would miss.
 */
import { chromium } from "playwright";
import { parseArgs } from "node:util";
import { spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";

const { values: a } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:5174/dungeon?no-intro=1&autostart=1" },
    mode: { type: "string", default: "mixed" },
    secs: { type: "string", default: "30" },
    profile: { type: "boolean", default: false },
    headed: { type: "boolean", default: false },
    /** Drive the host's real Chrome so timings reflect actual GPU performance. */
    gpu: { type: "boolean", default: false },
    "cdp-port": { type: "string", default: "9333" },
    "max-frame-ms": { type: "string", default: "0" },
    /** Enforce --max-frame-ms even under software rendering (not advised). */
    "force-budget": { type: "boolean", default: false },
  },
});

const SECS = Number(a.secs);
const MAX_FRAME_MS = Number(a["max-frame-ms"]);
const CDP_PORT = Number(a["cdp-port"]);
const log = (...m) => console.log(...m);

/** Windows Chrome locations, as seen from WSL2. */
const WIN_CHROME = [
  "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
  "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
];

/** True when a CDP endpoint is already answering on the port. */
async function cdpAlive(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(1500),
    });
    return r.ok;
  } catch {
    return false;
  }
}

let spawnedHostBrowser = null;

/**
 * Launch (or reuse) a real-GPU browser and connect over CDP. Falls back to the
 * bundled Chromium — loudly — if no host browser can be found, so a --gpu run
 * on a machine without one still produces results instead of dying.
 */
async function connectRealGpu() {
  if (await cdpAlive(CDP_PORT)) {
    log(`▶ reusing existing CDP browser on :${CDP_PORT}`);
    return chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  }
  const exe = WIN_CHROME.find((p) => existsSync(p));
  if (!exe) return null;

  log(`▶ launching host browser for real-GPU timings\n    ${exe}`);
  spawnedHostBrowser = spawn(
    exe,
    [
      a.headed ? "--new-window" : "--headless=new",
      `--remote-debugging-port=${CDP_PORT}`,
      "--remote-allow-origins=*",
      // A dedicated profile dir keeps this from colliding with the user's
      // everyday Chrome session (which would refuse the debugging port).
      "--user-data-dir=C:\\Temp\\bdb-playtest",
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { detached: true, stdio: "ignore" },
  );
  spawnedHostBrowser.unref();

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await cdpAlive(CDP_PORT)) {
      return chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
    }
  }
  return null;
}

function closeHostBrowser() {
  if (!spawnedHostBrowser) return;
  try {
    // The detached Windows process is not ours to signal from WSL; ask Windows.
    execSync(
      `powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"CommandLine LIKE '%bdb-playtest%'\\" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`,
      { stdio: "ignore", timeout: 20_000 },
    );
  } catch {
    /* best effort — a stray headless browser is not worth failing the run */
  }
}

// ── Connect ────────────────────────────────────────────────────────────────
let browser = null;
let backend = "software (SwiftShader)";
let realGpu = false;

if (a.gpu) {
  browser = await connectRealGpu();
  if (browser) {
    backend = "REAL GPU (host browser via CDP)";
    realGpu = true;
  } else {
    console.warn("⚠ no host browser found for --gpu; falling back to software rendering");
  }
}
if (!browser) {
  browser = await chromium.launch({
    headless: !a.headed,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });
}

const ctx = realGpu
  ? browser.contexts()[0] ?? (await browser.newContext({ viewport: { width: 1280, height: 720 } }))
  : await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
await page.setViewportSize({ width: 1280, height: 720 });

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e.message || e)));
page.on("console", (m) => {
  const t = m.text();
  if (/^\[bot\]|^\[profiler\]/.test(t) || m.type() === "error") log("  ⟩", t);
});

async function shutdown(code) {
  try {
    await page.close();
  } catch { /* page may already be gone */ }
  try {
    // Disconnect from a reused browser; only close one we own.
    realGpu ? await browser.close() : await browser.close();
  } catch { /* ignore */ }
  closeHostBrowser();
  process.exit(code);
}

// ── Boot ───────────────────────────────────────────────────────────────────
// WSL2 + host browser: Windows forwards its own localhost into WSL, but it
// cannot reach the WSL subnet IP (the default firewall drops it). So when we are
// driving the HOST browser at a WSL-local address, rewrite the host to localhost
// — that is the path Windows actually routes.
let targetUrl = a.url;
if (realGpu) {
  const u = new URL(a.url);
  if (u.hostname !== "localhost" && /^(127\.|0\.0\.0\.0|10\.|100\.|172\.|192\.168\.)/.test(u.hostname)) {
    u.hostname = "localhost";
    targetUrl = u.toString();
    log(`▶ rewrote host → localhost for the host browser (WSL2 port forwarding)`);
  }
}

log(`▶ backend: ${backend}`);
log(`▶ opening ${targetUrl}`);
try {
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
} catch (e) {
  console.error(`✗ could not reach ${targetUrl} — is the dev server running? (pnpm dev)\n  ${e.message}`);
  await shutdown(2);
}

// Report what actually rendered, so a "fast" run can never be silently software.
const glInfo = await page.evaluate(() => {
  const c = document.createElement("canvas");
  const g = c.getContext("webgl2") || c.getContext("webgl");
  if (!g) return "no webgl";
  const dbg = g.getExtension("WEBGL_debug_renderer_info");
  return dbg ? String(g.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "unknown renderer";
}).catch(() => "unknown");
log(`▶ renderer: ${glInfo}`);
const looksSoftware = /swiftshader|llvmpipe|software/i.test(glInfo);

log("▶ waiting for the dungeon to boot…");
// The hooks install when the scene mounts; the PLAYER only exists once a run
// has begun. `?autostart=1` drops straight into floor 1, but fall back to the
// explicit starter if a caller pointed us at a plain URL.
try {
  await page.waitForFunction(
    () => typeof window.__dungeonBot === "function" && typeof window.__dungeonPlayer === "function",
    { timeout: 120_000 },
  );
  // Now wait for an ACTIVE player. Without this the bot starts against the
  // lobby and immediately self-stops with "player inactive".
  await page.waitForFunction(() => window.__dungeonPlayer()?.active === true, { timeout: 60_000 })
    .catch(async () => {
      log("▶ still in the lobby — starting the run explicitly");
      await page.evaluate(() => window.__dungeonStartRun?.());
      await page.waitForFunction(() => window.__dungeonPlayer()?.active === true, { timeout: 60_000 });
    });
} catch {
  console.error(
    "✗ dungeon hooks never appeared. The game may not have reached the dungeon " +
      "scene (title screen? intro?), or it failed to start.",
  );
  for (const e of pageErrors.slice(0, 10)) console.error("   ", e);
  await shutdown(2);
}

// ── Run ────────────────────────────────────────────────────────────────────
log(`▶ bot: mode=${a.mode} for ${SECS}s${a.profile ? " (profiling)" : ""}`);
await page.evaluate(
  ([mode, seconds, profile]) => window.__dungeonBot({ mode, seconds, profile }),
  [a.mode, SECS, a.profile],
);

const deadline = Date.now() + SECS * 1000 + 20_000;
while (Date.now() < deadline) {
  await page.waitForTimeout(1000);
  const still = await page
    .evaluate(() => !!window.__dungeonBotIsRunning?.())
    .catch(() => false);
  if (!still) break;
}

const report = await page.evaluate(() => window.__dungeonBotStop()).catch(() => null);

// ── Verdict ────────────────────────────────────────────────────────────────
log("\n── playtest result ─────────────────────────────");
if (!report || typeof report === "string") {
  console.error("✗ no report — the bot did not complete cleanly.");
  await shutdown(1);
}

log(`backend:      ${backend}`);
log(`mode:         ${report.mode}`);
log(`ran:          ${report.ranSeconds}s (${report.decisions} decisions)`);
log(`peak combo:   ${report.peakCombo}`);
log(`kills:        ${report.kills}`);
log(`deaths:       ${report.deaths}`);
log(`stuck events: ${report.stuckEvents.length}`);
log(`errors:       ${report.errors.length + pageErrors.length}`);

if (a.profile && report.profile?.length) {
  log("\n── frame profile (heaviest first) ──");
  console.table(report.profile);
  log(`p95 frame: ${report.p95FrameMs}ms  (16.67ms = 60fps)`);
  if (looksSoftware) {
    log("NOTE: software rendering — compare stages against each other, not against 16.67ms.");
  }
}

let failed = false;
if (report.stuckEvents.length) {
  failed = true;
  console.error("\n✗ STUCK — the player stopped moving while input was held:");
  for (const s of report.stuckEvents) console.error(`   t=${s.atSeconds}s at (${s.x}, ${s.z})`);
}
const allErrors = [...report.errors, ...pageErrors];
if (allErrors.length) {
  failed = true;
  console.error("\n✗ ERRORS thrown while playing:");
  for (const e of allErrors.slice(0, 20)) console.error("   ", e);
}
if (MAX_FRAME_MS > 0) {
  if (looksSoftware && !a["force-budget"]) {
    log(`\n⊘ --max-frame-ms skipped under software rendering (use --gpu, or --force-budget to insist).`);
  } else if (!report.p95FrameMs) {
    log(`\n⊘ --max-frame-ms needs --profile to measure anything.`);
  } else if (report.p95FrameMs > MAX_FRAME_MS) {
    failed = true;
    console.error(`\n✗ p95 frame ${report.p95FrameMs}ms exceeds --max-frame-ms ${MAX_FRAME_MS}ms`);
  } else {
    log(`\n✓ p95 frame ${report.p95FrameMs}ms within budget ${MAX_FRAME_MS}ms`);
  }
}

log(failed ? "\n✗ FAILED" : "\n✓ PASSED — survived the run with no stuck episodes or errors");
await shutdown(failed ? 1 : 0);
