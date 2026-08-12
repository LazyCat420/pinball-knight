#!/usr/bin/env node
/**
 * pk-perf-ab — B3: THE PORT'S FRAME COST AGAINST THE ORACLE'S, HEAD TO HEAD.
 *
 * 1:1 includes cost. B1 measures the sim (`pk-core --example perf_suite`) and
 * B2 measures the port's own frames (`__pk.perf`). Neither can answer the
 * question a player asks — *is the Rust game slower than the TypeScript one?* —
 * because neither instrument is pointed at the oracle. This one is.
 *
 * ── WHY A rAF ACCUMULATOR AND NOT `__pk.perf` ──────────────────────────────
 * `__pk.perf` exists only on the port. Reading it for one side and something
 * else for the other would compare two INSTRUMENTS, which is how this project
 * has repeatedly manufactured a finding out of a methodology difference. So
 * both sides get the SAME probe, installed at document start, before either
 * app boots: a `requestAnimationFrame` loop that pushes every inter-frame
 * delta into an array.
 *
 * It ACCUMULATES EVERY FRAME and is read once at the end. It never samples.
 * (`publish_stats` learned this the hard way at 5-frame cadence: a p95 taken
 * from one frame in five is missing four fifths of the excursions it exists to
 * report.)
 *
 * ── THE TRAP THIS RIG IS BUILT AROUND: VSYNC IS A QUANTISER ────────────────
 * On 2026-08-12 B2 measured the release exe at p50 31.23 ms with vsync on and
 * 17.04 ms with it off. The 31 ms was never a cost — it was 17 ms of work
 * missing a vblank and being charged a whole extra interval. Three readings
 * across two backends, two GPUs and three build profiles had all agreed at
 * ~31 ms, and that agreement was read as evidence of a shared cost. It was
 * three readings of the same quantiser.
 *
 * A head-to-head run under vsync would therefore compare two rounded numbers
 * and could report "identical" for a port that is twice the cost, or a 2x gap
 * for a difference of one millisecond. So:
 *
 *   1. Chrome is launched with `--disable-gpu-vsync --disable-frame-rate-limit`,
 *      and `connectRealGpu` now REFUSES to reuse a browser that lacks them —
 *      a switch enforced only on a cold launch does nothing on a warm one.
 *   2. Every reported side is checked for the quantiser signature anyway, on
 *      the discriminator that actually found it: the SPREAD, not the median.
 *      Work has variance; a present wait does not. p95 - p50 under ~1 ms is
 *      reported as CADENCE-BOUND and the number is not a work measurement.
 *
 * The check is kept even though the flags are enforced, because the flags are
 * a request to a GPU driver and this rig must not have to trust one.
 *
 * ── THE POSITIVE CONTROL, RUN ON THE DAY THIS WAS BUILT ────────────────────
 * `--vsync` is not a convenience flag, it is this rig's positive control, and
 * the first run of it is the argument for everything above. Tavern, same build,
 * same box, minutes apart:
 *
 *     vsync OFF    legacy p50  2.70    rust p50 16.00    ratio 5.93x
 *     vsync ON     legacy p50 31.30    rust p50 31.20    ratio 1.00x
 *
 * Both sides under vsync tripped the CADENCE-BOUND check (p95 - p50 of 0.30 and
 * 0.40 ms). **A head-to-head built without the flags would have reported the
 * port at parity with the oracle, to two decimal places, and it is 5.9x.** That
 * is not a hypothetical trap; it is what the default browser configuration
 * does to this measurement.
 *
 * ── WHAT THIS RIG DOES NOT ESTABLISH, STATED BECAUSE IT IS EASY TO ASSUME ──
 * A rAF delta is the cadence of the browser's frame callback. It is not a
 * split of CPU submission from GPU execution, and neither side is instrumented
 * for that. The comparison is fair in the way that matters — ONE browser, one
 * compositor, one pipeline, both subjects measured by the same relationship to
 * it — but "the port costs 5.9x" is a claim about frame cadence under an
 * unthrottled compositor, not a claim about where the milliseconds go.
 *
 * The evidence that legacy's number tracks presentation rather than a free-
 * running loop is the control above: throttle the compositor and legacy moves
 * to 31.30 with it. What is still open is a GPU-side split on both sides, which
 * needs timestamp queries the port does not yet emit. Do not read the ratio as
 * "the Rust renderer does 5.9x the work" until it exists.
 *
 * ── INTERLEAVED, BECAUSE THE BOX DRIFTS ────────────────────────────────────
 * The box is shared and its load moves over minutes. Run-then-run measures the
 * drift as if it were a difference between the sides. Each ROUND shoots legacy
 * then rust back to back; rounds repeat; the report is the MEDIAN ACROSS
 * ROUNDS per side with the across-round min/max beside it, so a reader can see
 * whether the gap is bigger than the wander.
 *
 * Percentiles are computed WITHIN a round and then taken across rounds. A
 * maximum of the maxima is not the maximum of the run, and a p95 of pooled
 * frames from a quiet round and a loaded one describes neither.
 *
 * ── WHAT IT REFUSES TO DO ──────────────────────────────────────────────────
 * - Report a side that produced fewer than `--min-frames` frames. A tab that
 *   rendered nine frames has not been measured, and a mean over nine is worse
 *   than no number because it looks like one.
 * - Compare across viewports. 1920x1080 is the one matched regime (zoom 1.0).
 * - Assert a budget. There is no baseline yet; this run IS the first one.
 *   Three green rounds on a quiet box, then band.
 *
 * Usage, from the repo root (legacy dev server must be up: `cd legacy && npm run dev`):
 *   node scripts/pk-perf-ab.mjs                       # tavern + dungeon, 3 rounds
 *   node scripts/pk-perf-ab.mjs --scene tavern
 *   node scripts/pk-perf-ab.mjs --rounds 5 --sample 6000
 *   node scripts/pk-perf-ab.mjs --no-build            # reuse web/dist
 *   node scripts/pk-perf-ab.mjs --vsync               # DELIBERATELY on (to reproduce the plateau)
 *   node scripts/pk-perf-ab.mjs --json out.json
 *
 * Exit 0 = both sides measured. Non-zero = a side could not be measured, or a
 * reported number is cadence-bound and therefore not a cost.
 */
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const { values: a } = parseArgs({
  options: {
    scene: { type: "string", default: "all" }, // tavern | dungeon | all
    rounds: { type: "string", default: "3" },
    sample: { type: "string", default: "5000" }, // ms of frames kept, per side per round
    warmup: { type: "string", default: "2500" }, // ms discarded before the sample
    "min-fps": { type: "string", default: "20" },
    level: { type: "string", default: "3" },
    seed: { type: "string", default: "1" },
    port: { type: "string", default: "8795" },
    "cdp-port": { type: "string", default: "9333" },
    "legacy-url": { type: "string" },
    "no-build": { type: "boolean", default: false },
    vsync: { type: "boolean", default: false },
    json: { type: "string" },
    out: { type: "string", default: join(ROOT, ".checks") },
  },
});

