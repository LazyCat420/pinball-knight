#!/usr/bin/env node
// Reproducible Node-only benchmark of the live author at increasing map sizes.
// Usage: pnpm maze:scale --scales=1,1.414,2,3,4 --samples=3 --level=5 --seed=777
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = new Map(process.argv.slice(2).map(arg => arg.replace(/^--/, "").split("=")));
const scales = (args.get("scales") ?? "1,1.414,2,3,4").split(",").map(Number);
const samples = Number(args.get("samples") ?? 3);
const level = Number(args.get("level") ?? 5);
const runSeed = Number(args.get("seed") ?? 777);
if (!scales.length || scales.some(s => !Number.isFinite(s) || s <= 0) ||
    !Number.isInteger(samples) || samples < 1 || !Number.isInteger(level) || level < 1 || !Number.isFinite(runSeed)) {
  throw new Error("Expected positive scales, positive integer samples/level, and a finite seed");
}
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = await mkdtemp(join(tmpdir(), "pk-maze-scaling-"));
try {
  const outfile = join(scratch, "author.mjs");
  await build({ stdin: { contents: `
    export { buildMegaFloor } from './src/game/pinball-knight/dev/mega-floor';
    export { bfsDistancesOwned } from './src/game/pinball-knight/engine/flow-field';
    export { isWalkable } from './src/game/pinball-knight/engine/grid';
  `, resolveDir: root }, bundle: true, platform: "node", format: "esm", outfile });
  const { buildMegaFloor, bfsDistancesOwned, isWalkable } = await import(pathToFileURL(outfile).href);
  buildMegaFloor({ level, runSeed, scale: 1 }); // warm the code before timing
  const median = values => [...values].sort((a,b) => a-b)[Math.floor(values.length / 2)];
  for (const scale of scales) {
    const rows = [];
    for (let sample = 0; sample < samples; sample++) {
      const started = performance.now();
      const f = buildMegaFloor({ level, runSeed, scale });
      const totalMs = performance.now() - started;
      if (!f) throw new Error(`Track generation declined at scale ${scale}`);
      const g = f.grid;
      const dist = bfsDistancesOwned(g, f.start.i, f.start.j);
      let unreachable = 0;
      for (let k = 0; k < g.t.length; k++) {
        if (isWalkable(g, k % g.w, Math.floor(k / g.w)) && dist[k] < 0) unreachable++;
      }
      const stairsReachable = dist[f.stairs.j * g.w + f.stairs.i] >= 0;
      const gridBytes = Object.values(g).reduce((sum, v) => sum + (ArrayBuffer.isView(v) ? v.byteLength : 0), 0);
      rows.push({ totalMs, trackMs: f.timing.track, decorateMs: f.timing.decorate,
        tiles: g.t.length, width: g.w, height: g.h, walkable: f.walkable,
        parts: f.plan.parts.length, gridBytes, unreachable, stairsReachable });
    }
    const row = rows[0];
    console.log(JSON.stringify({ level, runSeed, scale, samples, ...row,
      totalMs: median(rows.map(r => r.totalMs)), trackMs: median(rows.map(r => r.trackMs)),
      decorateMs: median(rows.map(r => r.decorateMs)) }));
    if (rows.some(r => r.unreachable || !r.stairsReachable)) process.exitCode = 1;
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
