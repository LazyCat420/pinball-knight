#!/usr/bin/env node
/**
 * CIRCUIT CENSUS — do the floor's parts feed each other, or merely coexist?
 *
 * See `src/game/pinball-knight/dev/circuit-census.ts` for what each number
 * means and why the successor map is imported from `maze/flow-loops.ts` rather
 * than re-walked here.
 *
 * Like `open-space-census.mjs` and unlike `floor-census.mjs`, this does NOT
 * drive a browser: the generator, the decoration pass and the flow graph are
 * all pure and importable, so standing up Chrome would add a dependency without
 * adding fidelity.
 *
 *     node scripts/circuit-census.mjs                          # the baseline
 *     node scripts/circuit-census.mjs --out /tmp/before.json
 *     node scripts/circuit-census.mjs --diff /tmp/before.json /tmp/after.json
 *     node scripts/circuit-census.mjs --levels 1,5,9 --seeds 1,2,3
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
    // Archetypes cycle every 5 floors and biomes every 4, so 1..10 covers each
    // archetype twice. Widen to 1..20 for a full cross of the two.
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
    `  feedRate ${pctS(r.feedRateMean).padStart(6)}`,
    ` p05 ${pctS(r.feedRateP05).padStart(6)}`,
    ` min ${pctS(r.feedRateMin).padStart(6)}`,
    `  chain mean ${r.meanChainLenMean.toFixed(2).padStart(5)}`,
    ` longest ${r.longestChainMean.toFixed(1).padStart(4)}`,
    ` max ${String(r.longestChainMax).padStart(3)}`,
    `  orphans ${r.orphanLaunchersMean.toFixed(1).padStart(5)}`,
    ` (${pctS(r.orphanShareMean).padStart(6)})`,
    `  uphill ${pctS(r.uphillShareMean).padStart(6)}`,
    `  parts/1k ${r.partsPer1kMean.toFixed(1).padStart(5)}`,
  ].join("");
}

function report(r, label) {
  const L = [];
  L.push(`\n── ${label} ─────────────────────────────────────────────`);
  L.push(`floors ${r.floors}   RAY ${r.ray} tiles (how far a shove carries)`);
  L.push("");
  L.push("  feedRate = share of launchers whose shove lands the player on ANOTHER part");
  L.push("  chain    = hand-offs deep, counted in parts (longest = the floor's deepest combo)");
  L.push("  orphans  = launchers that throw you at nothing — the hard invariant's population");
  L.push("  uphill   = launch parts firing away from the stairs on Φ (regression guard)");
  L.push("");
  L.push(rollLine("OVERALL", r.overall));
  L.push("");
  for (const [id, roll] of Object.entries(r.byArchetype)) L.push(rollLine(id, roll));
  L.push("");
  const cyc = r.overall.cyclesTotal;
  L.push(
    cyc === 0
      ? "  ✓ INVARIANT  no closed loop of shoves on any floor"
      : `  ✗ INVARIANT  ${cyc} CLOSED LOOP(S) OF SHOVES — that is an unescapable soft-lock`,
  );
  if (r.worstFloor) {
    const w = r.worstFloor;
    L.push("");
    L.push(`  WORST FLOOR  L${w.level} ${w.archetype} seed=${w.seed} mod=${w.modifier}`);
    L.push(`    walkable ${w.walkable}  parts ${w.parts} (${w.partsPer1k.toFixed(1)}/1k)`);
    L.push(
      `    launchers ${w.launchers}  fed ${w.fed} (${pctS(w.feedRate)})  orphans ${w.orphanLaunchers}  longest chain ${w.longestChain}`,
    );
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
  const line = (name, x, y) =>
    `  ${name.padEnd(11)} feed ${d(x.feedRateMean * 100, y.feedRateMean * 100, 1).padStart(6)}pp   longest ${d(x.longestChainMean, y.longestChainMean, 1).padStart(5)}   orphans ${d(x.orphanLaunchersMean, y.orphanLaunchersMean, 1).padStart(5)}   uphill ${d(x.uphillShareMean * 100, y.uphillShareMean * 100, 1).padStart(5)}pp`;
  L.push(line("OVERALL", a.overall, b.overall));
  for (const k of keys) {
    const x = a.byArchetype[k];
    const y = b.byArchetype[k];
    if (x && y) L.push(line(k, x, y));
  }
  const cyc = b.overall.cyclesTotal;
  L.push("");
  L.push(cyc === 0 ? "  ✓ still no closed loop of shoves" : `  ✗ ${cyc} CLOSED LOOP(S) introduced`);
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

const dir = mkdtempSync(join(tmpdir(), "circuit-census-"));
const outfile = join(dir, "census.mjs");
try {
  await build({
    entryPoints: [join(ROOT, "src/game/pinball-knight/dev/circuit-census.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    logLevel: "warning",
  });
  const { runCircuitCensus } = await import(pathToFileURL(outfile).href);

  const levels = values.levels.split(",").map(Number);
  const seeds = values.seeds.split(",").map(Number);
  const t0 = Date.now();
  const r = runCircuitCensus(levels, seeds);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  if (values.json) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    console.log(report(r, `CIRCUIT CENSUS · levels ${values.levels} · ${seeds.length} seeds · ${secs}s`));
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
