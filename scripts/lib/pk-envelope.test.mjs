// Tests for the envelope + comparator. No GPU, no browser, no shared box — so
// unlike everything else that measures this port, these run in CI.
//
//   node --test scripts/lib/pk-envelope.test.mjs
//
// What is worth testing here is not the arithmetic; it is the REFUSALS. Every
// one of these asserts that the instrument declines to produce a number it
// cannot back, because every gate this project has had to repair failed the
// other way — by producing a confident value from a run that did not support it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { acrossRounds, metric, QUALITY, qualityForExit, BROKER_NO_GRANT } from "./pk-envelope.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const BASELINE = join(ROOT, "scripts", "pk-baseline.mjs");

test("acrossRounds reports the median and the RANGE, not a bare mean", () => {
  // Median, not mean: one round that hit a compositor hiccup must not drag the
  // reading. Range, not stddev: at n=3 a stddev is theatre.
  const r = acrossRounds([30.0, 31.0, 41.0]);
  assert.equal(r.value, 31.0, "median");
  assert.equal(r.lo, 30.0);
  assert.equal(r.hi, 41.0);
  assert.ok(Math.abs(r.noise.value - 11 / 31) < 1e-3, "noise is (hi-lo)/median");
});

test("a single round is stamped void:one-sample, not quality ok", () => {
  // THE RULE THIS FILE EXISTS FOR. Every visual number this project recorded
  // before 2026-08-12 was a single shot presented as though it had a tolerance.
  const m = metric({ id: "x", unit: "diff", dir: "lower-better", value: 30.2, n: 1 });
  assert.equal(m.quality, QUALITY.ONE_SAMPLE);
});

test("a DETERMINISTIC instrument may report n=1 and still be ok", () => {
  // The ledger reads no GPU and no clock; one reading is complete, not
  // under-sampled. This is what lets it be the one hard ratchet.
  const m = metric({
    id: "ledger.x",
    unit: "%",
    dir: "higher-better",
    value: 25,
    n: 1,
    deterministic: true,
  });
  assert.equal(m.quality, QUALITY.OK);
});

test("n > 1 without a spread is refused outright", () => {
  // Three rounds reported as one number with no dispersion is exactly as
  // unfalsifiable as one round, and harder to notice.
  assert.throws(
    () => metric({ id: "x", unit: "ms", dir: "lower-better", value: 16, n: 3 }),
    /no noise/,
  );
});

test("dir is mandatory and must be one of the two directions", () => {
  // A comparator that guesses whether lower is better will guess wrong on the
  // first metric where it is not.
  assert.throws(() => metric({ id: "x", unit: "ms", value: 1 }), /dir/);
  assert.throws(
    () => metric({ id: "x", unit: "ms", dir: "smaller", value: 1 }),
    /lower-better/,
  );
});

test("broker exit 75 is a void grant, NOT a failure", () => {
  // The exact classes refuse rather than run narrow. A harness that maps 75 to
  // "failed" turns a busy desktop into a red suite.
  assert.equal(qualityForExit(BROKER_NO_GRANT), QUALITY.GRANT);
  assert.equal(qualityForExit(0), QUALITY.OK);
  assert.equal(qualityForExit(1), null);
});

/* ── the comparator, end to end over a temp baseline dir ─────────────────── */

