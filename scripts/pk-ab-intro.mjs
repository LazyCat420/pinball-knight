#!/usr/bin/env node
/**
 * pk-ab-intro — the TITLE SEQUENCE's visual-parity sign-off artifact.
 *
 * The third rig, and the last scene that had none. `pk-ab-tavern` grades a
 * settled room and `pk-ab-dungeon` grades a settled floor; neither shape works
 * here, because the intro is not a state — it is 11.4 seconds of choreography
 * that plays once and is gone:
 *
 *     run 2.3s → bonk 0.35s → shatter 0.95s → sweep 5.2s → title 2.6s
 *
 * So this rig shoots a FILMSTRIP: one frame per phase, on both sides, from a
 * single page load each, and produces a sheet + heatmap + diff statistics PER
 * PHASE. A mean over the whole sequence would average a blue 2D sky against a
 * black 3D dungeon and report a number that describes neither.
 *
 * ── HOW THE TWO SIDES ARE SYNCHRONISED, AND WHY NOT ON A CLOCK ──────────────
 * Both sides publish the live phase NAME and nothing else — legacy on
 * `window.__dungeonIntroPhase` (`intro/index.ts:816`), the port on
 * `JSON.parse(__pk).intro` (`main.rs:380-383`, written to mirror it). Neither
 * publishes its phase clock `pt`.
 *
 * Shooting on wall-clock offsets from page load would therefore compare two
 * different moments: the sequence starts when the first TICK stamps `lastNow`,
 * after `buildMaze` and `compileAsync` have run synchronously — a cold wasm
 * boot and a cold Vite boot do not pay that at the same time. Shooting on
 * PHASE ENTRY needs no clock: it is the same authored event on both sides,
 * detected by polling the probe every 40 ms. The residual error is the poll
 * granularity, and it is REPORTED (`+Nms` per shot) rather than assumed away.
 *
 * ⚠️ `bonk` IS 350 ms LONG. That is under ten polls and a screenshot takes
 * longer than a poll, so the phase can advance between the decision to shoot
 * and the shutter. The phase is therefore re-read AFTER each shot and a
 * mismatch is printed as `drifted to X` — a frame labelled `bonk` that was
 * actually taken during `shatter` is worse than a missing frame.
 *
 * ── prefers-reduced-motion IS A SKIP GATE ON BOTH SIDES ─────────────────────
 * Legacy's `shouldSkipIntro()` honours it and so does the port's
 * `pk_core::intro::should_skip_intro`. Headless Chrome reports `reduce`, so a
 * rig that did not emulate `no-preference` would photograph two lobbies and
 * report a beautiful diff of zero. The context is created with
 * `reducedMotion: "no-preference"` and each side ASSERTS that the intro
 * actually started before it waits for a phase.
 *
 * ── REAL HOST CHROME, NEVER SWIFTSHADER ────────────────────────────────────
 * As the other two rigs: SwiftShader cannot run the Bevy wasm app at all.
 *
 * Usage, from the repo root:
 *   node scripts/pk-ab-intro.mjs                 # trunk build + both sides
 *   node scripts/pk-ab-intro.mjs --no-build
 *   node scripts/pk-ab-intro.mjs --rust-only
 *   node scripts/pk-ab-intro.mjs --phases run,title
 *   node scripts/pk-ab-intro.mjs --strict        # diff stats are fatal
 */
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Same dependency story as the other two rigs: sharp and (optionally)
// node-canvas live in `legacy/node_modules`, and node's resolution walks UP
// from this file so it would never find them sideways.
const legacyRequire = createRequire(join(ROOT, "legacy/package.json"));
const sharp = legacyRequire("sharp");
let canvasLib = null;
try {
  canvasLib = legacyRequire("canvas");
} catch {
  /* labels are a nicety, not the artifact */
}

const { values: a } = parseArgs({
  options: {
    "no-build": { type: "boolean", default: false },
    "legacy-only": { type: "boolean", default: false },
    "rust-only": { type: "boolean", default: false },
    strict: { type: "boolean", default: false },
    phases: { type: "string", default: "run,bonk,shatter,sweep,title" },
    out: { type: "string", default: join(ROOT, ".checks") },
    "legacy-url": { type: "string", default: "" },
    /** Not pk-check's 8791, pk-ab-tavern's 8792 or pk-ab-dungeon's 8793. */
    port: { type: "string", default: "8794" },
    "cdp-port": { type: "string", default: process.env.BDB_CDP_PORT ?? "9333" },
  },
});

