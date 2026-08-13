#!/usr/bin/env node
// THE COMPARATOR — committed baselines, and a verdict that can say "I could not tell".
//
//   node scripts/pk-baseline.mjs check  <instrument> --from run.json [--confirm]
//   node scripts/pk-baseline.mjs record <instrument> --from run.json [--reason "…"]
//   node scripts/pk-baseline.mjs lint
//   node scripts/pk-baseline.mjs report
//
// Baselines live in `assets/baselines/<instrument>.json` and are COMMITTED.
// `.checks/` is gitignored, so nothing there is a record; prose in a status doc
// is not a record either, because a regression is then caught only by a human
// re-reading it against a fresh run.
//
// ## The two failures this is built around
//
// **A fixed floor goes stale, so this one RATCHETS.** `record` refuses a value
// worse than the stored one unless a written `--reason` is supplied, and files
// that reason in `regressions[]`. Improvements are recorded freely. The floor
// therefore descends as the port improves and can only rise on the record.
//
// **A loaded box must read INCONCLUSIVE, never RED.** This is the whole reason
// the verdict has a third state. The box is shared; the broker's exact classes
// exit 75 rather than run narrow; and a gate that turns a busy desktop into a
// red suite is a gate people learn to ignore. Every input to that judgement
// comes from INSIDE the same run — the reps' spread, the rounds' wander, the
// frame floor, the broker's grant — because judging noise by comparing to a
// previous run is precisely the mistake interleaving exists to avoid.
//
// ## What the bands are, and why they are not typed in
//
//   band.rel = clamp(2 × noiseAtRecord, 0.10, 0.50)
//
// derived from the instrument's own measured wander at the moment of record.
// On today's numbers that is ~10% for the tavern frame cost (wander 4%) and
// ~46% for the dungeon ratio (wander 23%) — which is the honest statement that
// one of those is a gate-able number and the other is not yet. The alternative
// is what the A/B rigs have today: a flat `over32Frac > 0.02` while the dungeon
// reads 33.7%, i.e. a threshold nothing can ever satisfy, which is the same as
// having no gate at all.
//
// A DETERMINISTIC instrument (the ledger) skips all of that: no GPU, no browser,
// no shared box, so there is no noise to reason about and `band` is zero. That
// makes the ledger the project's one HARD ratchet — converted % may never fall.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, sha256File, loadNow, QUALITY } from "./lib/pk-envelope.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// `PK_BASELINE_DIR` exists so the ratchet can be TESTED against a scratch dir
// rather than against the shipped baselines. Without it the only way to
// exercise "a fall is a regression" is to damage the real record, so the test
// that mattered most would be the one nobody wrote — and a comparator whose
// verdict logic is untested is the same class of instrument as the gates this
// file was built to replace.
const BASELINE_DIR = process.env.PK_BASELINE_DIR
  ? resolve(process.env.PK_BASELINE_DIR)
  : join(ROOT, "assets", "baselines");

/** Exit codes. Distinct on purpose: a caller must be able to tell "worse" from
 *  "could not tell" from "you edited the ruler". */
const EXIT = { OK: 0, REGRESSION: 1, USAGE: 2, INCONCLUSIVE: 3, INSTRUMENT: 4 };

const VERDICT = {
  HELD: "HELD",
  IMPROVED: "IMPROVED",
  REGRESSION: "REGRESSION",
  INCONCLUSIVE: "INCONCLUSIVE",
  INSTRUMENT_CHANGED: "INSTRUMENT CHANGED",
  NEW: "NEW",
};

function bandFor(noiseAtRecord, unit) {
  const rel = Math.min(0.5, Math.max(0.1, 2 * (noiseAtRecord ?? 0)));
  // `abs` is the instrument's stated absolute precision, and it is what keeps a
  // near-zero value from having an absurdly tight band: 2% of 0.4 ms is noise,
  // not signal.
  const abs = unit === "ms" ? 0.5 : unit === "x" ? 0.3 : unit === "%" ? 0.3 : 0;
  return { rel: Number(rel.toFixed(4)), abs };
}

