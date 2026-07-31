#!/usr/bin/env node
/**
 * FX MOTION PROOF — does the effect actually MOVE, on a real GPU?
 *
 * ── WHY A SCREENSHOT IS NOT ENOUGH ──────────────────────────────────────────
 *
 * The elemental effects are TSL node graphs whose entire appeal is that they
 * change shape over time. The failure mode that costs the most is not a broken
 * shader — a broken shader is black and obvious. It is a shader whose CLOCK is
 * never advanced.
 *
 * A frozen shader renders a beautiful, plausible, completely static flame, with
 * no console error, no warning, and no visual defect in a single frame. Every
 * screenshot-based check passes it. Every unit test of the material passes it,
 * because the material is fine — nobody is calling the tick.
 *
 * That is not hypothetical here. TSL ships a `time` uniform which is fed by
 * `nodeFrame.update()`, and three calls that only from its own internal
 * animation loop. This game drives its own rAF and never calls
 * `setAnimationLoop` — the same root cause already produced a measured bug in
 * this repo where `info.render.drawCalls` accumulated for the life of the page,
 * because `info.reset()` lives one line above `nodeFrame.update()` in three's
 * loop. So a plausible, idiomatic implementation of these shaders renders
 * static, and only a motion check catches it.
 *
 * ── THE MEASUREMENT ─────────────────────────────────────────────────────────
 *
 *   1. spawn ONE decal of the kind under test, with a 999s life so nothing is
 *      fading — a fade would register as motion and pass a frozen shader
 *   2. capture N frames, GAP ms apart, cropped to a fixed box over the decal
 *   3. require every consecutive pair to differ by more than THRESH, and all N
 *      frame hashes to be distinct (so a 2-frame flip-book cannot pass)
 *
 * ── AND THE CONTROL, WHICH IS THE POINT ─────────────────────────────────────
 *
 *   4. `__fx.freeze()` pins the clock; capture again; require ZERO difference.
 *
 * Without step 4 the whole script is unfalsifiable: "the frames differ" is also
 * satisfied by camera drift, a passing particle, temporal dither, or a stray
 * animation elsewhere on screen. The frozen run is what proves the metric is
 * reading THIS SHADER. A check whose negative control has never been run red is
 * not a check.
 *
 * EXIT CODE IS THE CONTRACT: 0 only when the thawed run moves AND the frozen
 * run does not.
 *
 *   node scripts/fx-motion.mjs --url http://localhost:5199/dungeon --kind fire
 *   node scripts/fx-motion.mjs --kind slick --headed
 */
import { chromium } from "playwright";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
// `sharp` is already a dependency (the sprite-forge tooling uses it). Decoding
// with it rather than adding pngjs keeps this script dependency-neutral.
import sharp from "sharp";

const { values: a } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:5199/dungeon" },
    kind: { type: "string", default: "fire" },
    "cdp-port": { type: "string", default: process.env.BDB_CDP_PORT ?? "9345" },
    frames: { type: "string", default: "6" },
    gap: { type: "string", default: "120" },
    /** Minimum mean absolute channel difference between consecutive frames. */
    thresh: { type: "string", default: "1.5" },
    /**
     * How far the live effect must clear the frozen noise floor.
     *
     * The frozen run is NOT expected to be perfectly still: the torch
     * PointLights flicker off `state.elapsed`, which advances on every rendered
     * frame whether or not the sim is paused, and that reaches the crop through
     * the scene lighting and the bloom pass. So the honest gate is not "frozen
     * == 0" but "the shader dominates the ambient motion" — the frozen run
     * measures the noise floor and the live run has to clear it by this factor.
     */
    snr: { type: "string", default: "4" },
    out: { type: "string", default: ".fx-motion" },
    headed: { type: "boolean", default: false },
  },
});

const PORT = Number(a["cdp-port"]);
const FRAMES = Number(a.frames);
const GAP = Number(a.gap);
const THRESH = Number(a.thresh);
const MIN_SNR = Number(a.snr);

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