const VIEW_W = 1920;
const VIEW_H = 1080;
const PORT = Number(a.port);
const OUT = a.out;
const doLegacy = !a["rust-only"];
const doRust = !a["legacy-only"];

/** The authored order. A requested subset is shot in THIS order, never the
 *  order it was typed in — the sequence only plays forwards. */
const PHASE_ORDER = ["run", "bonk", "shatter", "sweep", "title"];

/**
 * WHERE INSIDE EACH PHASE TO SHOOT, in seconds from that phase's first frame,
 * against the authored durations (`intro/index.ts:65-70`):
 *
 *     run 2.3 · bonk 0.35 · shatter 0.95 · sweep 5.2 · title 2.6
 *
 * ⚠️ THIS IS THE DIFFERENCE BETWEEN AN INSTRUMENT AND A RANDOM NUMBER.
 * The first version shot "as soon as the phase is seen", which sounds matched
 * and is not: the shutter fires some tens of milliseconds after detection, the
 * two sides' lags are unrelated, and during `run` the knight is sprinting at
 * 150 px/s across a 480-px canvas. Measured across three runs with NOTHING
 * changed in that phase's art, the `run` diff read 14.5, then 21.7, then 37.0
 * — the instrument's own jitter was three times the size of the fixes being
 * measured, and it would have sent someone hunting an art regression that did
 * not exist.
 *
 * Shooting at a fixed offset INTO the phase leaves only the detection error
 * (one poll, ~40 ms) which is symmetric and small. Offsets are mid-phase on
 * purpose: away from the transition on both sides, and away from the edge
 * triggers that fire on entry.
 */
const SHOOT_AT = {
  run: 1.2,
  bonk: 0.15,
  shatter: 0.45,
  sweep: 2.6,
  title: 1.2,
};
const PHASES = PHASE_ORDER.filter((p) => a.phases.split(",").includes(p));
if (!PHASES.length) throw new Error(`--phases matched none of ${PHASE_ORDER.join(",")}`);

/** Poll cadence for the phase probe. 40ms ≈ 2.4 frames at 60Hz. */
const POLL_MS = 40;
/** After the freeze takes, let the frame settle before the shutter — a wasm
 *  build compiles pipelines lazily and the first held frame is not the last. */
const FREEZE_SETTLE_MS = 1200;
/** A phase that has not appeared in this long means the sequence is not
 *  running — a skip gate fired, or it already finished. */
const PHASE_TIMEOUT_MS = 40_000;

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".json": "application/json",
};

const log = (m) => console.log(m);

/* ─────────────────────────────── image I/O ─────────────────────────────── */

async function decode(file) {
  const img = sharp(file);
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, ch: info.channels };
}

/** Black → blue → yellow → red. The same ramp as the other two rigs, so all
 *  three heatmaps are read with one eye. */
function rampColour(t) {
  const c = Math.max(0, Math.min(1, t));
  if (c < 0.33) return [0, 0, Math.round((c / 0.33) * 255)];
  if (c < 0.66) {
    const k = (c - 0.33) / 0.33;
    return [Math.round(k * 255), Math.round(k * 255), Math.round(255 * (1 - k))];
  }
  const k = (c - 0.66) / 0.34;
  return [255, Math.round(255 * (1 - k)), 0];
}

async function writeDiff(la, ra, file) {
  const w = Math.min(la.w, ra.w);
  const h = Math.min(la.h, ra.h);
  const out = Buffer.alloc(w * h * 3);
  let sum = 0;
  let over32 = 0;
  const hist = new Uint32Array(256);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const li = (y * la.w + x) * la.ch;
      const ri = (y * ra.w + x) * ra.ch;
      const d = Math.max(
        Math.abs(la.data[li] - ra.data[ri]),
        Math.abs(la.data[li + 1] - ra.data[ri + 1]),
        Math.abs(la.data[li + 2] - ra.data[ri + 2]),
      );
      sum += d;
      hist[d]++;
      if (d > 32) over32++;
      const c = rampColour(d / 255);
      const o = (y * w + x) * 3;
      out[o] = c[0];
      out[o + 1] = c[1];
      out[o + 2] = c[2];
    }
  }
  await sharp(out, { raw: { width: w, height: h, channels: 3 } }).png().toFile(file);
  const total = w * h;
  let acc = 0;
  let p95 = 255;
  for (let d = 0; d < 256; d++) {
    acc += hist[d];
    if (acc >= total * 0.95) {
      p95 = d;
      break;
    }
  }
  return { mean: sum / total, p95, over32Frac: over32 / total };
}

