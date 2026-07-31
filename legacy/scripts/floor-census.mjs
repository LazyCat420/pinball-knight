#!/usr/bin/env node
/**
 * FLOOR CENSUS — a fingerprint of what `buildLevel` authored, captured from the
 * running game.
 *
 * ## Why this is a script and not a unit test
 *
 * The obvious version of this is a vitest file that calls the maze pipeline
 * stage by stage and asserts on the result. That version is a trap, and the
 * repo already has the scar: `maze/floor-pipeline.test.ts` carries a warning
 * that its "mirrors core.ts exactly" harness had gone THREE TUNINGS STALE —
 * a local copy of the budget arithmetic that stopped tracking `constants.ts`,
 * so it was faithfully testing a floor nobody had shipped in months.
 *
 * A re-implementation of the thing you are refactoring cannot certify the
 * refactor: it drifts in exactly the direction that hides the bug. So this
 * drives the REAL game in a REAL browser, jumps to a floor through the same
 * `startLevel` the player hits, and reads the census back out of live `state`.
 * There is nothing here to drift.
 *
 * ## What it is for
 *
 * `buildLevel` runs ~20 placement phases off ONE RNG stream. Reordering any two
 * draws changes every draw after it — a completely different floor that renders
 * fine and breaks no test. Capture before a refactor, capture after, diff:
 *
 *     node scripts/floor-census.mjs --out /tmp/before.json
 *     # ...refactor...
 *     node scripts/floor-census.mjs --out /tmp/after.json
 *     node scripts/floor-census.mjs --diff /tmp/before.json /tmp/after.json
 *
 * A clean diff is the only cheap proof the stream was not disturbed. If it is
 * dirty, the split reordered a draw — do NOT re-bless the snapshot.
 *
 * Requires the dev server (`npm run dev`, port 5174).
 */
import { chromium } from "playwright";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const { values: a, positionals } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:5174/dungeon" },
    /** Run seeds to sample. More seeds = more chances to catch a reorder that
     *  happens to be invisible on one particular floor shape. */
    seeds: { type: "string", default: "42,1337,7" },
    /** Depths to visit per seed. Floor 1 is special-cased in several phases
     *  (the R&D marble seeding, no boss antechamber), so never sample it alone. */
    levels: { type: "string", default: "1,2,3,5,8" },
    out: { type: "string" },
    diff: { type: "boolean", default: false },
    headed: { type: "boolean", default: false },
    "cdp-port": { type: "string", default: process.env.BDB_CDP_PORT ?? "9333" },
  },
  allowPositionals: true,
});

// ── Diff mode ──────────────────────────────────────────────────────────────
if (a.diff) {
  const [pa, pb] = positionals;
  if (!pa || !pb) {
    console.error("usage: floor-census.mjs --diff <before.json> <after.json>");
    process.exit(2);
  }
  const A = JSON.parse(readFileSync(pa, "utf8"));
  const B = JSON.parse(readFileSync(pb, "utf8"));
  const keys = [...new Set([...Object.keys(A), ...Object.keys(B)])].sort();
  let bad = 0;
  for (const k of keys) {
    const sa = JSON.stringify(A[k]);
    const sb = JSON.stringify(B[k]);
    if (sa === sb) continue;
    bad++;
    console.error(`✗ ${k}`);
    // Name the field that moved rather than dumping two blobs — "zombies.sum
    // changed" is actionable, a wall of JSON is not.
    const oa = A[k] ?? {};
    const ob = B[k] ?? {};
    for (const f of [...new Set([...Object.keys(oa), ...Object.keys(ob)])]) {
      const fa = JSON.stringify(oa[f]);
      const fb = JSON.stringify(ob[f]);
      if (fa !== fb) console.error(`    ${f}:\n      before ${fa}\n      after  ${fb}`);
    }
  }
  if (bad) {
    console.error(`\n✗ ${bad}/${keys.length} floors differ — the RNG stream MOVED.`);
    console.error("  A behaviour-preserving split cannot change these. Find the reordered draw.");
    process.exit(1);
  }
  console.log(`✓ ${keys.length} floors identical — the RNG stream is intact.`);
  process.exit(0);
}

// ── Capture mode ───────────────────────────────────────────────────────────
const seeds = a.seeds.split(",").map((s) => Number(s.trim())).filter(Number.isFinite);
const levels = a.levels.split(",").map((s) => Number(s.trim())).filter(Number.isFinite);

// ── The browser: REAL WebGPU or nothing ────────────────────────────────────
//
// This deliberately has no SwiftShader fallback. The census is a determinism
// instrument, and the moment it can silently run on a different backend than
// the one it is compared against, its verdict is worthless — "the floors
// differ" would be indistinguishable from "the renderers differ". Bundled
// Chromium on WSL2 exposes `navigator.gpu` and then resolves `requestAdapter()`
// to null, so a fallback here would not even announce itself. Fail instead.
const PORT = Number(a["cdp-port"]);
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