const VIEW_W = 1920;
const VIEW_H = 1080;
const ROUNDS = Number(a.rounds);
const SAMPLE_MS = Number(a.sample);
const WARMUP_MS = Number(a.warmup);
/**
 * The floor is a RATE, derived from the sample window — never a flat count.
 *
 * It shipped as a flat 120 and the vsync positive control immediately failed on
 * it: a 4 s sample at a 32 ms present interval can only ever hold ~125 frames,
 * so a perfectly healthy run was called "not a measurement" for obeying the
 * display. A threshold on a count is a threshold on the window length as much
 * as on the subject.
 */
const MIN_FPS = Number(a["min-fps"]);
const MIN_FRAMES = Math.max(30, Math.round((SAMPLE_MS / 1000) * MIN_FPS));
const LEVEL = Number(a.level);
const SEED = Number(a.seed);
const PORT = Number(a.port);
const FLOOR_LOCK_KEY = "pinball-knight-dev-floor-lock";

/** p95 - p50 below this reads as a present interval rather than as work. */
const CADENCE_SPREAD_MS = 1.0;

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".png": "image/png",
  ".css": "text/css",
};

const log = (m) => console.log(m);

/* ───────────────────────────── the instrument ───────────────────────────── */

/**
 * Installed at DOCUMENT START on both sides, so the very first frame either
 * app presents is already being counted. Deltas only — an absolute timestamp
 * would make the two sides' clocks part of the comparison.
 */
