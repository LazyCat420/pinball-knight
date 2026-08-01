#!/usr/bin/env node
/**
 * Runner for `colour-ab.entry.ts` -- see that file for what the arms are.
 *
 * The entry is a REAL .ts file rather than a template literal in here, unlike
 * roster-sheet.mjs. Generating TypeScript from a JS template means every
 * backtick and every ${...} in the generated code has to be escaped, and three
 * separate bugs in this script came from exactly that -- each one crashing the
 * run so the reader was looking at a STALE summary.json and did not know it.
 * A real file cannot have that failure mode, and esbuild resolves it the same.
 *
 *   node scripts/jester-colour-ab.mjs --out scratchpad/colour
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i+1] ? process.argv[i+1] : d; };
const out = resolve(arg("out", "scratchpad/colour"));
const sheet = resolve(arg("sheet", "src/game/pinball-knight/tools/sprite-forge/inbox/jestertest-S.png"));
if (!existsSync(sheet)) { console.error("no such sheet:", sheet); process.exit(1); }

const bundle = join("scripts", ".colour-ab.bundle.mjs");
try {
  mkdirSync(out, { recursive: true });
  rmSync(join(out, "summary.json"), { force: true });   // never read a stale run
  execFileSync("npx", ["esbuild", "scripts/colour-ab.entry.ts", "--bundle", "--platform=node",
    "--format=esm", "--external:canvas", `--outfile=${bundle}`, "--log-level=error"], { stdio: "inherit" });
  execFileSync("node", [bundle], { stdio: "inherit", env: { ...process.env, AB_OUT: out, AB_SHEET: sheet } });
} finally {
  rmSync(bundle, { force: true });
}
