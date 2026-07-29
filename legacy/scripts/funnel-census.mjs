#!/usr/bin/env node
/**
 * FUNNEL CENSUS — capture rate at every doorway, over real generated floors.
 *
 * "Does a ball aimed at this doorway actually get through it, and what does it
 * cost?" See `src/game/pinball-knight/dev/funnel-census.ts` for the definition
 * of the three numbers and for what the simulation does and does not model.
 *
 * ## Why this one does NOT drive a browser
 *
 * `floor-census.mjs` drives the real game in a real Chrome, because the thing it
 * fingerprints (`buildLevel`'s ~20 RNG-ordered placement phases) reaches into
 * state that only exists once the game is running. This census needs two things,
 * both of which are pure and importable: the shipping floor generator, and the
 * shipping collider. Standing up a browser to reach them would add a dependency
 * without adding fidelity.
 *
 * What it must NOT do is re-implement either. It doesn't — `headless-floor.ts`
 * calls `buildTrackFloor` and `funnel-census.ts` calls `moveCircle`, the same
 * function `entities/player.ts` steps the pinball with.
 *
 *     node scripts/funnel-census.mjs                       # the baseline
 *     node scripts/funnel-census.mjs --out /tmp/before.json
 *     node scripts/funnel-census.mjs --diff /tmp/before.json /tmp/after.json
 *     node scripts/funnel-census.mjs --levels 1,5,9 --seeds 1,2,3
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
    levels: { type: "string", default: "1,3,5,8,12,17" },
    seeds: { type: "string", default: "1,12345,987654321,424242" },
    out: { type: "string" },
    diff: { type: "string", multiple: true },
    "diff-b": { type: "string" },
    json: { type: "boolean", default: false },
  },
});

const pct = (x) => `${(x * 100).toFixed(1)}%`;

function report(r, label) {
  const L = [];
  L.push(`\n── ${label} ─────────────────────────────────────────────`);
  L.push(`floors ${r.floors}   doorways ${r.doorways}   samples ${r.samples.toLocaleString()}`);
  L.push("");
  L.push(`  CAPTURED   ${pct(r.captureRate).padStart(7)}   median ${r.medBounces} bounces`);
  L.push(`  REJECTED   ${pct(r.rejectRate).padStart(7)}   thrown back past the start line`);
  L.push(`  TIMEOUT    ${pct(r.timeoutRate).padStart(7)}   still rattling after 3s`);
  L.push(`  STALLED    ${pct(r.stallRate).padStart(7)}   friction ate it`);
  L.push("");
  L.push(`  dead-on    ${pct(r.deadOnRate).padStart(7)}   HARNESS SELF-CHECK — straight down the middle`);
  L.push(`  unusable   ${String(r.unusableDirs).padStart(7)}   approach dirs with no standing room (of ${r.doorways * 2})`);
  L.push("");
  L.push("  TREATED vs UNTREATED  (the aggregate dilutes this by ~10x)");
  for (const [name, sp] of [["funnelled", r.split.funnelled], ["plain", r.split.plain]]) {
    L.push(`    ${name.padEnd(10)} ${String(sp.doorways).padStart(4)} doors  capture ${pct(sp.captureRate).padStart(7)}  rejected ${pct(sp.rejectRate).padStart(7)}`);
  }
  L.push("");
  L.push("  by doorway width");
  for (const w of Object.keys(r.byWidth).sort((a, b) => a - b)) {
    const b = r.byWidth[w];
    L.push(`    ${String(w).padStart(2)} wide  ${String(b.doorways).padStart(4)} doors  capture ${pct(b.captureRate).padStart(7)}  med ${b.medBounces.toFixed(1)} bounces`);
  }
  L.push("");
  L.push("  worst doorways");
  for (const w of r.worst.slice(0, 6)) {
    L.push(`    lvl ${String(w.level).padStart(2)} seed ${String(w.runSeed).padStart(10)}  w=${w.w}  capture ${pct(w.captureRate)}`);
  }
  return L.join("\n");
}

function diff(a, b) {
  const row = (name, x, y, unit = "%") => {
    const d = y - x;
    const sign = d > 0 ? "+" : "";
    return unit === "%"
      ? `  ${name.padEnd(12)} ${pct(x).padStart(7)} → ${pct(y).padStart(7)}   ${sign}${(d * 100).toFixed(1)}pp`
      : `  ${name.padEnd(12)} ${x.toFixed(1).padStart(7)} → ${y.toFixed(1).padStart(7)}   ${sign}${d.toFixed(1)}`;
  };
  return [
    "\n── DIFF ─────────────────────────────────────────────",
    row("captured", a.captureRate, b.captureRate),
    row("rejected", a.rejectRate, b.rejectRate),
    row("timeout", a.timeoutRate, b.timeoutRate),
    row("stalled", a.stallRate, b.stallRate),
    row("med bounces", a.medBounces, b.medBounces, ""),
  ].join("\n");
}

if (values.diff?.length === 2) {
  const a = JSON.parse(readFileSync(values.diff[0], "utf8"));
  const b = JSON.parse(readFileSync(values.diff[1], "utf8"));
  console.log(report(a, "BEFORE"));
  console.log(report(b, "AFTER"));
  console.log(diff(a, b));
  process.exit(0);
}

// Bundle the TS census to one ESM file and import it. esbuild is already a
// dependency (next uses it); this adds no install.
const dir = mkdtempSync(join(tmpdir(), "funnel-census-"));
const outfile = join(dir, "census.mjs");
try {
  await build({
    entryPoints: [join(ROOT, "src/game/pinball-knight/dev/funnel-census.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    logLevel: "warning",
  });
  const { runFunnelCensus } = await import(pathToFileURL(outfile).href);

  const levels = values.levels.split(",").map(Number);
  const seeds = values.seeds.split(",").map(Number);
  const t0 = Date.now();
  const r = runFunnelCensus(levels, seeds);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  if (values.json) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    console.log(report(r, `FUNNEL CENSUS · levels ${values.levels} · seeds ${seeds.length} · ${secs}s`));
    console.log("");
  }
  if (values.out) {
    // `perFloor` is the bulk and nothing downstream reads it; drop it so a
    // snapshot stays diffable by eye.
    const { perFloor, ...slim } = r;
    writeFileSync(values.out, JSON.stringify(slim, null, 2));
    console.error(`wrote ${values.out}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
