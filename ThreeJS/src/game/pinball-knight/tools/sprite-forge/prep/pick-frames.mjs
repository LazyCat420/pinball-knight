#!/usr/bin/env node
/**
 * CHOOSE THE 3-4 FRAMES A CLIP ACTUALLY SHIPS, out of the 21 Wan generates.
 *
 *   node prep/pick-frames.mjs <clipDir> --clip walk [--k 4]
 *   node prep/pick-frames.mjs --recipe dog E   > prep/recipe-dog-E.json
 *
 * ── WHY THIS EXISTS: 21 IS A CANDIDATE POOL, NOT A CLIP ─────────────────────
 *
 * Every shipped creature uses a handful of frames per clip:
 *
 *     brute    idle 2   walk 4   attack 4
 *     knight   idle 4   walk 3   run 3   attack 4   stumble 2   death 3
 *
 * Wan emits 21. So curation is not an afterthought, it is where a clip is
 * actually made — and it reframes most of what the generation gates flag.
 * The 2026-08-08 sweep produced `N:death` receding 72% of its box area ACROSS
 * 21 FRAMES at -5.87%/frame. Over the 3 frames that ship, that same slope is a
 * ~6% change: invisible. The recession was never the whole clip's problem, it
 * was a reason to pick from the front of it.
 *
 * ── WHAT IT OPTIMISES ───────────────────────────────────────────────────────
 *
 * Two competing things, which is why it is not just "take every Nth":
 *
 *   1. AREA CONSISTENCY. `drift.ts` registers cells by bounding box and
 *      baseline, so a figure that changes size between shipped cells is not a
 *      pose it can register — it is a different sprite. Frames are first
 *      filtered to those within AREA_TOL of the clip's median area, which
 *      drops the receding tail and the rocking extremes automatically.
 *   2. POSE DIFFERENCE. Within the survivors, pick the k frames that are most
 *      different from each other (greedy max-min churn). Adjacent frames are
 *      nearly identical; a clip of near-duplicates is the "frozen" failure
 *      arriving by a different road.
 *
 * Frames named by `ghost` or `fade` are excluded outright — those gates
 * already say which individual frames are damaged, and that information was
 * previously only ever read by a human.
 *
 * ── FRAME COUNT IS A FREQUENCY, NOT A CONSTANT ──────────────────────────────
 *
 * `engine/config.ts` gives each clip its own PLAYBACK RATE, so the number of
 * frames sets the duration:
 *
 *     idle 3fps   walk 8fps   run 10fps   attack 12fps
 *     stumble 9fps   crouch 7fps   death 6fps
 *
 * A dog's gallop cycle is ~0.35s. At run's 10fps that is 3-4 frames — which is
 * why the 21-frame run read as "rocking back and forth" (one stride stretched
 * over 2.1 seconds). DEFAULT_K below is each clip's period divided by its rate,
 * not a taste call.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require("canvas");

/** frames = intended duration x playback rate. See the header. */
export const DEFAULT_K = {
  idle: 4,      // 3fps  -> ~1.3s of breathing
  walk: 4,      // 8fps  -> 0.5s, half a stride each way
  run: 4,       // 10fps -> 0.4s, ~one gallop cycle
  attack: 4,    // 12fps -> 0.33s, a bite
  stumble: 3,   // 9fps  -> 0.33s, a flinch
  crouch: 3,    // 7fps  -> 0.43s vs LEAP_WINDUP 0.45s. Do not raise this.
  death: 4,     // 6fps  -> 0.67s of collapse
};

/** How far a frame's figure area may sit from the clip median and still ship. */
const AREA_TOL = 0.18;
const FIELD_TOL = 28;

async function raw(path) {
  const img = await loadImage(path);
  const c = createCanvas(img.width, img.height);
  c.getContext("2d").drawImage(img, 0, 0);
  return c.getContext("2d").getImageData(0, 0, img.width, img.height);
}

function fieldColour(d, w, h) {
  const ch = [[], [], []];
  const at = (x, y) => { const i = (y * w + x) * 4; ch[0].push(d.data[i]); ch[1].push(d.data[i + 1]); ch[2].push(d.data[i + 2]); };
  for (let x = 0; x < w; x++) { at(x, 0); at(x, h - 1); }
  for (let y = 0; y < h; y++) { at(0, y); at(w - 1, y); }
  return ch.map((c) => c.sort((a, b) => a - b)[c.length >> 1]);
}