/** Mean luma, so "ours is too dark" is a number rather than an impression —
 *  it is what caught the dungeon's albedo error (one-to-one §5, finding 5). */
function medianLuma(img) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < img.data.length; i += img.ch) {
    const y = (img.data[i] * 299 + img.data[i + 1] * 587 + img.data[i + 2] * 114) / 1000;
    hist[Math.round(y)]++;
  }
  const total = (img.data.length / img.ch) | 0;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= total / 2) return v;
  }
  return 0;
}

async function writeSideBySide(la, ra, file, captions) {
  const GUT = 8;
  const BAR = canvasLib ? 34 : 0;
  const w = la.w + GUT + ra.w;
  const h = Math.max(la.h, ra.h) + BAR;
  const out = Buffer.alloc(w * h * 3, 24);
  const blit = (img, ox, oy) => {
    for (let y = 0; y < img.h; y++) {
      for (let x = 0; x < img.w; x++) {
        const i = (y * img.w + x) * img.ch;
        const o = ((y + oy) * w + (x + ox)) * 3;
        out[o] = img.data[i];
        out[o + 1] = img.data[i + 1];
        out[o + 2] = img.data[i + 2];
      }
    }
  };
  blit(la, 0, BAR);
  blit(ra, la.w + GUT, BAR);
  let png = sharp(out, { raw: { width: w, height: h, channels: 3 } });
  if (canvasLib) {
    const c = canvasLib.createCanvas(w, BAR);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#12151c";
    ctx.fillRect(0, 0, w, BAR);
    ctx.fillStyle = "#c9bfa4";
    ctx.font = "16px monospace";
    ctx.fillText(captions[0], 12, 22);
    ctx.fillText(captions[1], la.w + GUT + 12, 22);
    png = png.composite([{ input: c.toBuffer("image/png"), top: 0, left: 0 }]);
  }
  await png.png().toFile(file);
}

/* ──────────────────────────────── booting ──────────────────────────────── */

async function openPage(ctx, errors, tag, badUrls) {
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(`${tag}: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${tag}: PAGEERROR ${e.message}`));
  page.on("response", (r) => {
    if (r.status() >= 400) badUrls.add(`${r.status()} ${r.url()}`);
  });
  try {
    await page.setViewportSize({ width: VIEW_W, height: VIEW_H });
  } catch {
    /* assertViewport is the gate */
  }
  return page;
}

/** HARD gate: a frame shot at another size is not in the matched regime. */
async function assertViewport(page, side) {
  const got = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  if (got.w !== VIEW_W || got.h !== VIEW_H) {
    throw new Error(
      `${side}: viewport is ${got.w}x${got.h}, not ${VIEW_W}x${VIEW_H} — refusing to compare outside the matched regime`,
    );
  }
  return got;
}