/** Same recipe as webgpu-check.mjs / playtest.mjs --gpu: the host's Chrome over
 *  CDP is the ONLY way to reach a real WebGPU adapter from WSL2. Playwright's
 *  bundled Chromium exposes navigator.gpu but returns a null adapter, so a run
 *  there would silently measure the WebGL2 path. */
async function connectHostGpu() {
  if (await cdpAlive(PORT)) {
    log(`▶ reusing CDP browser on :${PORT}`);
    return chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 120_000 });
  }
  const exe = WIN_CHROME.find((p) => existsSync(p));
  if (!exe) return null;
  log(`▶ launching host browser\n    ${exe}`);
  const p = spawn(
    exe,
    [
      a.headed ? "--new-window" : "--headless=new",
      "--mute-audio",
      `--remote-debugging-port=${PORT}`,
      "--remote-allow-origins=*",
      "--user-data-dir=C:\\Temp\\bdb-fx-motion",
      "--no-first-run",
      "--no-default-browser-check",
      "--enable-unsafe-webgpu",
      "--enable-features=Vulkan",
      "about:blank",
    ],
    { detached: true, stdio: "ignore" },
  );
  p.unref();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await cdpAlive(PORT)) return chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 120_000 });
  }
  return null;
}

/** PNG buffer → raw RGB bytes, so frames can be compared numerically. */
async function rgb(buf) {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

/** Mean absolute per-channel difference between two same-size frames. */
function meanAbsDiff(A, B) {
  if (A.w !== B.w || A.h !== B.h) throw new Error("frame size changed mid-capture");
  let sum = 0;
  for (let i = 0; i < A.data.length; i++) sum += Math.abs(A.data[i] - B.data[i]);
  return sum / A.data.length;
}

function hash(buf) {
  let h = 2166136261;
  for (let i = 0; i < buf.length; i += 97) h = ((h ^ buf[i]) * 16777619) >>> 0;
  return h.toString(16);
}

const browser = await connectHostGpu();
if (!browser) {
  console.error("\n✖ No host browser found. WebGPU cannot be verified from WSL2 without it.");
  process.exit(2);
}

const ctx = browser.contexts()[0] || (await browser.newContext());
const page = await ctx.newPage();
await page.setViewportSize({ width: 1280, height: 720 });

const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + String(e.message).slice(0, 200)));
page.on("console", (m) => {
  const t = m.text();
  // The dev server's HMR socket is not a renderer error, and letting it into
  // the gate would make every local run fail for a reason that has nothing to
  // do with the shaders — which trains you to ignore the gate.
  if (/\/ws|HMR|hot-update|websocket/i.test(t)) return;
  if (/error|invalid|failed|not compatible|WGSL/i.test(t)) errors.push(t.slice(0, 200));
});

// ?seed=777 pins the maze AND the biome — an unseeded run rolls a different
// theme and the comparison is worthless.
const url = new URL(a.url);
url.searchParams.set("gpu", "webgpu");
url.searchParams.set("seed", "777");
url.searchParams.set("no-intro", "1");
log(`▶ ${url}`);
await page.goto(url.toString(), { waitUntil: "domcontentloaded" });

// The renderer's init() is async and the first descent compiles shaders; both
// need real time. Poll rather than sleep — a fixed sleep either wastes seconds
// or races on a slow machine.
await page.waitForFunction(() => window.__renderBackendResolved != null, null, { timeout: 60_000 });
const backend = await page.evaluate(() => window.__renderBackendResolved);
log(`▶ backend resolved: ${backend}`);
if (backend !== "webgpu") {
  console.error(`\n✖ resolved ${backend}, not webgpu — this measurement would be about the fallback path.`);
  process.exit(3);
}

await page.waitForFunction(() => typeof window.__dungeonStartRun === "function", null, { timeout: 60_000 });
await page.evaluate(() => window.__dungeonStartRun());
await page.waitForFunction(() => window.__dungeonPlayer?.()?.active === true, null, { timeout: 90_000 });
log("▶ run active");

