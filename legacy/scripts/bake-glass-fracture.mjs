/**
 * Bake the window fracture patterns.
 *
 *   node scripts/bake-glass-fracture.mjs          # write src/shaders/glass/fracture-baked.json
 *   node scripts/bake-glass-fracture.mjs --check  # fail if the committed file is stale
 *
 * The generator is deterministic, so this script's only job is to move the
 * expensive half of the work from every visitor's main thread to this machine,
 * once. `--check` is the CI-shaped half: it regenerates and compares, so a
 * change to `fracture.ts` that nobody re-baked is caught here rather than
 * discovered as a version-mismatch warning in a browser console.
 *
 * ── Why this is a script and not a test ───────────────────────────────────
 * `sprite-forge` publishes from a vitest run gated on an env var, and its own
 * docblock records what that cost: an unconditional publish made `vitest run`
 * dirty the working tree, and `deploy.sh` ships the working tree. A plain
 * script cannot be triggered by a test run, so it cannot do that. The guard
 * that the committed bytes match the generator lives in `glass.test.ts`, which
 * only ever READS.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = join(ROOT, "src", "shaders", "glass", "fracture-baked.json");

// The generator is TypeScript that the bundler compiles; Node cannot import it
// directly. Rather than add a build step for one file, the two pure functions
// it needs are transpiled on the fly with esbuild, which is already a
// dependency of the toolchain here.
const { build } = await import("esbuild");

const bundled = await build({
  entryPoints: [join(ROOT, "src", "shaders", "glass", "fracture.ts")],
  bundle: true,
  format: "esm",
  write: false,
  platform: "node",
  logLevel: "silent",
  // `fracture.ts` is pure geometry and reaches no shader today, but it lives in
  // the glass module and its neighbours all import `./wgsl/*.wgsl`. esbuild has
  // no loader for that extension and fails the bundle outright when one turns
  // up in the graph — which would surface here as a bake failure with nothing
  // to do with baking. Same wiring as next.config.js and vitest.config.js; see
  // src/types/wgsl.d.ts for the full set.
  loader: { ".wgsl": "text" },
});
const mod = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

const { FRACTURE_VERSION, generateFracture, quantize } = mod;

/**
 * Must match `PANES` in `pattern-cache.ts`. Duplicated rather than imported
 * because importing it would drag in the JSON this script is trying to WRITE —
 * a cycle that fails on a clean checkout where the file does not exist yet.
 */
const PANES = {
  cabin: { width: 3.5, height: 3.0, seed: 0x9e3779b9 },
  room: { width: 3.2, height: 2.7, seed: 0x517cc1b7 },
};

const panes = {};
for (const [name, spec] of Object.entries(PANES)) {
  panes[name] = quantize(
    generateFracture({ width: spec.width, height: spec.height, seed: spec.seed }),
  );
}

const payload = JSON.stringify({ version: FRACTURE_VERSION, panes }) + "\n";

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(OUT, "utf8");
  } catch {
    console.error("[bake:glass] no baked file — run `npm run bake:glass`.");
    process.exit(1);
  }
  if (current !== payload) {
    console.error("[bake:glass] STALE — fracture.ts changed without a re-bake.");
    console.error("             run `npm run bake:glass` and commit the result.");
    process.exit(1);
  }
  console.log("[bake:glass] up to date.");
  process.exit(0);
}

writeFileSync(OUT, payload);

const cells = Object.values(panes).reduce((n, p) => n + p.cells.length, 0);
const anchored = Object.values(panes).reduce(
  (n, p) => n + p.cells.filter((c) => c.anchored).length,
  0,
);
console.log(
  `[bake:glass] v${FRACTURE_VERSION} → ${OUT.replace(ROOT + "/", "")}\n` +
    `             ${cells} cells (${anchored} stay in the frame), ` +
    `${(payload.length / 1024).toFixed(1)} KB`,
);
