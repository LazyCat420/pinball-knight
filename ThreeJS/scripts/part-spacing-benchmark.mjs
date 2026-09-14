#!/usr/bin/env node
// Node-only microbenchmark: does not measure whole-floor generation or frame rate.
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = await mkdtemp(join(tmpdir(), 'pk-part-spacing-'));
try {
  const outfile = join(scratch, 'occupancy.mjs');
  await build({ entryPoints: [join(root, 'src/game/pinball-knight/maze/part-occupancy.ts')], bundle: true, platform: 'node', format: 'esm', outfile });
  const { appendOnlyPartOccupancy } = await import(pathToFileURL(outfile).href);
  const parts = Array.from({ length: 10000 }, (_, k) => ({ i: (k * 31) % 1001, j: (k * 79) % 997 }));
  const queries = Array.from({ length: 30000 }, (_, k) => ({ i: (k * 127) % 1001, j: (k * 73) % 997 }));
  let baselineHits;
  for (const indexed of [false, true]) {
    const near = appendOnlyPartOccupancy({ w: 1001, h: 997 }, parts);
    const start = performance.now();
    let hits = 0;
    for (const p of queries) {
      if (indexed ? near(p.i, p.j, 3, true) : parts.some(q => Math.abs(q.i - p.i) + Math.abs(q.j - p.j) <= 3)) hits++;
    }
    if (!indexed) baselineHits = hits;
    if (hits !== baselineHits) throw new Error('Spacing results changed');
    console.log(JSON.stringify({ indexed, ms: performance.now() - start, hits, parts: parts.length, queries: queries.length }));
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
