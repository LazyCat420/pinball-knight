#!/usr/bin/env node
/**
 * MEGA MAP — build one oversized floor, render it, and census what it repeats.
 *
 * The debugging surface for "it's just random walls jumbled together". See
 * `src/game/pinball-knight/dev/mega-floor.ts` for why the answer is one big
 * floor rather than a contact sheet of small ones, and
 * `dev/pattern-census.ts` for what each number means.
 *
 * Like `circuit-census.mjs` and unlike `floor-census.mjs`, this drives NO
 * browser: the generator and the decoration pass are pure and importable, so
 * Chrome would add a dependency without adding fidelity.
 *
 *     node scripts/mega-map.mjs                       # 3x floor, L5, SVG + report
 *     node scripts/mega-map.mjs --scale 5 --level 3
 *     node scripts/mega-map.mjs --cells 200x150 --seed 1234
 *     node scripts/mega-map.mjs --density raw         # show the dilution
 *     node scripts/mega-map.mjs --json out.json       # machine-readable census
 *
 * Output lands in `debug/mega-map/` unless `--out` says otherwise.
 */
import { parseArgs } from "node:util";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const { values: a } = parseArgs({
  options: {
    level: { type: "string", default: "5" },
    seed: { type: "string", default: String(0x6057) },
    /** Multiple of the SHIPPED cell grid for this level. 3 = ~9x the area. */
    scale: { type: "string", default: "3" },
    /** Explicit cell grid, `WxH`. Overrides --scale. */
    cells: { type: "string" },
    density: { type: "string", default: "shipped" },
    out: { type: "string" },
    json: { type: "string" },
    /** Pixels per tile in the SVG. */
    px: { type: "string", default: "4" },
    /** Skip the SVG (census only) — the render is the slow half at 10x. */
    "no-svg": { type: "boolean", default: false },
    /** Skip the shipped-size reference floor. Only when you already know the
     *  statistic is scale-free — otherwise this is how a harness artefact
     *  becomes a bug report. */
    "no-compare": { type: "boolean", default: false },
    /** Rasterise the SVG too — for looking at, pasting, or handing to an agent. */
    png: { type: "boolean", default: false },
    /** Render only a tile window: `i,j,w,h`. The overview says where to look. */
    crop: { type: "string" },
  },
});

const dir = mkdtempSync(join(tmpdir(), "mega-map-"));
const outfile = join(dir, "mega.mjs");
let mod;
try {
  await build({
    entryPoints: [join(ROOT, "src/game/pinball-knight/dev/mega-entry.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    logLevel: "warning",
  });
  mod = await import(pathToFileURL(outfile).href);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const { buildMegaFloor, renderFloorSvg, censusPatterns, formatCensus } = mod;

const level = Number(a.level);
const runSeed = Number(a.seed);
let cellsW, cellsH;
if (a.cells) {
  const m = /^(\d+)x(\d+)$/.exec(a.cells.trim());
  if (!m) {
    console.error("--cells wants WxH, e.g. 200x150");
    process.exit(2);
  }
  cellsW = Number(m[1]);
  cellsH = Number(m[2]);
}

console.log(`▶ building L${level} seed=${runSeed} ${a.cells ?? `scale x${a.scale}`} density=${a.density}…`);
const t0 = Date.now();
const floor = buildMegaFloor({
  level,
  runSeed,
  cellsW,
  cellsH,
  scale: a.cells ? undefined : Number(a.scale),
  density: a.density,
});
if (!floor) {
  console.error("✗ the generator DECLINED this size — buildTrackFloor returned null.");
  console.error("  That is a real result: record the size, do not retry with a different seed silently.");
  process.exit(1);
}
console.log(
  `  ${floor.grid.w}x${floor.grid.h} tiles · walkable ${floor.walkable} (${floor.areaRatio.toFixed(1)}x a shipped L${level})` +
    ` · ${floor.archetype}/${floor.theme}/${floor.modifier}`,
);
console.log(`  parts ${floor.plan.parts.length} (budget ${floor.partBudget}) · track ${floor.timing.track}ms · decorate ${floor.timing.decorate}ms`);
if (floor.relaxed.length) console.log(`  relaxed: ${floor.relaxed.join(", ")}`);

const outDir = a.out ?? join(ROOT, "debug/mega-map");
mkdirSync(outDir, { recursive: true });
const stem = `L${level}-${floor.archetype}-${floor.cellsW}x${floor.cellsH}-s${runSeed}`;

// The reference is the SHIPPED floor at the same level and seed: scale 1 with
// the raw budget formula is `buildHeadlessPlan` exactly (pinned by
// dev/mega-floor.test.ts). Without it there is no way to tell a defect in the
// generator from a defect in the magnifying glass — see the SCALE CHECK block.
let ref;
if (!a["no-compare"]) {
  const rf = buildMegaFloor({ level, runSeed, scale: 1, density: "raw" });
  if (rf) ref = { floor: rf, census: censusPatterns(rf) };
  else console.error("  ⚠ reference floor declined — SCALE CHECK omitted, read every number with suspicion.");
}

const census = censusPatterns(floor);
console.log(formatCensus(floor, census, ref));

if (!a["no-svg"]) {
  let crop;
  if (a.crop) {
    const m = /^(\d+),(\d+),(\d+),(\d+)$/.exec(a.crop.trim());
    if (!m) {
      console.error("--crop wants i,j,w,h in TILES, e.g. 40,20,60,40");
      process.exit(2);
    }
    crop = { i: +m[1], j: +m[2], w: +m[3], h: +m[4] };
  }
  const svg = renderFloorSvg(floor, { px: Number(a.px), crop });
  const p = join(outDir, `${stem}${crop ? `-crop${crop.i}_${crop.j}` : ""}.svg`);
  writeFileSync(p, svg);
  console.log(`\n▶ map  → ${p}  (${(svg.length / 1e6).toFixed(1)} MB)`);
  // PNG is for LOOKING at — an agent, a chat, a bug report. SVG is for zooming.
  // sharp is already a client dependency; this adds nothing to the bundle.
  if (a.png) {
    const { default: sharp } = await import("sharp");
    const pngPath = p.replace(/\.svg$/, ".png");
    const info = await sharp(Buffer.from(svg), { limitInputPixels: false }).png().toFile(pngPath);
    console.log(`▶ png  → ${pngPath}  (${info.width}x${info.height})`);
  }
}
const reportPath = join(outDir, `${stem}.txt`);
writeFileSync(reportPath, formatCensus(floor, census, ref));
console.log(`▶ report → ${reportPath}`);
if (a.json) {
  writeFileSync(a.json, JSON.stringify({ floor: { ...floor, grid: undefined, plan: undefined }, census }, null, 2));
  console.log(`▶ json → ${a.json}`);
}
console.log(`  total ${((Date.now() - t0) / 1000).toFixed(1)}s`);