/**
 * FREEZE THE ORACLE WITHOUT TOUCHING THE ORACLE.
 *
 * Runs at document start on the legacy side and replaces `requestAnimationFrame`
 * with one that hands the callback a VIRTUAL timestamp: a fixed 1/60 s step per
 * frame, which stops advancing once the sequence reaches the authored instant.
 * The intro's whole clock is `introDeltas(now, lastNow)` on the rAF timestamp
 * (`intro/index.ts:821`), so a frozen timestamp is `pdt = dt = 0` — the page
 * keeps painting and paints the same instant forever.
 *
 * ── WHY NOT A SEAM IN `legacy/`, WHICH IS WHAT THE MAZE DID ────────────────
 * It was written that way first, as a `window.__introFreeze` check in the tick,
 * and reverted before it shipped for two reasons. The first is a rule: `legacy/`
 * is byte-identical to the PK tree inside braindeadbot-client except for three
 * known harness seams, nothing gates that today (one-to-one §4, work item D-1),
 * and every avoidable edit is future drift the port cannot see.
 *
 * The second is that it did not work anyway: the seam has to be SERVED, the dev
 * server on :5174 is the primary checkout's, and a worktree cannot run its own
 * `next dev` because `legacy/node_modules` is a symlink out of the project root
 * and Turbopack refuses it. So a source seam is only testable after a merge —
 * which is exactly backwards for a gate whose job is to decide whether to merge.
 *
 * The virtual clock has a second benefit the seam did not: the sequence advances
 * in EXACT 1/60 s steps regardless of how the machine is loaded, so the oracle's
 * frame is reproducible rather than merely held.
 *
 * The port keeps an explicit `?intro-freeze=<phase>:<t>` flag instead, because
 * Bevy's `Time` reads the clock directly and never sees a rAF timestamp.
 */
function installVirtualClock([targetPhase, targetT]) {
  const STEP = 1000 / 60;
  const raf = window.requestAnimationFrame.bind(window);
  let virtual = 0;
  let inPhase = null;
  let phaseT = 0;
  let frozen = false;
  window.__abFrozen = () => frozen;
  window.requestAnimationFrame = (cb) =>
    raf(() => {
      if (!frozen) {
        // The probe is written INSIDE the tick, so this reads the phase of the
        // frame just drawn — one frame behind, which is 16.7 ms and is why the
        // offsets in SHOOT_AT are mid-phase rather than on an edge.
        const ph = window.__dungeonIntroPhase ?? null;
        if (ph !== inPhase) {
          inPhase = ph;
          phaseT = 0;
        } else if (ph !== null) {
          phaseT += STEP;
        }
        if (ph === targetPhase && phaseT >= targetT * 1000) frozen = true;
        virtual += STEP;
      }
      cb(virtual);
    });
}

/**
 * Shoot ONE phase, from its own page load, with the sequence FROZEN at the
 * authored instant.
 *
 * ── WHY ONE LOAD PER PHASE ────────────────────────────────────────────────
 * The first version walked all five phases on a single load. It cannot work:
 * a CDP screenshot of a 1920×1080 page takes 0.6–1.3 s, `bonk` lasts 0.35 s
 * and `shatter` 0.95 s, so the shutter outlives the phase it was aiming at.
 * Measured: a `run` frame requested at t+1.2 s came back BLACK, from the
 * sweep, and the run diff read 135 with our median luma at 141 against the
 * oracle's 10 — a number that describes the harness and not the game.
 *
 * With the freeze seam the shutter's latency stops mattering entirely: the
 * page holds the frame until it is photographed, so the only thing the timing
 * affects is how long the run takes.
 */
async function shootPhase(page, side, readPhase, phase, stamp) {
  const t0 = Date.now();
  let seen = null;
  while (Date.now() - t0 < PHASE_TIMEOUT_MS && seen !== phase) {
    seen = await readPhase(page);
    if (seen === null && Date.now() - t0 > 20_000) {
      throw new Error(
        `${side}: the intro never started (probe null for 20s) — a skip gate fired; ` +
          "check prefers-reduced-motion emulation and the URL flags",
      );
    }
    if (seen !== phase) await page.waitForTimeout(POLL_MS);
  }
  if (seen !== phase) throw new Error(`${side}: phase "${phase}" never arrived`);
  // It is HELD here by construction, but prove it rather than assume it: two
  // reads a settle apart must agree, or the freeze did not take and every
  // number below is describing a moving target again.
  await page.waitForTimeout(FREEZE_SETTLE_MS);
  const a = await readPhase(page);
  await page.waitForTimeout(250);
  const b = await readPhase(page);
  if (a !== phase || b !== phase) {
    throw new Error(
      `${side}: the freeze did not hold at "${phase}" (saw "${a}" then "${b}") — ` +
        "the seam is not wired on this side",
    );
  }
  const froze = await page.evaluate(() =>
    typeof window.__abFrozen === "function" ? window.__abFrozen() : "n/a",
  );
  const file = join(OUT, `ab-intro-${phase}-${stamp}.png`);
  await page.screenshot({ path: file });
  log(`  ${side} ${phase.padEnd(8)} frozen and shot${froze === false ? "  ⚠ CLOCK NOT FROZEN" : ""}`);
  return file;
}