function mask(d) {
  const { width: w, height: h, data } = d;
  const [fr, fg, fb] = fieldColour(d, w, h);
  const m = new Uint8Array(w * h);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0, p = 0; y < h; y++) {
    for (let x = 0; x < w; x++, p++) {
      const i = p * 4;
      const ink = Math.max(Math.abs(data[i] - fr), Math.abs(data[i + 1] - fg), Math.abs(data[i + 2] - fb)) > FIELD_TOL;
      if (ink) { m[p] = 1; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  return { m, w, h, area: x1 < 0 ? 0 : (x1 - x0 + 1) * (y1 - y0 + 1) };
}

/** Share of pixels differing between two masks — cheap pose distance. */
function poseDist(a, b) {
  let diff = 0, on = 0;
  for (let i = 0; i < a.m.length; i++) {
    if (a.m[i] || b.m[i]) on++;
    if (a.m[i] !== b.m[i]) diff++;
  }
  return on ? diff / on : 0;
}

/**
 * @param {string} clipDir
 * @param {{ k?: number, avoid?: number[] }} [opts] `avoid` is frame INDICES the
 *   gates named as damaged — ghost's and fade's `flagged` arrays.
 * @returns {Promise<{picked: string[], why: string}>} frame IDs, in order.
 */
export async function pickFrames(clipDir, opts = {}) {
  const { k = 4, avoid = [] } = opts;
  const names = readdirSync(clipDir).filter((f) => f.endsWith(".png")).sort();
  if (!names.length) throw new Error(`no PNGs in ${clipDir}`);
  const masks = [];
  for (const n of names) masks.push(mask(await raw(join(clipDir, n))));

  const areas = masks.map((x) => x.area);
  const sorted = [...areas].sort((a, b) => a - b);
  const med = sorted[sorted.length >> 1];

  // 1. area-consistent, and not named by a gate
  let idx = names.map((_, i) => i).filter((i) => Math.abs(areas[i] - med) / med <= AREA_TOL && !avoid.includes(i));
  const dropped = names.length - idx.length;
  // Never let the filters starve the pick — fall back to area order.
  if (idx.length < k) {
    idx = names.map((_, i) => i).sort((a, b) => Math.abs(areas[a] - med) - Math.abs(areas[b] - med)).slice(0, Math.max(k, 3));
  }

  // 2. greedy max-min pose distance, seeded at the most median-area frame
  const seed = idx.reduce((best, i) => (Math.abs(areas[i] - med) < Math.abs(areas[best] - med) ? i : best), idx[0]);
  const chosen = [seed];
  while (chosen.length < Math.min(k, idx.length)) {
    let best = null, bestD = -1;
    for (const i of idx) {
      if (chosen.includes(i)) continue;
      const d = Math.min(...chosen.map((c) => poseDist(masks[i], masks[c])));
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best === null) break;
    chosen.push(best);
  }
  chosen.sort((a, b) => a - b);

  // The recipe matches frames by the numeric run of the filename.
  const id = (n) => (/(\d{4,})/.exec(n) || [, n])[1];
  const swing = 1 - Math.min(...chosen.map((i) => areas[i])) / Math.max(...chosen.map((i) => areas[i]));
  return {
    picked: chosen.map((i) => id(names[i])),
    why: `${chosen.length} of ${names.length} · dropped ${dropped} on area/gates · picked swing ${(swing * 100).toFixed(1)}%`,
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
  const dir = args[0];
  if (!dir || dir.startsWith("--")) {
    console.error("usage: pick-frames.mjs <clipDir> [--clip walk] [--k 4] [--avoid 3,4,5]");
    process.exit(2);
  }
  const clip = opt("clip");
  const k = Number(opt("k", DEFAULT_K[clip] ?? 4));
  const avoid = (opt("avoid", "") || "").split(",").filter(Boolean).map(Number);
  const r = await pickFrames(dir, { k, avoid });
  console.log(JSON.stringify(r.picked));
  console.error(`  ${basename(dir)} -> ${r.why}`);
}
