// THE ENVELOPE — one shape every instrument in this repo reports in.
//
// ## Why this exists
//
// Until 2026-08-12 every number this project measured lived as PROSE in
// `docs/src/status/one-to-one-route.md`, and every image lived in `.checks/`,
// which is gitignored. So a regression was caught only by a human re-reading a
// doc against a fresh run, and "the dungeon A/B is 30.2" was a sentence rather
// than a record. Committed baselines need a committed shape.
//
// ## The three things an envelope carries that a bare number does not
//
//  1. WHAT PRODUCED IT (`producerSha256`). A rig that changed is not the same
//     instrument, and comparing across an edit is comparing two things. This is
//     an exit code of its own, not a warning, because the alternative is a
//     silent re-baseline.
//  2. HOW NOISY IT WAS, measured INSIDE the run (`n`, `noise`). The repo already
//     learned this twice: `pk-perf-ab --rounds 1` had a significance test that
//     could not fail because the wander was 0 by construction, and the three A/B
//     rigs shoot N=1 and therefore cannot support a threshold at all. A number
//     with no in-run spread is not a measurement, and this shape makes that
//     impossible to omit.
//  3. WHETHER THE RUN HAPPENED AT ALL (`quality`). The box is shared. The
//     broker's `--class perf|webgpu` is exact-or-**exit 75**, and 75 means the
//     run never started. A harness that maps that to "failed" turns a busy
//     desktop into a red suite, which is how a real gate gets ignored.
//
// `quality` is set by the INSTRUMENT, never by the comparator — the instrument
// is the only thing that knows it produced 12 frames instead of 300.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { dirname, resolve } from "node:path";

export const SCHEMA = 1;

/** The broker grants an exact core slot or refuses. 75 = never started. */
export const BROKER_NO_GRANT = 75;

/**
 * Quality values an instrument may report. Anything other than `ok` makes the
 * comparator return INCONCLUSIVE rather than a verdict — a distinction with
 * teeth, because "we could not measure" and "it got worse" call for different
 * actions and only one of them is your fault.
 */
export const QUALITY = {
  OK: "ok",
  /** p95 - p50 below the cadence floor: the reading is the present interval,
   *  not the work. Both vsync-on rows trip this, which is the point. */
  CADENCE_BOUND: "void:cadence-bound",
  /** Fewer frames than the window needs. */
  FRAMES: "void:frames",
  /** Reps disagreed by more than the metric is worth. */
  SPREAD: "void:spread",
  /** The broker refused the grant (exit 75), or gave fewer threads than asked. */
  GRANT: "void:grant",
  /** N=1. There is no in-run noise estimate, so no threshold is supportable. */
  ONE_SAMPLE: "void:one-sample",
  /** Timestamp queries unavailable, so a CPU/GPU split cannot be had. */
  NO_TIMESTAMPS: "void:no-timestamps",
};

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function git(args, cwd) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

/**
 * The environment a reading was taken in.
 *
 * `loadavg1Before`/`After` bracket the run rather than sampling it once,
 * because a box that got busy DURING a measurement is the case that matters and
 * a single reading at the start cannot see it.
 *
 * `threadsAsked` / `threadsGranted` come from the broker
 * (`legacy/scripts/ops/pk-run.sh`), which exports `BDB_SLOT_COUNT` on a grant.
 * A run that got less than it asked for is not a slower run, it is a different
 * experiment.
 */
