#!/usr/bin/env node
/**
 * pk-ab-dungeon — THE MEASUREMENT DEVICE THE DUNGEON NEVER HAD.
 *
 * Puts the LEGACY TypeScript dungeon and the RUST/Bevy dungeon side by side on
 * the SAME level and seed, and leaves three things in `.checks/`: the two raw
 * frames, a labelled side-by-side, and a per-pixel absolute-difference heatmap.
 *
 * ── WHY THIS EXISTS, WRITTEN DOWN BECAUSE IT IS THE WHOLE POINT ─────────────
 * The tavern has had `pk-ab-tavern.mjs` since the room was ported. The dungeon
 * has had nothing, so "does the dungeon look right" has been answered all day
 * by screenshots pasted into a chat window by hand. That is not a gate, and the
 * consequence was structural rather than cosmetic: work flowed toward the part
 * of the port that DID have a number attached — the bit-exact generator digests
 * — while the part a player actually looks at (textures, torches, props,
 * boosters) had no instrument at all and therefore no schedule pressure. Nine
 * of twenty-three generator passes are bit-exact and the screen has not changed
 * once. An unmeasured thing does not get built.
 *
 * So: this is built FIRST, before the art it is meant to judge, and every stage
 * of the visual port is signed off against the sheet it produces.
 *
 * ── THE TWO SIDES ARE NOT SHOWING THE SAME FLOOR YET, AND THAT IS EXPECTED ──
 * Legacy runs all 23 passes plus `decorateMaze`; the port runs 9 and no
 * decoration. So the FIRST sheets differ in geometry, not just in paint, and
 * the numbers below will be enormous. That is the honest starting point and it
 * is why the diff stats are REPORTED and never gate by default — `--strict`
 * exists for the day the two floors are the same floor (the authored-floor
 * bridge, see docs/src/status/build-out.md), and until then a hard gate here
 * would only teach people to pass `--no-strict`.
 *
 * ── HOW EACH SIDE IS PINNED TO ONE FLOOR ───────────────────────────────────
 * LEGACY: `?seed=<n>` pins `state.runSeed` (core.ts:174-178), and the dev floor
 *         lock — localStorage `pinball-knight-dev-floor-lock`, the funnel every
 *         descent passes through (dev/floor-lock.ts) — pins the level. Set at
 *         DOCUMENT START, because both are read during boot. `?autostart=1`
 *         then begins a run instead of stopping in the hub, which is the
 *         opposite of what the tavern rig wants and the reason this cannot
 *         simply reuse it.
 * RUST:   `?real-floor=1&level=<n>&seed=<n>` — the boot gate opens straight
 *         onto that floor (real_floor.rs).
 *
 * ── REAL HOST CHROME, NEVER SWIFTSHADER ────────────────────────────────────
 * Both sides run in the host's GPU-backed Chrome over CDP. SwiftShader cannot
 * run the Bevy wasm app at all (docs Incidents).
 *
 * Usage, from the repo root:
 *   node scripts/pk-ab-dungeon.mjs                    # trunk build + both sides
 *   node scripts/pk-ab-dungeon.mjs --no-build
 *   node scripts/pk-ab-dungeon.mjs --level 3 --seed 1
 *   node scripts/pk-ab-dungeon.mjs --rust-only        # one side, no comparison
 *   node scripts/pk-ab-dungeon.mjs --strict           # diff stats are fatal
 *   node scripts/pk-ab-dungeon.mjs --rust-floor       # the GENERATOR's floor,
 *                                                    # not the authored one
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

// Same dependency story as pk-ab-tavern: sharp and (optionally) node-canvas
// already live in `legacy/node_modules`, and node's resolution walks UP from
// this file so it would never find them sideways.
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
    /**
     * Shoot the ported GENERATOR's floor instead of the authored one.
     *
     * The default changed with the authored-floor bridge: the right-hand side
     * is now the oracle's own floor, so the two sides are the same floor and
     * the diff is about PAINT. Pass this when the generator is what is under
     * test — the sheets will differ in geometry again, which is correct and is
     * what the header's "not the same floor yet" paragraph is about.
     */
    "rust-floor": { type: "boolean", default: false },
    strict: { type: "boolean", default: false },
    out: { type: "string", default: join(ROOT, ".checks") },
    "legacy-url": { type: "string", default: "" },
    /** Not pk-check's 8791 and not pk-ab-tavern's 8792: all three may run at once. */
    port: { type: "string", default: "8793" },
    "cdp-port": { type: "string", default: process.env.BDB_CDP_PORT ?? "9333" },
    level: { type: "string", default: "3" },
    seed: { type: "string", default: "1" },
    /** Post-ready settle, ms. Torch lights and atlases land late on both sides. */
    settle: { type: "string", default: "4500" },
  },
});

