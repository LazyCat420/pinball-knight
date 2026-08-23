#!/usr/bin/env node
// The jsmath parity gate, run against the SHIPPED target instead of this box.
//
// `crates/pk-core/tests/jsmath_oracle.rs` proves the math twins reproduce the
// JS runtime — natively, linked against the system libm. Players do not run
// that build. On `wasm32-unknown-unknown` there is no system libm and
// `f64::powf` lowers to `compiler_builtins`, i.e. the `libm` crate, i.e.
// fdlibm — the implementation that same oracle already measured as NOT V8's
// (19,904 of 200,001 inputs on x^1.35). `js_pow` is called ~140× per generated
// floor and its result decides lane WIDTH, so a wasm-only divergence produces a
// floor with the right topology and the wrong roads, in the browser only, with
// every native fixture still green.
//
// So: compile the same digest loops into wasm (`crates/pk-jsmath-probe`),
// instantiate them here, and compare against `assets/fixtures/jsmath-oracle.json`
// — the exact bytes node exported in the first place.
//
// This script covers WASM only. The Windows target has a cargo runner, so it is
// covered by the ordinary test binary and needs no probe:
//
//   cargo test --target x86_64-pc-windows-gnullvm -p pk-core --test jsmath_oracle
//
// Run that one too — measured 2026-08-10, mingw's `pow` was off the runtime on
// 201 of 200,001 x^1.35 inputs and was NOT fdlibm either, so "wasm is the odd
// one out" was the wrong mental model. Both are now covered by carrying the
// routine (`jsmath::pow_arm`) rather than by trusting any target's libm.
//
// Run: node scripts/jsmath-wasm-check.mjs [--build]
//   --build   cargo-build the probe first (default: build if the .wasm is
//             missing or older than the crate source)
//
// Exit 0 = wasm reproduces the runtime. Exit 1 = it does not, and the report
// names which primitive and which range.

import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TARGET = 'wasm32-unknown-unknown'
const WASM = join(ROOT, 'target', TARGET, 'release', 'pk_jsmath_probe.wasm')
const FIXTURE = join(ROOT, 'assets', 'fixtures', 'jsmath-oracle.json')

// The selector table, mirroring `pk-jsmath-probe/src/lib.rs`. Kept as data so
// the driver can assert it COVERED every swept name rather than silently
// skipping one it has no code for — the failure mode that let the whole pow
// gate sit unexecuted for a week under a wrong filename.
const REQUIRED = { cos: 0, sin: 1, exp: 2, log: 3, sqrt: 4, atan: 5, tan: 6 }
const LIBM = { cos: 100, sin: 101, exp: 102, log: 103 }
const STD = { cos: 200, sin: 201, exp: 202, log: 203, tan: 204 }

function newestMtime(dir) {
  const out = execFileSync('find', [dir, '-type', 'f', '-newer', WASM], { encoding: 'utf8' })
  return out.trim().length > 0
}

function ensureBuilt(force) {
  const stale =
    force ||
    !existsSync(WASM) ||
    newestMtime(join(ROOT, 'crates', 'pk-jsmath-probe')) ||
    newestMtime(join(ROOT, 'crates', 'pk-core', 'src'))
  if (!stale) return
  process.stderr.write(`building pk-jsmath-probe for ${TARGET}…\n`)
  // --release so the optimiser gets the same shot at the math it gets in a
  // shipped build. A debug build could plausibly keep a call the release build
  // constant-folds, and it is the shipped configuration that is in question.
  execFileSync(
    'cargo',
    ['build', '--release', '--target', TARGET, '-p', 'pk-jsmath-probe'],
    { cwd: ROOT, stdio: 'inherit' },
  )
}

const force = process.argv.includes('--build')
ensureBuilt(force)
if (!existsSync(WASM)) {
  console.error(`no wasm at ${WASM} — build failed?`)
  process.exit(1)
}

const { instance } = await WebAssembly.instantiate(readFileSync(WASM), {})
const w = instance.exports
const oracle = JSON.parse(readFileSync(FIXTURE, 'utf8'))

// u32 comes back through i32; normalise before comparing to the fixture.
const u32 = (v) => v >>> 0
const NO_SUCH_KIND = 0xffffffff

const fail = []
const note = []
let checked = 0