async function shootLegacy(ctx, errors, badUrls, url, phase) {
  const page = await openPage(ctx, errors, "legacy", badUrls);
  // NOTHING is pinned at document start except the freeze, and that is the
  // difference from the other two rigs: they both set `__skipDungeonIntro =
  // true`, which is precisely the flag that would make this rig photograph
  // nothing. The freeze goes in at DOCUMENT START because the tick reads it on
  // its very first frame and `run` begins there.
  await page.addInitScript(installVirtualClock, [phase, SHOOT_AT[phase]]);
  const u = new URL(url);
  u.searchParams.set("mute", "1");
  u.searchParams.set("gpu", "webgpu");
  await page.goto(u.toString(), { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.bringToFront();
  await assertViewport(page, "legacy");
  const readPhase = (p) => p.evaluate(() => window.__dungeonIntroPhase ?? null);
  const file = await shootPhase(page, "legacy", readPhase, phase, "legacy");
  const backend = await page.evaluate(() => window.__renderBackendResolved ?? "unknown");
  await page.close();
  return { file, backend };
}

async function shootRust(ctx, errors, badUrls, phase) {
  const page = await openPage(ctx, errors, "rust", badUrls);
  // No boot flags at all: the intro IS the default entry (main.rs:248-258).
  // `?tavern=1`, `?real-floor=1`, `?autostart=1` and `?no-intro=1` would each
  // skip it, which is why none of them is here.
  const url =
    `http://localhost:${PORT}/index.html?mute=1` +
    `&intro-freeze=${phase}:${SHOOT_AT[phase]}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.bringToFront();
  await assertViewport(page, "rust");
  const readPhase = (p) =>
    p.evaluate(() => {
      try {
        return window.__pk ? (JSON.parse(window.__pk).intro ?? null) : null;
      } catch {
        return null;
      }
    });
  const file = await shootPhase(page, "rust", readPhase, phase, "rust");
  await page.close();
  return { file, backend: "webgpu" };
}

/** Find a live legacy dev server. The route is `/` — `/dungeon` is stale. */
async function findLegacy() {
  if (a["legacy-url"]) return a["legacy-url"];
  for (const port of [5174, 5199, 3000]) {
    try {
      const r = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(20_000) });
      if (r.ok) return `http://localhost:${port}/`;
    } catch {
      /* next port */
    }
  }
  return null;
}

/* ──────────────────────────────── the run ──────────────────────────────── */

