#!/usr/bin/env node
/**
 * OPEN-SPACE CENSUS — how much of a shipping floor is open AND empty.
 *
 * The instrument behind `maze/open-space.ts`'s bands. See
 * `src/game/pinball-knight/dev/open-space-census.ts` for what each number means
 * and `PLAZA_PLAN.md` for why the quantity is "open AND barren" rather than
 * either one alone.
 *
 * Like `funnel-census.mjs` and unlike `floor-census.mjs`, this does NOT drive a
 * browser: everything it needs (the floor generator, the decoration pass, the
 * metrics) is pure and importable, so standing up Chrome would add a dependency
 * without adding fidelity. It re-implements nothing — `buildHeadlessPlan` calls
 * the shipped `buildTrackFloor` + `decorateMaze`.
 *
 *     node scripts/open-space-census.mjs                        # the baseline
 *     node scripts/open-space-census.mjs --out /tmp/before.json
 *     node scripts/open-space-census.mjs --diff /tmp/before.json /tmp/after.json
 *     node scripts/open-space-census.mjs --levels 1,5,9 --seeds 1,2,3
 */
import { parseArgs } from "node:util";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const { values } = parseArgs({
  options: {
    // Every archetype cycles every 5 floors, so 1..20 covers each of the five
    // four times. The default sweep is deliberately wide: the defect is
    // archetype-specific and a narrow sweep would average it away.
    levels: { type: "string", default: "1,2,3,4,5,6,7,8,9,10" },
    seeds: { type: "string", default: "1,12345,987654321,424242" },
    out: { type: "string" },
    diff: { type: "string", multiple: true },
    json: { type: "boolean", default: false },
  },
});

const pctS = (x) => `${(x * 100).toFixed(1)}%`;

function rollLine(name, r) {
  return [
    `  ${name.padEnd(11)}`,
    String(r.floors).padStart(4),
    `  barren mean ${r.worstBarrenMean.toFixed(1).padStart(5)}t`,
    ` p95 ${r.worstBarrenP95.toFixed(1).padStart(5)}t`,
    ` max ${r.worstBarrenMax.toFixed(1).padStart(5)}t`,
    `  openDead ${pctS(r.openDeadShareMean).padStart(6)}`,
    `  bigRatio ${r.biggestSectionRatioMean.toFixed(2).padStart(5)}`,
    ` (min ${r.biggestSectionRatioMin.toFixed(2)})`,
    `  parts/1k ${r.partsPer1kMean.toFixed(1).padStart(5)}`,
  ].join("");
}

function report(r, label) {
  const L = [];
  L.push(`\n── ${label} ─────────────────────────────────────────────`);
  L.push(`floors ${r.floors}   R_DEAD ${r.rDead} tiles (0.80s at BOOSTER_SPEED)`);
  L.push("");
  L.push("  worstBarren = furthest you travel over walkable floor before meeting a part");
  L.push("  openDead    = share of tiles BOTH open (clearance>=3) AND barren past R_DEAD");
  L.push("  bigRatio    = largest section's parts/1k over the floor's parts/1k (<1 = the biggest room is the emptiest)");
  L.push("");
  L.push(rollLine("OVERALL", r.overall));
  L.push("");
  for (const [id, roll] of Object.entries(r.byArchetype)) L.push(rollLine(id, roll));
  if (r.worstFloor) {
    const w = r.worstFloor;
    L.push("");
    L.push(`  WORST FLOOR  L${w.level} ${w.archetype} seed=${w.seed} mod=${w.modifier}`);
    L.push(`    walkable ${w.walkable}  parts ${w.parts} (${w.partsPer1k.toFixed(1)}/1k)  open ${pctS(w.openShare)}`);
    L.push(`    worstBarren ${w.worstBarren.toFixed(1)}t  openDead ${pctS(w.openDeadShare)}  sections ${w.sections}  bigRatio ${w.biggestSectionRatio.toFixed(2)}`);
    if (w.worstSection) {
      const s = w.worstSection;
      L.push(`    emptiest section #${s.id} @(${s.ci},${s.cj})  ${s.tiles} tiles  ${s.parts} parts  maxBarren ${s.maxBarren.toFixed(1)}t`);
    }
  }
  return L.join("\n");
}

function diff(a, b) {
  const L = ["\n── DIFF (after − before) ────────────────────────────────"];
  const keys = new Set([...Object.keys(a.byArchetype), ...Object.keys(b.byArchetype)]);
  const d = (x, y, f = 2) => {
    const v = (y ?? 0) - (x ?? 0);
    return `${v >= 0 ? "+" : ""}${v.toFixed(f)}`;
  };
  L.push(`  OVERALL     barren ${d(a.overall.worstBarrenMean, b.overall.worstBarrenMean, 1)}t   openDead ${d(a.overall.openDeadShareMean * 100, b.overall.openDeadShareMean * 100, 1)}pp   bigRatio ${d(a.overall.biggestSectionRatioMean, b.overall.biggestSectionRatioMean)}`);
  for (const k of keys) {
    const x = a.byArchetype[k];
    const y = b.byArchetype[k];
    if (!x || !y) continue;
    L.push(`  ${k.padEnd(11)} barren ${d(x.worstBarrenMean, y.worstBarrenMean, 1)}t   openDead ${d(x.openDeadShareMean * 100, y.openDeadShareMean * 100, 1)}pp   bigRatio ${d(x.biggestSectionRatioMean, y.biggestSectionRatioMean)}`);
  }
  return L.join("\n");
}

if (values.diff?.length === 2) {
  const a = JSON.parse(readFileSync(values.diff[0], "utf8"));
  const b = JSON.parse(readFileSync(values.diff[1], "utf8"));
  console.log(report(a, "BEFORE"));
  console.log(report(b, "AFTER"));
  console.log(diff(a, b));
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), "open-space-census-"));
const outfile = join(dir, "census.mjs");
try {
  await build({
    entryPoints: [join(ROOT, "src/game/pinball-knight/dev/open-space-census.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    logLevel: "warning",
  });
  const { runOpenSpaceCensus } = await import(pathToFileURL(outfile).href);

  const levels = values.levels.split(",").map(Number);
  const seeds = values.seeds.split(",").map(Number);
  const t0 = Date.now();
  const r = runOpenSpaceCensus(levels, seeds);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  if (values.json) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    console.log(report(r, `OPEN-SPACE CENSUS · levels ${values.levels} · ${seeds.length} seeds · ${secs}s`));
    console.log("");
  }
  if (values.out) {
    // `perFloor` is the bulk and the diff reads only the rollups; drop it so a
    // snapshot stays diffable by eye.
    const { perFloor, ...slim } = r;
    writeFileSync(values.out, JSON.stringify(slim, null, 2));
    console.error(`wrote ${values.out}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
