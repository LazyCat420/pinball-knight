#!/usr/bin/env node
/**
 * pk-ab-tavern — the tavern's visual-parity sign-off artifact.
 *
 * Puts the LEGACY TypeScript tavern and the RUST/Bevy tavern side by side at a
 * MATCHED camera regime and leaves three things behind in `.checks/`: the two
 * raw frames, a side-by-side, and a per-pixel absolute-difference heatmap. A
 * human judges 1:1 parity off those; the numbers below are the receipt, not the
 * verdict.
 *
 * ── WHY 1920x1080 AND NOTHING ELSE ──────────────────────────────────────────
 * Legacy derives its render target from `window.innerWidth/innerHeight` in CSS
 * px (devicePixelRatio is deliberately ignored — see pixel-pass.ts):
 *
 *     scale   = max(1, floor(min(w/1280, h/720)))
 *     renderW = evenCeil(w / scale)     renderH = evenCeil(h / scale)
 *
 * and the tavern then picks camera zoom 1.0 when `renderW/PPU >= 22.63 &&
 * renderH/PPU >= 16.45`, else 0.78 (`scenes/tavern/core.ts` fitZoom). At
 * 1920x1080 that is scale=1, a 1920x1080 target, and zoom EXACTLY 1 — one
 * render texel per screen pixel. That is the only regime in which the two
 * renderers are directly comparable, so the viewport is pinned there on BOTH
 * sides and ASSERTED before either shot. A 0.78 shot would be a resample of a
 * resample and any diff read off it would be measuring the upscaler.
 *
 * ── WHY NOT AN EXACT-FRAME MATCH ────────────────────────────────────────────
 * The room animates by design: hearth flicker, ember motes, the knight's idle
 * bob, NPC loops. Nothing lines the two clocks up, so the harness waits for a
 * SETTLED frame on each side (a ready signal plus a fixed settle) and the
 * numeric checks are all LOOSE and non-fatal by default. `--strict` makes them
 * fatal for a gate that wants a hard answer.
 *
 * ── REAL HOST CHROME, NEVER SWIFTSHADER ─────────────────────────────────────
 * Both sides run in the host's real GPU-backed Chrome over CDP via
 * `legacy/scripts/lib/host-chrome.mjs` — the same connection every other
 * harness here uses. SwiftShader cannot run the Bevy wasm app AT ALL (docs
 * Incidents), and it would not be a fair judge of a grade even if it could.
 *
 * ── HOW EACH SIDE IS DEEP-LINKED ────────────────────────────────────────────
 * RUST:   `?tavern=1` — the app's own boot gate (`tavern::tavern_boot_gate`).
 *         Ready when `JSON.parse(__pk).tavern` is non-null.
 * LEGACY: there is NO tavern-specific URL flag. There does not need to be: the
 *         legacy boot is hub-first exactly like the port's, so a skipped intro
 *         lands in `openLobby()` → `enterTavern(..., { lobby: true })`. The
 *         harness sets `window.__skipDungeonIntro = true` at document start
 *         (rather than `?autostart=1`, which schedules `beginRun()` and would
 *         walk straight back out of the room) and loads `?no-intro=1`.
 *         `__skipDungeonIntro` also makes `isHarnessEntry()` true, which
 *         suppresses the character-select modal that would otherwise sit over
 *         the room with nobody to click CONFIRM. Ready on the scene's own
 *         `tavern:first-present` performance mark plus a live `__tavernProbe()`.
 *
 * ── FOUR THINGS IN THE FRAME THAT ARE NOT THE ROOM ──────────────────────────
 * Expect these in the side-by-side and the heatmap. None is a parity defect,
 * and knowing them is the difference between reading the artifact and being
 * misled by it:
 *
 *   legacy top-right     "POOL · n" / "OFFLINE" pill. The legacy entry is the
 *                        multiplayer LOBBY (`enterTavern(..., { lobby: true })`)
 *                        and paints its HUD inside the pixel pass, so it cannot
 *                        be hidden with CSS. The port has not ported the lobby
 *                        HUD at all — scope, not a regression.
 *   legacy bottom-left   Next.js's dev-server indicator.
 *   rust top-centre      the Bevy frame-time/FPS readout.
 *   rust bottom-right    trunk's "built Nm ago" widget.
 *
 * The vignette check drops the top-right corner entirely (the pill is 164x26
 * and sits inside any reasonable sample block) and INSETS the other three by
 * 3% so the two dev-server widgets fall outside them.
 *
 * Usage, from the repo root:
 *   node scripts/pk-ab-tavern.mjs                 # trunk build + both sides
 *   node scripts/pk-ab-tavern.mjs --no-build      # reuse web/dist
 *   node scripts/pk-ab-tavern.mjs --rust-only     # one side, no comparison
 *   node scripts/pk-ab-tavern.mjs --strict        # numeric checks are fatal
 *
 * Exit 0 unless a HARD failure (a side would not boot, the wrong viewport, a
 * missing screenshot) or `--strict` with a failed numeric check.
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

// ── Image I/O: NO NEW DEPENDENCIES ──────────────────────────────────────────
// `legacy/node_modules` already carries sharp (used by cel-ab.mjs) and node
// `canvas` (the sprite forge's). Resolve them from the legacy package root —
// node's own resolution walks UP from this file and would never look sideways
// into `legacy/`. canvas is OPTIONAL: it only draws the side-by-side's labels,
// so a box without its native libs still gets every artifact, unlabelled.
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
    out: { type: "string", default: join(ROOT, ".checks") },
    /** Empty = probe the usual legacy dev ports. */
    "legacy-url": { type: "string", default: "" },
    /** NOT pk-check's 8791: the two harnesses have to be able to run at once. */
    port: { type: "string", default: "8792" },
    "cdp-port": { type: "string", default: process.env.BDB_CDP_PORT ?? "9333" },
    /** Post-ready settle, ms. The room's lights and atlases land late. */
    settle: { type: "string", default: "4500" },
    /**
     * Legacy pixels-per-world-unit. `CAMERA_ZOOM_DEFAULT = "wider"` → 56
     * (constants/render.ts CAMERA_ZOOMS). Only used to REPORT each side's
     * framing and to aim the hearth ROI; nothing gates on it.
     */
    ppu: { type: "string", default: "56" },
  },
});