export function envBlock({ loadBefore, vsync = null, view = null } = {}) {
  return {
    nproc: cpus().length,
    loadavg1Before: loadBefore ?? null,
    loadavg1After: Number(loadavg()[0].toFixed(2)),
    brokerClass: process.env.BDB_SLOT_CLASS ?? null,
    threadsAsked: numOrNull(process.env.BDB_SLOT_ASKED),
    threadsGranted: numOrNull(process.env.BDB_SLOT_COUNT),
    cdpPort: numOrNull(process.env.BDB_CDP_PORT),
    vsync,
    view,
  };
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function loadNow() {
  return Number(loadavg()[0].toFixed(2));
}

/**
 * One metric. `dir` is which way is better, and it is REQUIRED — a comparator
 * that has to guess whether 30.2 beating 33.7 is progress will guess wrong on
 * the first metric where lower is worse.
 */
export function metric({
  id,
  unit,
  dir,
  value,
  n = 1,
  noise = null,
  quality = QUALITY.OK,
  notes = [],
  /** A deterministic instrument (the ledger, a digest) has no noise to
   *  estimate, so n=1 is complete rather than under-sampled. Everything that
   *  reads a GPU, a browser or a shared box is NOT deterministic. */
  deterministic = false,
}) {
  if (!id || !unit || !dir) throw new Error(`metric needs id/unit/dir: ${id}`);
  if (dir !== "lower-better" && dir !== "higher-better") {
    throw new Error(`metric ${id}: dir must be lower-better|higher-better`);
  }
  // A metric with more than one sample MUST carry its spread. This is the
  // guard that stops `--rounds 3` from silently reporting a median with no
  // dispersion, which is exactly as unfalsifiable as `--rounds 1` was.
  if (n > 1 && (!noise || typeof noise.value !== "number")) {
    throw new Error(`metric ${id}: n=${n} but no noise — see acrossRounds()`);
  }
  // THE ONE-SAMPLE RULE. A single reading off a shared box with a real GPU has
  // no in-run noise estimate, so no threshold over it is supportable — which is
  // the true statement about every visual A/B number this project has recorded
  // to date. Say so in the envelope rather than letting a comparator invent a
  // band for it.
  const q = !deterministic && n < 2 && quality === QUALITY.OK ? QUALITY.ONE_SAMPLE : quality;
  return {
    id,
    unit,
    dir,
    value,
    n,
    noise: noise ?? { kind: n > 1 ? "range" : "none", value: 0 },
    quality: q,
    notes,
  };
}

/**
 * Spread across rounds, the way `pk-perf-ab.mjs:466-490` already computes it:
 * the MEDIAN is the value and `(hi-lo)/median` is the noise. Median rather than
 * mean because one round that hit a compositor hiccup should not drag the
 * reading, and range rather than stddev because at n=3 stddev is theatre.
 */
export function acrossRounds(values) {
  const v = [...values].sort((a, b) => a - b);
  if (v.length === 0) return { value: null, n: 0, noise: { kind: "range", value: 0 } };
  const median = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  const lo = v[0];
  const hi = v[v.length - 1];
  const rel = median === 0 ? 0 : (hi - lo) / Math.abs(median);
  return {
    value: median,
    n: v.length,
    lo,
    hi,
    noise: { kind: "range", value: Number(rel.toFixed(4)) },
  };
}

/**
 * Wrap raw metrics into a full envelope.
 *
 * `producer` is a repo-relative path and its hash is taken HERE rather than by
 * the instrument, so a Rust instrument does not have to grow a sha256 dependency
 * to participate. `xtask` has zero dependencies and that is worth keeping.
 */
export function wrap({
  instrument,
  producer,
  metrics,
  root,
  build = {},
  env = {},
  deterministic = false,
}) {
  const producerPath = resolve(root, producer);
  return {
    schema: SCHEMA,
    instrument,
    producer,
    producerSha256: existsSync(producerPath) ? sha256File(producerPath) : null,
    deterministic,
    at: new Date().toISOString(),
    commit: git(["rev-parse", "--short", "HEAD"], root),
    dirty: (git(["status", "--porcelain"], root) ?? "") !== "",
    build,
    env: { ...envBlock(), ...env },
    metrics,
  };
}

export function writeEnvelope(path, envelope) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(envelope, null, 2) + "\n");
  return path;
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Map a child process's exit code to a quality.
 *
 * The one rule this file exists to encode once: **broker exit 75 is not a
 * failure.** A `perf` or `webgpu` class that could not get its exact grant did
 * not run, and a red suite is not what that means.
 */
export function qualityForExit(code) {
  if (code === BROKER_NO_GRANT) return QUALITY.GRANT;
  return code === 0 ? QUALITY.OK : null;
}