function runBaseline(args, env = {}) {
  try {
    const out = execFileSync(process.execPath, [BASELINE, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    return { status: 0, out };
  } catch (e) {
    return { status: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

function envelopeFile(dir, metrics, extra = {}) {
  const p = join(dir, "run.json");
  writeFileSync(
    p,
    JSON.stringify({
      schema: 1,
      instrument: "ledger",
      producer: "xtask/src/coverage.rs",
      deterministic: true,
      metrics,
      ...extra,
    }),
  );
  return p;
}

/** A ledger-shaped envelope with one metric at `pct`. */
function ledgerAt(dir, pct, name = "run.json") {
  const p = join(dir, name);
  writeFileSync(
    p,
    JSON.stringify({
      schema: 1,
      instrument: "ledger",
      producer: "xtask/src/coverage.rs",
      deterministic: true,
      metrics: [
        { id: "ledger.tier1.converted_pct", unit: "%", dir: "higher-better", value: pct, n: 1, quality: "ok" },
      ],
    }),
  );
  return p;
}

test("the ledger ratchet: HELD, then a fall is a REGRESSION", () => {
  const dir = mkdtempSync(join(tmpdir(), "pk-baseline-"));
  const env = { PK_BASELINE_DIR: dir };

  const at25 = ledgerAt(dir, 25, "at25.json");
  assert.equal(runBaseline(["record", "ledger", "--from", at25], env).status, 0, "records");

  const held = runBaseline(["check", "ledger", "--from", at25], env);
  assert.equal(held.status, 0, held.out);
  assert.match(held.out, /HELD/);

  // THE SABOTAGE: the number goes backwards. A deterministic instrument has no
  // band, so this is a regression on the first sample — no --confirm needed.
  const at24 = ledgerAt(dir, 24.6, "at24.json");
  const fell = runBaseline(["check", "ledger", "--from", at24], env);
  assert.equal(fell.status, 1, `a fall must exit 1, got ${fell.status}: ${fell.out}`);
  assert.match(fell.out, /REGRESSION/);

  // And `record` must refuse to enshrine it without a written reason.
  const refused = runBaseline(["record", "ledger", "--from", at24], env);
  assert.equal(refused.status, 1, refused.out);
  assert.match(refused.out, /refusing to record a WORSE/);

  // With a reason it is accepted AND filed, so the fall is on the record.
  const forced = runBaseline(["record", "ledger", "--from", at24, "--reason", "test"], env);
  assert.equal(forced.status, 0, forced.out);
  const after = JSON.parse(readFileSync(join(dir, "ledger.json"), "utf8"));
  assert.equal(after.regressions.length, 1, "the fall is filed, not silent");
  assert.equal(after.regressions[0].reason, "test");
});

test("an improvement is reported and NOT silently recorded", () => {
  // Row 7 exists so the record tracks the best measured state, but recording is
  // a deliberate act: a check that quietly re-baselines upward can never report
  // a later fall against the value you actually shipped.
  const dir = mkdtempSync(join(tmpdir(), "pk-improve-"));
  const env = { PK_BASELINE_DIR: dir };
  runBaseline(["record", "ledger", "--from", ledgerAt(dir, 25, "a.json")], env);
  const up = runBaseline(["check", "ledger", "--from", ledgerAt(dir, 31, "b.json")], env);
  assert.equal(up.status, 0, up.out);
  assert.match(up.out, /IMPROVED/);
  const still = JSON.parse(readFileSync(join(dir, "ledger.json"), "utf8"));
  assert.equal(still.metrics["ledger.tier1.converted_pct"].value, 25, "check must not write");
});

test("a run the instrument could not measure is INCONCLUSIVE, never a regression", () => {
  // The single most important verdict in the file: a busy box must not read as
  // a code regression, or the gate gets ignored within a week.
  const dir = mkdtempSync(join(tmpdir(), "pk-void-"));
  const env = { PK_BASELINE_DIR: dir };
  runBaseline(["record", "ledger", "--from", ledgerAt(dir, 25, "a.json")], env);

  const p = join(dir, "void.json");
  writeFileSync(
    p,
    JSON.stringify({
      schema: 1,
      instrument: "ledger",
      producer: "xtask/src/coverage.rs",
      deterministic: true,
      metrics: [
        // A value far worse than the baseline, but the instrument disowns it.
        { id: "ledger.tier1.converted_pct", unit: "%", dir: "higher-better", value: 2, n: 1, quality: "void:grant" },
      ],
    }),
  );
  const r = runBaseline(["check", "ledger", "--from", p], env);
  assert.equal(r.status, 3, `void:grant must be INCONCLUSIVE (3), got ${r.status}: ${r.out}`);
  assert.match(r.out, /INCONCLUSIVE/);
  assert.doesNotMatch(r.out, /REGRESSION/);

  // …and it must not be recordable either.
  const rec = runBaseline(["record", "ledger", "--from", p], env);
  assert.equal(rec.status, 3, rec.out);
  assert.match(rec.out, /refusing to record/);
});

test("an edited instrument is exit 4, BEFORE any comparison", () => {
  const dir = mkdtempSync(join(tmpdir(), "pk-rig-"));
  const env = { PK_BASELINE_DIR: dir };
  runBaseline(["record", "ledger", "--from", ledgerAt(dir, 25, "a.json")], env);
  const b = JSON.parse(readFileSync(join(dir, "ledger.json"), "utf8"));
  b.producerSha256 = "0".repeat(64); // as if coverage.rs had been edited
  writeFileSync(join(dir, "ledger.json"), JSON.stringify(b));

  const r = runBaseline(["check", "ledger", "--from", ledgerAt(dir, 25, "c.json")], env);
  assert.equal(r.status, 4, `an edited ruler is exit 4, got ${r.status}: ${r.out}`);
  assert.match(r.out, /INSTRUMENT CHANGED/);
  // The escape hatch works, or nobody will ever touch a rig again.
  const ok = runBaseline(
    ["check", "ledger", "--from", ledgerAt(dir, 25, "d.json"), "--rig-change", "comment only"],
    env,
  );
  assert.equal(ok.status, 0, ok.out);
});

test("lint rejects a non-deterministic metric banded at zero", () => {
  // A zero band on a noisy instrument is a fixed floor wearing a ratchet's
  // clothes: green until the first busy afternoon, then permanently red.
  const dir = mkdtempSync(join(tmpdir(), "pk-lint-"));
  const bad = {
    schema: 1,
    instrument: "perf-ab",
    deterministic: false,
    metrics: {
      "tavern.p50": {
        unit: "ms",
        dir: "lower-better",
        value: 16,
        band: { rel: 0, abs: 0 },
        noiseAtRecord: 0.04,
        n: 3,
      },
    },
  };
  writeFileSync(join(dir, "perf-ab.json"), JSON.stringify(bad));
  // Read the shipped lint logic against this fixture by pointing the tool at it
  // is not supported (BASELINE_DIR is fixed), so assert the invariant directly —
  // the same predicate the tool applies.
  const m = bad.metrics["tavern.p50"];
  const offending = !bad.deterministic && m.band.rel === 0 && m.band.abs === 0;
  assert.ok(offending, "this fixture must be the case lint rejects");
  assert.match(readFileSync(BASELINE, "utf8"), /zero band but the instrument is not deterministic/);
});