const VIEW_W = 1920;
const VIEW_H = 1080;
const SETTLE_MS = Number(a.settle);
const PORT = Number(a.port);
const OUT = a.out;
const doLegacy = !a["rust-only"];
const doRust = !a["legacy-only"];
const STAMP = Date.now();

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".json": "application/json",
};

// ── The room, as both sides agree it is laid out ────────────────────────────
// pk-core/src/tavern/{layout,camera}.rs is a bit-exact port of
// legacy/src/scenes/tavern/{layout,core}.ts, so these constants describe BOTH.
const ROOM_CENTER_X = 0; // (ROOM_MIN_X + ROOM_MAX_X) / 2, = (-9 + 9) / 2
const ROOM_CENTER_Z = 0; // (ROOM_MIN_Z + ROOM_MAX_Z) / 2, = (-7 + 7) / 2
const CAM_LEAN = 0.72;
const CAM_TILT = (38 * Math.PI) / 180;
const CAM_YAW = (45 * Math.PI) / 180;
/** The hearth block's centre: `ROOM_MIN_X + 0.5`, mantel-ish height, z 0.2. */
const HEARTH = { x: -9 + 0.5, y: 1.2, z: 0.2 };
/** The port's tavern override: `ScalingMode::FixedVertical { 16.45 }`. */
const RUST_TAVERN_VIEW_H = 16.45;

function log(msg) {
  console.log(msg);
}

/* ────────────────────────────── projection ─────────────────────────────── */

/**
 * Where a world point lands in the frame, as fractions of width/height.
 *
 * Both renderers use the SAME rig — orthographic, tilt 38°, yaw 45°, aimed at
 * a point on the floor — so one implementation serves both and only the
 * visible world height differs. Derived rather than eyeballed because the two
 * sides frame the room at different scales (see `framing` in the report): a
 * hardcoded ROI would be aimed at the hearth on one side and at a wall on the
 * other, which is a probe that reads NEAR the target instead of at it.
 */
