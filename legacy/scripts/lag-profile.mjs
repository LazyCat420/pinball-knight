#!/usr/bin/env node
/**
 * LAG PROFILER — answers "what costs 600ms on the frames that hitch?" by
 * attribution rather than by guesswork.
 *
 *   node scripts/lag-profile.mjs --secs 45 --seed 42 --url http://localhost:5174/dungeon
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * The lag investigation (docs/lag-investigation.md) had reached the point where
 * every remaining theory was a *suspect list*: texture upload, first pipeline
 * use, GC. Testing a ranked list one probe at a time costs a session per entry
 * and two of the first three were already wrong. This measures all of them at
 * once and names the winner, because a V8 sampling profile over the run already
 * contains the answer — it just has to be sliced to the frames that hitched.
 *
 * ── HOW IT WORKS ────────────────────────────────────────────────────────────
 *
 * 1. `scripts/lib/lag-probe.mjs` is injected before app code and records the
 *    rAF frame timeline, WebGPU calls (with three's labels), long tasks.
 * 2. CDP `Profiler` samples the main thread every --interval µs for the run.
 * 3. The two clocks are pinned together by a burn-loop marker run at both ends
 *    (see alignByMarker) — no assumption about the profiler's epoch.
 * 4. Frames slower than --hitch-ms define windows. Profile samples inside those
 *    windows are aggregated by function, self and total, and printed against
 *    the same aggregation over the healthy frames.
 *
 * The output is a diff, not a leaderboard: the top of a whole-run profile is
 * always the steady-state render, which is not the bug. What matters is what is
 * *over-represented* in the tail.
 *
 * ── READING IT ──────────────────────────────────────────────────────────────
 *
 * If the hitch windows are dominated by:
 *   a named app/three function ..... that function is the cost; go fix it
 *   `(garbage collector)` .......... allocation churn; suspect #3 on the list
 *   `(program)` / `(idle)` ......... NOT JavaScript. The time is in the browser
 *                                    or GPU process — escalate to a Tracing
 *                                    capture, a JS profile cannot see it.
 */
import { parseArgs } from "node:util";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "playwright";
import { connectRealGpu, closeHostBrowser, rewriteForHostBrowser } from "./lib/host-chrome.mjs";
import { installLagProbe } from "./lib/lag-probe.mjs";

const { values: a } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:5174/dungeon?no-intro=1&autostart=1" },
    mode: { type: "string", default: "mixed" },
    secs: { type: "string", default: "45" },
    seed: { type: "string", default: "42" },
    /** V8 sampling interval in µs. 250µs ≈ 4000 samples/s; a 600ms hitch gets
     *  ~2400 samples, which is far more than enough to rank its contents. */
    interval: { type: "string", default: "250" },
    /** A frame slower than this defines a hitch window. */
    "hitch-ms": { type: "string", default: "33" },
    top: { type: "string", default: "22" },
    out: { type: "string", default: "" },
    "cdp-port": { type: "string", default: "9333" },
    headed: { type: "boolean", default: false },
    /** Allow the run on software rendering. Off: SwiftShader answers a
     *  different question and every number would be a lie. */
    "allow-software": { type: "boolean", default: false },
  },
});

const SECS = Number(a.secs);
const HITCH = Number(a["hitch-ms"]);
const TOP = Number(a.top);
const log = (...m) => console.log(...m);

// ── Connect ────────────────────────────────────────────────────────────────
const browser = await connectRealGpu({ port: Number(a["cdp-port"]), headed: a.headed, log });
if (!browser) {
  console.error("✗ no host browser found. This tool measures milliseconds, and milliseconds");
  console.error("  measured on SwiftShader describe a CPU pretending to be a GPU. Install");
  console.error("  Chrome on the Windows side, or run with --allow-software to insist.");
  if (!a["allow-software"]) process.exit(2);
}
const ctx = browser.contexts()[0] ?? (await browser.newContext({ viewport: { width: 1280, height: 720 } }));
const page = await ctx.newPage();
await page.setViewportSize({ width: 1280, height: 720 });
await page.addInitScript(installLagProbe);

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e.message || e)));