function isWorse(dir, value, baseline) {
  const limit =
    dir === "lower-better"
      ? baseline.value * (1 + baseline.band.rel) + baseline.band.abs
      : baseline.value * (1 - baseline.band.rel) - baseline.band.abs;
  return dir === "lower-better" ? value > limit : value < limit;
}

function isBetter(dir, value, baseline) {
  const limit =
    dir === "lower-better"
      ? baseline.value * (1 - baseline.band.rel) - baseline.band.abs
      : baseline.value * (1 + baseline.band.rel) + baseline.band.abs;
  return dir === "lower-better" ? value < limit : value > limit;
}

/**
 * Judge one metric against its baseline. First match wins, and the order is the
 * argument: every "I could not tell" reason is checked BEFORE any verdict about
 * the value, so a bad run can never be reported as a regression.
 */
function judge(m, base, envelope, opts) {
  const deterministic = envelope.deterministic === true;

  if (!base) return { verdict: VERDICT.NEW, why: "no baseline recorded yet" };

  // 2. The instrument said it could not measure.
  if (m.quality !== QUALITY.OK) {
    return { verdict: VERDICT.INCONCLUSIVE, why: `instrument reported ${m.quality}` };
  }

  if (!deterministic) {
    // 3. Fewer samples than the record. A 1-round run cannot adjudicate a
    //    3-round baseline; it can only fail to.
    if ((m.n ?? 1) < (base.n ?? 1)) {
      return {
        verdict: VERDICT.INCONCLUSIVE,
        why: `n=${m.n} against a baseline recorded at n=${base.n}`,
      };
    }
    // 4. The box moved more than the metric does.
    const noise = m.noise?.value ?? 0;
    const ceiling = Math.max(3 * (base.noiseAtRecord ?? 0), 0.5);
    if (noise > ceiling) {
      return {
        verdict: VERDICT.INCONCLUSIVE,
        why: `in-run noise ${(noise * 100).toFixed(1)}% > ${(ceiling * 100).toFixed(0)}% ceiling`,
      };
    }
    // 5. The broker gave less than was asked, or the box was already busy.
    const e = envelope.env ?? {};
    if (e.threadsAsked != null && e.threadsGranted != null && e.threadsGranted < e.threadsAsked) {
      return {
        verdict: VERDICT.INCONCLUSIVE,
        why: `broker granted ${e.threadsGranted} of ${e.threadsAsked} threads`,
      };
    }
    if (e.nproc && e.loadavg1Before != null && e.loadavg1Before > e.nproc / 4) {
      return {
        verdict: VERDICT.INCONCLUSIVE,
        why: `loadavg ${e.loadavg1Before} on ${e.nproc} cpus — the box was busy before the run`,
      };
    }
  }

  // 6/7/8. Now, and only now, a statement about the value.
  if (isWorse(m.dir, m.value, base)) {
    // A single unreproducible red costs five minutes rather than an afternoon.
    if (!opts.confirm && !deterministic) {
      return {
        verdict: VERDICT.INCONCLUSIVE,
        why: `outside band, unconfirmed — re-run with --confirm to call it a regression`,
      };
    }
    return { verdict: VERDICT.REGRESSION, why: bandText(m, base) };
  }
  if (isBetter(m.dir, m.value, base)) {
    return { verdict: VERDICT.IMPROVED, why: bandText(m, base) };
  }
  return { verdict: VERDICT.HELD, why: bandText(m, base) };
}

function bandText(m, base) {
  const lo = base.value * (1 - base.band.rel) - base.band.abs;
  const hi = base.value * (1 + base.band.rel) + base.band.abs;
  return `${m.value} vs ${base.value} ${m.unit} (band ${lo.toFixed(2)}..${hi.toFixed(2)})`;
}