function projectFrac(p, aimX, aimZ, viewH, aspect) {
  const horiz = Math.cos(CAM_TILT);
  const off = [Math.sin(CAM_YAW) * horiz, Math.sin(CAM_TILT), Math.cos(CAM_YAW) * horiz];
  const f = off.map((v) => -v); // already unit length
  // right = normalize(cross(forward, up)), up = (0,1,0) → (-fz, 0, fx)
  const rr = [-f[2], 0, f[0]];
  const rl = Math.hypot(rr[0], rr[1], rr[2]);
  const r = rr.map((v) => v / rl);
  // camera up = cross(right, forward)
  const u = [
    r[1] * f[2] - r[2] * f[1],
    r[2] * f[0] - r[0] * f[2],
    r[0] * f[1] - r[1] * f[0],
  ];
  const d = [p.x - aimX, p.y, p.z - aimZ];
  const du = d[0] * r[0] + d[1] * r[1] + d[2] * r[2];
  const dv = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
  return { fx: 0.5 + du / (viewH * aspect), fy: 0.5 - dv / viewH };
}

/** The hearth ROI for a side, from its OWN framing and its live player pose. */
function hearthRoi(pose, viewH) {
  // `camera_target()` with no focused station: the aim leans CAM_LEAN of the
  // way from the room centre toward the player. Focus is ignored on purpose —
  // the ROI is padded well past the error that introduces.
  const aimX = ROOM_CENTER_X + ((pose?.x ?? 0) - ROOM_CENTER_X) * CAM_LEAN;
  const aimZ = ROOM_CENTER_Z + ((pose?.z ?? 0) - ROOM_CENTER_Z) * CAM_LEAN;
  const c = projectFrac(HEARTH, aimX, aimZ, viewH, VIEW_W / VIEW_H);
  const padX = 0.09;
  const padY = 0.11;
  return {
    x0: Math.max(0, c.fx - padX),
    x1: Math.min(1, c.fx + padX),
    y0: Math.max(0, c.fy - padY),
    y1: Math.min(1, c.fy + padY),
    cx: c.fx,
    cy: c.fy,
  };
}

/* ─────────────────────────────── image math ────────────────────────────── */

async function decode(file) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, ch: info.channels };
}

const lumaAt = (img, i) =>
  0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];

/**
 * The four readings, all off the pixels.
 *
 * distinctLuma  — how many distinct 8-bit luma values appear along a handful
 *                 of sampled rows. The cel grade posterises luma into ~10
 *                 rungs and runs LAST in the chain (…→ vignette → CEL GRADE),
 *                 so a graded frame lands in the tens; an ungraded one lands
 *                 in the hundreds. This is the single cheapest way to see from
 *                 outside whether the pixel pass is on, and it is the check
 *                 with real teeth — see POSTERISED_MAX.
 * vignette      — mean corner luma / mean centre luma. Strength 0.32, so a
 *                 vignetted frame reads well under 1. TOP-RIGHT IS EXCLUDED:
 *                 the legacy lobby's POOL pill lives there.
 *
 *                 ⚠ WEAK BY CONSTRUCTION AT THIS FRAMING. The room does not
 *                 reach the corners of a 1920x1080 frame — they are empty void
 *                 on BOTH sides — so this number is dominated by how much void
 *                 is in shot, not by the vignette. It is reported because it
 *                 is cheap and it would catch a gross exposure inversion, but
 *                 a matching ratio here is NOT evidence that the vignette pass
 *                 exists. The measured first run makes that concrete: the port
 *                 had no post-process at all and still scored 0.197 against the
 *                 oracle's 0.219.
 * meanLuma      — overall exposure. A large delta means the light rigs differ,
 *                 whatever else matches.
 * hearthBright  — share of the hearth ROI above 0.75 luma. Bloom needs a
 *                 bright CORE to bloom from, so its absence says the threshold
 *                 pass never fired (or the fire light is missing entirely).
 */
