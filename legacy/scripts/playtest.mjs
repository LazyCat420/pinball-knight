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
 *   pnpm playtest --watch                      WATCH it play in a real window
 *   pnpm playtest --shots                      periodic PNGs to review after
 *   pnpm playtest --sound                      opt IN to audio (off by default)
 *
 * ── AUDIO IS OFF BY DEFAULT ─────────────────────────────────────────────────
 * A harness run boots a real browser, which means real sound out of real
 * speakers — with no window to close and no in-game menu to reach. So every run
 * is muted twice over (Chrome's --mute-audio AND the app's own ?mute=1 gate),
 * and `--sound` is the explicit opt-in for a run you are sitting and watching.
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
import { existsSync, mkdirSync } from "node:fs";

const { values: a } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:5174/dungeon?no-intro=1&autostart=1" },
    mode: { type: "string", default: "mixed" },
    secs: { type: "string", default: "30" },
    profile: { type: "boolean", default: false },
    headed: { type: "boolean", default: false },
    /** Play the game's audio. OFF by default — an automated run that makes
     *  noise out of someone's speakers with no window to close and no menu to
     *  reach is not something a harness should ever do uninvited. */
    sound: { type: "boolean", default: false },
    /** Write periodic PNGs so a run can be reviewed after the fact. */
    shots: { type: "boolean", default: false },
    "shot-every": { type: "string", default: "5" },
    "shot-dir": { type: "string", default: "playtest-shots" },
    /** Watch it play in a real window: headed + slowed to human speed. */
    watch: { type: "boolean", default: false },
    /** Drive the host's real Chrome so timings reflect actual GPU performance. */
    gpu: { type: "boolean", default: false },
    /** Renderer backend to force via ?gpu= — the A/B lever. `auto` leaves the
     *  page to decide. NOTE: WebGPU is unavailable in Playwright's bundled
     *  Chromium (and in WSL generally), so `--backend webgpu` is only
     *  meaningful together with --gpu, which drives the HOST's Chrome. */
    backend: { type: "string", default: "auto" },
    /** Pin the dungeon run seed so two runs build the identical floor. */
    seed: { type: "string" },
    "cdp-port": { type: "string", default: "9333" },
    "max-frame-ms": { type: "string", default: "0" },
    /** Enforce --max-frame-ms even under software rendering (not advised). */
    "force-budget": { type: "boolean", default: false },
  },
});

// --watch is the "let me actually SEE it" switch: open a real window, and use
// the host GPU so it renders at a watchable framerate instead of a SwiftShader
// slideshow. Both are just defaults — an explicit --gpu / --headed still wins.
if (a.watch) {
  a.headed = true;
  if (!a.gpu) a.gpu = true;
}

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
    return chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`, { timeout: 120_000 });
  }
  const exe = WIN_CHROME.find((p) => existsSync(p));
  if (!exe) return null;

  log(`▶ launching host browser for real-GPU timings\n    ${exe}`);
  spawnedHostBrowser = spawn(
    exe,
    [
      a.headed ? "--new-window" : "--headless=new",
      ...(a.sound ? [] : ["--mute-audio"]),
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
      return chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`, { timeout: 120_000 });
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
    // --mute-audio silences the whole browser PROCESS, independent of anything
    // the page does. Belt-and-braces with the app's own ?mute=1 gate: either
    // alone is enough, and together no code path can make noise by accident.
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--no-sandbox",
      ...(a.sound ? [] : ["--mute-audio"]),
    ],
  });
}

const ctx = realGpu
  ? browser.contexts()[0] ?? (await browser.newContext({ viewport: { width: 1280, height: 720 } }))
  : await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
await page.setViewportSize({ width: 1280, height: 720 });

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e.message || e)));
/** Renderer-level console errors. These do NOT throw, so without collecting
 *  them a run can render a totally black screen and still report success —
 *  which is exactly what "Material ShaderMaterial is not compatible" does on
 *  the WebGPU path. Kept separate from pageErrors so the summary can name them. */
