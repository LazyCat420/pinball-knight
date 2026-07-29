#!/usr/bin/env node
/**
 * Registry-drift check for src/game/pinball-knight.
 *
 * The nine `Record<EnemyKind, X>` tables in this subtree are compile-enforced:
 * add a kind, and tsc reddens until every one of them has an entry. This script
 * covers the registries that are NOT — the array literals, the `switch` arms and
 * the duplicated literal tables, where adding a kind is silently accepted and
 * the thing just never happens.
 *
 * Four checks, all pure text over source (no imports, no build, ~50ms):
 *
 *   A. union coverage   — a `: EnemyKind[]` / `: SheetKey[]` array literal must
 *                         list every member of its union. The stale ones here
 *                         were TESTS, which is the whole point: a completeness
 *                         suite that hand-lists its own roster stops being a
 *                         completeness suite the moment the roster grows.
 *   B. themed spawns    — every kind weighted in a biome `enemies` table must
 *                         have a `case` in `spawnKind`, or that weight is dead
 *                         and the pick silently falls through to the cascade.
 *   C. skin ↔ portrait  — `EXPANSION_SKIN` (spawn/factory.ts) and `KIND_PORTRAIT`
 *                         (render/monster-portrait.ts) hold duplicated tint/scale
 *                         literals. Drift means the card lies about what you hunt.
 *   D. floor-1 atlases  — a kind gated at level 1 must have its sheet in
 *                         `ESSENTIAL`, or its atlas builds on a gameplay frame.
 *                         The gate constant is read out of spawnKind's own arm,
 *                         so the irregular names (CRYSTAL_/NECRO_/WEBSPIN_) come
 *                         from the code rather than a convention we'd have to
 *                         guess at.
 *
 * Exit 0 = clean, 1 = drift found (details on stdout).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const GAME = join(ROOT, "src/game/pinball-knight");

const read = (p) => readFileSync(join(GAME, p), "utf8");
const problems = [];
const fail = (check, msg) => problems.push({ check, msg });

/** Every .ts under the game subtree, minus any stray nested node_modules. */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Members of `export type Name = | "a" | "b";` — tolerates several per line. */
function unionMembers(src, name) {
  const m = src.match(new RegExp(`export type ${name}\\s*=([\\s\\S]*?);`, "m"));
  if (!m) throw new Error(`could not find "export type ${name}"`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/** The bracketed run starting at the first `open` at or after `from`, matched. */
function spanAt(src, from, open = "{", close = "}") {
  const start = src.indexOf(open, from);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced ${open}${close} from ${from}`);
}
const blockAt = (src, from) => spanAt(src, from, "{", "}");
const listAt = (src, from) => spanAt(src, from, "[", "]");

const files = walk(GAME);
const UNIONS = {
  EnemyKind: unionMembers(read("state.ts"), "EnemyKind"),
  SheetKey: unionMembers(read("boot/sheets.ts"), "SheetKey"),
};

// ── A. union coverage ───────────────────────────────────────────────────────
//
// Only for literals that CLAIM to be complete. Plenty of `SheetKey[]` lists are
// partial on purpose — `ESSENTIAL` is "build these before the first frame",
// `BACKFILL` is an ordering — and demanding they be exhaustive would be noise
// that trains you to ignore the check. The two shapes that do claim it:
//   · anything named ALL_* / EVERY_* (the convention already in this subtree)
//   · any such literal inside a .test.ts — a suite that hand-lists its roster
//     stops covering the roster the moment it grows, which is exactly how
//     reagents.test.ts came to be nine kinds short while passing.
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const rel = file.slice(ROOT.length + 1);
  const isTest = file.endsWith(".test.ts");
  for (const [union, members] of Object.entries(UNIONS)) {
    const re = new RegExp(`(\\w+)\\s*:\\s*${union}\\[\\]\\s*=\\s*\\[`, "g");
    for (const m of src.matchAll(re)) {
      const varName = m[1];
      if (!isTest && !/^(ALL|EVERY)_/.test(varName)) continue;
      // Anchor past the match so we open the VALUE's `[`, not the `[]` that
      // closes the type annotation.
      const valueAt = m.index + m[0].length - 1;
      const listed = new Set([...listAt(src, valueAt).matchAll(/"([^"]+)"/g)].map((x) => x[1]));
      const missing = members.filter((k) => !listed.has(k));
      if (missing.length) {
        fail("A", `${rel}: ${varName}: ${union}[] is missing ${missing.length} of ${members.length} — ${missing.join(", ")}`);
      }
    }
  }
}

// ── B. themed spawns reach spawnKind ────────────────────────────────────────
{
  const factory = read("spawn/factory.ts");
  const swStart = factory.indexOf("export function spawnKind");
  const cases = new Set([...blockAt(factory, swStart).matchAll(/case\s+"([^"]+)"/g)].map((x) => x[1]));
  // Known-dead weights, left in place deliberately: spawnKind's own `default`
  // arm names zombie/pin/reaper as not horde-rollable via theme bias, so these
  // two picks fall through to the base cascade. That is a balance question
  // (prefabs weights them anyway), not a drift — allowlisted so the check stays
  // quiet enough to mean something when a NEW kind goes dead.
  const KNOWN_DEAD = new Set(["zombie", "pin"]);
  const prefabs = read("maze/prefabs.ts");
  for (const m of prefabs.matchAll(/enemies:\s*\{([^}]*)\}/g)) {
    for (const e of m[1].matchAll(/(\w+)\s*:\s*\d+/g)) {
      if (KNOWN_DEAD.has(e[1])) continue;
      if (!cases.has(e[1])) {
        fail("B", `maze/prefabs.ts: biome table weights "${e[1]}", but spawnKind has no case for it — that weight is dead, the pick falls through to the base cascade`);
      }
    }
  }
}

// ── C. EXPANSION_SKIN ↔ KIND_PORTRAIT ───────────────────────────────────────
{
  const skinBlock = blockAt(read("spawn/factory.ts"), read("spawn/factory.ts").indexOf("const EXPANSION_SKIN"));
  const portraitSrc = read("render/monster-portrait.ts");
  const portraitBlock = blockAt(portraitSrc, portraitSrc.indexOf("const KIND_PORTRAIT"));
  const entries = (block) => {
    const out = {};
    for (const m of block.matchAll(/(\w+):\s*\{([^}]*)\}/g)) {
      const tint = m[2].match(/tint:\s*(0x[0-9a-fA-F]+|null)/);
      const scale = m[2].match(/scale:\s*([\d.]+)/);
      if (tint && scale) out[m[1]] = { tint: tint[1].toLowerCase(), scale: scale[1] };
    }
    return out;
  };
  const skin = entries(skinBlock);
  const portrait = entries(portraitBlock);
  for (const [kind, s] of Object.entries(skin)) {
    const p = portrait[kind];
    if (!p) { fail("C", `KIND_PORTRAIT has no entry for expansion kind "${kind}"`); continue; }
    if (s.tint !== p.tint || s.scale !== p.scale) {
      fail("C", `"${kind}": EXPANSION_SKIN has tint ${s.tint}/scale ${s.scale}, KIND_PORTRAIT has tint ${p.tint}/scale ${p.scale} — the bestiary card would lie about what you're hunting`);
    }
  }
}

// ── D. floor-1 kinds have their atlas in ESSENTIAL ──────────────────────────
{
  const factory = read("spawn/factory.ts");
  const sheets = read("boot/sheets.ts");

  // Gate constant per kind, taken from spawnKind's own arm.
  const swBlock = blockAt(factory, factory.indexOf("export function spawnKind"));
  const gateOf = {};
  for (const m of swBlock.matchAll(/case\s+"([^"]+)":([\s\S]*?)(?=\n\s*case\s+"|\n\s*default:)/g)) {
    const g = m[2].match(/(\w+_FROM_LEVEL)/);
    if (g) gateOf[m[1]] = g[1];
  }

  // Constant values, from anywhere under constants/.
  const values = {};
  for (const file of files.filter((f) => f.includes("/constants/"))) {
    for (const m of readFileSync(file, "utf8").matchAll(/export const (\w+_FROM_LEVEL)\s*=\s*(\d+)/g)) {
      values[m[1]] = Number(m[2]);
    }
  }

  // kind → sheet key: own atlas, else the one its reskin/expansion borrows.
  const byKind = {};
  const mapBlock = blockAt(sheets, sheets.indexOf("SHEET_KEY_BY_KIND"));
  for (const m of mapBlock.matchAll(/(\w+):\s*"([^"]+)"/g)) byKind[m[1]] = m[2];
  for (const table of ["EXPANSION_SKIN", "RESKIN"]) {
    const block = blockAt(factory, factory.indexOf(`const ${table}`));
    for (const m of block.matchAll(/(\w+):\s*\{[^}]*sheetFor\("([^"]+)"\)/g)) byKind[m[1]] ??= m[2];
  }

  const essential = new Set(
    // From the `=`, so we read the value and not the `SheetKey[]` annotation.
    [...listAt(sheets, sheets.indexOf("=", sheets.indexOf("const ESSENTIAL"))).matchAll(/"([^"]+)"/g)].map((x) => x[1]),
  );

  for (const [kind, gate] of Object.entries(gateOf)) {
    if (values[gate] !== 1) continue;
    const key = byKind[kind];
    if (key && !essential.has(key)) {
      fail("D", `"${kind}" is admitted on floor 1 (${gate}=1) but its atlas "${key}" is not in boot/sheets.ts ESSENTIAL — it builds on a gameplay frame`);
    }
  }
}

// ── report ──────────────────────────────────────────────────────────────────
if (!problems.length) {
  console.log("registry-drift: clean");
  process.exit(0);
}
const LABEL = {
  A: "union coverage",
  B: "themed spawn reachability",
  C: "EXPANSION_SKIN ↔ KIND_PORTRAIT",
  D: "floor-1 atlas preload",
};
console.log(`registry-drift: ${problems.length} problem(s)\n`);
for (const check of ["A", "B", "C", "D"]) {
  const hits = problems.filter((p) => p.check === check);
  if (!hits.length) continue;
  console.log(`  [${check}] ${LABEL[check]}`);
  for (const h of hits) console.log(`      · ${h.msg}`);
  console.log("");
}
process.exit(1);
