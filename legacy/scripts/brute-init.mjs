#!/usr/bin/env node
/**
 * Runner for `brute-init.entry.ts` — see that file for why the painter is the init.
 *
 *   node scripts/brute-init.mjs [--out DIR] [--grid 256] [--dir E]
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const out = arg("out", "src/game/pinball-knight/tools/sprite-forge/work/brute/painted");
const bundle = join("scripts", ".brute-init.bundle.mjs");
try {
  mkdirSync(out, { recursive: true });
  execFileSync("npx", ["esbuild", "scripts/brute-init.entry.ts", "--bundle", "--platform=node",
    "--format=esm", "--external:canvas", `--outfile=${bundle}`, "--log-level=error"], { stdio: "inherit" });
  execFileSync("node", [bundle], {
    stdio: "inherit",
    env: { ...process.env, BRUTE_OUT: out, BRUTE_GRID: arg("grid", "256"), BRUTE_DIR: arg("dir", "E") },
  });
} finally {
  rmSync(bundle, { force: true });
}
