#!/usr/bin/env node
/**
 * EVERY MOVE A CREATURE HAS, LAID OUT AT ONCE.
 *
 * The two existing tools each answer half a question and neither answers this
 * one:
 *
 *   clip-probe.mjs   "will this clip freeze?"  — resolution only, no pixels
 *   sprite-shot.mjs  a real screenshot — but of whatever the AI happened to do.
 *                    It cannot force a clip and cannot force a facing, which is
 *                    exactly the (clip x facing) composition that broke.
 *
 * This reads the atlas the RUNNING game built and crops the ACTUAL SHIPPED
 * TEXELS for every (facing, clip), in frame order, into one labelled sheet.
 * Deterministic, no gameplay, no AI: the same creature gives the same sheet
 * every time, so two runs can be diffed.
 *
 *   node scripts/moveset-lab.mjs --kind brute
 *   node scripts/moveset-lab.mjs --all
 *   node scripts/moveset-lab.mjs --kind brute --scale 6
 *
 * Writes `.moveset/<kind>.png` plus a motion report on stdout.
 *
 * ── THE MOTION REPORT, AND WHY IT DUPLICATES THE FORGE'S METRICS ────────────
 *
 * centroid-X drift, baseline bob and leg lean are the SAME three quantities
 * `driftRow`/`gaitSignals` compute in the forge (tools/sprite-forge/drift.ts).
 * That is deliberate, not an oversight. The forge measures the SOURCE SHEET
 * before registration; this measures the ATLAS after registration, the crush,
 * the palette snap and the pack. If the two disagree, one of those stages is
 * lying and you find out which — which is the whole reason `clip-probe.mjs`
 * reads the live atlas instead of re-deriving it.
 *
 * ⚠️ WSL2 has no GPU path to WebGPU; headless chromium falls back to
 * SwiftShader and renders a DIFFERENT image. Same CDP handshake the other
 * shot scripts use — reuse a live browser, or start one Windows-side.
 */
import { chromium } from "playwright";
import { parseArgs } from "node:util";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas, loadImage } from "canvas";

const { values: a } = parseArgs({
  options: {
    kind: { type: "string", default: "brute" },
    all: { type: "boolean", default: false },
    url: { type: "string", default: "http://localhost:5174/dungeon" },
    "cdp-port": { type: "string", default: process.env.BDB_CDP_PORT ?? "9345" },
    scale: { type: "string", default: "4" },
    out: { type: "string", default: ".moveset" },
  },
});