// First-visit descent needs time for pipeline compilation. The prewarm reveal
// is what compiles the elemental graphs; going straight to capture can measure
// frames rendered before the material exists.
await page.waitForTimeout(15_000);

await page.waitForFunction(() => typeof window.__fx === "function", null, { timeout: 10_000 });

/**
 * Isolate the subject.
 *
 * Every one of these steps exists because the first version of this script
 * FAILED ITS OWN FROZEN CONTROL — the crop contained the knight, the torch
 * flicker and the ember stream, so "the frames differ" was true no matter what
 * the shader did. Clear the room, push the decal well clear of the knight, and
 * PAUSE the sim so nothing but the shader is left moving.
 */
await page.evaluate(() => {
  window.__lab?.clear?.();
  window.__fx.clear();
  window.__fx.pause(true);
});
// Let the particles already in flight when the sim stopped die out, and let the
// follow-camera settle — a projection read mid-glide aims the crop at where the
// decal WAS.
await page.waitForTimeout(2500);

/**
 * FIND an offset whose decal actually lands fully on screen — do not assume one.
 *
 * The camera trails the player and the knight's spawn position varies with the
 * floor, so a hardcoded offset projects off-screen some of the time. When that
 * happened the crop silently clamped to the viewport edge, the script measured
 * bare floor, and it reported "the effect did not move" — a FALSE NEGATIVE
 * indistinguishable from the frozen-clock bug this script exists to catch.
 *
 * So: try candidates, keep the first that fits, and fail loudly if none do. A
 * broken measurement must never be reportable as a result.
 */
const CANDIDATES = [
  [-2.2, 2.2],
  [2.2, 2.2],
  [-2.2, -2.2],
  [2.2, -2.2],
  [0, 2.6],
  [0, -2.6],
  [-1.4, 1.4],
  [1.4, -1.4],
];

let spot = null;
let shaderBacked = false;
let view = { w: 1280, h: 720 };
const tried = [];

for (const [dx, dz] of CANDIDATES) {
  const probe = await page.evaluate(
    ({ kind, dx, dz }) => {
      window.__fx.clear();
      window.__fx.spawn(kind, dx, dz, 1.4, 999);
      return {
        list: window.__fx.list(),
        screen: window.__fx.screen(),
        view: { w: window.innerWidth, h: window.innerHeight },
      };
    },
    { kind: a.kind, dx, dz },
  );
  view = probe.view;
  shaderBacked = probe.list.some((d) => d.shader);
  const s = probe.screen[0];
  if (!s) continue;
  const m = Math.max(24, Math.round(s.px * 0.8));
  if (s.x - m >= 0 && s.y - m >= 0 && s.x + m <= view.w && s.y + m <= view.h) {
    spot = s;
    log(`▶ offset (${dx}, ${dz}) fits`);
    break;
  }
  tried.push(`(${dx},${dz})→(${s.x},${s.y})`);
}

if (!spot) {
  console.error(`\n✖ no spawn offset projected fully inside the ${view.w}x${view.h} viewport.`);
  console.error(`  tried: ${tried.join("  ")}`);
  console.error("  Not a shader failure — an invalid measurement. Is the camera following the player?");
  process.exit(4);
}
// Let the freshly-spawned decal finish its grow-in pop before measuring: the
// spawn animation is real motion and would inflate the first pair diffs.
await page.waitForTimeout(1200);
log(`▶ decal placed (${a.kind}) — shader-backed: ${shaderBacked}`);
log(`▶ on screen at (${spot.x}, ${spot.y}), radius ≈ ${spot.px}px`);

/**
 * Crop tightly to the projected decal — asked of the page rather than guessed,
 * so a camera-distance setting change cannot silently move the subject out of
 * the measured box while the numbers keep looking healthy.
 */