// ── 1. the unary sweeps ─────────────────────────────────────────────────────
const seenNames = new Set()
for (const u of oracle.unary) {
  seenNames.add(u.name)
  const kind = REQUIRED[u.name]
  if (kind === undefined) {
    fail.push(`  Math.${u.name}: no selector in the probe — the sweep is NOT being checked`)
    continue
  }
  const got = u32(w.unary_digest(kind, u.from, u.to, u.n))
  if (got === NO_SUCH_KIND) {
    fail.push(`  Math.${u.name}: probe rejected selector ${kind}`)
    continue
  }
  if (got !== u.digest) {
    fail.push(
      `  Math.${u.name} over [${u.from}, ${u.to}] (${u.n} points): ` +
        `wasm ${got} vs runtime ${u.digest}`,
    )
  }
  checked++
}
for (const name of Object.keys(REQUIRED)) {
  if (!seenNames.has(name)) note.push(`  probe carries a selector for ${name} but the fixture has no sweep for it`)
}

// ── 2. the atan2 lattices ───────────────────────────────────────────────────
for (const b of oracle.binaries) {
  if (b.name !== 'atan2') {
    fail.push(`  ${b.name}: no lattice selector in the probe`)
    continue
  }
  const got = u32(w.lattice_digest(0, b.from, b.to, b.n))
  if (got !== b.digest) {
    fail.push(
      `  Math.atan2(y, x) over [${b.from}, ${b.to}]² (${b.n}² points): ` +
        `wasm ${got} vs runtime ${b.digest}`,
    )
  }
  checked++
}

// ── 3. js_pow — the one the whole script exists for ─────────────────────────
for (const [base, exp, want] of oracle.spot) {
  const got = w.pow_spot(base, exp)
  if (!Object.is(got, want)) {
    fail.push(`  js_pow(${base}, ${exp}) = ${got}, runtime says ${want}`)
  }
  checked++
}

let powDiverged = 0
for (const s of oracle.sweeps) {
  const got = u32(w.pow_sweep_digest(s.exp, s.n))
  if (got !== s.digest) {
    powDiverged++
    // Name the cause rather than the symptom: if the wasm answer equals
    // fdlibm's, the divergence IS the compiler_builtins lowering and not some
    // third thing.
    const asFdlibm = u32(w.pow_sweep_digest_libm(s.exp, s.n))
    const cause =
      asFdlibm === got
        ? 'wasm powf == libm::pow (fdlibm) — the compiler_builtins lowering, as predicted'
        : 'wasm powf is a THIRD implementation — matches neither the runtime nor fdlibm'
    fail.push(`  x^${s.exp} over ${s.n} points: wasm ${got} vs runtime ${s.digest}\n      ${cause}`)
  }
  checked++
}

// ── 4. the negative controls, carried onto this target ──────────────────────
//
// Native, `libm::cos` and std's must both DISAGREE with the runtime, or the
// hand-transcribed twins are ceremony. That claim is per-target too: on wasm,
// std's cos IS libm's, so this run also documents which of the two collapsed.
for (const u of oracle.unary) {
  for (const [who, table] of [['libm', LIBM], ['std', STD]]) {
    const kind = table[u.name]
    if (kind === undefined) continue
    const got = u32(w.unary_digest(kind, u.from, u.to, u.n))
    if (got === u.digest && (u.name === 'cos' || u.name === 'sin')) {
      fail.push(
        `  ${who}::${u.name} AGREES with the runtime over [${u.from}, ${u.to}] on wasm — ` +
          `jsmath::fdlibm's rationale changed on this target`,
      )
    }
  }
}

// ── report ──────────────────────────────────────────────────────────────────
console.log(`jsmath under ${TARGET}: ${checked} comparisons`)
for (const n of note) console.log(`note:\n${n}`)
if (fail.length === 0) {
  console.log('  ALL GREEN — the wasm build reproduces the JS runtime')
  console.log('  (including js_pow, which was the open question)')
  process.exit(0)
}
console.error(`\n${fail.length} divergence(s) on the SHIPPED target:\n${fail.join('\n')}`)
if (powDiverged > 0) {
  console.error(
    `\njs_pow diverged on ${powDiverged} of ${oracle.sweeps.length} sweeps. It is called ~140×\n` +
      `per generated floor feeding lane widths, so the browser build generates floors the\n` +
      `native fixtures do not certify. Fix: give js_pow a target-independent implementation\n` +
      `(transcribe the routine the runtime uses) rather than deferring to f64::powf.`,
  )
}
process.exit(1)