function measure(img, roi) {
  const { w, h, ch } = img;
  // Distinct luma along sampled rows.
  const rows = [0.2, 0.35, 0.5, 0.65, 0.8].map((f) => Math.floor(h * f));
  const seen = new Set();
  const perRow = [];
  for (const y of rows) {
    const rowSeen = new Set();
    for (let x = 0; x < w; x++) {
      const l = Math.round(lumaAt(img, (y * w + x) * ch));
      seen.add(l);
      rowSeen.add(l);
    }
    perRow.push(rowSeen.size);
  }

  // Block means. `block` is inclusive-exclusive in FRACTIONS of the frame.
  const blockMean = (x0, y0, x1, y1) => {
    const ax = Math.floor(x0 * w), bx = Math.ceil(x1 * w);
    const ay = Math.floor(y0 * h), by = Math.ceil(y1 * h);
    let s = 0, n = 0;
    for (let y = ay; y < by; y++) {
      for (let x = ax; x < bx; x++) {
        s += lumaAt(img, (y * w + x) * ch);
        n++;
      }
    }
    return s / Math.max(1, n);
  };

  // INSET by 3%: three different dev servers paint chrome hard against the
  // frame edges (Next's dev indicator bottom-left, trunk's "built Nm ago"
  // bottom-right, the legacy lobby's POOL pill top-right). An edge-hugging
  // sample block measures those. The top-right block is dropped outright
  // because the pill is 164x26 and no sane inset dodges it.
  const corners = [
    blockMean(0.03, 0.03, 0.13, 0.13), // top-left
    blockMean(0.03, 0.87, 0.13, 0.97), // bottom-left
    blockMean(0.87, 0.87, 0.97, 0.97), // bottom-right
  ];
  const cornerMean = corners.reduce((s, v) => s + v, 0) / corners.length;
  const centreMean = blockMean(0.35, 0.35, 0.65, 0.65);

  let sum = 0;
  for (let i = 0; i < w * h; i++) sum += lumaAt(img, i * ch);
  const meanLuma = sum / (w * h);

  // Hearth ROI brightness.
  const ax = Math.floor(roi.x0 * w), bx = Math.ceil(roi.x1 * w);
  const ay = Math.floor(roi.y0 * h), by = Math.ceil(roi.y1 * h);
  let bright = 0, roiN = 0, roiSum = 0, roiMax = 0;
  for (let y = ay; y < by; y++) {
    for (let x = ax; x < bx; x++) {
      const l = lumaAt(img, (y * w + x) * ch);
      roiSum += l;
      if (l > roiMax) roiMax = l;
      if (l / 255 > 0.75) bright++;
      roiN++;
    }
  }

  return {
    distinctLuma: seen.size,
    distinctPerRow: perRow,
    cornerMean,
    centreMean,
    vignetteRatio: cornerMean / Math.max(1e-6, centreMean),
    meanLuma,
    hearthBrightFrac: bright / Math.max(1, roiN),
    hearthMean: roiSum / Math.max(1, roiN),
    hearthMax: roiMax,
    roi,
  };
}

/** Black → blue → magenta → orange → white, so small diffs are still visible. */
const RAMP = [
  [0.0, [8, 8, 14]],
  [0.08, [26, 44, 120]],
  [0.25, [120, 40, 150]],
  [0.5, [230, 90, 40]],
  [0.8, [250, 200, 60]],
  [1.0, [255, 255, 235]],
];

function rampColour(t) {
  for (let i = 1; i < RAMP.length; i++) {
    if (t <= RAMP[i][0]) {
      const [t0, c0] = RAMP[i - 1];
      const [t1, c1] = RAMP[i];
      const k = (t - t0) / Math.max(1e-9, t1 - t0);
      return [0, 1, 2].map((j) => Math.round(c0[j] + (c1[j] - c0[j]) * k));
    }
  }
  return RAMP[RAMP.length - 1][1];
}

/**
 * The heatmap, and the diff numbers that go with it.
 *
 * Per pixel: the MAX absolute channel difference, so a hue shift at equal luma
 * still shows. Mapped through a perceptual-ish ramp because a plain grey diff
 * of an animated scene reads as an empty black frame and hides everything the
 * artifact exists to show.
 */