// ── the instrument registry ──────────────────────────────────────────────────
//
// `producer` is what gets hashed to pin the instrument. For the ledger that is
// the Rust source, because `cargo xtask coverage --json` emits metrics only —
// xtask has zero dependencies and hashing itself would mean adding one.
const INSTRUMENTS = {
  ledger: { producer: "xtask/src/coverage.rs", deterministic: true },
  "perf-sim": { producer: "crates/pk-core/examples/perf_suite.rs" },
  "perf-ab": { producer: "scripts/pk-perf-ab.mjs" },
  "perf-scene": { producer: "crates/pk-game/src/perf.rs" },
  visual: { producer: "scripts/lib/pk-shutter.mjs", optionalProducer: true },
  drift: { producer: "scripts/pk-drift.sh" },
  // The intro A/B, from 2026-08-13 — it only became recordable when it grew
  // `--rounds` (work item 2-2 / incident I-3). At N=1 every metric it emitted
  // was `void:one-sample` by the envelope's own rule, which is the correct
  // description of a rig that shoots one frame of a moving picture.
  "ab-intro": { producer: "scripts/pk-ab-intro.mjs" },
};

function baselinePath(instrument) {
  return join(BASELINE_DIR, `${instrument}.json`);
}

/** Accept either a full envelope or an instrument's raw metrics block, and
 *  enrich the raw form here — so a Rust instrument never has to grow a sha256
 *  or a git dependency to take part. */
function loadRun(instrument, path) {
  const raw = readJson(path);
  const spec = INSTRUMENTS[instrument];
  if (!spec) die(`unknown instrument '${instrument}' — known: ${Object.keys(INSTRUMENTS).join(", ")}`);
  if (!Array.isArray(raw.metrics)) die(`${path}: no metrics[] — not an envelope`);
  const producerPath = join(ROOT, spec.producer);
  const producerSha256 =
    raw.producerSha256 ??
    (existsSync(producerPath) ? sha256File(producerPath) : spec.optionalProducer ? null : die(`producer missing: ${spec.producer}`));
  // A baseline with no commit cannot be bisected, so a raw instrument that did
  // not stamp one gets it here rather than being recorded anonymously.
  const commit = raw.commit ?? gitShort();
  return {
    ...raw,
    instrument,
    producer: raw.producer ?? spec.producer,
    producerSha256,
    deterministic: raw.deterministic ?? spec.deterministic ?? false,
    at: raw.at ?? new Date().toISOString(),
    commit,
    dirty: raw.dirty ?? gitDirty(),
    env: raw.env ?? { nproc: null, loadavg1Before: loadNow() },
  };
}

function gitShort() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function gitDirty() {
  try {
    return execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).trim() !== "";
  } catch {
    return null;
  }
}

// ── commands ─────────────────────────────────────────────────────────────────

function cmdCheck(instrument, opts) {
  const run = loadRun(instrument, opts.from);
  const bpath = baselinePath(instrument);
  if (!existsSync(bpath)) {
    console.log(`no baseline for '${instrument}'. Record one:`);
    console.log(`  node scripts/pk-baseline.mjs record ${instrument} --from ${opts.from}`);
    return EXIT.INCONCLUSIVE;
  }
  const base = readJson(bpath);

  // 1. The ruler changed. Before any comparison, because a comparison across an
  //    instrument edit is a comparison of two different instruments.
  if (base.producerSha256 && run.producerSha256 && base.producerSha256 !== run.producerSha256) {
    if (!opts.rigChange) {
      console.error(`${VERDICT.INSTRUMENT_CHANGED}: ${run.producer}`);
      console.error(`  baseline ${base.producerSha256.slice(0, 12)}`);
      console.error(`  run      ${run.producerSha256.slice(0, 12)}`);
      console.error(`  Re-record, or pass --rig-change "<why this edit does not move the number>".`);
      return EXIT.INSTRUMENT;
    }
    console.log(`⚠ rig changed, accepted: ${opts.rigChange}`);
  }

  let worst = EXIT.OK;
  const rows = [];
  for (const m of run.metrics) {
    const { verdict, why } = judge(m, base.metrics?.[m.id], run, opts);
    rows.push({ id: m.id, verdict, why });
    if (verdict === VERDICT.REGRESSION) worst = Math.max(worst, EXIT.REGRESSION);
    else if (verdict === VERDICT.INCONCLUSIVE || verdict === VERDICT.NEW) {
      worst = worst === EXIT.REGRESSION ? worst : EXIT.INCONCLUSIVE;
    }
  }

  const pad = Math.max(...rows.map((r) => r.id.length));
  for (const r of rows) {
    const mark =
      r.verdict === VERDICT.HELD ? "·" : r.verdict === VERDICT.IMPROVED ? "↑" : r.verdict === VERDICT.REGRESSION ? "✗" : "?";
    console.log(`  ${mark} ${r.id.padEnd(pad)}  ${r.verdict.padEnd(13)} ${r.why}`);
  }
  const improved = rows.filter((r) => r.verdict === VERDICT.IMPROVED);
  if (improved.length) {
    console.log(`\n${improved.length} metric(s) IMPROVED and are not yet recorded. Ratchet them down:`);
    console.log(`  node scripts/pk-baseline.mjs record ${instrument} --from ${opts.from}`);
  }
  return worst;
}