async function shutdown(code) {
  await page.close().catch(() => {});
  await browser.close().catch(() => {});
  closeHostBrowser();
  process.exit(code);
}

// ── Boot ───────────────────────────────────────────────────────────────────
let targetUrl;
{
  const u = new URL(a.url, "http://localhost");
  u.searchParams.set("playtest", "1");
  u.searchParams.set("mute", "1");
  u.searchParams.set("seed", a.seed);
  targetUrl = rewriteForHostBrowser(u.toString(), log);
}
log(`▶ opening ${targetUrl}`);
await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(async (e) => {
  console.error(`✗ could not reach ${targetUrl} — is the dev server running?\n  ${e.message}`);
  await shutdown(2);
});

const glInfo = await page
  .evaluate(() => {
    const c = document.createElement("canvas");
    const g = c.getContext("webgl2") || c.getContext("webgl");
    const dbg = g?.getExtension("WEBGL_debug_renderer_info");
    return dbg ? String(g.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "unknown renderer";
  })
  .catch(() => "unknown");
log(`▶ renderer: ${glInfo}`);
if (/swiftshader|llvmpipe|software/i.test(glInfo) && !a["allow-software"]) {
  console.error("✗ software rasteriser — refusing to produce numbers nobody should quote.");
  await shutdown(2);
}

// NB the `null` second argument is load-bearing: Playwright's signature is
// waitForFunction(fn, ARG, OPTIONS), and putting the options object in the
// second slot silently leaves the timeout at 30s. See scripts/playtest.mjs.
log("▶ waiting for the dungeon to boot…");
try {
  await page.waitForFunction(
    () => typeof window.__dungeonBot === "function" && typeof window.__dungeonPlayer === "function",
    null,
    { timeout: 120_000 },
  );
  await page
    .waitForFunction(() => window.__dungeonPlayer()?.active === true, null, { timeout: 60_000 })
    .catch(async () => {
      await page.evaluate(() => window.__dungeonStartRun?.());
      await page.waitForFunction(() => window.__dungeonPlayer()?.active === true, null, { timeout: 60_000 });
    });
} catch {
  console.error("✗ dungeon hooks never appeared.");
  for (const e of pageErrors.slice(0, 8)) console.error("   ", e);
  await shutdown(2);
}

// ── Profile ────────────────────────────────────────────────────────────────
const cdp = await ctx.newCDPSession(page);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: Number(a.interval) });
await cdp.send("Profiler.start");
// Pin the clocks BEFORE the run and again after; see alignByMarker.
await page.evaluate(() => window.__lagSync(80));

log(`▶ bot: mode=${a.mode} for ${SECS}s, sampling every ${a.interval}µs`);
await page.evaluate(
  ([mode, seconds]) => window.__dungeonBot({ mode, seconds, profile: true }),
  [a.mode, SECS],
);

const deadline = Date.now() + SECS * 1000 + 20_000;
while (Date.now() < deadline) {
  await page.waitForTimeout(2000);
  const still = await page.evaluate(() => !!window.__dungeonBotIsRunning?.()).catch(() => false);
  const p = await page
    .evaluate(() => {
      const pl = window.__dungeonPlayer?.();
      return pl ? { hp: pl.hp, kills: pl.kills, lvl: window.__dungeonPool?.()?.level } : null;
    })
    .catch(() => null);
  if (p) log(`   floor ${p.lvl ?? "?"}  hp ${p.hp}  kills ${p.kills}`);
  if (!still) break;
}

await page.evaluate(() => window.__lagSync(80));
const { profile } = await cdp.send("Profiler.stop");
const botReport = await page.evaluate(() => window.__dungeonBotStop()).catch(() => null);
const probe = await page.evaluate(() => window.__lagDump());
await page.close().catch(() => {});
await browser.close().catch(() => {});
closeHostBrowser();

// ── Align the two clocks ───────────────────────────────────────────────────
/**
 * The V8 profiler timestamps in microseconds on its own epoch; the page
 * timestamps in milliseconds since navigation start. Rather than assume a
 * relationship, `__lagSync` burns CPU inside a uniquely-named function at each
 * end of the run. Those samples are unmistakable in the profile, so the offset
 * is *measured* — twice, and the disagreement between the two is reported as
 * the alignment error rather than hidden.
 */