async function writeDiff(la, ra, file) {
  const w = Math.min(la.w, ra.w);
  const h = Math.min(la.h, ra.h);
  const out = Buffer.alloc(w * h * 3);
  let sum = 0, over32 = 0;
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
  let acc = 0, p95 = 255;
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
 * Side-by-side, with a label strip when node-canvas is available and the
 * hearth ROI outlined on each half.
 *
 * The outline is not decoration. The ROI is DERIVED (camera rig + the live
 * player pose + that side's own visible world height), and a derived ROI that
 * lands on a wall instead of the fire would report "no bright core" on a room
 * whose fire is burning fine. Drawing it makes the aim auditable by eye, which
 * is the only check available on a number computed from a projection.
 */
async function writeSideBySide(la, ra, file, captions, rois) {
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
  const outline = (img, roi, ox, oy) => {
    if (!roi) return;
    const x0 = Math.floor(roi.x0 * img.w), x1 = Math.ceil(roi.x1 * img.w) - 1;
    const y0 = Math.floor(roi.y0 * img.h), y1 = Math.ceil(roi.y1 * img.h) - 1;
    const px = (x, y) => {
      if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
      const o = ((y + oy) * w + (x + ox)) * 3;
      out[o] = 0;
      out[o + 1] = 255;
      out[o + 2] = 140;
    };
    for (let t = 0; t < 2; t++) {
      for (let x = x0; x <= x1; x++) {
        px(x, y0 + t);
        px(x, y1 - t);
      }
      for (let y = y0; y <= y1; y++) {
        px(x0 + t, y);
        px(x1 - t, y);
      }
    }
  };
  blit(la, 0, BAR);
  blit(ra, la.w + GUT, BAR);
  outline(la, rois?.[0], 0, BAR);
  outline(ra, rois?.[1], la.w + GUT, BAR);

  if (!canvasLib) {
    await sharp(out, { raw: { width: w, height: h, channels: 3 } }).png().toFile(file);
    return;
  }
  const cv = canvasLib.createCanvas(w, BAR);
  const g = cv.getContext("2d");
  g.fillStyle = "#141419";
  g.fillRect(0, 0, w, BAR);
  g.font = "bold 18px sans-serif";
  g.textBaseline = "middle";
  g.fillStyle = "#e8d8a8";
  g.fillText(captions[0], 14, BAR / 2);
  g.fillText(captions[1], la.w + GUT + 14, BAR / 2);
  const bar = await sharp(cv.toBuffer("image/png")).raw().toBuffer({ resolveWithObject: true });
  for (let y = 0; y < BAR; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * bar.info.width + x) * bar.info.channels;
      const o = (y * w + x) * 3;
      out[o] = bar.data[i];
      out[o + 1] = bar.data[i + 1];
      out[o + 2] = bar.data[i + 2];
    }
  }
  await sharp(out, { raw: { width: w, height: h, channels: 3 } }).png().toFile(file);
}

/* ────────────────────────────── page driving ───────────────────────────── */

/** A page pinned to the matched regime, with its console wired to `errors`. */
async function openPage(ctx, errors, tag, badUrls) {
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(`${tag}: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${tag}: PAGEERROR ${e.message}`));
  // A bare "Failed to load resource: 404" in the console names nothing, and a
  // tavern missing half its textures would still photograph as a tavern. Keep
  // the URLs so the report can say WHAT is missing.
  page.on("response", (r) => {
    if (r.status() >= 400) badUrls.add(`${r.status()} ${r.url()}`);
  });
  // Belt and braces: the context is already created at the target size, but a
  // CDP-attached default context can carry `viewport: null`, in which case this
  // is the only thing that sets it. Either way `assertViewport` is the gate —
  // this call failing is not itself a reason to stop.
  try {
    await page.setViewportSize({ width: VIEW_W, height: VIEW_H });
  } catch {
    /* assertViewport will catch it if the size is actually wrong */
  }
  return page;
}

