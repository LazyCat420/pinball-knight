#!/usr/bin/env node
/**
 * Score a build's generated cells against their facing's master.
 *
 *     node scripts/score-build.mjs .build/knight_smoke5 idle:E walk:E
 *
 * Cuts each sheet into cells the same way the sheet tray does — one shared
 * canvas, feet on a shared baseline, so the cells are comparable to each other
 * as well as to the master — then hands the row to `op:"drift"`.
 *
 * The cropping happens HERE rather than as another pipeline op because it is
 * the same placement `JobsBoard.cutSheetToCells` already performs in the
 * browser; a third implementation of "put cells on one canvas" is a third thing
 * that can disagree about the baseline.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createCanvas, loadImage } from "canvas";

const API = process.env.FORGE_API ?? "http://127.0.0.1:5176";
const dir = process.argv[2];
const rows = process.argv.slice(3);
if (!dir || !rows.length) {
  console.error("usage: score-build.mjs <build-dir> <move:facing>...");
  process.exit(1);
}

const b64 = async (p) => `data:image/png;base64,${(await readFile(p)).toString("base64")}`;

async function post(body) {
  const r = await fetch(`${API}/api/comfy/pipeline`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
}

/** Cells placed, never rescaled: one canvas, centred, feet on a shared line. */
async function cellsOf(sheetPath, rects) {
  const img = await loadImage(sheetPath);
  const maxW = Math.max(...rects.map(([x0, , x1]) => x1 - x0));
  const maxH = Math.max(...rects.map(([, y0, , y1]) => y1 - y0));
  const padX = Math.ceil(maxW * 0.18), padTop = Math.ceil(maxH * 0.2), padBottom = Math.ceil(maxH * 0.06);
  const cw = maxW + padX * 2, ch = maxH + padTop + padBottom;
  return rects.map(([x0, y0, x1, y1]) => {
    const w = x1 - x0, h = y1 - y0;
    const cv = createCanvas(cw, ch);
    const ctx = cv.getContext("2d");
    ctx.drawImage(img, x0, y0, w, h, Math.round((cw - w) / 2), ch - padBottom - h, w, h);
    return cv.toDataURL("image/png");
  });
}

for (const row of rows) {
  const [move, facing] = row.split(":");
  const sheet = join(dir, `sheet-${move}-${facing}.png`);
  const cut = await post({ op: "cut", sheetB64: await b64(sheet), sidecar: { rows: [move] } });
  const rects = (cut.rows ?? []).flatMap((r) => r.cells);
  if (!rects.length) { console.log(`\n═══ ${move} ${facing} — NO CELLS`); continue; }

  const v = await post({
    op: "drift", clip: move, label: `${move} ${facing}`,
    masterB64: await b64(join(dir, `master-${facing}.png`)),
    cellsB64: await cellsOf(sheet, rects),
  });

  console.log(`\n═══ ${move} ${facing} — ${v.level.toUpperCase()}  (${rects.length} cells)`);
  v.frames.forEach((f, i) => {
    const bad = f.checks.filter((c) => !c.pass);
    console.log(`  key ${i + 1}: ${f.level}`);
    for (const c of bad) console.log(`     ${c.soft ? "!" : "✗"} ${c.label.padEnd(26)} ${c.value}   (want ${c.want})`);
  });
  for (const c of v.clip.checks.filter((c) => !c.pass)) {
    console.log(`  clip ${c.soft ? "!" : "✗"} ${c.label}: ${c.value}`);
  }
}