const VIEW_W = 1920;
const VIEW_H = 1080;
const LEVEL = Number(a.level);
const SEED = Number(a.seed);
const SETTLE_MS = Number(a.settle);
const PORT = Number(a.port);
const RUST_FLOOR = a["rust-floor"];
const OUT = a.out;
const doLegacy = !a["rust-only"];
const doRust = !a["legacy-only"];
const STAMP = `L${LEVEL}-s${SEED}`;
if (!Number.isInteger(LEVEL) || LEVEL < 1) throw new Error("--level wants an integer >= 1");
if (!Number.isInteger(SEED)) throw new Error("--seed wants an integer");

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".json": "application/json",
};

/** The legacy dev floor lock's localStorage key (dev/floor-lock.ts). */
const FLOOR_LOCK_KEY = "pinball-knight-dev-floor-lock";

const log = (m) => console.log(m);

/* ─────────────────────────────── image I/O ─────────────────────────────── */

async function decode(file) {
  const img = sharp(file);
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, ch: info.channels };
}

/** Black → blue → yellow → red. Same ramp as the tavern rig, so the two
 *  heatmaps are read with one eye. */
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
  // p95 off the histogram — no sort of a two-million-element array.
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

/**
 * The artifact a human actually reads: both frames, captioned, side by side.
 *
 * Captions matter more here than in the tavern rig. Two grey dungeons at
 * different zoom levels are genuinely hard to tell apart at a glance, and a
 * sheet whose halves might be the wrong way round is worse than no sheet.
 */
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