async function main() {
  await mkdir(OUT, { recursive: true });

  let server = null;
  if (doRust) {
    if (!a["no-build"]) {
      log("building (trunk)...");
      execSync("trunk build", { cwd: ROOT, stdio: "inherit" });
    }
    if (!existsSync(join(ROOT, "web/dist/index.html"))) {
      throw new Error("web/dist/index.html missing — run trunk build");
    }
    server = createServer(async (req, res) => {
      const p = join(ROOT, "web/dist", req.url === "/" ? "index.html" : req.url.split("?")[0]);
      try {
        const body = await readFile(p);
        res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream" });
        res.end(body);
      } catch {
        res.writeHead(404).end();
      }
    }).listen(PORT);
  }

  let legacyUrl = null;
  if (doLegacy) {
    legacyUrl = await findLegacy();
    if (!legacyUrl) {
      server?.close();
      throw new Error(
        "no legacy dev server answering on :5174 / :5199 / :3000 — start it with " +
          "`cd legacy && npm run dev`, or pass --legacy-url",
      );
    }
  }

  const { connectRealGpu, closeHostBrowser, rewriteForHostBrowser } = await import(
    "../legacy/scripts/lib/host-chrome.mjs"
  );
  const browser = await connectRealGpu({ port: Number(a["cdp-port"]) });
  if (!browser) {
    server?.close();
    throw new Error("no real-GPU host browser — SwiftShader cannot run the Bevy wasm app at all");
  }
  let ctx;
  let ownCtx = false;
  try {
    // reducedMotion is THE load-bearing option here — see the header.
    ctx = await browser.newContext({
      viewport: { width: VIEW_W, height: VIEW_H },
      reducedMotion: "no-preference",
    });
    ownCtx = true;
  } catch {
    ctx = browser.contexts()[0] ?? (await browser.newContext());
  }
  const errors = [];
  const badUrls = new Set();

  const shot = { legacy: {}, rust: {} };
  let backend = "unknown";
  try {
    // ONE PAGE LOAD PER PHASE PER SIDE, and one page at a time: a backgrounded
    // tab has its rAF throttled, and a throttled tab reaches its freeze point
    // slowly or not at all.
    for (const phase of PHASES) {
      if (doLegacy) {
        const r = await shootLegacy(ctx, errors, badUrls, rewriteForHostBrowser(legacyUrl), phase);
        shot.legacy[phase] = r.file;
        backend = r.backend;
      }
      if (doRust) {
        const r = await shootRust(ctx, errors, badUrls, phase);
        shot.rust[phase] = r.file;
      }
    }
  } finally {
    if (ownCtx) await ctx.close().catch(() => {});
    closeHostBrowser();
    server?.close();
  }
  log(`legacy backend=${backend}`);

  /* ── report, one row per phase ── */
  console.log("");
  const rows = [];
  for (const want of PHASES) {
    const lf = shot.legacy[want] ?? null;
    const rf = shot.rust[want] ?? null;
    let stats = null;
    const li = lf ? await decode(lf) : null;
    const ri = rf ? await decode(rf) : null;
    if (li && ri) {
      const sheet = join(OUT, `ab-intro-${want}.png`);
      await writeSideBySide(li, ri, sheet, [
        `LEGACY  intro · ${want} @ t+${SHOOT_AT[want]}s (frozen)`,
        `RUST    intro · ${want} @ t+${SHOOT_AT[want]}s (frozen)`,
      ]);
      stats = await writeDiff(li, ri, join(OUT, `ab-intro-${want}-diff.png`));
      stats.lumaL = medianLuma(li);
      stats.lumaR = medianLuma(ri);
    }
    rows.push({ phase: want, stats });
  }

  log(`phase     ${"diff mean".padStart(9)} ${"p95".padStart(4)} ${"over32".padStart(7)}   median luma L/R`);
  for (const row of rows) {
    if (!row.stats) {
      log(`${row.phase.padEnd(9)} one side only — no comparison`);
      continue;
    }
    const s = row.stats;
    log(
      `${row.phase.padEnd(9)} ${s.mean.toFixed(1).padStart(9)} ${String(s.p95).padStart(4)} ` +
        `${(s.over32Frac * 100).toFixed(1).padStart(6)}%   ${String(s.lumaL).padStart(3)} / ${String(s.lumaR).padStart(3)}`,
    );
  }
  console.log("");
  log(`sheets   ${join(OUT, "ab-intro-<phase>.png")}`);
  log(`heatmaps ${join(OUT, "ab-intro-<phase>-diff.png")}`);
  console.log("");
  log("  note  LOOK AT THE SHEETS. Each phase is a different picture — a mean");
  log("        across the sequence would average a blue sky against a black");
  log("        dungeon and describe neither.");

  if (badUrls.size) {
    console.log("");
    log(`missing resources (${badUrls.size}):`);
    for (const u of [...badUrls].slice(0, 10)) log(`   ${u}`);
  }
  if (errors.length) {
    console.log("");
    log(`console errors (${errors.length}):`);
    for (const e of errors.slice(0, 10)) log(`   ${e.slice(0, 200)}`);
  }

  // Errors are HARD on both sides — a page that threw is not a frame worth
  // comparing. Diff stats are soft unless --strict, as in the other two rigs.
  const hard = errors.length > 0;
  if (a.strict) {
    const bad = rows.filter((r) => !r.stats || r.stats.over32Frac > 0.02);
    if (bad.length) {
      log(`STRICT: ${bad.length} phase(s) over the 2% threshold or missing`);
      process.exit(1);
    }
  }
  process.exit(hard ? 1 : 0);
}

main().catch((e) => {
  console.error(String(e?.stack ?? e));
  process.exit(1);
});