function cmdRecord(instrument, opts) {
  const run = loadRun(instrument, opts.from);
  const bpath = baselinePath(instrument);
  const base = existsSync(bpath)
    ? readJson(bpath)
    : { schema: 1, instrument, producerSha256: run.producerSha256, metrics: {}, regressions: [] };

  // A baseline taken on a box that could not measure is the precise failure
  // this whole system exists to prevent, so it is refused rather than warned on.
  const bad = run.metrics.filter((m) => m.quality !== QUALITY.OK);
  if (bad.length && !opts.force) {
    console.error(`refusing to record: ${bad.length} metric(s) are not quality=ok`);
    for (const m of bad) console.error(`  ${m.id}: ${m.quality}`);
    console.error(`A baseline is the thing everything else is judged against.`);
    return EXIT.INCONCLUSIVE;
  }

  let wrote = 0;
  for (const m of run.metrics) {
    const prev = base.metrics[m.id];
    if (prev && isWorse(m.dir, m.value, prev) && !opts.reason) {
      console.error(`refusing to record a WORSE ${m.id}: ${bandText(m, prev)}`);
      console.error(`  Pass --reason "<why>" and it is filed in regressions[].`);
      return EXIT.REGRESSION;
    }
    if (prev && isWorse(m.dir, m.value, prev)) {
      base.regressions.push({
        id: m.id,
        from: prev.value,
        to: m.value,
        at: run.at ?? new Date().toISOString(),
        commit: run.commit ?? null,
        reason: opts.reason,
      });
    }
    const noiseAtRecord = m.noise?.value ?? 0;
    base.metrics[m.id] = {
      unit: m.unit,
      dir: m.dir,
      value: m.value,
      band: run.deterministic ? { rel: 0, abs: 0 } : bandFor(noiseAtRecord, m.unit),
      noiseAtRecord,
      n: m.n ?? 1,
      at: run.at ?? new Date().toISOString(),
      commit: run.commit ?? null,
      history: [...(prev?.history ?? []), ...(prev ? [{ at: prev.at, value: prev.value, commit: prev.commit }] : [])].slice(-20),
    };
    wrote++;
  }
  base.producerSha256 = run.producerSha256;
  base.deterministic = run.deterministic;
  mkdirSync(BASELINE_DIR, { recursive: true });
  writeFileSync(bpath, JSON.stringify(base, null, 2) + "\n");
  console.log(`recorded ${wrote} metric(s) → assets/baselines/${instrument}.json`);
  return EXIT.OK;
}