function alignByMarker(prof, syncs) {
  const nodeById = new Map(prof.nodes.map((n) => [n.id, n]));
  const markerIds = new Set(
    prof.nodes.filter((n) => n.callFrame.functionName === "__lagSyncMarker").map((n) => n.id),
  );
  const ts = [];
  let t = prof.startTime;
  for (let i = 0; i < prof.samples.length; i++) {
    t += prof.timeDeltas[i] ?? 0;
    ts.push(t);
  }
  if (!markerIds.size || syncs.length < 1) return { offset: null, ts, nodeById, error: null };
  // Cluster the marker samples: they arrive in one dense block per sync call.
  const hits = [];
  for (let i = 0; i < prof.samples.length; i++) if (markerIds.has(prof.samples[i])) hits.push(ts[i]);
  const clusters = [];
  for (const h of hits) {
    const last = clusters[clusters.length - 1];
    if (last && h - last.end < 200_000) last.end = h;
    else clusters.push({ start: h, end: h });
  }
  const offsets = [];
  for (let i = 0; i < Math.min(clusters.length, syncs.length); i++) {
    const profMid = (clusters[i].start + clusters[i].end) / 2 / 1000; // → ms
    const pageMid = (syncs[i].a + syncs[i].b) / 2;
    offsets.push(profMid - pageMid);
  }
  if (!offsets.length) return { offset: null, ts, nodeById, error: null };
  const offset = offsets.reduce((x, y) => x + y, 0) / offsets.length;
  const error = Math.max(...offsets) - Math.min(...offsets);
  return { offset, ts, nodeById, error, clusters: clusters.length };
}

const { offset, ts, nodeById, error: alignError, clusters } = alignByMarker(profile, probe.sync);
if (offset === null) {
  console.error("✗ could not align the profiler clock to the page clock (no __lagSyncMarker samples).");
  console.error("  Without alignment, per-frame attribution would be fiction. Aborting.");
  process.exit(3);
}
/** Profiler µs → page ms. */
const pageMs = (tick) => tick / 1000 - offset;

// ── Slice into hitch / healthy windows ─────────────────────────────────────
const frames = probe.frames;
// Ignore everything before the run began: the sync burn and any boot tail.
const runStart = probe.sync[0]?.b ?? frames[0];
const runEnd = probe.sync[1]?.a ?? frames[frames.length - 1];
// DESCENT FRAMES ARE NOT HITCHES. While the loading screen holds the display
// the loop renders and simulates nothing, so those frames are long by design
// and the player is watching a progress bar. They are dropped from the pacing
// numbers AND from the attribution — otherwise the tail is just the warm-up.
const heldFrames = new Set(probe.held ?? []);
const windows = [];
let heldSkipped = 0;
for (let i = 1; i < frames.length; i++) {
  if (frames[i - 1] < runStart || frames[i] > runEnd) continue;
  // Both ends: the frame AFTER a held one is the one that carries the descent's
  // last long gap.
  if (heldFrames.has(i) || heldFrames.has(i - 1)) {
    heldSkipped++;
    continue;
  }
  windows.push({ from: frames[i - 1], to: frames[i], ms: frames[i] - frames[i - 1] });
}
const hitches = windows.filter((w) => w.ms > HITCH);
const healthy = windows.filter((w) => w.ms <= HITCH);

function pct(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.round((p / 100) * (sorted.length - 1)))];
}
const sortedMs = windows.map((w) => w.ms).sort((x, y) => x - y);

// ── Attribute samples ──────────────────────────────────────────────────────
/** Parent map, so a sample can be charged to every function on its stack. */
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const key = (n) => {
  const f = n.callFrame;
  const where = f.url ? `${f.url.split("/").pop()}:${f.lineNumber + 1}` : "";
  return `${f.functionName || "(anonymous)"}${where ? `  ${where}` : ""}`;
};