async function shootLegacy(ctx, errors, badUrls, url) {
  const page = await openPage(ctx, errors, "legacy", badUrls);
  // BOTH pins go in at document start: the seed is read during `core.ts` boot
  // and the floor lock during the first descent, and a value written after
  // either would be read on the NEXT run rather than this one.
  await page.addInitScript(
    ([key, level]) => {
      window.__skipDungeonIntro = true;
      try {
        localStorage.setItem(key, String(level));
      } catch {
        /* private mode — the lock is best-effort, the seed still pins the floor */
      }
    },
    [FLOOR_LOCK_KEY, LEVEL],
  );
  const u = new URL(url);
  u.searchParams.set("no-intro", "1");
  u.searchParams.set("autostart", "1"); // begin a RUN — the opposite of the tavern rig
  u.searchParams.set("seed", String(SEED));
  u.searchParams.set("mute", "1");
  u.searchParams.set("gpu", "webgpu");
  log(`▶ legacy: ${u}`);
  await page.goto(u.toString(), { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.bringToFront();

  // Ready = the run is IN the dungeon, on the level we asked for, AND the floor
  // is finished.
  //
  // ⚠️ THREE CONDITIONS, AND THE FIRST VERSION HAD ONLY ONE. Waiting on
  // `__dungeonBoss().level === want` alone photographed the legacy game's own
  // loading card — "DESCENDING / DEPTH 3 / FORGING THE MACHINE / 90%" — because
  // `state.level` is assigned before the floor is built, not after. The very
  // first sheet this rig produced was a loading screen next to a dungeon, with
  // a diff of 28.5% that meant nothing at all. So the gate also requires the
  // `floor-loading` screen to be OFF the GUI stack (`__gui().open`, gui-hooks)
  // and a live player to exist.
  await page.waitForFunction(
    (want) => {
      const boss = window.__dungeonBoss;
      const gui = window.__gui;
      const probe = window.__dungeonProbe;
      if (typeof boss !== "function" || typeof gui !== "function" || typeof probe !== "function") {
        return false;
      }
      try {
        if (boss().level !== want) return false;
        if (gui().open.includes("floor-loading")) return false;
        // A player object is the cheapest proof the floor was populated rather
        // than merely allocated.
        return probe().buffs !== null;
      } catch {
        return false;
      }
    },
    LEVEL,
    { timeout: 180_000 },
  );
  await page.waitForTimeout(SETTLE_MS);
  const vp = await assertViewport(page, "legacy");
  const probe = await page.evaluate(() => {
    const b = window.__dungeonBoss();
    return { level: b.level, stairs: b.stairs, player: b.player };
  });
  const backend = await page.evaluate(() => window.__renderBackendResolved ?? "unknown");
  const file = join(OUT, `ab-dungeon-${STAMP}-legacy.png`);
  await page.screenshot({ path: file });
  await page.close();
  return { file, probe, backend, vp };
}

async function shootRust(ctx, errors, badUrls) {
  const page = await openPage(ctx, errors, "rust", badUrls);
  // TWO FLOOR SOURCES, and the URL says which. The default is the AUTHORED
  // floor — the oracle's own finished floor, loaded from `assets/floors/` —
  // which is the whole reason this rig can now compare like with like: before
  // the bridge, the left side ran 23 passes plus `decorateMaze` and the right
  // side ran 9, so the sheets differed in GEOMETRY and the numbers were
  // meaningless. `--rust-floor` shoots the ported generator's own floor
  // instead, which is what you want when the thing under test is the generator.
  const url =
    `http://localhost:${PORT}/index.html?real-floor=1&level=${LEVEL}&seed=${SEED}&mute=1` +
    (RUST_FLOOR ? "&rust-floor=1" : "");
  log(`▶ rust:   ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.bringToFront();

  const pk = () => page.evaluate(() => (window.__pk ? JSON.parse(window.__pk) : null));
  let floor = null;
  let source = null;
  for (let i = 0; i < 240 && !floor; i++) {
    await page.waitForTimeout(500);
    const s = await pk();
    if (s?.floorError) throw new Error(`rust: the floor was refused — ${s.floorError}`);
    // Either source counts as "a floor is installed". Asking only for `.floor`
    // is how this gate read "no floor was installed" over a fully rendered
    // authored dungeon — the field is the GENERATED floor's, and it is `null`
    // by design when the generator is not the source.
    floor = s?.floor ?? s?.authoredFloor ?? null;
    source = s?.floorSource ?? null;
  }
  if (!floor) {
    throw new Error("rust: neither __pk.floor nor __pk.authoredFloor appeared — no floor installed");
  }
  const wantSource = RUST_FLOOR ? "generated" : "authored";
  if (source !== wantSource) {
    throw new Error(`rust: floor source is "${source}", asked for "${wantSource}"`);
  }
  log(`▶ rust:   source=${source} level=${floor.level} ${floor.w ?? "?"}x${floor.h ?? "?"}`);
  if (floor.level !== LEVEL) {
    throw new Error(`rust: booted level ${floor.level}, asked for ${LEVEL}`);
  }
  await page.waitForTimeout(SETTLE_MS);
  const vp = await assertViewport(page, "rust");
  const file = join(OUT, `ab-dungeon-${STAMP}-rust.png`);
  await page.screenshot({ path: file });
  // READ THE PROBE BEFORE CLOSING. The first version of this line evaluated
  // after `page.close()` and failed with "Target page, context or browser has
  // been closed" — which reads like the app crashed, and the screenshot on disk
  // says it did not.
  const last = await pk();
  // The probe is whichever source is installed — `.floor` for the generator,
  // `.authoredFloor` for the oracle's export. They carry different fields on
  // purpose (a pass count vs a content census), so `source` rides along and the
  // reader below branches on it rather than guessing from the shape.
  const probe = last.floor ?? last.authoredFloor;
  await page.close();
  return { file, probe, source, vp };
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
          "`cd legacy && npm run dev` (it serves the game at `/`, NOT `/dungeon`), " +
          "or pass --legacy-url",
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
    ctx = await browser.newContext({ viewport: { width: VIEW_W, height: VIEW_H } });
    ownCtx = true;
  } catch {
    ctx = browser.contexts()[0] ?? (await browser.newContext());
  }
  const errors = [];
  const badUrls = new Set();

  let legacy = null;
  let rust = null;
  try {
    // One page at a time, each closed before the next opens: a backgrounded tab
    // has its rAF throttled, and a throttled tab hands back a stale frame.
    if (doLegacy) legacy = await shootLegacy(ctx, errors, badUrls, rewriteForHostBrowser(legacyUrl));
    if (doRust) rust = await shootRust(ctx, errors, badUrls);
  } finally {
    if (ownCtx) await ctx.close().catch(() => {});
    closeHostBrowser();
    server?.close();
  }

  /* ── report ── */
  console.log("");
  let imgs = { legacy: null, rust: null };
  if (legacy) {
    imgs.legacy = await decode(legacy.file);
    log(
      `legacy  ${imgs.legacy.w}x${imgs.legacy.h}  backend=${legacy.backend}  ` +
        `level=${legacy.probe.level}  stairs=${JSON.stringify(legacy.probe.stairs)}`,
    );
    log(`        ${legacy.file}`);
  }
  if (rust) {
    imgs.rust = await decode(rust.file);
    log(
      `rust    ${imgs.rust.w}x${imgs.rust.h}  ${rust.probe.w}x${rust.probe.h}  ` +
        `source=${rust.source}  archetype=${rust.probe.archetype}  ` +
        (rust.source === "authored"
          ? `torches=${rust.probe.torches} parts=${rust.probe.parts}` +
            // Live vs planned, because they are different numbers: ten of the
            // seventeen exported kinds are P1 verbs that draw and do nothing.
            // A sheet that recorded only `parts` could not tell a wired machine
            // from the diorama the floor was until 2026-08-12.
            `(${rust.probe.liveParts ?? 0} live) props=${rust.probe.props}`
          : `pass=P${rust.probe.pass}`),
    );
    log(`        ${rust.file}`);
  }

  let stats = null;
  if (imgs.legacy && imgs.rust) {
    const sheet = join(OUT, `ab-dungeon-${STAMP}.png`);
    await writeSideBySide(imgs.legacy, imgs.rust, sheet, [
      `LEGACY  L${LEVEL} seed ${SEED}  (23 passes + decorateMaze)`,
      rust.source === "authored"
        ? `RUST    L${LEVEL} seed ${SEED}  (authored floor: ${rust.probe.torches} torches, ` +
          `${rust.probe.parts} parts, ${rust.probe.props} props)`
        : `RUST    L${LEVEL} seed ${SEED}  (generated, P${rust.probe.pass}, no decoration)`,
    ]);
    const heat = join(OUT, `ab-dungeon-${STAMP}-diff.png`);
    stats = await writeDiff(imgs.legacy, imgs.rust, heat);
    console.log("");
    log(`side-by-side  ${sheet}`);
    log(`heatmap       ${heat}`);
    log(
      `diff          mean ${stats.mean.toFixed(1)}  p95 ${stats.p95}  ` +
        `over32 ${(stats.over32Frac * 100).toFixed(1)}%`,
    );
    console.log("");
    log("  note  LOOK AT THE SHEET. Until the port renders the same floor as the");
    log("        oracle these numbers are measuring two different dungeons, and");
    log("        the only honest reading is the picture.");
  }

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
  // comparing. The diff stats are soft unless --strict, for the reason in the
  // header: the two sides are not showing the same floor yet.
  const hard = errors.length > 0;
  if (a.strict && stats && stats.over32Frac > 0.02) {
    log(`STRICT: ${(stats.over32Frac * 100).toFixed(1)}% of pixels differ by more than 32`);
    process.exit(1);
  }
  process.exit(hard ? 1 : 0);
}

main().catch((e) => {
  console.error(String(e?.stack ?? e));
  process.exit(1);
});
