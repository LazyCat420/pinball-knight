#!/usr/bin/env node
/**
 * 🕵️ git bisect predicate — runs the REAL-GPU death lab as the good/bad oracle.
 *
 * Usage:
 *   git bisect start
 *   git bisect bad                      # HEAD — death animation failing
 *   git bisect good 61f9cd4             # the commit where death-lab measured 28/28 PASS
 *   git bisect run node scripts/bisect-death-lab.mjs
 *
 * Exit codes (git bisect convention):
 *   0        → this commit is GOOD (all kinds played their death to the last cel)
 *   1..124   → this commit is BAD
 *   125      → CANNOT TEST (build broken, deps missing, GPU unavailable) — bisect skips
 *
 * The 28/28 measurement lives in commit 61f9cd4's message; the lab itself
 * (scripts/death-lab.mjs) refuses to report anything until it has proved rAF
 * is running, so a throttled page cannot produce a false BAD.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const repoRoot = new URL("..", import.meta.url).pathname;
const lab = "scripts/death-lab.mjs";

function bail(code, msg) {
  console.error(`[bisect-death-lab] ${msg}`);
  process.exit(code);
}

// 125: commit does not even contain the harness — untestable, skip it.
if (!existsSync(new URL(lab, `file://${repoRoot}`).pathname)) {
  bail(125, `no ${lab} at this commit`);
}

// Fresh install guard: a lockfile change mid-window can make the lab
// unrunnable, which is a skip, not a failure.
const npmInstall = spawnSync("npm", ["ci", "--silent"], { cwd: repoRoot, stdio: "inherit" });
if (npmInstall.status !== 0) bail(125, "npm ci failed — untestable commit");

// The oracle: the whole roster, real GPU, real combat kills.
const labRun = spawnSync("node", [lab, "--all"], { cwd: repoRoot, stdio: "inherit" });
if (labRun.status === null) bail(125, "lab could not run (no browser/GPU available)");
if (labRun.status === 0) {
  console.log("[bisect-death-lab] GOOD — all kinds played death to the last cel and held it");
  process.exit(0);
}
console.log("[bisect-death-lab] BAD — at least one kind failed its death");
process.exit(labRun.status);