/** Function names only, root→leaf, for a stack-path report. */
const pathOf = (id) => {
  const out = [];
  for (let n = id; n !== undefined; n = parent.get(n)) {
    const node = nodeById.get(n);
    if (!node) break;
    const f = node.callFrame.functionName;
    if (f && f !== "(root)") out.push(f);
  }
  return out.reverse().join(" › ");
};

/** Total self+inclusive ms per function for samples landing inside `wins`. */
function attribute(wins) {
  // Windows are disjoint and ordered; walk both lists once.
  const self = new Map();
  const incl = new Map();
  const paths = new Map();
  let wi = 0;
  let total = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const t = pageMs(ts[i]);
    while (wi < wins.length && t > wins[wi].to) wi++;
    if (wi >= wins.length) break;
    if (t < wins[wi].from) continue;
    const dt = (profile.timeDeltas[i] ?? 0) / 1000;
    total += dt;
    const node = nodeById.get(profile.samples[i]);
    if (!node) continue;
    const k = key(node);
    self.set(k, (self.get(k) ?? 0) + dt);
    const p = pathOf(profile.samples[i]);
    paths.set(p, (paths.get(p) ?? 0) + dt);
    // Charge every ancestor once, so recursion cannot double-count.
    const seen = new Set();
    for (let id = profile.samples[i]; id !== undefined; id = parent.get(id)) {
      const n = nodeById.get(id);
      if (!n) break;
      const ak = key(n);
      if (!seen.has(ak)) {
        seen.add(ak);
        incl.set(ak, (incl.get(ak) ?? 0) + dt);
      }
    }
  }
  return { self, incl, paths, total };
}

const hot = attribute(hitches);
const cool = attribute(healthy);

function table(map, totalMs, n, contrast) {
  const rows = [...map].sort((x, y) => y[1] - x[1]).slice(0, n);
  const width = Math.max(...rows.map((r) => r[0].length), 10);
  const out = [];
  for (const [k, ms] of rows) {
    const share = totalMs ? (100 * ms) / totalMs : 0;
    const base = contrast ? (contrast.get(k) ?? 0) : null;
    const baseShare = contrast && cool.total ? (100 * base) / cool.total : null;
    out.push(
      `  ${k.padEnd(width)}  ${ms.toFixed(0).padStart(7)}ms  ${share.toFixed(1).padStart(5)}%` +
        (baseShare === null ? "" : `   (healthy frames: ${baseShare.toFixed(1)}%)`),
    );
  }
  return out.join("\n");
}

// ── GPU calls inside the hitches ───────────────────────────────────────────
function gpuIn(wins) {
  const by = new Map();
  let wi = 0;
  for (const c of probe.gpu) {
    while (wi < wins.length && c.at > wins[wi].to) wi++;
    if (wi >= wins.length) break;
    if (c.at < wins[wi].from) continue;
    const k = `${c.api}  ${c.label}`.trim();
    const e = by.get(k) ?? { n: 0, ms: 0 };
    e.n++;
    e.ms += c.ms;
    by.set(k, e);
  }
  return by;
}
const gpuHitch = gpuIn(hitches);
const gpuTotalMs = [...gpuHitch.values()].reduce((s, e) => s + e.ms, 0);

// ── Report ─────────────────────────────────────────────────────────────────
log("\n══ LAG ATTRIBUTION ═══════════════════════════════════════════════════");
log(`renderer:        ${glInfo}`);
log(`frames:          ${windows.length} over ${((runEnd - runStart) / 1000).toFixed(1)}s   (${heldSkipped} descent frames excluded${heldSkipped === 0 ? " — is __dungeonHeld present?" : ""})`);
log(`pacing:          p50 ${pct(sortedMs, 50).toFixed(1)}ms   p95 ${pct(sortedMs, 95).toFixed(1)}ms   p99 ${pct(sortedMs, 99).toFixed(1)}ms`);
log(
  `dropped >16.7ms: ${((100 * windows.filter((w) => w.ms > 16.7).length) / windows.length).toFixed(1)}%   ` +
    `hitches >${HITCH}ms: ${hitches.length}   worst: ${Math.max(0, ...sortedMs).toFixed(0)}ms`,
);
log(`clock alignment: offset ${offset.toFixed(1)}ms, drift between the two markers ${alignError.toFixed(1)}ms (${clusters} marker clusters)`);
if (alignError > 25) log(`  ⚠ drift above 25ms — treat per-frame attribution as approximate.`);
if (probe.capped) log(`  ⚠ the GPU call log hit its cap; late calls are missing.`);