const renderErrors = [];
page.on("console", (m) => {
  const t = m.text();
  if (m.type() === "error" && /THREE\.|WebGPU|WebGL|NodeBuilder|shader/i.test(t)) renderErrors.push(t);
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
// ── SILENCE BY DEFAULT ──
// `?playtest=1` puts audio-manager into global-mute at module load, before any
// scene can request a context (a mute applied later has already leaked a sting).
// `--sound` opts back in for a run you are deliberately watching.
{
  const u = new URL(targetUrl, "http://localhost");
  u.searchParams.set("playtest", "1");
  u.searchParams.set("mute", a.sound ? "0" : "1");
  // ?gpu= is read by src/render/backend.ts. Only set it when explicitly asked,
  // so a default run keeps whatever the page would have chosen on its own.
  if (a.backend !== "auto") u.searchParams.set("gpu", a.backend);
  // ?seed= pins the floor. Two runs with the same seed are comparable; without
  // it, a screenshot diff between backends is measuring maze noise.
  if (a.seed !== undefined) u.searchParams.set("seed", a.seed);
  targetUrl = targetUrl.startsWith("http") ? u.toString() : `${u.pathname}${u.search}`;
}
if (realGpu) {
  // Rebuild from targetUrl, NOT a.url — the block above already added playtest,
  // mute, gpu and seed, and re-deriving from a.url would silently drop them.
  const u = new URL(targetUrl, "http://localhost");
  if (u.hostname !== "localhost" && /^(127\.|0\.0\.0\.0|10\.|100\.|172\.|192\.168\.)/.test(u.hostname)) {
    u.hostname = "localhost";
    targetUrl = u.toString();
    log(`▶ rewrote host → localhost for the host browser (WSL2 port forwarding)`);
  }
}
if (a.backend === "webgpu" && !realGpu) {
  // Fail loudly rather than measure a lie: without a host browser this run
  // would silently fall back to WebGL2 and report it as a WebGPU result.
  log(`⚠ --backend webgpu without a real GPU browser: WebGPU is absent from the`);
  log(`  bundled Chromium, so the page will fail or fall back. Use --gpu.`);
}

log(`▶ backend: ${backend}`);
log(`▶ audio: ${a.sound ? "ON (--sound)" : "MUTED"}`);
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
  // Say WHICH stage stalled — "hooks never appeared" is the same message whether
  // the bundle never mounted or the player just never went active, and those
  // have completely different causes.
  const diag = await page.evaluate(() => ({
    bot: typeof window.__dungeonBot,
    player: typeof window.__dungeonPlayer,
    active: window.__dungeonPlayer?.()?.active,
    startRun: typeof window.__dungeonStartRun,
    poolSeed: window.__dungeonPool?.()?.poolSeed ?? null,
    level: window.__dungeonPool?.()?.level ?? null,
  })).catch((e) => ({ evalFailed: String(e).slice(0, 120) }));
  console.error("    diagnostics:", JSON.stringify(diag));
  for (const e of pageErrors.slice(0, 10)) console.error("   ", e);
  await shutdown(2);
}

// ── Run ────────────────────────────────────────────────────────────────────
log(`▶ bot: mode=${a.mode} for ${SECS}s${a.profile ? " (profiling)" : ""}`);
await page.evaluate(
  ([mode, seconds, profile]) => window.__dungeonBot({ mode, seconds, profile }),
  [a.mode, SECS, a.profile],
);

// ── Live progress ──
// A silent poll loop gives a watcher nothing to look at for the whole run, so
// this prints a one-line heartbeat of what the bot is actually doing and (with
// --shots) drops periodic PNGs. Being able to SEE the run is the difference
// between "it passed" and knowing what it did.
const SHOT_DIR = a["shot-dir"];
let shotN = 0;
if (a.shots) {
  mkdirSync(SHOT_DIR, { recursive: true });
  log(`▶ screenshots → ${SHOT_DIR}/`);
}

const deadline = Date.now() + SECS * 1000 + 20_000;
const startedAt = Date.now();
let lastShot = 0;
while (Date.now() < deadline) {
  await page.waitForTimeout(1000);
  const still = await page
    .evaluate(() => !!window.__dungeonBotIsRunning?.())
    .catch(() => false);

  const el = Math.round((Date.now() - startedAt) / 1000);
  const p = await page.evaluate(() => {
    const pl = window.__dungeonPlayer?.();
    const pool = window.__dungeonPool?.();
    return pl ? { hp: pl.hp, kills: pl.kills, combo: pl.bounceCombo, lvl: pool?.level, peers: pool?.sameFloor } : null;
  }).catch(() => null);
  if (p) {
    log(
      `   ${String(el).padStart(3)}s  floor ${p.lvl ?? "?"}  hp ${p.hp}  ` +
        `kills ${p.kills}  combo ${p.combo ?? 0}${p.peers ? `  peers ${p.peers}` : ""}`,
    );
  }

  if (a.shots && Date.now() - lastShot >= Number(a["shot-every"]) * 1000) {
    lastShot = Date.now();
    const f = `${SHOT_DIR}/shot-${String(++shotN).padStart(3, "0")}-${el}s.png`;
    await page.screenshot({ path: f }).catch(() => {});
  }

  if (!still) break;
}

// A final frame is worth more than any of the periodic ones — it shows the
// state the run ENDED in, which is what you want when something went wrong.
if (a.shots) {
  await page.screenshot({ path: `${SHOT_DIR}/final.png` }).catch(() => {});
  log(`▶ final frame → ${SHOT_DIR}/final.png`);
}

const report = await page.evaluate(() => window.__dungeonBotStop()).catch(() => null);

// ── IS ANYTHING ACTUALLY ON SCREEN? ────────────────────────────────────────
// The bot drives game STATE, which keeps ticking happily while the renderer
// draws nothing — a broken shader shows up as a totally black canvas and an
// otherwise perfect run. Sample the real canvas and count distinct colours:
// a live frame has hundreds, a dead one has exactly 1.
const canvasCheck = await page
  .evaluate(async () => {
    // WHICH canvas: the page has ~9 (HUD portraits, minimap, dice…) AND TWO at
    // the full render size — the room/background scene under <main>, and the
    // dungeon's own inside its overlay container. Picking "the biggest" grabs
    // the room and reports a healthy 1200+ colours no matter what the dungeon
    // does, which silently turns this whole check into a no-op.
    //
    // The dungeon renderer appends its canvas to the fixed, z-indexed overlay
    // that launchDungeonGame builds (state.container, z-index 10000), so match
    // on that: the deepest full-size canvas whose ancestor is positioned fixed.
    const all = [...document.querySelectorAll("canvas")];
    if (!all.length) return { ok: false, reason: "no canvas element" };
    const big = all.filter((x) => x.width * x.height >= 640 * 360);
    const overlay = big.filter((x) => {
      for (let el = x.parentElement; el; el = el.parentElement) {
        if (getComputedStyle(el).position === "fixed") return true;
      }
      return false;
    });
    // Prefer the overlay (dungeon) canvas; fall back to the largest one so this
    // still works for scenes that render straight into the page.
    const c = (overlay.length ? overlay : big.length ? big : all).reduce((a, b) =>
      b.width * b.height > a.width * a.height ? b : a,
    );

    // WHEN to sample: the drawing buffer is NOT preserved (preserveDrawingBuffer
    // defaults to false), so it is cleared once the frame is composited. Reading
    // it from an ordinary task therefore returns a blank buffer even when the
    // game is drawing perfectly. Sampling INSIDE a rAF callback catches the
    // frame while it is still intact.
    const snap = await new Promise((resolve) => {
      requestAnimationFrame(async () => {
        try {
          const bmp = await createImageBitmap(c);
          const cv = new OffscreenCanvas(bmp.width, bmp.height);
          const cx = cv.getContext("2d");
          cx.drawImage(bmp, 0, 0);
          resolve(cx.getImageData(0, 0, bmp.width, bmp.height).data);
        } catch (e) {
          resolve(null);
        }
      });
    });
    if (!snap) return { ok: false, reason: "could not read the canvas" };

    const seen = new Set();
    for (let i = 0; i < snap.length; i += 4) seen.add((snap[i] >> 4) << 8 | (snap[i + 1] >> 4) << 4 | (snap[i + 2] >> 4));
    return { ok: seen.size > 1, distinct: seen.size, w: c.width, h: c.height };
  })
  .catch((e) => ({ ok: false, reason: String(e).slice(0, 120) }));

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
log(`render errors:${renderErrors.length}`);
log(
  `canvas:       ${canvasCheck.ok ? `painting (${canvasCheck.distinct} distinct colours)` : `BLANK — ${canvasCheck.reason ?? "1 colour, nothing rendered"}`}`,
);

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
if (!canvasCheck.ok) {
  failed = true;
  console.error(`\n✗ NOTHING RENDERED — the canvas is a single flat colour (${canvasCheck.reason ?? "1 distinct colour"}).`);
  console.error("   Game state ticked fine, so this is a RENDERER fault, not a gameplay one.");
}
if (renderErrors.length) {
  failed = true;
  console.error("\n✗ RENDERER errors (these never throw, so they cannot fail a run on their own):");
  for (const e of [...new Set(renderErrors)].slice(0, 10)) console.error("   ", e);
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
