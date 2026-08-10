// Dump a unary sweep's raw f64 bits from the JS runtime, and diff two such
// dumps — the debugging instrument behind the `jsmath` twins.
//
// The oracle digest is a PASS/FAIL: it says "this curve is wrong" over 200,001
// values and nothing else. This says *which x*, which is the difference between
// "cos is wrong somewhere" and "cos is wrong for |x| ≥ 0.3, so it is the qx
// branch". Both sides write the same layout — little-endian f64, k ascending —
// so the Rust side is `cargo run -p pk-core --example dump_unary`.
//
//   node scripts/dump-trig-sweep.mjs cos 0 20 200000 /tmp/node.bin
//   cargo run -p pk-core --example dump_unary -- js_cos 0 20 200000 /tmp/rust.bin
//   node scripts/dump-trig-sweep.mjs --diff 0 20 200000 /tmp/node.bin /tmp/rust.bin
//
// Not wired into any test on purpose: it writes wherever you point it, and
// nothing gates on it.
import { readFileSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);

if (argv[0] === "--diff") {
  const [, fromS, toS, nS, aPath, bPath] = argv;
  const from = Number(fromS);
  const to = Number(toS);
  const n = Number(nS);
  const a = readFileSync(aPath);
  const b = readFileSync(bPath);
  if (a.length !== b.length) {
    console.log(`LENGTH ${a.length} vs ${b.length}`);
    process.exit(1);
  }
  let bad = 0;
  for (let k = 0; k <= n; k++) {
    const av = a.readBigUInt64LE(k * 8);
    const bv = b.readBigUInt64LE(k * 8);
    if (av === bv) continue;
    bad++;
    if (bad <= 12) {
      const x = from + ((to - from) * k) / n;
      const ulp = bv - av;
      console.log(
        `k=${k} x=${x} a=0x${av.toString(16).padStart(16, "0")} (${a.readDoubleLE(k * 8)})` +
          `  b=0x${bv.toString(16).padStart(16, "0")} (${b.readDoubleLE(k * 8)})  ulp=${ulp}`,
      );
    }
  }
  console.log(`${bad} / ${n + 1} differ`);
  process.exit(bad === 0 ? 0 : 1);
}

const [name, fromS, toS, nS, out] = argv;
const from = Number(fromS);
const to = Number(toS);
const n = Number(nS);
const f = Math[name];
if (typeof f !== "function") throw new Error(`no Math.${name}`);

const buf = Buffer.allocUnsafe((n + 1) * 8);
for (let k = 0; k <= n; k++) buf.writeDoubleLE(f(from + ((to - from) * k) / n), k * 8);
writeFileSync(out, buf);
console.log(`${name} [${from},${to}] n=${n} -> ${out}`);