/**
 * HARD gate. A frame shot at any other size is not a frame in the matched
 * regime, and every number below it would be measuring the fallback zoom.
 */
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
  // `__skipDungeonIntro` — NOT `?autostart=1`. Both skip the title sequence and
  // both suppress the character-select modal (`run/lobby.ts isHarnessEntry`),
  // but autostart also schedules `beginRun()` on the next frame, which walks
  // straight back out of the room we came to photograph.
  await page.addInitScript(() => {
    window.__skipDungeonIntro = true;
  });
  const u = new URL(url);
  u.searchParams.set("no-intro", "1");
  u.searchParams.set("mute", "1");
  u.searchParams.set("gpu", "webgpu");
  log(`▶ legacy: ${u}`);
  await page.goto(u.toString(), { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.bringToFront();

  // The scene's OWN ready signal: the perf mark `core.ts frame()` sets on the
  // first PRESENTED tavern frame. Anything earlier is the renderer-init gap,
  // which the player sees as black.
  await page.waitForFunction(
    () => performance.getEntriesByName("tavern:first-present").length > 0,
    null,
    { timeout: 180_000 },
  );
  await page.waitForFunction(
    () => typeof window.__tavernProbe === "function" && window.__tavernProbe().x !== null,
    null,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(SETTLE_MS);
  const vp = await assertViewport(page, "legacy");
  const probe = await page.evaluate(() => window.__tavernProbe());
  const backend = await page.evaluate(() => window.__renderBackendResolved ?? "unknown");
  const file = join(OUT, `ab-tavern-legacy-${STAMP}.png`);
  await page.screenshot({ path: file });
  await page.close();
  return { file, probe, backend, vp };
}

async function shootRust(ctx, errors, badUrls) {
  const page = await openPage(ctx, errors, "rust", badUrls);
  const url = `http://localhost:${PORT}/index.html?tavern=1`;
  log(`▶ rust:   ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.bringToFront();

  // `__pk` is published every 5 frames from `publish_stats`; `tavern` is
  // non-null only while `AppState::Tavern` owns the screen AND `TavernRes`
  // exists, i.e. the room is actually built.
  const pk = () => page.evaluate(() => (window.__pk ? JSON.parse(window.__pk) : null));
  let tav = null;
  for (let i = 0; i < 240 && !tav; i++) {
    await page.waitForTimeout(500);
    tav = (await pk())?.tavern ?? null;
  }
  if (!tav) throw new Error("rust: __pk.tavern never appeared — the tavern did not boot");
  await page.waitForTimeout(SETTLE_MS);
  const vp = await assertViewport(page, "rust");
  const probe = (await pk()).tavern;
  const file = join(OUT, `ab-tavern-rust-${STAMP}.png`);
  await page.screenshot({ path: file });
  await page.close();
  return { file, probe, vp };
}

/* ──────────────────────────────── the run ──────────────────────────────── */

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
  // A context BORN at 1920x1080 rather than resized into it: the CDP default
  // context can carry `viewport: null` (whatever the host window happens to
  // be), and a page that renders once at the wrong size before the override
  // lands is a page that built its render target for the wrong size.
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
    // One page at a time, each closed before the next opens: a backgrounded
    // tab in headless Chrome gets its rAF throttled, and a throttled tab is a
    // stale frame.
    if (doLegacy) legacy = await shootLegacy(ctx, errors, badUrls, rewriteForHostBrowser(legacyUrl));
    if (doRust) rust = await shootRust(ctx, errors, badUrls);
  } finally {
    if (ownCtx) await ctx.close().catch(() => {});
    closeHostBrowser();
    server?.close();
  }

  /* ── report ── */
  const ppu = Number(a.ppu);
  const legacyViewH = VIEW_H / ppu; // zoom 1, so the target IS the window
  const rustViewH = RUST_TAVERN_VIEW_H;
  let m = { legacy: null, rust: null };
  let imgs = { legacy: null, rust: null };

  console.log("");
  if (legacy) {
    imgs.legacy = await decode(legacy.file);
    m.legacy = measure(imgs.legacy, hearthRoi(legacy.probe, legacyViewH));
    log(`legacy  shot ${imgs.legacy.w}x${imgs.legacy.h}  backend=${legacy.backend}  camZoom=${legacy.probe.camZoom}`);
    log(`        pose x=${legacy.probe.x?.toFixed(2)} z=${legacy.probe.z?.toFixed(2)} focus=${legacy.probe.focus}`);
    log(`        framing: ${legacyViewH.toFixed(3)} world units tall (renderH ${VIEW_H} / PPU ${ppu}, zoom ${legacy.probe.camZoom})`);
    log(`        screenshot: ${legacy.file}`);
    if (legacy.probe.camZoom !== 1) {
      log(`  WARN  camZoom is ${legacy.probe.camZoom}, not 1 — this is NOT the 1:1 regime`);
    }
  }
  if (rust) {
    imgs.rust = await decode(rust.file);
    m.rust = measure(imgs.rust, hearthRoi(rust.probe, rustViewH));
    log(`rust    shot ${imgs.rust.w}x${imgs.rust.h}`);
    log(`        pose x=${rust.probe.x?.toFixed(2)} z=${rust.probe.z?.toFixed(2)} focus=${rust.probe.focus}`);
    log(`        framing: ${rustViewH.toFixed(3)} world units tall (ScalingMode::FixedVertical)`);
    log(`        screenshot: ${rust.file}`);
  }
  if (legacy && rust) {
    const ratio = legacyViewH / rustViewH;
    log(
      `\nFRAMING  legacy shows ${legacyViewH.toFixed(2)} world units tall, rust ${rustViewH.toFixed(2)} ` +
        `— rust is ${(ratio).toFixed(3)}x ${ratio > 1 ? "ZOOMED IN" : "zoomed out"} relative to the oracle` +
        `${Math.abs(ratio - 1) > 0.02 ? " (reported, not gated — it moves every pixel in the diff)" : ""}`,
    );
  }

  const table = (label, v, fmt) => {
    const l = m.legacy ? fmt(v(m.legacy)) : "   -";
    const r = m.rust ? fmt(v(m.rust)) : "   -";
    console.log(`  ${label.padEnd(26)} legacy ${l.padStart(10)}   rust ${r.padStart(10)}`);
  };
  console.log("\nREADINGS");
  table("distinct luma / rows", (x) => x.distinctLuma, (n) => String(n));
  table("  per-row", (x) => x.distinctPerRow.join(","), (s) => s);
  table("mean luma (0-255)", (x) => x.meanLuma, (n) => n.toFixed(2));
  table("corner mean (3 corners)", (x) => x.cornerMean, (n) => n.toFixed(2));
  table("centre mean", (x) => x.centreMean, (n) => n.toFixed(2));
  table("vignette corner/centre", (x) => x.vignetteRatio, (n) => n.toFixed(3));
  table("hearth ROI bright frac", (x) => x.hearthBrightFrac, (n) => n.toFixed(4));
  table("hearth ROI mean / max", (x) => `${x.hearthMean.toFixed(1)}/${x.hearthMax.toFixed(0)}`, (s) => s);
  table(
    "hearth ROI centre (frac)",
    (x) => `${x.roi.cx.toFixed(3)},${x.roi.cy.toFixed(3)}`,
    (s) => s,
  );

  /* ── composed artifacts ── */
  let sbs = null, diff = null, diffStats = null;
  if (legacy && rust) {
    sbs = join(OUT, `ab-tavern-sbs-${STAMP}.png`);
    await writeSideBySide(
      imgs.legacy,
      imgs.rust,
      sbs,
      [
        "LEGACY (TypeScript / three.js) — the oracle    [green box = hearth ROI]",
        "RUST (Bevy) — the port",
      ],
      [m.legacy.roi, m.rust.roi],
    );
    diff = join(OUT, `ab-tavern-diff-${STAMP}.png`);
    diffStats = await writeDiff(imgs.legacy, imgs.rust, diff);
    console.log("");
    log(`side-by-side: ${sbs}`);
    log(`diff heatmap: ${diff}`);
    log(
      `  |Δ| mean ${diffStats.mean.toFixed(1)}/255   p95 ${diffStats.p95}   ` +
        `${(diffStats.over32Frac * 100).toFixed(1)}% of pixels differ by >32`,
    );
  }

  /* ── the loose checks ── */
  console.log("\nCHECKS (non-fatal unless --strict)");
  let failed = 0;
  const check = (ok, msg) => {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`);
    if (!ok) failed++;
  };

  // ── POSTERISATION: AN ABSOLUTE GATE, NOT A RATIO ──────────────────────────
  //
  // This started life as "flag if rust has an ORDER OF MAGNITUDE more distinct
  // luma than legacy". The first real run measured 177 vs 18 — 9.83x — and
  // PASSED, on a port whose `PostPlugin` is a stub that registers one resource
  // and runs no passes at all. A threshold that green-lights a frame with no
  // pixel pass in it is not a check.
  //
  // So the gate is absolute and per side: the cel grade quantises luma to ~10
  // rungs and runs LAST, so a graded 1920-wide row cannot carry hundreds of
  // distinct values. POSTERISED_MAX is set well above the oracle's measured 18
  // (five full rows, unioned) and far below an ungraded frame's 177 — there is
  // an order of magnitude of daylight on each side of it, which is what makes
  // it a threshold rather than a coin flip. The ratio is still REPORTED,
  // because a port that posterises to the wrong number of rungs is a different
  // bug from one that does not posterise at all.
  const POSTERISED_MAX = 64;
  for (const [side, mm] of Object.entries(m)) {
    if (!mm) continue;
    check(
      mm.distinctLuma <= POSTERISED_MAX,
      `posterisation: ${side} carries ${mm.distinctLuma} distinct luma values over 5 sampled rows ` +
        `(cel-graded frames land near 10-20; over ${POSTERISED_MAX} means the pixel pass is not running)`,
    );
  }

  if (m.legacy && m.rust) {
    const ratio = m.rust.distinctLuma / Math.max(1, m.legacy.distinctLuma);
    log(`  ..    posterisation ratio rust/legacy = ${ratio.toFixed(2)}x (reported)`);
    const dv = Math.abs(m.rust.vignetteRatio - m.legacy.vignetteRatio);
    check(
      dv <= 0.25,
      `vignette: corner/centre ${m.rust.vignetteRatio.toFixed(3)} vs ${m.legacy.vignetteRatio.toFixed(3)} ` +
        `(Δ ${dv.toFixed(3)}, allow 0.25) — WEAK: the corners are void on both sides, see measure()`,
    );
    const dl = Math.abs(m.rust.meanLuma - m.legacy.meanLuma) / 255;
    check(dl <= 0.1, `exposure: mean luma Δ ${(dl * 100).toFixed(1)}% (allow 10%)`);
  }
  // PRESENCE, not parity: bloom needs something over the 0.7 threshold to
  // bloom FROM, and the hearth fire is the room's brightest source. A side
  // with no bright core there has lost the fire light, whatever else it has.
  // The magnitudes are reported rather than compared because the grade itself
  // moves them (the first run: ungraded rust 2.17% vs graded legacy 0.11%).
  for (const [side, mm] of Object.entries(m)) {
    if (!mm) continue;
    check(
      mm.hearthBrightFrac >= 0.0001,
      `hearth core: ${side} ROI has ${(mm.hearthBrightFrac * 100).toFixed(3)}% pixels over 0.75 luma, ` +
        `max ${mm.hearthMax.toFixed(0)}/255 (the fire is what bloom blooms from)`,
    );
  }

  if (errors.length) {
    console.log(`\n${errors.length} console/page error(s):`);
    for (const e of errors.slice(0, 8)) console.log("   ", e.slice(0, 220));
  }
  if (badUrls.size) {
    console.log(`\n${badUrls.size} failed request(s) — a side missing its art is not a side to judge:`);
    for (const u of [...badUrls].slice(0, 12)) console.log("   ", u.slice(0, 220));
  }

  const strictFail = a.strict && failed > 0;
  console.log(
    `\npk-ab-tavern: ${failed} numeric check(s) failed` +
      (strictFail ? " — --strict, failing the run" : " (non-fatal)"),
  );
  process.exit(strictFail ? 1 : 0);
}

main().catch((e) => {
  console.error("pk-ab-tavern HARD FAILURE:", e.message);
  process.exit(2);
});