function installProbe(page) {
  return page.addInitScript(() => {
    window.__frames = [];
    let last = -1;
    const tick = (t) => {
      if (last >= 0) window.__frames.push(t - last);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/**
 * Discard `warmupMs`, then keep whatever lands in the next `sampleMs`.
 *
 * The warm-up is not politeness: a cold wasm boot's first two Bevy `Update`s
 * are ~2.5 s apart while shaders compile, and a p99 that includes a shader
 * compile is a measurement of a compile.
 */
async function sampleFrames(page, warmupMs, sampleMs) {
  await page.waitForTimeout(warmupMs);
  const mark = await page.evaluate(() => window.__frames.length);
  await page.waitForTimeout(sampleMs);
  return await page.evaluate((from) => window.__frames.slice(from), mark);
}

/* ─────────────────────────────── statistics ─────────────────────────────── */

const pct = (xs, q) => {
  if (!xs.length) return null;
  const s = [...xs].sort((x, y) => x - y);
  // Nearest-rank. With 300 samples the interpolation question is noise, and a
  // rank is a frame that actually happened.
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
};

function summarise(deltas) {
  return {
    n: deltas.length,
    p50: pct(deltas, 0.5),
    p95: pct(deltas, 0.95),
    p99: pct(deltas, 0.99),
    max: deltas.length ? Math.max(...deltas) : null,
    min: deltas.length ? Math.min(...deltas) : null,
  };
}

/** Median of a per-round series, with the across-round range beside it. */
function acrossRounds(values) {
  const ok = values.filter((v) => v != null);
  if (!ok.length) return null;
  return { med: pct(ok, 0.5), lo: Math.min(...ok), hi: Math.max(...ok), n: ok.length };
}

const f2 = (x) => (x == null ? "  —  " : x.toFixed(2));

/* ────────────────────────────── the two sides ───────────────────────────── */

async function openPage(ctx, errors, tag) {
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(`${tag}: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${tag}: PAGEERROR ${e.message}`));
  await installProbe(page);
  try {
    await page.setViewportSize({ width: VIEW_W, height: VIEW_H });
  } catch {
    /* assertViewport is the gate */
  }
  return page;
}

/** HARD gate: a frame timed at another size is not in the matched regime. */
async function assertViewport(page, side) {
  const got = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  if (got.w !== VIEW_W || got.h !== VIEW_H) {
    throw new Error(
      `${side}: viewport is ${got.w}x${got.h}, not ${VIEW_W}x${VIEW_H} — refusing to time outside the matched regime`,
    );
  }
}

async function timeLegacy(ctx, errors, url, scene) {
  const page = await openPage(ctx, errors, "legacy");
  await page.addInitScript(
    ([key, level]) => {
      window.__skipDungeonIntro = true;
      try {
        localStorage.setItem(key, String(level));
      } catch {
        /* private mode — the seed still pins the floor */
      }
    },
    [FLOOR_LOCK_KEY, LEVEL],
  );
  const u = new URL(url);
  u.searchParams.set("no-intro", "1");
  u.searchParams.set("mute", "1");
  u.searchParams.set("gpu", "webgpu");
  if (scene === "dungeon") {
    u.searchParams.set("autostart", "1");
    u.searchParams.set("seed", String(SEED));
  }
  await page.goto(u.toString(), { waitUntil: "domcontentloaded", timeout: 120_000 });
  // A BACKGROUNDED TAB HAS ITS rAF THROTTLED TO ~1 Hz. Every delta this rig
  // collects would then be a measurement of Chrome's background policy. This
  // is the single most important line in the file.
  await page.bringToFront();

  if (scene === "dungeon") {
    // The three conditions pk-ab-dungeon had to learn: the level is assigned
    // BEFORE the floor is built, so `level === want` alone times a loading card.
    await page.waitForFunction(
      (want) => {
        const boss = window.__dungeonBoss;
        const gui = window.__gui;
        const probe = window.__dungeonProbe;
        if (typeof boss !== "function" || typeof gui !== "function" || typeof probe !== "function") return false;
        try {
          if (boss().level !== want) return false;
          if (gui().open.includes("floor-loading")) return false;
          return probe().buffs !== null;
        } catch {
          return false;
        }
      },
      LEVEL,
      { timeout: 180_000 },
    );
  } else {
    await page.waitForFunction(
      () => typeof window.__tavernProbe === "function" && window.__tavernProbe().x !== null,
      { timeout: 180_000 },
    );
  }
  await assertViewport(page, "legacy");
  const deltas = await sampleFrames(page, WARMUP_MS, SAMPLE_MS);
  const backend = await page.evaluate(() => window.__renderBackendResolved ?? "unknown");
  await page.close();
  return { deltas, backend };
}

async function timeRust(ctx, errors, scene) {
  const page = await openPage(ctx, errors, "rust");
  const url =
    scene === "dungeon"
      ? `http://localhost:${PORT}/index.html?real-floor=1&level=${LEVEL}&seed=${SEED}&mute=1`
      : `http://localhost:${PORT}/index.html?tavern=1&mute=1`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.bringToFront();

  const pk = () => page.evaluate(() => (window.__pk ? JSON.parse(window.__pk) : null));
  let ready = null;
  for (let i = 0; i < 240 && !ready; i++) {
    await page.waitForTimeout(500);
    const s = await pk();
    if (s?.floorError) throw new Error(`rust: the floor was refused — ${s.floorError}`);
    // `.floor` is the GENERATOR's field and is null by design on an authored
    // floor — asking only for it is how a sibling rig read "no floor" over a
    // fully rendered dungeon.
    ready = scene === "dungeon" ? (s?.floor ?? s?.authoredFloor ?? null) : (s?.tavern ?? null);
  }
  if (!ready) throw new Error(`rust: ${scene} never became ready`);
  if (scene === "dungeon" && ready.level !== LEVEL) {
    throw new Error(`rust: booted level ${ready.level}, asked for ${LEVEL}`);
  }
  await assertViewport(page, "rust");
  const deltas = await sampleFrames(page, WARMUP_MS, SAMPLE_MS);
  // Read the port's OWN accumulator too — not to compare against legacy (that
  // would be two instruments again) but as a cross-check on this one. Two
  // independent measurements of the same frames should agree; if they do not,
  // the rAF probe is what is wrong.
  const last = await pk();
  const build = last?.perf ? { p50: last.perf.p50, p95: last.perf.p95, target: last.perf.target } : null;
  await page.close();
  return { deltas, selfPerf: build };
}

/* ──────────────────────────────── the run ──────────────────────────────── */

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

async function main() {
  await mkdir(a.out, { recursive: true });
  const scenes = a.scene === "all" ? ["tavern", "dungeon"] : [a.scene];
  for (const s of scenes) {
    if (s !== "tavern" && s !== "dungeon") throw new Error(`unknown scene "${s}" — tavern | dungeon | all`);
  }

  if (!a["no-build"]) {
    log("building (trunk, release — a debug frame is a different cost profile)...");
    execSync("trunk build --release", { cwd: ROOT, stdio: "inherit" });
  }
  if (!existsSync(join(ROOT, "web/dist/index.html"))) {
    throw new Error("web/dist/index.html missing — run trunk build --release");
  }
  const server = createServer(async (req, res) => {
    const p = join(ROOT, "web/dist", req.url === "/" ? "index.html" : req.url.split("?")[0]);
    try {
      const body = await readFile(p);
      res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  }).listen(PORT);

  const legacyUrl = await findLegacy();
  if (!legacyUrl) {
    server.close();
    throw new Error(
      "no legacy dev server on :5174 / :5199 / :3000 — start it with `cd legacy && npm run dev`, or pass --legacy-url",
    );
  }

  const { connectRealGpu, closeHostBrowser, rewriteForHostBrowser } = await import(
    "../legacy/scripts/lib/host-chrome.mjs"
  );
  // The flags are the whole methodology. `--vsync` keeps them off deliberately,
  // so the plateau can be REPRODUCED rather than argued about.
  const extraArgs = a.vsync ? [] : ["--disable-gpu-vsync", "--disable-frame-rate-limit"];
  const browser = await connectRealGpu({ port: Number(a["cdp-port"]), extraArgs });
  if (!browser) {
    server.close();
    throw new Error("no real-GPU host browser — SwiftShader cannot run the Bevy wasm app at all");
  }
  log(`▶ vsync ${a.vsync ? "ON (deliberate — expect the quantiser)" : "OFF"}   ${ROUNDS} rounds` +
      `   ${WARMUP_MS} ms warm-up + ${SAMPLE_MS} ms sample per side per round`);

  let ctx;
  let ownCtx = false;
  try {
    ctx = await browser.newContext({ viewport: { width: VIEW_W, height: VIEW_H } });
    ownCtx = true;
  } catch {
    ctx = browser.contexts()[0] ?? (await browser.newContext());
  }

  const errors = [];
  const rows = {}; // scene -> { legacy: [summary], rust: [summary] }
  let backend = "unknown";
  let selfPerf = null;

  try {
    for (const scene of scenes) {
      rows[scene] = { legacy: [], rust: [] };
      for (let r = 1; r <= ROUNDS; r++) {
        // INTERLEAVED: legacy then rust, inside the round. Run-then-run over
        // minutes measures the box's drift and calls it a difference.
        const L = await timeLegacy(ctx, errors, rewriteForHostBrowser(legacyUrl), scene);
        backend = L.backend;
        const R = await timeRust(ctx, errors, scene);
        if (R.selfPerf) selfPerf = R.selfPerf;
        const ls = summarise(L.deltas);
        const rs = summarise(R.deltas);
        rows[scene].legacy.push(ls);
        rows[scene].rust.push(rs);
        log(
          `  ${scene.padEnd(8)} round ${r}/${ROUNDS}   legacy p50 ${f2(ls.p50)} (${ls.n} frames)` +
            `   rust p50 ${f2(rs.p50)} (${rs.n} frames)`,
        );
      }
    }
  } finally {
    if (ownCtx) await ctx.close().catch(() => {});
    closeHostBrowser();
    server.close();
  }

  /* ───────────────────────────── the report ───────────────────────────── */

  console.log("");
  console.log(
    `PK PERF A/B — release wasm vs the TypeScript oracle, host Chrome, ${VIEW_W}x${VIEW_H}, ` +
      `vsync ${a.vsync ? "ON" : "OFF"}, legacy backend=${backend}`,
  );
  console.log("");
  console.log("scene     side     p50 (ms)   [lo..hi]        p95 (ms)   p99 (ms)   frames/round");
  console.log("--------  -------  ---------  --------------  ---------  ---------  ------------");

  const out = { at: new Date().toISOString(), vsync: a.vsync, view: `${VIEW_W}x${VIEW_H}`, rounds: ROUNDS, scenes: {} };
  let failures = 0;
  const warnings = [];

  for (const scene of scenes) {
    const summary = {};
    for (const side of ["legacy", "rust"]) {
      const rs = rows[scene][side];
      const p50 = acrossRounds(rs.map((x) => x.p50));
      const p95 = acrossRounds(rs.map((x) => x.p95));
      const p99 = acrossRounds(rs.map((x) => x.p99));
      const frames = acrossRounds(rs.map((x) => x.n));
      summary[side] = { p50, p95, p99, frames };
      console.log(
        `${scene.padEnd(8)}  ${side.padEnd(7)}  ${f2(p50?.med).padStart(9)}  ` +
          `[${f2(p50?.lo)}..${f2(p50?.hi)}]`.padEnd(16) +
          `${f2(p95?.med).padStart(9)}  ${f2(p99?.med).padStart(9)}  ${String(frames?.med ?? "—").padStart(12)}`,
      );
      // A SIDE THAT BARELY RENDERED IS NOT A SIDE THAT WAS MEASURED.
      if (!frames || frames.med < MIN_FRAMES) {
        console.log(
          `  FAIL  ${scene}/${side}: ${frames?.med ?? 0} frames per round, under the ${MIN_FRAMES} floor ` +
            `(${MIN_FPS} fps over a ${SAMPLE_MS} ms sample) — not a measurement`,
        );
        failures++;
      }
      // THE QUANTISER CHECK, on the discriminator that actually found it.
      if (p50?.med != null && p95?.med != null && p95.med - p50.med < CADENCE_SPREAD_MS) {
        const msg =
          `${scene}/${side}: p95 - p50 = ${(p95.med - p50.med).toFixed(2)} ms — CADENCE-BOUND. ` +
          `Work has variance; a present wait does not. This is a present interval, not a cost.`;
        if (a.vsync) warnings.push(`  note  ${msg} (expected: --vsync was passed)`);
        else {
          console.log(`  FAIL  ${msg}`);
          failures++;
        }
      }
    }
    const lp = summary.legacy.p50?.med;
    const rp = summary.rust.p50?.med;
    if (lp && rp) {
      // The ratio is reported with both spreads in view, because a 1.2x gap
      // between two numbers that each wandered 1.4x across rounds is not a gap.
      const wander = Math.max(
        (summary.legacy.p50.hi - summary.legacy.p50.lo) / lp,
        (summary.rust.p50.hi - summary.rust.p50.lo) / rp,
      );
      const ratio = rp / lp;
      summary.ratio = ratio;
      summary.wander = ROUNDS < 2 ? null : wander;
      // ⚠️ AT ONE ROUND THE WANDER IS 0 BY CONSTRUCTION, SO EVERY RATIO CLEARS
      // IT. A comparison whose significance test cannot fail is not a test —
      // it is the ratio printed twice. One round reports the number and
      // withholds the verdict.
      const verdict =
        ROUNDS < 2
          ? "NO VERDICT at 1 round — the wander is 0 by construction, not by measurement. Re-run with --rounds 3"
          : Math.abs(ratio - 1) <= wander
            ? "INSIDE the across-round wander — no gap is resolvable at this N"
            : ratio > 1
              ? "the PORT costs more"
              : "the PORT costs less";
      const wanderTxt = ROUNDS < 2 ? "unmeasured" : `${(wander * 100).toFixed(0)}%`;
      console.log(`          rust/legacy p50 = ${ratio.toFixed(2)}x   (round-to-round wander ${wanderTxt}) — ${verdict}`);
    }
    out.scenes[scene] = summary;
    console.log("");
  }

  for (const w of warnings) console.log(w);
  if (selfPerf) {
    console.log(
      `  note  cross-check — the port's own accumulator (__pk.perf, ${selfPerf.target}) last read ` +
        `p50 ${f2(selfPerf.p50)} / p95 ${f2(selfPerf.p95)}. Two instruments over the same frames should agree.`,
    );
  }
  console.log(
    "  note  NO BUDGET IS ASSERTED. This is the first head-to-head this project has\n" +
      "        ever taken. Three rounds on a quiet box, recorded, and then band it.",
  );
  if (errors.length) {
    console.log(`\nconsole errors (${errors.length}):`);
    for (const e of [...new Set(errors)].slice(0, 8)) console.log(`   ${e}`);
  }

  if (a.json) {
    await writeFile(a.json, JSON.stringify(out, null, 2));
    console.log(`\njson  ${a.json}`);
  }

  if (failures) {
    console.log(`\npk-perf-ab: ${failures} side(s) not measurable`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