const half = Math.max(24, Math.round(spot.px * 0.8));
const CROP = {
  x: Math.max(0, spot.x - half),
  y: Math.max(0, spot.y - half),
  width: half * 2,
  height: half * 2,
};
log(`▶ crop ${CROP.width}x${CROP.height} at (${CROP.x}, ${CROP.y})`);

mkdirSync(a.out, { recursive: true });

async function capture(tag) {
  const shots = [];
  for (let i = 0; i < FRAMES; i++) {
    const buf = await page.screenshot({ clip: CROP });
    writeFileSync(`${a.out}/${a.kind}-${tag}-${i}.png`, buf);
    shots.push(buf);
    if (i < FRAMES - 1) await page.waitForTimeout(GAP);
  }
  const pix = [];
  for (const s of shots) pix.push(await rgb(s));
  const diffs = [];
  for (let i = 1; i < pix.length; i++) diffs.push(meanAbsDiff(pix[i - 1], pix[i]));
  return { diffs, hashes: shots.map(hash) };
}

log(`▶ capturing ${FRAMES} frames, ${GAP}ms apart — THAWED`);
const moving = await capture("thawed");

log("▶ freezing the clock — the negative control");
await page.evaluate(() => window.__fx.freeze());
await page.waitForTimeout(400);
const frozen = await capture("frozen");

const fmt = (d) => d.map((v) => v.toFixed(2)).join(", ");
const minMoving = Math.min(...moving.diffs);
const maxFrozen = Math.max(...frozen.diffs);
const distinct = new Set(moving.hashes).size;
const snr = maxFrozen > 0 ? minMoving / maxFrozen : Infinity;

log("\n═══════════════ FX MOTION REPORT ═══════════════");
log(`  kind                  : ${a.kind}`);
log(`  backend               : ${backend}`);
log(`  shader-backed         : ${shaderBacked}`);
log(`  THAWED  pair diffs    : ${fmt(moving.diffs)}`);
log(`  THAWED  min diff      : ${minMoving.toFixed(2)}   (need > ${THRESH})`);
log(`  THAWED  distinct      : ${distinct} / ${FRAMES}`);
log(`  FROZEN  pair diffs    : ${fmt(frozen.diffs)}`);
log(`  FROZEN  max (noise)   : ${maxFrozen.toFixed(2)}`);
log(`  SIGNAL / NOISE        : ${snr === Infinity ? "inf" : snr.toFixed(1)}x   (need > ${MIN_SNR})`);
log(`  frames written to     : ${a.out}/`);
log("════════════════════════════════════════════════");

if (errors.length) {
  log("\nrenderer/console errors:");
  for (const e of [...new Set(errors)].slice(0, 10)) log("   " + e);
}

const fail = [];
if (!shaderBacked) fail.push(`"${a.kind}" is not shader-backed — nothing to measure`);
if (minMoving <= THRESH) fail.push(`the effect did not move (min pair diff ${minMoving.toFixed(2)} <= ${THRESH}) — a FROZEN CLOCK looks exactly like this`);
if (distinct < FRAMES) fail.push(`only ${distinct} distinct frames of ${FRAMES} — a short loop or flip-book, not a live field`);
if (snr <= MIN_SNR) {
  fail.push(
    `signal/noise only ${snr.toFixed(1)}x (need > ${MIN_SNR}) — the frozen control moved nearly as much as ` +
      `the live one, so this measurement cannot distinguish the shader from the scene around it`,
  );
}
if (errors.length) fail.push(`${errors.length} renderer/console error line(s):\n       ${[...new Set(errors)].slice(0, 3).join("\n       ")}`);

if (fail.length) {
  console.error("\n✖ FAILED");
  for (const f of fail) console.error("   • " + f);
  process.exit(1);
}
log(`\n✔ ${a.kind} animates on WebGPU — ${snr === Infinity ? "no" : snr.toFixed(1) + "x above"} ambient scene motion.`);
process.exit(0);