/** Launch (or reuse) the host's Chrome with the debugging port open. A
 *  dedicated `--user-data-dir` because Chrome refuses the port on a profile the
 *  user already has open, and that failure looks like a timeout, not a clash. */
async function connectHostGpu() {
  if (await cdpAlive(PORT)) return chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 120_000 });
  const exe = WIN_CHROME.find((p) => existsSync(p));
  if (!exe) return null;
  const child = spawn(
    exe,
    [
      a.headed ? "--new-window" : "--headless=new",
      "--mute-audio",
      `--remote-debugging-port=${PORT}`,
      "--remote-allow-origins=*",
      "--user-data-dir=C:\\Temp\\bdb-floor-census",
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
  console.error("✖ no host browser with a real GPU — refusing to census on a software backend.");
  console.error("  WSL2 cannot reach a WebGPU adapter from bundled Chromium; see scripts/webgpu-check.mjs.");
  process.exit(2);
}
const ctx = browser.contexts()[0] ?? (await browser.newContext({ viewport: { width: 1280, height: 720 } }));
const census = {};
let failed = false;

// ⚠️ ONE FRESH PAGE PER (seed, level). This is not caution, it is a measured
// requirement: capturing 1→3→5 in a single page produced a DIFFERENT floor 5 on
// two runs of the same seed (walkable 3902 vs 3976, different stairs, different
// grid), while jumping straight to 5 reproduced exactly. Something in the floor
// build is path-dependent — most likely the async floor-loading warm of one
// floor still in flight when the next build starts. That is a real bug worth
// chasing separately; what matters here is that the instrument must not inherit
// it, or every refactor diff would be swamped by noise the refactor did not
// cause.
for (const seed of seeds) {
  for (const level of levels) {
    const u = new URL(a.url);
    u.searchParams.set("playtest", "1");
    u.searchParams.set("mute", "1");
    u.searchParams.set("seed", String(seed));
    u.searchParams.set("autostart", "1");
    // Force the backend rather than letting `auto` pick: an A/B where one side
    // quietly resolved WebGL is not an A/B.
    u.searchParams.set("gpu", "webgpu");
    // WSL2: Windows forwards its own localhost into WSL but cannot reach the WSL
    // subnet IP, so the host browser must be pointed at localhost.
    if (u.hostname !== "localhost" && /^(127\.|0\.0\.0\.0|10\.|100\.|172\.|192\.168\.)/.test(u.hostname)) u.hostname = "localhost";

    const page = await ctx.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e.message || e)));
    try {
      await page.goto(u.toString(), { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForFunction(
        () => typeof window.__dungeonCensus === "function" && typeof window.__dungeonLevel === "function",
        null,
        { timeout: 120_000 },
      );
      await page.waitForFunction(() => window.__dungeonPlayer()?.active === true, null, { timeout: 60_000 })
        .catch(async () => {
          await page.evaluate(() => window.__dungeonStartRun?.());
          await page.waitForFunction(() => window.__dungeonPlayer()?.active === true, null, { timeout: 60_000 });
        });
      // Prove we are on WebGPU before trusting anything this page says.
      const backend = await page.evaluate(() => window.__renderBackendResolved ?? "unknown");
      if (backend !== "webgpu") throw new Error(`resolved ${backend}, not webgpu`);

      // startLevel is what the player's descent calls; going through it (rather
      // than poking state.level) is the point — measure the shipping path.
      await page.evaluate((n) => window.__dungeonLevel(n), level);
      await page.waitForFunction(
        (n) => {
          const c = window.__dungeonCensus?.();
          return !!c && c.level === n && !!c.grid;
        },
        level,
        { timeout: 60_000 },
      );
      const c = await page.evaluate(() => window.__dungeonCensus());
      census[`seed${seed}/L${level}`] = c;
      console.log(`  seed ${seed} L${level}: walkable=${c.walkable} zombies=${c.zombies.n} parts=${c.parts.n} items=${c.items.n}`);
    } catch (e) {
      console.error(`✗ seed ${seed} L${level}: ${String(e.message ?? e).slice(0, 120)}`);
      for (const err of pageErrors.slice(0, 3)) console.error("   ", err);
      failed = true;
    } finally {
      await page.close().catch(() => {});
    }
  }
}

await browser.close();

if (a.out) {
  writeFileSync(a.out, JSON.stringify(census, null, 2));
  console.log(`▶ wrote ${Object.keys(census).length} floors → ${a.out}`);
} else {
  console.log(JSON.stringify(census, null, 2));
}

// An empty census is a FAILED capture, not a clean one — without this a broken
// boot writes `{}` and the diff against it passes, certifying nothing.
if (!Object.keys(census).length) {
  console.error("✗ captured NOTHING — treat this as a failure, not a pass.");
  process.exit(2);
}
process.exit(failed ? 1 : 0);
