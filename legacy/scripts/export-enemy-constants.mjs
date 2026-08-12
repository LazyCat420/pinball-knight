/**
 * Emit `constants/enemies.ts`'s scalar table as Rust, FROM THE ORACLE'S MODULE.
 *
 * 276 exported constants. Hand-transcription is 276 chances to typo one digit,
 * and a wrong enemy constant is invisible: nothing crashes, a monster is just
 * slightly wrong forever. Importing the shipped module means the values ARE the
 * shipped ones by construction, and `TIDE_RAMP` (which is computed from two
 * others) comes out right without the port having to re-derive it.
 *
 *   node scripts/export-enemy-constants.mjs > ../crates/pk-core/src/enemies.rs
 *
 * Re-run it when the oracle's table moves; the Rust file is GENERATED and the
 * header says so.
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const mod = resolve(here, "../src/game/pinball-knight/constants/enemies.ts");
const E = await import(mod);

const scalars = [];
const arrays = [];
for (const [k, v] of Object.entries(E)) {
  if (typeof v === "number") scalars.push([k, v]);
  else if (Array.isArray(v) && v.every((x) => typeof x === "number")) arrays.push([k, v]);
}
scalars.sort((a, b) => a[0].localeCompare(b[0]));
arrays.sort((a, b) => a[0].localeCompare(b[0]));

/** An integer-valued float still prints as `2.0` — Rust needs the point. */
const f64 = (n) => (Number.isInteger(n) ? `${n}.0` : String(n));
/** Which constants are counts/indices rather than measurements. */
const isInt = (k, v) =>
  Number.isInteger(v) &&
  /(_HP|_COUNT|_MAX_N|_N|_BOUNCES|_HITS|_SEGMENTS|_MILESTONES|_DAMAGE|_GOLD|_XP)$/.test(k);

const out = [];
out.push("//! GENERATED from `legacy/src/game/pinball-knight/constants/enemies.ts`");
out.push("//! by `legacy/scripts/export-enemy-constants.mjs` — do not hand-edit.");
out.push("//!");
out.push("//! The roster's numbers: per-kind stats, gates, spawn ratios and the floor");
out.push("//! timer. Generated rather than transcribed because 276 constants is 276");
out.push("//! chances to typo a digit, and a wrong enemy constant does not crash — the");
out.push("//! monster is just slightly wrong, forever.");
out.push("//!");
out.push("//! PORTS: `constants/enemies.ts`");
out.push("");
out.push("#![allow(dead_code)]");
out.push("");
for (const [k, v] of scalars) {
  out.push(isInt(k, v) ? `pub const ${k}: i32 = ${v};` : `pub const ${k}: f64 = ${f64(v)};`);
}
out.push("");
for (const [k, v] of arrays) {
  const allInt = v.every(Number.isInteger);
  const ty = allInt ? "i32" : "f64";
  const body = v.map((x) => (allInt ? String(x) : f64(x))).join(", ");
  out.push(`pub const ${k}: [${ty}; ${v.length}] = [${body}];`);
}
out.push("");
console.log(out.join("\n"));