/** Schema hygiene. Cheap, deterministic, and it runs in CI. */
function cmdLint() {
  if (!existsSync(BASELINE_DIR)) {
    console.log("no baselines yet");
    return EXIT.OK;
  }
  let bad = 0;
  for (const f of readdirSync(BASELINE_DIR).filter((f) => f.endsWith(".json"))) {
    const b = readJson(join(BASELINE_DIR, f));
    const name = f.replace(/\.json$/, "");
    if (!INSTRUMENTS[name]) {
      console.error(`${f}: '${name}' is not a known instrument`);
      bad++;
    }
    for (const [id, m] of Object.entries(b.metrics ?? {})) {
      for (const k of ["unit", "dir", "value", "band", "noiseAtRecord"]) {
        if (m[k] === undefined) {
          console.error(`${f}: ${id} has no ${k}`);
          bad++;
        }
      }
      if (m.dir && m.dir !== "lower-better" && m.dir !== "higher-better") {
        console.error(`${f}: ${id} has dir='${m.dir}'`);
        bad++;
      }
      // A non-deterministic metric banded at zero is a fixed floor wearing a
      // ratchet's clothes: it will go red on the first noisy afternoon.
      if (!b.deterministic && m.band && m.band.rel === 0 && m.band.abs === 0) {
        console.error(`${f}: ${id} has a zero band but the instrument is not deterministic`);
        bad++;
      }
    }
  }
  console.log(bad === 0 ? "baselines lint clean" : `${bad} problem(s)`);
  return bad === 0 ? EXIT.OK : EXIT.USAGE;
}

function cmdReport() {
  if (!existsSync(BASELINE_DIR)) return EXIT.OK;
  const out = [
    "# Recorded baselines",
    "",
    "Generated by `node scripts/pk-baseline.mjs report`. **Do not hand-edit.**",
    "",
    "Every number this project claims lives here, not in prose. A band is derived",
    "from the instrument's own measured noise at the moment of record — see the",
    "header of `scripts/pk-baseline.mjs` for why it is not typed in by hand.",
    "",
  ];
  for (const f of readdirSync(BASELINE_DIR).filter((f) => f.endsWith(".json")).sort()) {
    const b = readJson(join(BASELINE_DIR, f));
    out.push(`## ${b.instrument}${b.deterministic ? " (deterministic — hard ratchet)" : ""}`, "");
    out.push("| metric | value | band | noise at record | n | commit |");
    out.push("|---|---:|---|---:|---:|---|");
    for (const [id, m] of Object.entries(b.metrics ?? {})) {
      const band = m.band.rel === 0 && m.band.abs === 0 ? "exact" : `±${(m.band.rel * 100).toFixed(0)}% +${m.band.abs}`;
      out.push(`| \`${id}\` | ${m.value} ${m.unit} | ${band} | ${(m.noiseAtRecord * 100).toFixed(1)}% | ${m.n} | \`${m.commit ?? "—"}\` |`);
    }
    out.push("");
    if (b.regressions?.length) {
      out.push("### Accepted regressions", "");
      for (const r of b.regressions) {
        out.push(`- \`${r.id}\` ${r.from} → ${r.to} at \`${r.commit}\` — ${r.reason}`);
      }
      out.push("");
    }
  }
  const path = join(ROOT, "docs", "src", "status", "baselines.md");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, out.join("\n") + "\n");
  console.log(`wrote docs/src/status/baselines.md`);
  return EXIT.OK;
}

// ── cli ──────────────────────────────────────────────────────────────────────

function die(msg) {
  console.error(msg);
  process.exit(EXIT.USAGE);
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const opts = { confirm: false, force: false };
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--from") opts.from = rest[++i];
    else if (a === "--reason") opts.reason = rest[++i];
    else if (a === "--rig-change") opts.rigChange = rest[++i];
    else if (a === "--confirm") opts.confirm = true;
    else if (a === "--force") opts.force = true;
    else positional.push(a);
  }
  switch (cmd) {
    case "check":
      if (!positional[0] || !opts.from) die("usage: check <instrument> --from run.json");
      return cmdCheck(positional[0], opts);
    case "record":
      if (!positional[0] || !opts.from) die("usage: record <instrument> --from run.json");
      return cmdRecord(positional[0], opts);
    case "lint":
      return cmdLint();
    case "report":
      return cmdReport();
    default:
      die("usage: pk-baseline.mjs check|record|lint|report");
  }
}

process.exit(main(process.argv.slice(2)));