const SCALE = Math.max(1, Math.min(10, Number(a.scale) || 4));
const DIRS = ["S", "N", "E"];
const CLIPS = ["idle", "walk", "run", "attack", "stumble", "death"];

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${a["cdp-port"]}`);
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes("/dungeon")) ?? (await ctx.newPage());

// Always load fresh with the cache off — monster atlases are rasterised ONCE
// at boot and cached on `state`, so a page that is already sitting in the
// dungeon reports the atlas from whenever IT loaded. clip-probe.mjs shipped
// with that bug for one revision and reported byte-identical output across a
// reverted fix.
const cdp = await ctx.newCDPSession(page);
await cdp.send("Network.enable");
await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
await page.goto(`${a.url}?gpu=webgpu&seed=777&no-intro=1&t=${process.hrtime.bigint()}`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => typeof window.__dungeonClipCels === "function", null, { timeout: 60_000 });
// Imported art lands asynchronously and REBUILDS the atlas when it does.
await page.waitForTimeout(3500);

const kinds = a.all ? await page.evaluate(() => window.__lab.kinds()) : [a.kind];
if (!existsSync(a.out)) mkdirSync(a.out, { recursive: true });

for (const kind of kinds) {
  const data = await page.evaluate((k) => window.__dungeonClipCels(k), kind);
  if (!data) { console.log(`\n${kind}: no atlas`); continue; }

  const atlas = await loadImage(Buffer.from(data.atlas.split(",")[1], "base64"));
  const { cellW, cellH, cols, clips } = data;

  // Only the rows that exist, so a creature with four clips does not get six
  // bands of empty.
  const rows = [];
  for (const dir of DIRS) {
    for (const clip of CLIPS) {
      const idx = clips[`${dir}:${clip}`];
      if (idx?.length) rows.push({ dir, clip, idx });
    }
  }
  if (!rows.length) { console.log(`\n${kind}: atlas has no clips`); continue; }

  const maxFrames = Math.max(...rows.map((r) => r.idx.length));
  const LABEL_W = 130;
  const cw = cellW * SCALE, ch = cellH * SCALE;
  const sheet = createCanvas(LABEL_W + cw * maxFrames, ch * rows.length);
  const g = sheet.getContext("2d");
  g.imageSmoothingEnabled = false; // authored pixels stay square
  g.fillStyle = "#141414";
  g.fillRect(0, 0, sheet.width, sheet.height);

  const report = [];
  rows.forEach((row, ri) => {
    g.fillStyle = ri % 2 ? "#1b1b1b" : "#141414";
    g.fillRect(0, ri * ch, sheet.width, ch);
    g.fillStyle = "#cfcfcf";
    g.font = "16px monospace";
    g.fillText(`${row.dir}:${row.clip}`, 10, ri * ch + ch / 2);
    g.fillStyle = "#6f6f6f";
    g.font = "12px monospace";
    g.fillText(`${row.idx.length}f`, 10, ri * ch + ch / 2 + 18);

    const cx = [], feet = [], lean = [];
    row.idx.forEach((fi, ci) => {
      const sx = (fi % cols) * cellW;
      const sy = Math.floor(fi / cols) * cellH;
      g.drawImage(atlas, sx, sy, cellW, cellH, LABEL_W + ci * cw, ri * ch, cw, ch);

      // Measure from the atlas cell, not from the drawn scale-up.
      const tmp = createCanvas(cellW, cellH);
      const tg = tmp.getContext("2d");
      tg.drawImage(atlas, sx, sy, cellW, cellH, 0, 0, cellW, cellH);
      const px = tg.getImageData(0, 0, cellW, cellH).data;
      let sumX = 0, n = 0, low = -1, top = -1;
      for (let y = 0; y < cellH; y++) {
        for (let x = 0; x < cellW; x++) {
          if (px[(y * cellW + x) * 4 + 3] > 8) {
            sumX += x; n++;
            if (top < 0) top = y;
            low = y;
          }
        }
      }
      if (!n) return;
      cx.push(sumX / n / cellW - 0.5);
      feet.push(low);
      const hip = top + Math.floor((low - top) * 0.6);
      let L = 0, R = 0;
      for (let y = hip; y <= low; y++) {
        for (let x = 0; x < cellW; x++) {
          if (px[(y * cellW + x) * 4 + 3] > 8) (x < cellW / 2 ? L++ : R++);
        }
      }
      lean.push(L + R ? (L - R) / (L + R) : 0);
    });

    if (cx.length >= 2) {
      const span = Math.max(...cx) - Math.min(...cx);
      const bob = Math.max(...feet) - Math.min(...feet);
      const flips = lean.slice(1).filter((v, i) => (lean[i] > 0) !== (v > 0)).length;
      report.push(
        `  ${(row.dir + ":" + row.clip).padEnd(12)} ${String(row.idx.length).padStart(2)}f  ` +
          `centroid span ${span.toFixed(3)}  feet bob ${String(bob).padStart(2)}px  ` +
          `lean peak ${Math.max(...lean.map(Math.abs)).toFixed(2)} (${flips} flip${flips === 1 ? "" : "s"})`,
      );
    }
  });

  const file = join(a.out, `${kind}.png`);
  writeFileSync(file, sheet.toBuffer("image/png"));
  console.log(`\n${kind} — ${rows.length} rows, atlas ${cellW}x${cellH} per cel  ->  ${file}`);
  console.log(report.join("\n"));

  // The facings that are the SAME OBJECT, which is what "other facings reuse
  // it" looks like from the atlas side: identical index lists mean the game
  // will draw the creature's front while it walks east.
  const shared = [];
  for (const clip of CLIPS) {
    const seen = new Map();
    for (const dir of DIRS) {
      const k = (clips[`${dir}:${clip}`] ?? []).join(",");
      if (!k) continue;
      seen.set(k, [...(seen.get(k) ?? []), dir]);
    }
    for (const [, ds] of seen) if (ds.length > 1) shared.push(`${clip}: ${ds.join("=")}`);
  }
  if (shared.length) console.log(`  facings drawing IDENTICAL frames — ${shared.join("  ")}`);
}

await browser.close();