log(`\n── ${hitches.length} HITCH frames, ${hot.total.toFixed(0)}ms of samples ─ SELF time ──`);
log(table(hot.self, hot.total, TOP, cool.self));
log(`\n── the same frames ─ INCLUSIVE (total) time ──`);
log(table(hot.incl, hot.total, TOP, cool.incl));
log(`\n── ${healthy.length} HEALTHY frames, ${cool.total.toFixed(0)}ms of samples ─ SELF time ──`);
log(table(cool.self, cool.total, 12, null));

// The leaderboard says WHAT is slow; only the stack says WHO ASKED FOR IT, and
// "who asked" is the thing you can actually change.
log(`\n── the hitch frames ─ heaviest CALL PATHS (self time at the leaf) ──`);
for (const [p, ms] of [...hot.paths].sort((x, y) => y[1] - x[1]).slice(0, 14)) {
  const frames_ = p.split(" › ");
  log(`  ${ms.toFixed(0).padStart(6)}ms  ${frames_.slice(-7).join(" › ")}`);
}

log(`\n── WebGPU / upload calls inside the hitch frames (${gpuTotalMs.toFixed(0)}ms total) ──`);
{
  const rows = [...gpuHitch].sort((x, y) => y[1].ms - x[1].ms).slice(0, TOP);
  if (!rows.length) log("  (none)");
  const width = Math.max(10, ...rows.map((r) => r[0].length));
  for (const [k, e] of rows) log(`  ${k.padEnd(width)}  ${e.ms.toFixed(1).padStart(8)}ms  ×${e.n}`);
}

log(`\n── the 8 worst frames ──`);
for (const w of [...hitches].sort((x, y) => y.ms - x.ms).slice(0, 8)) {
  const g = gpuIn([w]);
  const top = [...g].sort((x, y) => y[1].ms - x[1].ms).slice(0, 3);
  const at = attribute([w]);
  const worst = [...at.self].sort((x, y) => y[1] - x[1]).slice(0, 3);
  log(`  ${w.ms.toFixed(0).padStart(5)}ms at t=${((w.from - runStart) / 1000).toFixed(1)}s`);
  log(`      js:  ${worst.map(([k, ms]) => `${k} ${ms.toFixed(0)}ms`).join(" · ") || "(no samples)"}`);
  log(`      gpu: ${top.map(([k, e]) => `${k} ${e.ms.toFixed(0)}ms ×${e.n}`).join(" · ") || "(none)"}`);
}

if (botReport) log(`\nbot: ${botReport.kills} kills, ${botReport.deaths} deaths, ${botReport.stuckEvents?.length ?? 0} stuck`);
if (pageErrors.length) log(`page errors: ${pageErrors.length}\n  ${pageErrors.slice(0, 5).join("\n  ")}`);

if (a.out) {
  mkdirSync(dirname(a.out), { recursive: true });
  writeFileSync(
    a.out,
    JSON.stringify(
      {
        glInfo,
        offset,
        alignError,
        windows,
        hitchSelf: [...hot.self].sort((x, y) => y[1] - x[1]).slice(0, 200),
        hitchIncl: [...hot.incl].sort((x, y) => y[1] - x[1]).slice(0, 200),
        hitchPaths: [...hot.paths].sort((x, y) => y[1] - x[1]).slice(0, 120),
        healthySelf: [...cool.self].sort((x, y) => y[1] - x[1]).slice(0, 200),
        gpuHitch: [...gpuHitch],
        longtasks: probe.longtasks,
        botReport,
      },
      null,
      1,
    ),
  );
  log(`\n▶ wrote ${a.out}`);
}
process.exit(0);
